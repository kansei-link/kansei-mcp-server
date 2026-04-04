import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";

interface ServiceRow {
  id: string;
  name: string;
  category: string;
  description: string;
  mcp_status: string;
  mcp_endpoint: string | null;
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
      const service = db
        .prepare(`SELECT * FROM services WHERE id = ?`)
        .get(serviceId) as ServiceRow | undefined;

      if (!service) {
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

      const data = {
        id: service.id,
        name: service.name,
        category: service.category,
        description: service.description,
        mcp_status: service.mcp_status,
        mcp_endpoint: service.mcp_endpoint,
        api_url: service.api_url,
        api_auth_method: service.api_auth_method,
        trust_score: service.trust_score,
        tags: service.tags?.split(",").map((t) => t.trim()) ?? [],
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
      const rows = db
        .prepare(
          `SELECT mcp_status, COUNT(*) as count FROM services GROUP BY mcp_status ORDER BY count DESC`
        )
        .all() as { mcp_status: string; count: number }[];

      const officialList = db
        .prepare(`SELECT id, name FROM services WHERE mcp_status = 'official' ORDER BY trust_score DESC`)
        .all() as { id: string; name: string }[];

      const thirdPartyList = db
        .prepare(`SELECT id, name FROM services WHERE mcp_status = 'third_party' ORDER BY trust_score DESC`)
        .all() as { id: string; name: string }[];

      const data = {
        summary: rows.map((r) => ({
          status: r.mcp_status,
          count: r.count,
        })),
        official_mcp_servers: officialList,
        third_party_mcp_servers: thirdPartyList,
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
}
