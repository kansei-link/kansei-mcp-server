/**
 * ATTRIBUTION-Rules v0.1 §4-2 (Michie 2026-09-29, after Codex review of 7e9a3e2) — columns A and B are
 * decided by PEOPLE, not by the instrument. The instrument only detects change: every run it reads each
 * source fixed in the taskpack (A1, A2 = official pages; B = the KanseiLINK catalog item) and takes the
 * sha256 of its body. A human attestation for exactly that body (verdict listed OR not_listed) gives the
 * source its state; without one the source is 「未確定（本文に変化あり・要再確認）」. Nothing read
 * automatically from a body (attribution-rules.mjs classifySource) ever reaches a public row, a
 * judgement or the sheet — it is a private hint at most.
 *
 * Node built-ins only: this module must load even when the source readers (attribution-rules.mjs, the
 * vendored decoder) are broken.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ---------- a strict JSON scanner (RFC 8259; node built-ins only) ----------
 * Codex 544808b R2 (Michie 2026-09-30): a fingerprint taken from JSON.stringify(JSON.parse(text)) loses what
 * the round trip loses — 1e400 becomes null, the first of two equal keys disappears (and a link with it),
 * 3.0000000000000000001 becomes 3, 1e5 becomes 100000, 2^53+1 becomes 2^53, -0 becomes 0. The kind is
 * closed here, not case by case: nothing that decides is read through a value round trip. The text is
 * scanned token by token and every token keeps its own characters.
 * Refused (a reason is returned, never an exception): not a string, more than maxBytes of UTF-8, anything
 * outside the RFC 8259 grammar (whitespace is SP / HT / LF / CR only; no BOM, comment, trailing comma, bare
 * control character in a string, leading zero, NaN / Infinity), anything after the one value, a key that
 * appears twice in one object (compared after the escapes are resolved), nesting deeper than maxDepth.
 * Nodes: { t:'o', members:[{ key, node }] } | { t:'a', items:[node] } | { t:'s', raw, value } |
 *        { t:'n', raw } | { t:'l', raw }   (raw = the token exactly as written, quotes included for strings) */
export const BODY_MAX_BYTES = 1048576; // 1 MiB
export const BODY_MAX_DEPTH = 64;
const NUMBER_TOKEN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const HEX4 = /^[0-9A-Fa-f]{4}$/;
const ESCAPED = new Map([['"', 34], ['\\', 92], ['/', 47], ['b', 8], ['f', 12], ['n', 10], ['r', 13], ['t', 9]]);
class NotStrictJson extends Error {}
export function scanStrictJson(text, { maxBytes = BODY_MAX_BYTES, maxDepth = BODY_MAX_DEPTH } = {}) {
  if (typeof text !== 'string') return { ok: false, why: 'not_a_string' };
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, why: 'too_large' };
  let i = 0;
  const fail = (why) => { throw new NotStrictJson(why); };
  const ws = () => { for (;;) { const c = text.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else return; } };
  const string = () => {
    const start = i; i++; // at the opening quote
    let value = ''; let from = i;
    for (;;) {
      if (i >= text.length) fail('syntax');
      const c = text.charCodeAt(i);
      if (c === 34) { value += text.slice(from, i); i++; return { t: 's', raw: text.slice(start, i), value }; }
      if (c < 32) fail('syntax');
      if (c !== 92) { i++; continue; }
      value += text.slice(from, i);
      const e = text[i + 1];
      if (e === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (!HEX4.test(hex)) fail('syntax');
        value += String.fromCharCode(parseInt(hex, 16)); i += 6;
      } else if (ESCAPED.has(e)) { value += String.fromCharCode(ESCAPED.get(e)); i += 2; }
      else fail('syntax');
      from = i;
    }
  };
  const value = (depth) => {
    ws();
    const c = text[i];
    if (c === '{') {
      if (depth >= maxDepth) fail('too_deep');
      i++; const members = []; const seen = new Set();
      ws();
      if (text[i] === '}') { i++; return { t: 'o', members }; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('syntax');
        const k = string();
        if (seen.has(k.value)) fail('duplicate_key');
        seen.add(k.value);
        ws();
        if (text[i] !== ':') fail('syntax');
        i++;
        members.push({ key: k.value, node: value(depth + 1) });
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { t: 'o', members }; }
        fail('syntax');
      }
    }
    if (c === '[') {
      if (depth >= maxDepth) fail('too_deep');
      i++; const items = [];
      ws();
      if (text[i] === ']') { i++; return { t: 'a', items }; }
      for (;;) {
        items.push(value(depth + 1));
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return { t: 'a', items }; }
        fail('syntax');
      }
    }
    if (c === '"') return string();
    for (const lit of ['true', 'false', 'null']) if (text.startsWith(lit, i)) { i += lit.length; return { t: 'l', raw: lit }; }
    NUMBER_TOKEN.lastIndex = i;
    const m = NUMBER_TOKEN.exec(text);
    if (!m) fail('syntax');
    i += m[0].length;
    return { t: 'n', raw: m[0] };
  };
  try {
    const node = value(0);
    ws();
    if (i !== text.length) fail('trailing');
    return { ok: true, node };
  } catch (e) {
    if (e instanceof NotStrictJson) return { ok: false, why: e.message };
    return { ok: false, why: 'syntax' }; // anything unexpected is a refusal too (never an exception)
  }
}

/* ---------- column B's body ----------
 * The WHOLE catalog item as canonical text, made from the item's ORIGINAL TEXT (the tool result's text,
 * before any parsing) by the strict scanner above — never from a parsed value:
 *   object   its members sorted by key (UTF-16 code units of the resolved key), each key written as
 *            JSON.stringify(resolved key)
 *   array    its items in their order
 *   number   the token exactly as written (1e400, -0, 1e5, 100000 and 3.0000000000000000001 are five
 *            different bodies)
 *   true / false / null   as written
 *   string   JSON.stringify(resolved string) — the same string gives the same text however it was escaped
 *   whitespace between tokens is dropped
 * minus exactly two members that change on their own — and only while the TOKEN AS WRITTEN has the
 * grammar of the value that changes on its own (Codex 1391a31 R1: excluded by exact grammar, never by type):
 *   _meta.attempt_id        a new id on every call (src/tools/lookup.ts: randomUUID()) — left out only while
 *                           the string token is exactly a quote, an RFC 4122 UUID in lower case and a quote
 *                           (a token written with any escape does not match and stays)
 *   freshness.data_age_days grows by one every day — left out only while the number token matches
 *                           /^(0|[1-9][0-9]{0,4}|100000)$/ (a sign, a fraction or an exponent does not
 *                           match and stays: 1e5, 3.0, -0, 00 … are in the body or refused)
 * The member is left out key and value together, so its presence is not part of the body while its value
 * has that grammar. Any other value there (upper case, a URL, empty, another type, a negative or huge
 * number) stays, so the sha256 changes and every attestation of the old body expires. Nothing else is left
 * out: a new key anywhere (_repository, _meta.repository, freshness.repository, …) changes the body (Codex
 * 7e9a3e2 ①). So two item texts have the same body only when they differ in whitespace, the order of
 * keys, how a string or key is escaped, or those two members.
 * A text the scanner refuses has NO body: catalogBodyFromText returns null, column B is unknown
 * (instrument; the sidecar says body_not_canonical and which refusal) and no attestation is looked up. */
export const B_BODY_FIELDS = 'all_except:_meta.attempt_id(rfc4122-uuid-lowercase),freshness.data_age_days(int 0..100000)';
const UUID_TOKEN = /^"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"$/;
const AGE_TOKEN = /^(0|[1-9][0-9]{0,4}|100000)$/;
const VOLATILE = new Map([
  ['_meta', { leaf: 'attempt_id', ok: (n) => n.t === 's' && UUID_TOKEN.test(n.raw) }],
  ['freshness', { leaf: 'data_age_days', ok: (n) => n.t === 'n' && AGE_TOKEN.test(n.raw) }],
]);
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
function canonicalText(node, volatile = null) {
  if (node.t === 'o') {
    const kept = volatile ? node.members.filter((m) => !(m.key === volatile.leaf && volatile.ok(m.node))) : node.members;
    return `{${[...kept].sort(byKey).map((m) => `${JSON.stringify(m.key)}:${canonicalText(m.node)}`).join(',')}}`;
  }
  if (node.t === 'a') return `[${node.items.map((x) => canonicalText(x)).join(',')}]`;
  if (node.t === 's') return JSON.stringify(node.value);
  return node.raw;
}
/** { body, why }: body = the canonical text (why null), or null with why = the scanner's refusal. Never throws. */
export function catalogBodyDetail(text) {
  const s = scanStrictJson(text);
  if (!s.ok) return { body: null, why: s.why };
  const root = s.node;
  if (root.t !== 'o') return { body: canonicalText(root), why: null };
  const members = [...root.members].sort(byKey).map((m) => `${JSON.stringify(m.key)}:${canonicalText(m.node, m.node.t === 'o' ? VOLATILE.get(m.key) ?? null : null)}`);
  return { body: `{${members.join(',')}}`, why: null };
}
/** Column B's body from the item's original text, or null when it cannot be made canonical. */
export function catalogBodyFromText(text) { return catalogBodyDetail(text).body; }

/** JSON.parse for a file that DECIDES (an attestation, observers.json): only a text the strict scanner
 *  accepts is parsed (so a key written twice is a refusal, not "the last one wins"). Throws otherwise. */
function parseStrict(text) {
  const s = scanStrictJson(text);
  if (!s.ok) throw new Error(`not_strict_json:${s.why}`);
  return JSON.parse(text);
}

/* ---------- the source a human attests: fixed in the taskpack ----------
 * A1/A2: the page URL exactly as the taskpack gives it (after ${ENV:} resolution).
 * B:     one line naming the catalog endpoint, the service_id and the body's fields. */
export function sourceTarget(cfg, sourceId) {
  if (sourceId === 'B') return `kansei-catalog ${cfg?.catalog?.display_api_url} service_id=${cfg?.catalog?.service_id} fields=${B_BODY_FIELDS}`;
  const p = (Array.isArray(cfg?.official_docs) ? cfg.official_docs : []).find((x) => x?.id === sourceId);
  return p ? String(p.url) : null;
}

/* ---------- human attestations ----------
 * File: <attestations dir>/<marker_id>-<source_id>-<body sha256>.json with EXACTLY these keys, every
 * value a string. Codex review of 5758e0a (Michie 2026-09-29): the fields that DECIDE are bound to
 * ALLOW-LISTS or computed values — never screened by a list of forbidden words.
 *   attestation      = "kansei-attribution-attestation/v2"
 *   marker_id        = the run's marker (e.g. "M-004")
 *   expected_digest  = the seal's sha256 (binds the file to the sealed repository)
 *   source_id        = "A1" | "A2" | "B" (the source being read)
 *   target           = sourceTarget(taskpack attribution, source_id), character for character
 *   body_sha256      = sha256 of the body read that run
 *   verdict          ∈ {"listed", "not_listed"}
 *   observer         ∈ <attestations dir>/observers.json (a JSON array of strings, exact match;
 *                      today ["human:synapse-arrows"]). Each entry is "human:" + a name with no leading
 *                      or trailing space and no control character. No list, an unreadable or empty list,
 *                      or any malformed entry → no observer is accepted.
 *   date             a real calendar date "YYYY-MM-DD", not after today (local date)
 *   reason           a NOTE that decides nothing: non-empty after trimming, at most 200 characters, no
 *                    control character and no line/paragraph separator (C0, DEL, C1 incl. U+0085,
 *                    U+2028, U+2029). Its words do not affect validity; words that look unfinished
 *                    (TODO, TBD, <…>, […], {…}) are reported to the private sidecar as a caution only.
 * Anything else makes the file invalid and the source stays 未確定（本文に変化あり・要再確認）.
 * Drafts carry no verdict (a person writes it in) and carry _draft_instructions; either makes them invalid. */
export const ATTESTATION_KIND = 'kansei-attribution-attestation/v2';
export const VERDICTS = Object.freeze(['listed', 'not_listed']);
export const OBSERVERS_FILE = 'observers.json';
export const REASON_MAX = 200;
const ATTESTATION_KEYS = ['attestation', 'body_sha256', 'date', 'expected_digest', 'marker_id', 'observer', 'reason', 'source_id', 'target', 'verdict'];
const REASON_FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const REASON_CAUTION = /TODO|TBD|<[^>]*>|\[[^\]]*\]|\{[^}]*\}/i;
export function attestationPath(dir, markerId, sourceId, bodySha) { return join(dir, `${markerId}-${sourceId}-${bodySha}.json`); }

/** The accepted observers of an attestations directory (observers.json), or [] — never throws. */
export function loadObservers(dir) {
  try {
    if (!dir) return [];
    const list = parseStrict(readFileSync(join(dir, OBSERVERS_FILE), 'utf8'));
    // each entry: "human:" + a name with no leading/trailing space and no control character
    const ok = (o) => typeof o === 'string' && o.startsWith('human:') && o.length > 6 && o.slice(6) === o.slice(6).trim() && !REASON_FORBIDDEN_CHARS.test(o);
    if (!Array.isArray(list) || !list.length || !list.every(ok)) return [];
    return [...list];
  } catch { return []; }
}

/** Today's local calendar date as YYYY-MM-DD (not toISOString: that is UTC and is yesterday before 09:00 JST). */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** A real calendar date "YYYY-MM-DD" (checked without throwing). */
function isCalendarDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * null when valid, otherwise the first reason it is not.
 * ctx = { markerId, expectedDigest, sourceId, target, bodySha, observers: string[], today: 'YYYY-MM-DD' }.
 */
export function validateAttestation(a, ctx) {
  if (!isPlain(a)) return 'not_an_object';
  const keys = Object.keys(a).sort();
  if (keys.length !== ATTESTATION_KEYS.length || keys.some((k, i) => k !== ATTESTATION_KEYS[i])) return 'keys';
  for (const k of ATTESTATION_KEYS) if (typeof a[k] !== 'string') return `not_a_string:${k}`;
  // the deciding fields: exact values
  if (a.attestation !== ATTESTATION_KIND) return 'kind';
  if (a.marker_id !== ctx.markerId) return 'marker_id';
  if (!/^[0-9a-f]{64}$/.test(a.expected_digest) || a.expected_digest !== ctx.expectedDigest) return 'expected_digest';
  if (a.source_id !== ctx.sourceId) return 'source_id';
  if (typeof ctx.target !== 'string' || !ctx.target || a.target !== ctx.target) return 'target';
  if (!/^[0-9a-f]{64}$/.test(a.body_sha256) || a.body_sha256 !== ctx.bodySha) return 'body_sha256';
  if (!VERDICTS.includes(a.verdict)) return 'verdict';
  if (!Array.isArray(ctx.observers) || !ctx.observers.includes(a.observer)) return 'observer';
  if (!isCalendarDate(a.date)) return 'date';
  if (typeof ctx.today !== 'string' || !isCalendarDate(ctx.today) || a.date > ctx.today) return 'date_after_today';
  // the note: shape only
  if (!a.reason.trim() || a.reason.length > REASON_MAX || REASON_FORBIDDEN_CHARS.test(a.reason)) return 'reason';
  return null;
}

/** Cautions about a VALID attestation's note (private sidecar only; never change validity). */
export function reasonCautions(a) {
  return typeof a?.reason === 'string' && REASON_CAUTION.test(a.reason) ? ['reason_looks_unfinished'] : [];
}

/** { verdict: 'listed' | 'not_listed' | null, why, cautions } — reads at most two files, never throws. */
export function findAttestation(dir, ctx) {
  try {
    if (!dir) return { verdict: null, why: 'no_dir', cautions: [] };
    if (!/^[0-9a-f]{64}$/.test(String(ctx.bodySha))) return { verdict: null, why: 'no_body', cautions: [] };
    const p = attestationPath(dir, ctx.markerId, ctx.sourceId, ctx.bodySha);
    if (!existsSync(p)) return { verdict: null, why: 'none_for_this_body', cautions: [] };
    const text = readFileSync(p, 'utf8');
    const strict = scanStrictJson(text);
    if (!strict.ok) return { verdict: null, why: strict.why === 'duplicate_key' ? 'invalid:duplicate_key' : 'unreadable', cautions: [] };
    const a = JSON.parse(text);
    const full = { observers: loadObservers(dir), today: localToday(), ...ctx };
    const bad = validateAttestation(a, full);
    return bad ? { verdict: null, why: `invalid:${bad}`, cautions: [] } : { verdict: a.verdict, why: 'valid', cautions: reasonCautions(a) };
  } catch { return { verdict: null, why: 'unreadable', cautions: [] }; }
}

/**
 * The state of one source for the public row: 'listed' | 'not_listed' come ONLY from a valid human
 * attestation of this body; 'recheck' = the body was read but no attestation matches it
 * (未確定（本文に変化あり・要再確認）); 'unread' = the body could not be read (未確定（取得失敗）).
 */
export function sourceState({ fetched, bodySha, dir, ctx }) {
  if (!fetched) return { state: 'unread', why: 'not_fetched', cautions: [] };
  const f = findAttestation(dir, { ...ctx, bodySha });
  return f.verdict ? { state: f.verdict, why: f.why, cautions: f.cautions } : { state: 'recheck', why: f.why, cautions: [] };
}
