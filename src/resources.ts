import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { displayMcpStatus, MCP_STATUS_LEGEND } from "./utils/mcp-status.js";

interface ServiceRow {
  id: string;
  name: string;
  category: string;
  description: string;
  mcp_status: string | null;
  mcp_endpoint: string | null;
  archived: number | null;
  mcp_liveness: string | null;
  mcp_liveness_checked_at: string | null;
  mcp_liveness_endpoint: string | null;
  api_url: string | null;
  api_auth_method: string | null;
  trust_score: number;
  tags: string | null;
}

interface CategoryCount {
  category: string;
  count: number;
}

/**
 * Register MCP Resources — static and dynamic data the server exposes for context.
 * These help LobeHub Grade A scoring and provide discoverable data to clients.
 */
export function registerResources(server: McpServer, db: Database.Database): void {
  // Resource 1: Category overview (static)
  server.registerResource(
    "categories",
    "kansei://categories",
    {
      title: "Service Categories",
      description: "Overview of all 18 service categories with counts. Use this to understand what types of Japanese SaaS are available.",
      mimeType: "application/json",
    },
    async (uri) => {
      const rows = db
        .prepare(
          `SELECT category, COUNT(*) as count FROM services GROUP BY category ORDER BY count DESC`
        )
        .all() as CategoryCount[];

      const total = rows.reduce((sum, r) => sum + r.count, 0);

      const data = {
        total_services: total,
        total_categories: rows.length,
        categories: rows.map((r) => ({
          name: r.category,
          count: r.count,
        })),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // Resource 2: Service detail (dynamic, template-based)
  const serviceTemplate = new ResourceTemplate(
    "kansei://service/{serviceId}",
    {
      list: async () => {
        const rows = db
          .prepare(`SELECT id, name FROM services ORDER BY trust_score DESC LIMIT 20`)
          .all() as { id: string; name: string }[];

        return {
          resources: rows.map((r) => ({
            uri: `kansei://service/${r.id}`,
            name: r.name,
          })),
        };
      },
      complete: {
        serviceId: async (value: string) => {
          const rows = db
            .prepare(
              `SELECT id FROM services WHERE id LIKE ? ORDER BY trust_score DESC LIMIT 10`
            )
            .all(`${value}%`) as { id: string }[];
          return rows.map((r) => r.id);
        },
      },
    }
  );

  server.registerResource(
    "service-detail",
    serviceTemplate,
    {
      title: "Service Detail",
      description: "Detailed information about a specific Japanese SaaS service including MCP status, API info, and trust score.",
      mimeType: "application/json",
    },
    async (uri, { serviceId }) => {
      const data = serviceResourceData(db, String(serviceId));
      if (!data) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: `Service '${serviceId}' not found` }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // Resource 3: MCP status summary (static)
  server.registerResource(
    "mcp-status",
    "kansei://mcp-status",
    {
      title: "MCP Status Summary",
      description: "Summary of MCP adoption across 100 Japanese SaaS services — how many have official MCP, third-party MCP, or API only.",
      mimeType: "application/json",
    },
    async (uri) => {
      const data = mcpStatusSummaryData(db);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );
}

/**
 * kansei://service/{serviceId}. mcp_status goes through displayMcpStatus()
 * like every other outward path: the provider's claim, `verified` only on a
 * fresh handshake with the current endpoint, liveness beside it (2026-10-02).
 */
export function serviceResourceData(db: Database.Database, serviceId: string): object | null {
  const service = db.prepare(`SELECT * FROM services WHERE id = ?`).get(serviceId) as ServiceRow | undefined;
  if (!service) return null;
  return {
    id: service.id,
    name: service.name,
    category: service.category,
    description: service.description,
    ...displayMcpStatus(service),
    mcp_status_legend: MCP_STATUS_LEGEND,
    mcp_endpoint: service.mcp_endpoint,
    api_url: service.api_url,
    api_auth_method: service.api_auth_method,
    trust_score: service.trust_score,
    tags: service.tags?.split(",").map((t) => t.trim()) ?? [],
  };
}

/**
 * kansei://mcp-status. Counted and listed by the DISPLAYED status, never the
 * stored one: a stored `verified` with no fresh handshake is counted as
 * `unverified`, and a dead official endpoint is not listed as an official
 * server. Liveness is counted separately (2026-10-02).
 */
export function mcpStatusSummaryData(db: Database.Database, now: Date = new Date()): object {
  const rows = db
    .prepare(
      `SELECT id, name, trust_score, mcp_status, mcp_endpoint, archived,
              mcp_liveness, mcp_liveness_checked_at, mcp_liveness_endpoint
       FROM services ORDER BY trust_score DESC`
    )
    .all() as Array<ServiceRow>;

  const byStatus = new Map<string, number>();
  const byLiveness = new Map<string, number>();
  const official: { id: string; name: string }[] = [];
  const thirdParty: { id: string; name: string }[] = [];
  for (const r of rows) {
    const d = displayMcpStatus(r, now);
    byStatus.set(d.mcp_status, (byStatus.get(d.mcp_status) ?? 0) + 1);
    const live = d.mcp_liveness.state === "unknown" || d.mcp_liveness.endpoint_matches ? d.mcp_liveness.state : "other_endpoint";
    byLiveness.set(live, (byLiveness.get(live) ?? 0) + 1);
    if (d.mcp_status === "official") official.push({ id: r.id, name: r.name });
    else if (d.mcp_status === "third_party") thirdParty.push({ id: r.id, name: r.name });
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

  return {
    summary: sorted(byStatus).map(([status, count]) => ({ status, count })),
    liveness_summary: sorted(byLiveness).map(([state, count]) => ({ state, count })),
    official_mcp_servers: official,
    third_party_mcp_servers: thirdParty,
    mcp_status_legend: MCP_STATUS_LEGEND,
  };
}
