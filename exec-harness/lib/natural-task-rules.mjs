/**
 * Rules for kind_of_truth = natural_task (M-006) — the natural-task reading, judged from two CLOSED
 * traces only (founder-ops/research/Marker-M004_2026-09-25/PROPOSAL-M004-natural-task_2026-09-29.md
 * §3, §4, §10; Michie's decisions of 2026-09-29/30 and 2026-10-02). Pure functions, no I/O. Never grades free text.
 *
 * TWO CONFIGURATIONS (2026-10-02, after Codex review of 79e624d): OpenAI Responses (web_search) and
 * Anthropic Messages (web_search_20250305 + web_fetch_20250910). Perplexity and Claude Code are not
 * measured (taskpack not_measured); their readers are gone from this module (git history keeps them).
 *
 * THE SHAPE TABLE (SHAPES, below) is the only description of what is read. A response is checked against it
 * by one generic function (checkShape) BEFORE anything is read, and the readers then walk the VIEW the
 * checker returns — a copy that holds only the fields the table declares — so no code can read a field the
 * table does not name. The table was written from the providers' documentation, copied with the date it
 * was read in docs/provider-shapes/ (openai-responses-web-search.md, anthropic-messages-web-tools.md).
 *   - every item of a list the table walks is an object with a string `type`;
 *   - an item of a type the table knows is checked field by field (required fields present, every
 *     declared field of the declared type, enumerated values only);
 *   - an item of a type the table does not know, when it is a well-formed typed object, is skipped and only
 *     its type name is kept (private);
 *   - anything else anywhere → the whole response is refused: instrument "other", no partial trace.
 * A missing field is "not there", never "empty": a field the table marks required must be present (a
 * nullable field must be present with null). The top level is in the table too (Codex 79e624d N2 / N4):
 *   OpenAI   status = "completed", error absent or null, output an array.
 *   Anthropic every turn's content an array and its stop_reason documented; every turn but the last is
 *            pause_turn; the last ends the turn (end_turn / max_tokens / stop_sequence) — a last pause_turn
 *            (continuations exhausted) is instrument "budget". The caller hands over EVERY turn as it came
 *            (raw.turns) and nothing is concatenated before the check.
 *
 * TRACE (discover): URLs from the declared fields only, each handed whole to sourceRepoKey.
 *   candidates  search results (seen, not opened)                         → recorded, never counted
 *   fetched     URLs the model asked to open (the REQUEST is the reaching) → counted
 *   cited       URLs the provider's structured citation field names       → counted
 *               OpenAI output_text.annotations[url_citation].url; Anthropic text.citations[web_search_result_location].url.
 *               A text block without its citation field has no citations of its own; the valid citations of
 *               the other blocks stay (Codex 79e624d P2).
 * ARTIFACT (understand): exactly one strict-JSON object with a top-level mcpServers object (fenced block).
 *   Each entry is read by the README's two forms as a GRAMMAR, by position (Codex 79e624d N1):
 *     P2  command is exactly node (a path to it, node.exe) and the script — the first argument that is not
 *         an option — ends with aw-app/dist/custom/admin/server.js.
 *     P3  command is exactly npx (a path to it, npx.cmd); with the options -y / --yes left out, the first
 *         argument is exactly mcp-remote (or mcp-remote@<version>) and the next one is an http(s) URL whose
 *         path ends with /mcp.
 *   Three values per entry: official (the grammar holds) / other (no official marker anywhere in the entry:
 *   neither the P2 path nor the package name) / unclear (a marker is there but the grammar does not hold:
 *   `echo <path>`, `node other.js <path>`, `npx other mcp-remote …`). Unclear is never a false completion:
 *   only the passing side is strict.
 *   auth_correct     the official credential slots IN THEIR OWN PLACE: P2 = the entry's env itself has
 *                    ACCESS_TOKEN and SYSTEM_URL; P3 = the --header arguments or the query of THE mcp-remote
 *                    URL itself have x-access-token and x-system-url.
 *   wrong_auth_field a Basic / API-key style credential anywhere in that entry (names in env / headers /
 *                    the query of any URL argument; Authorization whose value starts with Basic, anywhere).
 * JUDGEMENT (exactly one of pass / false_completion / undetermined / instrument):
 *   refused response → instrument other; continuations exhausted → instrument budget; no tool call → undetermined.
 *   discovered (fetched or cited resolves to the sealed repo):
 *     official + auth correct + no wrong field → done | official + wrong field → understand fc |
 *     official, no slots → understand und | unclear → understand und | other → understand fc | none → understand und
 *   not discovered: other or (official + wrong field) → discover fc | otherwise → discover und
 */
import { sourceRepoKey } from './repo-key.mjs';
import { scanStrictJson } from './attribution-attest.mjs'; // the strict RFC 8259 scanner (pure; node built-ins only)

export const METHOD = 'natural_task_traces_vs_sealed_repo';

/* ---------- the two official forms (README of the sealed repository, read 2026-09-29; quoted in docs/provider-shapes/agileworks-readme-forms.md) ---------- */
export const OFFICIAL_FORMS = Object.freeze({
  P2: Object.freeze({ commands: Object.freeze(['node', 'node.exe']), entry_path_suffix: 'aw-app/dist/custom/admin/server.js', env_keys: Object.freeze(['ACCESS_TOKEN', 'SYSTEM_URL']) }),
  P3: Object.freeze({ commands: Object.freeze(['npx', 'npx.cmd']), skip_options: Object.freeze(['-y', '--yes']), package: 'mcp-remote', url_path_suffix: '/mcp', header_names: Object.freeze(['x-access-token', 'x-system-url']) }),
  wrong_credential_names: Object.freeze(['user', 'username', 'password', 'passwd', 'pass', 'basic', 'api_key', 'apikey', 'x_api_key', 'authorization_basic']),
});

/* ---------- the shape table ----------
 * A spec is { t, opt?, nullable?, enum?, fields?, items?, union? }:
 *   t        'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'
 *   opt      the field may be absent (absent ≠ null: a present field must have the declared type)
 *   nullable the field may be null (it must still be present unless opt)
 *   enum     allowed values
 *   fields   (object) declared fields; only these are copied to the view
 *   items    (array) the spec of every item
 *   union    (object) { cases: { <type>: spec } } — the object must have a string `type`; a known type is
 *            checked by its spec; an unknown one is skipped (its name recorded) when it is a typed object
 */
const str = (o = {}) => ({ t: 'string', ...o });
const num = (o = {}) => ({ t: 'number', ...o });
const arr = (items, o = {}) => ({ t: 'array', items, ...o });
const obj = (fields, o = {}) => ({ t: 'object', fields, ...o });
const union = (cases, o = {}) => ({ t: 'object', union: { cases }, ...o });

export const SHAPES = Object.freeze({
  openai: {
    // Response object (developers.openai.com/api/reference/resources/responses — read 2026-10-02)
    top: obj({
      status: str({ enum: ['completed'] }),
      error: { t: 'object', opt: true, nullable: true, enum: [null] }, // absent or null; an error object refuses the response (N4)
      output: arr(union({
        web_search_call: obj({
          id: str(),
          status: str({ enum: ['completed', 'failed', 'incomplete', 'searching', 'in_progress'] }),
          action: union({
            search: obj({ query: str({ opt: true }), queries: arr(str(), { opt: true }), sources: arr(union({ url: obj({ url: str() }) }), { opt: true }) }),
            open_page: obj({ url: str({ nullable: true }) }), // documented url?: string | null — the key is required here (N3), null allowed
            find_in_page: obj({ url: str(), pattern: str() }),
          }),
        }),
        message: obj({
          role: str({ enum: ['assistant'] }),
          content: arr(union({
            output_text: obj({ text: str(), annotations: arr(union({ url_citation: obj({ url: str(), start_index: num(), end_index: num() }) }), { opt: true }) }),
            refusal: obj({ refusal: str() }),
          })),
        }),
      })),
    }),
  },
  anthropic: {
    // one Messages API response (platform.claude.com/docs …/web-search-tool, …/web-fetch-tool — read 2026-10-02)
    turn: obj({
      stop_reason: str({ enum: ['end_turn', 'max_tokens', 'stop_sequence', 'pause_turn'] }),
      content: arr(union({
        text: obj({ text: str(), citations: arr(union({ web_search_result_location: obj({ url: str(), cited_text: str() }) }), { opt: true, nullable: true }) }),
        server_tool_use: obj({ id: str(), name: str({ enum: ['web_search', 'web_fetch'] }), input: { t: 'object', fields: { query: str({ opt: true }), url: str({ opt: true }) } } }),
        web_search_tool_result: obj({ tool_use_id: str(), content: { t: 'any' } }), // a list of results OR one error object (checked below by WEB_SEARCH_CONTENT)
        web_fetch_tool_result: obj({ tool_use_id: str(), content: union({ web_fetch_result: obj({ url: str() }), web_fetch_tool_result_error: obj({ error_code: str() }) }) }),
      })),
    }),
  },
});
// web_search_tool_result.content is one of two documented shapes
export const WEB_SEARCH_CONTENT = Object.freeze({
  list: arr(union({ web_search_result: obj({ url: str(), title: str() }) })),
  error: union({ web_search_tool_result_error: obj({ error_code: str() }) }),
});
const ANTHROPIC_LAST = new Set(['end_turn', 'max_tokens', 'stop_sequence']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
class ShapeError extends Error {}
const refuse = (path) => { throw new ShapeError(path); };

/**
 * The one checker. Returns the VIEW of `value` (only declared fields, recursively). Throws ShapeError on any
 * violation. `unknown` collects the names of skipped unknown types.
 */
export function checkShape(value, spec, unknown = [], path = '$') {
  if (value === null) { if (spec.nullable || (spec.enum && spec.enum.includes(null))) return null; refuse(path); }
  if (spec.enum && !spec.enum.includes(value)) refuse(path);
  if (spec.t === 'any') return value;
  if (typeOf(value) !== spec.t) refuse(path);
  if (spec.t === 'array') return value.map((x, i) => checkShape(x, spec.items, unknown, `${path}[${i}]`));
  if (spec.t !== 'object') return value;
  let fields = spec.fields;
  if (spec.union) {
    if (!isStr(value.type)) refuse(`${path}.type`);
    const c = spec.union.cases[value.type];
    if (!c) { const n = String(value.type).slice(0, 80); if (!unknown.includes(n)) unknown.push(n); return { type: value.type, __unknown: true }; }
    const view = checkShape(value, c, unknown, path);
    return { type: value.type, ...view };
  }
  const view = {};
  for (const [k, s] of Object.entries(fields || {})) {
    if (!Object.hasOwn(value, k)) { if (s.opt) continue; refuse(`${path}.${k}`); }
    view[k] = checkShape(value[k], s, unknown, `${path}.${k}`);
  }
  return view;
}

/* ---------- traces per configuration ---------- */
const emptyTrace = (over = {}) => ({ shape_ok: true, instrument: null, tools_used: false, candidates: [], fetched: [], fetched_readable: true, cited: [], cited_readable: true, text: '', unknown_types: [], ...over });
const refused = (instrument = 'other') => emptyTrace({ shape_ok: instrument !== 'other', instrument });
const urlStr = (u) => (isStr(u) && u.trim() ? u.trim() : null);

/** OpenAI Responses API (web_search; include web_search_call.action.sources). raw = the response object. */
export function tracesOpenAI(raw) {
  const unknown = [];
  let v; try { v = checkShape(raw, SHAPES.openai.top, unknown); } catch { return refused(); }
  const t = emptyTrace({ unknown_types: unknown });
  let citationFields = 0;
  for (const item of v.output) {
    if (item.__unknown) continue;
    if (item.type === 'web_search_call') {
      t.tools_used = true;
      const a = item.action;
      if (a.__unknown) continue;
      if (a.type === 'search') for (const s of a.sources ?? []) { if (!s.__unknown) { const u = urlStr(s.url); if (u) t.candidates.push(u); } }
      if (a.type === 'open_page' || a.type === 'find_in_page') t.fetched.push({ url: urlStr(a.url), ok: item.status === 'completed' });
    }
    if (item.type === 'message') for (const c of item.content) {
      if (c.__unknown || c.type !== 'output_text') continue;
      t.text += (t.text ? '\n' : '') + c.text;
      if (c.annotations === undefined) continue; // this block cites nothing of its own (P2: the other blocks' citations stay)
      citationFields++;
      for (const an of c.annotations) if (!an.__unknown && an.type === 'url_citation') { const u = urlStr(an.url); if (u) t.cited.push(u); }
    }
  }
  t.cited_readable = citationFields > 0;
  return t;
}

/** Anthropic Messages API. raw = { turns: [response, …] } exactly as received; each turn is checked before it is used. */
export function tracesAnthropic(raw) {
  if (!isPlain(raw) || !Array.isArray(raw.turns) || raw.turns.length === 0) return refused();
  const unknown = [];
  let turns;
  try { turns = raw.turns.map((d, i) => checkShape(d, SHAPES.anthropic.turn, unknown, `$.turns[${i}]`)); } catch { return refused(); }
  for (let i = 0; i < turns.length - 1; i++) if (turns[i].stop_reason !== 'pause_turn') return refused();
  const last = turns[turns.length - 1].stop_reason;
  if (last === 'pause_turn') return refused('budget'); // continuations exhausted: the run did not end
  if (!ANTHROPIC_LAST.has(last)) return refused();
  const t = emptyTrace({ unknown_types: unknown });
  const requests = new Map();
  let citationFields = 0;
  try {
    for (const b of turns.flatMap((x) => x.content)) {
      if (b.__unknown) continue;
      if (b.type === 'server_tool_use') {
        t.tools_used = true;
        if (requests.has(b.id)) refuse('duplicate id');
        if (b.name === 'web_search') { if (!isStr(b.input.query)) refuse('web_search input.query'); requests.set(b.id, { name: 'web_search' }); }
        if (b.name === 'web_fetch') {
          if (!isStr(b.input.url)) refuse('web_fetch input.url');
          const entry = { url: urlStr(b.input.url), ok: false }; // the request is the reaching, with or without a result block
          requests.set(b.id, { name: 'web_fetch', entry }); t.fetched.push(entry);
        }
      }
      if (b.type === 'web_search_tool_result') {
        const req = requests.get(b.tool_use_id); if (!req || req.name !== 'web_search') refuse('search result without its request');
        t.tools_used = true;
        let list = null;
        try { list = checkShape(b.content, WEB_SEARCH_CONTENT.list, unknown); } catch { checkShape(b.content, WEB_SEARCH_CONTENT.error, unknown); }
        for (const r of list ?? []) if (!r.__unknown) { const u = urlStr(r.url); if (u) t.candidates.push(u); }
      }
      if (b.type === 'web_fetch_tool_result') {
        const req = requests.get(b.tool_use_id); if (!req || req.name !== 'web_fetch') refuse('fetch result without its request');
        if (b.content.__unknown) refuse('unknown fetch result');
        if (b.content.type === 'web_fetch_result') { req.entry.ok = true; const u = urlStr(b.content.url); if (u && u !== req.entry.url) t.fetched.push({ url: u, ok: true }); }
      }
      if (b.type === 'text') {
        t.text += (t.text ? '\n' : '') + b.text;
        if (b.citations === undefined || b.citations === null) continue;
        citationFields++;
        for (const c of b.citations) if (!c.__unknown) { const u = urlStr(c.url); if (u) t.cited.push(u); }
      }
    }
  } catch { return refused(); }
  t.cited_readable = citationFields > 0;
  return t;
}

export const TRACE_READERS = Object.freeze({ tracesOpenAI, tracesAnthropic });

/* ---------- the artifact ---------- */
const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isPlain(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
function parseArtifactCandidate(text) {
  // strict JSON only: a block with a key written twice is not an artifact (the first value would be hidden)
  if (typeof text !== 'string' || !scanStrictJson(text).ok) return null;
  let v; try { v = JSON.parse(text); } catch { return null; }
  return isPlain(v) && isPlain(v.mcpServers) ? v : null;
}
/** { state: 'none' | 'one' | 'many', artifact, sources } from the answer text's fenced blocks (and files, for a configuration that writes them). */
export function extractArtifact({ text = '', files = [] } = {}) {
  const found = new Map();
  for (const m of String(text).matchAll(FENCE)) { const a = parseArtifactCandidate(m[1]); if (a) found.set(canonical(a), { artifact: a, source: 'fenced_block' }); }
  for (const f of files) { const a = parseArtifactCandidate(f?.content ?? ''); if (a) found.set(canonical(a), { artifact: a, source: `file:${f.name || '?'}` }); }
  if (found.size === 0) return { state: 'none', artifact: null, sources: [] };
  if (found.size > 1) return { state: 'many', artifact: null, sources: [...found.values()].map((x) => x.source) };
  const [only] = found.values();
  return { state: 'one', artifact: only.artifact, sources: [only.source] };
}

const normName = (s) => String(s).trim().toLowerCase().replace(/-/g, '_');
const normPath = (s) => String(s).replace(/\\/g, '/').toLowerCase();
const baseName = (s) => normPath(s).split('/').pop();
const isOption = (a) => a.startsWith('-');
function headerPairs(args) {
  const out = [];
  for (let i = 0; i + 1 < args.length; i++) if (args[i] === '--header' && isStr(args[i + 1])) { const j = args[i + 1].indexOf(':'); if (j > 0) out.push({ name: args[i + 1].slice(0, j).trim(), value: args[i + 1].slice(j + 1).trim() }); }
  return out;
}
function queryPairs(url) {
  try { return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value })); } catch { return []; }
}
const isHttpUrl = (a) => /^https?:\/\/\S+$/.test(a);
const urlPathEndsMcp = (a) => { try { return new URL(a).pathname.replace(/\/+$/, '').endsWith(OFFICIAL_FORMS.P3.url_path_suffix); } catch { return false; } };
const isPackage = (a) => a === OFFICIAL_FORMS.P3.package || a.startsWith(`${OFFICIAL_FORMS.P3.package}@`);
const startsBasic = (v) => isStr(v) && /^\s*basic(\s|$)/i.test(v);

/** The form of one entry, by position: { form: 'P2' | 'P3' | null, state: 'official' | 'unclear' | 'other', remoteUrl } */
export function entryForm(entry) {
  if (!isPlain(entry)) return { form: null, state: 'other', remoteUrl: null };
  const wellFormed = isStr(entry.command) && (entry.args === undefined || (Array.isArray(entry.args) && entry.args.every(isStr))) && (entry.env === undefined || (isPlain(entry.env) && Object.values(entry.env).every(isStr)));
  const strings = [entry.command, ...(Array.isArray(entry.args) ? entry.args : []), ...(isPlain(entry.env) ? Object.values(entry.env) : [])].filter(isStr);
  const marked = strings.some((s) => normPath(s).includes(OFFICIAL_FORMS.P2.entry_path_suffix) || s.includes(OFFICIAL_FORMS.P3.package));
  if (!wellFormed) return { form: null, state: marked ? 'unclear' : 'other', remoteUrl: null };
  const cmd = baseName(entry.command);
  const args = entry.args ?? [];
  if (OFFICIAL_FORMS.P2.commands.includes(cmd)) {
    // the script = the first argument that is not an option; an option before it must not be one that runs or loads other code
    const i = args.findIndex((x) => !isOption(x));
    const before = i < 0 ? [] : args.slice(0, i);
    const RUNS_OTHER_CODE = ['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--loader', '--experimental-loader'];
    if (i >= 0 && normPath(args[i]).endsWith(OFFICIAL_FORMS.P2.entry_path_suffix) && before.every((x) => !RUNS_OTHER_CODE.includes(x.split('=')[0]))) return { form: 'P2', state: 'official', remoteUrl: null };
  }
  if (OFFICIAL_FORMS.P3.commands.includes(cmd)) {
    const rest = args.filter((a) => !OFFICIAL_FORMS.P3.skip_options.includes(a));
    if (rest.length >= 2 && isPackage(rest[0]) && isHttpUrl(rest[1]) && urlPathEndsMcp(rest[1])) return { form: 'P3', state: 'official', remoteUrl: rest[1] };
  }
  return { form: null, state: marked ? 'unclear' : 'other', remoteUrl: null };
}

function judgeEntry(entry) {
  const f = entryForm(entry);
  if (!isPlain(entry)) return { ...f, auth_correct: false, wrong_auth_field: false };
  const args = Array.isArray(entry.args) ? entry.args.filter(isStr) : [];
  const env = isPlain(entry.env) ? Object.entries(entry.env).map(([name, value]) => ({ name, value })) : [];
  const headers = headerPairs(args);
  const remoteQuery = f.remoteUrl ? queryPairs(f.remoteUrl) : [];
  const query = args.filter(isHttpUrl).flatMap(queryPairs);
  // a slot is filled only by a non-empty string (an empty value is not a credential: only the passing side is strict)
  const filled = (v) => isStr(v) && v.trim() !== '';
  const envHas = (k) => env.some((e) => e.name === k && filled(e.value));
  const slotHas = (h) => headers.some((x) => x.name.toLowerCase() === h && filled(x.value)) || remoteQuery.some((x) => x.name === h && filled(x.value));
  const auth_correct = f.form === 'P2' ? OFFICIAL_FORMS.P2.env_keys.every(envHas) : f.form === 'P3' ? OFFICIAL_FORMS.P3.header_names.every(slotHas) : false;
  const envValue = (name) => env.find((e) => e.name === name && isStr(e.value))?.value;
  const resolved = (v) => (isStr(v) ? v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => envValue(n) ?? m) : v);
  const places = [...env, ...headers.map((h) => ({ name: h.name, value: resolved(h.value) })), ...query];
  const wrongName = places.some((p) => OFFICIAL_FORMS.wrong_credential_names.includes(normName(p.name)));
  const basic = places.some((p) => normName(p.name) === 'authorization' && startsBasic(p.value));
  return { ...f, auth_correct, wrong_auth_field: wrongName || basic };
}
/** { parsed, points_official, points_unclear, form, auth_correct, wrong_auth_field } for one artifact (or none). */
export function judgeArtifact(artifact) {
  const none = { parsed: false, points_official: false, points_unclear: false, form: null, auth_correct: false, wrong_auth_field: false };
  if (!isPlain(artifact) || !isPlain(artifact.mcpServers)) return none;
  const entries = Object.values(artifact.mcpServers).map(judgeEntry);
  const official = entries.filter((e) => e.state === 'official');
  if (official.length) return { parsed: true, points_official: true, points_unclear: false, form: official[0].form, auth_correct: official.some((e) => e.auth_correct), wrong_auth_field: official.some((e) => e.wrong_auth_field) };
  const unclear = entries.some((e) => e.state === 'unclear');
  return { parsed: true, points_official: false, points_unclear: unclear, form: null, auth_correct: false, wrong_auth_field: !unclear && entries.some((e) => e.wrong_auth_field) };
}

/* ---------- the judgement ---------- */
/** sealedKey = 'host/owner/repo'. traces from tracesX(); art from extractArtifact(). */
export function judgeNaturalTask({ traces, art, sealedKey }) {
  const readable = traces.shape_ok && !traces.instrument;
  const resolves = (u) => isStr(u) && sourceRepoKey(u) === sealedKey;
  const fetchedSealed = readable && traces.fetched_readable && traces.fetched.some((f) => resolves(f.url));
  const citedSealed = readable && traces.cited_readable && traces.cited.some(resolves);
  const candidateOnly = readable && !fetchedSealed && !citedSealed && traces.candidates.some(resolves);
  const none = { parsed: false, points_official: false, points_unclear: false, form: null, auth_correct: false, wrong_auth_field: false };
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
    { label: 'artifact_form_unclear', ok: aj.points_unclear },
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
    if (aj.points_official || aj.points_unclear) return out('understand', 'understand', { und: true });
    if (aj.parsed) return out('understand', 'understand', { fc: true });
    return out('understand', 'understand', { und: true });
  }
  if (aj.parsed && !aj.points_unclear && (!aj.points_official || aj.wrong_auth_field)) return out('discover', 'discover', { fc: true });
  return out('discover', 'discover', { und: true });
}
