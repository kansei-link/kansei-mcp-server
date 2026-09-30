/**
 * Callers for kind_of_truth = natural_task (M-006): one natural-language task per run, the provider's
 * own search / fetch tools enabled, and the RAW response returned for lib/natural-task-rules.mjs to
 * read. Loaded only by the naturalTask target (dynamic import), so no other marker depends on it.
 *
 * Configurations (proposal §10, Michie 2026-09-29/30):
 *   openai       Responses API, tools:[web_search], tool_choice required, user_location JP fixed,
 *                include web_search_call.action.sources; a dated reasoning model (gpt-5.5-2026-04-23)
 *   anthropic    Messages API, server tools web_search_20250305 + web_fetch_20250910 (the base versions:
 *                the dynamic-filtering versions hide part of the candidates inside code execution);
 *                pause_turn is re-sent up to MAX_CONTINUATIONS times with the same tools
 *   perplexity   Agent API POST /v1/agent, preset "fast" (its citations are [n] markers), tools
 *                web_search + fetch_url
 *   claude-code  `claude -p` in an isolated environment (empty CLAUDE_CONFIG_DIR, --safe-mode, no MCP,
 *                tools WebSearch/WebFetch/Write only, API key), stream-json events parsed line by line,
 *                files written in a fresh work directory collected afterwards
 *   fake         smoke tests only: KANSEI_FAKE_NATURAL_FILE = { "<observer label>": { raw, files?, error? } }
 * Provider errors never throw: they come back as { error } so the harness records an instrument row.
 * Gemini with Google Search grounding is NOT a configuration: its terms forbid collecting or analysing
 * the grounding links programmatically (proposal §10-0 A, Michie 2026-09-30).
 */
import { readFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

export const CONFIG_DEFAULTS = Object.freeze({
  openai: Object.freeze({ model: 'gpt-5.5-2026-04-23', tools: Object.freeze(['web_search']), max_output_tokens: 4000, user_location: Object.freeze({ type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' }), fetch_meaning: 'model_opened_page' }),
  anthropic: Object.freeze({ model: 'claude-opus-5-5', tools: Object.freeze(['web_search_20250305', 'web_fetch_20250910']), max_tokens: 4000, max_uses: 5, fetch_meaning: 'provider_server_fetched' }),
  perplexity: Object.freeze({ preset: 'fast', tools: Object.freeze(['web_search', 'fetch_url']), fetch_meaning: 'fetch_url_requested' }),
  'claude-code': Object.freeze({ model: 'claude-opus-5-5', tools: Object.freeze(['WebSearch', 'WebFetch', 'Write']), max_turns: 25, max_budget_usd: 3, timeout_ms: 540000, fetch_meaning: 'local_fetch_summarised' }),
});
const MAX_CONTINUATIONS = 3;

async function json(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; } }

/** { raw, model, error, files } — raw is what the rules module reads. */
export async function runNaturalTask(config, prompt, { label, cfg = {} } = {}) {
  const provider = config.provider;
  const opt = { ...(CONFIG_DEFAULTS[provider] || {}), ...cfg };
  try {
    if (provider === 'fake') {
      const table = JSON.parse(readFileSync(process.env.KANSEI_FAKE_NATURAL_FILE, 'utf8'));
      const f = table[label];
      if (!f) return { error: `fake response missing for ${label}`, model: 'fake-model' };
      if (f.error) return { error: String(f.error), model: 'fake-model' };
      return { raw: f.raw, model: f.model || 'fake-model', files: f.files || [], cli_version: f.cli_version || null };
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: opt.model, input: prompt, max_output_tokens: opt.max_output_tokens, tools: [{ type: 'web_search', user_location: opt.user_location }], tool_choice: 'required', include: ['web_search_call.action.sources'] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model: opt.model };
      return { raw: d, model: d.model || opt.model, files: [], usage: d.usage || null };
    }
    if (provider === 'anthropic') {
      const tools = [{ type: opt.tools[0], name: 'web_search', max_uses: opt.max_uses }, { type: opt.tools[1], name: 'web_fetch', max_uses: opt.max_uses }];
      const messages = [{ role: 'user', content: prompt }];
      const content = []; let model = opt.model; let usage = null; let turns = 0;
      for (;;) {
        const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: opt.model, max_tokens: opt.max_tokens, tools, messages }) });
        const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model };
        model = d.model || model; usage = d.usage || usage; turns++;
        for (const b of Array.isArray(d.content) ? d.content : []) content.push(b);
        if (d.stop_reason === 'pause_turn' && turns <= MAX_CONTINUATIONS) { messages.push({ role: 'assistant', content: d.content }); continue; }
        return { raw: { content, stop_reason: d.stop_reason, turns }, model, files: [], usage };
      }
    }
    if (provider === 'perplexity') {
      const res = await fetch('https://api.perplexity.ai/v1/agent', { method: 'POST', headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ preset: opt.preset, input: prompt, tools: [{ type: 'web_search' }, { type: 'fetch_url' }] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || d.error || `HTTP ${res.status}`, model: `preset:${opt.preset}` };
      return { raw: d, model: d.model || `preset:${opt.preset}`, files: [], usage: d.usage || null };
    }
    if (provider === 'claude-code') return await runClaudeCode(prompt, opt);
    return { error: `unknown provider ${provider}`, model: 'none' };
  } catch (e) { return { error: String(e?.message || e), model: (CONFIG_DEFAULTS[provider] || {}).model || provider }; }
}

/* ---------- Claude Code, isolated ---------- */
export const CLAUDE_CODE_ARGS = Object.freeze(['-p', '--output-format', 'stream-json', '--verbose', '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', '--no-session-persistence']);
const STRIP_ENV = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];
export function claudeCodeVersion(bin = process.env.KANSEI_CLAUDE_CODE_BIN || 'claude') {
  try { return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32' }).match(/\d+\.\d+\.\d+/)?.[0] || null; } catch { return null; }
}
/** Files (top level, *.json, ≤ 256 KiB each) written in the work directory: { name, content }. */
export function collectWorkFiles(dir) {
  const out = [];
  try { for (const f of readdirSync(dir)) { const p = join(dir, f); try { if (statSync(p).isFile() && f.endsWith('.json') && statSync(p).size <= 262144) out.push({ name: f, content: readFileSync(p, 'utf8') }); } catch { /* skip */ } } } catch { /* no dir */ }
  return out;
}
async function runClaudeCode(prompt, opt) {
  const bin = process.env.KANSEI_CLAUDE_CODE_BIN || 'claude';
  const version = claudeCodeVersion(bin);
  const base = mkdtempSync(join(tmpdir(), 'kansei-m006-'));
  const work = join(base, 'work'); const config = join(base, 'config'); mkdirSync(work); mkdirSync(config);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1', CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  for (const k of STRIP_ENV) delete env[k];
  const args = [...CLAUDE_CODE_ARGS, '--model', opt.model, '--tools', opt.tools.join(','), '--max-turns', String(opt.max_turns), '--max-budget-usd', String(opt.max_budget_usd), prompt];
  const events = []; let stderr = ''; let raw = '';
  const code = await new Promise((resolve) => {
    const p = spawn(bin, args, { cwd: work, env, shell: process.platform === 'win32', windowsHide: true });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* */ } resolve('timeout'); }, opt.timeout_ms);
    p.stdout.on('data', (d) => { raw += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', () => { clearTimeout(timer); resolve('spawn_error'); });
    p.on('close', (c) => { clearTimeout(timer); resolve(c); });
  });
  for (const line of raw.split(/\r?\n/)) { const s = line.trim(); if (!s.startsWith('{')) continue; try { events.push(JSON.parse(s)); } catch { /* not an event */ } }
  const files = collectWorkFiles(work);
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
  if (code === 'spawn_error') return { error: 'claude-code: cannot start', model: opt.model, cli_version: version };
  if (code === 'timeout') return { error: 'claude-code: timeout', model: opt.model, cli_version: version };
  if (!events.some((e) => e && e.type === 'result')) return { error: `claude-code: no result event (exit ${code}) ${stderr.slice(0, 120)}`, model: opt.model, cli_version: version };
  const result = events.find((e) => e && e.type === 'result');
  const modelUsed = result?.modelUsage && Object.keys(result.modelUsage)[0];
  return { raw: events, model: modelUsed || opt.model, files, cli_version: version, usage: result ? { total_cost_usd: result.total_cost_usd ?? null, num_turns: result.num_turns ?? null } : null };
}

/**
 * Was the Claude Code run isolated? Read from the system/init event: the tools must be within the
 * allowed set and no MCP server / plugin may be present. Anything else → the run is an instrument error.
 */
export function claudeCodeIsolation(events, allowedTools) {
  const init = Array.isArray(events) ? events.find((e) => e && e.type === 'system' && e.subtype === 'init') : null;
  if (!init) return { ok: false, why: 'no_init_event' };
  const tools = Array.isArray(init.tools) ? init.tools : [];
  const extra = tools.filter((t) => !allowedTools.includes(t));
  const mcp = Array.isArray(init.mcp_servers) ? init.mcp_servers.length : 0;
  const plugins = Array.isArray(init.plugins) ? init.plugins.length : 0;
  if (extra.length) return { ok: false, why: `unexpected_tools:${extra.length}` };
  if (mcp) return { ok: false, why: `mcp_servers:${mcp}` };
  if (plugins) return { ok: false, why: `plugins:${plugins}` };
  return { ok: true, why: 'isolated' };
}
