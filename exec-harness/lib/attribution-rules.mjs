/**
 * ATTRIBUTION-Rules v0.1 — reading the sealed repository in a SOURCE (columns A and B).
 * Loaded ONLY by the M-004 attribution step (marker-targets.mjs, dynamic import), so a broken
 * decoder or source reader never stops a marker that does not use it. The display and judgement
 * functions live in ./attribution-labels.mjs (no imports) and are re-exported here for callers.
 *
 * §4-2 (Michie 2026-09-29, after Codex review of 8d905ee): the AUTOMATIC reading returns only
 * "listed" or "unknown". "Not listed" — a judgement that blames the company or KanseiLINK — is given
 * only by a HUMAN attestation bound to the sha256 of the exact body that was read that day
 * (evidence/attestations/<marker>-<source>-<body sha256>.json). When the body changes, the
 * attestation no longer matches and the source is unknown again.
 */
export * from './attribution-labels.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_HOSTS } from './llm-answer-rules.mjs';
import { decodeHTML } from '../vendor/entities-8.1.0/decode.js';

/* ---------- resolving one URL token to the sealed key ----------
 * Keeps the host's identity and the owner/repo exact and accepts every way of writing the same
 * place: scheme https://, http:// or none (incl. //github.com); a REPO_HOSTS entry exactly, for
 * GitHub also www.github.com; port none or :443; anything below the repository (/tree/…, /blob/…,
 * query, fragment, .git). A token is never trimmed: a trailing "." or "/..", "%2e" anywhere, or a
 * backslash makes it unresolvable. Percent-encoded owner/repo names are not decoded: unresolvable.
 */
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOST_ALIASES = Object.freeze({ 'www.github.com': 'github.com' });
const SOURCE_HOSTS = [...REPO_HOSTS, ...Object.keys(HOST_ALIASES)];
// no "u" flag: "i" folds ASCII letters only
const SOURCE_REPO = new RegExp(`^(?:https?://|//)?(${SOURCE_HOSTS.map(escapeRe).join('|')})(?::443)?/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\\.git)?([/?#].*)?$`, 'i');
const ONLY_DOTS = /^\.+$/;

/** host/owner/repo key of ONE whole URL token (www.github.com folded to github.com), or null. */
export function sourceRepoKey(raw) {
  const s = String(raw);
  if (/%2e/i.test(s) || /\\/.test(s)) return null;
  const m = SOURCE_REPO.exec(s);
  if (!m) return null;
  const [, rawHost, owner, repo, tail = ''] = m;
  if (ONLY_DOTS.test(owner) || ONLY_DOTS.test(repo) || /^\.git$/i.test(repo)) return null;
  const path = tail.split(/[?#]/)[0];
  if (path.split('/').some((seg) => ONLY_DOTS.test(seg))) return null; // "/." or "/.." anywhere below
  const host = HOST_ALIASES[rawHost.toLowerCase()] || rawHost.toLowerCase();
  return `${host}/${owner}/${repo}`.toLowerCase();
}

/* ---------- URL tokens of a source ----------
 * Scanned left to right for "name:" at a boundary (not preceded by a letter, digit, "+", "." or "-"):
 *   http: / https:  the token runs to the first stop character (whitespace, quote, backtick,
 *                   < > ( ) [ ] { }, CJK brackets and punctuation) and is taken WHOLE; its inside is
 *                   never re-scanned.
 *   any other name  (data:, mailto:, javascript:, urn:, ftp:, …, with or without "//") — the rest up
 *                   to the next WHITESPACE is opaque: never read, never re-scanned (Codex 8d905ee N1).
 *   "host:NNN/"     a port, not a scheme (github.com:443/…) — left for the scheme-less pass.
 * Then, outside those spans only, scheme-less and protocol-relative hosts are taken at a boundary:
 * start, or a character that cannot be part of a URL ([ ( < > { " ' ` whitespace, non-ASCII), or
 * right after an href= / src= attribute — never after a bare "=" or "/" (a URL inside another URL).
 * Characters are never trimmed from any token. */
const STOP = '\\s<>"\'`()\\[\\]{}（）「」『』【】、。';
const HTTP_TOKEN = new RegExp(`^[^${STOP}]+`);
const SCHEME_AT = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*):/g;
const BARE_TOKEN = new RegExp(`(?:(?<=(?:^|\\s)(?:href|src)=)|(?<![A-Za-z0-9._~!$&*+,;=:@/?#%-]))(?://)?[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?::[0-9]*)?/[^${STOP}]+`, 'gi');
export function sourceUrlTokens(text) {
  const s = String(text || '');
  const tokens = []; const spans = [];
  const re = new RegExp(SCHEME_AT.source, 'g');
  let m;
  while ((m = re.exec(s))) {
    const start = m.index; const after = start + m[0].length; const name = m[1].toLowerCase();
    if (/^[0-9]+(?=[/?#\s]|$)/.test(s.slice(after, after + 8))) continue; // host:port
    if (name === 'http' || name === 'https') {
      const raw = HTTP_TOKEN.exec(s.slice(start))[0];
      tokens.push({ raw, index: start, end: start + raw.length, opaque: false });
      spans.push([start, start + raw.length]); re.lastIndex = start + raw.length;
    } else {
      const opaque = /^\S*/.exec(s.slice(start))[0];
      spans.push([start, start + opaque.length]); re.lastIndex = Math.max(start + opaque.length, after);
    }
  }
  let masked = s;
  for (const [a, b] of spans) masked = masked.slice(0, a) + ' '.repeat(b - a) + masked.slice(b);
  for (const t of masked.matchAll(BARE_TOKEN)) tokens.push({ raw: t[0], index: t.index, end: t.index + t[0].length, opaque: false });
  return tokens.sort((x, y) => x.index - y.index);
}

/** HTML character references decoded ONCE with the vendored WHATWG-conformant decoder (entities
 *  8.1.0, vendor/entities-8.1.0/VENDOR.md): &hyphen; is U+2010, not "-". */
export function decodeHtmlCharRefs(html) { return decodeHTML(String(html ?? '')); }

// a reference the decoder left as it is, or a replacement character, within 80 characters of a host name
const RESIDUAL_REF = /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);?|\uFFFD/g;
function residualNearHost(s) {
  const lower = s.toLowerCase();
  const hostAt = [];
  for (const h of SOURCE_HOSTS) { let i = -1; while ((i = lower.indexOf(h, i + 1)) >= 0) hostAt.push(i); }
  if (!hostAt.length) return false;
  for (const m of s.matchAll(RESIDUAL_REF)) if (hostAt.some((h) => Math.abs(h - m.index) <= 80)) return true;
  return false;
}

/**
 * The AUTOMATIC reading of one source: 'listed' or 'unknown' — never 'not_listed' (§4-2).
 * sealed = { repo: 'host/owner/repo', owner, name }; opts.html decodes HTML character references once.
 * The reason is a diagnostic only (why the source is unknown); it never changes the state.
 */
export function classifySource(text, sealed, opts = {}) {
  const s = opts.html ? decodeHtmlCharRefs(text) : String(text ?? '');
  if (sourceUrlTokens(s).some((t) => sourceRepoKey(t.raw) === sealed.repo)) return { state: 'listed', reason: 'resolves_to_sealed_repo' };
  const lower = s.toLowerCase();
  if (lower.includes(String(sealed.owner).toLowerCase()) || lower.includes(String(sealed.name).toLowerCase())) return { state: 'unknown', reason: 'name_present_not_resolvable' };
  if (residualNearHost(s)) return { state: 'unknown', reason: 'undecodable_reference_near_host' };
  return { state: 'unknown', reason: 'no_resolving_link' };
}

/** Kept for callers that only need the positive answer. */
export function sourceListsRepo(text, sealedKey, opts = {}) {
  const s = opts.html ? decodeHtmlCharRefs(text) : String(text ?? '');
  return sourceUrlTokens(s).some((t) => sourceRepoKey(t.raw) === sealedKey);
}

/* ---------- the "body" a human attests (and the automatic reading reads) ---------- */
export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Column B's body: every string leaf of the catalog item with its path, sorted, EXCLUDING the
 *  top-level keys that start with "_" (per-request metadata such as _meta.attempt_id) and
 *  "freshness" (dates that move every day). Neither can name a repository. */
export function catalogStringLeaves(payload) {
  const leaves = [];
  const walk = (v, path) => {
    if (typeof v === 'string') leaves.push([path || '(root)', v]);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, `${path}[]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [k, v] of Object.entries(payload)) if (!k.startsWith('_') && k !== 'freshness') walk(v, k);
  }
  return leaves.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}
export function catalogBody(payload) { return JSON.stringify(catalogStringLeaves(payload)); }

/* ---------- human attestations (§4-2) ----------
 * File: <attestations dir>/<marker_id>-<source_id>-<body sha256>.json, exactly these keys:
 *   attestation   "kansei-attribution-not-listed/v1"
 *   marker_id     e.g. "M-004"            (must equal the run's marker)
 *   expected_digest  the seal's sha256     (binds the attestation to the sealed repository)
 *   source_id     "A1" | "A2" | "B" …     (must equal the source being read)
 *   target        the URL or the catalog item/field that was read (text)
 *   body_sha256   sha256 of the body read that day (must equal today's body)
 *   verdict       "not_listed"
 *   observer      "human:<name>"
 *   date          "YYYY-MM-DD"
 *   reason        one line
 * Anything else (a missing or extra key, a placeholder, another seal, another body) is ignored and
 * the source stays unknown. Unsigned drafts carry "_draft_instructions" and are therefore invalid. */
export const ATTESTATION_KIND = 'kansei-attribution-not-listed/v1';
const ATTESTATION_KEYS = ['attestation', 'body_sha256', 'date', 'expected_digest', 'marker_id', 'observer', 'reason', 'source_id', 'target', 'verdict'];
export function attestationPath(dir, markerId, sourceId, bodySha) { return join(dir, `${markerId}-${sourceId}-${bodySha}.json`); }
export function validateAttestation(a, { markerId, expectedDigest, sourceId, bodySha }) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'not_an_object';
  const keys = Object.keys(a).sort();
  if (keys.length !== ATTESTATION_KEYS.length || keys.some((k, i) => k !== ATTESTATION_KEYS[i])) return 'keys';
  if (a.attestation !== ATTESTATION_KIND) return 'kind';
  if (a.marker_id !== markerId) return 'marker_id';
  if (a.expected_digest !== expectedDigest) return 'expected_digest';
  if (a.source_id !== sourceId) return 'source_id';
  if (!/^[0-9a-f]{64}$/.test(String(a.body_sha256)) || a.body_sha256 !== bodySha) return 'body_sha256';
  if (a.verdict !== 'not_listed') return 'verdict';
  if (typeof a.observer !== 'string' || !/^human:[^\s<>{}][^<>{}\r\n]{0,59}$/.test(a.observer)) return 'observer';
  if (typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) || Number.isNaN(Date.parse(`${a.date}T00:00:00Z`))) return 'date';
  if (typeof a.target !== 'string' || !a.target.trim() || /[\r\n<>]/.test(a.target)) return 'target';
  if (typeof a.reason !== 'string' || !a.reason.trim() || a.reason.length > 200 || /[\r\n<>{}]/.test(a.reason)) return 'reason';
  return null;
}
/** { attested: boolean, why } — reads at most one file, never throws. */
export function findAttestation(dir, ctx) {
  try {
    if (!dir) return { attested: false, why: 'no_dir' };
    const p = attestationPath(dir, ctx.markerId, ctx.sourceId, ctx.bodySha);
    if (!existsSync(p)) return { attested: false, why: 'none_for_this_body' };
    const bad = validateAttestation(JSON.parse(readFileSync(p, 'utf8')), ctx);
    return bad ? { attested: false, why: `invalid:${bad}` } : { attested: true, why: 'valid' };
  } catch (e) { return { attested: false, why: 'unreadable' }; }
}
