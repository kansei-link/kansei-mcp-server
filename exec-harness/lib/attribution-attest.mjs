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

/* ---------- column B's body ----------
 * The WHOLE catalog item (every key, every leaf, strings or not, arrays in their order) as canonical JSON
 * (object keys sorted), minus exactly two leaves that change on their own:
 *   _meta.attempt_id        a new id on every call   — excluded only while it is a string
 *   freshness.data_age_days grows by one every day   — excluded only while it is a non-negative integer
 * A leaf of an unexpected type stays in the body (so it changes the sha256). Nothing else is excluded:
 * a new key anywhere (_repository, _meta.repository, freshness.repository, …) changes the body and so
 * expires every attestation of the old body (Codex 7e9a3e2 fatal ①). */
export const B_BODY_FIELDS = 'all_except:_meta.attempt_id,freshness.data_age_days';
const VOLATILE = [
  { path: ['_meta', 'attempt_id'], ok: (v) => typeof v === 'string' },
  { path: ['freshness', 'data_age_days'], ok: (v) => Number.isInteger(v) && v >= 0 },
];
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isPlain(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
export function catalogBody(payload) {
  const copy = isPlain(payload) ? { ...payload } : payload;
  if (isPlain(copy)) {
    for (const { path: [top, leaf], ok } of VOLATILE) {
      if (isPlain(copy[top]) && Object.hasOwn(copy[top], leaf) && ok(copy[top][leaf])) {
        const { [leaf]: _drop, ...rest } = copy[top];
        copy[top] = rest;
      }
    }
  }
  return canonical(copy);
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
    const list = JSON.parse(readFileSync(join(dir, OBSERVERS_FILE), 'utf8'));
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
    const a = JSON.parse(readFileSync(p, 'utf8'));
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
