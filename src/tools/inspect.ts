import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

import { getInspectionQueue } from "./get-inspection-queue.js";
import { submitInspection } from "./submit-inspection.js";
import { checkUpdates } from "./check-updates.js";
import { proposeUpdate, reviewUpdate, listPendingUpdates } from "./propose-update.js";
import { takeSnapshot } from "./take-snapshot.js";
import { evaluateDesign } from "./evaluate-design.js";

// ---------------------------------------------------------------------------
// Mode detection — resolves which underlying function to call.
// Priority order matches the spec: explicit mode > param inference.
// ---------------------------------------------------------------------------

type Mode =
  | "queue"
  | "submit"
  | "check_updates"
  | "propose"
  | "review"
  | "pending"
  | "snapshot"
  | "evaluate";

interface InspectParams {
  mode?: Mode;
  // queue params
  queue_status?: string;
  queue_severity?: string;
  queue_service_id?: string;
  queue_limit?: number;
  // submit params
  inspection_id?: number;
  verdict?: string;
  findings?: string;
  tested_workaround?: string;
  workaround_works?: boolean;
  // check_updates params
  check_service_id?: string;
  since_days?: number;
  // propose params
  propose_service_id?: string;
  field?: string;
  new_value?: string;
  changes?: Record<string, string>;
  reason?: string;
  evidence_url?: string;
  change_type?: string;
  agent_id?: string;
  // review params
  update_id?: number;
  approved?: boolean;
  reviewer?: string;
  review_note?: string;
  // pending params
  pending_status?: string;
  pending_service_id?: string;
  pending_limit?: number;
  // snapshot params
  snapshot_service_id?: string;
  snapshot_date?: string;
  // evaluate params
  evaluate_service_id?: string;
  api_quality_score?: number;
  doc_completeness_score?: number;
  auth_stability_score?: number;
  error_clarity_score?: number;
  evaluate_notes?: string;
}

function detectMode(params: InspectParams): Mode | null {
  // 1. Explicit mode override
  if (params.mode) return params.mode;

  // 2. inspection_id + verdict → submit (submitting inspection result)
  if (params.inspection_id != null && params.verdict) return "submit";

  // 3. inspection_id alone → queue (looking up specific inspection)
  if (params.inspection_id != null) return "queue";

  // 4. update_id + approved (boolean) → review
  if (params.update_id != null && typeof params.approved === "boolean")
    return "review";

  // 5. field + new_value → propose
  if (params.field && params.new_value) return "propose";

  // 6. pending_status → pending
  if (params.pending_status) return "pending";

  // 7. snapshot_service_id → snapshot
  if (params.snapshot_service_id) return "snapshot";

  // 8. evaluate_service_id → evaluate
  if (params.evaluate_service_id) return "evaluate";

  // 9. check_service_id → check_updates
  if (params.check_service_id) return "check_updates";

  // 10. No unique param → require explicit mode
  return null;
}

// ---------------------------------------------------------------------------
// Dispatch — calls the appropriate core function and returns the result.
// ---------------------------------------------------------------------------

function dispatch(
  db: Database.Database,
  mode: Mode,
  params: InspectParams
): object {
  switch (mode) {
    case "queue":
      return getInspectionQueue(db, {
        status: params.queue_status ?? "open",
        severity: params.queue_severity ?? "all",
        service_id: params.queue_service_id,
        limit: params.queue_limit ?? 10,
      });

    case "submit":
      return submitInspection(db, {
        inspection_id: params.inspection_id!,
        verdict: params.verdict!,
        findings: params.findings!,
        tested_workaround: params.tested_workaround,
        workaround_works: params.workaround_works,
      });

    case "check_updates":
      return checkUpdates(db, params.check_service_id!, params.since_days ?? 30);

    case "propose": {
      // Support both single field+new_value shorthand and full changes object
      const changes =
        params.changes && Object.keys(params.changes).length > 0
          ? params.changes
          : { [params.field!]: params.new_value! };
      return proposeUpdate(db, {
        service_id: params.propose_service_id!,
        changes,
        reason: params.reason!,
        evidence_url: params.evidence_url,
        change_type: params.change_type ?? "update",
        agent_id: params.agent_id,
      });
    }

    case "review":
      return reviewUpdate(db, {
        proposal_id: params.update_id!,
        action: params.approved ? "approve" : "reject",
        reviewer: params.reviewer ?? "michie",
        note: params.review_note,
      });

    case "pending":
      return listPendingUpdates(db, {
        status: params.pending_status ?? "pending",
        service_id: params.pending_service_id,
        limit: params.pending_limit ?? 20,
      });

    case "snapshot":
      return takeSnapshot(db, {
        service_id: params.snapshot_service_id,
        snapshot_date: params.snapshot_date,
      });

    case "evaluate":
      return evaluateDesign(db, {
        service_id: params.evaluate_service_id!,
        api_quality_score: params.api_quality_score!,
        doc_completeness_score: params.doc_completeness_score!,
        auth_stability_score: params.auth_stability_score!,
        error_clarity_score: params.error_clarity_score!,
        notes: params.evaluate_notes,
      });
  }
}

// ---------------------------------------------------------------------------
// Tip per mode — contextual guidance for agents in the response.
// ---------------------------------------------------------------------------

function tipForMode(mode: Mode): string {
  switch (mode) {
    case "queue":
      return "Pick an anomaly and use inspect({ inspection_id, verdict, findings }) to submit your verification.";
    case "submit":
      return "Inspection recorded. Trust scores updated. Use inspect({ mode: 'queue' }) to find more anomalies.";
    case "check_updates":
      return "Review breaking changes carefully before integrating. Use lookup for full service details.";
    case "propose":
      return "Proposal queued for review. Use inspect({ mode: 'pending' }) to check its status.";
    case "review":
      return "Review complete. Approved changes are auto-applied with changelog and trust recalculation.";
    case "pending":
      return "Use inspect({ update_id, approved: true/false }) to review individual proposals.";
    case "snapshot":
      return "Snapshot captured. Use lookup({ service_id, period }) to see historical trends.";
    case "evaluate":
      return "Design scores recorded. Builds historical data for consulting reports.";
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "inspect",
    {
      title: "Inspect",
      description:
        "Internal admin tool for colony health. " +
        "Inspect anomalies, manage update proposals, take snapshots, and evaluate MCP design patterns. " +
        "Modes: queue (view anomalies), submit (verify anomaly), check_updates (service changelog), " +
        "propose (PR-model data update), review (approve/reject proposal), pending (view proposal queue), " +
        "snapshot (capture daily metrics), evaluate (rate API design quality). " +
        "Mode is auto-detected from params or set explicitly.",
      inputSchema: z.object({
        mode: z
          .enum([
            "queue",
            "submit",
            "check_updates",
            "propose",
            "review",
            "pending",
            "snapshot",
            "evaluate",
          ])
          .optional()
          .describe("Explicit mode override. Auto-detected from params if omitted."),

        // --- Queue mode (view anomalies) ---
        queue_status: z
          .enum(["open", "in_progress", "resolved", "all"])
          .optional()
          .describe("[queue] Filter by status (default: open)"),
        queue_severity: z
          .enum(["low", "medium", "high", "critical", "all"])
          .optional()
          .describe("[queue] Filter by severity (default: all)"),
        queue_service_id: z
          .string()
          .optional()
          .describe("[queue] Filter by specific service ID"),
        queue_limit: z
          .number()
          .optional()
          .describe("[queue] Max results (default: 10)"),

        // --- Submit mode (verify anomaly) ---
        inspection_id: z
          .number()
          .optional()
          .describe(
            "[submit/queue] Inspection ID. With verdict → submit mode. Alone → queue lookup."
          ),
        verdict: z
          .enum(["confirmed", "false_alarm", "resolved", "partially_resolved"])
          .optional()
          .describe(
            "[submit] Your finding: confirmed, false_alarm, resolved, or partially_resolved"
          ),
        findings: z
          .string()
          .optional()
          .describe("[submit] What you found during inspection (PII auto-masked)"),
        tested_workaround: z
          .string()
          .optional()
          .describe("[submit] Workaround you tested, if any"),
        workaround_works: z
          .boolean()
          .optional()
          .describe("[submit] Did the tested workaround work?"),

        // --- Check updates mode (service changelog) ---
        check_service_id: z
          .string()
          .optional()
          .describe(
            "[check_updates] Service name or ID to check for changes. Triggers check_updates mode."
          ),
        since_days: z
          .number()
          .optional()
          .describe("[check_updates] How many days back to look (default: 30)"),

        // --- Propose mode (PR-model data update) ---
        propose_service_id: z
          .string()
          .optional()
          .describe("[propose] Service ID to propose changes for"),
        field: z
          .string()
          .optional()
          .describe(
            "[propose] Single field to update (shorthand). " +
            "Allowed: description, category, tags, mcp_endpoint, mcp_status, api_url, api_auth_method, namespace."
          ),
        new_value: z
          .string()
          .optional()
          .describe("[propose] New value for the field (used with field shorthand)"),
        changes: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "[propose] Object of field->new_value pairs (alternative to field+new_value)"
          ),
        reason: z
          .string()
          .optional()
          .describe("[propose] Why this change is needed"),
        evidence_url: z
          .string()
          .optional()
          .describe("[propose] URL to source (API docs, changelog)"),
        change_type: z
          .enum(["update", "new_feature", "deprecation", "breaking_change", "fix"])
          .optional()
          .describe("[propose] Type of change (default: update)"),
        agent_id: z
          .string()
          .optional()
          .describe("[propose/review] Agent identifier for attribution"),

        // --- Review mode (approve/reject proposal) ---
        update_id: z
          .number()
          .optional()
          .describe("[review] Proposal ID to review. With approved → review mode."),
        approved: z
          .boolean()
          .optional()
          .describe("[review] true = approve, false = reject"),
        reviewer: z
          .string()
          .optional()
          .describe("[review] Who is reviewing (default: michie)"),
        review_note: z
          .string()
          .optional()
          .describe("[review] Optional review comment"),

        // --- Pending mode (view proposal queue) ---
        pending_status: z
          .enum(["pending", "approved", "rejected", "all"])
          .optional()
          .describe(
            "[pending] Filter by status. Triggers pending mode when present."
          ),
        pending_service_id: z
          .string()
          .optional()
          .describe("[pending] Filter by service ID"),
        pending_limit: z
          .number()
          .optional()
          .describe("[pending] Max results (default: 20)"),

        // --- Snapshot mode (capture daily metrics) ---
        snapshot_service_id: z
          .string()
          .optional()
          .describe(
            "[snapshot] Service to snapshot. Triggers snapshot mode. Omit value to snapshot ALL."
          ),
        snapshot_date: z
          .string()
          .optional()
          .describe("[snapshot] Date to snapshot (YYYY-MM-DD, default: today)"),

        // --- Evaluate mode (rate API design quality) ---
        evaluate_service_id: z
          .string()
          .optional()
          .describe("[evaluate] Service to evaluate. Triggers evaluate mode."),
        api_quality_score: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "[evaluate] API design quality: RESTful conventions, naming, status codes (0.0-1.0)"
          ),
        doc_completeness_score: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "[evaluate] Documentation quality: completeness, accuracy, examples (0.0-1.0)"
          ),
        auth_stability_score: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "[evaluate] Auth reliability: token refresh, expiry handling, OAuth flow (0.0-1.0)"
          ),
        error_clarity_score: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "[evaluate] Error response quality: clear codes, actionable messages (0.0-1.0)"
          ),
        evaluate_notes: z
          .string()
          .optional()
          .describe("[evaluate] Free-text notes on design strengths/weaknesses"),
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
              text: JSON.stringify(
                {
                  error:
                    "No actionable parameters provided. " +
                    "Set mode explicitly or provide params that trigger auto-detection: " +
                    "inspection_id+verdict → submit, update_id+approved → review, " +
                    "field+new_value → propose, pending_status → pending, " +
                    "snapshot_service_id → snapshot, evaluate_service_id → evaluate, " +
                    "check_service_id → check_updates, or mode='queue' to view anomalies.",
                  _mode: null,
                  _meta: {
                    source: "kansei-link",
                    tip: "Start with inspect({ mode: 'queue' }) to see what needs attention.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Validate required params per mode before dispatching
      if (mode === "submit" && !params.findings) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error:
                    "Submit mode requires inspection_id, verdict, and findings.",
                  _mode: mode,
                  _meta: {
                    source: "kansei-link",
                    tip: "Describe what you found during inspection in the findings field.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (mode === "propose" && !params.propose_service_id) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error:
                    "Propose mode requires propose_service_id, field+new_value (or changes), and reason.",
                  _mode: mode,
                  _meta: {
                    source: "kansei-link",
                    tip: "Use search_services to find the service_id, then propose changes.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (mode === "evaluate") {
        const missing: string[] = [];
        if (params.api_quality_score == null) missing.push("api_quality_score");
        if (params.doc_completeness_score == null)
          missing.push("doc_completeness_score");
        if (params.auth_stability_score == null)
          missing.push("auth_stability_score");
        if (params.error_clarity_score == null)
          missing.push("error_clarity_score");
        if (missing.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: `Evaluate mode requires all 4 scores: ${missing.join(", ")}. Each is 0.0-1.0.`,
                    _mode: mode,
                    _meta: {
                      source: "kansei-link",
                      tip: "Score each dimension from 0.0 (terrible) to 1.0 (excellent).",
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      const result = dispatch(db, mode, params);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                _mode: mode,
                ...(Array.isArray(result) ? { results: result } : result),
                _meta: {
                  source: "kansei-link",
                  tip: tipForMode(mode),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
