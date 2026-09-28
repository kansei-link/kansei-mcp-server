/**
 * ATTRIBUTION-Rules v0.1 — reading the sealed repository in a SOURCE (columns A and B), three values.
 * Loaded ONLY by the M-004 attribution step (marker-targets.mjs, dynamic import), so a broken
 * decoder or source reader never stops a marker that does not use it. The display and judgement
 * functions live in ./attribution-labels.mjs (no imports) and are re-exported here for callers.
 */
export * from './attribution-labels.mjs';
import { REPO_HOSTS } from './llm-answer-rules.mjs';
import { decodeHTML } from '../vendor/entities-8.1.0/decode.js';


/* ---------- reading the sealed repository in a SOURCE (columns A and B): THREE values ----------
 * Yardstick (Michie 2026-09-28): a judgement that blames the other side (the company, KanseiLINK)
 * must always be right, and a judgement that clears it must not be given on a guess either. A
 * source is therefore read into one of three states (Codex review of 185d63d, closed by kind):
 *   listed      some URL token of the source resolves CLEANLY to the sealed key (sourceRepoKey)
 *   not_listed  the observation is complete (HTTP 200 and the whole body received in time) AND the
 *               decoded body never contains the sealed owner name nor the repo name (ASCII case-
 *               insensitive substring), and no undecodable reference sits near a repository host
 *   unknown     everything else: a truncated body, a name present but not resolvable as a link,
 *               an undecodable reference near a host… → the truth table's U1 (A) / U2 (B)
 * Resolving (sourceRepoKey) keeps the host's identity and the owner/repo exact and accepts every way
 * of writing the same place: scheme https://, http:// or none (incl. //github.com); a REPO_HOSTS
 * entry exactly, for GitHub also www.github.com; port none or :443; anything below the repository
 * (/tree/…, /blob/…, query, fragment, .git). A token is never trimmed: a trailing "." or "/..", or
 * "%2e" anywhere, makes it unresolvable (and then the name rule usually makes the source unknown).
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

/* URL tokens for sources. Characters are never trimmed. A token ends only at whitespace, a quote,
 * a backtick, an angle/round/square/curly bracket or CJK punctuation. Scheme URLs (any scheme:
 * https, ftp, …) are taken whole first and their insides are never re-scanned; scheme-less and
 * protocol-relative hosts are then taken only outside them and only at a boundary: start, or a
 * character that cannot be part of a URL ([ ( < > { " ' ` whitespace, non-ASCII), or right after
 * an href= / src= attribute. Never after a bare "=" or "/" (a URL inside another URL). */
const STOP = '\\s<>"\'`()\\[\\]{}（）「」『』【】、。';
const SCHEME_TOKEN = new RegExp(`[A-Za-z][A-Za-z0-9+.-]*://[^${STOP}]+`, 'g');
const BARE_TOKEN = new RegExp(`(?:(?<=(?:^|\\s)(?:href|src)=)|(?<![A-Za-z0-9._~!$&*+,;=:@/?#%-]))(?://)?[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?::[0-9]*)?/[^${STOP}]+`, 'gi');
export function sourceUrlTokens(text) {
  const s = String(text || '');
  const tokens = [];
  for (const m of s.matchAll(SCHEME_TOKEN)) tokens.push({ raw: m[0], index: m.index, end: m.index + m[0].length });
  let masked = s;
  for (const t of tokens) masked = masked.slice(0, t.index) + ' '.repeat(t.end - t.index) + masked.slice(t.end);
  for (const m of masked.matchAll(BARE_TOKEN)) tokens.push({ raw: m[0], index: m.index, end: m.index + m[0].length });
  return tokens.sort((a, b) => a.index - b.index);
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
 * Three-valued reading of one source that was received completely.
 * sealed = { repo: 'host/owner/repo', owner, name }; opts.html decodes HTML character references once.
 * Returns { state: 'listed' | 'not_listed' | 'unknown', reason }.
 */
export function classifySource(text, sealed, opts = {}) {
  const s = opts.html ? decodeHtmlCharRefs(text) : String(text ?? '');
  if (sourceUrlTokens(s).some((t) => sourceRepoKey(t.raw) === sealed.repo)) return { state: 'listed', reason: 'resolves_to_sealed_repo' };
  const lower = s.toLowerCase();
  if (lower.includes(String(sealed.owner).toLowerCase()) || lower.includes(String(sealed.name).toLowerCase())) return { state: 'unknown', reason: 'name_present_not_resolvable' };
  if (residualNearHost(s)) return { state: 'unknown', reason: 'undecodable_reference_near_host' };
  return { state: 'not_listed', reason: 'names_absent' };
}

/** Kept for callers that only need the positive answer. */
export function sourceListsRepo(text, sealedKey, opts = {}) {
  const s = opts.html ? decodeHtmlCharRefs(text) : String(text ?? '');
  return sourceUrlTokens(s).some((t) => sourceRepoKey(t.raw) === sealedKey);
}
