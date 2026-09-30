/**
 * Rules for kind_of_truth = natural_task (M-006) — the natural-task reading, judged from two CLOSED
 * traces only (founder-ops/research/Marker-M004_2026-09-25/PROPOSAL-M004-natural-task_2026-09-29.md
 * §3, §4, §10; Michie's decisions of 2026-09-29/30). Pure functions, no I/O. Never grades free text.
 *
 * TRACE (discover): the URLs a configuration leaves in STRUCTURED fields, each handed whole to
 * sourceRepoKey — never found by scanning a page or an answer.
 *   candidates  URLs that appeared in search results (seen, not opened)      → recorded, never counted
 *   fetched     URLs the model asked to open (the request is the reaching;   → counted
 *               whether the fetch succeeded is kept beside it as `ok`)
 *   cited       URLs the final answer cites, from the provider's structured    → counted
 *               citation field (Perplexity: the [n] markers of the answer text mapped to the ids of
 *               the search results the API returned — [digits] only, ids within the returned list,
 *               anything else ignored)
 *   Each field is either readable (the configuration produces it) or "no trace" (readable=false,
 *   e.g. Claude Code has no structured citations); a field that is not readable decides nothing.
 * ARTIFACT (understand): the configuration file the answer produced — a fenced code block or a file
 * in the work directory that JSON.parse accepts as an object with a top-level `mcpServers` object.
 * Exactly one distinct artifact is judged; none or several → undetermined. Free text is never read.
 *   points_official  some mcpServers entry has one of the two forms of the official README
 *                    (OFFICIAL_FORMS: P2 local entry path, P3 mcp-remote with the official header
 *                    names). No package name exists on npm, so package names are never used.
 *   auth_correct     that entry carries the official credential slots (env ACCESS_TOKEN + SYSTEM_URL,
 *                    or header/query x-access-token + x-system-url)
 *   wrong_auth_field that entry carries a Basic / API-key style credential name
 * JUDGEMENT (exactly one of pass / false_completion / undetermined / instrument):
 *   discover passed  = fetched or cited holds a URL that resolves to the sealed repository
 *   then: artifact official + auth correct + no wrong field → done (pass)
 *         artifact official + wrong field                   → understand, false_completion
 *         artifact official, no credential slot            → understand, undetermined
 *         artifact points elsewhere                        → understand, false_completion
 *         no single parseable artifact                     → understand, undetermined
 *   discover not passed (traces readable, nothing resolves):
 *         artifact points elsewhere / wrong field          → discover, false_completion
 *         artifact official                                → discover, undetermined + reached_without_trace
 *         otherwise                                        → discover, undetermined
 *   no tool call at all                                    → discover, undetermined (tools_used=false)
 *   response shape not as documented                       → instrument "other"
 */
import { sourceRepoKey } from './repo-key.mjs';

export const METHOD = 'natural_task_traces_vs_sealed_repo';

/* ---------- the two official forms (README of the sealed repository, read 2026-09-29) ---------- */
export const OFFICIAL_FORMS = Object.freeze({
  P2: Object.freeze({ entry_path_suffix: 'aw-app/dist/custom/admin/server.js', env_keys: Object.freeze(['ACCESS_TOKEN', 'SYSTEM_URL']) }),
  P3: Object.freeze({ command: 'npx', package: 'mcp-remote', url_path_suffix: '/mcp', header_names: Object.freeze(['x-access-token', 'x-system-url']) }),
  wrong_credential_names: Object.freeze(['user', 'username', 'password', 'passwd', 'pass', 'basic', 'api_key', 'apikey', 'x_api_key', 'authorization_basic']),
});

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isPlain(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
const normName = (s) => String(s).trim().toLowerCase().replace(/-/g, '_');
const urlStr = (u) => (typeof u === 'string' && u.trim() ? u.trim() : null);

/* ---------- traces per configuration ---------- */
const emptyTrace = (over = {}) => ({ shape_ok: true, tools_used: false, candidates: [], fetched: [], fetched_readable: true, cited: [], cited_readable: true, text: '', ...over });

/** OpenAI Responses API (web_search; include web_search_call.action.sources). */
export function tracesOpenAI(resp) {
  if (!isPlain(resp) || !Array.isArray(resp.output)) return emptyTrace({ shape_ok: false });
  const t = emptyTrace();
  for (const item of resp.output) {
    if (!isPlain(item)) continue;
    if (item.type === 'web_search_call') {
      t.tools_used = true;
      const a = isPlain(item.action) ? item.action : null;
      if (a?.type === 'search') for (const s of Array.isArray(a.sources) ? a.sources : []) { const u = urlStr(s?.url); if (u) t.candidates.push(u); }
      if (a?.type === 'open_page') { const u = urlStr(a.url); if (u) t.fetched.push({ url: u, ok: true }); else t.fetched.push({ url: null, ok: true }); }
      if (a?.type === 'find_in_page') { const u = urlStr(a.url); if (u) t.fetched.push({ url: u, ok: true }); }
    }
    if (item.type === 'message') for (const c of Array.isArray(item.content) ? item.content : []) {
      if (!isPlain(c) || c.type !== 'output_text') continue;
      if (typeof c.text === 'string') t.text += (t.text ? '\n' : '') + c.text;
      for (const an of Array.isArray(c.annotations) ? c.annotations : []) if (isPlain(an) && an.type === 'url_citation') { const u = urlStr(an.url); if (u) t.cited.push(u); }
    }
  }
  return t;
}

/** Anthropic Messages API (web_search_20250305 + web_fetch_20250910); `content` = all blocks of the turn(s). */
export function tracesAnthropic(resp) {
  const content = isPlain(resp) && Array.isArray(resp.content) ? resp.content : Array.isArray(resp) ? resp : null;
  if (!content) return emptyTrace({ shape_ok: false });
  const t = emptyTrace();
  const requested = new Map(); // server_tool_use id → url asked for
  for (const b of content) {
    if (!isPlain(b)) continue;
    if (b.type === 'server_tool_use') { t.tools_used = true; if (b.name === 'web_fetch') requested.set(b.id, urlStr(b.input?.url)); }
    if (b.type === 'web_search_tool_result') { t.tools_used = true; for (const r of Array.isArray(b.content) ? b.content : []) if (isPlain(r) && r.type === 'web_search_result') { const u = urlStr(r.url); if (u) t.candidates.push(u); } }
    if (b.type === 'web_fetch_tool_result') {
      t.tools_used = true;
      const ok = isPlain(b.content) && b.content.type === 'web_fetch_result';
      const u = (ok && urlStr(b.content.url)) || requested.get(b.tool_use_id) || null;
      t.fetched.push({ url: u, ok });
    }
    if (b.type === 'text') {
      if (typeof b.text === 'string') t.text += (t.text ? '\n' : '') + b.text;
      for (const c of Array.isArray(b.citations) ? b.citations : []) if (isPlain(c) && c.type === 'web_search_result_location') { const u = urlStr(c.url); if (u) t.cited.push(u); }
    }
  }
  return t;
}

/** Perplexity Agent API (preset fast; tools web_search + fetch_url); citations = [n] markers → results[].id. */
const PPLX_MARKER = /\[(\d{1,4})\]/g;
export function perplexityCitedIds(text) {
  const ids = new Set();
  for (const m of String(text ?? '').matchAll(PPLX_MARKER)) ids.add(m[1]);
  return [...ids];
}
export function tracesPerplexity(resp) {
  if (!isPlain(resp) || !Array.isArray(resp.output)) return emptyTrace({ shape_ok: false });
  const t = emptyTrace();
  const byId = new Map();
  for (const item of resp.output) {
    if (!isPlain(item)) continue;
    if (item.type === 'search_results') { t.tools_used = true; for (const r of Array.isArray(item.results) ? item.results : []) { const u = urlStr(r?.url); if (!u) continue; t.candidates.push(u); if (r.id !== undefined && r.id !== null && !byId.has(String(r.id))) byId.set(String(r.id), u); } }
    if (item.type === 'fetch_url_results') { t.tools_used = true; for (const c of Array.isArray(item.contents) ? item.contents : []) { const u = urlStr(c?.url); if (u) t.fetched.push({ url: u, ok: typeof c.snippet === 'string' && c.snippet.trim() !== '' && c.snippet.trim() !== 'no_result_returned' }); } }
    if (item.type === 'message') for (const c of Array.isArray(item.content) ? item.content : []) if (isPlain(c) && typeof c.text === 'string') t.text += (t.text ? '\n' : '') + c.text;
  }
  const citedIds = new Set(perplexityCitedIds(t.text).map((id) => String(Number(id)))); // [02] and [2] are the same id
  for (const n of citedIds) if (byId.has(n)) t.cited.push(byId.get(n));
  return t;
}

/** Claude Code `-p --output-format stream-json --verbose`: events = parsed lines. No structured citations. */
export function tracesClaudeCode(events) {
  if (!Array.isArray(events)) return emptyTrace({ shape_ok: false, cited_readable: false });
  const t = emptyTrace({ cited_readable: false });
  const uses = new Map(); // tool_use id → { name, input }
  let sawInit = false, sawResult = false;
  for (const e of events) {
    if (!isPlain(e)) continue;
    if (e.type === 'system' && e.subtype === 'init') sawInit = true;
    if (e.type === 'assistant') for (const c of Array.isArray(e.message?.content) ? e.message.content : []) if (isPlain(c) && c.type === 'tool_use' && (c.name === 'WebSearch' || c.name === 'WebFetch')) { uses.set(c.id, { name: c.name, input: isPlain(c.input) ? c.input : {} }); t.tools_used = true; }
    if (e.type === 'user') {
      const ids = (Array.isArray(e.message?.content) ? e.message.content : []).filter((c) => isPlain(c) && c.type === 'tool_result').map((c) => c.tool_use_id);
      const use = ids.map((id) => uses.get(id)).find(Boolean);
      const r = e.tool_use_result;
      if (use?.name === 'WebSearch' && isPlain(r)) for (const x of Array.isArray(r.results) ? r.results : []) for (const c of isPlain(x) && Array.isArray(x.content) ? x.content : []) { const u = urlStr(c?.url); if (u) t.candidates.push(u); }
      if (use?.name === 'WebFetch') { const u = (isPlain(r) && urlStr(r.url)) || urlStr(use.input.url); const code = isPlain(r) ? Number(r.code) : NaN; t.fetched.push({ url: u, ok: code >= 200 && code < 300 && Number(r?.bytes) > 0 }); }
    }
    if (e.type === 'result') { sawResult = true; if (typeof e.result === 'string') t.text = e.result; }
  }
  // WebFetch requests whose result line never came are still requests (reaching)
  for (const [, u] of uses) if (u.name === 'WebFetch' && urlStr(u.input.url) && !t.fetched.some((f) => f.url === u.input.url)) t.fetched.push({ url: u.input.url, ok: false });
  if (!sawInit || !sawResult) t.shape_ok = false;
  return t;
}

/* ---------- the artifact ---------- */
const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
function parseArtifactCandidate(text) {
  let v; try { v = JSON.parse(text); } catch { return null; }
  return isPlain(v) && isPlain(v.mcpServers) ? v : null;
}
/** { state: 'none' | 'one' | 'many', artifact, sources } from the answer text's fenced blocks and the work directory's JSON files. */
export function extractArtifact({ text = '', files = [] } = {}) {
  const found = new Map();
  for (const m of String(text).matchAll(FENCE)) { const a = parseArtifactCandidate(m[1]); if (a) found.set(canonical(a), { artifact: a, source: 'fenced_block' }); }
  for (const f of files) { const a = parseArtifactCandidate(f?.content ?? ''); if (a) found.set(canonical(a), { artifact: a, source: `file:${f.name || '?'}` }); }
  if (found.size === 0) return { state: 'none', artifact: null, sources: [] };
  if (found.size > 1) return { state: 'many', artifact: null, sources: [...found.values()].map((x) => x.source) };
  const [only] = found.values();
  return { state: 'one', artifact: only.artifact, sources: [only.source] };
}

function headerPairs(args) {
  const out = [];
  for (let i = 0; i + 1 < args.length; i++) if (args[i] === '--header' && typeof args[i + 1] === 'string') { const j = args[i + 1].indexOf(':'); if (j > 0) out.push({ name: normName(args[i + 1].slice(0, j)), value: args[i + 1].slice(j + 1).trim() }); }
  return out;
}
function queryNames(url) {
  try { return [...new URL(url).searchParams.keys()].map(normName); } catch { return []; }
}
function judgeEntry(entry) {
  if (!isPlain(entry)) return { form: null, auth_correct: false, wrong_auth_field: false };
  const args = Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === 'string') : [];
  const env = isPlain(entry.env) ? entry.env : {};
  const cmd = typeof entry.command === 'string' ? entry.command.replace(/\\/g, '/').split('/').pop().replace(/\.(cmd|exe)$/i, '').toLowerCase() : '';
  const names = new Set([...Object.keys(env).map(normName), ...headerPairs(args).map((h) => h.name)]);
  let form = null;
  if (args.some((a) => a.replace(/\\/g, '/').toLowerCase().endsWith(OFFICIAL_FORMS.P2.entry_path_suffix))) form = 'P2';
  else {
    const remoteUrl = args.find((a) => /^https?:\/\/\S+$/.test(a) && a.split(/[?#]/)[0].endsWith(OFFICIAL_FORMS.P3.url_path_suffix));
    const pkg = args.some((a) => a === OFFICIAL_FORMS.P3.package || a.startsWith(`${OFFICIAL_FORMS.P3.package}@`));
    if (cmd === OFFICIAL_FORMS.P3.command && pkg && remoteUrl) { form = 'P3'; for (const q of queryNames(remoteUrl)) names.add(q); }
  }
  const has = (n) => names.has(normName(n));
  const auth_correct = form === 'P2' ? OFFICIAL_FORMS.P2.env_keys.every((k) => has(k)) : form === 'P3' ? OFFICIAL_FORMS.P3.header_names.every((h) => has(h)) : false;
  const basicHeader = headerPairs(args).some((h) => h.name === 'authorization' && /^basic\s/i.test(h.value));
  const wrong_auth_field = [...names].some((n) => OFFICIAL_FORMS.wrong_credential_names.includes(n)) || basicHeader;
  return { form, auth_correct, wrong_auth_field };
}
/** { parsed, points_official, form, auth_correct, wrong_auth_field } for one artifact (or none). */
export function judgeArtifact(artifact) {
  if (!isPlain(artifact) || !isPlain(artifact.mcpServers)) return { parsed: false, points_official: false, form: null, auth_correct: false, wrong_auth_field: false };
  const entries = Object.values(artifact.mcpServers).map(judgeEntry);
  const official = entries.filter((e) => e.form);
  if (!official.length) return { parsed: true, points_official: false, form: null, auth_correct: false, wrong_auth_field: entries.some((e) => e.wrong_auth_field) };
  return { parsed: true, points_official: true, form: official.map((e) => e.form).sort()[0], auth_correct: official.some((e) => e.auth_correct), wrong_auth_field: official.some((e) => e.wrong_auth_field) };
}

/* ---------- the judgement ---------- */
/** sealedKey = 'host/owner/repo'. traces from tracesX(); art from extractArtifact(). */
export function judgeNaturalTask({ traces, art, sealedKey }) {
  const resolves = (u) => typeof u === 'string' && sourceRepoKey(u) === sealedKey;
  const fetchedSealed = traces.fetched_readable && traces.fetched.some((f) => resolves(f.url));
  const citedSealed = traces.cited_readable && traces.cited.some(resolves);
  const candidateOnly = !fetchedSealed && !citedSealed && traces.candidates.some(resolves);
  const aj = art.state === 'one' ? judgeArtifact(art.artifact) : { parsed: false, points_official: false, form: null, auth_correct: false, wrong_auth_field: false };
  const discovered = fetchedSealed || citedSealed;
  const checks = [
    { label: 'response_shape_as_documented', ok: traces.shape_ok },
    { label: 'tools_used', ok: traces.tools_used },
    { label: 'trace_fetched_readable', ok: traces.fetched_readable },
    { label: 'trace_cited_readable', ok: traces.cited_readable },
    { label: 'fetched_sealed_repo', ok: fetchedSealed },
    { label: 'cited_sealed_repo', ok: citedSealed },
    { label: 'candidate_only_sealed', ok: candidateOnly },
    { label: 'artifact_single', ok: art.state === 'one' },
    { label: 'artifact_parsed', ok: aj.parsed },
    { label: 'artifact_points_official', ok: aj.points_official },
    { label: 'artifact_auth_correct', ok: aj.auth_correct },
    { label: 'artifact_wrong_auth_field', ok: aj.wrong_auth_field },
    { label: 'reached_without_trace', ok: !discovered && traces.shape_ok && traces.tools_used && aj.points_official },
  ];
  const out = (reached, stopped, { pass = false, fc = false, und = false, instrument = null } = {}) => ({ reached, stopped, pass, falseCompletion: fc, undetermined: und, instrument, checks, artifact_form: aj.form });
  if (!traces.shape_ok) return out('discover', 'discover', { instrument: 'other' });
  if (!traces.tools_used) return out('discover', 'discover', { und: true });
  if (discovered) {
    if (aj.points_official && aj.auth_correct && !aj.wrong_auth_field) return out('done', null, { pass: true });
    if (aj.points_official && aj.wrong_auth_field) return out('understand', 'understand', { fc: true });
    if (aj.points_official) return out('understand', 'understand', { und: true });
    if (aj.parsed) return out('understand', 'understand', { fc: true });
    return out('understand', 'understand', { und: true });
  }
  if (aj.parsed && (!aj.points_official || aj.wrong_auth_field)) return out('discover', 'discover', { fc: true });
  return out('discover', 'discover', { und: true });
}
