/**
 * Fact-Checker — Stage 3 of the 3-stage article pipeline.
 *
 * Uses a small, fast model (Haiku) to verify a draft article against the
 * Fact Sheet produced in Stage 1. Returns a structured JSON verdict the
 * orchestrator can act on (pass / retry-with-feedback / manual-review).
 *
 * Cost target: ~¥2 per article (vs. ¥30 for the Opus Writer). This means
 * we can afford to run the Checker every time and retry once on failure
 * without significantly increasing total cost.
 *
 * Exports:
 *   checkArticle(markdown, factSheet, opts) → Promise<Verdict>
 *
 * Verdict shape:
 *   {
 *     verdict: "pass" | "fail",
 *     contradictions: [{ claim, contradicts, severity: "critical"|"major"|"minor" }],
 *     unverified_claims: string[],
 *     notes: string,
 *     raw: string,           // raw model response (for debugging)
 *     usage: object | null,  // Anthropic token usage
 *   }
 */

const CHECKER_MODEL =
  process.env.ANTHROPIC_CHECKER_MODEL || 'claude-haiku-4-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

// ────────────────────────────────────────────────────────────
// Prompt — strict JSON output, no prose
// ────────────────────────────────────────────────────────────
function buildCheckerPrompt(markdown, factSheet) {
  // Compact fact digest so the Checker focuses on the hard facts
  const digest = summarizeFactsForChecker(factSheet);

  return `あなたはKanseiLINK編集部の事実確認担当（ファクトチェッカー）です。
下記の「確定事実（Fact Sheet）」と「記事ドラフト」を読み、記事が確定事実と矛盾していないか検証してください。

# 確定事実（Fact Sheet）

${digest}

# 記事ドラフト

\`\`\`markdown
${markdown}
\`\`\`

# 検証ルール

以下のいずれかに該当する場合、その箇所を contradictions に列挙してください。

- **critical**: Fact Sheet に \`mcp_status: official\` と記載されているサービスについて「公式MCPは未提供」「未発表」「存在しない」と書いている
- **critical**: Fact Sheet の MCP endpoint と異なるエンドポイント/パッケージ名を具体的に記載している
- **critical**: Fact Sheet にない架空のリポジトリ名・プロジェクト名・人物名を具体的に挙げている（例: 実在しない「xxx-mcp-bridge」を「200スター以上」などと記載）
- **major**: Fact Sheet にない数値（GitHubスター数、月間ユーザー数、特定のレートリミット値など）を具体的な数字で断定している
- **major**: Fact Sheet の rate_limit と異なる数値を断定している
- **minor**: 軽微な表現の揺れや、Fact Sheet に裏付けがない主張を断定表現で書いている

また、Fact Sheet で検証できないが記事が断定しているその他の主張を unverified_claims に列挙してください。

# 出力フォーマット（厳守）

必ず次のJSON形式のみで返してください。前置き・後書き・マークダウンコードフェンスは禁止です。

{
  "verdict": "pass" | "fail",
  "contradictions": [
    {
      "claim": "記事中の該当表現（短く引用、15語以内）",
      "contradicts": "Fact Sheetのどの事実と矛盾するか",
      "severity": "critical" | "major" | "minor"
    }
  ],
  "unverified_claims": [
    "Fact Sheetで裏付けられない断定表現の要約"
  ],
  "notes": "短い総評（1〜2文）"
}

判定基準:
- contradictions に1件でも critical があれば verdict = "fail"
- critical がなく major が2件以上あれば verdict = "fail"
- それ以外は verdict = "pass"

今すぐJSONのみ出力してください。`;
}

function summarizeFactsForChecker(factSheet) {
  if (!factSheet || !Array.isArray(factSheet.services_in_scope)) {
    return '(この記事に紐づく具体的なサービスDBエントリはありません。架空のプロジェクト名・具体的数値の創作がないかを中心に検証してください。)';
  }
  if (factSheet.services_in_scope.length === 0) {
    return '(この記事に紐づく具体的なサービスDBエントリはありません。架空のプロジェクト名・具体的数値の創作がないかを中心に検証してください。)';
  }

  const lines = [];
  lines.push(`記事執筆時点: ${factSheet.global_facts?.current_date || '2026年4月10日'}`);
  lines.push('');
  for (const s of factSheet.services_in_scope) {
    lines.push(`## ${s.name} (id: ${s.id})`);
    lines.push(`- mcp_status: ${s.mcp_status}`);
    if (s.mcp_endpoint && s.mcp_endpoint !== 'unknown') {
      lines.push(`- mcp_endpoint: ${s.mcp_endpoint}`);
    }
    if (s.namespace && s.namespace !== 'unknown') {
      lines.push(`- namespace: ${s.namespace}`);
    }
    if (s.api_auth_method && s.api_auth_method !== 'unknown') {
      lines.push(`- api_auth_method: ${s.api_auth_method}`);
    }
    if (s.rate_limit && s.rate_limit !== 'unknown') {
      lines.push(`- rate_limit: ${s.rate_limit}`);
    }
    if (s.api_url && s.api_url !== 'unknown') {
      lines.push(`- api_url: ${s.api_url}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// Anthropic API call (Haiku, ~¥2/article)
// ────────────────────────────────────────────────────────────
async function callChecker(prompt) {
  if (!API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set (required by fact-checker)');
  }

  const url = `${BASE_URL.replace(/\/$/, '')}/v1/messages`;
  const body = {
    model: CHECKER_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Checker API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = await res.json();
  const text = (json.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return { text, usage: json.usage };
}

// ────────────────────────────────────────────────────────────
// JSON parsing with salvage (Haiku occasionally wraps in ```json)
// ────────────────────────────────────────────────────────────
function parseVerdict(raw) {
  let t = raw.trim();
  // Strip ``` or ```json fences if present
  t = t.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '').trim();

  // Extract the first top-level {...} block if there's stray text
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    t = t.slice(first, last + 1);
  }

  try {
    return JSON.parse(t);
  } catch (e) {
    throw new Error(`Checker returned unparseable JSON: ${e.message}\n---\n${raw.slice(0, 400)}`);
  }
}

// ────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────
/**
 * @param {string} markdown  The draft article markdown
 * @param {object} factSheet The Fact Sheet from prepareFactSheet()
 * @param {object} [opts]    Optional { verbose: boolean }
 * @returns {Promise<{
 *   verdict: 'pass'|'fail',
 *   contradictions: Array<{claim:string, contradicts:string, severity:string}>,
 *   unverified_claims: string[],
 *   notes: string,
 *   raw: string,
 *   usage: object|null,
 * }>}
 */
export async function checkArticle(markdown, factSheet, opts = {}) {
  const prompt = buildCheckerPrompt(markdown, factSheet);
  const { text, usage } = await callChecker(prompt);

  let parsed;
  try {
    parsed = parseVerdict(text);
  } catch (e) {
    // If parsing fails, return a conservative fail verdict so humans review it
    return {
      verdict: 'fail',
      contradictions: [],
      unverified_claims: [],
      notes: `Checker JSON parse failed: ${e.message}`,
      raw: text,
      usage,
    };
  }

  const verdict = parsed.verdict === 'pass' ? 'pass' : 'fail';
  const contradictions = Array.isArray(parsed.contradictions)
    ? parsed.contradictions
    : [];
  const unverified_claims = Array.isArray(parsed.unverified_claims)
    ? parsed.unverified_claims
    : [];
  const notes = typeof parsed.notes === 'string' ? parsed.notes : '';

  // Defensive override: if any critical contradiction, force fail
  const hasCritical = contradictions.some((c) => c.severity === 'critical');
  const majorCount = contradictions.filter((c) => c.severity === 'major').length;
  const finalVerdict = hasCritical || majorCount >= 2 ? 'fail' : verdict;

  return {
    verdict: finalVerdict,
    contradictions,
    unverified_claims,
    notes,
    raw: text,
    usage,
  };
}

/**
 * Turn a fail verdict into a feedback block that can be appended to the
 * Writer prompt on retry.
 */
export function formatVerdictForRetry(verdict) {
  const lines = [];
  lines.push('# 前回のドラフトで検出された問題');
  lines.push('');
  lines.push(
    '以下の問題を全て修正してください。特に critical の項目は絶対に繰り返してはいけません。'
  );
  lines.push('');
  if (verdict.contradictions.length > 0) {
    lines.push('## 事実矛盾');
    for (const c of verdict.contradictions) {
      lines.push(`- [${c.severity}] "${c.claim}" — ${c.contradicts}`);
    }
    lines.push('');
  }
  if (verdict.unverified_claims.length > 0) {
    lines.push('## 裏付けのない断定');
    for (const u of verdict.unverified_claims) {
      lines.push(`- ${u}`);
    }
    lines.push('');
  }
  if (verdict.notes) {
    lines.push(`## レビュアーメモ`);
    lines.push(verdict.notes);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}
