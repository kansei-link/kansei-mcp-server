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
 * File: <attestations dir>/<marker_id>-<source_id>-<body sha256>.json with EXACTLY these keys:
 *   attestation      "kansei-attribution-attestation/v2"
 *   marker_id        the run's marker (e.g. "M-004")
 *   expected_digest  the seal's sha256 (binds the file to the sealed repository)
 *   source_id        "A1" | "A2" | "B" (the source being read)
 *   target           sourceTarget(taskpack attribution, source_id), character for character
 *   body_sha256      sha256 of the body read that run
 *   verdict          "listed" | "not_listed"
 *   observer         "human:<name>" (e.g. "human:synapse-arrows")
 *   date             "YYYY-MM-DD", a real calendar date
 *   reason           one line: what was read and what was (or was not) there
 * Every value must be a non-empty string without a placeholder: TODO, TBD, anything in <…> or […]
 * (any of < > [ ] { }), a line break. Anything else makes the file invalid and the source stays
 * 未確定（本文に変化あり・要再確認）. */
export const ATTESTATION_KIND = 'kansei-attribution-attestation/v2';
export const VERDICTS = Object.freeze(['listed', 'not_listed']);
const ATTESTATION_KEYS = ['attestation', 'body_sha256', 'date', 'expected_digest', 'marker_id', 'observer', 'reason', 'source_id', 'target', 'verdict'];
const PLACEHOLDER = /(^|[^A-Za-z])(TODO|TBD)([^A-Za-z]|$)|[<>[\]{}\r\n\t\u0000-\u001f]/i;
export function attestationPath(dir, markerId, sourceId, bodySha) { return join(dir, `${markerId}-${sourceId}-${bodySha}.json`); }

/** null when valid, otherwise the first reason it is not. ctx = { markerId, expectedDigest, sourceId, target, bodySha }. */
export function validateAttestation(a, ctx) {
  if (!isPlain(a)) return 'not_an_object';
  const keys = Object.keys(a).sort();
  if (keys.length !== ATTESTATION_KEYS.length || keys.some((k, i) => k !== ATTESTATION_KEYS[i])) return 'keys';
  for (const k of ATTESTATION_KEYS) if (typeof a[k] !== 'string' || !a[k].trim() || a[k] !== a[k].trim()) return `empty:${k}`;
  for (const k of ATTESTATION_KEYS) if (PLACEHOLDER.test(a[k])) return `placeholder:${k}`;
  if (a.attestation !== ATTESTATION_KIND) return 'kind';
  if (a.marker_id !== ctx.markerId) return 'marker_id';
  if (!/^[0-9a-f]{64}$/.test(a.expected_digest) || a.expected_digest !== ctx.expectedDigest) return 'expected_digest';
  if (a.source_id !== ctx.sourceId) return 'source_id';
  if (typeof ctx.target !== 'string' || !ctx.target || a.target !== ctx.target) return 'target';
  if (!/^[0-9a-f]{64}$/.test(a.body_sha256) || a.body_sha256 !== ctx.bodySha) return 'body_sha256';
  if (!VERDICTS.includes(a.verdict)) return 'verdict';
  if (!/^human:[A-Za-z0-9][A-Za-z0-9._ -]{0,58}[A-Za-z0-9]$|^human:[A-Za-z0-9]$/.test(a.observer)) return 'observer';
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a.date);
  if (!d || new Date(`${a.date}T00:00:00Z`).toISOString().slice(0, 10) !== a.date) return 'date';
  if (a.reason.length > 200) return 'reason';
  return null;
}

/** { verdict: 'listed' | 'not_listed' | null, why } — reads at most one file, never throws. */
export function findAttestation(dir, ctx) {
  try {
    if (!dir) return { verdict: null, why: 'no_dir' };
    if (!/^[0-9a-f]{64}$/.test(String(ctx.bodySha))) return { verdict: null, why: 'no_body' };
    const p = attestationPath(dir, ctx.markerId, ctx.sourceId, ctx.bodySha);
    if (!existsSync(p)) return { verdict: null, why: 'none_for_this_body' };
    const a = JSON.parse(readFileSync(p, 'utf8'));
    const bad = validateAttestation(a, ctx);
    return bad ? { verdict: null, why: `invalid:${bad}` } : { verdict: a.verdict, why: 'valid' };
  } catch { return { verdict: null, why: 'unreadable' }; }
}

/**
 * The state of one source for the public row: 'listed' | 'not_listed' come ONLY from a valid human
 * attestation of this body; 'recheck' = the body was read but no attestation matches it
 * (未確定（本文に変化あり・要再確認）); 'unread' = the body could not be read (未確定（取得失敗）).
 */
export function sourceState({ fetched, bodySha, dir, ctx }) {
  if (!fetched) return { state: 'unread', why: 'not_fetched' };
  const f = findAttestation(dir, { ...ctx, bodySha });
  return f.verdict ? { state: f.verdict, why: f.why } : { state: 'recheck', why: f.why };
}
