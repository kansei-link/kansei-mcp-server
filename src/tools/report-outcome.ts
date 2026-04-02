import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "report_outcome",
    {
      title: "Report Outcome",
      description:
        "Report your experience using an MCP service. Helps other agents make better decisions. All data is anonymized and PII is auto-masked.",
      inputSchema: z.object({
        service_id: z
          .string()
          .describe("ID of the MCP service you used"),
        success: z
          .boolean()
          .describe("Whether the operation succeeded"),
        latency_ms: z
          .number()
          .optional()
          .describe("Response time in milliseconds"),
        error_type: z
          .string()
          .optional()
          .describe("Error category if failed (e.g., 'auth_error', 'timeout', 'rate_limit', 'invalid_input')"),
        context: z
          .string()
          .optional()
          .describe("Additional context about the usage (PII will be auto-masked)"),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ service_id, success, latency_ms, error_type, context }) => {
      const result = reportOutcome(db, {
        service_id,
        success,
        latency_ms,
        error_type,
        context,
      });
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

interface OutcomeInput {
  service_id: string;
  success: boolean;
  latency_ms?: number;
  error_type?: string;
  context?: string;
}

export function reportOutcome(
  db: Database.Database,
  input: OutcomeInput
): object {
  // Validate service exists
  const service = db
    .prepare("SELECT id, name FROM services WHERE id = ?")
    .get(input.service_id) as { id: string; name: string } | undefined;

  if (!service) {
    return {
      recorded: false,
      error: `Service '${input.service_id}' not found. Use search_services to find valid service IDs.`,
    };
  }

  // Mask PII in context
  let contextMasked: string | null = null;
  let maskedFields: string[] = [];
  if (input.context) {
    const result = maskPii(input.context);
    contextMasked = result.masked;
    maskedFields = result.maskedFields;
  }

  // Insert outcome
  db.prepare(
    `INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, context_masked)
     VALUES (?, 'anonymous', ?, ?, ?, ?)`
  ).run(
    input.service_id,
    input.success ? 1 : 0,
    input.latency_ms ?? null,
    input.error_type ?? null,
    contextMasked
  );

  // Update aggregated stats
  db.prepare(
    `INSERT INTO service_stats (service_id, total_calls, success_rate, avg_latency_ms, unique_agents, last_updated)
     VALUES (?, 1, ?, ?, 1, datetime('now'))
     ON CONFLICT(service_id) DO UPDATE SET
       total_calls = (SELECT count(*) FROM outcomes WHERE service_id = ?),
       success_rate = (SELECT avg(success) FROM outcomes WHERE service_id = ?),
       avg_latency_ms = COALESCE((SELECT avg(latency_ms) FROM outcomes WHERE service_id = ? AND latency_ms IS NOT NULL), 0),
       unique_agents = (SELECT count(DISTINCT agent_id_hash) FROM outcomes WHERE service_id = ?),
       last_updated = datetime('now')`
  ).run(
    input.service_id,
    input.success ? 1.0 : 0.0,
    input.latency_ms ?? 0,
    input.service_id,
    input.service_id,
    input.service_id,
    input.service_id
  );

  return {
    recorded: true,
    service_id: input.service_id,
    service_name: service.name,
    masked_fields: maskedFields.length > 0 ? maskedFields : undefined,
  };
}
