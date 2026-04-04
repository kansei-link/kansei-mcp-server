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
          .describe("Filter by category: crm, project_management, communication, accounting, hr, ecommerce, legal, marketing, groupware, productivity, storage, support, payment, logistics, reservation, data_integration"),
        limit: z
          .number()
          .optional()
          .default(5)
          .describe("Max results to return (default: 5)"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ intent, category, limit }) => {
      const results = searchServices(db, intent, category, limit ?? 5);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
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
  "給与":        ["accounting", "hr"],
  "年末調整":    ["hr"],
  "year-end":    ["hr", "accounting"],
  adjustment:    ["hr"],

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

  // CRM
  lead:          ["crm"],
  leads:         ["crm"],
  customer:      ["crm", "support"],
  customers:     ["crm"],
  deal:          ["crm"],
  deals:         ["crm"],
  pipeline:      ["crm"],
  contact:       ["crm"],
  contacts:      ["crm"],
  prospect:      ["crm"],
  sales:         ["crm"],
  crm:           ["crm"],

  // Project management
  task:          ["project_management"],
  tasks:         ["project_management"],
  project:       ["project_management"],
  projects:      ["project_management"],
  sprint:        ["project_management"],
  board:         ["project_management"],
  kanban:        ["project_management"],
  ticket:        ["project_management", "support"],
  backlog:       ["project_management"],
  milestone:     ["project_management"],
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

  // Marketing
  email:         ["marketing", "communication"],
  campaign:      ["marketing"],
  newsletter:    ["marketing"],
  analytics:     ["marketing"],
  data:          ["marketing"],
  segment:       ["marketing"],
  marketing:     ["marketing"],
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

  // Productivity
  form:          ["productivity"],
  survey:        ["productivity"],
  recording:     ["productivity"],
  transcript:    ["productivity"],
  monitoring:    ["productivity"],
  alert:         ["productivity"],
  alerts:        ["productivity"],
  error:         ["productivity"],
  debug:         ["productivity"],
  "監視":        ["productivity"],
  "エラー":      ["productivity"],
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

  // Customer support
  support:       ["support"],
  tickets:       ["support"],
  helpdesk:      ["support"],
  "問い合わせ":  ["support"],
  "サポート":    ["support"],
  "ヘルプ":      ["support"],
  "カスタマー":  ["support", "crm"],

  // Payment
  pay:           ["payment", "accounting"],
  checkout:      ["payment"],
  subscription:  ["payment"],
  charge:        ["payment"],
  pos:           ["payment", "reservation"],
  "決済":        ["payment"],
  "支払":        ["payment", "accounting"],
  "課金":        ["payment"],

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

  // Data integration / iPaaS
  integration:   ["data_integration"],
  ipaas:         ["data_integration"],
  sync:          ["data_integration"],
  connect:       ["data_integration"],
  zap:           ["data_integration"],
  "連携":        ["data_integration", "communication"],
  "自動化":      ["data_integration"],
};

/** Category boost added to relevance_score when service category matches intent */
const CATEGORY_BOOST = 0.5;

/**
 * Detect likely categories from an intent string by scanning for keyword
 * signals. For Latin text, splits on whitespace. For CJK text, scans the
 * full string for keyword substrings (Japanese has no word separators).
 * Returns a Set of category names (may be empty).
 */
function detectIntentCategories(intent: string): Set<string> {
  const categories = new Set<string>();
  const lower = intent.toLowerCase();

  // Latin token matching (space-separated)
  const tokens = lower.split(/\s+/);
  for (const token of tokens) {
    const mapped = INTENT_CATEGORY_MAP[token];
    if (mapped) {
      for (const cat of mapped) categories.add(cat);
    }
  }

  // CJK substring matching — scan for every keyword inside the intent string
  for (const [keyword, cats] of Object.entries(INTENT_CATEGORY_MAP)) {
    if (lower.includes(keyword)) {
      for (const cat of cats) categories.add(cat);
    }
  }

  return categories;
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
  limit: number = 5
): object[] {
  const intentCategories = detectIntentCategories(intent);
  const intentLower = intent.toLowerCase();
  const containsCJK = hasCJK(intent);

  // Run FTS search — use trigram table for CJK, unicode61 for Latin
  const ftsResults = containsCJK
    ? trigramSearch(db, intent, category, limit, intentCategories, intentLower)
    : ftsSearch(db, intent, category, limit, intentCategories, intentLower);

  // Run LIKE search (catches partial matches both tables miss)
  const likeResults = likeSearch(db, intent, category, limit, intentCategories, intentLower);

  // When intent categories are detected, also fetch top services from those
  // categories directly — ensures category-relevant services appear even when
  // FTS tokenization misses them (e.g. "manage" vs "management")
  const categoryResults = intentCategories.size > 0 && !category
    ? categorySearch(db, intentCategories, limit, intentCategories, intentLower)
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

  return [...merged.values()]
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);
}

interface ScoredResult {
  service_id: string;
  name: string;
  namespace: string | null;
  description: string | null;
  category: string | null;
  mcp_endpoint: string | null;
  mcp_status: string;
  api_url: string | null;
  api_auth_method: string | null;
  trust_score: number;
  usage_count: number;
  success_rate: number | null;
  relevance_score: number;
}

/** Bonus when the user's intent mentions a service by name */
const NAME_MATCH_BOOST = 0.6;

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

function formatResult(s: ServiceRow, score: number, intentLower?: string): ScoredResult {
  const nameBonus = intentLower ? nameMatchBonus(s, intentLower) : 0;
  return {
    service_id: s.id,
    name: s.name,
    namespace: s.namespace,
    description: s.description,
    category: s.category,
    mcp_endpoint: s.mcp_endpoint || null,
    mcp_status: s.mcp_status ?? "official",
    api_url: s.api_url ?? null,
    api_auth_method: s.api_auth_method ?? null,
    trust_score: s.trust_score,
    usage_count: s.total_calls ?? 0,
    success_rate: s.success_rate ?? null,
    relevance_score: Math.round((score + nameBonus) * 100) / 100,
  };
}

function categorySearch(
  db: Database.Database,
  intentCategories: Set<string>,
  limit: number,
  _intentCategories: Set<string>,
  intentLower: string = ""
): ScoredResult[] {
  const cats = [...intentCategories];
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
    formatResult(s, s.trust_score + CATEGORY_BOOST, intentLower)
  );
}

function ftsSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number,
  intentCategories: Set<string>,
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

    // Compute relevance with category boost, then sort descending
    const scored = services.map((s) => {
      const baseScore = 1 / (1 + Math.abs(s.fts_rank)) + s.trust_score * 0.3;
      const categoryBoost =
        intentCategories.size > 0 && s.category && intentCategories.has(s.category)
          ? CATEGORY_BOOST
          : 0;
      return formatResult(s, baseScore + categoryBoost, intentLower);
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
  intentCategories: Set<string>,
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
        const categoryBoost =
          intentCategories.size > 0 && s.category && intentCategories.has(s.category)
            ? CATEGORY_BOOST
            : 0;
        return formatResult(s, baseScore + categoryBoost, intentLower);
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
      const categoryBoost =
        intentCategories.size > 0 && s.category && intentCategories.has(s.category)
          ? CATEGORY_BOOST
          : 0;
      results.push(formatResult(s, s.trust_score + categoryBoost, intentLower));
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
  intentCategories: Set<string>,
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
    const categoryBoost =
      intentCategories.size > 0 && s.category && intentCategories.has(s.category)
        ? CATEGORY_BOOST
        : 0;
    return formatResult(s, s.trust_score + categoryBoost, intentLower);
  });

  scored.sort((a, b) => b.relevance_score - a.relevance_score);

  return scored.slice(0, limit);
}
