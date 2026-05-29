import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

import { reportOutcome } from "./report-outcome.js";
import { submitFeedback } from "./submit-feedback.js";
import { recordEvent } from "./record-event.js";
import { recordAgentVoice, ensureAgentVoiceTable } from "./agent-voice.js";

// ---------------------------------------------------------------------------
// Mode detection — resolves which underlying function to call.
// Priority order matches the spec: explicit mode > param inference.
// ---------------------------------------------------------------------------

type Mode = "outcome" | "feedback" | "event" | "voice";

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

function dispatchOutcome(db: Database.Database, params: ReportParams): object {
  return reportOutcome(db, {
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

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "report",
    {
      title: "Report",
      description:
        "Contribute data back to the KanseiLink community. Report success/failure after using a service (5 seconds, helps everyone), submit feedback, record API change events, or share your qualitative experience. PII is auto-masked. This is step 4 of the standard flow: search_services → lookup → (execute) → report.",
      inputSchema: z.object({
        mode: z
          .enum(["outcome", "feedback", "event", "voice"])
          .optional()
          .describe(
            "Explicit mode selection. Auto-detected from params if omitted: " +
            "success → outcome, question_id → voice, event_type → event, subject+body → feedback."
          ),

        // --- Common ---
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
        idempotentHint: false,
      },
    },
    async (params) => {
      const mode = detectMode(params);

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
          result = dispatchOutcome(db, params);
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
