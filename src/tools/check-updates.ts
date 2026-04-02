import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

interface ServiceRow {
  id: string;
  name: string;
  namespace: string | null;
  description: string | null;
  category: string | null;
  mcp_endpoint: string | null;
  trust_score: number;
}

interface ChangelogRow {
  id: number;
  service_id: string;
  change_date: string;
  change_type: string;
  summary: string;
  details: string | null;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "check_updates",
    {
      title: "Check Updates",
      description:
        "Check if an MCP service has changed recently. Returns changelog information including new features, breaking changes, fixes, and deprecations.",
      inputSchema: z.object({
        service: z
          .string()
          .describe(
            "Service name or ID to look up (e.g., 'freee', 'smarthr', 'chatwork')"
          ),
        since_days: z
          .number()
          .optional()
          .default(30)
          .describe(
            "How many days back to look for changes (default: 30)"
          ),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ service, since_days }) => {
      const result = checkUpdates(db, service, since_days ?? 30);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}

function checkUpdates(
  db: Database.Database,
  service: string,
  sinceDays: number
): object {
  // Fuzzy-match service by name or ID
  const pattern = `%${service}%`;
  const matchedService = db
    .prepare(
      `SELECT id, name, namespace, description, category, mcp_endpoint, trust_score
       FROM services
       WHERE id LIKE ? OR name LIKE ?
       LIMIT 1`
    )
    .get(pattern, pattern) as ServiceRow | undefined;

  if (!matchedService) {
    return {
      error: "service_not_found",
      message: `No service matching '${service}' was found.`,
      suggestion:
        "Use search_services to find available services, then retry with the exact service ID.",
    };
  }

  // Calculate the cutoff date
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - sinceDays);
  const cutoffIso = cutoffDate.toISOString().split("T")[0]; // YYYY-MM-DD

  const changes = db
    .prepare(
      `SELECT id, service_id, change_date, change_type, summary, details
       FROM service_changelog
       WHERE service_id = ? AND change_date >= ?
       ORDER BY change_date DESC`
    )
    .all(matchedService.id, cutoffIso) as ChangelogRow[];

  const hasBreakingChanges = changes.some(
    (c) => c.change_type === "breaking"
  );

  return {
    service: {
      id: matchedService.id,
      name: matchedService.name,
      namespace: matchedService.namespace,
      category: matchedService.category,
      mcp_endpoint: matchedService.mcp_endpoint,
    },
    period: {
      since_days: sinceDays,
      cutoff_date: cutoffIso,
    },
    has_breaking_changes: hasBreakingChanges,
    total_changes: changes.length,
    changes: changes.map((c) => ({
      date: c.change_date,
      type: c.change_type,
      summary: c.summary,
      ...(c.details ? { details: c.details } : {}),
    })),
  };
}
