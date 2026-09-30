/**
 * One URL token → the key of the repository it names (host/owner/repo), or null.
 * Shared by the M-004 hint reader (attribution-rules.mjs) and the M-006 trace judge
 * (natural-task-rules.mjs). No I/O, no HTML decoding: the caller hands in ONE whole URL string
 * taken from a structured field; this function never scans text.
 */
import { REPO_HOSTS } from './llm-answer-rules.mjs';

/* ---------- resolving one URL token to the sealed key ----------
 * Keeps the host's identity and the owner/repo exact and accepts every way of writing the same
 * place: scheme https://, http:// or none (incl. //github.com); a REPO_HOSTS entry exactly, for
 * GitHub also www.github.com; port none or :443; anything below the repository (/tree/…, /blob/…,
 * query, fragment, .git). A token is never trimmed: a trailing "." or "/..", "%2e" anywhere, or a
 * backslash makes it unresolvable. Percent-encoded owner/repo names are not decoded: unresolvable.
 */
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const HOST_ALIASES = Object.freeze({ 'www.github.com': 'github.com' });
export const SOURCE_HOSTS = [...REPO_HOSTS, ...Object.keys(HOST_ALIASES)];
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

