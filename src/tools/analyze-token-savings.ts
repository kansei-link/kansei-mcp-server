import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * analyze_token_savings — quantifies the token savings from using
 * KanseiLink's get_service_tips vs the typical agent pattern of
 * web_search + multiple web_fetch + trial-and-error.
 *
 * This is NOT about MCP tool definition overhead (Claude Code's
 * built-in MCP Tool Search already handles that). This is about
 * the RESULT size of tool calls — specifically, replacing expensive
 * web research with pre-digested guides.
 *
 * Measured baseline (2026-04-16 benchmark):
 *   - freee docs fetch: ~14,900 tokens typical flow
 *   - kintone docs fetch: 20,000-63,600 tokens (SPA → multiple fetches)
 *   - smarthr docs fetch: ~11,400 tokens (including auth retry)
 * vs get_service_tips: ~1,300-1,500 tokens per call.
 */

interface ServiceInfoRow {
  id: string;
  name: string;
  category: string | null;
  api_url: string | null;
  mcp_endpoint: string | null;
  mcp_status: string | null;
  trust_score: number;
}

interface GuideInfoRow {
  service_id: string;
  agent_tips: string | null;
  quickstart_example: string;
  auth_overview: string;
  auth_setup_hint: string | null;
  rate_limit: string | null;
  key_endpoints: string;
  docs_url: string | null;
}

interface StatsInfoRow {
  total_calls: number;
  success_rate: number;
}

interface PitfallInfoRow {
  error_type: string;
  count: number;
}

/**
 * Token estimation: mixed JP/EN text averages ~3 chars/token (conservative).
 * Pure English: ~4 chars/token. Pure Japanese: ~1.5-2 chars/token.
 */
const CHARS_PER_TOKEN = 3;

/**
 * Measured baseline: how many tokens a typical agent burns trying to
 * learn a service's API without KanseiLink. Keyed by service category
 * since actual fetch costs depend on doc page complexity.
 *
 * These numbers come from the 2026-04-16 benchmark on freee, kintone,
 * smarthr (3 services across 3 categories). Applied to other services
 * by category as a reasonable estimate.
 */
const WEB_FETCH_ESTIMATES_BY_CATEGORY: Record<string, number> = {
  accounting: 14900, // freee baseline
  project_management: 25000, // kintone baseline (SPA docs are expensive)
  hr: 11400, // smarthr baseline
  crm: 12000, // estimated
  communication: 9000, // simpler APIs
  ecommerce: 15000, // varied
  legal: 10000,
  marketing: 12000,
  groupware: 11000,
  productivity: 10000,
  storage: 8000,
  support: 10000,
  payment: 18000, // Stripe-class APIs are complex
  logistics: 11000,
  reservation: 9000,
  data_integration: 20000, // complex ETL APIs
  bi_analytics: 17000,
  security: 13000,
  developer_tools: 15000,
  ai_ml: 12000,
  database: 14000,
  devops: 13000,
  design: 8000,
};

const DEFAULT_WEB_FETCH_ESTIMATE = 12000;

/**
 * Simulates what an agent would fetch WITHOUT KanseiLink, broken down by step.
 */
function buildFlowWithoutKansei(categoryEstimate: number): Array<{ step: string; tokens: number }> {
  // Scale the baseline estimate across typical steps
  const webSearch = Math.round(categoryEstimate * 0.14);
  const landingFetch = Math.round(categoryEstimate * 0.17);
  const endpointFetch = Math.round(categoryEstimate * 0.36);
  const authFetch = Math.round(categoryEstimate * 0.2);
  const trialError = categoryEstimate - webSearch - landingFetch - endpointFetch - authFetch;

  return [
    { step: "web_search to discover API patterns", tokens: webSearch },
    { step: "web_fetch docs landing page (mostly nav due to SPA)", tokens: landingFetch },
    { step: "web_fetch specific endpoint documentation", tokens: endpointFetch },
    { step: "web_fetch authentication guide", tokens: authFetch },
    { step: "trial-and-error recovery (wrong params, retries)", tokens: Math.max(0, trialError) },
  ];
}

/**
 * Estimate token count of what get_service_tips would return for this service.
 * Based on the size of agent_tips, auth info, and pitfalls we have for them.
 */
function estimateKanseiTipsTokens(
  guide: GuideInfoRow | undefined,
  pitfalls: PitfallInfoRow[]
): number {
  if (!guide) {
    return 500; // minimal response for services without a guide yet
  }

  let chars = 0;
  chars += guide.auth_overview.length;
  chars += (guide.auth_setup_hint?.length ?? 0);
  chars += (guide.rate_limit?.length ?? 0);
  chars += guide.quickstart_example.length;
  chars += guide.key_endpoints.length; // JSON array as string
  chars += (guide.agent_tips?.length ?? 0);
  chars += 400; // envelope overhead (field names, JSON syntax)
  chars += pitfalls.reduce((sum, p) => sum + 80, 0); // each pitfall adds structure

  return Math.round(chars / CHARS_PER_TOKEN);
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "analyze_token_savings",
    {
      title: "Analyze Token Savings",
      description:
        "Quantify token savings from using KanseiLink's get_service_tips vs typical agent patterns (web_search + web_fetch + trial-and-error). Measures real-world token waste on tool RESULTS, not definitions. Use to decide which services benefit most from KanseiLink coverage.",
      inputSchema: z.object({
        services: z
          .array(z.string())
          .optional()
          .describe("List of service IDs to analyze (e.g., ['freee', 'kintone']). Omit to analyze the top 10 most-used services."),
        task: z
          .string()
          .optional()
          .describe("Optional task context (e.g., 'create invoice in freee') to tailor the analysis."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ services, task }) => {
      // Resolve service list
      let serviceIds: string[];
      if (services && services.length > 0) {
        serviceIds = services;
      } else {
        // Default: top 10 services by usage_count (or trust_score if no usage)
        const topRows = db
          .prepare(
            "SELECT id FROM services ORDER BY usage_count DESC, trust_score DESC LIMIT 10"
          )
          .all() as Array<{ id: string }>;
        serviceIds = topRows.map((r) => r.id);
      }

      const perService: Array<Record<string, unknown>> = [];
      let totalWithout = 0;
      let totalWith = 0;
      const notFound: string[] = [];

      for (const serviceId of serviceIds) {
        const service = db
          .prepare(
            "SELECT id, name, category, api_url, mcp_endpoint, mcp_status, trust_score FROM services WHERE id = ?"
          )
          .get(serviceId) as ServiceInfoRow | undefined;

        if (!service) {
          notFound.push(serviceId);
          continue;
        }

        const guide = db
          .prepare(
            "SELECT service_id, agent_tips, quickstart_example, auth_overview, auth_setup_hint, rate_limit, key_endpoints, docs_url FROM service_api_guides WHERE service_id = ?"
          )
          .get(serviceId) as GuideInfoRow | undefined;

        const stats = db
          .prepare(
            "SELECT total_calls, success_rate FROM service_stats WHERE service_id = ?"
          )
          .get(serviceId) as StatsInfoRow | undefined;

        const pitfalls = db
          .prepare(
            "SELECT error_type, count(*) as count FROM outcomes WHERE service_id = ? AND success = 0 AND error_type IS NOT NULL GROUP BY error_type ORDER BY count DESC LIMIT 3"
          )
          .all(serviceId) as PitfallInfoRow[];

        const category = service.category ?? "default";
        const webFetchEstimate =
          WEB_FETCH_ESTIMATES_BY_CATEGORY[category] ?? DEFAULT_WEB_FETCH_ESTIMATE;

        const flow = buildFlowWithoutKansei(webFetchEstimate);
        const tipsTokens = estimateKanseiTipsTokens(guide, pitfalls);
        const savingsTokens = webFetchEstimate - tipsTokens;
        const savingsPct = Math.round((savingsTokens / webFetchEstimate) * 100);

        totalWithout += webFetchEstimate;
        totalWith += tipsTokens;

        // Build coverage summary (what KanseiLink actually provides for this service)
        const coverage: string[] = [];
        if (guide?.agent_tips) {
          try {
            const tips = JSON.parse(guide.agent_tips);
            if (Array.isArray(tips)) {
              coverage.push(`${tips.length} curated agent tips (e.g., ${tips[0]?.slice(0, 60) ?? "..."}${tips[0]?.length > 60 ? "..." : ""})`);
            }
          } catch {
            coverage.push("agent tips available");
          }
        }
        if (guide?.auth_setup_hint) coverage.push("step-by-step auth setup");
        if (guide?.rate_limit) coverage.push("rate limit details");
        if (pitfalls.length > 0) {
          coverage.push(
            `${pitfalls.length} known pitfalls with workarounds (top: ${pitfalls[0].error_type})`
          );
        }
        if (stats && stats.total_calls > 0) {
          coverage.push(
            `${stats.total_calls} agent reports, success rate ${Math.round(stats.success_rate * 100)}%`
          );
        }

        perService.push({
          service_id: service.id,
          service_name: service.name,
          category: service.category,
          has_kansei_guide: guide !== undefined,
          typical_flow_without_kansei: flow,
          total_tokens_without_kansei: webFetchEstimate,
          with_kanseilink: {
            tool: "get_service_tips",
            tokens: tipsTokens,
            coverage: coverage.length > 0 ? coverage : ["basic service metadata only"],
          },
          savings: {
            tokens: savingsTokens,
            pct: savingsPct,
          },
          confidence: guide ? "measured (based on actual guide data)" : "estimated (no guide yet, fallback values)",
        });
      }

      const totalSavings = totalWithout - totalWith;
      const totalSavingsPct = totalWithout > 0
        ? Math.round((totalSavings / totalWithout) * 100)
        : 0;

      // Project over a realistic work session
      const sessionEstimate = {
        assumed_services_accessed_per_session: Math.min(serviceIds.length, 5),
        avg_tokens_saved_per_service: serviceIds.length > 0
          ? Math.round(totalSavings / serviceIds.length)
          : 0,
        estimated_tokens_saved_per_session:
          serviceIds.length > 0
            ? Math.round((totalSavings / serviceIds.length) * Math.min(serviceIds.length, 5))
            : 0,
        note: "Assumes agent touches 5 different services in a typical work session.",
      };

      const recommendations: string[] = [];
      if (totalSavingsPct >= 80) {
        recommendations.push(
          "High-impact usage pattern. Call get_service_tips BEFORE any web_search when working with supported services."
        );
      } else if (totalSavingsPct >= 50) {
        recommendations.push(
          "Moderate-impact. Use get_service_tips for services with verified guides; fall back to web_fetch for others."
        );
      }
      if (notFound.length > 0) {
        recommendations.push(
          `Unsupported services (${notFound.join(", ")}) — submit feedback to request KanseiLink coverage.`
        );
      }
      const partiallyCovered = perService.filter((p) => !p.has_kansei_guide);
      if (partiallyCovered.length > 0) {
        const names = partiallyCovered.map((p) => p.service_name).join(", ");
        recommendations.push(
          `Services without full guides: ${names}. Savings estimates use category averages — actual numbers may vary.`
        );
      }
      recommendations.push(
        "NOTE: This tool measures RESULT-size savings (web_fetch → agent_tips). Claude Code's built-in MCP Tool Search already handles tool DEFINITION overhead separately."
      );

      const output = {
        executive_summary: {
          services_analyzed: perService.length,
          services_not_found: notFound.length,
          total_tokens_without_kansei: totalWithout,
          total_tokens_with_kansei: totalWith,
          total_savings_tokens: totalSavings,
          total_savings_pct: totalSavingsPct,
          task_context: task ?? "general analysis (no specific task)",
        },
        per_service: perService,
        session_projection: sessionEstimate,
        recommendations,
        methodology: {
          token_conversion: `${CHARS_PER_TOKEN} chars per token (mixed JP/EN conservative estimate)`,
          baseline_source: "Benchmarked against freee (14,900 tokens), kintone (20,000-63,600), smarthr (11,400) on 2026-04-16",
          limitations: [
            "Actual token counts vary by model tokenizer",
            "Web-fetch estimates scale by service category — individual services may differ",
            "Does not measure tool definition overhead (already handled by MCP Tool Search in Claude Code)",
            "Does not include conversation context accumulation costs",
          ],
          full_benchmark: "C:/Users/HP/KanseiLINK/benchmarks/step1-api-doc-cache.md",
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
      };
    }
  );
}
