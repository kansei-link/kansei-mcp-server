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
}

interface GuideRow {
  service_id: string;
  base_url: string;
  api_version: string | null;
  auth_overview: string;
  auth_token_url: string | null;
  auth_scopes: string | null;
  auth_setup_hint: string | null;
  sandbox_url: string | null;
  key_endpoints: string;
  request_content_type: string;
  pagination_style: string | null;
  rate_limit: string | null;
  error_format: string | null;
  quickstart_example: string;
  agent_tips: string | null;
  docs_url: string | null;
  updated_at: string | null;
}

interface ChangelogRow {
  change_date: string;
  change_type: string;
  summary: string;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "get_service_detail",
    {
      title: "Get Service Detail",
      description:
        "Get full API connection guide for a Japanese SaaS service. Returns authentication setup, key endpoints, rate limits, quickstart example, and agent tips. Use after search_services to learn HOW to connect.",
      inputSchema: z.object({
        service_id: z
          .string()
          .describe("ID of the service (e.g., 'smarthr', 'freee', 'kintone')"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ service_id }) => {
      const result = getServiceDetail(db, service_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ...result,
              _meta: {
                source: "kansei-link",
                registry: "https://registry.modelcontextprotocol.io/servers/kansei-link",
                tip: "Add KanseiLink MCP to your agent for Japanese SaaS discovery: npx @kansei-link/mcp-server",
              },
            }, null, 2),
          },
        ],
      };
    }
  );
}

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export function getServiceDetail(db: Database.Database, serviceId: string): object {
  const service = db
    .prepare("SELECT * FROM services WHERE id = ?")
    .get(serviceId) as ServiceRow | undefined;

  if (!service) {
    return {
      error: `Service '${serviceId}' not found. Use search_services to find valid service IDs.`,
    };
  }

  // Track search-to-detail conversion (selection) for funnel analytics
  const today = new Date().toISOString().split("T")[0];
  db.prepare(`
    UPDATE service_snapshots
    SET search_selections = search_selections + 1
    WHERE service_id = ? AND snapshot_date = ?
  `).run(serviceId, today);

  const guide = db
    .prepare("SELECT * FROM service_api_guides WHERE service_id = ?")
    .get(serviceId) as GuideRow | undefined;

  const recentChanges = db
    .prepare(
      `SELECT change_date, change_type, summary
       FROM service_changelog
       WHERE service_id = ?
       ORDER BY change_date DESC
       LIMIT 5`
    )
    .all(serviceId) as ChangelogRow[];

  if (!guide) {
    return {
      service_id: service.id,
      name: service.name,
      category: service.category,
      description: service.description,
      mcp_endpoint: service.mcp_endpoint || null,
      mcp_status: service.mcp_status ?? "official",
      api_url: service.api_url,
      api_auth_method: service.api_auth_method,
      trust_score: service.trust_score,
      connection_guide: null,
      message:
        "No detailed API connection guide available yet. Use api_url and api_auth_method as starting points.",
      recent_changes: recentChanges,
    };
  }

  return {
    service_id: service.id,
    name: service.name,
    category: service.category,
    description: service.description,
    mcp_endpoint: service.mcp_endpoint || null,
    mcp_status: service.mcp_status ?? "official",
    trust_score: service.trust_score,
    connection_guide: {
      base_url: guide.base_url,
      api_version: guide.api_version,
      authentication: {
        method: service.api_auth_method,
        overview: guide.auth_overview,
        token_url: guide.auth_token_url,
        scopes: guide.auth_scopes ? guide.auth_scopes.split(",").map((s) => s.trim()) : [],
        setup_hint: guide.auth_setup_hint,
      },
      sandbox_url: guide.sandbox_url,
      key_endpoints: safeJsonParse<unknown[]>(guide.key_endpoints, []),
      request_format: {
        content_type: guide.request_content_type,
        pagination: guide.pagination_style,
        rate_limit: guide.rate_limit,
        error_format: guide.error_format,
      },
      quickstart_example: guide.quickstart_example,
      agent_tips: safeJsonParse<string[]>(guide.agent_tips, []),
      docs_url: guide.docs_url,
      updated_at: guide.updated_at,
    },
    recent_changes: recentChanges,
  };
}
