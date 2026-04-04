import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "submit_inspection",
    {
      title: "Submit Inspection",
      description:
        "Submit your verification of an anomaly from the inspection queue. " +
        "You are the scout ant — test the service, verify the issue, " +
        "and report whether the anomaly is confirmed, resolved, or a false alarm. " +
        "Your inspection updates trust scores and helps the colony self-correct.",
      inputSchema: z.object({
        inspection_id: z
          .number()
          .describe("ID of the inspection to resolve (from get_inspection_queue)"),
        verdict: z
          .enum(["confirmed", "false_alarm", "resolved", "partially_resolved"])
          .describe(
            "Your finding: " +
            "'confirmed' = issue is real, " +
            "'false_alarm' = could not reproduce, " +
            "'resolved' = issue was real but is now fixed, " +
            "'partially_resolved' = issue exists but workaround works"
          ),
        findings: z
          .string()
          .describe("What you found during inspection (PII will be auto-masked)"),
        tested_workaround: z
          .string()
          .optional()
          .describe("If you tested a workaround, describe it here"),
        workaround_works: z
          .boolean()
          .optional()
          .describe("Did the tested workaround actually work?"),
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ inspection_id, verdict, findings, tested_workaround, workaround_works }) => {
      const result = submitInspection(db, {
        inspection_id,
        verdict,
        findings,
        tested_workaround,
        workaround_works,
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

interface InspectionInput {
  inspection_id: number;
  verdict: string;
  findings: string;
  tested_workaround?: string;
  workaround_works?: boolean;
}

interface InspectionRow {
  id: number;
  service_id: string;
  anomaly_type: string;
  severity: string;
  status: string;
}

function submitInspection(
  db: Database.Database,
  input: InspectionInput
): object {
  // Validate inspection exists
  const inspection = db
    .prepare("SELECT id, service_id, anomaly_type, severity, status FROM inspections WHERE id = ?")
    .get(input.inspection_id) as InspectionRow | undefined;

  if (!inspection) {
    return {
      submitted: false,
      error: `Inspection #${input.inspection_id} not found. Use get_inspection_queue to find valid IDs.`,
    };
  }

  if (inspection.status === "resolved") {
    return {
      submitted: false,
      error: `Inspection #${input.inspection_id} is already resolved.`,
    };
  }

  // Mask PII in findings
  const maskedFindings = maskPii(input.findings);

  // Build resolution summary
  const resolution: Record<string, unknown> = {
    verdict: input.verdict,
    findings: maskedFindings.masked,
  };
  if (input.tested_workaround) {
    const maskedWorkaround = maskPii(input.tested_workaround);
    resolution.tested_workaround = maskedWorkaround.masked;
    resolution.workaround_works = input.workaround_works ?? null;
  }

  // Determine new status
  const newStatus = input.verdict === "confirmed" ? "in_progress" : "resolved";

  // Update inspection
  db.prepare(
    `UPDATE inspections
     SET status = ?, resolution = ?, resolved_by = 'scout_agent', resolved_at = datetime('now')
     WHERE id = ?`
  ).run(newStatus, JSON.stringify(resolution), input.inspection_id);

  // Apply trust score adjustments based on verdict
  const trustAdjustment = applyTrustAdjustment(
    db,
    inspection.service_id,
    inspection.anomaly_type,
    input.verdict,
    inspection.severity
  );

  // If workaround was tested and it doesn't work, also record as outcome
  if (input.tested_workaround && input.workaround_works === false) {
    db.prepare(
      `INSERT INTO outcomes (service_id, agent_id_hash, success, error_type, workaround, context_masked)
       VALUES (?, 'scout_agent', 0, ?, NULL, ?)`
    ).run(
      inspection.service_id,
      inspection.anomaly_type,
      `[Scout inspection] Tested workaround "${input.tested_workaround}" — did NOT work.`
    );
  } else if (input.tested_workaround && input.workaround_works === true) {
    const maskedWA = maskPii(input.tested_workaround);
    db.prepare(
      `INSERT INTO outcomes (service_id, agent_id_hash, success, error_type, workaround, context_masked)
       VALUES (?, 'scout_agent', 1, NULL, ?, ?)`
    ).run(
      inspection.service_id,
      maskedWA.masked,
      `[Scout inspection] Verified workaround works.`
    );
  }

  return {
    submitted: true,
    inspection_id: input.inspection_id,
    service_id: inspection.service_id,
    anomaly_type: inspection.anomaly_type,
    verdict: input.verdict,
    new_status: newStatus,
    trust_adjustment: trustAdjustment,
    message: getVerdictMessage(input.verdict),
  };
}

/**
 * Adjust service trust score based on inspection verdict.
 * Scout ants directly influence the colony's trust map.
 */
function applyTrustAdjustment(
  db: Database.Database,
  serviceId: string,
  anomalyType: string,
  verdict: string,
  severity: string
): { previous: number; new: number; reason: string } {
  const service = db
    .prepare("SELECT trust_score FROM services WHERE id = ?")
    .get(serviceId) as { trust_score: number };

  let adjustment = 0;
  let reason = "";

  // Severity weights
  const severityWeight: Record<string, number> = {
    critical: 0.10,
    high: 0.07,
    medium: 0.04,
    low: 0.02,
  };
  const weight = severityWeight[severity] ?? 0.04;

  switch (verdict) {
    case "confirmed":
      // Anomaly is real — reduce trust
      adjustment = -weight;
      reason = `Anomaly "${anomalyType}" confirmed by scout. Trust reduced.`;
      break;
    case "false_alarm":
      // Not real — slight trust boost (service was wrongly suspected)
      adjustment = weight * 0.5;
      reason = `"${anomalyType}" was a false alarm. Trust slightly restored.`;
      break;
    case "resolved":
      // Was real but fixed — restore trust partially
      adjustment = weight * 0.3;
      reason = `"${anomalyType}" was real but is now resolved. Trust partially restored.`;
      break;
    case "partially_resolved":
      // Exists but manageable — minor reduction
      adjustment = -weight * 0.3;
      reason = `"${anomalyType}" partially resolved. Minor trust adjustment.`;
      break;
  }

  const newScore = Math.max(0, Math.min(1, service.trust_score + adjustment));

  db.prepare("UPDATE services SET trust_score = ? WHERE id = ?").run(
    Math.round(newScore * 1000) / 1000,
    serviceId
  );

  return {
    previous: Math.round(service.trust_score * 1000) / 1000,
    new: Math.round(newScore * 1000) / 1000,
    reason,
  };
}

function getVerdictMessage(verdict: string): string {
  switch (verdict) {
    case "confirmed":
      return "Anomaly confirmed. Status set to 'in_progress' — other agents will see the warning. Thank you, scout!";
    case "false_alarm":
      return "False alarm cleared. Inspection resolved. The colony thanks your vigilance!";
    case "resolved":
      return "Issue was real but is now fixed. Inspection resolved. Great work, scout!";
    case "partially_resolved":
      return "Issue exists but is manageable. Other agents will see the status. Thank you for the detailed inspection!";
    default:
      return "Inspection recorded. Thank you!";
  }
}
