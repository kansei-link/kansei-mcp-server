import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";
import { detectAnomalies } from "../utils/anomaly-detector.js";
import { normalizeModelName, inferAgentType } from "../utils/model-normalizer.js";
import { estimateCost } from "../utils/model-pricing.js";

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
          .describe("Error category if failed (e.g., 'auth_error', 'timeout', 'rate_limit', 'invalid_input', 'schema_mismatch')"),
        workaround: z
          .string()
          .optional()
          .describe("How you resolved the issue, if any (e.g., 'Refreshed OAuth token', 'Used v2 endpoint instead'). Helps future agents."),
        context: z
          .string()
          .optional()
          .describe("Additional context about the usage (PII will be auto-masked)"),
        is_retry: z
          .boolean()
          .optional()
          .describe("Whether this is a retry of a previously failed call"),
        estimated_users: z
          .number()
          .optional()
          .describe("Approximate number of end-users your agent serves (helps estimate business impact of MCP quality)"),
        model_name: z
          .string()
          .optional()
          .describe("LLM model used (e.g., 'claude-sonnet-4', 'gpt-4o', 'gemini-2.5-flash')"),
        agent_type: z
          .enum(["claude", "gpt", "gemini", "copilot", "llama", "deepseek", "other"])
          .optional()
          .describe("Agent platform type (auto-inferred from model_name if omitted)"),
        task_type: z
          .string()
          .optional()
          .describe("Operation performed (e.g., 'create_invoice', 'search_contacts')"),
        input_tokens: z
          .number()
          .int()
          .optional()
          .describe("Input/prompt token count"),
        output_tokens: z
          .number()
          .int()
          .optional()
          .describe("Output/completion token count"),
        cost_usd: z
          .number()
          .optional()
          .describe("Actual cost in USD (estimated from tokens if omitted)"),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ service_id, success, latency_ms, error_type, workaround, context, is_retry, estimated_users, model_name, agent_type, task_type, input_tokens, output_tokens, cost_usd }) => {
      const result = reportOutcome(db, {
        service_id,
        success,
        latency_ms,
        error_type,
        workaround,
        context,
        is_retry,
        estimated_users,
        model_name,
        agent_type,
        task_type,
        input_tokens,
        output_tokens,
        cost_usd,
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
  workaround?: string;
  context?: string;
  is_retry?: boolean;
  estimated_users?: number;
  model_name?: string;
  agent_type?: "claude" | "gpt" | "gemini" | "copilot" | "llama" | "deepseek" | "other";
  task_type?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
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

  // Mask PII in context and workaround
  let contextMasked: string | null = null;
  let workaroundMasked: string | null = null;
  let maskedFields: string[] = [];
  if (input.context) {
    const result = maskPii(input.context);
    contextMasked = result.masked;
    maskedFields = result.maskedFields;
  }
  if (input.workaround) {
    const result = maskPii(input.workaround);
    workaroundMasked = result.masked;
    if (result.maskedFields.length > 0) {
      maskedFields.push(...result.maskedFields);
    }
  }

  // Normalize model name and estimate cost
  const normalizedModel = input.model_name ? normalizeModelName(input.model_name) : null;
  const agentType = input.agent_type || (normalizedModel ? inferAgentType(normalizedModel) : null);
  const costUsd = input.cost_usd ?? (normalizedModel && input.input_tokens && input.output_tokens
    ? estimateCost(normalizedModel, input.input_tokens, input.output_tokens)
    : null);

  // Insert outcome
  db.prepare(
    `INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, workaround, context_masked, is_retry, estimated_users, model_name, agent_type, task_type, input_tokens, output_tokens, cost_usd)
     VALUES (?, 'anonymous', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.service_id,
    input.success ? 1 : 0,
    input.latency_ms ?? null,
    input.error_type ?? null,
    workaroundMasked,
    contextMasked,
    input.is_retry ? 1 : 0,
    input.estimated_users ?? null,
    normalizedModel,
    agentType,
    input.task_type ?? null,
    input.input_tokens ?? null,
    input.output_tokens ?? null,
    costUsd
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

  // Aggregate model_service_stats (when model data is available)
  if (normalizedModel) {
    const taskType = input.task_type || "general";
    db.prepare(`
      INSERT INTO model_service_stats (service_id, model_name, task_type, total_calls, success_count, success_rate, avg_latency_ms, avg_cost_usd, avg_input_tokens, avg_output_tokens, last_updated)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(service_id, model_name, task_type) DO UPDATE SET
        total_calls = model_service_stats.total_calls + 1,
        success_count = model_service_stats.success_count + excluded.success_count,
        success_rate = CAST((model_service_stats.success_count + excluded.success_count) AS REAL) / (model_service_stats.total_calls + 1),
        avg_latency_ms = (model_service_stats.avg_latency_ms * model_service_stats.total_calls + excluded.avg_latency_ms) / (model_service_stats.total_calls + 1),
        avg_cost_usd = CASE WHEN excluded.avg_cost_usd > 0 THEN (model_service_stats.avg_cost_usd * model_service_stats.total_calls + excluded.avg_cost_usd) / (model_service_stats.total_calls + 1) ELSE model_service_stats.avg_cost_usd END,
        avg_input_tokens = CASE WHEN excluded.avg_input_tokens > 0 THEN (model_service_stats.avg_input_tokens * model_service_stats.total_calls + excluded.avg_input_tokens) / (model_service_stats.total_calls + 1) ELSE model_service_stats.avg_input_tokens END,
        avg_output_tokens = CASE WHEN excluded.avg_output_tokens > 0 THEN (model_service_stats.avg_output_tokens * model_service_stats.total_calls + excluded.avg_output_tokens) / (model_service_stats.total_calls + 1) ELSE model_service_stats.avg_output_tokens END,
        last_updated = datetime('now')
    `).run(
      input.service_id, normalizedModel, taskType,
      input.success ? 1 : 0,
      input.success ? 1.0 : 0.0,
      input.latency_ms ?? 0,
      costUsd ?? 0,
      input.input_tokens ?? 0,
      input.output_tokens ?? 0
    );
  }

  // Fetch updated stats to give feedback
  const updatedStats = db
    .prepare(
      `SELECT total_calls, success_rate, avg_latency_ms FROM service_stats WHERE service_id = ?`
    )
    .get(input.service_id) as
    | { total_calls: number; success_rate: number; avg_latency_ms: number }
    | undefined;

  // Run anomaly detection (scout ant dispatch)
  const anomalies = detectAnomalies(db, input.service_id);

  return {
    recorded: true,
    service_id: input.service_id,
    service_name: service.name,
    masked_fields: maskedFields.length > 0 ? maskedFields : undefined,
    community_stats: updatedStats
      ? {
          total_reports: updatedStats.total_calls,
          success_rate: Math.round(updatedStats.success_rate * 100) / 100,
          avg_latency_ms: Math.round(updatedStats.avg_latency_ms),
        }
      : undefined,
    anomalies_detected: anomalies.length > 0
      ? anomalies.map((a) => ({
          type: a.anomaly_type,
          severity: a.severity,
          description: a.description,
        }))
      : undefined,
    cost_hint: normalizedModel
      ? "Model data recorded for cost optimization"
      : "Tip: include model_name to enable cost optimization",
    message: input.workaround
      ? "Thanks! Your workaround will help other agents avoid the same issue."
      : "Thanks! Your report helps other agents make better decisions.",
  };
}
