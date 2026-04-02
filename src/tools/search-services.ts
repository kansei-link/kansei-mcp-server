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
          .describe("Filter by category: crm, project_management, communication, accounting, hr, ecommerce"),
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

  // HR
  employee:      ["hr"],
  employees:     ["hr"],
  attendance:    ["hr"],
  leave:         ["hr"],
  hiring:        ["hr"],
  recruit:       ["hr"],
  recruitment:   ["hr"],
  onboarding:    ["hr"],
  talent:        ["hr"],
  hr:            ["hr"],
  workforce:     ["hr"],
  shift:         ["hr"],
  timecard:      ["hr"],

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

  // CRM
  lead:          ["crm"],
  leads:         ["crm"],
  customer:      ["crm"],
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
  ticket:        ["project_management"],
  backlog:       ["project_management"],
  milestone:     ["project_management"],

  // E-commerce
  product:       ["ecommerce"],
  products:      ["ecommerce"],
  order:         ["ecommerce"],
  orders:        ["ecommerce"],
  shipping:      ["ecommerce"],
  inventory:     ["ecommerce"],
  cart:          ["ecommerce"],
  store:         ["ecommerce"],
  shop:          ["ecommerce"],
  catalog:       ["ecommerce"],
};

/** Category boost added to relevance_score when service category matches intent */
const CATEGORY_BOOST = 0.3;

/**
 * Detect likely categories from an intent string by scanning for keyword
 * signals. Returns a Set of category names (may be empty).
 */
function detectIntentCategories(intent: string): Set<string> {
  const categories = new Set<string>();
  const lower = intent.toLowerCase();
  const tokens = lower.split(/\s+/);

  for (const token of tokens) {
    const mapped = INTENT_CATEGORY_MAP[token];
    if (mapped) {
      for (const cat of mapped) categories.add(cat);
    }
  }

  return categories;
}

export function searchServices(
  db: Database.Database,
  intent: string,
  category?: string,
  limit: number = 5
): object[] {
  const intentCategories = detectIntentCategories(intent);

  // Try FTS5 search first
  let results = ftsSearch(db, intent, category, limit, intentCategories);

  // Fallback to LIKE search if FTS returns nothing
  if (results.length === 0) {
    results = likeSearch(db, intent, category, limit, intentCategories);
  }

  return results;
}

function ftsSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number,
  intentCategories: Set<string>
): object[] {
  // Tokenize intent for FTS query (simple word splitting)
  const tokens = intent
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => `"${t}"`)
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
      return {
        service_id: s.id,
        name: s.name,
        namespace: s.namespace,
        description: s.description,
        category: s.category,
        mcp_endpoint: s.mcp_endpoint,
        trust_score: s.trust_score,
        usage_count: s.total_calls ?? 0,
        success_rate: s.success_rate ?? null,
        relevance_score: Math.round((baseScore + categoryBoost) * 100) / 100,
      };
    });

    scored.sort((a, b) => b.relevance_score - a.relevance_score);

    return scored.slice(0, limit);
  } catch {
    // FTS query may fail on certain inputs, fall through to LIKE
    return [];
  }
}

function likeSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number,
  intentCategories: Set<string>
): object[] {
  const words = intent.split(/\s+/).filter((t) => t.length > 1);
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
    return {
      service_id: s.id,
      name: s.name,
      namespace: s.namespace,
      description: s.description,
      category: s.category,
      mcp_endpoint: s.mcp_endpoint,
      trust_score: s.trust_score,
      usage_count: s.total_calls ?? 0,
      success_rate: s.success_rate ?? null,
      relevance_score: Math.round((s.trust_score + categoryBoost) * 100) / 100,
    };
  });

  scored.sort((a, b) => b.relevance_score - a.relevance_score);

  return scored.slice(0, limit);
}
