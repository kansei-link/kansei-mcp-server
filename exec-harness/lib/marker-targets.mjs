/**
 * Target modules — the parts of run-marker that change with the subject.
 * Selected by taskpack `marker.kind_of_truth` (+ `marker.observation`):
 *
 *   kind_of_truth   observation           ground truth (harness)              observers
 *   http_probe      catalog_display       HTTP probe of sealed endpoints      kansei_harness reading the public catalog API   (M-002)
 *   http_probe      fetch_check_summary   HTTP fetch + body sha256            agents' own fetch results (fetch-check summary) (M-003)
 *   llm_answer      (implicit)            GitHub API: sealed repo exists      one public LLM per provider                     (M-004a)
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

/** Read one service's public display through the catalog MCP endpoint (tools/call lookup detail). */
export async function readCatalogDisplay(apiUrl, serviceId, timeoutMs = 20000) {
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
    let payload; try { payload = JSON.parse(rpc.result?.content?.[0]?.text ?? ''); } catch { return { reachable: true, valid: false, http: r.status, error: 'invalid_payload' }; }
    if (!payload || typeof payload !== 'object') return { reachable: true, valid: false, http: r.status, error: 'invalid_payload' };
    if (payload.error) {
      // Only the catalog's explicit "not found" is a legitimate absence.
      if (/not found/i.test(String(payload.error))) return { reachable: true, valid: true, found: false, http: r.status, tokens: [] };
      return { reachable: true, valid: false, http: r.status, error: 'payload_error' };
    }
    if (payload.service_id !== serviceId || typeof payload.mcp_status !== 'string') return { reachable: true, valid: false, http: r.status, error: 'payload_mismatch' };
    const tokens = [String(payload.mcp_status).toLowerCase()];
    if (payload.freshness?.confidence === 'high') tokens.push('updated');
    if (payload.freshness?.confidence) tokens.push(`freshness:${payload.freshness.confidence}`);
    return { reachable: true, valid: true, found: true, http: r.status, tokens, mcp_status: payload.mcp_status, freshness: payload.freshness ?? null };
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
    const key = observer.summary_key;
    const pages = sealed.pages.map((p, i) => {
      const id = (MK.pages || [])[i]?.summary_id;
      const cell = s.checks?.[id]?.[key];
      return { summary_id: id, status: cell?.status ?? 'missing', control: Boolean((MK.pages || [])[i]?.control) };
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
    let reached, stopped, instrument = null;
    // Closed judgement: an unknown status or a tool error is the instrument; done only when
    // there is at least one wiki page and every wiki page is fetched.
    if (!pages.length || pages.some((p) => !KNOWN.has(p.status))) { reached = 'discover'; stopped = 'discover'; instrument = 'other'; }
    else if (pages.some((p) => p.status === 'error')) { reached = 'discover'; stopped = 'discover'; instrument = 'other'; }
    else if (wiki.some((p) => p.status === 'denied' || p.status === 'missing')) { reached = 'discover'; stopped = 'discover'; }
    else if (wiki.some((p) => p.status === 'unclear')) { reached = 'understand'; stopped = 'understand'; }
    else if (wiki.length && wiki.every((p) => p.status === 'fetched')) { reached = 'done'; stopped = null; }
    else { reached = 'discover'; stopped = 'discover'; instrument = 'other'; }
    return { reached, stopped, pass: reached === 'done', checks, falseCompletion: false, instrument };
  },
};

/* ================= llm_answer (M-004a) ================= */
const normRepo = (u) => String(u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '').replace(/[#?].*$/, '').replace(/\/+$/, '');

/** GitHub URL candidates in free text, each normalised to "github.com/<owner>/<repo>[/more]".
 *  Boundaries: a candidate starts at (https://)(www.)github.com/ and ends at whitespace or a
 *  closing bracket/quote; trailing punctuation, ".git", "#fragment" and "?query" are stripped
 *  per candidate. Case-insensitive. Nothing else in the text is touched. */
export function extractRepoCandidates(text) {
  const out = [];
  const re = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s<>"'`()\[\]{}（）「」『』【】]+/gi;
  for (const m of String(text || '').matchAll(re)) {
    let u = m[0].toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/[.,;:!?。、]+$/g, '').replace(/\/+$/, '').replace(/\.git$/, '');
    if (/^github\.com\/[^/]+\/[^/]+/.test(u)) out.push(u);
  }
  return [...new Set(out)];
}

const DENIED_OFFICIAL_MCP = [
  /(公式|official)[^。.\n]{0,40}mcp[^。.\n]{0,40}(確認できない|確認できません|未確認|存在しない|存在しません|提供していない|提供されていない|提供していません|ありません|見当たらない|見つかりません|不明|非公式)/i,
  /mcp[^。.\n]{0,40}(公式ではない|公式ではありません|非公式)/i,
  /(?:^|[^a-z])非公式/i,
  /\b(no|not\s+an?|isn'?t\s+an?|without\s+an?)\s+official\s+mcp/i,
  /\bofficial\s+mcp[^.\n]{0,40}\b(not\s+(found|available|confirmed|exist|provided|published)|unconfirmed|unknown|does\s+not\s+exist)/i,
  /\b(unofficial|not\s+official|non-?official)\b/i,
  /\bthere\s+is\s+no\s+official\s+mcp/i,
];

/** Per-sentence polarity of authentication-method mentions.
 *  Returns { affirmed:Set, denied:Set } over keys 'oauth' | 'basic' | 'apikey' | <other wrong token>.
 *  Japanese negation follows the token (…は非対応／ではない／使わない); English negation
 *  precedes it (not / no / doesn't use / without). "X ではなく Y" denies X and affirms Y. */
export function readAuthPolarity(text, wrongTokens = []) {
  const affirmed = new Set(), denied = new Set();
  const tokens = [{ key: 'oauth', re: /oauth\s*2(?:\.0)?\b|oauth2\b|\boauth\b/i }];
  for (const w of wrongTokens) {
    if (/basic/i.test(w)) tokens.push({ key: 'basic', re: /\bbasic\b(?:\s*(?:認証|auth(?:entication)?))?/i });
    else if (/api\s*キー|api\s*key|apiキー/i.test(w)) tokens.push({ key: 'apikey', re: /api\s*(?:キー|key)s?/i });
    // '存在しない' / '未確認' are officialness tokens, handled by DENIED_OFFICIAL_MCP
  }
  // Japanese: negation / "not stated" follows the token. English: negation precedes it.
  const NEG_AFTER = /^[^。.!?\n]{0,25}?(非対応|未対応|ではない|ではありません|じゃない|使わない|使いません|使えない|使えません|使用しない|使用しません|利用できない|利用できません|対応していない|対応していません|サポートしていない|サポートされていない|不可|できない|できません|ありません|ではなく|以外|記載(が|は)?(ない|ありません)|明記されていない|不明|分からない|わからない)/;
  const NEG_BEFORE = /(\bnot\b|\bno\b|n't\b|\bwithout\b|\bnever\b|\bneither\b|\bnor\b|\binstead\s+of\b|\brather\s+than\b)[^.!?\n]{0,25}$/i;
  // Sentence boundaries: 。！？ newline, or "." followed by whitespace/end (so "2.0" stays whole).
  for (const sentence of String(text || '').split(/(?<=[。！？!?\n])|(?<=\.)(?=\s|$)/)) {
    for (const t of tokens) {
      for (const m of sentence.matchAll(new RegExp(t.re.source, 'gi'))) {
        // "not X but Y" / "X ではなく Y": the negation belongs to X only, so the window before Y
        // starts after the last "but" / "ではなく".
        const beforeRaw = sentence.slice(Math.max(0, m.index - 40), m.index);
        const before = beforeRaw.split(/\bbut\b|ではなく/i).pop();
        const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 40);
        const negated = NEG_AFTER.test(after) || NEG_BEFORE.test(before);
        if (negated) denied.add(t.key); else affirmed.add(t.key);
      }
    }
  }
  return { affirmed, denied };
}
const llmAnswer = {
  method: 'llm_answer_rules_vs_sealed_expectation',
  gtMethod: 'sealed_repo_vs_github_api',
  gtClaim: 'sealed official MCP repository still exists and is public on GitHub',
  parseSealed(json) {
    const repo = normRepo(json.expected?.official_mcp_repo_url);
    const m = repo.match(/^github\.com\/([^/]+)\/([^/]+)$/);
    if (!m) throw new Error('expected.official_mcp_repo_url');
    const auth = String(json.expected?.auth_method || '');
    if (!/oauth\s*2/i.test(auth)) throw new Error('expected.auth_method');
    return { repo, owner: m[1], name: m[2], auth, wrongTokens: (json.expected?.wrong_answers_count_as_false_completion || []).map(String) };
  },
  async groundTruth({ MK, sealed, harnessLog }) {
    if (MK.verify_repo_via_github === false) { harnessLog({ event: 'ground_truth', consistent: true }); return { consistent: true, skipped: true, checks: [{ label: 'repo_check_skipped_by_pack', ok: true }] }; }
    let consistent = false, http = null;
    try {
      const r = await fetch(`https://api.github.com/repos/${sealed.owner}/${sealed.name}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'kansei-marker-harness/0.4' } });
      http = r.status; const d = await r.json().catch(() => ({}));
      consistent = r.ok && d.private === false && d.archived === false;
    } catch { /* network */ }
    harnessLog({ event: 'ground_truth', consistent });
    return { consistent, http, checks: [{ label: 'sealed_repo_exists_public_on_github', ok: consistent }] };
  },
  observers({ MK }) { return (MK.providers || ['openai', 'gemini', 'perplexity', 'claude']).map((p) => ({ id: 'kansei_harness', label: p, provider: p, model: null })); },
  async observe({ PACK, observer, flags, log }) {
    const question = PACK.goal_prompt[flags.lang] || PACK.goal_prompt.ja;
    const a = await askLlm(observer.provider, question, { label: observer.label });
    log({ role: 'assistant', provider: observer.provider, model: a.model, error: a.error || null, text: a.text || '', citations: a.citations || [] });
    return { text: a.text || '', model: a.model, error: a.error || null, citations: a.citations || [] };
  },
  /**
   * Closed judgement in three separate questions (Codex review 2):
   *   1. URL identification — candidates are extracted with boundaries from the raw text,
   *      normalised (scheme/www/.git/#fragment/?query/trailing punctuation) and compared as
   *      host + exact 2-segment path. Another path (/sub, -v2) is another repo.
   *   2. Officialness — an explicit denial (no official MCP / unofficial / 未確認 …) stops at
   *      discover with false_completion, even when the URL is named.
   *   3. Authentication — every method token is read with its own polarity per sentence.
   *      A wrong method affirmed, or OAuth denied, or a contradiction stops at understand
   *      with false_completion. Only OAuth 2.0 affirmed (and never denied) passes.
   * done needs all three; anything ambiguous or contradictory is not done.
   */
  judge({ obs, sealed }) {
    const text = String(obs.text || '');
    const urls = extractRepoCandidates(text);
    const urlOk = urls.some((u) => u === sealed.repo);
    const otherRepoNamed = urls.some((u) => u !== sealed.repo && u.startsWith(`${sealed.repo}/`) || (u !== sealed.repo && u.startsWith(`${sealed.repo}-`)));
    const citedAny = /https?:\/\/\S+/i.test(text) || (obs.citations || []).length > 0;
    const deniedMcp = DENIED_OFFICIAL_MCP.some((re) => re.test(text));
    const auth = readAuthPolarity(text, sealed.wrongTokens);
    const oauthAffirmed = auth.affirmed.has('oauth');
    const oauthDenied = auth.denied.has('oauth');
    const wrongAffirmed = [...auth.affirmed].some((k) => k !== 'oauth');
    let reached, stopped, falseCompletion = false, instrument = null;
    if (obs.error) { reached = 'discover'; stopped = 'discover'; instrument = 'provider_api'; }
    else if (!urlOk) { reached = 'discover'; stopped = 'discover'; falseCompletion = deniedMcp; }
    else if (deniedMcp) { reached = 'discover'; stopped = 'discover'; falseCompletion = true; }
    else if (wrongAffirmed || oauthDenied) { reached = 'understand'; stopped = 'understand'; falseCompletion = true; }
    else if (!oauthAffirmed) { reached = 'understand'; stopped = 'understand'; falseCompletion = false; }
    else { reached = 'done'; stopped = null; }
    const checks = [
      { label: 'named_official_mcp_repo_url', ok: urlOk },
      { label: 'named_no_other_repo_path', ok: !otherRepoNamed },
      { label: 'denied_official_mcp_exists', ok: !deniedMcp },
      { label: 'auth_oauth2_affirmed', ok: oauthAffirmed },
      { label: 'auth_oauth2_not_denied', ok: !oauthDenied },
      { label: 'auth_wrong_method_not_affirmed', ok: !wrongAffirmed },
      { label: 'cited_any_url', ok: citedAny },
    ];
    return { reached, stopped, pass: reached === 'done' && !obs.error, checks, falseCompletion, instrument };
  },
};

export function selectTarget(MK) {
  const kind = MK.kind_of_truth || 'mcp_direct_read';
  if (kind === 'mcp_direct_read') return null; // handled in run-marker.mjs (freee/M-001)
  if (kind === 'http_probe' && MK.observation === 'catalog_display') return catalogDisplay;
  if (kind === 'http_probe' && MK.observation === 'fetch_check_summary') return fetchCheck;
  if (kind === 'llm_answer') return llmAnswer;
  throw new Error(`unsupported kind_of_truth/observation: ${kind}/${MK.observation ?? '-'}`);
}

export const TARGETS = { catalogDisplay, fetchCheck, llmAnswer };
