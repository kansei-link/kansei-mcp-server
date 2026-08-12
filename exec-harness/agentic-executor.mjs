#!/usr/bin/env node
/**
 * Agentic Executor — Test Packのgoal promptをエージェントに渡して実行させる共通実行器
 *
 * L1-α（Level1要件定義 v1.1 §7 / Data Architecture §3）:
 *   - モデルに渡すのは goal_prompt と「許可されたツール」だけ。scripted_stepsは絶対に見せない
 *   - risk=R0 のパックでは読み取り系ツールのみ公開（write系はツール定義ごと隠す）
 *   - 成果物正誤はハーネスがground truth（直接API読み）と照合。LLM判定は使わない
 *   - 出力: Evidence Bundle（transcript.jsonl × run + metrics.json + manifest.json）
 *
 * 使い方:
 *   node exec-harness/agentic-executor.mjs taskpacks/freee/freee-accounting-t1-account-item-detail.v1.json \
 *        [--models claude,openai,gemini] [--runs 3] [--lang ja]
 *
 * provenance=kansei_measured / verification_status はアサーション結果に応じて付与（DB書込は--record時のみ）
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const TODAY = new Date().toISOString().slice(0, 10);

// ---- CLI ----
const args = process.argv.slice(2);
const packPath = args.find((a) => !a.startsWith('--'));
if (!packPath) { console.error('usage: node agentic-executor.mjs <taskpack.json> [--models a,b] [--runs N] [--lang ja|en] [--record]'); process.exit(1); }
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MODELS = flag('models', 'claude,openai,gemini').split(',');
const RUNS = Number(flag('runs', 3));
const LANG = flag('lang', 'ja');
const RECORD = args.includes('--record');

// ---- .env ----
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const PACK = JSON.parse(readFileSync(resolve(ROOT, 'exec-harness', packPath.replace(/^exec-harness[\\/]/, '')), 'utf8'));

// R0で公開してよいツール（ホワイトリスト。write系はツール定義ごと見せない）
const R0_TOOL_ALLOWLIST = new Set([
  'freee_server_info', 'freee_auth_status', 'freee_current_user',
  'freee_list_companies', 'freee_get_current_company', 'freee_api_get', 'freee_api_list_paths',
]);

/* ================= MCP stdio client (freee-mcp) ================= */
class McpClient {
  constructor(command, cmdArgs) {
    this.proc = spawn(command, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    this.buf = ''; this.pending = new Map(); this.nextId = 1; this.stderr = '';
    this.proc.stderr.on('data', (d) => { this.stderr += d; });
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim(); this.buf = this.buf.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && this.pending.has(msg.id)) { const r = this.pending.get(msg.id); this.pending.delete(msg.id); r(msg); }
        } catch { /* partial */ }
      }
    });
  }
  request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    return new Promise((resolvefn) => {
      this.pending.set(id, resolvefn);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolvefn({ error: { message: 'timeout' } }); } }, timeoutMs);
    });
  }
  notify(method) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); }
  kill() { try { this.proc.kill(); } catch { /* noop */ } }
}
const textOf = (result) => (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

/* ================= provider loops（多ターンtool use・temperature 0） ================= */
function claudeTools(tools) { return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 900), input_schema: t.inputSchema })); }
function openaiTools(tools) { return tools.map((t) => ({ type: 'function', function: { name: t.name, description: (t.description || '').slice(0, 900), parameters: t.inputSchema } })); }
const stripSchema = (s) => JSON.parse(JSON.stringify(s, (k, v) => (['$schema', 'additionalProperties', 'title', 'default', 'examples'].includes(k) ? undefined : v)));

async function loopClaude(goal, tools, callTool, budgets, log) {
  const model = process.env.ANTHROPIC_AUDIT_MODEL || 'claude-opus-4-8';
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

async function loopOpenAI(goal, tools, callTool, budgets, log) {
  const model = process.env.OPENAI_AUDIT_MODEL || 'gpt-5.4';
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

async function loopGemini(goal, tools, callTool, budgets, log) {
  const model = process.env.GEMINI_AUDIT_MODEL || 'gemini-flash-latest';
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

const LOOPS = { claude: loopClaude, openai: loopOpenAI, gemini: loopGemini };

/* ================= ground truth（ハーネス自身の直接API読み） =================
 * freee-mcpのツールは整形テキストを返す（生JSONではない）。IDはテキストから抽出し、
 * account_items一覧はJSONが埋まっていればJSONを、なければテキスト行をパースする。 */
function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
async function fetchGroundTruth(callToolRaw) {
  const companyRaw = await callToolRaw('freee_get_current_company', {});
  const idMatch = String(companyRaw).match(/ID[:：]\s*(\d+)/i);
  if (!idMatch) throw new Error(`cannot extract company_id from: ${String(companyRaw).slice(0, 120)}`);
  const companyId = Number(idMatch[1]);
  const itemsRaw = await callToolRaw('freee_api_get', { service: 'accounting', path: '/api/1/account_items', query: { company_id: String(companyId) } });
  const parsed = extractJson(itemsRaw);
  let list = (parsed?.account_items || []).map((it) => ({ id: it.id, name: it.name }));
  if (!list.length) {
    // 整形テキスト形式のフォールバック: 「名称 (ID: 123)」/「- 123: 名称」等の行を拾う
    list = [...String(itemsRaw).matchAll(/(?:^|\n)\s*[-・]?\s*(.+?)\s*[（(]ID[:：]\s*(\d+)[)）]/g)].map((m) => ({ id: Number(m[2]), name: m[1].trim() }));
    if (!list.length) list = [...String(itemsRaw).matchAll(/(?:^|\n)\s*[-・]?\s*(\d{3,})\s*[:：]\s*(.+)/g)].map((m) => ({ id: Number(m[1]), name: m[2].trim() }));
  }
  if (!list.length) throw new Error(`cannot extract account_items. head: ${String(itemsRaw).slice(0, 200)}`);
  return { companyId, items: list };
}

/* ================= 成果物正誤（ルールベース・Codexレビュー#2反映） =================
 * 最終回答の内容一致だけでなく「詳細APIを実際に呼んだこと」自体を合否条件にする。
 * これが無いと、一覧応答から名前を写すだけのrunが将来PASSしてしまう。 */
function assertAnswer(finalText, truth, toolCalls) {
  const checks = [];
  const text = String(finalText);
  checks.push({ label: `最終回答に事業所ID(${truth.companyId})`, ok: text.includes(String(truth.companyId)) });

  // 詳細API呼び出しの存在: /api/1/account_items/{id}
  const detailCalls = toolCalls.filter((c) => c.tool === 'freee_api_get' && /\/api\/1\/account_items\/(\d+)/.test(String(c.args?.path || '')));
  const detailIds = detailCalls.map((c) => Number(String(c.args.path).match(/account_items\/(\d+)/)[1]));
  checks.push({ label: '詳細API(/account_items/{id})を実際に呼んだ', ok: detailCalls.length >= 1, note: detailIds.join(',') });

  // 詳細取得したIDが実在の勘定科目で、最終回答のID・名称がそれと一致する
  const matched = truth.items.find((it) => detailIds.includes(it.id));
  checks.push({ label: '詳細取得IDが一覧の実在IDと一致', ok: Boolean(matched), note: matched ? `id=${matched.id}` : '' });
  checks.push({ label: '最終回答にその勘定科目IDを記載', ok: matched ? text.includes(String(matched.id)) : false });
  checks.push({ label: '最終回答にそのIDの正しい名称を記載', ok: matched ? text.includes(matched.name) : false, note: matched?.name || '' });
  return { checks, pass: checks.every((c) => c.ok) };
}

/* ================= run_status（Codexレビュー#4） ================= */
function classifyRunStatus(error, pass) {
  if (error) {
    if (/quota|rate.?limit|429|exceeded your current|overloaded|529|ECONNRE|fetch failed|ENOTFOUND/i.test(error)) return 'infrastructure_error';
    return 'infrastructure_error'; // プロバイダAPI呼び出し自体の失敗は全てインフラ帰属（タスク失敗と混ぜない）
  }
  return pass ? 'measured_pass' : 'measured_fail';
}

/* ================= 最小権限ガード（Codexレビュー#3） =================
 * read-onlyに加えて、Test Packのscripted_stepsから許可(service, pathパターン)を導出し、
 * それ以外の汎用API読み取りも拒否する。company_idも現在テナントに固定。 */
function deriveApiConstraints(pack) {
  const allowed = [];
  for (const st of pack.scripted_steps || []) {
    if (st.tool !== 'freee_api_get' || !st.arguments?.path) continue;
    const pattern = '^' + st.arguments.path.replace(/\{\{[^}]+\}\}/g, '\\d+').replace(/\//g, '\\/') + '$';
    allowed.push({ service: st.arguments.service, re: new RegExp(pattern) });
  }
  return allowed;
}

/* ================= main ================= */
async function main() {
  const goal = PACK.goal_prompt[LANG];
  console.log(`Agentic Executor — pack=${PACK.id} v${PACK.version} risk=${PACK.risk} lang=${LANG} models=${MODELS.join(',')} N=${RUNS}`);

  // freee-mcp起動 + ツール面の準備
  const mcp = new McpClient('npx', ['freee-mcp']);
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'kansei-agentic-executor', version: '0.1' } });
  mcp.notify('notifications/initialized');
  const allTools = (await mcp.request('tools/list')).result?.tools || [];
  if (!allTools.length) { console.error('freee-mcp tools/list empty. stderr:', mcp.stderr.slice(0, 300)); process.exit(1); }
  const tools = PACK.risk === 'R0' ? allTools.filter((t) => R0_TOOL_ALLOWLIST.has(t.name)) : allTools;
  console.log(`tools exposed to agent (${PACK.risk} allowlist): ${tools.map((t) => t.name).join(', ')}`);

  const callToolRaw = async (name, targs) => {
    const r = await mcp.request('tools/call', { name, arguments: targs });
    return r.error ? JSON.stringify({ error: r.error.message }) : (textOf(r.result) || JSON.stringify(r.result));
  };
  // エージェント用: R0ホワイトリスト外の呼び出しはハーネスが拒否（負例の観測点にもなる）
  const callToolGuarded = async (name, targs) => {
    if (PACK.risk === 'R0' && !R0_TOOL_ALLOWLIST.has(name)) {
      return JSON.stringify({ error: `tool '${name}' is not permitted in this read-only (R0) session` });
    }
    return callToolRaw(name, targs);
  };

  // preflight（scripted・エージェント非関与）
  const preflightOutputs = [];
  for (const pf of PACK.preflight || []) {
    const out = await callToolRaw(pf.tool, {});
    preflightOutputs.push(out);
    console.log(`preflight ${pf.tool}: ${out.slice(0, 120).replace(/\n/g, ' ')}`);
    if (/"error"/.test(out)) { console.error('preflight failed — aborting'); mcp.kill(); process.exit(1); }
  }

  const truth = await fetchGroundTruth(callToolRaw);
  console.log(`ground truth: company_id=${truth.companyId}, account_items=${truth.items.length}`);

  // 最小権限ガード（tool allowlistの内側で、さらにAPI面を絞る）
  const apiConstraints = deriveApiConstraints(PACK);
  const guardViolations = [];
  const callToolLeastPriv = async (name, targs) => {
    if (name === 'freee_api_get') {
      const svcOk = apiConstraints.some((c) => c.service === targs?.service);
      const pathOk = apiConstraints.some((c) => c.service === targs?.service && c.re.test(String(targs?.path || '')));
      const cid = targs?.query?.company_id ?? targs?.company_id;
      const cidOk = cid == null || String(cid) === String(truth.companyId);
      if (!svcOk || !pathOk || !cidOk) {
        guardViolations.push({ name, args: targs, reason: !cidOk ? 'company_id_mismatch' : 'path_not_in_pack' });
        return JSON.stringify({ error: `request outside this task's permitted scope (service=${apiConstraints[0]?.service}, permitted paths only, own tenant only)` });
      }
    }
    return callToolGuarded(name, targs);
  };

  // Evidence Bundle dir
  const bundleDir = join(ROOT, 'evidence', PACK.service_id, TODAY, 'alpha-agentic');
  mkdirSync(bundleDir, { recursive: true });

  const results = [];
  for (const providerName of MODELS) {
    const loop = LOOPS[providerName];
    if (!loop) { console.log(`skip unknown model ${providerName}`); continue; }
    for (let n = 1; n <= RUNS; n++) {
      const runDir = join(bundleDir, `${providerName}-n${n}`);
      mkdirSync(runDir, { recursive: true });
      const transcriptPath = join(runDir, 'transcript.jsonl');
      writeFileSync(transcriptPath, '');
      const log = (e) => appendFileSync(transcriptPath, JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');
      log({ role: 'harness', event: 'start', pack: PACK.id, pack_version: PACK.version, provider: providerName, run: n, lang: LANG, tools: tools.map((t) => t.name) });

      const t0 = Date.now();
      const violBefore = guardViolations.length;
      let run, error = null;
      try {
        run = await Promise.race([
          loop(goal, tools, callToolLeastPriv, PACK.budgets, log),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout_s exceeded')), PACK.budgets.timeout_s * 1000)),
        ]);
      } catch (e) { error = e.message; run = { finalText: '', steps: 0, toolCalls: [], tokens: 0, model: providerName }; }
      const elapsed = Date.now() - t0;

      const verdict = error ? { checks: [], pass: false } : assertAnswer(run.finalText, truth, run.toolCalls);
      const runStatus = classifyRunStatus(error, verdict.pass);
      const falseCompletion = runStatus === 'measured_fail' && !run.budget_exceeded && /完了|できました|取得しました|successfully|retrieved/i.test(run.finalText);
      log({ role: 'harness', event: 'assert', checks: verdict.checks, run_status: runStatus, false_completion: falseCompletion, guard_violations: guardViolations.slice(violBefore), error, metrics: { steps: run.steps, tool_calls: run.toolCalls.length, provider_reported_tokens: run.tokens, elapsed_ms: elapsed } });

      const row = { provider: providerName, model: run.model, run: n, run_status: runStatus, false_completion: falseCompletion, steps: run.steps, tool_calls: run.toolCalls.length, tools_used: [...new Set(run.toolCalls.map((c) => c.tool))], provider_reported_tokens: run.tokens, elapsed_ms: elapsed, budget_exceeded: Boolean(run.budget_exceeded), guard_violations: guardViolations.length - violBefore, error };
      results.push(row);
      const tag2 = runStatus === 'measured_pass' ? 'PASS' : runStatus === 'infrastructure_error' ? 'INFR' : 'FAIL';
      console.log(`  [${tag2}] ${providerName} n${n}: steps=${run.steps} calls=${run.toolCalls.length} tokens=${run.tokens} ${(elapsed / 1000).toFixed(1)}s${error ? ' ERR:' + error.slice(0, 60) : ''}${falseCompletion ? ' ⚠️false-completion' : ''}`);
    }
  }
  mcp.kill();

  // ---- metrics + manifest ----
  // 分母規律（Codexレビュー#4）: 成功率の分母=measured runsのみ。infra errorは планned に残す
  const byProvider = {};
  for (const p of MODELS) {
    const rs = results.filter((r) => r.provider === p);
    if (!rs.length) continue;
    const measured = rs.filter((r) => r.run_status !== 'infrastructure_error');
    byProvider[p] = {
      model: rs.find((r) => r.model && r.model !== p)?.model || rs[0].model,
      runs_planned: rs.length,
      runs_measured: measured.length,
      measured_pass: measured.filter((r) => r.run_status === 'measured_pass').length,
      infrastructure_errors: rs.length - measured.length,
      false_completions: measured.filter((r) => r.false_completion).length,
      guard_violations: rs.reduce((s, r) => s + (r.guard_violations || 0), 0),
      median_steps: measured.length ? measured.map((r) => r.steps).sort((a, b) => a - b)[Math.floor(measured.length / 2)] : null,
      provider_reported_tokens_total: measured.reduce((s, r) => s + r.provider_reported_tokens, 0),
    };
  }
  // ground truthの識別子はmetricsに保存しない（数値IDは無塩ハッシュでも総当たり可能=Codexレビュー#1）
  const metrics = { pack: PACK.id, pack_version: PACK.version, date: TODAY, lang: LANG, mode: 'agentic', risk: PACK.risk, provenance: 'kansei_measured', ground_truth: { account_items_count: truth.items.length, note: 'tenant identifiers withheld from committed metrics; full detail in local transcripts only' }, token_note: 'provider_reported_tokens are raw per-provider token counts (different tokenizers/reasoning/caching) — NOT comparable as cost without per-provider pricing', by_provider: byProvider, runs: results };
  writeFileSync(join(bundleDir, 'metrics.json'), JSON.stringify(metrics, null, 1));

  const files = ['metrics.json'];
  for (const p of MODELS) for (let n = 1; n <= RUNS; n++) { const f = `${p}-n${n}/transcript.jsonl`; if (existsSync(join(bundleDir, f.replace('/', '\\')))) files.push(f); }
  const selfSha = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  let gitSha = null; try { const { execSync } = await import('node:child_process'); gitSha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch { /* not a repo */ }
  const mcpVersionMatch = preflightOutputs.join(' ').match(/version[:\s]+([\d.]+)/i);
  const manifest = {
    bundle: 'alpha-agentic',
    generated_at_utc: new Date().toISOString(),
    generated_at_jst: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00'),
    pack: { id: PACK.id, version: PACK.version, sha256: createHash('sha256').update(readFileSync(resolve(ROOT, 'exec-harness', packPath.replace(/^exec-harness[\\/]/, '')))).digest('hex') },
    executor: { file: 'agentic-executor.mjs', sha256: selfSha, git_head: gitSha },
    environment: { freee_mcp_version: mcpVersionMatch ? mcpVersionMatch[1] : null, tool_schema_sha256: createHash('sha256').update(JSON.stringify(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })))).digest('hex'), node: process.version },
    models: Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k, v.model])),
    date: TODAY,
    note: 'goal-prompt-only; scripted steps never shown to models; R0 tool allowlist + pack-derived least-privilege API guard (service/path/own-tenant) enforced; assertions require the detail API call itself (not just answer text); success-rate denominators are measured runs only (infrastructure errors excluded but counted as planned); temperature at provider default so residual non-determinism is expected and is why N>=3; tenant identifiers withheld from committed files',
    files: files.map((f) => { const full = join(bundleDir, f.replaceAll('/', '\\')); return { file: f, sha256: existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : null }; }),
  };
  writeFileSync(join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 1));

  console.log('\n=== L1-α agentic 結果（freee T1・R0） ===');
  for (const [p, s] of Object.entries(byProvider)) console.log(`  ${p} (${s.model}): measured ${s.measured_pass}/${s.runs_measured} pass (planned ${s.runs_planned}, infra ${s.infrastructure_errors}), false-completion=${s.false_completions}, guard-violations=${s.guard_violations}, median_steps=${s.median_steps}, provider_tokens=${s.provider_reported_tokens_total}`);
  console.log(`evidence: evidence/${PACK.service_id}/${TODAY}/alpha-agentic/ (manifest+SHA-256)`);
  if (RECORD) console.log('（--record指定: DB書込は未実装のまま安全側。metrics.jsonからの登用は手動レビュー後）');
}

main().catch((e) => { console.error('EXECUTOR ERROR:', e); process.exit(1); });
