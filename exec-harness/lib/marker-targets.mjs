/**
 * Target modules — the parts of run-marker that change with the subject.
 * Selected by taskpack `marker.kind_of_truth` (+ `marker.observation`):
 *
 *   kind_of_truth   observation           ground truth (harness)              observers
 *   http_probe      catalog_display       HTTP probe of sealed endpoints      kansei_harness reading the public catalog API   (M-002)
 *   http_probe      fetch_check_summary   HTTP fetch + body sha256            agents' own fetch results (fetch-check summary) (M-003)
 *   llm_answer      (implicit)            GitHub API: sealed repo exists      one public LLM per provider                     (M-004)
 *
 * Every module exposes the same four functions and the same judgement shape as
 * lib/marker-judge.mjs (reached/stopped/pass/checks/falseCompletion/instrument).
 * Judgement is rules only — no model grades a model. Values (URLs, bodies,
 * answer texts) stay in memory / transcript.jsonl; public files get booleans.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { askLlm } from './llm-ask.mjs';
import { AUTH_RULE, ANSWER_FORMAT, judgeLlmAnswer } from './llm-answer-rules.mjs';
// attribution-attest.mjs and attribution-rules.mjs (with the vendored HTML decoder behind it) are NOT
// imported here: they are loaded with dynamic imports inside llmAnswer.attribution only, so M-001 /
// M-002 / M-003 never depend on them (and the hint reader, attribution-rules.mjs, never decides a row).

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const DEAD = new Set(['gone', 'dns_fail', 'connection_refused']);

/** `${ENV:NAME}` in taskpack strings resolves from the environment (smoke tests point at local servers). */
export function resolveEnvRefs(value, env = process.env) {
  if (typeof value === 'string') return value.replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_, n) => env[n] ?? '');
  if (Array.isArray(value)) return value.map((v) => resolveEnvRefs(v, env));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnvRefs(v, env)]));
  return value;
}

/* ---------------- shared HTTP helpers ---------------- */
export async function probeMcpEndpoint(endpoint, timeoutMs = 6000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs); const t0 = Date.now();
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'kansei-marker-probe', version: '0.1' } } }), signal: c.signal, redirect: 'manual' });
    const cls = (r.status === 404 || r.status === 410) ? 'gone' : (r.ok || [400, 401, 403, 405].includes(r.status) || (r.status >= 300 && r.status < 400)) ? 'alive' : 'other';
    return { cls, http: r.status, ms: Date.now() - t0 };
  } catch (e) {
    const m = String(e?.cause?.code || e?.message || e);
    const cls = /ENOTFOUND|EAI_AGAIN/.test(m) ? 'dns_fail' : /ECONNREFUSED/.test(m) ? 'connection_refused' : /abort/i.test(m) ? 'timeout' : /CERT|certificate|SSL|TLS/i.test(m) ? 'ssl_error' : 'other';
    return { cls, http: null, ms: Date.now() - t0, err: m.slice(0, 80) };
  } finally { clearTimeout(t); }
}

export async function fetchBody(url, timeoutMs = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'kansei-marker-harness/0.4' }, signal: c.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, sha256: sha256(buf), bytes: buf.length, title: (buf.toString('utf8').match(/<title>([^<]*)<\/title>/i) || [])[1] || null };
  } catch (e) { return { status: null, sha256: null, bytes: 0, err: String(e?.message || e).slice(0, 80) }; }
  finally { clearTimeout(t); }
}

/** ④ Absence and display are two EXCLUSIVE shapes. Anything that mixes them, names another
 *  service, carries another error, or lacks a required display field is not an observation.
 *   absent  : exactly { code:'not_found', service_id:<id> }  OR  { error:"Service '<id>' not found…" } — no display fields
 *   display : service_id === id, non-empty mcp_status, freshness.confidence non-empty — no error/code fields
 *  Returns { kind: 'absent' | 'display' | 'invalid', error? }. */
export function classifyCatalogPayload(payload, serviceId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { kind: 'invalid', error: 'invalid_payload' };
  const keys = Object.keys(payload);
  const hasErrorField = 'error' in payload || 'code' in payload;
  const displayFields = ['mcp_status', 'freshness', 'trust_score', 'connection_guide', 'name', 'category'];
  const hasDisplayField = displayFields.some((k) => k in payload);
  const esc = String(serviceId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (hasErrorField) {
    if (hasDisplayField) return { kind: 'invalid', error: 'mixed_absence_and_display' };
    if ('service_id' in payload && payload.service_id !== serviceId) return { kind: 'invalid', error: 'absence_names_other_service' };
    const sameKeys = (allowed) => keys.length === allowed.length && allowed.every((k) => keys.includes(k));
    // structured absence: EXACTLY { code: "not_found", service_id: <requested id> } — service_id required
    const structured = sameKeys(['code', 'service_id']) && payload.code === 'not_found' && payload.service_id === serviceId;
    // known absence sentence: EXACTLY { error: "Service '<requested id>' not found…" }
    const knownText = sameKeys(['error']) && typeof payload.error === 'string' && new RegExp(`^Service '${esc}' not found\\b`).test(payload.error);
    if (structured || knownText) return { kind: 'absent' };
    return { kind: 'invalid', error: 'payload_error' };
  }
  if (payload.service_id !== serviceId) return { kind: 'invalid', error: 'payload_mismatch' };
  const incomplete = typeof payload.mcp_status !== 'string' || !payload.mcp_status.trim() || !payload.freshness || typeof payload.freshness !== 'object' || typeof payload.freshness.confidence !== 'string' || !payload.freshness.confidence.trim();
  if (incomplete) return { kind: 'invalid', error: 'incomplete_payload' };
  return { kind: 'display' };
}

/** Read one service's public display through the catalog MCP endpoint (tools/call lookup detail).
 *  opts.keepPayload (attribution column B only): also return, in memory, the parsed payload (for the private
 *  hint), payloadText = the item's ORIGINAL TEXT exactly as the tool result carried it (result.content[0].text,
 *  before JSON.parse — column B's fingerprint is made from this text, never from the parsed value) and
 *  contentBlocks = how many content blocks the tool result had, contentIsText = the first one's type is "text"
 *  (column B needs exactly one text block: a second block would be text nobody fingerprinted). Default off, so the M-002 observation and its transcript are unchanged. */
export async function readCatalogDisplay(apiUrl, serviceId, timeoutMs = 20000, opts = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lookup', arguments: { service_id: serviceId, detail: true } } }), signal: c.signal });
    const text = await r.text();
    if (!r.ok) return { reachable: false, valid: false, http: r.status, error: 'http_status' };
    // Closed observation: only a well-formed tool result is an observation. A JSON-RPC
    // error, a tool isError, an unparsable payload or a payload for another service is an
    // instrument failure — never "the service is not displayed".
    let rpc; try { const m = text.match(/^data: (.*)$/m); rpc = JSON.parse(m ? m[1] : text); } catch { return { reachable: true, valid: false, http: r.status, error: 'invalid_response' }; }
    if (rpc.error) return { reachable: true, valid: false, http: r.status, error: 'rpc_error' };
    if (rpc.result?.isError) return { reachable: true, valid: false, http: r.status, error: 'tool_error' };
    const payloadText = rpc.result?.content?.[0]?.text;
    let payload; try { payload = JSON.parse(payloadText ?? ''); } catch { return { reachable: true, valid: false, http: r.status, error: 'invalid_payload' }; }
    if (!payload || typeof payload !== 'object') return { reachable: true, valid: false, http: r.status, error: 'invalid_payload' };
    const shape = classifyCatalogPayload(payload, serviceId);
    const kept = opts.keepPayload ? { payload, payloadText, contentBlocks: Array.isArray(rpc.result?.content) ? rpc.result.content.length : null, contentIsText: rpc.result?.content?.[0]?.type === 'text' } : {};
    if (shape.kind === 'absent') return { reachable: true, valid: true, found: false, http: r.status, tokens: [], ...kept };
    if (shape.kind !== 'display') return { reachable: true, valid: false, http: r.status, error: shape.error };
    const tokens = [String(payload.mcp_status).toLowerCase()];
    if (payload.freshness?.confidence === 'high') tokens.push('updated');
    if (payload.freshness?.confidence) tokens.push(`freshness:${payload.freshness.confidence}`);
    return { reachable: true, valid: true, found: true, http: r.status, tokens, mcp_status: payload.mcp_status, freshness: payload.freshness ?? null, ...kept };
  } catch (e) { return { reachable: false, valid: false, http: null, error: 'network', err: String(e?.message || e).slice(0, 80) }; }
  finally { clearTimeout(t); }
}

/* ================= http_probe / catalog_display (M-002) ================= */
const catalogDisplay = {
  method: 'catalog_display_vs_sealed_expectation',
  gtMethod: 'sealed_expectation_vs_harness_http_probe',
  gtClaim: 'sealed endpoints are still unreachable when the harness probes them directly',
  parseSealed(json) {
    const services = json.expected?.services;
    if (!Array.isArray(services) || !services.length) throw new Error('expected.services');
    for (const s of services) if (!s.service_id || !/^https?:\/\//.test(String(s.endpoint || ''))) throw new Error('expected.services[].service_id/endpoint');
    const forbidden = (services[0].expected_display_not_in || json.expected.expected_display_not_in || ['verified', 'updated', '確認済み', '更新済み']).map((x) => String(x).toLowerCase());
    return { services, forbidden };
  },
  async groundTruth({ sealed, harnessLog }) {
    const probes = [];
    for (const s of sealed.services) probes.push(await probeMcpEndpoint(s.endpoint));
    const deadCount = probes.filter((p) => DEAD.has(p.cls)).length;
    const consistent = deadCount === sealed.services.length;
    harnessLog({ event: 'ground_truth', consistent });
    return { consistent, probes, deadCount, total: sealed.services.length, checks: [{ label: 'all_sealed_endpoints_still_unreachable', ok: consistent }] };
  },
  observers({ MK }) { return [{ id: 'kansei_harness', label: 'catalog_display', model: MK.display_api_label || 'kansei-link-catalog' }]; },
  async observe({ MK, sealed, log }) {
    const apiUrl = MK.display_api_url;
    const displays = [];
    for (const s of sealed.services) { const d = await readCatalogDisplay(apiUrl, s.service_id); displays.push(d); log({ role: 'tool_result', tool: 'catalog_lookup_detail', args: { service_id: s.service_id }, result_head: JSON.stringify(d).slice(0, 400) }); }
    return { displays };
  },
  judge({ obs, sealed }) {
    const displays = obs.displays || [];
    // Closed judgement: every sealed service must yield a valid observation (a display
    // or an explicit not-found). Anything else is the instrument, not the subject.
    const observed = displays.length === sealed.services.length && displays.every((d) => d.reachable && d.valid);
    const perService = displays.map((d) => ({ valid: Boolean(d.reachable && d.valid), found: d.found === true, hit: (d.tokens || []).some((t) => sealed.forbidden.includes(t)) }));
    const anyHit = perService.some((p) => p.hit);
    const checks = [
      { label: 'catalog_api_reachable', ok: displays.length > 0 && displays.every((d) => d.reachable) },
      { label: 'every_service_observed', ok: observed },
      ...perService.map((p, i) => ({ label: `service_${i + 1}_display_not_in_forbidden`, ok: p.valid && !p.hit })),
      { label: 'no_service_displayed_as_verified_or_updated', ok: observed && !anyHit },
    ];
    let reached, stopped, instrument = null;
    if (!observed) { reached = 'discover'; stopped = 'discover'; instrument = 'other'; }
    else if (anyHit) { reached = 'understand'; stopped = 'understand'; }
    else { reached = 'done'; stopped = null; }
    // The catalog asserting "verified"/"updated" about a dead endpoint is a self-claim of success.
    return { reached, stopped, pass: reached === 'done', checks, falseCompletion: observed && anyHit, instrument };
  },
};

/* ================= http_probe / fetch_check_summary (M-003) ================= */
const fetchCheck = {
  method: 'agent_fetch_vs_sealed_body_digest',
  gtMethod: 'sealed_expectation_vs_harness_http_probe',
  gtClaim: 'sealed page bodies still match their sealed sha256 when the harness fetches them directly',
  parseSealed(json) {
    const pages = json.expected?.pages;
    if (!Array.isArray(pages) || pages.length < 1) throw new Error('expected.pages');
    for (const p of pages) if (!/^https?:\/\//.test(String(p.url || '')) || !/^[0-9a-f]{64}$/.test(String(p.body_sha256 || ''))) throw new Error('expected.pages[].url/body_sha256');
    return { pages };
  },
  async groundTruth({ sealed, harnessLog }) {
    const fetched = [];
    for (const p of sealed.pages) fetched.push(await fetchBody(p.url));
    const matches = fetched.map((f, i) => f.status === 200 && f.sha256 === sealed.pages[i].body_sha256);
    const consistent = matches.every(Boolean);
    harnessLog({ event: 'ground_truth', consistent });
    return { consistent, fetched, matches, checks: sealed.pages.map((_, i) => ({ label: `page_${i + 1}_body_matches_sealed_digest`, ok: matches[i] })) };
  },
  observers({ MK }) { return (MK.observers || []).map((o) => ({ id: o.id, label: o.id, summary_key: o.summary_key, model: null })); },
  /** Observation source: the day's fetch-check summary (produced by the existing run.cjs). */
  async observe({ MK, observer, sealed, flags, log, stamp }) {
    const summaryPath = flags.fetchSummary || join(resolveEnvRefs(MK.fetch_check_dir), `${stamp}.json`);
    if (!existsSync(summaryPath)) return { missing: true, summaryPath };
    let s; try { s = JSON.parse(readFileSync(summaryPath, 'utf8')); } catch { return { missing: true, summaryPath, reason: 'summary unreadable' }; }
    // The summary must be today's: a reading's observed_at is the day it was made, so an
    // older summary (even one passed explicitly) writes no row.
    if (s.date !== stamp) return { missing: true, summaryPath, reason: `summary date ${s.date} is not today (${stamp})` };
    // A summary whose run_at is another day is inconsistent (mixed dates) and is not used at all.
    if (s.run_at && String(s.run_at).slice(0, 10) !== stamp) return { missing: true, summaryPath, reason: `summary run_at ${String(s.run_at).slice(0, 10)} is not today (${stamp})` };
    const key = observer.summary_key;
    const pages = sealed.pages.map((p, i) => {
      const id = (MK.pages || [])[i]?.summary_id;
      const cell = s.checks?.[id]?.[key];
      // A cell that carries its own date must be today's; otherwise it is treated as missing.
      const cellDated = cell && cell.date != null && String(cell.date).slice(0, 10) !== stamp;
      return { summary_id: id, status: cellDated ? 'missing' : (cell?.status ?? 'missing'), control: Boolean((MK.pages || [])[i]?.control) };
    });
    if (pages.every((p) => p.status === 'missing')) return { missing: true, summaryPath, reason: `no cells for ${key}` };
    log({ role: 'tool_result', tool: 'fetch_check_summary', args: { observer: key, date: s.date }, result_head: JSON.stringify(pages).slice(0, 400) });
    const cliVersion = String(s.cli_versions?.[key] || '').match(/\d+\.\d+\.\d+/)?.[0] || null;
    return { pages, model: s.agents?.[key] || null, cliVersion, date: s.date };
  },
  judge({ obs }) {
    const pages = obs.pages || [];
    const wiki = pages.filter((p) => !p.control);
    const KNOWN = new Set(['fetched', 'denied', 'unclear', 'error', 'missing']);
    const checks = [
      ...pages.map((p, i) => ({ label: `page_${i + 1}_${p.control ? 'control_' : ''}fetched`, ok: p.status === 'fetched' })),
      { label: 'all_statuses_known', ok: pages.length > 0 && pages.every((p) => KNOWN.has(p.status)) },
    ];
    let reached, stopped, instrument = null, undetermined = false;
    // Closed judgement (⑤ exclusive): an unknown status or a tool error is the instrument; a page the
    // agent could not open (denied/unclear/missing) is the agent's own undetermined; done only when
    // there is at least one wiki page and every wiki page is fetched.
    if (!pages.length || pages.some((p) => !KNOWN.has(p.status))) { reached = 'discover'; stopped = 'discover'; instrument = 'other'; }
    else if (pages.some((p) => p.status === 'error')) { reached = 'discover'; stopped = 'discover'; instrument = 'other'; }
    else if (wiki.some((p) => p.status === 'denied' || p.status === 'missing')) { reached = 'discover'; stopped = 'discover'; undetermined = true; }
    else if (wiki.some((p) => p.status === 'unclear')) { reached = 'understand'; stopped = 'understand'; undetermined = true; }
    else if (wiki.length && wiki.every((p) => p.status === 'fetched')) { reached = 'done'; stopped = null; }
    else { reached = 'discover'; stopped = 'discover'; instrument = 'other'; }
    return { reached, stopped, pass: reached === 'done', checks, falseCompletion: false, undetermined, instrument };
  },
};

/* ================= llm_answer (M-004: discover + understand; connect/execute = M-005) ================= */
const normRepo = (u) => String(u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '').replace(/[#?].*$/, '').replace(/\/+$/, '');

// Rules live in ./llm-answer-rules.mjs (closed two-line form: REPO/AUTH; canonical REPO value;
// the four AUTH words; exclusivity). normRepo above is for the SEAL only, never for an answer.
export { AUTH_RULE, ANSWER_FORMAT, extractUrlTokens, parseCanonicalRepoUrl, parseAnswerLines, judgeLlmAnswer, assertExclusive } from './llm-answer-rules.mjs';

const llmAnswer = {
  method: 'llm_answer_rules_vs_sealed_expectation',
  gtMethod: 'sealed_repo_vs_github_api',
  gtClaim: 'sealed official MCP repository still exists and is public on GitHub',
  parseSealed(json) {
    // Seal = repository URL only. Any other expected.* field is ignored (never read as a rule).
    const repo = normRepo(json.expected?.official_mcp_repo_url);
    const m = repo.match(/^github\.com\/([^/]+)\/([^/]+)$/);
    if (!m) throw new Error('expected.official_mcp_repo_url');
    return { repo, owner: m[1], name: m[2], wrongTokens: [...AUTH_RULE.wrongTokens] };
  },
  /**
   * Ground truth = the sealed repository is still where the seal says (ATTRIBUTION-Rules v0.1 §2-1,
   * rename detection). The GitHub API answers a renamed or moved repository through a redirect to
   * the new name, so the response's full_name is compared with the sealed owner/repo (ASCII case
   * only). A different full_name, archived=true, private, or no answer → inconsistent: the day's
   * judgement is 未確定（計器）and the AI reading is not counted as a miss (renderer).
   */
  async groundTruth({ MK, sealed, harnessLog }) {
    if (MK.verify_repo_via_github === false) { harnessLog({ event: 'ground_truth', consistent: true }); return { consistent: true, skipped: true, checks: [{ label: 'repo_check_skipped_by_pack', ok: true }] }; }
    const base = String(MK.github_api_base || 'https://api.github.com').replace(/\/+$/, '');
    let http = null, exists = false, sameName = false, notArchived = false, notRedirected = false;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), Number(MK.github_timeout_ms) || 15000);
    try {
      const r = await fetch(`${base}/repos/${sealed.owner}/${sealed.name}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'kansei-marker-harness/0.4' }, signal: ctl.signal });
      http = r.status; const d = await r.json().catch(() => ({}));
      exists = r.ok && d.private === false;
      sameName = exists && typeof d.full_name === 'string' && d.full_name.toLowerCase() === `${sealed.owner}/${sealed.name}`.toLowerCase();
      notArchived = exists && d.archived === false;
      notRedirected = exists && r.redirected === false;
    } catch { /* network or timeout: all checks stay false → inconsistent (U0) */ } finally { clearTimeout(timer); }
    const consistent = exists && sameName && notArchived;
    harnessLog({ event: 'ground_truth', consistent }); // which check failed (rename, archive) is in the ground-truth row's checks
    return { consistent, http, checks: [
      { label: 'sealed_repo_exists_public_on_github', ok: exists },
      { label: 'sealed_repo_full_name_unchanged', ok: sameName },
      { label: 'sealed_repo_not_archived', ok: notArchived },
      { label: 'sealed_repo_api_not_redirected', ok: notRedirected },
    ] };
  },
  /**
   * Attribution columns A and B (ATTRIBUTION-Rules v0.1 §1, §2-1, §4-2). Ground-truth side rows, written
   * once per run; they read only (public pages, the public catalog) and never touch the subject.
   * §4-2 (Michie 2026-09-29, after Codex review of 7e9a3e2): the instrument only DETECTS CHANGE. For each
   * source fixed in the taskpack (A1, A2 = official pages, B = the KanseiLINK catalog item) it reads the
   * body and takes its sha256 (A: the raw bytes after HTTP 200 and complete receipt; B: catalogBodyFromText =
   * the canonical text of the whole item made from the item's ORIGINAL TEXT by a strict JSON scanner — every
   * number token as written, no value round trip (Codex 544808b R2) — minus _meta.attempt_id and
   * freshness.data_age_days while their tokens have the exact grammar; a text the scanner refuses — not
   * RFC 8259, a key twice in one object, deeper than 64, over 1 MiB — or a tool result that is not exactly
   * one text block has no body: B is unknown and no attestation is looked up). The source's state comes ONLY
   * from a valid human attestation of exactly that body (evidence/attestations/<marker>-<source>-<sha>.json,
   * verdict listed or not_listed; observer in observers.json; attribution-attest.mjs validateAttestation); without
   * one the source is 未確定（本文に変化あり・要再確認）. A note (reason) that looks unfinished is a private caution only.
   * The automatic reading (attribution-rules.mjs classifySource) is loaded in a try/catch and written
   * to the private sidecar as a hint; it never changes a row.
   * Row encoding: pass = listed (by attestation); instrument_error 'other' = unknown;
   * pass=false with instrument_error=null = not listed (by attestation). Checks carry booleans only:
   *   A: <id>_page_fetched, <id>_attested_listed, <id>_attested_not_listed, <id>_needs_recheck,
   *      official_docs_attested_listed (some page), official_docs_attested_not_listed (every page).
   *   B: catalog_item_observed, catalog_body_fields_fixed, catalog_item_present, catalog_body_canonical,
   *      catalog_item_attested_listed, catalog_item_attested_not_listed, catalog_item_needs_recheck.
   */
  async attribution({ MK, sealed, harnessLog, attestationsDir, expectedDigest, markerId }) {
    const cfg = MK.attribution;
    if (!cfg) return [];
    // First and only place these parts are loaded. If attribution-attest.mjs cannot be loaded this throws
    // and marker-generic writes both rows as instrument errors (U1/U2); the agent readings are unaffected.
    const { catalogBodyDetail, sha256Hex, sourceTarget, sourceState, B_BODY_FIELDS } = await import('./attribution-attest.mjs');
    // The hint reader is optional: when it cannot be loaded, the rows are exactly the same.
    let hints = null;
    try { hints = await import('./attribution-rules.mjs'); } catch { hints = null; }
    const HINT_NOTE = '手がかり（自動の読み・誤りうる・判断に使わない）';
    const hint = (fn) => { if (!hints) return { state: null, reason: 'hint_reader_unavailable', note: HINT_NOTE }; try { return { ...fn(hints), note: HINT_NOTE }; } catch { return { state: null, reason: 'hint_failed', note: HINT_NOTE }; } };
    const dir = (typeof cfg.attestations_dir === 'string' && cfg.attestations_dir.trim()) ? cfg.attestations_dir : attestationsDir;
    const ctxOf = (sourceId) => ({ markerId, expectedDigest, sourceId, target: sourceTarget(cfg, sourceId) });
    const rows = []; const diagnostics = []; const recheck = [];

    // A: official documentation pages fixed in the taskpack
    const pages = Array.isArray(cfg.official_docs) ? cfg.official_docs : [];
    const aChecks = []; const states = [];
    for (const p of pages) {
      let fetched = false, bodySha = null, h = null;
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
      try {
        const r = await fetch(p.url, { headers: { 'user-agent': 'kansei-marker-harness/0.4' }, signal: c.signal });
        if (r.status === 200) {
          const bytes = Buffer.from(await r.arrayBuffer()); fetched = true; // the whole body, received
          bodySha = sha256Hex(bytes);
          h = hint((m) => { const x = m.classifySource(bytes.toString('utf8'), sealed, { html: true }); return { state: x.state, reason: x.reason }; });
        } else await r.body?.cancel().catch(() => {});
      } catch { fetched = false; bodySha = null; } finally { clearTimeout(t); }
      const ctx = ctxOf(p.id);
      const st = sourceState({ fetched, bodySha, dir, ctx });
      states.push(st.state);
      if (st.state === 'recheck') recheck.push(p.id);
      aChecks.push({ label: `${p.id}_page_fetched`, ok: fetched }, { label: `${p.id}_attested_listed`, ok: st.state === 'listed' }, { label: `${p.id}_attested_not_listed`, ok: st.state === 'not_listed' }, { label: `${p.id}_needs_recheck`, ok: st.state === 'recheck' });
      diagnostics.push({ event: 'attribution_source', source_id: p.id, target: ctx.target, body_sha256: bodySha, state: st.state, attestation: st.why, attestation_cautions: st.cautions, needs_recheck: st.state === 'recheck', hint: h });
    }
    const aListed = states.includes('listed');
    const aNotListed = !aListed && states.length > 0 && states.every((x) => x === 'not_listed');
    const aInstrument = aListed || aNotListed ? null : 'other';
    aChecks.push({ label: 'official_docs_attested_listed', ok: aListed }, { label: 'official_docs_attested_not_listed', ok: aNotListed });
    rows.push({ method: 'sealed_repo_vs_official_docs', claim: 'the official documentation pages fixed in the taskpack list the sealed MCP repository (attested by a person for the body read this run)', pass: aListed, instrument_error: aInstrument, checks: aChecks });
    harnessLog({ event: 'attribution', column: 'A', listed: aListed, not_listed: aNotListed, instrument: aInstrument, needs_recheck: [...recheck] });

    // B: KanseiLINK's own public catalog item (M-002 reader, keepPayload in memory only)
    const fieldsFixed = cfg.catalog?.body_fields === B_BODY_FIELDS;
    const d = await readCatalogDisplay(cfg.catalog?.display_api_url, cfg.catalog?.service_id, 20000, { keepPayload: true });
    const observed = Boolean(d.reachable && d.valid);
    const bChecks = [{ label: 'catalog_item_observed', ok: observed }, { label: 'catalog_body_fields_fixed', ok: fieldsFixed }];
    let bState = 'unread', bSha = null, bWhy = observed ? 'body_fields_not_fixed_in_taskpack' : 'not_observed', bCautions = [], bHint = null, bNotCanonical = null;
    if (observed) {
      bChecks.push({ label: 'catalog_item_present', ok: Boolean(d.found) });
      // the fingerprint comes from the item's original text only; no canonical body → no fingerprint, no attestation lookup
      const canon = d.contentBlocks === 1 && d.contentIsText ? catalogBodyDetail(d.payloadText) : { body: null, why: 'not_one_text_block' };
      bChecks.push({ label: 'catalog_body_canonical', ok: canon.body !== null });
      if (canon.body === null) { bWhy = 'body_not_canonical'; bNotCanonical = canon.why; }
      else {
        bSha = sha256Hex(canon.body);
        if (fieldsFixed) { const st = sourceState({ fetched: true, bodySha: bSha, dir, ctx: ctxOf('B') }); bState = st.state; bWhy = st.why; bCautions = st.cautions; }
      }
      bHint = hint((m) => {
        const fields = m.catalogStringLeaves(d.payload).filter(([, v]) => m.classifySource(v, sealed).state === 'listed').map(([path]) => path);
        return { state: fields.length ? 'listed' : 'unknown', reason: fields.length ? 'some_field_resolves' : 'no_field_resolves', fields };
      });
    }
    if (bState === 'recheck') recheck.push('B');
    bChecks.push({ label: 'catalog_item_attested_listed', ok: bState === 'listed' }, { label: 'catalog_item_attested_not_listed', ok: bState === 'not_listed' }, { label: 'catalog_item_needs_recheck', ok: bState === 'recheck' });
    diagnostics.push({ event: 'attribution_source', source_id: 'B', target: sourceTarget(cfg, 'B'), body_sha256: bSha, state: bState, attestation: bWhy, ...(bNotCanonical ? { body_not_canonical: bNotCanonical } : {}), attestation_cautions: bCautions, needs_recheck: bState === 'recheck', hint: bHint });
    const bInstrument = bState === 'listed' || bState === 'not_listed' ? null : 'other';
    rows.push({ method: 'sealed_repo_vs_kansei_catalog', claim: 'the KanseiLINK catalog item for the subject names the sealed MCP repository (attested by a person for the body read this run)', pass: bState === 'listed', instrument_error: bInstrument, checks: bChecks });
    // needs_recheck has the same form in both columns: the ids of the sources to re-check (B: ["B"] or [])
    harnessLog({ event: 'attribution', column: 'B', listed: bState === 'listed', not_listed: bState === 'not_listed', instrument: bInstrument, needs_recheck: bState === 'recheck' ? ['B'] : [] });
    if (recheck.length) diagnostics.push({ event: 'attribution_needs_recheck', sources: [...recheck], note: '本文に変化あり・要再確認: 当日の本文 sha256 に一致する人の確認がない（evidence/attestations/README.md）' });
    rows.diagnostics = diagnostics; // private sidecar only (environment.private.json)
    rows.needsRecheck = recheck;
    return rows;
  },
  observers({ MK }) { return (MK.providers || ['openai', 'gemini', 'perplexity', 'claude']).map((p) => ({ id: 'kansei_harness', label: p, provider: p, model: null })); },
  async observe({ PACK, observer, flags, log }) {
    // Closed form (B): the task text plus the two-line answer format. The format lines are the
    // only guidance the model gets; their size is recorded in the manifest (prompt_guidance).
    const lang = PACK.goal_prompt[flags.lang] ? flags.lang : 'ja';
    const question = `${PACK.goal_prompt[lang]}\n\n${ANSWER_FORMAT[lang] || ANSWER_FORMAT.ja}`;
    const a = await askLlm(observer.provider, question, { label: observer.label });
    log({ role: 'assistant', provider: observer.provider, model: a.model, error: a.error || null, text: a.text || '', citations: a.citations || [] });
    return { text: a.text || '', model: a.model, error: a.error || null, citations: a.citations || [] };
  },
  /**
   * Closed two-line form (rules and their exact grammar: ./llm-answer-rules.mjs header).
   * Only the last two non-empty physical lines are read, "REPO: <value>" then "AUTH: <value>";
   * the text before them is never judged. Form is checked before content:
   *   REPO value (after at most one <…>, `…` or "…" wrapper) must be "none" or fully match
   *     ^https://<REPO_HOSTS exactly>/<owner>/<repo>(.git)?/?$ — a port, userinfo, trailing-dot
   *     host, http, query, fragment, percent-encoding or whitespace inside the wrapper is
   *     format_violation, never a repo.
   *   AUTH value (after the same unwrap) must be one of OAuth 2.0 / Basic / API key / unknown,
   *     with only ASCII spaces/tabs around it.
   * Then: REPO = sealed and AUTH = OAuth 2.0 → done. none / unknown → undetermined. Another repo or
   * Basic / API key → false_completion. format_violation → the agent's undetermined.
   */
  judge({ obs, sealed }) { return judgeLlmAnswer(obs, sealed); },
  /** (D) recorded in the manifest: what the prompt leaks beyond the task text. */
  promptGuidance({ flags }) {
    const lang = flags?.lang && ANSWER_FORMAT[flags.lang] ? flags.lang : 'ja';
    return { form: 'two_lines_REPO_AUTH', lines: ANSWER_FORMAT.lines, auth_options_listed: [...ANSWER_FORMAT.auth_options_listed], format_text: ANSWER_FORMAT[lang], leaks_expected_repo_url: false, leaks_expected_auth_method: true, note: 'the AUTH option list names the expected method among four; the REPO line asks for a URL without naming it' };
  },
};

/* ================= natural_task (M-006: a natural request, the provider's own tools, two closed traces) ================= */
/**
 * Rules: ./natural-task-rules.mjs (traces per configuration, the artifact, the judgement). Callers:
 * ./natural-task.mjs (loaded here by dynamic import only, so no other marker depends on it).
 * Seal = the official repository URL (as M-004; parseSealed shared). Ground truth = the repository is
 * still where the seal says (llmAnswer.groundTruth). One reading per configuration × prompt variant:
 * the observer label is "<config id>.<variant>" and target.setup names the configuration
 * (reading.v1.1). No format is appended to the prompt and no options are shown.
 */
const naturalTask = {
  method: 'natural_task_traces_vs_sealed_repo',
  gtMethod: 'sealed_repo_vs_github_api',
  gtClaim: 'sealed official MCP repository still exists and is public on GitHub',
  parseSealed(json) { return llmAnswer.parseSealed(json); },
  groundTruth(args) { return llmAnswer.groundTruth(args); },
  observers({ MK }) {
    const configs = Array.isArray(MK.configs) ? MK.configs : [];
    const variants = Object.keys(MK.prompt_variants || {});
    const out = [];
    // model = the taskpack's own value for the configuration (options.model, or "preset-<preset>"): what the public files
    // show when the model a provider reports is not in the public grammar (marker-generic publicModel)
    const configured = (c) => (typeof c.options?.model === 'string' ? c.options.model : typeof c.options?.preset === 'string' ? `preset-${c.options.preset}` : null);
    for (const c of configs) for (const v of variants) out.push({ id: 'kansei_harness', label: `${c.id}.${v}`, provider: c.provider, model: configured(c), config: c, variant: v, setup: { config_id: c.id, kind: c.kind, provider: c.provider, tools: [...(c.tools || [])], prompt_variant: v, fetch_meaning: c.fetch_meaning, cli_version: null } });
    return out;
  },
  async observe({ PACK, MK, observer, flags, log }) {
    const { runNaturalTask, claudeCodeIsolation, CONFIG_DEFAULTS } = await import('./natural-task.mjs');
    const variant = MK.prompt_variants[observer.variant];
    const lang = variant?.[flags.lang] ? flags.lang : 'ja';
    const question = variant[lang]; // the natural request alone: no answer format, no options
    const cfg = { ...(CONFIG_DEFAULTS[observer.provider] || {}), ...(observer.config.options || {}) };
    const a = await runNaturalTask({ provider: observer.provider }, question, { label: observer.label, cfg });
    // private (transcript.jsonl): the raw response and the work files; a failed agent run keeps its events here too
    log({ role: 'assistant', provider: observer.provider, model: a.model, error: a.error || null, error_class: a.error_class || null, raw: a.raw ?? a.raw_private ?? null, files: a.files || [], usage: a.usage || null, cli_version: a.cli_version || null });
    if (a.error) return { error: a.error, errorClass: a.error_class || null, model: a.model, cliVersion: a.cli_version || null };
    // an agent CLI must have run isolated (system/init: only the allowed tools, no MCP server, no plugin)
    const isolation = observer.setup?.kind === 'agent_cli' ? claudeCodeIsolation(a.raw?.response ?? a.raw, observer.config.tools || cfg.tools || []) : null;
    return { raw: a.raw, files: a.files || [], model: a.model, cliVersion: a.cli_version || null, isolation, usage: a.usage || null };
  },
  async judge({ obs, sealed, observer }) {
    const R = await import('./natural-task-rules.mjs');
    // a provider error, a timeout, a failed agent run: the instrument, in its class; nothing of the run is graded
    const CLASSES = ['provider_api', 'timeout', 'budget', 'other'];
    if (obs?.error) return { reached: 'discover', stopped: 'discover', pass: false, falseCompletion: false, undetermined: false, instrument: CLASSES.includes(obs.errorClass) ? obs.errorClass : 'provider_api', checks: [{ label: 'provider_answered', ok: false }] };
    const provider = observer?.provider;
    const READERS = { openai: 'tracesOpenAI', anthropic: 'tracesAnthropic', perplexity: 'tracesPerplexity', 'claude-code': 'tracesClaudeCode' };
    // fake (smoke only): the fixture names which documented shape it plays; an unknown name is a refused response
    const reader = provider === 'fake' ? (Object.hasOwn(R.TRACE_READERS, obs.raw?._traces_as ?? 'tracesOpenAI') ? obs.raw?._traces_as ?? 'tracesOpenAI' : null) : READERS[provider] ?? null;
    const traces = reader ? R.TRACE_READERS[reader](provider === 'fake' ? obs.raw?.response ?? obs.raw : obs.raw) : { shape_ok: false, instrument: 'other', tools_used: false, candidates: [], fetched: [], fetched_readable: false, cited: [], cited_readable: false, text: '', unknown_types: [] };
    // an agent run that was not isolated, or a refused / failed response: the work files are not graded either
    const gradable = traces.shape_ok && !traces.instrument && !(obs.isolation && !obs.isolation.ok);
    const art = gradable ? R.extractArtifact({ text: traces.text, files: obs.files || [] }) : { state: 'none', artifact: null, sources: [] };
    const v = R.judgeNaturalTask({ traces, art, sealedKey: sealed.repo });
    if (obs.isolation && !obs.isolation.ok) { v.instrument = 'other'; v.pass = false; v.falseCompletion = false; v.undetermined = false; v.reached = 'discover'; v.stopped = 'discover'; }
    v.checks.push({ label: 'agent_environment_isolated', ok: obs.isolation ? obs.isolation.ok : true });
    // what a person may look at later, in the run's two PRIVATE files (never public): environment.private.json gets the
    // traces, the artifact and the type names of the items that were skipped; <observer>/transcript.jsonl gets the raw
    // response and the work files (observe's log above)
    v.private = { event: 'natural_task_traces', observer: observer?.label, candidates: traces.candidates, fetched: traces.fetched, cited: traces.cited, unknown_types: traces.unknown_types || [], artifact: art.state === 'one' ? art.artifact : null, artifact_state: art.state, artifact_sources: art.sources, artifact_form: v.artifact_form, isolation: obs.isolation, usage: obs.usage || null };
    return v;
  },
  /** (R4 P2) the names — never the values — of the environment variables an agent CLI child may get. */
  async childEnvNames({ MK }) {
    if (!(Array.isArray(MK.configs) ? MK.configs : []).some((c) => c.kind === 'agent_cli')) return null;
    const { CLAUDE_CODE_ENV_INHERIT, CLAUDE_CODE_ENV_SET } = await import('./natural-task.mjs');
    return { inherited_when_set: [...CLAUDE_CODE_ENV_INHERIT], set_by_harness: ['CLAUDE_CONFIG_DIR', ...Object.keys(CLAUDE_CODE_ENV_SET)] };
  },
  promptGuidance() {
    return { form: 'natural_request', lines: 0, auth_options_listed: [], format_text: null, leaks_expected_repo_url: false, leaks_expected_auth_method: false, note: 'the request is the only text the model sees; no answer format, no option list' };
  },
};

export function selectTarget(MK) {
  const kind = MK.kind_of_truth || 'mcp_direct_read';
  if (kind === 'mcp_direct_read') return null; // handled in run-marker.mjs (freee/M-001)
  if (kind === 'http_probe' && MK.observation === 'catalog_display') return catalogDisplay;
  if (kind === 'http_probe' && MK.observation === 'fetch_check_summary') return fetchCheck;
  if (kind === 'llm_answer') return llmAnswer;
  if (kind === 'natural_task') return naturalTask;
  throw new Error(`unsupported kind_of_truth/observation: ${kind}/${MK.observation ?? '-'}`);
}

export const TARGETS = { catalogDisplay, fetchCheck, llmAnswer, naturalTask };
