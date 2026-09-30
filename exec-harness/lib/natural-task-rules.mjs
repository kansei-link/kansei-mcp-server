/**
 * Rules for kind_of_truth = natural_task (M-006) — the natural-task reading, judged from two CLOSED
 * traces only (founder-ops/research/Marker-M004_2026-09-25/PROPOSAL-M004-natural-task_2026-09-29.md
 * §3, §4, §10; Michie's decisions of 2026-09-29/30). Pure functions, no I/O. Never grades free text.
 *
 * CLOSED SHAPE FIRST (Codex review of fe0d132, Michie 2026-09-30): a response is checked against the shape
 * it is documented to have BEFORE anything is read from it. Every item of output[] / content[] / the event
 * list must be an object with a string `type`; every item of a type this module reads must carry its
 * required fields with the right types. Anything else → shape_ok=false → instrument "other" (never an
 * "undetermined" of the subject). A missing field is "not there", never "empty". An item of a type this
 * module does not know, when well-formed, is skipped and only its type name is kept (private).
 *
 * TRACE (discover): the URLs a configuration leaves in STRUCTURED fields, each handed whole to
 * sourceRepoKey — never found by scanning a page or an answer. No part of this module reads free text.
 *   candidates  URLs that appeared in search results (seen, not opened)      → recorded, never counted
 *   fetched     URLs the model asked to open (the REQUEST is the reaching;   → counted
 *               whether the fetch succeeded is kept beside it as `ok`; a request whose result never
 *               came is still a request)
 *   cited       URLs the final answer cites, from the provider's structured    → counted
 *               citation field only: OpenAI output_text.annotations[url_citation].url, Anthropic
 *               text.citations[web_search_result_location].url, Perplexity output_text.annotations
 *               [url_citation].url (the field the Agent API reference documents). The [n] markers of a
 *               Perplexity answer are NOT read (removed 2026-09-30: no part reads free text).
 *   Each field is either readable or "no trace" (readable=false: Claude Code has no structured
 *   citations; an output_text without an annotations array has none either); a field that is not
 *   readable decides nothing.
 * ARTIFACT (understand): the configuration file the answer produced — a fenced code block or a file
 * in the work directory that is strict JSON (RFC 8259, no key twice in one object: JSON.parse would keep
 * the last and hide the first) and an object with a top-level `mcpServers` object.
 * Exactly one distinct artifact is judged; none or several → undetermined. Free text is never read.
 * An mcpServers entry is read only when it is well-formed (command a string; args, when there, an array of
 * strings; env, when there, an object of strings); otherwise it is not one of the official forms.
 *   points_official  some mcpServers entry has one of the two forms of the official README
 *                    (OFFICIAL_FORMS: P2 local entry path, P3 mcp-remote to <own host>/mcp). No package
 *                    name exists on npm, so package names are never used.
 *   auth_correct     the official credential slots IN THEIR OWN PLACE: P2 = the entry's env itself has
 *                    ACCESS_TOKEN and SYSTEM_URL; P3 = the entry's --header arguments or the URL's query
 *                    themselves have x-access-token and x-system-url. A name in another place does not count.
 *   wrong_auth_field a Basic / API-key style credential anywhere in that entry: an env key, a --header
 *                    name or a query name of the URL among wrong_credential_names; or Authorization
 *                    (any case) whose value starts with Basic — in env, in a header (also through
 *                    ${VAR} taken from the entry's env) or in the query.
 * JUDGEMENT (exactly one of pass / false_completion / undetermined / instrument):
 *   response shape not as documented                       → instrument "other"
 *   the agent run itself failed (Claude Code result)        → instrument "provider_api" / "budget"
 *   no tool call at all                                    → discover, undetermined (tools_used=false)
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
 */
import { sourceRepoKey } from './repo-key.mjs';
import { scanStrictJson } from './attribution-attest.mjs'; // the strict RFC 8259 scanner (pure; node built-ins only)

export const METHOD = 'natural_task_traces_vs_sealed_repo';

/* ---------- the two official forms (README of the sealed repository, read 2026-09-29) ---------- */
export const OFFICIAL_FORMS = Object.freeze({
  P2: Object.freeze({ entry_path_suffix: 'aw-app/dist/custom/admin/server.js', env_keys: Object.freeze(['ACCESS_TOKEN', 'SYSTEM_URL']) }),
  P3: Object.freeze({ command: 'npx', package: 'mcp-remote', url_path_suffix: '/mcp', header_names: Object.freeze(['x-access-token', 'x-system-url']) }),
  wrong_credential_names: Object.freeze(['user', 'username', 'password', 'passwd', 'pass', 'basic', 'api_key', 'apikey', 'x_api_key', 'authorization_basic']),
});

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isPlain(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
const normName = (s) => String(s).trim().toLowerCase().replace(/-/g, '_');
const urlStr = (u) => (typeof u === 'string' && u.trim() ? u.trim() : null);

/* ---------- traces per configuration ---------- */
const emptyTrace = (over = {}) => ({ shape_ok: true, instrument: null, tools_used: false, candidates: [], fetched: [], fetched_readable: true, cited: [], cited_readable: true, text: '', unknown_types: [], ...over });
class ShapeError extends Error {}
/** need(condition): the response is not shaped as documented → the whole response is refused. */
const need = (ok) => { if (!ok) throw new ShapeError(); };
/** an item of a list this module walks: an object with a string `type` */
const typed = (x) => isPlain(x) && isStr(x.type);
const unknown = (t, name) => { const n = String(name).slice(0, 80); if (!t.unknown_types.includes(n)) t.unknown_types.push(n); };
/** Run a reader; a ShapeError (or anything unexpected) gives the refused trace, never a partial one. */
function closed(read, over = {}) {
  try { return read(); } catch { return emptyTrace({ shape_ok: false, instrument: 'other', ...over }); }
}
/** output_text: text is a string; annotations, when there, is an array of typed items; url_citation has a string url. */
function readOutputText(t, c, seen) {
  need(isStr(c.text));
  t.text += (t.text ? '\n' : '') + c.text;
  if (c.annotations === undefined) { seen.without++; return; } // no annotations array: this text has no citation trace
  need(Array.isArray(c.annotations));
  seen.with++;
  for (const an of c.annotations) {
    need(typed(an));
    if (an.type === 'url_citation') { need(isStr(an.url)); const u = urlStr(an.url); if (u) t.cited.push(u); } else unknown(t, `annotation:${an.type}`);
  }
}

/** OpenAI Responses API (web_search; include web_search_call.action.sources). */
export function tracesOpenAI(resp) {
  return closed(() => {
    need(isPlain(resp) && Array.isArray(resp.output));
    const t = emptyTrace(); const seen = { with: 0, without: 0 };
    for (const item of resp.output) {
      need(typed(item));
      if (item.type === 'web_search_call') {
        need(typed(item.action));
        t.tools_used = true;
        const a = item.action;
        if (a.type === 'search') {
          need(a.sources === undefined || Array.isArray(a.sources)); // present only with include=web_search_call.action.sources
          for (const s of a.sources ?? []) { need(typed(s)); if (s.type === 'url') { need(isStr(s.url)); const u = urlStr(s.url); if (u) t.candidates.push(u); } else unknown(t, `source:${s.type}`); }
        } else if (a.type === 'open_page' || a.type === 'find_in_page') {
          need(a.url === undefined || a.url === null || isStr(a.url)); // documented as nullable: a request whose URL was not given
          t.fetched.push({ url: urlStr(a.url), ok: true });
        } else unknown(t, `action:${a.type}`);
      } else if (item.type === 'message') {
        need(Array.isArray(item.content));
        for (const c of item.content) { need(typed(c)); if (c.type === 'output_text') readOutputText(t, c, seen); else unknown(t, `content:${c.type}`); }
      } else unknown(t, item.type);
    }
    t.cited_readable = seen.with > 0 && seen.without === 0;
    return t;
  });
}

/** Anthropic Messages API (web_search_20250305 + web_fetch_20250910); `content` = all blocks of the turn(s). */
export function tracesAnthropic(resp) {
  return closed(() => {
    const content = isPlain(resp) && Array.isArray(resp.content) ? resp.content : Array.isArray(resp) ? resp : null;
    need(content !== null);
    const t = emptyTrace();
    const requests = new Map(); // server_tool_use id of a web_fetch → its entry in t.fetched
    for (const b of content) {
      need(typed(b));
      if (b.type === 'server_tool_use') {
        need(isStr(b.id) && isStr(b.name) && isPlain(b.input));
        t.tools_used = true;
        if (b.name === 'web_fetch') {
          need(isStr(b.input.url) && !requests.has(b.id));
          const entry = { url: urlStr(b.input.url), ok: false }; // the request is the reaching, with or without a result block
          requests.set(b.id, entry); t.fetched.push(entry);
        } else if (b.name !== 'web_search') unknown(t, `server_tool_use:${b.name}`);
      } else if (b.type === 'web_search_tool_result') {
        need(isStr(b.tool_use_id));
        t.tools_used = true;
        if (Array.isArray(b.content)) for (const r of b.content) { need(typed(r)); if (r.type === 'web_search_result') { need(isStr(r.url)); const u = urlStr(r.url); if (u) t.candidates.push(u); } else unknown(t, `search_result:${r.type}`); }
        else need(typed(b.content)); // an error object
      } else if (b.type === 'web_fetch_tool_result') {
        need(isStr(b.tool_use_id) && typed(b.content) && requests.has(b.tool_use_id)); // a result answers a request of this response
        t.tools_used = true;
        if (b.content.type === 'web_fetch_result') {
          need(isStr(b.content.url));
          const entry = requests.get(b.tool_use_id); entry.ok = true;
          const u = urlStr(b.content.url); if (u && u !== entry.url) t.fetched.push({ url: u, ok: true }); // where the provider's server ended up
        } // otherwise an error object: the request stays, not ok
      } else if (b.type === 'text') {
        need(isStr(b.text) && (b.citations === undefined || b.citations === null || Array.isArray(b.citations)));
        t.text += (t.text ? '\n' : '') + b.text;
        for (const c of b.citations ?? []) { need(typed(c)); if (c.type === 'web_search_result_location') { need(isStr(c.url)); const u = urlStr(c.url); if (u) t.cited.push(u); } else unknown(t, `citation:${c.type}`); }
      } else unknown(t, b.type);
    }
    return t;
  });
}

/**
 * Perplexity Agent API (POST /v1/agent; tools web_search + fetch_url). Citations: only the documented
 * structured field, output_text.annotations[url_citation].url. The answer text is never read for markers.
 */
export function tracesPerplexity(resp) {
  return closed(() => {
    need(isPlain(resp) && Array.isArray(resp.output));
    const t = emptyTrace(); const seen = { with: 0, without: 0 };
    for (const item of resp.output) {
      need(typed(item));
      if (item.type === 'search_results') {
        need(Array.isArray(item.results));
        t.tools_used = true;
        for (const r of item.results) { need(isPlain(r) && isStr(r.url)); const u = urlStr(r.url); if (u) t.candidates.push(u); }
      } else if (item.type === 'fetch_url_results') {
        need(Array.isArray(item.contents));
        t.tools_used = true;
        for (const c of item.contents) {
          need(isPlain(c) && isStr(c.url) && (c.snippet === undefined || c.snippet === null || isStr(c.snippet)));
          const u = urlStr(c.url); if (u) t.fetched.push({ url: u, ok: isStr(c.snippet) && c.snippet.trim() !== '' && c.snippet.trim() !== 'no_result_returned' });
        }
      } else if (item.type === 'message') {
        need(Array.isArray(item.content));
        for (const c of item.content) { need(typed(c)); if (c.type === 'output_text') readOutputText(t, c, seen); else unknown(t, `content:${c.type}`); }
      } else unknown(t, item.type);
    }
    t.cited_readable = seen.with > 0 && seen.without === 0;
    return t;
  });
}

/**
 * Claude Code `-p --output-format stream-json --verbose`: events = parsed lines. No structured citations.
 * Checked first (Codex fe0d132 R3, R4): exactly one system/init, exactly one result, the result has
 * is_error (boolean) and subtype (string). A result that is not { is_error:false, subtype:"success" } is the
 * agent run failing — instrument "provider_api" ("budget" for the turn / budget limits) — and NOTHING of the
 * run is graded (no trace, no text; the caller does not grade the files left in the work directory either).
 */
const BUDGET_SUBTYPES = new Set(['error_max_turns', 'error_max_budget_usd']);
export function tracesClaudeCode(events) {
  const none = { cited_readable: false };
  return closed(() => {
    need(Array.isArray(events));
    const t = emptyTrace(none);
    const uses = new Map(); // tool_use id → { name, entry (WebFetch: its entry in t.fetched) }
    let inits = 0; const results = [];
    for (const e of events) {
      need(typed(e));
      if (e.type === 'system') { if (e.subtype === 'init') inits++; else unknown(t, `system:${isStr(e.subtype) ? e.subtype : '?'}`); }
      else if (e.type === 'assistant') {
        need(isPlain(e.message) && Array.isArray(e.message.content));
        for (const c of e.message.content) {
          need(typed(c));
          if (c.type !== 'tool_use') continue; // text / thinking blocks are not read
          need(isStr(c.id) && isStr(c.name) && isPlain(c.input));
          if (c.name === 'WebSearch') { need(!uses.has(c.id)); uses.set(c.id, { name: c.name, entry: null }); t.tools_used = true; }
          else if (c.name === 'WebFetch') {
            need(isStr(c.input.url) && !uses.has(c.id));
            const entry = { url: urlStr(c.input.url), ok: false }; // the request is the reaching, with or without a result line
            uses.set(c.id, { name: c.name, entry }); t.fetched.push(entry); t.tools_used = true;
          } else unknown(t, `tool_use:${c.name}`);
        }
      } else if (e.type === 'user') {
        need(isPlain(e.message) && (isStr(e.message.content) || Array.isArray(e.message.content)));
        const ids = [];
        for (const c of Array.isArray(e.message.content) ? e.message.content : []) { need(typed(c)); if (c.type === 'tool_result') { need(isStr(c.tool_use_id)); ids.push(c.tool_use_id); } }
        const use = ids.map((id) => uses.get(id)).find(Boolean);
        if (!use) continue;
        const r = e.tool_use_result;
        need(r === undefined || isStr(r) || isPlain(r)); // a string is the tool's error text
        if (!isPlain(r)) continue;
        if (use.name === 'WebSearch') {
          need(Array.isArray(r.results));
          for (const x of r.results) {
            need(isStr(x) || isPlain(x));
            if (!isPlain(x)) continue;
            need(Array.isArray(x.content));
            for (const c of x.content) { need(isPlain(c) && (c.url === undefined || isStr(c.url))); const u = urlStr(c.url); if (u) t.candidates.push(u); }
          }
        } else {
          need(typeof r.code === 'number' && typeof r.bytes === 'number' && (r.url === undefined || isStr(r.url)));
          use.entry.ok = r.code >= 200 && r.code < 300 && r.bytes > 0;
          const u = urlStr(r.url); if (u && u !== use.entry.url) t.fetched.push({ url: u, ok: use.entry.ok });
        }
      } else if (e.type === 'result') results.push(e);
      else unknown(t, e.type);
    }
    need(inits === 1 && results.length === 1);
    const res = results[0];
    need(typeof res.is_error === 'boolean' && isStr(res.subtype));
    if (res.is_error !== false || res.subtype !== 'success') return emptyTrace({ ...none, instrument: BUDGET_SUBTYPES.has(res.subtype) ? 'budget' : 'provider_api', unknown_types: t.unknown_types });
    need(isStr(res.result));
    t.text = res.result;
    return t;
  }, none);
}

export const TRACE_READERS = Object.freeze({ tracesOpenAI, tracesAnthropic, tracesPerplexity, tracesClaudeCode });

/* ---------- the artifact ---------- */
const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
function parseArtifactCandidate(text) {
  // strict JSON only: a block with a key written twice is not an artifact (the first value would be hidden)
  if (typeof text !== 'string' || !scanStrictJson(text).ok) return null;
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

/* Each place a credential can sit in one mcpServers entry, read separately (Codex fe0d132 R1, R2):
 *   env      the entry's env object: [key, value] (value kept only when it is a string)
 *   headers  the entry's --header arguments: "Name: value"
 *   query    the query of the mcp-remote URL: [name, value] */
function headerPairs(args) {
  const out = [];
  for (let i = 0; i + 1 < args.length; i++) if (args[i] === '--header' && typeof args[i + 1] === 'string') { const j = args[i + 1].indexOf(':'); if (j > 0) out.push({ name: args[i + 1].slice(0, j).trim(), value: args[i + 1].slice(j + 1).trim() }); }
  return out;
}
function queryPairs(url) {
  try { return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value })); } catch { return []; }
}
const startsBasic = (v) => isStr(v) && /^\s*basic(\s|$)/i.test(v);
function judgeEntry(entry) {
  if (!isPlain(entry)) return { form: null, auth_correct: false, wrong_auth_field: false };
  const args = Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === 'string') : [];
  const env = isPlain(entry.env) ? Object.entries(entry.env).map(([name, value]) => ({ name, value })) : [];
  const cmd = typeof entry.command === 'string' ? entry.command.replace(/\\/g, '/').split('/').pop().replace(/\.(cmd|exe)$/i, '').toLowerCase() : '';
  const headers = headerPairs(args);
  let form = null, remoteQuery = [];
  // an entry an MCP client could not start as written is not one of the official forms
  const wellFormed = isStr(entry.command) && (entry.args === undefined || (Array.isArray(entry.args) && entry.args.every(isStr))) && (entry.env === undefined || (isPlain(entry.env) && Object.values(entry.env).every(isStr)));
  if (!wellFormed) { /* form stays null */ }
  else if (args.some((a) => a.replace(/\\/g, '/').toLowerCase().endsWith(OFFICIAL_FORMS.P2.entry_path_suffix))) form = 'P2';
  else {
    const remoteUrl = args.find((a) => /^https?:\/\/\S+$/.test(a) && a.split(/[?#]/)[0].endsWith(OFFICIAL_FORMS.P3.url_path_suffix));
    const pkg = args.some((a) => a === OFFICIAL_FORMS.P3.package || a.startsWith(`${OFFICIAL_FORMS.P3.package}@`));
    if (cmd === OFFICIAL_FORMS.P3.command && pkg && remoteUrl) { form = 'P3'; remoteQuery = queryPairs(remoteUrl); }
  }
  // the query of every URL argument is a place a credential can sit, whatever the form
  const query = args.filter((a) => /^https?:\/\/\S+$/.test(a)).flatMap(queryPairs);
  // auth_correct: the official slots in their own place only — P2: the env itself (the README's exact names);
  // P3: the --header arguments (header names are case-insensitive) or the query of the mcp-remote URL itself
  const envHas = (k) => env.some((e) => e.name === k && isStr(e.value));
  const slotHas = (h) => headers.some((x) => x.name.toLowerCase() === h) || remoteQuery.some((x) => x.name === h);
  const auth_correct = form === 'P2' ? OFFICIAL_FORMS.P2.env_keys.every(envHas) : form === 'P3' ? OFFICIAL_FORMS.P3.header_names.every(slotHas) : false;
  // wrong_auth_field: every place of this entry — names, and Authorization: Basic wherever it is
  const envValue = (name) => env.find((e) => e.name === name && isStr(e.value))?.value;
  const resolved = (v) => (isStr(v) ? v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => envValue(n) ?? m) : v); // "Authorization:${AUTH_HEADER}" with the value in env
  const places = [...env, ...headers.map((h) => ({ name: h.name, value: resolved(h.value) })), ...query];
  const wrongName = places.some((p) => OFFICIAL_FORMS.wrong_credential_names.includes(normName(p.name)));
  const basic = places.some((p) => normName(p.name) === 'authorization' && startsBasic(p.value));
  return { form, auth_correct, wrong_auth_field: wrongName || basic };
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
  const readable = traces.shape_ok && !traces.instrument; // nothing is graded from a refused response or a failed run
  const resolves = (u) => typeof u === 'string' && sourceRepoKey(u) === sealedKey;
  const fetchedSealed = readable && traces.fetched_readable && traces.fetched.some((f) => resolves(f.url));
  const citedSealed = readable && traces.cited_readable && traces.cited.some(resolves);
  const candidateOnly = readable && !fetchedSealed && !citedSealed && traces.candidates.some(resolves);
  const none = { parsed: false, points_official: false, form: null, auth_correct: false, wrong_auth_field: false };
  const aj = readable && art.state === 'one' ? judgeArtifact(art.artifact) : none;
  const discovered = fetchedSealed || citedSealed;
  const checks = [
    { label: 'response_shape_as_documented', ok: traces.shape_ok },
    { label: 'agent_run_completed', ok: traces.shape_ok && !traces.instrument },
    { label: 'tools_used', ok: traces.tools_used },
    { label: 'trace_fetched_readable', ok: traces.fetched_readable },
    { label: 'trace_cited_readable', ok: traces.cited_readable },
    { label: 'fetched_sealed_repo', ok: fetchedSealed },
    { label: 'cited_sealed_repo', ok: citedSealed },
    { label: 'candidate_only_sealed', ok: candidateOnly },
    { label: 'artifact_single', ok: readable && art.state === 'one' },
    { label: 'artifact_parsed', ok: aj.parsed },
    { label: 'artifact_points_official', ok: aj.points_official },
    { label: 'artifact_auth_correct', ok: aj.auth_correct },
    { label: 'artifact_wrong_auth_field', ok: aj.wrong_auth_field },
    { label: 'reached_without_trace', ok: readable && !discovered && traces.tools_used && aj.points_official },
  ];
  const out = (reached, stopped, { pass = false, fc = false, und = false, instrument = null } = {}) => ({ reached, stopped, pass, falseCompletion: fc, undetermined: und, instrument, checks, artifact_form: aj.form });
  if (!traces.shape_ok) return out('discover', 'discover', { instrument: 'other' });
  if (traces.instrument) return out('discover', 'discover', { instrument: traces.instrument });
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
