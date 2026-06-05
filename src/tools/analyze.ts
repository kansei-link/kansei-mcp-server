import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

import { analyzeTokenSavings } from "./analyze-token-savings.js";
import { auditCost, filterRecommendations } from "./audit-cost.js";
import { generateAeoReport } from "./generate-aeo-report.js";
import { generateArticle } from "./generate-aeo-article.js";
import { kanseiAppLink } from "../utils/app-link.js";

// ---------------------------------------------------------------------------
// Mode detection — resolves which underlying function to call.
// Priority order matches the spec: explicit mode > param inference.
// ---------------------------------------------------------------------------

type Mode = "token_savings" | "cost" | "aeo_report" | "aeo_article";

interface AnalyzeParams {
  mode?: Mode;
  // token_savings params
  services?: string[];
  task?: string;
  // cost params
  cost_service_id?: string;
  period_days?: number;
  top_n?: number;
  min_priority?: "low" | "medium" | "high";
  // aeo_report params
  aeo_service_id?: string;
  category?: string;
  aeo_top_n?: number;
  include_recommendations?: boolean;
  // aeo_article params
  quarter?: string;
  format?: "markdown" | "json";
  article_top_n?: number;
  categories?: string[];
  // inference helpers
  model?: string;
  period?: string;
  article_type?: string;
  target_keyword?: string;
}

function detectMode(params: AnalyzeParams): Mode | null {
  // 1. Explicit mode override
  if (params.mode) return params.mode;

  // 2. category param present → token_savings (it's unique to that tool
  //    as a filtering concept for token analysis by service category)
  if (params.category && !params.aeo_service_id && !params.article_type && !params.target_keyword) {
    return "token_savings";
  }

  // 3. cost_service_id or period + model → cost
  if (params.cost_service_id) return "cost";
  if (params.period && params.model) return "cost";

  // 4. aeo_service_id present and no article-specific params → aeo_report
  if (params.aeo_service_id && !params.article_type && !params.target_keyword) {
    return "aeo_report";
  }

  // 5. article_type or target_keyword present → aeo_article
  if (params.article_type || params.target_keyword) return "aeo_article";

  // 6. No unique param → return null
  return null;
}

// ---------------------------------------------------------------------------
// Dispatch — calls the appropriate core function and returns the result.
// ---------------------------------------------------------------------------

function dispatch(
  db: Database.Database,
  mode: Mode,
  params: AnalyzeParams
): object | string {
  switch (mode) {
    case "token_savings":
      return analyzeTokenSavings(db, {
        services: params.services,
        task: params.task,
      });

    case "cost": {
      const raw = auditCost(
        db,
        params.cost_service_id,
        params.period_days ?? 30
      );
      return filterRecommendations(
        raw as any,
        params.top_n ?? 10,
        params.min_priority ?? "low"
      );
    }

    case "aeo_report":
      return generateAeoReport(db, {
        category: params.category,
        topN: params.aeo_top_n ?? 20,
        includeRecommendations: params.include_recommendations ?? true,
      });

    case "aeo_article":
      return generateArticle(db, {
        quarter: params.quarter ?? "Q2 2026",
        format: params.format ?? "markdown",
        topN: params.article_top_n ?? 20,
        categories: params.categories,
      });
  }
}

// ---------------------------------------------------------------------------
// Tip per mode — contextual guidance for agents in the response.
// ---------------------------------------------------------------------------

function tipForMode(mode: Mode): string {
  switch (mode) {
    case "token_savings":
      return "Use these numbers to justify KanseiLink adoption. lookup with service_id for the full guide.";
    case "cost":
      return "Act on high-priority recommendations first. report_outcome with model_name and token counts improves future audits.";
    case "aeo_report":
      return "Share AEO scores with SaaS vendors to encourage agent-readiness improvements.";
    case "aeo_article":
      return "Ready to publish. Review rankings for accuracy before distribution.";
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "analyze",
    {
      title: "Analyze",
      description:
        "Analytics and reporting. Analyze token savings, audit agent costs, generate AEO reports and articles.",
      inputSchema: z.object({
        mode: z
          .enum(["token_savings", "cost", "aeo_report", "aeo_article"])
          .optional()
          .describe(
            "Explicit mode selection. Auto-detected from params if omitted: " +
            "category → token_savings, cost_service_id → cost, aeo_service_id → aeo_report, " +
            "article_type/target_keyword → aeo_article."
          ),

        // --- token_savings mode ---
        services: z
          .array(z.string())
          .optional()
          .describe(
            "[token_savings] List of service IDs to analyze (e.g., ['freee', 'kintone']). " +
            "Omit to analyze the top 10 most-used services."
          ),
        task: z
          .string()
          .optional()
          .describe(
            "[token_savings] Optional task context (e.g., 'create invoice in freee') to tailor the analysis."
          ),

        // --- cost mode ---
        cost_service_id: z
          .string()
          .optional()
          .describe("[cost] Audit a specific service, or omit for all services."),
        period_days: z
          .number()
          .int()
          .optional()
          .describe("[cost] Analysis period in days (default: 30)."),
        top_n: z
          .number()
          .int()
          .optional()
          .describe(
            "[cost] Max recommendations to return (default: 10, max 50). " +
            "Sorted by priority (high first) then by monthly_savings_usd desc."
          ),
        min_priority: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe(
            "[cost] Minimum priority level to include. " +
            "'high' returns only impactful recs; 'low' returns everything."
          ),

        // --- aeo_report mode ---
        aeo_service_id: z
          .string()
          .optional()
          .describe(
            "[aeo_report] Filter by service ID. Triggers aeo_report mode when present (without article params)."
          ),
        category: z
          .string()
          .optional()
          .describe(
            "[token_savings/aeo_report] Filter by category (e.g., 'accounting', 'hr', 'crm'). " +
            "Triggers token_savings when used alone."
          ),
        aeo_top_n: z
          .number()
          .optional()
          .describe("[aeo_report] Number of top services to return (default: 20)."),
        include_recommendations: z
          .boolean()
          .optional()
          .describe("[aeo_report] Include improvement recommendations per service (default: true)."),

        // --- aeo_article mode ---
        quarter: z
          .string()
          .optional()
          .describe("[aeo_article] Report period label (e.g., 'Q2 2026', '2026年上半期')."),
        format: z
          .enum(["markdown", "json"])
          .optional()
          .describe("[aeo_article] Output format: 'markdown' for blog/press, 'json' for API/embed."),
        article_top_n: z
          .number()
          .optional()
          .describe("[aeo_article] Number of services in the overall ranking table (default: 20)."),
        categories: z
          .array(z.string())
          .optional()
          .describe("[aeo_article] Focus categories for deep-dive sections. Omit for default set."),
        article_type: z
          .string()
          .optional()
          .describe("[aeo_article] Article type hint. Triggers aeo_article mode when present."),
        target_keyword: z
          .string()
          .optional()
          .describe("[aeo_article] Target keyword for the article. Triggers aeo_article mode when present."),

        // --- Inference helpers ---
        model: z
          .string()
          .optional()
          .describe("[cost] Model name hint for cost mode detection."),
        period: z
          .string()
          .optional()
          .describe("[cost] Period hint for cost mode detection."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
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
                    "Pass services or category for token_savings, " +
                    "cost_service_id for cost audit, " +
                    "aeo_service_id for AEO report, " +
                    "or article_type/target_keyword for AEO article. " +
                    "Or set mode explicitly.",
                  _mode: null,
                  available_modes: ["token_savings", "cost", "aeo_report", "aeo_article"],
                  _meta: {
                    source: "kansei-link",
                    tip: "Set mode explicitly or provide mode-specific params for auto-detection.",
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
      if (mode === "cost" && params.period_days !== undefined && params.period_days < 1) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "period_days must be at least 1.",
                  _mode: mode,
                  _meta: {
                    source: "kansei-link",
                    tip: "Pass period_days as a positive integer (default: 30).",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = dispatch(db, mode, params);
      // A21: canonical app/deep-link for the applicable modes (cost recommendations / per-service aeo score).
      const kl =
        mode === "cost" ? kanseiAppLink("cost_optimization", { service_id: params.cost_service_id })
        : mode === "aeo_report" ? kanseiAppLink("score_detail", { service_id: params.aeo_service_id })
        : null;

      // aeo_article in markdown mode returns a string
      if (typeof result === "string") {
        return {
          content: [
            {
              type: "text" as const,
              text: result,
            },
          ],
        };
      }

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
                  ...(kl ? { kansei_link: kl } : {}),
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
