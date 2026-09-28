/**
 * Rules for kind_of_truth = llm_answer (M-004) — CLOSED FORM.
 *
 * The task prompt ends with a fixed two-line answer format (ANSWER_FORMAT). The ANSWER REGION is
 * the last two non-empty PHYSICAL lines of the reply, and nothing else: they must be, in this
 * order, "REPO: <value>" and "AUTH: <value>". Everything before them (explanations, code quotes,
 * examples that look like the two lines) is evidence kept in transcript.jsonl and never judged.
 *
 * Order of evaluation:
 *   1. FORM of both lines (before any content): the last two non-empty lines exist, are REPO then
 *      AUTH, each on one physical line with a non-empty value. Each value may carry at most ONE
 *      wrapper pair, <…>, `…` or "…", which is removed once and whose inside is not trimmed. Then:
 *        REPO = "none", or a string that FULLY matches the canonical form
 *               ^https://<host in REPO_HOSTS, exactly>/<owner>/<repo>(.git)?/?$
 *               (owner/repo = ASCII letters, digits, "_", ".", "-"; not only dots).
 *        AUTH = exactly one of the four words, with only ASCII spaces/tabs around it.
 *      Anything else is format_violation = the agent's own undetermined (not an instrument error),
 *      whatever the REPO content would have been.
 *      Closed by kind, not case by case: a port (any, :443 included), userinfo, a trailing-dot
 *      host, http, a query, a fragment, percent-encoding, a backslash, whitespace of any kind inside
 *      the wrapper, a scheme-less host, a deeper path and every other spelling fail the canonical
 *      form, so they never reach content. Only ASCII letter case is not significant (labels,
 *      scheme, host, owner/repo, the AUTH words), as in the earlier contract.
 *   2. CONTENT: REPO = sealed → discover passed; none → discover, undetermined; another repo URL →
 *      discover, false_completion. With REPO = sealed: AUTH = OAuth 2.0 → done; Basic / API key →
 *      understand, false_completion; unknown → understand, undetermined.
 * Exactly one of pass / false_completion / undetermined / instrument is true.
 *
 * REPO handling: no URL parser, no trimming, no decoding. The only normalisation is ASCII
 * lower-casing of host/owner/repo and removing one ".git" from the end of the repository name.
 * key = "host/owner/repo".
 */

export const AUTH_RULE = Object.freeze({
  expected: 'OAuth 2.0',
  options: Object.freeze(['OAuth 2.0', 'Basic', 'API key', 'unknown']),
  wrongTokens: Object.freeze(['Basic', 'API key']),
});

export const REPO_HOSTS = Object.freeze(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);

/** Appended to the task text by the harness; recorded in the manifest as prompt_guidance. */
export const ANSWER_FORMAT = Object.freeze({
  ja: '最後に、次の二行を「この形式そのまま」で書いてください。回答の最後の二行がこの二行でなければなりません（説明は二行の前に書く。二行の後には何も書かない。二行の中に説明を混ぜない）:\nREPO: <公式 MCP サーバーのリポジトリ URL を 1 つだけ。無ければ none>\nAUTH: <OAuth 2.0 / Basic / API key / unknown のうち一つだけ>',
  en: 'End your reply with exactly these two lines, in this exact form; they must be the last two lines (explanations go before them, nothing after them, nothing else on these lines):\nREPO: <exactly one URL of the official MCP server repository, or none>\nAUTH: <exactly one of OAuth 2.0 / Basic / API key / unknown>',
  lines: 2,
  auth_options_listed: ['OAuth 2.0', 'Basic', 'API key', 'unknown'],
});

/* ---------- URL tokens (NOT used by the judge; kept for scanning pages in later columns) ---------- */
const SCHEME_URL = /https?:\/\/[^\s<>"'`()\[\]{}（）「」『』【】、。]+/gi;
const BARE_HOST = /(?<![A-Za-z0-9./_@:=?&%-])(?:[a-z0-9-]+\.)*(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)(?::\d+)?\/[^\s<>"'`()\[\]{}（）「」『』【】、。]+/gi;

/** Whole URL tokens: scheme URLs first (their insides are never re-scanned), then scheme-less
 *  repo-host mentions taken only from the text outside those spans. */
export function extractUrlTokens(text) {
  const s = String(text || '');
  const tokens = [];
  for (const m of s.matchAll(SCHEME_URL)) tokens.push({ raw: m[0].replace(/[.,;:!?]+$/g, ''), index: m.index, end: m.index + m[0].length, scheme: true });
  let masked = s;
  for (const t of tokens) masked = masked.slice(0, t.index) + ' '.repeat(t.end - t.index) + masked.slice(t.end);
  for (const m of masked.matchAll(BARE_HOST)) tokens.push({ raw: m[0].replace(/[.,;:!?]+$/g, ''), index: m.index, end: m.index + m[0].length, scheme: false });
  return tokens.sort((a, b) => a.index - b.index);
}

/* ---------- the canonical REPO value ---------- */
// Built from REPO_HOSTS (dots escaped). No "u" flag: "i" then folds ASCII letters only, so no
// non-ASCII character (e.g. U+017F, U+212A) can stand in for an ASCII one.
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REPO_CANONICAL = new RegExp(`^https://(${REPO_HOSTS.map(escapeRe).join('|')})/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(\\.git)?/?$`, 'i');
const ONLY_DOTS = /^\.+$/;

/** The canonical repository URL, or null. The whole string must match REPO_CANONICAL; there is no
 *  URL parsing, trimming or decoding. key = "host/owner/repo" in ASCII lower case, one ".git"
 *  removed from the repository name. */
export function parseCanonicalRepoUrl(value) {
  const m = REPO_CANONICAL.exec(String(value));
  if (!m) return null;
  const [, host, owner, repo] = m;
  if (ONLY_DOTS.test(owner) || ONLY_DOTS.test(repo) || /^\.git$/i.test(repo)) return null;
  return { host: host.toLowerCase(), key: `${host}/${owner}/${repo}`.toLowerCase() };
}

/* ---------- the answer region: last two non-empty physical lines ---------- */
// ASCII label, ASCII colon, spaces/tabs only (never a newline) around the value.
const LINE_FORM = { REPO: /^[ \t]*REPO:[ \t]*(\S(?:.*\S)?)[ \t]*$/i, AUTH: /^[ \t]*AUTH:[ \t]*(\S(?:.*\S)?)[ \t]*$/i };
// AUTH: exactly the four listed words (ASCII case-insensitive, no "u" flag), nothing else.
const AUTH_WORDS = AUTH_RULE.options.map((value) => ({ value, re: new RegExp(`^${escapeRe(value)}$`, 'i') }));
const AUTH_PAD = /^[ \t]+|[ \t]+$/g; // only ASCII spaces/tabs may surround the word
// At most one wrapper pair around the whole value, removed once. Its inside is NOT trimmed.
const unwrap = (v) => { const m = /^(?:<(.*)>|`(.*)`|"(.*)")$/.exec(v); return m ? (m[1] ?? m[2] ?? m[3]) : v; };

/** Form first, then content. Returns { form_ok, violations[], repo:{kind,key}, auth:{value} }. */
export function parseAnswerLines(text, sealedKey) {
  const physical = String(text || '').split(/\r\n|\n|\r/);
  const nonEmpty = physical.map((l) => l).filter((l) => l.trim().length > 0);
  const violations = [];
  const [repoLine, authLine] = nonEmpty.length >= 2 ? nonEmpty.slice(-2) : [nonEmpty[0] ?? null, null];
  const rm = repoLine != null ? repoLine.match(LINE_FORM.REPO) : null;
  const am = authLine != null ? authLine.match(LINE_FORM.AUTH) : null;
  if (nonEmpty.length < 2) violations.push('answer_region_has_fewer_than_two_lines');
  if (!rm) violations.push('second_to_last_line_is_not_REPO_value');
  if (!am) violations.push('last_line_is_not_AUTH_value');

  // REPO value form
  let repoForm = null;
  if (rm) {
    const v = unwrap(rm[1]);
    if (/^none$/i.test(v)) repoForm = { kind: 'none' };
    else {
      const parsed = parseCanonicalRepoUrl(v);
      if (!parsed) violations.push('repo_value_not_canonical_repository_url');
      else repoForm = { kind: 'url', key: parsed.key };
    }
  }
  // AUTH value form
  let authValue = null;
  if (am) {
    const v = unwrap(am[1]).replace(AUTH_PAD, '');
    const hit = AUTH_WORDS.find((a) => a.re.test(v));
    if (hit) authValue = hit.value; else violations.push('auth_value_outside_options');
  }
  const formOk = violations.length === 0;
  const repo = !formOk ? { kind: 'invalid', key: null } : repoForm.kind === 'none' ? { kind: 'none', key: null } : { kind: repoForm.key === sealedKey ? 'sealed' : 'other', key: repoForm.key };
  return { form_ok: formOk, violations, repo, auth: { value: formOk ? authValue : null } };
}

/** The whole llm_answer judgement, closed form. sealed = { repo: "github.com/owner/name" }. */
export function judgeLlmAnswer(obs, sealed) {
  const parsed = parseAnswerLines(obs?.text || '', sealed.repo);
  let reached, stopped, pass = false, falseCompletion = false, undetermined = false, instrument = null, outcome;
  if (obs?.error) { reached = 'discover'; stopped = 'discover'; instrument = 'provider_api'; outcome = 'instrument'; }
  else if (!parsed.form_ok) { reached = 'discover'; stopped = 'discover'; undetermined = true; outcome = 'format_violation'; }
  else if (parsed.repo.kind === 'none') { reached = 'discover'; stopped = 'discover'; undetermined = true; outcome = 'repo_none'; }
  else if (parsed.repo.kind === 'other') { reached = 'discover'; stopped = 'discover'; falseCompletion = true; outcome = 'repo_other'; }
  else if (parsed.auth.value === AUTH_RULE.expected) { reached = 'done'; stopped = null; pass = true; outcome = 'pass'; }
  else if (parsed.auth.value === 'unknown') { reached = 'understand'; stopped = 'understand'; undetermined = true; outcome = 'auth_unknown'; }
  else { reached = 'understand'; stopped = 'understand'; falseCompletion = true; outcome = 'auth_wrong'; }
  const checks = [
    { label: 'answer_region_in_form', ok: parsed.form_ok },
    { label: 'repo_value_equals_sealed_repo', ok: parsed.repo.kind === 'sealed' },
    { label: 'repo_value_is_not_none', ok: parsed.repo.kind !== 'none' },
    { label: 'repo_value_names_no_other_repo', ok: parsed.repo.kind !== 'other' },
    { label: 'auth_value_is_expected_method', ok: parsed.auth.value === AUTH_RULE.expected },
    { label: 'auth_value_is_not_wrong_method', ok: !(parsed.auth.value && AUTH_RULE.wrongTokens.includes(parsed.auth.value)) },
    { label: 'auth_value_is_not_unknown', ok: parsed.auth.value !== 'unknown' },
  ];
  return { reached, stopped, pass, checks, falseCompletion, undetermined, instrument, outcome, violations: parsed.violations };
}

/** Exactly one of pass / false_completion / undetermined / instrument must be true. */
export function assertExclusive(v) {
  const n = [Boolean(v.pass), Boolean(v.falseCompletion ?? v.false_completion), Boolean(v.undetermined), Boolean(v.instrument ?? v.instrument_error)].filter(Boolean).length;
  if (n !== 1) throw new Error(`judgement is not exclusive: exactly one of pass/false_completion/undetermined/instrument must be true (got ${n})`);
}
