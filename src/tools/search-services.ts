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

export function searchServices(
  db: Database.Database,
  intent: string,
  category?: string,
  limit: number = 5
): object[] {
  // Try FTS5 search first
  let results = ftsSearch(db, intent, category, limit);

  // Fallback to LIKE search if FTS returns nothing
  if (results.length === 0) {
    results = likeSearch(db, intent, category, limit);
  }

  return results;
}

function ftsSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number
): object[] {
  // Tokenize intent for FTS query (simple word splitting)
  const tokens = intent
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => `"${t}"`)
    .join(" OR ");

  if (!tokens) return [];

  try {
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
    params.push(limit);

    const services = db.prepare(query).all(...params) as (ServiceRow & { fts_rank: number })[];

    if (services.length === 0) return [];

    return services.map((s) => ({
      service_id: s.id,
      name: s.name,
      namespace: s.namespace,
      description: s.description,
      category: s.category,
      mcp_endpoint: s.mcp_endpoint,
      trust_score: s.trust_score,
      usage_count: s.total_calls ?? 0,
      success_rate: s.success_rate ?? null,
      relevance_score: Math.round(
        (1 / (1 + Math.abs(s.fts_rank)) + s.trust_score * 0.3) * 100
      ) / 100,
    }));
  } catch {
    // FTS query may fail on certain inputs, fall through to LIKE
    return [];
  }
}

function likeSearch(
  db: Database.Database,
  intent: string,
  category: string | undefined,
  limit: number
): object[] {
  const words = intent.split(/\s+/).filter((t) => t.length > 1);
  if (words.length === 0) return [];

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
  params.push(limit);

  const services = db.prepare(query).all(...params) as ServiceRow[];

  return services.map((s) => ({
    service_id: s.id,
    name: s.name,
    namespace: s.namespace,
    description: s.description,
    category: s.category,
    mcp_endpoint: s.mcp_endpoint,
    trust_score: s.trust_score,
    usage_count: s.total_calls ?? 0,
    success_rate: s.success_rate ?? null,
    relevance_score: s.trust_score,
  }));
}
