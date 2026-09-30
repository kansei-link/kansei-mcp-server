/**
 * ATTRIBUTION-Rules v0.1 — the AUTOMATIC reading of a source (columns A and B), kept only as a
 * private HINT. §4-2 (Michie 2026-09-29, after Codex review of 7e9a3e2): columns A and B are decided
 * by human attestations bound to the sha256 of the body read that run (./attribution-attest.mjs); the
 * instrument only detects change. Nothing this module returns reaches a public row, a judgement or the
 * sheet: marker-targets.mjs writes it to environment.private.json as 「手がかり」 and nowhere else. It
 * is known to be fallible (Codex 7e9a3e2 ③④: a URL after "data:123/", or inside a scheme-less outer
 * URL, still reads as listed here) — which is why it decides nothing.
 * Loaded ONLY by the M-004 attribution step (dynamic import, inside try/catch), so a broken decoder or
 * source reader never stops a marker and never changes a row.
 */
export * from './attribution-labels.mjs';
export * from './attribution-attest.mjs';
import { decodeHTML } from '../vendor/entities-8.1.0/decode.js';

import { sourceRepoKey, SOURCE_HOSTS } from './repo-key.mjs';
export { sourceRepoKey } from './repo-key.mjs';

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
 * HINT only (private sidecar): 'listed' or 'unknown' — never 'not_listed', and never a row's state.
 * sealed = { repo: 'host/owner/repo', owner, name }; opts.html decodes HTML character references once.
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

/** String leaves of a catalog item with their paths (hint only: which field names the repository). */
export function catalogStringLeaves(payload) {
  const leaves = [];
  const walk = (v, path) => {
    if (typeof v === 'string') leaves.push([path || '(root)', v]);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, `${path}[]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(payload, '');
  return leaves;
}
