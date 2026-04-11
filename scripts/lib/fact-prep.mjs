/**
 * Fact Preparation — Stage 1 of the 3-stage article pipeline.
 *
 * Deterministically collects ground-truth facts for a target article from:
 *   1. services-seed.json       (primary source of MCP status, endpoint, auth, trust)
 *   2. api-guides-seed.json     (rate limits, endpoints, quickstart)
 *   3. recipes-seed.json + recipes-new-75.json (real workflows referencing the service)
 *   4. (optional) GitHub/npm registry via fetch when a URL/package is detectable
 *
 * All missing fields are explicitly marked "unknown" so the Writer cannot
 * hallucinate numbers or names. The Writer prompt will forbid contradicting
 * any value in this Fact Sheet.
 *
 * Exports:
 *   prepareFactSheet(article)         — returns structured Fact Sheet object
 *   formatFactSheetForPrompt(sheet)   — returns markdown string for prompt injection
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');

// ────────────────────────────────────────────────────────────
// Data loading (cached)
// ────────────────────────────────────────────────────────────
let _services = null;
let _apiGuides = null;
let _recipes = null;

function loadServices() {
  if (_services) return _services;
  const p = path.join(DATA_DIR, 'services-seed.json');
  _services = JSON.parse(fs.readFileSync(p, 'utf8'));
  return _services;
}

function loadApiGuides() {
  if (_apiGuides) return _apiGuides;
  const p = path.join(DATA_DIR, 'api-guides-seed.json');
  if (!fs.existsSync(p)) {
    _apiGuides = [];
    return _apiGuides;
  }
  _apiGuides = JSON.parse(fs.readFileSync(p, 'utf8'));
  return _apiGuides;
}

function loadRecipes() {
  if (_recipes) return _recipes;
  const files = ['recipes-seed.json', 'recipes-new-75.json'];
  const all = [];
  for (const f of files) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) {
      try {
        const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(arr)) all.push(...arr);
      } catch {}
    }
  }
  _recipes = all;
  return _recipes;
}

// ────────────────────────────────────────────────────────────
// Service resolution — map article slug/keywords → service IDs
// ────────────────────────────────────────────────────────────
/**
 * Resolve services mentioned by the article. Handles slugs like:
 *   "kintone-mcp-guide"              → ["kintone"]
 *   "freee-mcp-accounting"           → ["freee"]
 *   "chatwork-vs-slack-mcp"          → ["chatwork", "slack"]
 *   "salesforce-japan-agent"         → ["salesforce-jp"]  (name fallback)
 *   "money-forward-mcp"              → ["moneyforward"]   (hyphen-insensitive)
 *   "notion-mcp-knowledge-base"      → ["notion"]         (NOT "base-ec")
 */
export function resolveServices(article) {
  const services = loadServices();
  const byId = new Map(services.map((s) => [s.id.toLowerCase(), s]));

  // Build the haystack in two forms:
  //   hay          = lowercased raw text (for whole-word matching)
  //   hayNorm      = hay with dashes/underscores removed (for "money-forward" → "moneyforward")
  const haySrc = [
    article.slug || '',
    article.title || '',
    ...(article.keywords || []),
  ]
    .join(' ')
    .toLowerCase();
  const hay = haySrc;
  const hayNorm = haySrc.replace(/[-_]/g, '');

  // Whole-word regex helper — treats non-alphanumeric as a word boundary.
  // Works for both ASCII and Japanese text (Japanese chars are non-alphanumeric
  // so they act as natural boundaries).
  const wholeWordRe = (term) =>
    new RegExp(`(^|[^a-z0-9])${escapeRe(term)}([^a-z0-9]|$)`, 'i');

  const matched = new Set();

  // ─── Pass 1: Direct ID as whole word ────────────────────────────────
  // Longest-first so "moneyforward" wins over "money" when both present.
  const sortedIds = [...byId.keys()].sort((a, b) => b.length - a.length);
  for (const id of sortedIds) {
    if (id.length < 3) continue;
    if (wholeWordRe(id).test(hay)) {
      matched.add(id);
    }
  }

  // ─── Pass 2: Hyphen-insensitive ID match ────────────────────────────
  // Catches "money-forward-mcp" → "moneyforward". Only for IDs ≥ 6 chars
  // to avoid false positives on short tokens.
  for (const id of sortedIds) {
    if (id.length < 6) continue;
    if (matched.has(id)) continue;
    const normId = id.replace(/[-_]/g, '');
    if (normId.length >= 6 && hayNorm.includes(normId)) {
      matched.add(id);
    }
  }

  // ─── Pass 3: Name fallback (whole-word, min length 5) ───────────────
  // Uses the service's display name (minus trailing " mcp") as a whole
  // word. "Salesforce Japan" → matches keyword "Salesforce Japan".
  //
  // Minimum length 5 to avoid false positives from common English suffix
  // words (e.g. BASE / "knowledge-base", Zoom / "room", Neon / "neon-lamp").
  // Short names (3-4 chars) like "Jira", "Slack", "Asana" are already
  // caught by Pass 1 via their IDs, which are whole-word matched.
  for (const s of services) {
    const id = s.id.toLowerCase();
    if (matched.has(id)) continue;
    const rawName = (s.name || '').toLowerCase().replace(/ mcp$/, '').trim();
    if (!rawName || rawName.length < 5) continue;
    if (wholeWordRe(rawName).test(hay)) {
      matched.add(id);
      continue;
    }
    // Name with spaces normalized to hyphens (e.g. "shopify japan" → "shopify-japan")
    // — this lets keyword "Shopify Japan" match slug "shopify-japan-mcp".
    if (rawName.includes(' ')) {
      const dashed = rawName.replace(/\s+/g, '-');
      if (wholeWordRe(dashed).test(hay)) {
        matched.add(id);
      }
    }
  }

  return [...matched].map((id) => byId.get(id)).filter(Boolean);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ────────────────────────────────────────────────────────────
// Enrich a service with api-guides + recipes + derived facts
// ────────────────────────────────────────────────────────────
function enrichService(service) {
  const guides = loadApiGuides();
  const recipes = loadRecipes();

  const guide = guides.find(
    (g) =>
      g.service_id === service.id ||
      g.id === service.id ||
      (g.name || '').toLowerCase() === (service.name || '').toLowerCase()
  );

  const relatedRecipes = recipes
    .filter((r) => {
      const steps = Array.isArray(r.steps) ? r.steps : [];
      const services = Array.isArray(r.services) ? r.services : [];
      return (
        services.includes(service.id) ||
        steps.some((st) => st?.service_id === service.id || st?.service === service.id)
      );
    })
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      name: r.name || r.title,
      goal: r.goal || r.description,
    }));

  // Human-readable MCP status
  const mcpStatusLabel = humanizeMcpStatus(service.mcp_status);

  // Resolve auth info from multiple possible locations. Many services leave
  // top-level api_auth_method empty and put auth details in the guide's
  // auth_overview (human-readable text) or auth_scopes / auth_token_url.
  let authMethod = service.api_auth_method || guide?.auth_method || '';
  if (!authMethod && guide?.auth_overview) {
    // Try to infer from the auth_overview text
    const txt = (guide.auth_overview || '').toLowerCase();
    if (/oauth\s*2/.test(txt)) authMethod = 'oauth2';
    else if (/bearer/.test(txt)) authMethod = 'bearer_token';
    else if (/api[\s_-]?key/.test(txt)) authMethod = 'api_key';
    else if (/token/.test(txt)) authMethod = 'bearer_token';
  }
  if (!authMethod && guide?.auth_token_url) authMethod = 'oauth2';
  const authOverview = guide?.auth_overview || '';

  return {
    id: service.id,
    name: service.name || 'unknown',
    namespace: service.namespace || 'unknown',
    description: service.description || 'unknown',
    category: service.category || 'unknown',
    tags: service.tags || '',
    // MCP facts (most frequently hallucinated)
    mcp_status: service.mcp_status || 'unknown',
    mcp_status_label: mcpStatusLabel,
    mcp_endpoint: service.mcp_endpoint || 'unknown',
    // API facts
    api_url: service.api_url || guide?.docs_url || guide?.base_url || 'unknown',
    api_auth_method: authMethod || 'unknown',
    auth_overview: authOverview || '',
    rate_limit: guide?.rate_limit || service.rate_limit || 'unknown',
    // Trust / quality
    trust_score:
      typeof service.trust_score === 'number' ? service.trust_score : 'unknown',
    // Relationships
    related_recipes: relatedRecipes,
    // Raw notes for the Writer
    has_official_mcp: service.mcp_status === 'official',
    has_community_mcp: service.mcp_status === 'community',
  };
}

function humanizeMcpStatus(status) {
  switch (status) {
    case 'official':
      return '公式MCPサーバーが提供されている（official）';
    case 'community':
      return 'コミュニティ製MCPラッパーが存在する（community）';
    case 'none':
    case 'planned':
      return 'MCPサーバーは未提供（2026年4月時点、公式・コミュニティとも未確認）';
    case undefined:
    case null:
    case '':
      return 'unknown（DBに明示的な記録なし）';
    default:
      return `${status}`;
  }
}

// ────────────────────────────────────────────────────────────
// Main: prepareFactSheet(article) → Fact Sheet object
// ────────────────────────────────────────────────────────────
export function prepareFactSheet(article) {
  const matched = resolveServices(article);
  const enriched = matched.map(enrichService);

  return {
    article: {
      slug: article.slug,
      title: article.title,
      category: article.category,
      keywords: article.keywords || [],
    },
    generated_at: new Date().toISOString(),
    services_in_scope: enriched,
    // Universal facts the Writer MUST NOT contradict
    global_facts: {
      current_date: '2026年4月10日',
      publication: 'KanseiLink / Synapse Arrows PTE. LTD.',
      db_source: 'services-seed.json (225 services)',
    },
    // Any service referenced above that has mcp_status=official
    confirmed_official_mcps: enriched
      .filter((s) => s.has_official_mcp)
      .map((s) => ({ id: s.id, name: s.name, endpoint: s.mcp_endpoint })),
  };
}

// ────────────────────────────────────────────────────────────
// Pretty-print the Fact Sheet for prompt injection
// ────────────────────────────────────────────────────────────
export function formatFactSheetForPrompt(sheet) {
  const lines = [];
  lines.push('# 確定事実（Fact Sheet） — 絶対に矛盾してはいけない');
  lines.push('');
  lines.push(
    '以下はKanseiLINKのサービスDB（services-seed.json, 225サービス）から直接抽出した事実です。'
  );
  lines.push(
    'これらの事実と矛盾する記述（例：「公式MCPは未発表」と書くが、DBでは `official`）は'
  );
  lines.push('絶対に禁止されます。DBにない情報は「unknown」と明示されています。');
  lines.push('');
  lines.push(`- 記事執筆時点: **${sheet.global_facts.current_date}**`);
  lines.push(`- 発行元: ${sheet.global_facts.publication}`);
  lines.push('');

  if (sheet.services_in_scope.length === 0) {
    lines.push('## 対象サービス');
    lines.push('');
    lines.push('この記事は特定のサービスに紐づかない一般論記事です。');
    lines.push(
      '実在するサービス名を出す場合は、KanseiLINK DBに存在することを前提に、断定表現を避けてください。'
    );
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## 対象サービスの確定事実');
  lines.push('');

  for (const s of sheet.services_in_scope) {
    lines.push(`### ${s.name} (id: \`${s.id}\`)`);
    lines.push('');
    lines.push(`- **MCP状態**: ${s.mcp_status_label}`);
    if (s.mcp_endpoint !== 'unknown') {
      lines.push(`- **MCPエンドポイント**: \`${s.mcp_endpoint}\``);
    }
    if (s.namespace !== 'unknown' && s.namespace) {
      lines.push(`- **Namespace**: \`${s.namespace}\``);
    }
    lines.push(`- **カテゴリ**: ${s.category}`);
    if (s.api_url !== 'unknown') {
      lines.push(`- **API ドキュメント**: ${s.api_url}`);
    }
    if (s.api_auth_method !== 'unknown') {
      lines.push(`- **API 認証方式**: ${s.api_auth_method}`);
    }
    if (s.auth_overview) {
      // First line only to keep prompt compact
      const firstLine = s.auth_overview.split('\n')[0].slice(0, 200);
      lines.push(`- **認証詳細**: ${firstLine}`);
    }
    if (s.rate_limit !== 'unknown') {
      lines.push(`- **レートリミット**: ${s.rate_limit}`);
    }
    if (typeof s.trust_score === 'number') {
      lines.push(`- **Trust Score（DB値）**: ${s.trust_score}`);
    }
    if (s.description && s.description !== 'unknown') {
      lines.push(`- **DB説明文**: ${s.description}`);
    }
    if (s.related_recipes && s.related_recipes.length > 0) {
      lines.push(`- **関連レシピ**（DBに登録されている実例）:`);
      for (const r of s.related_recipes) {
        lines.push(`    - ${r.name || r.id}${r.goal ? ` — ${r.goal}` : ''}`);
      }
    }
    lines.push('');
  }

  // Strict rules the Writer must follow
  lines.push('## 絶対遵守ルール（違反すると記事はリジェクトされます）');
  lines.push('');
  lines.push(
    '1. **DBが `official` と記録しているサービスについて「公式MCPは未発表」「未提供」と書いてはいけない。**'
  );
  lines.push(
    '2. **DBにない具体的な数値**（GitHubスター数、月間ユーザー数、レスポンスタイム、特定バージョン番号など）を創作してはいけない。一般論として書く場合は「事例によっては」「公式ドキュメント要確認」のような留保表現を使う。'
  );
  lines.push(
    '3. **DBにない架空のプロジェクト名・リポジトリ名・人物名**を挙げてはいけない（例: 存在しない「xxx-mcp-bridge」を「月間200スター以上」などと書くのは禁止）。'
  );
  lines.push(
    '4. **DBに記載のエンドポイント**を勝手に変えてはいけない。記事中でコマンド例を出す場合は、Fact Sheet の `mcp_endpoint` 値をそのまま使う。'
  );
  lines.push(
    '5. 記事執筆時点は **2026年4月10日** とする。「2026年4月時点で〜」と書く場合、その主張は Fact Sheet と整合していなければならない。'
  );
  lines.push(
    '6. DBに情報がない領域（例：ユーザー数、導入事例の詳細）に踏み込む場合は、断定せず「一般的には」「公開されている事例では」などの留保表現を使う。'
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// CLI: node scripts/lib/fact-prep.mjs <slug>
// ────────────────────────────────────────────────────────────
const isMain = (() => {
  try {
    const argvPath = path.resolve(process.argv[1] || '');
    const thisPath = fileURLToPath(import.meta.url);
    return path.resolve(thisPath) === argvPath;
  } catch {
    return false;
  }
})();

if (isMain) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/lib/fact-prep.mjs <article-slug>');
    process.exit(2);
  }
  const queuePath = path.join(ROOT, 'content', 'article-queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const article = queue.articles.find((a) => a.slug === slug);
  if (!article) {
    console.error(`article not found in queue: ${slug}`);
    process.exit(2);
  }
  const sheet = prepareFactSheet(article);
  console.log(JSON.stringify(sheet, null, 2));
  console.log('\n───── formatted for prompt ─────\n');
  console.log(formatFactSheetForPrompt(sheet));
}
