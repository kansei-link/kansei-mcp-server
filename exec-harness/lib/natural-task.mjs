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
 *   perplexity   Agent API POST /v1/agent, preset "fast", tools web_search + fetch_url (citations: only the
 *                documented structured field output_text.annotations; the [n] markers are never read)
 *   claude-code  `claude -p` in an isolated environment (empty CLAUDE_CONFIG_DIR, --safe-mode, no MCP,
 *                tools WebSearch/WebFetch/Write only, API key; the child gets ONLY the environment
 *                variables of CLAUDE_CODE_ENV_INHERIT plus the ones set here — never process.env as a
 *                whole), stream-json events parsed line by line, files written in a fresh work directory
 *                collected afterwards. Checked before anything is graded: exit code 0, exactly one result
 *                event with is_error=false and subtype=success; otherwise { error, error_class } and the
 *                files left in the work directory are not returned
 *   fake         smoke tests only: KANSEI_FAKE_NATURAL_FILE = { "<observer label>": { raw, files?, error? } }
 * Provider errors never throw: they come back as { error, error_class? } so the harness records an
 * instrument row (error_class: provider_api (default) | timeout | budget | other).
 * The model a provider reports is returned as it came; marker-generic decides whether it may be public.
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
      if (f.error) return { error: String(f.error), error_class: f.error_class, model: 'fake-model' };
      return { raw: f.raw, model: f.model || 'fake-model', files: f.files || [], cli_version: f.cli_version || null };
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: opt.model, input: prompt, max_output_tokens: opt.max_output_tokens, tools: [{ type: 'web_search', user_location: opt.user_location }], tool_choice: 'required', include: ['web_search_call.action.sources'] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model: opt.model };
      return { raw: d, model: typeof d.model === 'string' ? d.model : null, files: [], usage: d.usage || null };
    }
    if (provider === 'anthropic') {
      const tools = [{ type: opt.tools[0], name: 'web_search', max_uses: opt.max_uses }, { type: opt.tools[1], name: 'web_fetch', max_uses: opt.max_uses }];
      const messages = [{ role: 'user', content: prompt }];
      const content = []; let model = opt.model; let usage = null; let turns = 0;
      for (;;) {
        const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: opt.model, max_tokens: opt.max_tokens, tools, messages }) });
        const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model };
        model = typeof d.model === 'string' ? d.model : model; usage = d.usage || usage; turns++;
        for (const b of Array.isArray(d.content) ? d.content : []) content.push(b);
        if (d.stop_reason === 'pause_turn' && turns <= MAX_CONTINUATIONS) { messages.push({ role: 'assistant', content: d.content }); continue; }
        return { raw: { content, stop_reason: d.stop_reason, turns }, model, files: [], usage };
      }
    }
    if (provider === 'perplexity') {
      const res = await fetch('https://api.perplexity.ai/v1/agent', { method: 'POST', headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ preset: opt.preset, input: prompt, tools: [{ type: 'web_search' }, { type: 'fetch_url' }] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || d.error || `HTTP ${res.status}`, model: null };
      return { raw: d, model: typeof d.model === 'string' ? d.model : null, files: [], usage: d.usage || null };
    }
    if (provider === 'claude-code') return await runClaudeCode(prompt, opt);
    return { error: `unknown provider ${provider}`, model: 'none' };
  } catch (e) { return { error: String(e?.message || e), model: (CONFIG_DEFAULTS[provider] || {}).model || provider }; }
}

/* ---------- Claude Code, isolated ---------- */
export const CLAUDE_CODE_ARGS = Object.freeze(['-p', '--output-format', 'stream-json', '--verbose', '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', '--no-session-persistence']);
/* The child's environment is built from two closed lists (Codex fe0d132 P2; only the NAMES are recorded, in the manifest):
 *   CLAUDE_CODE_ENV_INHERIT  taken from this process when set (compared without case: Windows has "Path")
 *   CLAUDE_CODE_ENV_SET      set here (plus CLAUDE_CONFIG_DIR = the run's empty config directory)
 * Nothing else of process.env reaches the CLI (no other API key, no ANTHROPIC_AUTH_TOKEN, no Bedrock / Vertex switch). */
export const CLAUDE_CODE_ENV_INHERIT = Object.freeze(['ANTHROPIC_API_KEY', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'USERNAME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CLAUDE_CODE_GIT_BASH_PATH']);
export const CLAUDE_CODE_ENV_SET = Object.freeze({ CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1', CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
/** The environment of the Claude Code child: the allowed names only, plus CLAUDE_CONFIG_DIR and the fixed switches. */
export function claudeCodeEnv(configDir, source = process.env) {
  const allow = new Set(CLAUDE_CODE_ENV_INHERIT);
  const env = {};
  for (const [k, v] of Object.entries(source)) if (allow.has(k.toUpperCase()) && typeof v === 'string') env[k] = v;
  return { ...env, CLAUDE_CONFIG_DIR: configDir, ...CLAUDE_CODE_ENV_SET };
}
const BUDGET_SUBTYPES = new Set(['error_max_turns', 'error_max_budget_usd']);
/** The CLI's version (digits.digits.digits) or null. env = the child's environment (the allow-list; never process.env as a whole). */
export function claudeCodeVersion(bin, env) {
  try { return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32', env }).match(/\d+\.\d+\.\d+/)?.[0] || null; } catch { return null; }
}
/** Files (top level, *.json, ≤ 256 KiB each) written in the work directory: { name, content }. */
export function collectWorkFiles(dir) {
  const out = [];
  try { for (const f of readdirSync(dir)) { const p = join(dir, f); try { if (statSync(p).isFile() && f.endsWith('.json') && statSync(p).size <= 262144) out.push({ name: f, content: readFileSync(p, 'utf8') }); } catch { /* skip */ } } } catch { /* no dir */ }
  return out;
}
async function runClaudeCode(prompt, opt) {
  const bin = process.env.KANSEI_CLAUDE_CODE_BIN || 'claude';
  const base = mkdtempSync(join(tmpdir(), 'kansei-m006-'));
  const work = join(base, 'work'); const config = join(base, 'config'); mkdirSync(work); mkdirSync(config);
  const env = claudeCodeEnv(config); // every child of this run (the version query too) gets this environment only
  const version = claudeCodeVersion(bin, env);
  const args = [...CLAUDE_CODE_ARGS, '--model', opt.model, '--tools', opt.tools.join(','), '--max-turns', String(opt.max_turns), '--max-budget-usd', String(opt.max_budget_usd), prompt];
  const events = []; let stderr = ''; let raw = '';
  const code = await new Promise((resolve) => {
    const p = spawn(bin, args, { cwd: work, env, shell: process.platform === 'win32', windowsHide: true });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* */ } resolve('timeout'); }, opt.timeout_ms);
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8'); // decode across chunk boundaries (a multi-byte character split in two)
    p.stdout.on('data', (d) => { raw += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', () => { clearTimeout(timer); resolve('spawn_error'); });
    p.on('close', (c) => { clearTimeout(timer); resolve(c); });
  });
  for (const line of raw.split(/\r?\n/)) { const s = line.trim(); if (!s.startsWith('{')) continue; try { events.push(JSON.parse(s)); } catch { /* not an event */ } }
  const files = collectWorkFiles(work);
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
  // Checked before anything is graded (Codex fe0d132 R3). A failed run returns no files: what was left in the
  // work directory is not graded. Its events go to the private transcript only (raw_private).
  const failed = (error, error_class) => ({ error, error_class, model: null, cli_version: version, raw_private: events });
  if (code === 'spawn_error') return failed('claude-code: cannot start', 'other');
  if (code === 'timeout') return failed('claude-code: timeout', 'timeout');
  const results = events.filter((e) => e && typeof e === 'object' && e.type === 'result');
  if (results.length !== 1) return failed(`claude-code: ${results.length} result events (exit ${code}) ${stderr.slice(0, 120)}`, 'other');
  const result = results[0];
  if (typeof result.is_error !== 'boolean' || typeof result.subtype !== 'string') return failed(`claude-code: result without is_error / subtype (exit ${code})`, 'other');
  if (result.is_error !== false || result.subtype !== 'success') return failed(`claude-code: result ${result.subtype.slice(0, 40)} is_error=${result.is_error} (exit ${code})`, BUDGET_SUBTYPES.has(result.subtype) ? 'budget' : 'provider_api');
  if (code !== 0) return failed(`claude-code: exit ${code} after a success result`, 'other');
  const modelUsed = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage)[0] : null;
  return { raw: events, model: modelUsed || null, files, cli_version: version, usage: { total_cost_usd: result.total_cost_usd ?? null, num_turns: result.num_turns ?? null } };
}

/**
 * Was the Claude Code run isolated? Read from the system/init event, closed (Codex fe0d132 R4): there must be
 * EXACTLY ONE init event; tools, mcp_servers and plugins must each BE THERE as an array (a missing field is
 * not an empty list); tools must be exactly the allowed set (no tool more, none less); mcp_servers and plugins
 * must be empty. Anything else → the run is an instrument error ("other") and nothing of it is graded.
 */
export function claudeCodeIsolation(events, allowedTools) {
  const inits = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object' && e.type === 'system' && e.subtype === 'init') : [];
  if (inits.length !== 1) return { ok: false, why: `init_events:${inits.length}` };
  const init = inits[0];
  for (const k of ['tools', 'mcp_servers', 'plugins']) if (!Array.isArray(init[k])) return { ok: false, why: `init_field_not_an_array:${k}` };
  const same = init.tools.every((t) => typeof t === 'string') && [...init.tools].sort().join('\n') === [...allowedTools].sort().join('\n');
  if (!same) return { ok: false, why: `tools_not_the_allowed_set:${init.tools.length}` };
  if (init.mcp_servers.length) return { ok: false, why: `mcp_servers:${init.mcp_servers.length}` };
  if (init.plugins.length) return { ok: false, why: `plugins:${init.plugins.length}` };
  return { ok: true, why: 'isolated' };
}
