import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * evaluate_design: Score a service's API/MCP design quality.
 * Used by scout agents or manually to build design evaluation history.
 * Powers the "設計評価" dimension of consulting reports.
 */
export function register(server: McpServer, db: Database.Database): void {
  server.tool(
    "evaluate_design",
    "Rate a service's API/MCP design quality across 4 dimensions. Builds historical design scores for consulting reports. Scale: 0.0 (terrible) to 1.0 (excellent).",
    {
      service_id: z.string().describe("Service to evaluate"),
      api_quality_score: z
        .number()
        .min(0)
        .max(1)
        .describe("API design quality: RESTful conventions, consistent naming, proper status codes, pagination (0.0-1.0)"),
      doc_completeness_score: z
        .number()
        .min(0)
        .max(1)
        .describe("Documentation quality: completeness, accuracy, examples, JP/EN availability (0.0-1.0)"),
      auth_stability_score: z
        .number()
        .min(0)
        .max(1)
        .describe("Authentication reliability: token refresh, expiry handling, error messages, OAuth flow (0.0-1.0)"),
      error_clarity_score: z
        .number()
        .min(0)
        .max(1)
        .describe("Error response quality: clear codes, actionable messages, consistent format (0.0-1.0)"),
      notes: z
        .string()
        .optional()
        .describe("Free-text notes on design strengths/weaknesses"),
    },
    async ({ service_id, api_quality_score, doc_completeness_score, auth_stability_score, error_clarity_score, notes }) => {
      const result = evaluateDesign(db, {
        service_id,
        api_quality_score,
        doc_completeness_score,
        auth_stability_score,
        error_clarity_score,
        notes,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );
}

export function evaluateDesign(
  db: Database.Database,
  input: {
    service_id: string;
    api_quality_score: number;
    doc_completeness_score: number;
    auth_stability_score: number;
    error_clarity_score: number;
    notes?: string;
  }
): object {
  const service = db
    .prepare("SELECT id, name FROM services WHERE id = ?")
    .get(input.service_id) as { id: string; name: string } | undefined;

  if (!service) {
    return { error: "service_not_found", service_id: input.service_id };
  }

  const today = new Date().toISOString().split("T")[0];
  const overall =
    Math.round(
      ((input.api_quality_score + input.doc_completeness_score + input.auth_stability_score + input.error_clarity_score) / 4) * 100
    ) / 100;

  db.prepare(
    `INSERT INTO service_design_scores (service_id, evaluated_date, api_quality_score, doc_completeness_score, auth_stability_score, error_clarity_score, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(service_id, evaluated_date) DO UPDATE SET
       api_quality_score = excluded.api_quality_score,
       doc_completeness_score = excluded.doc_completeness_score,
       auth_stability_score = excluded.auth_stability_score,
       error_clarity_score = excluded.error_clarity_score,
       notes = excluded.notes`
  ).run(input.service_id, today, input.api_quality_score, input.doc_completeness_score, input.auth_stability_score, input.error_clarity_score, input.notes || null);

  // Fetch history for trend
  const history = db
    .prepare(
      `SELECT evaluated_date, api_quality_score, doc_completeness_score, auth_stability_score, error_clarity_score
       FROM service_design_scores
       WHERE service_id = ?
       ORDER BY evaluated_date DESC
       LIMIT 10`
    )
    .all(input.service_id) as any[];

  return {
    recorded: true,
    service_id: input.service_id,
    service_name: service.name,
    date: today,
    scores: {
      api_quality: input.api_quality_score,
      doc_completeness: input.doc_completeness_score,
      auth_stability: input.auth_stability_score,
      error_clarity: input.error_clarity_score,
      overall,
    },
    history,
    message: "Design evaluation recorded. Use get_service_history to see trends over time.",
  };
}
