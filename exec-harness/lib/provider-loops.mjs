/**
 * Multi-turn tool-use loops per provider. Extracted verbatim from
 * exec-harness/agentic-executor.mjs (see mcp-client.mjs for why).
 * The model sees only the goal prompt and the tool definitions handed in.
 */

function claudeTools(tools) { return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 900), input_schema: t.inputSchema })); }
function openaiTools(tools) { return tools.map((t) => ({ type: 'function', function: { name: t.name, description: (t.description || '').slice(0, 900), parameters: t.inputSchema } })); }
const stripSchema = (s) => JSON.parse(JSON.stringify(s, (k, v) => (['$schema', 'additionalProperties', 'title', 'default', 'examples'].includes(k) ? undefined : v)));

export const DEFAULT_MODEL_IDS = {
  claude: () => process.env.ANTHROPIC_AUDIT_MODEL || 'claude-opus-4-8',
  openai: () => process.env.OPENAI_AUDIT_MODEL || 'gpt-5.4',
  gemini: () => process.env.GEMINI_AUDIT_MODEL || 'gemini-flash-latest',
};

export async function loopClaude(goal, tools, callTool, budgets, log) {
  const model = DEFAULT_MODEL_IDS.claude();
  const messages = [{ role: 'user', content: goal }];
  let steps = 0, toolCalls = [], tokens = 0, respModel = model;
  while (steps < budgets.max_steps) {
    steps++;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2048, tools: claudeTools(tools), messages }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || res.status);
    tokens += (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0);
    if (j.model) respModel = j.model;
    log({ role: 'assistant', step: steps, content: j.content, stop: j.stop_reason });
    messages.push({ role: 'assistant', content: j.content });
    if (j.stop_reason !== 'tool_use') return { finalText: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' '), steps, toolCalls, tokens, model: respModel };
    const results = [];
    for (const tu of j.content.filter((c) => c.type === 'tool_use')) {
      toolCalls.push({ tool: tu.name, args: tu.input });
      const out = await callTool(tu.name, tu.input);
      log({ role: 'tool_result', step: steps, tool: tu.name, args: tu.input, result_head: out.slice(0, 400) });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.slice(0, 8000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { finalText: '(budget exceeded)', steps, toolCalls, tokens, model: respModel, budget_exceeded: true };
}

export async function loopOpenAI(goal, tools, callTool, budgets, log) {
  const model = DEFAULT_MODEL_IDS.openai();
  const messages = [{ role: 'user', content: goal }];
  let steps = 0, toolCalls = [], tokens = 0, respModel = model;
  while (steps < budgets.max_steps) {
    steps++;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, tools: openaiTools(tools), messages }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || res.status);
    tokens += j.usage?.total_tokens || 0;
    if (j.model) respModel = j.model;
    const msg = j.choices[0].message;
    log({ role: 'assistant', step: steps, content: msg });
    messages.push(msg);
    if (!msg.tool_calls?.length) return { finalText: msg.content || '', steps, toolCalls, tokens, model: respModel };
    for (const tc of msg.tool_calls) {
      const targs = JSON.parse(tc.function.arguments || '{}');
      toolCalls.push({ tool: tc.function.name, args: targs });
      const out = await callTool(tc.function.name, targs);
      log({ role: 'tool_result', step: steps, tool: tc.function.name, args: targs, result_head: out.slice(0, 400) });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out.slice(0, 8000) });
    }
  }
  return { finalText: '(budget exceeded)', steps, toolCalls, tokens, model: respModel, budget_exceeded: true };
}

export async function loopGemini(goal, tools, callTool, budgets, log) {
  const model = DEFAULT_MODEL_IDS.gemini();
  const contents = [{ role: 'user', parts: [{ text: goal }] }];
  let respModel = model;
  const toolDecl = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 900), parameters: stripSchema(t.inputSchema) })) }];
  let steps = 0, toolCalls = [], tokens = 0;
  while (steps < budgets.max_steps) {
    steps++;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents, tools: toolDecl }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || res.status);
    tokens += j.usageMetadata?.totalTokenCount || 0;
    if (j.modelVersion) respModel = j.modelVersion;
    const parts = j.candidates?.[0]?.content?.parts || [];
    log({ role: 'assistant', step: steps, content: parts });
    contents.push({ role: 'model', parts });
    const fcs = parts.filter((p) => p.functionCall);
    if (!fcs.length) return { finalText: parts.map((p) => p.text || '').join(' '), steps, toolCalls, tokens, model: respModel };
    const frParts = [];
    for (const fc of fcs) {
      toolCalls.push({ tool: fc.functionCall.name, args: fc.functionCall.args });
      const out = await callTool(fc.functionCall.name, fc.functionCall.args || {});
      log({ role: 'tool_result', step: steps, tool: fc.functionCall.name, args: fc.functionCall.args, result_head: out.slice(0, 400) });
      let parsed; try { parsed = JSON.parse(out); } catch { parsed = { text: out.slice(0, 8000) }; }
      frParts.push({ functionResponse: { name: fc.functionCall.name, response: { result: parsed } } });
    }
    contents.push({ role: 'user', parts: frParts });
  }
  return { finalText: '(budget exceeded)', steps, toolCalls, tokens, model: respModel, budget_exceeded: true };
}

export const LOOPS = { claude: loopClaude, openai: loopOpenAI, gemini: loopGemini };
