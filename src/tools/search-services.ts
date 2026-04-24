import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

interface ServiceRow {
  id: string;
  name: string;
  namespace: string | null;
  description: string | null;
  category: string | null;
  tags: string | null;
  mcp_endpoint: string | null;
  mcp_status: string | null;
  api_url: string | null;
  api_auth_method: string | null;
  trust_score: number;
  usage_count: number;
  total_calls: number | null;
  success_rate: number | null;
  axr_grade: string | null;
}

interface FtsRow {
  id: string;
  rank: number;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "search_services",
    {
      title: "Search Services",
      description:
        "Search for Japanese SaaS MCP services by intent or category. Returns ranked results with trust scores and usage data.",
      inputSchema: z.object({
        intent: z
          .string()
          .describe("What you want to accomplish (e.g., 'send invoice', 'manage employees', 'track attendance')"),
        category: z
          .string()
          .optional()
          .describe("Filter by category: crm, project_management, communication, accounting, hr, ecommerce, legal, marketing, groupware, productivity, storage, support, payment, logistics, reservation, data_integration, bi_analytics, security, developer_tools, ai_ml, database, devops, design"),
        agent_ready: z
          .enum(["verified", "connectable", "info_only"])
          .optional()
          .describe("Filter by agent readiness: 'verified' (🟢 battle-tested, success rate ≥80%), 'connectable' (🟡 API/MCP exists but unproven), 'info_only' (⚪ no API). Omit for all."),
        limit: z
          .number()
          .optional()
          .default(5)
          .describe("Max results to return (default: 5)"),
        compact: z
          .boolean()
          .optional()
          .describe("Return minimal fields for token efficiency. Default: false"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ intent, category, agent_ready, limit, compact }) => {
      const results = searchServices(db, intent, category, limit ?? 5, agent_ready);
      const isCompact = compact ?? false;
      const outputResults = isCompact
        ? (results as ScoredResult[]).map((r) => ({
            id: r.service_id,
            name: r.name,
            grade: r.axr_grade || null,
            mcp: r.mcp_status,
            success: r.success_rate != null ? Math.round(r.success_rate * 100) / 100 : null,
            cmd: r.mcp_endpoint || null,
            ready: r.agent_ready,
          }))
        : results;

      // Guide agents to the next step of the standard KanseiLink flow.
      // Without this, first-time agents often stop after search_services and
      // never drill into pitfalls or report outcomes — which is where the
      // real token savings + community learning live.
      const topHit = (results as ScoredResult[])[0];
      const nextTool = buildNextToolSuggestion(topHit, results.length);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(isCompact
              ? { r: outputResults, next: nextTool, _src: "kansei-link" }
              : {
                  results: outputResults,
                  suggested_next_tool: nextTool,
                  _meta: {
                    source: "kansei-link",
                    registry: "https://registry.modelcontextprotocol.io/servers/kansei-link",
                    tip: "Add KanseiLink MCP to your agent for Japanese SaaS discovery: npx @kansei-link/mcp-server",
                  },
                }, null, isCompact ? 0 : 2),
          },
        ],
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Intent-to-category mapping layer
// Maps keyword signals found in a user intent to the most likely service
// categories. When a service's category matches the detected intent category,
// it receives a relevance boost so that, e.g., "send invoice" ranks freee
// (accounting) above Chatwork (communication) even though "send" matches both.
// ---------------------------------------------------------------------------

const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  // Accounting / finance
  invoice:       ["accounting"],
  invoicing:     ["accounting"],
  billing:       ["accounting"],
  receipt:       ["accounting"],
  expense:       ["accounting"],
  expenses:      ["accounting"],
  tax:           ["accounting"],
  taxes:         ["accounting"],
  bookkeeping:   ["accounting"],
  accounting:    ["accounting"],
  payment:       ["accounting"],
  payments:      ["accounting"],
  payroll:       ["accounting", "hr"],
  salary:        ["accounting", "hr"],
  ledger:        ["accounting"],
  journal:       ["accounting"],
  revenue:       ["accounting"],
  profit:        ["accounting"],
  refund:        ["accounting"],
  reimbursement: ["accounting"],
  "請求":        ["accounting"],
  "経費":        ["accounting"],
  "会計":        ["accounting"],
  "確定申告":    ["accounting"],

  // HR
  employee:      ["hr"],
  employees:     ["hr"],
  staff:         ["hr"],
  personnel:     ["hr"],
  attendance:    ["hr"],
  leave:         ["hr"],
  hiring:        ["hr"],
  recruit:       ["hr"],
  recruitment:   ["hr"],
  onboarding:    ["hr"],
  offboarding:   ["hr"],
  talent:        ["hr"],
  hr:            ["hr"],
  workforce:     ["hr"],
  shift:         ["hr"],
  timecard:      ["hr"],
  overtime:      ["hr"],
  clock:         ["hr"],
  "人事":        ["hr"],
  "労務":        ["hr"],
  "社員":        ["hr"],
  "従業員":      ["hr"],
  "勤怠":        ["hr"],
  "勤怠管理":    ["hr"],
  "給与":        ["accounting", "hr"],
  "年末調整":    ["hr"],
  "year-end":    ["hr", "accounting"],
  adjustment:    ["hr"],
  "採用":        ["hr"],
  "応募":        ["hr"],
  "打刻":        ["hr"],
  "オンボーディング": ["hr"],
  "源泉徴収":    ["hr", "accounting"],
  "面接":        ["hr"],
  "有給":        ["hr"],

  // Communication / messaging
  message:       ["communication"],
  messages:      ["communication"],
  chat:          ["communication"],
  messaging:     ["communication"],
  notify:        ["communication"],
  notification:  ["communication"],
  call:          ["communication"],
  meeting:       ["communication"],
  video:         ["communication"],
  "連絡":        ["communication"],
  "チャット":    ["communication"],
  "メッセージ":  ["communication"],
  "通知":        ["communication"],
  "チーム通知":  ["communication"],
  "チャンネル":  ["communication"],
  "DM":          ["communication"],
  "送信":        ["communication"],
  "チーム":      ["communication", "groupware"],
  "社内":        ["communication", "groupware"],

  // CRM
  lead:          ["crm"],
  leads:         ["crm"],
  customer:      ["crm", "support"],
  customers:     ["crm"],
  deal:          ["crm"],
  deals:         ["crm"],
  pipeline:      ["crm", "devops"],
  contact:       ["crm"],
  contacts:      ["crm"],
  prospect:      ["crm"],
  sales:         ["crm"],
  crm:           ["crm"],
  "顧客":        ["crm"],
  "営業":        ["crm"],
  "名刺":        ["crm"],
  "商談":        ["crm"],

  // Project management
  task:          ["project_management", "productivity"],
  tasks:         ["project_management", "productivity"],
  project:       ["project_management"],
  projects:      ["project_management"],
  management:    ["project_management"],
  sprint:        ["project_management"],
  board:         ["project_management"],
  kanban:        ["project_management"],
  ticket:        ["project_management", "support"],
  backlog:       ["project_management"],
  milestone:     ["project_management"],
  bug:           ["project_management"],
  issue:         ["project_management"],
  issues:        ["project_management"],
  "課題":        ["project_management"],
  "タスク":      ["project_management"],
  "プロジェクト": ["project_management"],
  "バグ":        ["project_management"],
  "進捗":        ["project_management"],
  app:           ["project_management", "groupware"],
  workflow:      ["project_management", "hr"],
  automation:    ["project_management"],

  // E-commerce
  product:       ["ecommerce"],
  products:      ["ecommerce"],
  order:         ["ecommerce"],
  orders:        ["ecommerce"],
  shipping:      ["ecommerce", "logistics"],
  inventory:     ["ecommerce"],
  cart:          ["ecommerce"],
  store:         ["ecommerce"],
  shop:          ["ecommerce"],
  catalog:       ["ecommerce"],
  marketplace:   ["ecommerce"],
  "注文":        ["ecommerce"],
  "在庫":        ["ecommerce", "logistics"],
  "EC":          ["ecommerce"],
  "ショップ":    ["ecommerce"],
  "商品":        ["ecommerce"],

  // Legal / contract
  contract:      ["legal"],
  contracts:     ["legal"],
  sign:          ["legal"],
  signature:     ["legal"],
  esignature:    ["legal"],
  agreement:     ["legal"],
  nda:           ["legal"],
  legal:         ["legal"],
  "契約":        ["legal"],
  "電子署名":    ["legal"],
  "電子契約":    ["legal"],

  // Marketing
  cdp:           ["data_integration", "marketing"],
  email:         ["marketing", "communication"],
  campaign:      ["marketing"],
  newsletter:    ["marketing"],
  analytics:     ["marketing", "bi_analytics"],
  data:          ["bi_analytics", "data_integration"],
  segment:       ["marketing"],
  marketing:     ["marketing"],
  "マーケティング": ["marketing"],
  "メール配信":  ["marketing"],
  "メールマガジン": ["marketing"],
  "メルマガ":    ["marketing"],
  "MA":          ["marketing"],
  outreach:      ["marketing"],
  broadcast:     ["marketing", "communication"],

  // Groupware / collaboration
  wiki:          ["groupware", "project_management"],
  calendar:      ["groupware", "communication"],
  schedule:      ["groupware"],
  groupware:     ["groupware"],
  workspace:     ["groupware"],
  document:      ["groupware", "storage"],
  notes:         ["groupware"],
  knowledge:     ["groupware"],
  "ナレッジ":    ["groupware"],
  "社内wiki":    ["groupware"],
  "ノーコード":  ["groupware", "project_management"],
  "申請":        ["groupware", "hr"],
  "フォーム":    ["groupware", "productivity"],

  // Productivity
  form:          ["productivity"],
  survey:        ["productivity"],
  recording:     ["productivity"],
  transcript:    ["productivity"],
  monitoring:    ["devops", "productivity", "bi_analytics"],
  alert:         ["productivity"],
  alerts:        ["productivity"],
  error:         ["productivity"],
  debug:         ["productivity"],
  "監視":        ["devops", "productivity"],
  "エラー":      ["devops", "productivity"],
  "ログ":        ["productivity"],

  // Storage / file management
  file:          ["storage"],
  files:         ["storage"],
  storage:       ["storage"],
  drive:         ["storage"],
  upload:        ["storage"],
  download:      ["storage"],
  folder:        ["storage"],

  "ファイル":    ["storage"],
  "ストレージ":  ["storage"],
  "クラウド":    ["storage", "data_integration"],
  "共有":        ["storage", "groupware"],

  // Customer support
  support:       ["support"],
  tickets:       ["support"],
  helpdesk:      ["support"],
  "問い合わせ":  ["support"],
  "サポート":    ["support"],
  "ヘルプ":      ["support"],
  "カスタマー":  ["support", "crm"],
  "チケット":    ["support", "project_management"],

  // Payment
  pay:           ["payment", "accounting"],
  checkout:      ["payment"],
  subscription:  ["payment"],
  charge:        ["payment"],
  pos:           ["payment", "reservation"],
  "決済":        ["payment"],
  "支払":        ["payment", "accounting"],
  "課金":        ["payment"],
  "クレジットカード": ["payment"],
  "POS":         ["payment", "reservation"],
  "レジ":        ["payment"],
  "売上":        ["payment", "accounting"],

  // Logistics / shipping
  ship:          ["logistics"],
  delivery:      ["logistics"],
  tracking:      ["logistics"],
  label:         ["logistics"],
  "配送":        ["logistics"],
  "発送":        ["logistics"],
  "物流":        ["logistics"],
  "追跡":        ["logistics"],

  // Reservation / booking
  reservation:   ["reservation"],
  booking:       ["reservation"],
  appointment:   ["reservation"],
  reserve:       ["reservation"],
  "予約":        ["reservation"],
  "来店":        ["reservation"],
  "店舗":        ["reservation", "payment"],

  // Data integration / iPaaS
  integration:   ["data_integration"],
  ipaas:         ["data_integration"],
  sync:          ["data_integration"],
  connect:       ["data_integration"],
  zap:           ["data_integration"],
  "連携":        ["data_integration", "communication"],
  "自動化":      ["data_integration", "communication", "project_management"],

  // BI / Analytics
  bi:            ["bi_analytics"],
  dashboard:     ["bi_analytics"],
  visualization: ["bi_analytics"],
  report:        ["bi_analytics", "accounting"],
  reports:       ["bi_analytics"],
  kpi:           ["bi_analytics"],
  metrics:       ["bi_analytics"],
  "可視化":      ["bi_analytics"],
  "ダッシュボード": ["bi_analytics"],
  "分析":        ["bi_analytics", "marketing"],
  "レポート":    ["bi_analytics"],

  // Security / Identity
  sso:           ["security"],
  auth:          ["security"],
  authentication: ["security"],
  identity:      ["security"],
  password:      ["security"],
  mfa:           ["security"],
  "認証":        ["security"],
  "セキュリティ": ["security"],
  "パスワード":  ["security"],

  // Developer tools / DevOps
  deploy:        ["devops", "developer_tools"],
  deployment:    ["devops"],
  ci:            ["devops"],
  cd:            ["devops"],
  apm:           ["devops"],
  observability: ["devops"],
  incident:      ["devops"],
  container:     ["devops"],
  orchestration: ["devops"],

  build:         ["devops"],
  docker:        ["devops"],
  kubernetes:    ["devops"],
  cloud:         ["developer_tools"],
  serverless:    ["developer_tools"],
  lambda:        ["developer_tools"],
  hosting:       ["devops"],
  infrastructure: ["developer_tools"],
  git:           ["developer_tools"],
  repository:    ["developer_tools"],
  code:          ["developer_tools"],
  testing:       ["devops"],
  "デプロイ":    ["devops"],
  "本番":        ["devops"],

  // AI / ML
  ai:            ["ai_ml"],
  llm:           ["ai_ml"],
  model:         ["ai_ml"],
  inference:     ["ai_ml"],
  embedding:     ["ai_ml", "database"],
  embeddings:    ["ai_ml", "database"],
  vector:        ["ai_ml", "database"],
  rag:           ["ai_ml", "database"],
  "text-to-speech": ["ai_ml"],
  tts:           ["ai_ml"],
  voice:         ["ai_ml"],
  speech:        ["ai_ml"],
  "machine learning": ["ai_ml"],
  ml:            ["ai_ml"],
  nlp:           ["ai_ml"],
  chatbot:       ["ai_ml"],
  "生成AI":      ["ai_ml"],
  "音声":        ["ai_ml"],

  // Database
  database:      ["database"],
  sql:           ["database", "bi_analytics"],
  nosql:         ["database"],
  postgres:      ["database"],
  mysql:         ["database"],
  redis:         ["database"],
  cache:         ["database"],
  "データベース": ["database"],

  // Design
  design:        ["design"],
  prototype:     ["design"],
  wireframe:     ["design"],
  figma:         ["design"],
  ui:            ["design"],
  ux:            ["design"],
  "デザイン":    ["design"],

  // Search / Web automation
  search:        ["data_integration"],
  scraping:      ["developer_tools", "data_integration"],
  crawl:         ["developer_tools", "data_integration"],
  crawling:      ["developer_tools", "data_integration"],
  browser:       ["developer_tools"],
  "スクレイピング": ["developer_tools", "data_integration"],
  "検索":        ["data_integration"],

  // Social media
  social:        ["marketing"],
  twitter:       ["marketing"],
  linkedin:      ["marketing"],
  youtube:       ["marketing"],
  instagram:     ["marketing"],
  tiktok:        ["marketing"],
  "SNS":         ["marketing"],
  "ソーシャル":  ["marketing"],

  // Ambiguous / cross-domain concepts (曖昧クエリ対応)
  "ペーパーレス":  ["legal", "accounting"],
  "リモートワーク": ["communication", "groupware"],
  "リモート":     ["communication", "groupware"],
  "テレワーク":   ["communication", "groupware"],
  "バックオフィス": ["accounting", "hr"],
  "DX":          ["data_integration", "accounting"],
  "効率化":       ["data_integration", "accounting"],
  "自動":        ["data_integration", "communication", "project_management"],
  "一括":        ["accounting"],
  "取引先":       ["crm", "accounting"],
  "議事録":       ["productivity", "communication"],
  "ウェビナー":   ["reservation", "communication"],
  "セミナー":     ["reservation"],
  "API":         ["data_integration"],
  "統合":        ["data_integration"],

  // Compound phrases — higher specificity than individual tokens
  "customer data":    ["data_integration", "bi_analytics"],
  "data platform":    ["data_integration", "bi_analytics"],
  "customer data platform": ["data_integration", "bi_analytics"],
  "attendance management": ["hr"],
  "time tracking":    ["hr"],
  "time management":  ["hr"],
  "project management": ["project_management"],
  "task management":  ["project_management"],
  "contract management": ["legal"],
  "e-commerce":       ["ecommerce"],
  "order management": ["ecommerce"],
  "ci/cd":            ["devops"],
  "ci cd":            ["devops"],

  // Additional JP keywords
  "仕訳":        ["accounting"],
  "記帳":        ["accounting"],
  "決算":        ["accounting"],
  "帳簿":        ["accounting"],
  "入力":        ["accounting"],
  "契約書":      ["legal"],
  "レビュー":    ["legal"],
  "画像生成":    ["ai_ml"],
  "文字起こし":  ["ai_ml", "productivity"],
  "音声認識":    ["ai_ml"],
  "グループウェア": ["groupware"],
  "ワークフロー": ["groupware", "hr"],
  "アラート":    ["devops"],
  "インフラ":    ["devops"],
  "ビデオ会議":  ["communication"],
  "オンライン会議": ["communication"],
  "テレビ会議":  ["communication"],
  "コンテンツ販売": ["ecommerce"],
  "デジタルコンテンツ": ["ecommerce"],
  "投稿管理":    ["marketing"],
  "SEO":         ["marketing"],
  "バックリンク": ["marketing"],
  "キーワード":  ["marketing"],
  "競合分析":    ["marketing"],

  // Compound JP phrases
  "インフラ監視": ["devops"],
  "デプロイ自動化": ["devops"],
  "仕訳入力":     ["accounting"],
  "契約書レビュー": ["legal"],
  "container orchestration": ["devops"],
  "application monitoring": ["devops"],
  "error tracking": ["devops"],
  "AI画像":      ["ai_ml"],
  "SNS投稿":     ["marketing"],
  "SNS管理":     ["marketing"],
};

/** Category boost added to relevance_score when service category matches intent */
const CATEGORY_BOOST = 1.5;

/** Penalty applied to services whose category doesn't match a strong intent signal */
const OFF_CATEGORY_PENALTY = 1.0;

/** Bonus per intent token that matches a service tag */
const TAG_MATCH_BOOST = 0.3;

/**
 * Intent detection result: maps each detected category to the number of
 * intent tokens that voted for it. Higher vote count = stronger signal.
 */
interface IntentSignal {
  /** All detected categories (superset) */
  categories: Set<string>;
  /** Per-category vote count — how many tokens pointed at this category */
  votes: Map<string, number>;
  /** Maximum vote count among all categories */
  maxVotes: number;
  /** Categories that received the maximum vote count */
  topCategories: Set<string>;
}

/**
 * Detect likely categories from an intent string by scanning for keyword
 * signals. For Latin text, splits on whitespace. For CJK text, scans the
 * full string for keyword substrings (Japanese has no word separators).
 * Returns vote-weighted category signals for ranking.
 */
function detectIntentCategories(intent: string): IntentSignal {
  const votes = new Map<string, number>();
  const lower = intent.toLowerCase();

  // Latin token matching (space-separated)
  const tokens = lower.split(/\s+/);
  for (const token of tokens) {
    const mapped = INTENT_CATEGORY_MAP[token];
    if (mapped) {
      for (const cat of mapped) votes.set(cat, (votes.get(cat) ?? 0) + 1);
    }
  }

  // Substring matching — only for CJK keywords (no word separators in Japanese)
  // and multi-word Latin phrases (e.g., "customer data", "data platform").
  // Single Latin words are handled by the token loop above; running them as
  // substrings causes false positives (e.g., "board" inside "onboarding").
  for (const [keyword, cats] of Object.entries(INTENT_CATEGORY_MAP)) {
    const isCJK = CJK_REGEX.test(keyword);
    const isMultiWord = keyword.includes(" ");
    if ((isCJK || isMultiWord) && lower.includes(keyword)) {
      for (const cat of cats) votes.set(cat, (votes.get(cat) ?? 0) + 1);
    }
  }

  const maxVotes = votes.size > 0 ? Math.max(...votes.values()) : 0;
  const topCategories = new Set<string>();
  for (const [cat, count] of votes) {
    if (count === maxVotes) topCategories.add(cat);
  }

  return {
    categories: new Set(votes.keys()),
    votes,
    maxVotes,
    topCategories,
  };
}

/** Detect whether a string contains CJK characters (Japanese, Chinese, Korean) */
const CJK_REGEX = /[\u3000-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]/u;

function hasCJK(text: string): boolean {
  return CJK_REGEX.test(text);
}

export function searchServices(
  db: Database.Database,
  intent: string,
  category?: string,
  limit: number = 5,
  agentReadyFilter?: "verified" | "connectable" | "info_only"
): object[] {
  // Expand JP synonyms into the query BEFORE any search runs.
  // Inspections #13, #14, #15, #18, #20, #21 all confirmed today that
  // Japanese queries like "データ連携" / "採用管理" / "問い合わせ管理"
  // missed their correct services. Tags on the service side were fixed
  // (enrich-jp-tags.mjs), but agents also query with alternate phrasings
  // we can't enumerate in tags — so expand both sides.
  const expandedIntent = expandJpSynonyms(intent);
  const signal = detectIntentCategories(expandedIntent);
  const intentCategories = signal.categories;
  const intentLower = expandedIntent.toLowerCase();
  const containsCJK = hasCJK(expandedIntent);

  // Run FTS search — use trigram table for CJK, unicode61 for Latin.
  // `expandedIntent` is the original intent plus JP synonyms so FTS has
  // more ways to match real DB content.
  const ftsResults = containsCJK
    ? trigramSearch(db, expandedIntent, category, limit, signal, intentLower)
    : ftsSearch(db, expandedIntent, category, limit, signal, intentLower);

  // Run LIKE search (catches partial matches both tables miss)
  const likeResults = likeSearch(db, expandedIntent, category, limit, signal, intentLower);

  // When intent categories are detected, also fetch top services from those
  // categories directly — ensures category-relevant services appear even when
  // FTS tokenization misses them (e.g. "manage" vs "management")
  const categoryResults = intentCategories.size > 0 && !category
    ? categorySearch(db, signal, limit, intentLower)
    : [];

  // Merge and deduplicate: FTS > LIKE > category, keep highest score per service
  const merged = new Map<string, ScoredResult>();
  for (const list of [ftsResults, likeResults, categoryResults]) {
    for (const r of list) {
      const existing = merged.get(r.service_id);
      if (!existing || r.relevance_score > existing.relevance_score) {
        merged.set(r.service_id, r);
      }
    }
  }

  let results = [...merged.values()]
    .sort((a, b) => b.relevance_score - a.relevance_score);

  // Filter by agent readiness level if specified
  if (agentReadyFilter) {
    if (agentReadyFilter === "verified") {
      // Only verified services
      results = results.filter((r) => r.agent_ready === "verified");
    } else if (agentReadyFilter === "connectable") {
      // Connectable or better (verified + connectable)
      results = results.filter((r) => r.agent_ready !== "info_only");
    }
    // "info_only" = no filter (show everything including info_only)
  }

  // Track search appearances for funnel analytics
  const today = new Date().toISOString().split("T")[0];
  for (const r of results.slice(0, limit)) {
    db.prepare(`
      UPDATE service_snapshots
      SET search_appearances = search_appearances + 1
      WHERE service_id = ? AND snapshot_date = ?
    `).run(r.service_id, today);
  }

  return results.slice(0, limit);
}

/**
 * Agent readiness classification:
 *   "verified"    🟢 — MCP exists + agent success rate ≥ 80% (battle-tested)
 *   "connectable" 🟡 — MCP or API exists, but not yet proven by agents
 *   "info_only"   ⚪ — Information only, no connection method available
 */
type AgentReady = "verified" | "connectable" | "info_only";

function classifyAgentReady(s: ServiceRow): AgentReady {
  const hasMcp = !!s.mcp_endpoint;
  const hasApi = !!s.api_url;
  const hasEnoughData = (s.total_calls ?? 0) >= 3;
  const highSuccess = (s.success_rate ?? 0) >= 0.8;

  if ((hasMcp || hasApi) && hasEnoughData && highSuccess) return "verified";
  if (hasMcp || hasApi) return "connectable";
  return "info_only";
}

interface ScoredResult {
  service_id: string;
  name: string;
  namespace: string | null;
  description: string | null;
  category: string | null;
  agent_ready: AgentReady;
  mcp_endpoint: string | null;
  mcp_status: string;
  api_url: string | null;
  api_auth_method: string | null;
  trust_score: number;
  usage_count: number;
  success_rate: number | null;
  axr_grade: string | null;
  relevance_score: number;
}

/** Bonus when the user's intent mentions a service by name */
const NAME_MATCH_BOOST = 2.0;

/**
 * Bonus for services tagged `jp-native` when the query contains CJK
 * characters. Audit 2026-04-24 surfaced that EN-default services were
 * beating JP-native ones for pure JP queries:
 *   "ECサイト 運営"  → Slack (wrong; Shopify JP should win)
 *   "データ分析"     → SendGrid (wrong; BigQuery/Treasure Data should win)
 * The fix is a position bonus on jp-native services when query is CJK.
 * Chosen deliberately smaller than NAME_MATCH_BOOST so that explicit
 * name mentions still dominate.
 */
const JP_NATIVE_BOOST = 1.2;

function jpNativeBonus(service: ServiceRow, queryIsCJK: boolean): number {
  if (!queryIsCJK) return 0;
  if (!service.tags) return 0;
  const tags = service.tags.toLowerCase();
  if (tags.includes("jp-native") || tags.includes("jp_native")) return JP_NATIVE_BOOST;
  // Namespace containing katakana/hiragana/kanji is a secondary signal
  if (service.namespace && CJK_REGEX.test(service.namespace)) return JP_NATIVE_BOOST * 0.5;
  return 0;
}

function nameMatchBonus(service: ServiceRow, intentLower: string): number {
  const name = service.name.toLowerCase();
  const id = service.id.toLowerCase();
  // Check if any significant part of the service name appears in the intent
  // e.g. "LINE" in "send LINE message", "shopify" in "Shopify inventory"
  const nameTokens = name.split(/[\s()（）/]+/).filter((t) => t.length > 2);
  for (const token of nameTokens) {
    if (intentLower.includes(token)) return NAME_MATCH_BOOST;
  }
  if (intentLower.includes(id)) return NAME_MATCH_BOOST;
  return 0;
}

/**
 * Bonus for services whose tags contain intent tokens.
 * Helps CDP services surface for "customer data platform", HR services for "勤怠管理", etc.
 */
function tagMatchBonus(service: ServiceRow, intentLower: string): number {
  if (!service.tags) return 0;
  // Normalize tags: replace hyphens/underscores with spaces for broader matching
  const rawTags = service.tags.toLowerCase().split(",").map((t) => t.trim());
  const normalizedTags = rawTags.map((t) => t.replace(/[-_]/g, " "));
  const allTags = [...new Set([...rawTags, ...normalizedTags])];

  const tokens = intentLower.split(/\s+/).filter((t) => t.length > 2);

  // Also extract CJK substrings for matching
  const cjkTokens = intentLower.match(/[\u3000-\u9fff\uf900-\ufaff]{2,}/gu) ?? [];

  // Check multi-word intent phrases against tags (e.g., "customer data" vs "customer_data")
  const intentNormalized = intentLower.replace(/\s+/g, " ");

  let matches = 0;
  for (const token of [...tokens, ...cjkTokens]) {
    for (const tag of allTags) {
      if (tag.includes(token) || token.includes(tag)) {
        matches++;
        break;
      }
    }
  }

  // Bonus: check if full intent phrase (or significant subphrases) match tags
  for (const tag of allTags) {
    if (tag.length > 3 && intentNormalized.includes(tag)) {
      matches++;
    }
  }

  return matches * TAG_MATCH_BOOST;
}

/**
 * Compute category-aware score adjustment:
 *   - Services matching top-voted categories (ratio >= 0.5) get proportional boost
 *   - Weakly matched categories (ratio < 0.5) get slight penalty
 *   - Unmatched categories get full penalty when intent is strongly focused
 */
function categoryScoreAdjustment(
  service: ServiceRow,
  signal: IntentSignal
): number {
  if (signal.categories.size === 0 || !service.category) return 0;

  const cat = service.category;
  const votes = signal.votes.get(cat) ?? 0;

  if (votes === 0) {
    // No match at all: penalize when intent signal is clear
    return signal.maxVotes >= 2 ? -OFF_CATEGORY_PENALTY : 0;
  }

  const ratio = votes / signal.maxVotes;

  if (ratio >= 0.5) {
    // Strong match: proportional boost
    return CATEGORY_BOOST * ratio;
  }

  // Weak match (ratio < 0.5): slight penalty scaled by weakness
  // Prevents low-vote categories from getting undeserved boosts
  return -OFF_CATEGORY_PENALTY * (1 - ratio) * 0.5;
}

function formatResult(
  s: ServiceRow,
  score: number,
  intentLower: string = "",
  signal?: IntentSignal
): ScoredResult {
  const nameBonus = intentLower ? nameMatchBonus(s, intentLower) : 0;
  const tagBonus = intentLower ? tagMatchBonus(s, intentLower) : 0;
  const catAdj = signal ? categoryScoreAdjustment(s, signal) : 0;
  // JP-native boost — fires only when the query itself is in CJK so EN
  // queries aren't skewed.
  const jpBonus = intentLower
    ? jpNativeBonus(s, CJK_REGEX.test(intentLower))
    : 0;
  return {
    service_id: s.id,
    name: s.name,
    namespace: s.namespace,
    description: s.description,
    category: s.category,
    agent_ready: classifyAgentReady(s),
    mcp_endpoint: s.mcp_endpoint || null,
    mcp_status: s.mcp_status ?? "official",
    api_url: s.api_url ?? null,
    api_auth_method: s.api_auth_method ?? null,
    trust_score: s.trust_score,
    usage_count: s.total_calls ?? 0,
    success_rate: s.success_rate ?? null,
    axr_grade: s.axr_grade ?? null,
    relevance_score:
      Math.round((score + nameBonus + tagBonus + catAdj + jpBonus) * 100) / 100,
  };
}

function categorySearch(
  db: Database.Database,
  signal: IntentSignal,
  limit: number,
  intentLower: string = ""
): ScoredResult[] {
  // Prioritize top-voted categories; include others as fallback
  const topCats = [...signal.topCategories];
  const allCats = [...signal.categories];
  const cats = topCats.length > 0 ? topCats : allCats;
  const placeholders = cats.map(() => "?").join(", ");
  const query = `
    SELECT s.*, ss.total_calls, ss.success_rate
    FROM services s
    LEFT JOIN service_stats ss ON s.id = ss.service_id
    WHERE s.category IN (${placeholders})
    ORDER BY s.trust_score DESC
    LIMIT ?
  `;
  const services = db.prepare(query).all(...cats, limit * 2) as ServiceRow[];
  return services.map((s) =>
    formatResult(s, s.trust_score, intentLower, signal)
  );
}

function ftsSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number,
  signal: IntentSignal,
  intentLower: string = ""
): ScoredResult[] {
  // Tokenize intent for FTS query — use prefix matching (manage* matches management)
  const tokens = intent
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => `"${t}"*`)
    .join(" OR ");

  if (!tokens) return [];

  try {
    // Fetch more than `limit` so we can re-rank with category boost before trimming
    const fetchLimit = Math.max(limit * 3, 15);

    // Join FTS results back to services table via rowid
    let query = `
      SELECT s.*, ss.total_calls, ss.success_rate, fts.rank as fts_rank
      FROM services_fts fts
      JOIN services s ON s.rowid = fts.rowid
      LEFT JOIN service_stats ss ON s.id = ss.service_id
      WHERE services_fts MATCH ?
    `;
    const params: unknown[] = [tokens];

    if (category) {
      query += ` AND s.category = ?`;
      params.push(category);
    }

    query += ` ORDER BY fts.rank LIMIT ?`;
    params.push(fetchLimit);

    const services = db.prepare(query).all(...params) as (ServiceRow & { fts_rank: number })[];

    if (services.length === 0) return [];

    // Compute relevance with category-aware scoring, then sort descending
    const scored = services.map((s) => {
      const baseScore = 1 / (1 + Math.abs(s.fts_rank)) + s.trust_score * 0.3;
      return formatResult(s, baseScore, intentLower, signal);
    });

    scored.sort((a, b) => b.relevance_score - a.relevance_score);

    return scored.slice(0, limit);
  } catch {
    // FTS query may fail on certain inputs, fall through to LIKE
    return [];
  }
}

function trigramSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number,
  signal: IntentSignal,
  intentLower: string = ""
): ScoredResult[] {
  // Extract CJK substrings (3+ chars) for trigram MATCH, and all tokens for scoring
  const cjkMatches = intent.match(/[\u3000-\u9fff\uf900-\ufaff]+/gu) ?? [];
  // Trigram requires 3+ chars; collect shorter ones for LIKE fallback within this function
  const trigramTokens = cjkMatches.filter((t) => t.length >= 3);
  const shortTokens = cjkMatches.filter((t) => t.length < 3 && t.length > 0);

  // Also extract Latin tokens for trigram (works for English too, 3+ chars)
  const latinTokens = intent
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !CJK_REGEX.test(t));

  const allTrigramTokens = [...trigramTokens, ...latinTokens];

  if (allTrigramTokens.length === 0 && shortTokens.length === 0) return [];

  const fetchLimit = Math.max(limit * 3, 15);
  let results: ScoredResult[] = [];

  // Trigram FTS search for 3+ char tokens
  if (allTrigramTokens.length > 0) {
    try {
      // Trigram MATCH uses substring matching — no need for prefix *
      const matchExpr = allTrigramTokens.map((t) => `"${t}"`).join(" OR ");

      let query = `
        SELECT s.*, ss.total_calls, ss.success_rate, fts.rank as fts_rank
        FROM services_fts_trigram fts
        JOIN services s ON s.rowid = fts.rowid
        LEFT JOIN service_stats ss ON s.id = ss.service_id
        WHERE services_fts_trigram MATCH ?
      `;
      const params: unknown[] = [matchExpr];

      if (category) {
        query += ` AND s.category = ?`;
        params.push(category);
      }

      query += ` ORDER BY fts.rank LIMIT ?`;
      params.push(fetchLimit);

      const services = db.prepare(query).all(...params) as (ServiceRow & { fts_rank: number })[];

      results = services.map((s) => {
        const baseScore = 1 / (1 + Math.abs(s.fts_rank)) + s.trust_score * 0.3;
        return formatResult(s, baseScore, intentLower, signal);
      });
    } catch {
      // FTS query may fail on certain inputs
    }
  }

  // For short CJK tokens (1-2 chars like 人事, 経費), use LIKE as supplement
  if (shortTokens.length > 0) {
    const conditions = shortTokens.map(
      () => `(s.name LIKE ? OR s.description LIKE ? OR s.tags LIKE ?)`
    );
    const params: unknown[] = [];
    for (const token of shortTokens) {
      const pattern = `%${token}%`;
      params.push(pattern, pattern, pattern);
    }

    let query = `
      SELECT s.*, ss.total_calls, ss.success_rate
      FROM services s
      LEFT JOIN service_stats ss ON s.id = ss.service_id
      WHERE (${conditions.join(" OR ")})
    `;
    if (category) {
      query += ` AND s.category = ?`;
      params.push(category);
    }
    query += ` ORDER BY s.trust_score DESC LIMIT ?`;
    params.push(fetchLimit);

    const services = db.prepare(query).all(...params) as ServiceRow[];
    for (const s of services) {
      results.push(formatResult(s, s.trust_score, intentLower, signal));
    }
  }

  // Deduplicate within trigram results, keep highest score
  const deduped = new Map<string, ScoredResult>();
  for (const r of results) {
    const existing = deduped.get(r.service_id);
    if (!existing || r.relevance_score > existing.relevance_score) {
      deduped.set(r.service_id, r);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);
}

/**
 * Extract search tokens from intent, handling both Latin (space-separated)
 * and CJK (no spaces — split into overlapping 2-char bigrams for LIKE).
 */
function extractSearchTokens(intent: string): string[] {
  const tokens: string[] = [];

  // Latin tokens (space-separated)
  const latin = intent.replace(/[\u3000-\u9fff\uf900-\ufaff]/g, " ");
  for (const t of latin.split(/\s+/)) {
    if (t.length > 1) tokens.push(t);
  }

  // CJK: extract contiguous runs, then split into 2-char bigrams
  const cjkRuns = intent.match(/[\u3000-\u9fff\uf900-\ufaff]+/gu) ?? [];
  for (const run of cjkRuns) {
    if (run.length <= 3) {
      // Short run — use as-is
      tokens.push(run);
    } else {
      // Longer run — split into 2-char bigrams for broader matching
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }

  return tokens;
}

function likeSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number,
  signal: IntentSignal,
  intentLower: string = ""
): ScoredResult[] {
  const words = extractSearchTokens(intent);
  if (words.length === 0) return [];

  // Fetch more rows so we can re-rank after category boost
  const fetchLimit = Math.max(limit * 3, 15);

  const conditions = words.map(
    () => `(s.name LIKE ? OR s.description LIKE ? OR s.tags LIKE ?)`
  );
  const params: unknown[] = [];
  for (const word of words) {
    const pattern = `%${word}%`;
    params.push(pattern, pattern, pattern);
  }

  let query = `
    SELECT s.*, ss.total_calls, ss.success_rate
    FROM services s
    LEFT JOIN service_stats ss ON s.id = ss.service_id
    WHERE (${conditions.join(" OR ")})
  `;

  if (category) {
    query += ` AND s.category = ?`;
    params.push(category);
  }

  query += ` ORDER BY s.trust_score DESC LIMIT ?`;
  params.push(fetchLimit);

  const services = db.prepare(query).all(...params) as ServiceRow[];

  const scored = services.map((s) => {
    return formatResult(s, s.trust_score, intentLower, signal);
  });

  scored.sort((a, b) => b.relevance_score - a.relevance_score);

  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// JP synonym expansion
// ---------------------------------------------------------------------------
// Japanese agent queries vary wildly in phrasing ("問い合わせ管理" vs
// "サポートチケット" vs "ヘルプデスク" all mean the same thing). Rather
// than enumerate every synonym in every service's tags field, we expand
// the query with common alternates so FTS/LIKE have more hooks. If a
// synonym already appears in the query we don't duplicate it.

const JP_SYNONYMS: Array<{ triggers: string[]; expansions: string[] }> = [
  {
    triggers: ["問い合わせ管理", "問い合わせ", "サポート", "カスタマーサポート"],
    expansions: ["サポートチケット", "ヘルプデスク", "FAQ", "ケース管理"],
  },
  {
    triggers: ["採用管理", "応募者管理", "採用"],
    expansions: ["ATS", "採用システム", "候補者管理", "スカウト"],
  },
  {
    triggers: ["CRM", "顧客管理", "営業支援"],
    expansions: ["顧客データ", "リード管理", "パイプライン", "SFA"],
  },
  {
    triggers: ["データ連携", "API統合", "連携", "統合ツール"],
    expansions: ["iPaaS", "自動化", "ワークフロー", "API連携"],
  },
  {
    triggers: ["電子契約", "電子署名", "契約書管理"],
    expansions: ["契約管理", "ハンコ", "押印", "署名"],
  },
  {
    triggers: ["勤怠管理", "勤怠"],
    expansions: ["タイムカード", "打刻", "労務管理", "出退勤"],
  },
  {
    triggers: ["経費精算", "経費"],
    expansions: ["立替精算", "交通費精算", "領収書"],
  },
  {
    triggers: ["請求書", "請求管理"],
    expansions: ["インボイス", "請求", "請求書発行"],
  },
  {
    triggers: ["タスク管理", "プロジェクト管理"],
    expansions: ["Todo", "チーム管理", "課題管理", "業務管理"],
  },
  {
    triggers: ["チャット", "ビジネスチャット"],
    expansions: ["コミュニケーション", "チーム連携", "メッセージング"],
  },
  {
    triggers: ["ストレージ", "ファイル管理"],
    expansions: ["クラウドストレージ", "ファイル共有", "ドキュメント管理"],
  },
  {
    triggers: ["名刺管理"],
    expansions: ["名刺", "人脈管理", "コンタクト管理"],
  },
  {
    triggers: ["決済", "支払い"],
    expansions: ["サブスク", "課金", "クレジットカード", "決済処理"],
  },
];

function expandJpSynonyms(intent: string): string {
  if (!intent) return intent;
  const lower = intent.toLowerCase();
  const additions = new Set<string>();
  for (const group of JP_SYNONYMS) {
    const matched = group.triggers.some((t) => lower.includes(t.toLowerCase()));
    if (!matched) continue;
    for (const exp of group.expansions) {
      if (!lower.includes(exp.toLowerCase())) additions.add(exp);
    }
  }
  if (additions.size === 0) return intent;
  return `${intent} ${[...additions].join(" ")}`;
}

// ---------------------------------------------------------------------------
// Next-tool suggestion
// ---------------------------------------------------------------------------
// Most first-time agents call search_services and stop there. They don't
// know the idiomatic KanseiLink flow: search → tips → (execute) → report.
// Returning a concrete suggested_next_tool with the top hit pre-filled saves
// the agent a reasoning step and nudges the full feedback loop.

interface NextToolSuggestion {
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  flow_position: string; // e.g. "2 of 4 in the standard KanseiLink flow"
}

function buildNextToolSuggestion(
  top: ScoredResult | undefined,
  resultCount: number
): NextToolSuggestion {
  if (!top || resultCount === 0) {
    return {
      tool: "submit_feedback",
      args: {
        type: "missing_data",
        subject: "service not found for this intent",
        body: "<paste the user's intent here>",
      },
      reason:
        "No results — file a missing_data report so the service gets added to the DB.",
      flow_position: "fallback (no results)",
    };
  }

  return {
    tool: "get_service_tips",
    args: { service_id: top.service_id },
    reason: `Next step: pull ${top.name}'s agent_tips, pitfalls, auth setup, and recent reliability data before calling its API. This saves 91-96% tokens vs web_fetching the docs.`,
    flow_position:
      "2 of 4 in the standard flow: search_services → get_service_tips → (execute the API) → report_outcome",
  };
}
