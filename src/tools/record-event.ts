import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * record_event: Mark external events that may affect service metrics.
 * Examples: API version changes, law amendments, pricing changes, outages.
 * These events correlate with metric changes in get_service_history.
 */
export function register(server: McpServer, db: Database.Database): void {
  server.tool(
    "record_event",
    "Record an external event (API change, law amendment, outage, etc.) that may impact service metrics. Used to correlate metric changes with real-world causes in consulting reports.",
    {
      service_id: z
        .string()
        .optional()
        .describe("Affected service. Omit for industry-wide events (e.g., law changes)."),
      event_date: z
        .string()
        .describe("When the event occurred or takes effect (YYYY-MM-DD)"),
      event_type: z
        .enum([
          "api_change",
          "api_deprecation",
          "law_amendment",
          "pricing_change",
          "outage",
          "security_incident",
          "feature_launch",
          "competitor_move",
          "mcp_update",
          "other",
        ])
        .describe("Category of the event"),
      title: z.string().describe("Short event title (e.g., 'freee API v3 deprecation')"),
      description: z
        .string()
        .optional()
        .describe("Details about the event and expected impact"),
      impact_expected: z
        .enum(["positive", "negative", "neutral", "unknown"])
        .default("unknown")
        .describe("Expected impact on agent experience"),
    },
    async ({ service_id, event_date, event_type, title, description, impact_expected }) => {
      const result = db
        .prepare(
          `INSERT INTO service_events (service_id, event_date, event_type, title, description, impact_expected)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          service_id || null,
          event_date,
          event_type,
          title,
          description || null,
          impact_expected
        );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              recorded: true,
              event_id: result.lastInsertRowid,
              service_id: service_id || "industry-wide",
              event_date,
              event_type,
              title,
              impact_expected,
              message:
                "Event recorded. This will be correlated with metric changes in get_service_history reports.",
            }),
          },
        ],
      };
    }
  );
}
