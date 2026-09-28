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
 *      AUTH, each on one physical line with a non-empty value; REPO value is "none" or exactly one
 *      repository URL token (optionally wrapped in <> or quotes); AUTH value is one of the options.
 *      Any failure → format_violation = the agent's own undetermined (not an instrument error),
 *      whatever the REPO content would have been.
 *   2. CONTENT: REPO = sealed → discover passed; none → discover, undetermined; another repo URL →
 *      discover, false_completion. With REPO = sealed: AUTH = OAuth 2.0 → done; Basic / API key →
 *      understand, false_completion; unknown → understand, undetermined.
 * Exactly one of pass / false_completion / undetermined / instrument is true.
 *
 * URL handling: a REPO value is parsed with new URL(); the hostname is compared to REPO_HOSTS
 * exactly as parsed (no "www." stripping); ".git" is removed only from the end of the repository
 * name (second path segment); query and fragment are ignored.
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

/* ---------- URL tokens (used for the REPO value) ---------- */
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

/** Parse one token as a repository URL, or null. Hostname compared exactly as parsed (lowercase by
 *  the URL parser); "www.github.com" is a different host. ".git" stripped only from the repository
 *  name (segment 2). key = "host/owner/repo[/deeper…]". */
export function parseRepoUrl(raw) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname; // WHATWG URL lowercases the host; no further normalisation
  if (!REPO_HOSTS.includes(host)) return null;
  let segs;
  try { segs = url.pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x).toLowerCase()); } catch { return null; }
  if (segs.length < 2) return null;
  segs[1] = segs[1].replace(/\.git$/, '');
  if (!segs[1]) return null;
  return { host, key: `${host}/${segs.join('/')}`, segments: segs };
}

/* ---------- the answer region: last two non-empty physical lines ---------- */
// ASCII label, ASCII colon, spaces/tabs only (never a newline) around the value.
const LINE_FORM = { REPO: /^[ \t]*REPO:[ \t]*(\S(?:.*\S)?)[ \t]*$/i, AUTH: /^[ \t]*AUTH:[ \t]*(\S(?:.*\S)?)[ \t]*$/i };
const AUTH_MAP = [
  { value: 'OAuth 2.0', re: /^(?:oauth[ ]?2(?:\.0)?|oauth2)$/i },
  { value: 'Basic', re: /^basic(?:[ ]?(?:auth(?:entication)?|認証))?$/i },
  { value: 'API key', re: /^api[ ]?(?:key|キー)$/i },
  { value: 'unknown', re: /^(?:unknown|不明)$/i },
];
const unwrap = (v) => { const m = v.match(/^(?:<(.*)>|"(.*)"|'(.*)'|「(.*)」|『(.*)』)$/); return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).trim() : v; };

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
      const tokens = extractUrlTokens(v);
      if (tokens.length !== 1 || tokens[0].raw !== v) violations.push(tokens.length > 1 ? 'repo_value_several_urls' : 'repo_value_not_exactly_one_url');
      else {
        const parsed = parseRepoUrl(tokens[0].raw);
        if (!parsed) violations.push('repo_value_not_a_repository_url');
        else repoForm = { kind: 'url', key: parsed.key };
      }
    }
  }
  // AUTH value form
  let authValue = null;
  if (am) {
    const v = unwrap(am[1]);
    const hit = AUTH_MAP.find((a) => a.re.test(v));
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
