/**
 * Rules for kind_of_truth = llm_answer (M-004) — closed judgement, three-valued auth.
 * Nothing here is a sealed value: the seal holds only the official repository URL.
 * Everything a reviewer needs to re-run the judgement by hand is in this file.
 *
 *  1. Repository candidates: every repository-looking URL in the text, parsed as a whole
 *     URL and kept only when the hostname is exactly one of REPO_HOSTS. Scheme optional,
 *     scheme-less mentions must start at a boundary (never inside another URL/query).
 *     key = "host/owner/repo[/deeper…]"; a deeper path is a different key.
 *  2. Discover passes only when the set of NON-negated candidate keys equals {sealed}.
 *     Several candidates, or a single different one, is "undetermined" (discover stop).
 *  3. Denial of an official MCP is read per sentence; a sentence that carries a candidate
 *     URL is not a denial (its 非公式/unofficial negates that candidate instead).
 *  4. Auth verdict: 'affirmed' | 'false_completion' | 'undetermined' (see readAuthVerdict).
 */

export const AUTH_RULE = Object.freeze({
  expected: 'OAuth 2.0',
  wrongTokens: Object.freeze(['Basic', 'APIキー', 'API key']),
});

export const REPO_HOSTS = Object.freeze(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);

/** Sentence boundaries: 。！？ newline, or "." followed by whitespace/end (so "2.0" stays whole). */
export const SENTENCE_SPLIT = /(?<=[。！？!?\n])|(?<=\.)(?=\s|$)/;

const CANDIDATE_RE = /(?<![A-Za-z0-9./_@:=?&%-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)(?::\d+)?\/[^\s<>"'`()\[\]{}（）「」『』【】、。]+/gi;

export function extractRepoCandidates(text) {
  const out = [];
  const s = String(text || '');
  for (const m of s.matchAll(CANDIDATE_RE)) {
    const raw = m[0].replace(/[.,;:!?]+$/g, '');
    let url;
    try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!REPO_HOSTS.includes(host)) continue; // exact hostname: no subdomains, no lookalikes
    const segs = url.pathname.split('/').filter(Boolean).map((x) => x.toLowerCase().replace(/\.git$/, ''));
    if (segs.length < 2) continue;
    out.push({ raw: m[0], key: `${host}/${segs.join('/')}`, host, index: m.index, end: m.index + m[0].length });
  }
  return out;
}

const URL_NEG_AFTER = /^[^。.!?\n]{0,25}?(は非公式|は公式ではない|は公式ではありません|ではない|ではありません|じゃない|は違い|は違う|は無関係|は別|は古い|は廃止|は非推奨|ではなく|is\s+(?:not|unofficial|deprecated|a\s+fork|an\s+unofficial)|isn'?t|is\s+not\s+the)/i;
const URL_NEG_BEFORE = /(\bnot\b|\bno\b|n't\b|\bunofficial\b|\bnon-?official\b|\bfork\b|非公式の|非公式な|非公式[:：]|非公式版)[^.!?\n]{0,25}$/i;

/** A candidate is negated when its own sentence denies it (…は非公式／ではない／not the official …). */
export function urlNegated(text, cand) {
  const s = String(text || '');
  const sentStart = Math.max(s.lastIndexOf('。', cand.index), s.lastIndexOf('\n', cand.index), s.lastIndexOf('. ', cand.index)) + 1;
  const before = s.slice(Math.max(sentStart, cand.index - 40), cand.index);
  const after = s.slice(cand.end, cand.end + 40);
  return URL_NEG_AFTER.test(after) || URL_NEG_BEFORE.test(before);
}

/** { positive: Set<key>, negated: cand[], all: cand[] } */
export function repoCandidateSet(text) {
  const all = extractRepoCandidates(text);
  const negated = all.filter((c) => urlNegated(text, c));
  const positive = new Set(all.filter((c) => !negated.includes(c)).map((c) => c.key));
  return { all, negated, positive };
}

const DENIED_OFFICIAL_MCP = [
  /(公式|official)[^。.\n]{0,40}mcp[^。.\n]{0,40}(確認できない|確認できません|未確認|存在しない|存在しません|提供していない|提供されていない|提供していません|ありません|見当たらない|見つかりません|不明)/i,
  /mcp[^。.\n]{0,40}(公式ではない|公式ではありません)/i,
  /(?:^|[^a-z])非公式/i,
  /\b(no|not\s+an?|isn'?t\s+an?|without\s+an?)\s+official\s+mcp/i,
  /\bofficial\s+mcp[^.\n]{0,40}\b(not\s+(found|available|confirmed|exist|provided|published)|unconfirmed|unknown|does\s+not\s+exist)/i,
  /\b(unofficial|not\s+official|non-?official)\b/i,
  /\bthere\s+is\s+no\s+official\s+mcp/i,
];

/** Explicit denial that an official MCP exists, per sentence; sentences carrying a candidate are skipped. */
export function deniesOfficialMcp(text, candidates = []) {
  const s = String(text || '');
  let pos = 0;
  for (const sentence of s.split(SENTENCE_SPLIT)) {
    const from = pos, to = pos + sentence.length;
    pos = to;
    if (candidates.some((c) => c.index >= from && c.index < to)) continue;
    if (DENIED_OFFICIAL_MCP.some((re) => re.test(sentence))) return true;
  }
  return false;
}

/* ---- three-valued authentication verdict ---- */
const HYPOTHETICAL = /[?？]\s*$|(?:予定|将来|今後|検討中|検討して|かもしれ|可能性|場合|なら(?!い)|であれば|すれば|したら|されたら|ならば|ようです|らしい|と思われ|推測)|\b(?:will|would|could|might|may|planned|plans?\s+to|planning\s+to|in\s+the\s+future|if|whether|unless|should|probably|perhaps|likely|appears?\s+to|seems?\s+to)\b/i;
const OAUTH = 'oauth\\s*2(?:\\.0)?|oauth2';
const PAREN = '(?:\\s*(?:\\([^)]{0,40}\\)|（[^）]{0,40}）))?';
const JA_AFFIRM_SUFFIX = '(?:です|である|になります|を使(?:い|用し|用する|う)|を用い|を利用し|が標準|で認証|でも認証|に対応|をサポート|が必要|が必須|方式です|認証です|が使え|が利用でき|も選択|も利用|も使え|が可能)';
const OAUTH_AFFIRM = [
  new RegExp(`(?:${OAUTH})${PAREN}\\s*(?:の)?\\s*(?:bearer|access)?\\s*(?:トークン|tokens?)?${PAREN}\\s*${JA_AFFIRM_SUFFIX}`, 'i'),
  new RegExp(`(?:認証(?:方式)?|auth(?:entication)?(?:\\s+method)?)\\s*(?:は|:|：|=|is)\\s*(?:${OAUTH})`, 'i'),
  new RegExp(`\\b(?:uses?|using|supports?|requires?|via|with|through|based\\s+on|implements?|accepts?|offers?)\\s+(?:${OAUTH})`, 'i'),
  new RegExp(`(?:${OAUTH})\\s+(?:is|are)\\s+(?:used|required|supported|the\\s+(?:standard|default|method|only)|standard|mandatory)`, 'i'),
  new RegExp(`(?:${OAUTH})\\s*(?:bearer|access)\\s*tokens?`, 'i'),
  new RegExp(`(?:ではなく|でなく|ではなくて|\\bbut|\\binstead\\s+of\\s+basic[^,.]{0,20},?|\\brather\\s+than\\s+basic[^,.]{0,20},?)\\s*(?:${OAUTH})`, 'i'),
  new RegExp(`(?:${OAUTH})\\s*(?:,|、)?\\s*(?:not\\s+basic|not\\s+api\\s*key)`, 'i'),
];
const OAUTH_TOKEN = new RegExp(OAUTH, 'gi');
const DENY_AFTER = /^[^。.!?\n]{0,25}?(非対応|未対応|ではない|ではありません|じゃない|使わない|使いません|使えない|使えません|使用しない|使用しません|利用できない|利用できません|対応していない|対応していません|サポートしていない|サポートされていない|不可|できない|できません|ありません|ではなく|以外)/;
const DENY_BEFORE = /(\bnot\b|\bno\b|n't\b|\bwithout\b|\bnever\b|\bneither\b|\bnor\b)[^.!?\n]{0,25}$/i;
const WRONG_TOKENS = [
  { key: 'basic', re: /\bbasic\b(?:\s*(?:認証|auth(?:entication)?))?/gi },
  { key: 'apikey', re: /api\s*(?:キー|key)s?(?:\s*認証|\s*auth(?:entication)?)?/gi },
];
// window may contain "2.0": the sentence was already split, so '.' inside it is not a boundary
const EN_AFFIRM_VERB = /\b(?:uses?|using|supports?|requires?|via|with|through|accepts?|offers?|allows?|provides?|based\s+on)\b[^!?\n]{0,60}$/i;
const EN_AFFIRM_AFTER = /^\s*(?:is|are)\s+(?:used|required|supported|selectable|available|an\s+option|also\s+(?:supported|available|selectable|possible|an\s+option)|the\s+(?:standard|default|method)|standard|mandatory|possible)/i;
const JA_AFFIRM_AFTER = new RegExp(`^${PAREN}\\s*(?:を)?\\s*${JA_AFFIRM_SUFFIX}`);

/**
 * 'affirmed'          a present-tense affirmative whitelist match for OAuth 2.0, in a sentence that is
 *                     not a question / condition / future statement, and no explicit OAuth denial anywhere
 * 'false_completion'  an explicit present-tense affirmation of a wrong method (Basic, API key), or an
 *                     explicit denial of OAuth
 * 'undetermined'      everything else (silence, hedges, questions, future/conditional, ellipsis)
 */
export function readAuthVerdict(text) {
  let oauthAffirmed = false, oauthDenied = false, wrongAffirmed = false, hypotheticalMentions = 0;
  for (const sentence of String(text || '').split(SENTENCE_SPLIT)) {
    if (!/oauth|basic|api\s*(?:キー|key)/i.test(sentence)) continue;
    if (HYPOTHETICAL.test(sentence)) { hypotheticalMentions++; continue; }
    for (const m of sentence.matchAll(OAUTH_TOKEN)) {
      const before = sentence.slice(Math.max(0, m.index - 40), m.index).split(/\bbut\b|ではなく|でなく|instead\s+of|rather\s+than/i).pop();
      const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (DENY_AFTER.test(after) || DENY_BEFORE.test(before)) oauthDenied = true;
    }
    if (OAUTH_AFFIRM.some((re) => re.test(sentence))) oauthAffirmed = true;
    for (const tok of WRONG_TOKENS) {
      for (const m of sentence.matchAll(tok.re)) {
        const beforeRaw = sentence.slice(Math.max(0, m.index - 60), m.index);
        const before = beforeRaw.split(/\bbut\b|ではなく|でなく/i).pop();
        const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 40);
        if (DENY_AFTER.test(after) || DENY_BEFORE.test(before)) continue; // "not Basic", "Basic ではなく", "Basic は使えません"
        const affirmed = JA_AFFIRM_AFTER.test(after) || EN_AFFIRM_AFTER.test(after) || EN_AFFIRM_VERB.test(before)
          || /(?:認証(?:方式)?|auth(?:entication)?)\s*(?:は|:|：|=|is)\s*$/i.test(before);
        if (affirmed) wrongAffirmed = true;
      }
    }
  }
  const verdict = (wrongAffirmed || oauthDenied) ? 'false_completion' : oauthAffirmed ? 'affirmed' : 'undetermined';
  return { verdict, oauthAffirmed, oauthDenied, wrongAffirmed, hypotheticalMentions };
}

/** The whole llm_answer judgement, rules only. sealed = { repo: "github.com/owner/name", owner, name }. */
export function judgeLlmAnswer(obs, sealed) {
  const text = String(obs?.text || '');
  const cands = repoCandidateSet(text);
  const urlOk = cands.positive.size === 1 && cands.positive.has(sealed.repo);
  const urlAmbiguous = !urlOk && cands.positive.size > 0;           // other repo(s), deeper path, or several
  const deniedMcp = deniesOfficialMcp(text, cands.all);
  const auth = readAuthVerdict(text);
  const citedAny = /https?:\/\/\S+/i.test(text) || (obs?.citations || []).length > 0;
  let reached, stopped, falseCompletion = false, undetermined = false, instrument = null;
  if (obs?.error) { reached = 'discover'; stopped = 'discover'; instrument = 'provider_api'; }
  else if (!urlOk) { reached = 'discover'; stopped = 'discover'; falseCompletion = deniedMcp; undetermined = !deniedMcp && urlAmbiguous; }
  else if (deniedMcp) { reached = 'discover'; stopped = 'discover'; falseCompletion = true; }
  else if (auth.verdict === 'false_completion') { reached = 'understand'; stopped = 'understand'; falseCompletion = true; }
  else if (auth.verdict === 'undetermined') { reached = 'understand'; stopped = 'understand'; undetermined = true; }
  else { reached = 'done'; stopped = null; }
  const checks = [
    { label: 'candidate_set_equals_sealed_repo', ok: urlOk },
    { label: 'no_other_or_deeper_repo_candidate', ok: !urlAmbiguous },
    { label: 'denied_official_mcp_exists', ok: !deniedMcp },
    { label: 'auth_oauth2_affirmed_present_tense', ok: auth.oauthAffirmed },
    { label: 'auth_oauth2_not_denied', ok: !auth.oauthDenied },
    { label: 'auth_wrong_method_not_affirmed', ok: !auth.wrongAffirmed },
    { label: 'auth_verdict_determined', ok: auth.verdict !== 'undetermined' },
    { label: 'cited_any_url', ok: citedAny },
  ];
  return { reached, stopped, pass: reached === 'done' && !obs?.error, checks, falseCompletion, undetermined, instrument, auth: auth.verdict };
}
