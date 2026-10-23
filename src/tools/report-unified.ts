import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

import { reportOutcome } from "./report-outcome.js";
import { outcomeAgentMaterial } from "../agent-id.js";
import { emitEvent, toModelFamily, toErrorClass } from "../usage/telemetry.js";
import { submitFeedback } from "./submit-feedback.js";
import { recordEvent } from "./record-event.js";
import { recordAgentVoice, ensureAgentVoiceTable } from "./agent-voice.js";
import { ensureNotesSchema, noteSchema, resultSchema, recordNote, recordResult, noteOperation } from "../notes/store.js";

// ---------------------------------------------------------------------------
// Mode detection — resolves which underlying function to call.
// Priority order matches the spec: explicit mode > param inference.
// ---------------------------------------------------------------------------

type Mode = "outcome" | "feedback" | "event" | "voice" | "note" | "note_result";

interface ReportParams {
  mode?: Mode;
  // outcome params
  service_id?: string;
  success?: boolean;
  latency_ms?: number;
  error_type?: string;
  workaround?: string;
  context?: string;
  is_retry?: boolean;
  estimated_users?: number;
  model_name?: string;
  agent_type?: string;
  task_type?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  attempt_id?: string;
  recipe_id?: string;
  recipe_version?: number;
  failed_step?: string;
  note_id?: unknown;
  provider_request_id?: unknown;
  provider_request_id_source?: unknown;
  session_id?: unknown;
  provider_error_code?: unknown;
  // feedback params
  feedback_type?: string;
  subject?: string;
  body?: string;
  priority?: string;
  agent_id?: string;
  // event params
  event_date?: string;
  event_type?: string;
  title?: string;
  description?: string;
  impact_expected?: string;
  // voice params
  question_id?: string;
  response_choice?: string;
  response_text?: string;
  confidence?: string;
}

function detectMode(params: ReportParams): Mode | null {
  // 1. Explicit mode override
  if (params.mode) return params.mode;

  // 2. success (boolean) present → outcome
  if (typeof params.success === "boolean") return "outcome";

  // 3. question_id present → voice
  if (params.question_id) return "voice";

  // 4. event_type present → event
  if (params.event_type) return "event";

  // 5. subject + body present → feedback
  if (params.subject && params.body) return "feedback";

  return null;
}

// ---------------------------------------------------------------------------
// Dispatchers — call the right extracted handler based on mode.
// ---------------------------------------------------------------------------

function dispatchOutcome(db: Database.Database, params: ReportParams, agentMaterial: string | null): object {
  // Event Contract v1: pseudonymous outcome event (only when consented).
  void emitEvent("outcome_reported", {
    service_id: params.service_id,
    success: Boolean(params.success),
    tool_name: params.task_type && /^[a-zA-Z0-9_.-]{1,64}$/.test(params.task_type) ? params.task_type : undefined,
    error_class: toErrorClass(params.error_type),
    latency_ms: typeof params.latency_ms === "number" ? params.latency_ms : undefined,
    model_family: toModelFamily(params.model_name),
    is_retry: Boolean(params.is_retry),
    local_attempt_id: params.attempt_id,
    recipe_id: params.recipe_id,
    recipe_version: params.recipe_version,
    failed_step: params.failed_step && /^[0-9]{1,3}$/.test(params.failed_step) ? params.failed_step : undefined,
  });
  return reportOutcome(db, {
    agent_material: agentMaterial,
    service_id: params.service_id!,
    success: params.success!,
    latency_ms: params.latency_ms,
    error_type: params.error_type,
    workaround: params.workaround,
    context: params.context,
    is_retry: params.is_retry,
    estimated_users: params.estimated_users,
    model_name: params.model_name,
    agent_type: params.agent_type as
      | "claude"
      | "gpt"
      | "gemini"
      | "copilot"
      | "llama"
      | "deepseek"
      | "other"
      | undefined,
    task_type: params.task_type,
    input_tokens: params.input_tokens,
    output_tokens: params.output_tokens,
    cost_usd: params.cost_usd,
    attempt_id: params.attempt_id,
    recipe_id: params.recipe_id,
    recipe_version: params.recipe_version,
    failed_step: params.failed_step,
    note_id: params.note_id,
    provider_request_id: params.provider_request_id,
    provider_request_id_source: params.provider_request_id_source,
    provider_error_code: params.provider_error_code,
  });
}

function dispatchFeedback(db: Database.Database, params: ReportParams): object {
  return submitFeedback(db, {
    type: params.feedback_type || "suggestion",
    subject: params.subject!,
    body: params.body!,
    service_id: params.service_id,
    priority: params.priority || "normal",
    agent_id: params.agent_id,
  });
}

function dispatchEvent(db: Database.Database, params: ReportParams): object {
  return recordEvent(db, {
    service_id: params.service_id,
    event_date: params.event_date!,
    event_type: params.event_type!,
    title: params.title!,
    description: params.description,
    impact_expected: params.impact_expected || "unknown",
  });
}

function dispatchVoice(db: Database.Database, params: ReportParams): object {
  ensureAgentVoiceTable(db);
  return recordAgentVoice(db, {
    service_id: params.service_id!,
    agent_type: params.agent_type || "other",
    agent_id: params.agent_id,
    question_id: params.question_id!,
    response_choice: params.response_choice,
    response_text: params.response_text!,
    confidence: params.confidence || "medium",
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface ReportRegisterOptions {
  /** stdio: the local install id. Absent (HTTP): the request's Mcp-Session-Id, if any. */
  installMaterial?: string | null;
}

export function register(server: McpServer, db: Database.Database, options: ReportRegisterOptions = {}): void {
  ensureNotesSchema(db);
  server.registerTool(
    "report",
    {
      title: "Report",
      description:
        "Record outcomes, feedback, events or experience in this installation. Use mode 'note' with note to contribute a reusable summary; mode 'note_result' with note_result to report trying an existing note. These two modes require share:true: the summary is readable by others with access to this server (public on the hosted server). A local stdio installation does not upload it. Share only with user authorization; omit secrets and personal information. Other report modes retain their existing local storage and separate sharing consent behavior. For outcome mode, provider_request_id makes the record traceable in the provider's own logs.",
      inputSchema: z.object({
        mode: z
          .enum(["outcome", "feedback", "event", "voice", "note", "note_result"])
          .optional()
          .describe(
            "Explicit mode selection. Auto-detected from params if omitted: " +
            "success → outcome, question_id → voice, event_type → event, subject+body → feedback."
          ),

        // --- Common ---
        note: noteSchema.optional().describe("[note] Authorized summary to share in this server's field-note store. Use a fresh session UUID per execution and stable request UUID for retries."),
        note_result: resultSchema.optional().describe("[note_result] Actual result of trying a note. Includes note_id, service_id, outcome, conditions and evidence."),
        service_id: z
          .string()
          .optional()
          .describe("Service ID. Required for outcome and voice modes. Optional for feedback and event."),
        agent_id: z
          .string()
          .optional()
          .describe("Your agent identifier (optional, for follow-up). Used in feedback and voice modes."),
        agent_type: z
          .string()
          .optional()
          .describe(
            "Agent platform type (claude, gpt, gemini, copilot, llama, deepseek, other). " +
            "Used in outcome mode (auto-inferred from model_name if omitted) and voice mode."
          ),

        // --- Outcome mode ---
        success: z
          .boolean()
          .optional()
          .describe("[outcome] Whether the operation succeeded."),
        latency_ms: z
          .number()
          .optional()
          .describe("[outcome] Response time in milliseconds."),
        error_type: z
          .string()
          .optional()
          .describe("[outcome] Error category if failed (e.g., 'auth_error', 'timeout', 'rate_limit', 'schema_mismatch')."),
        workaround: z
          .string()
          .optional()
          .describe("[outcome] How you resolved the issue, if any. Helps future agents."),
        context: z
          .string()
          .optional()
          .describe("[outcome] Additional context about the usage (PII will be auto-masked)."),
        is_retry: z
          .boolean()
          .optional()
          .describe("[outcome] Whether this is a retry of a previously failed call."),
        estimated_users: z
          .number()
          .optional()
          .describe("[outcome] Approximate number of end-users your agent serves."),
        model_name: z
          .string()
          .optional()
          .describe("[outcome] LLM model used (e.g., 'claude-sonnet-4', 'gpt-4o')."),
        task_type: z
          .string()
          .optional()
          .describe("[outcome] Operation performed (e.g., 'create_invoice', 'search_contacts')."),
        input_tokens: z
          .number()
          .int()
          .optional()
          .describe("[outcome] Input/prompt token count."),
        output_tokens: z
          .number()
          .int()
          .optional()
          .describe("[outcome] Output/completion token count."),
        cost_usd: z
          .number()
          .optional()
          .describe("[outcome] Actual cost in USD (estimated from tokens if omitted)."),
        attempt_id: z.string().uuid().optional().describe("[outcome] attempt_id returned by lookup."),
        recipe_id: z.string().optional().describe("[outcome] Recipe used for this attempt."),
        recipe_version: z.number().int().positive().optional().describe("[outcome] Recipe version returned by lookup."),
        failed_step: z.string().max(200).optional().describe("[outcome] Step identifier where execution stopped."),
        // Not constrained here on purpose (see report-outcome.ts): a malformed
        // value nulls that field and never rejects the whole report.
        note_id: z.unknown().optional().describe("[outcome] Field-note ID this report belongs to (format AWT-000). Stored as null if the format does not match."),
        provider_request_id: z.unknown().optional().describe("[outcome] Request or error ID the provider returned (e.g. from an x-request-id header). If present and well-formed, the record becomes traceable in the provider's own logs. Stored as null if the format does not match."),
        provider_request_id_source: z.unknown().optional().describe("[outcome] Where the provider request ID came from: 'header:<name>' (e.g. header:x-request-id) or 'body:<field>' (e.g. body:id)."),
        session_id: z.unknown().optional().describe("[outcome] Optional. A UUID you generate once and reuse for every report during one task, so reports from the same task count as one agent (only a salted hash is stored, never this value). Anything that is not a UUID is ignored."),
        provider_error_code: z.unknown().optional().describe("[outcome] Provider's error code string (e.g. expired_access_token) or an RFC 9457 problem type URI (https://…, max 200 chars). Stored as null if the format does not match."),

        // --- Feedback mode ---
        feedback_type: z
          .string()
          .optional()
          .describe(
            "[feedback] Type of feedback: suggestion, missing_data, correction, " +
            "feature_request, workaround_tip, bug_report, praise, other."
          ),
        subject: z
          .string()
          .optional()
          .describe("[feedback] Short summary of your feedback (1 line)."),
        body: z
          .string()
          .optional()
          .describe("[feedback] Your feedback in detail. Write freely."),
        priority: z
          .string()
          .optional()
          .describe("[feedback] How important: low, normal, high, critical. Default: normal."),

        // --- Event mode ---
        event_date: z
          .string()
          .optional()
          .describe("[event] When the event occurred or takes effect (YYYY-MM-DD)."),
        event_type: z
          .string()
          .optional()
          .describe(
            "[event] Category: api_change, api_deprecation, law_amendment, pricing_change, " +
            "outage, security_incident, feature_launch, competitor_move, mcp_update, other."
          ),
        title: z
          .string()
          .optional()
          .describe("[event] Short event title (e.g., 'freee API v3 deprecation')."),
        description: z
          .string()
          .optional()
          .describe("[event] Details about the event and expected impact."),
        impact_expected: z
          .string()
          .optional()
          .describe("[event] Expected impact: positive, negative, neutral, unknown."),

        // --- Voice mode ---
        question_id: z
          .string()
          .optional()
          .describe(
            "[voice] Which question to answer: selection_criteria, would_recommend, " +
            "biggest_frustration, best_feature, switching_likelihood, auth_experience, " +
            "doc_quality, error_handling, compared_to_competitor, mcp_readiness, free_voice."
          ),
        response_choice: z
          .string()
          .optional()
          .describe("[voice] Quick rating where applicable (e.g., 'strongly_yes', 'excellent', 'ready')."),
        response_text: z
          .string()
          .optional()
          .describe("[voice] Your honest answer in your own words."),
        confidence: z
          .string()
          .optional()
          .describe("[voice] How confident are you in this assessment? high, medium, low."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params, extra) => {
      const mode = detectMode(params);
      if (mode === "note" || mode === "note_result") {
        const result = noteOperation(() => mode === "note" ? recordNote(db, params.note) : recordResult(db, params.note_result));
        return { isError: "error" in result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }

      if (!mode) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "could_not_detect_mode",
                hint:
                  "Provide one of: (1) success=true/false for outcome reporting, " +
                  "(2) question_id for agent voice, (3) event_type for event recording, " +
                  "(4) subject+body for feedback. Or set mode explicitly.",
                available_modes: ["outcome", "feedback", "event", "voice"],
              }),
            },
          ],
        };
      }

      let result: object;
      switch (mode) {
        case "outcome":
          result = dispatchOutcome(
            db,
            params,
            // Mcp-Session-Id → the tool's session_id (UUID) → stdio install id → anonymous
            outcomeAgentMaterial({
              transportSessionId: extra?.sessionId,
              sessionHeader: extra?.requestInfo?.headers?.["mcp-session-id"],
              argSessionId: params.session_id,
              installMaterial: options.installMaterial,
            })
          );
          break;
        case "feedback":
          result = dispatchFeedback(db, params);
          break;
        case "event":
          result = dispatchEvent(db, params);
          break;
        case "voice":
          result = dispatchVoice(db, params);
          break;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ _mode: mode, ...result }, null, 2),
          },
        ],
      };
    }
  );
}
