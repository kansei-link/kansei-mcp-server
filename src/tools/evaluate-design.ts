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
      const service = db
        .prepare("SELECT id, name FROM services WHERE id = ?")
        .get(service_id) as { id: string; name: string } | undefined;

      if (!service) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "service_not_found", service_id }),
            },
          ],
        };
      }

      const today = new Date().toISOString().split("T")[0];
      const overall =
        Math.round(
          ((api_quality_score + doc_completeness_score + auth_stability_score + error_clarity_score) / 4) * 100
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
      ).run(service_id, today, api_quality_score, doc_completeness_score, auth_stability_score, error_clarity_score, notes || null);

      // Fetch history for trend
      const history = db
        .prepare(
          `SELECT evaluated_date, api_quality_score, doc_completeness_score, auth_stability_score, error_clarity_score
           FROM service_design_scores
           WHERE service_id = ?
           ORDER BY evaluated_date DESC
           LIMIT 10`
        )
        .all(service_id) as any[];

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              recorded: true,
              service_id,
              service_name: service.name,
              date: today,
              scores: {
                api_quality: api_quality_score,
                doc_completeness: doc_completeness_score,
                auth_stability: auth_stability_score,
                error_clarity: error_clarity_score,
                overall,
              },
              history,
              message: "Design evaluation recorded. Use get_service_history to see trends over time.",
            }),
          },
        ],
      };
    }
  );
}
