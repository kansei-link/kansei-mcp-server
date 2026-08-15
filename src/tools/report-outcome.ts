import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";
import { detectAnomalies } from "../utils/anomaly-detector.js";
import { normalizeModelName, inferAgentType } from "../utils/model-normalizer.js";
import { estimateCost } from "../utils/model-pricing.js";
import { randomUUID } from "node:crypto";

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "report_outcome",
    {
      title: "Report Outcome",
      description:
        "After using any SaaS service, report whether it worked. Takes 5 seconds and improves this installation's local intelligence (recovery hints, local stats, anomaly detection). Your report is saved to the LOCAL database only — nothing is sent to KanseiLink unless you separately opt in to sharing (see the Wrapped --share flow). PII is auto-masked before storage.",
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
        attempt_id: z.string().uuid().optional().describe("attempt_id returned by lookup"),
        recipe_id: z.string().optional().describe("Recipe used for this attempt"),
        recipe_version: z.number().int().positive().optional().describe("Recipe version returned by lookup"),
        failed_step: z.string().max(200).optional().describe("Step where execution stopped"),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ service_id, success, latency_ms, error_type, workaround, context, is_retry, estimated_users, model_name, agent_type, task_type, input_tokens, output_tokens, cost_usd, attempt_id, recipe_id, recipe_version, failed_step }) => {
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
        attempt_id,
        recipe_id,
        recipe_version,
        failed_step,
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

export interface OutcomeInput {
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
  attempt_id?: string;
  recipe_id?: string;
  recipe_version?: number;
  failed_step?: string;
}

interface RecoveryRecipe {
  id: string;
  version: number;
  recovery_steps: string;
  matched_error_class: string;
}

function safeJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string" || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function selectRecoveryRecipe(
  db: Database.Database,
  input: OutcomeInput
): RecoveryRecipe | undefined {
  if (input.success) return undefined;
  const candidates = db.prepare(`
    SELECT id, version, known_failures, recovery_steps
      FROM recipes
     WHERE recovery_steps <> '[]'
       AND (id = ? OR required_services LIKE ?)
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END,
              CASE WHEN last_verified_at IS NULL THEN 1 ELSE 0 END,
              last_verified_at DESC, id ASC
  `).all(input.recipe_id ?? "", `%\"${input.service_id}\"%`, input.recipe_id ?? "") as Array<{
    id: string; version: number; known_failures: string; recovery_steps: string;
  }>;

  const classify = (raw: string): string[] => safeJsonArray(raw).flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const obj = item as Record<string, unknown>;
    const value = obj.error_class ?? obj.error_type ?? obj.class;
    return typeof value === "string" ? [value] : [];
  });

  const wanted = input.error_type?.trim().toLowerCase();
  for (const candidate of candidates) {
    const classes = classify(candidate.known_failures).map((v) => v.toLowerCase());
    if (wanted && classes.includes(wanted)) {
      return { ...candidate, matched_error_class: wanted };
    }
  }
  for (const candidate of candidates) {
    const classes = classify(candidate.known_failures).map((v) => v.toLowerCase());
    if (classes.length === 0 || classes.includes("generic")) {
      return { ...candidate, matched_error_class: "generic" };
    }
  }
  return undefined;
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

  const attempt = input.attempt_id
    ? db.prepare(`SELECT attempt_id, service_id, recipe_id, recipe_version, status,
                         expires_at
                    FROM execution_attempts WHERE attempt_id = ?`).get(input.attempt_id) as
        | { attempt_id: string; service_id: string | null; recipe_id: string | null; recipe_version: number | null; status: string; expires_at: string }
        | undefined
    : undefined;
  if (input.attempt_id && !attempt) {
    return { recorded: false, error: "invalid_attempt_id" };
  }
  if (attempt && attempt.status !== "open") {
    return { recorded: false, error: "attempt_already_closed", attempt_id: attempt.attempt_id };
  }
  if (attempt && attempt.expires_at <= new Date().toISOString().replace("T", " ").slice(0, 19)) {
    return { recorded: false, error: "attempt_expired", attempt_id: attempt.attempt_id };
  }
  if (attempt?.service_id && attempt.service_id !== input.service_id) {
    return { recorded: false, error: "attempt_service_mismatch", attempt_id: attempt.attempt_id };
  }
  if (attempt?.recipe_id && input.recipe_id && attempt.recipe_id !== input.recipe_id) {
    return { recorded: false, error: "attempt_recipe_mismatch", attempt_id: attempt.attempt_id };
  }

  const recovery = selectRecoveryRecipe(db, input);
  const retryAttemptId = attempt && recovery ? randomUUID() : null;

  const insertOutcome = db.transaction(() => {
    if (attempt) {
      const closed = db.prepare(`UPDATE execution_attempts
                                    SET status = 'closed', closed_at = datetime('now')
                                  WHERE attempt_id = ? AND status = 'open'
                                    AND expires_at > datetime('now')`).run(attempt.attempt_id);
      if (closed.changes !== 1) throw new Error("attempt_close_conflict");
    }
    db.prepare(
      `INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, workaround, context_masked, is_retry, estimated_users, model_name, agent_type, task_type, input_tokens, output_tokens, cost_usd, provenance, verification_status, attempt_id, recipe_id, recipe_version, failed_step)
       VALUES (?, 'anonymous', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user_reported', 'unverified', ?, ?, ?, ?)`
    ).run(
      input.service_id, input.success ? 1 : 0, input.latency_ms ?? null,
      input.error_type ?? null, workaroundMasked, contextMasked,
      input.is_retry ? 1 : 0, input.estimated_users ?? null, normalizedModel,
      agentType, input.task_type ?? null, input.input_tokens ?? null,
      input.output_tokens ?? null, costUsd, input.attempt_id ?? null,
      input.recipe_id ?? attempt?.recipe_id ?? null,
      input.recipe_version ?? attempt?.recipe_version ?? null,
      input.failed_step ?? null
    );
    if (retryAttemptId && recovery) {
      db.prepare(`INSERT INTO execution_attempts
        (attempt_id, service_id, recipe_id, recipe_version, parent_attempt_id)
        VALUES (?, ?, ?, ?, ?)`
      ).run(retryAttemptId, input.service_id, recovery.id, recovery.version, attempt!.attempt_id);
    }
  });
  try {
    insertOutcome();
  } catch (error) {
    if (error instanceof Error && error.message === "attempt_close_conflict") {
      return { recorded: false, error: "attempt_already_closed", attempt_id: input.attempt_id };
    }
    throw error;
  }

  // Update aggregated stats
  db.prepare(
    `INSERT INTO service_stats (service_id, total_calls, success_rate, avg_latency_ms, unique_agents, last_updated)
     VALUES (?, 1, ?, ?, 0, datetime('now'))
     ON CONFLICT(service_id) DO UPDATE SET
       total_calls = (SELECT count(*) FROM outcomes WHERE service_id = ? AND provenance IN ('user_reported','kansei_measured')),
       success_rate = COALESCE((SELECT avg(success) FROM outcomes WHERE service_id = ? AND provenance IN ('user_reported','kansei_measured')), 0),
       avg_latency_ms = COALESCE((SELECT avg(latency_ms) FROM outcomes WHERE service_id = ? AND provenance IN ('user_reported','kansei_measured') AND latency_ms IS NOT NULL), 0),
       unique_agents = (SELECT count(DISTINCT NULLIF(agent_id_hash, 'anonymous')) FROM outcomes WHERE service_id = ? AND provenance IN ('user_reported','kansei_measured')),
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

  const localStats = updatedStats
    ? {
        total_reports: updatedStats.total_calls,
        success_rate: Math.round(updatedStats.success_rate * 100) / 100,
        avg_latency_ms: Math.round(updatedStats.avg_latency_ms),
      }
    : undefined;

  return {
    recorded: true,
    saved_locally: true,
    shared: false,
    sharing_note: "Stored in this installation's local database only. Central sharing is a separate opt-in.",
    service_id: input.service_id,
    service_name: service.name,
    masked_fields: maskedFields.length > 0 ? maskedFields : undefined,
    // These stats aggregate THIS local database (seed snapshot + your own
    // reports), not a central community pool. `community_stats` is kept one
    // release for backward compatibility and will be removed.
    local_stats: localStats,
    community_stats: localStats,
    anomalies_detected: anomalies.length > 0
      ? anomalies.map((a) => ({
          type: a.anomaly_type,
          severity: a.severity,
          description: a.description,
        }))
      : undefined,
    attempt: input.attempt_id
      ? { attempt_id: input.attempt_id, validated: true, status: "closed" }
      : undefined,
    recovery_recipe: recovery
      ? {
          recipe_id: recovery.id,
          recipe_version: recovery.version,
          matched_error_class: recovery.matched_error_class,
          steps: safeJsonArray(recovery.recovery_steps),
          ...(retryAttemptId ? { retry_attempt_id: retryAttemptId } : {}),
        }
      : undefined,
    cost_hint: normalizedModel
      ? "Model data recorded for cost optimization"
      : "Tip: include model_name to enable cost optimization",
    message: input.workaround
      ? "Thanks! Your workaround will help other agents avoid the same issue."
      : "Thanks! Your report helps other agents make better decisions.",
  };
}
