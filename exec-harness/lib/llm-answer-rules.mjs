/**
 * Rules for kind_of_truth = llm_answer (M-004) — CLOSED FORM (Michie 2026-09-27).
 *
 * Free-text interpretation is gone. The task prompt asks the model to end its answer with
 * exactly two lines, and the judge reads ONLY those two lines:
 *
 *     REPO: <one URL of the official MCP server repository, or none>
 *     AUTH: <OAuth 2.0 | Basic | API key | unknown>
 *
 * Everything else the model writes is kept in transcript.jsonl as evidence and never judged.
 * The prompt therefore leaks the option list (the "size of the guidance"); it is recorded in
 * the manifest as prompt_guidance so the reading can be discounted accordingly.
 *
 * Judgement (exactly one of pass / false_completion / undetermined / instrument is true):
 *   REPO = sealed                → discover passed
 *   REPO = none                  → discover stop, undetermined
 *   REPO = another URL           → discover stop, false_completion
 *   AUTH = OAuth 2.0 (with REPO = sealed) → done (pass)
 *   AUTH = Basic | API key       → understand stop, false_completion
 *   AUTH = unknown               → understand stop, undetermined
 *   missing/duplicated line, value outside the form, several URLs → format_violation:
 *                                  undetermined on the agent's side (NOT an instrument error)
 *
 * URL handling (①): scheme URLs are cut out of the text first as whole tokens and never
 * re-scanned inside; scheme-less candidates are taken only from the remaining text. Each
 * candidate is parsed with new URL() and must have an exact hostname from REPO_HOSTS.
 */

export const AUTH_RULE = Object.freeze({
  expected: 'OAuth 2.0',
  options: Object.freeze(['OAuth 2.0', 'Basic', 'API key', 'unknown']),
  wrongTokens: Object.freeze(['Basic', 'API key']),
});

export const REPO_HOSTS = Object.freeze(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);

/** The two lines appended to the task prompt (ja / en). Recorded in the manifest as prompt_guidance. */
export const ANSWER_FORMAT = Object.freeze({
  ja: '最後に、次の二行を「この形式そのまま」で書いてください（説明は二行の前に書く。二行の中に説明を混ぜない）:\nREPO: <公式 MCP サーバーのリポジトリ URL を 1 つだけ。無ければ none>\nAUTH: <OAuth 2.0 / Basic / API key / unknown のうち一つだけ>',
  en: 'Finish with exactly these two lines, in this exact form (explanations go before them; nothing else on these lines):\nREPO: <exactly one URL of the official MCP server repository, or none>\nAUTH: <exactly one of OAuth 2.0 / Basic / API key / unknown>',
  lines: 2,
  auth_options_listed: ['OAuth 2.0', 'Basic', 'API key', 'unknown'],
});

/* ---------- ① URL tokens ---------- */
const SCHEME_URL = /https?:\/\/[^\s<>"'`()\[\]{}（）「」『』【】、。]+/gi;
const BARE_HOST = /(?<![A-Za-z0-9./_@:=?&%-])(?:[a-z0-9-]+\.)*(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)(?::\d+)?\/[^\s<>"'`()\[\]{}（）「」『』【】、。]+/gi;

/** Whole URL tokens: scheme URLs first (their insides are never re-scanned), then scheme-less
 *  repo-host mentions taken only from the text outside those spans. Returns [{raw,index,end,scheme}]. */
export function extractUrlTokens(text) {
  const s = String(text || '');
  const tokens = [];
  for (const m of s.matchAll(SCHEME_URL)) tokens.push({ raw: m[0].replace(/[.,;:!?]+$/g, ''), index: m.index, end: m.index + m[0].length, scheme: true });
  // mask the scheme spans so scheme-less scanning cannot look inside them
  let masked = s;
  for (const t of tokens) masked = masked.slice(0, t.index) + ' '.repeat(t.end - t.index) + masked.slice(t.end);
  for (const m of masked.matchAll(BARE_HOST)) tokens.push({ raw: m[0].replace(/[.,;:!?]+$/g, ''), index: m.index, end: m.index + m[0].length, scheme: false });
  return tokens.sort((a, b) => a.index - b.index);
}

/** Parse one token as a repository URL. null unless hostname is exactly a REPO_HOST and the path has ≥2 segments.
 *  key = "host/owner/repo[/deeper]" (lowercase, .git stripped, query/fragment ignored). */
export function parseRepoUrl(raw) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!REPO_HOSTS.includes(host)) return null;
  const segs = url.pathname.split('/').filter(Boolean).map((x) => x.toLowerCase().replace(/\.git$/, ''));
  if (segs.length < 2) return null;
  return { host, key: `${host}/${segs.join('/')}`, segments: segs };
}

/** Repository candidates in free text (kept for evidence/inspection; not used by the judge). */
export function extractRepoCandidates(text) {
  return extractUrlTokens(text).map((t) => ({ ...t, ...(parseRepoUrl(t.raw) || {}) })).filter((t) => t.key);
}

/* ---------- (B) the two answer lines ---------- */
const LINE_RE = { REPO: /^\s*REPO\s*[:：]\s*(.*?)\s*$/gim, AUTH: /^\s*AUTH\s*[:：]\s*(.*?)\s*$/gim };
const AUTH_MAP = [
  { value: 'OAuth 2.0', re: /^(?:oauth\s*2(?:\.0)?|oauth2)$/i },
  { value: 'Basic', re: /^basic(?:\s*(?:auth(?:entication)?|認証))?$/i },
  { value: 'API key', re: /^api\s*(?:key|キー)$/i },
  { value: 'unknown', re: /^(?:unknown|不明)$/i },
];

/** Reads the two lines. Returns { repo: {kind:'sealed'|'other'|'none'|'invalid', key?}, auth: {value|null}, violations: [...] } */
export function parseAnswerLines(text, sealedKey) {
  const s = String(text || '');
  const violations = [];
  const repoLines = [...s.matchAll(LINE_RE.REPO)].map((m) => m[1]);
  const authLines = [...s.matchAll(LINE_RE.AUTH)].map((m) => m[1]);
  if (repoLines.length !== 1) violations.push(repoLines.length === 0 ? 'repo_line_missing' : 'repo_line_duplicated');
  if (authLines.length !== 1) violations.push(authLines.length === 0 ? 'auth_line_missing' : 'auth_line_duplicated');

  let repo = { kind: 'invalid', key: null };
  if (repoLines.length === 1) {
    const v = repoLines[0].trim().replace(/^[<"'「『]+|[>"'」』]+$/g, '').trim();
    if (/^none$/i.test(v)) repo = { kind: 'none', key: null };
    else {
      const tokens = extractUrlTokens(v);
      const leftover = tokens.reduce((acc, t) => acc.replace(t.raw, ''), v).replace(/[\s.]/g, '');
      if (tokens.length !== 1 || leftover.length) violations.push(tokens.length > 1 ? 'repo_line_several_urls' : 'repo_line_not_a_single_url');
      else {
        const parsed = parseRepoUrl(tokens[0].raw);
        if (!parsed) violations.push('repo_line_not_a_repo_url');
        else repo = { kind: parsed.key === sealedKey ? 'sealed' : 'other', key: parsed.key };
      }
    }
  }
  let auth = { value: null };
  if (authLines.length === 1) {
    const v = authLines[0].trim().replace(/^[<"'「『]+|[>"'」』]+$/g, '').trim();
    const hit = AUTH_MAP.find((a) => a.re.test(v));
    if (hit) auth = { value: hit.value }; else violations.push('auth_line_outside_form');
  }
  return { repo, auth, violations, repoLine: repoLines[0] ?? null, authLine: authLines[0] ?? null };
}

/** The whole llm_answer judgement, closed form. sealed = { repo: "github.com/owner/name" }. */
export function judgeLlmAnswer(obs, sealed) {
  const parsed = parseAnswerLines(obs?.text || '', sealed.repo);
  const repoOk = parsed.repo.kind === 'sealed';
  const repoViolation = parsed.violations.some((v) => v.startsWith('repo_line'));
  const authViolation = parsed.violations.some((v) => v.startsWith('auth_line'));
  let reached, stopped, pass = false, falseCompletion = false, undetermined = false, instrument = null, outcome;
  if (obs?.error) { reached = 'discover'; stopped = 'discover'; instrument = 'provider_api'; outcome = 'instrument'; }
  else if (repoViolation) { reached = 'discover'; stopped = 'discover'; undetermined = true; outcome = 'format_violation'; }
  else if (parsed.repo.kind === 'none') { reached = 'discover'; stopped = 'discover'; undetermined = true; outcome = 'repo_none'; }
  else if (parsed.repo.kind === 'other') { reached = 'discover'; stopped = 'discover'; falseCompletion = true; outcome = 'repo_other'; }
  else if (authViolation) { reached = 'understand'; stopped = 'understand'; undetermined = true; outcome = 'format_violation'; }
  else if (parsed.auth.value === AUTH_RULE.expected) { reached = 'done'; stopped = null; pass = true; outcome = 'pass'; }
  else if (parsed.auth.value === 'unknown') { reached = 'understand'; stopped = 'understand'; undetermined = true; outcome = 'auth_unknown'; }
  else { reached = 'understand'; stopped = 'understand'; falseCompletion = true; outcome = 'auth_wrong'; }
  const checks = [
    { label: 'two_lines_present_in_form', ok: parsed.violations.length === 0 },
    { label: 'repo_line_equals_sealed_repo', ok: repoOk },
    { label: 'repo_line_is_none', ok: parsed.repo.kind === 'none' },
    { label: 'repo_line_names_other_repo', ok: parsed.repo.kind !== 'other' },
    { label: 'auth_line_is_expected_method', ok: parsed.auth.value === AUTH_RULE.expected },
    { label: 'auth_line_is_wrong_method', ok: !(parsed.auth.value && AUTH_RULE.wrongTokens.includes(parsed.auth.value)) },
    { label: 'auth_line_is_unknown', ok: parsed.auth.value !== 'unknown' },
    { label: 'format_violation', ok: parsed.violations.length === 0 },
  ];
  return { reached, stopped, pass, checks, falseCompletion, undetermined, instrument, outcome, violations: parsed.violations };
}

/** Exactly one of pass / false_completion / undetermined / instrument must be true (⑤). */
export function assertExclusive(v) {
  const n = [Boolean(v.pass), Boolean(v.falseCompletion ?? v.false_completion), Boolean(v.undetermined), v.instrument != null && v.instrument !== undefined ? Boolean(v.instrument) : Boolean(v.instrument_error)].filter(Boolean).length;
  if (n !== 1) throw new Error(`judgement is not exclusive: exactly one of pass/false_completion/undetermined/instrument must be true (got ${n})`);
}
