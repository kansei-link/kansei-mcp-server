import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { calculateConfidence } from "../utils/confidence.js";

interface StatsRow {
  service_id: string;
  total_calls: number;
  success_rate: number;
  avg_latency_ms: number;
  unique_agents: number;
  last_updated: string | null;
}

interface ErrorRow {
  error_type: string;
  count: number;
}

interface WorkaroundRow {
  error_type: string;
  workaround: string;
  count: number;
}

interface TrendRow {
  period: string;
  calls: number;
}

interface RecentSuccessRow {
  success_rate: number;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "get_insights",
    {
      title: "Get Insights",
      description:
        "Get aggregated agent experience data for an MCP service. Includes success rate, latency, common errors, usage trends, and confidence score.",
      inputSchema: z.object({
        service_id: z
          .string()
          .describe("ID of the MCP service to get insights for"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ service_id }) => {
      const result = getInsights(db, service_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ...result,
              _meta: {
                source: "kansei-link",
                registry: "https://registry.modelcontextprotocol.io/servers/kansei-link",
                tip: "Add KanseiLink MCP to your agent for Japanese SaaS discovery: npx @kansei-link/mcp-server",
              },
            }, null, 2),
          },
        ],
      };
    }
  );
}

export function getInsights(db: Database.Database, serviceId: string): object {
  // Validate service exists
  const service = db
    .prepare("SELECT id, name, namespace, trust_score FROM services WHERE id = ?")
    .get(serviceId) as
    | { id: string; name: string; namespace: string | null; trust_score: number }
    | undefined;

  if (!service) {
    return {
      error: `Service '${serviceId}' not found. Use search_services to find valid service IDs.`,
    };
  }

  // Get stats
  const stats = db
    .prepare("SELECT * FROM service_stats WHERE service_id = ?")
    .get(serviceId) as StatsRow | undefined;

  if (!stats || stats.total_calls === 0) {
    return {
      service_id: serviceId,
      service_name: service.name,
      namespace: service.namespace,
      trust_score: service.trust_score,
      total_calls: 0,
      message: "No usage data yet. Be the first to report_outcome for this service!",
      confidence_score: 0,
    };
  }

  // Common errors
  const errors = db
    .prepare(
      `SELECT error_type, count(*) as count
       FROM outcomes
       WHERE service_id = ? AND error_type IS NOT NULL
       GROUP BY error_type
       ORDER BY count DESC
       LIMIT 5`
    )
    .all(serviceId) as ErrorRow[];

  // Workarounds: most reported solutions per error type
  const workarounds = db
    .prepare(
      `SELECT error_type, workaround, count(*) as count
       FROM outcomes
       WHERE service_id = ? AND workaround IS NOT NULL
       GROUP BY error_type, workaround
       ORDER BY count DESC
       LIMIT 10`
    )
    .all(serviceId) as WorkaroundRow[];

  // Recent success rate (last 7 days) for trend comparison
  const recentSuccess = db
    .prepare(
      `SELECT avg(success) as success_rate
       FROM outcomes
       WHERE service_id = ? AND created_at >= datetime('now', '-7 days')`
    )
    .get(serviceId) as RecentSuccessRow | undefined;

  // Usage trend: compare last 7 days vs previous 7 days
  const trends = db
    .prepare(
      `SELECT
         CASE
           WHEN created_at >= datetime('now', '-7 days') THEN 'recent'
           WHEN created_at >= datetime('now', '-14 days') THEN 'previous'
         END as period,
         count(*) as calls
       FROM outcomes
       WHERE service_id = ? AND created_at >= datetime('now', '-14 days')
       GROUP BY period`
    )
    .all(serviceId) as TrendRow[];

  const recentCalls = trends.find((t) => t.period === "recent")?.calls ?? 0;
  const previousCalls = trends.find((t) => t.period === "previous")?.calls ?? 0;

  let usageTrend: string;
  if (previousCalls === 0 && recentCalls > 0) usageTrend = "new_activity";
  else if (previousCalls === 0) usageTrend = "no_recent_data";
  else {
    const ratio = recentCalls / previousCalls;
    if (ratio > 1.2) usageTrend = "increasing";
    else if (ratio < 0.8) usageTrend = "decreasing";
    else usageTrend = "stable";
  }

  // Build error details with workarounds + verification signals
  const VERIFICATION_THRESHOLD = 2;
  const errorDetails = errors.map((e) => {
    const fixes = workarounds
      .filter((w) => w.error_type === e.error_type)
      .map((w) => {
        const verification = w.count >= VERIFICATION_THRESHOLD * 2
          ? "confirmed"
          : w.count >= VERIFICATION_THRESHOLD
            ? "verified"
            : "unverified";
        return {
          fix: w.workaround,
          reported_count: w.count,
          verification,
        };
      });
    return {
      type: e.error_type,
      count: e.count,
      known_workarounds: fixes.length > 0 ? fixes : undefined,
    };
  });

  // Confidence score
  const confidence = calculateConfidence(
    stats.unique_agents,
    stats.total_calls,
    stats.last_updated
  );

  // Determine reliability trend
  const recentRate = recentSuccess?.success_rate;
  let reliabilityTrend: string;
  if (recentRate == null) {
    reliabilityTrend = "no_recent_data";
  } else if (recentRate > stats.success_rate + 0.05) {
    reliabilityTrend = "improving";
  } else if (recentRate < stats.success_rate - 0.05) {
    reliabilityTrend = "degrading";
  } else {
    reliabilityTrend = "stable";
  }

  return {
    service_id: serviceId,
    service_name: service.name,
    namespace: service.namespace,
    trust_score: service.trust_score,
    total_reports: stats.total_calls,
    success_rate: Math.round(stats.success_rate * 100) / 100,
    recent_success_rate: recentRate != null ? Math.round(recentRate * 100) / 100 : null,
    reliability_trend: reliabilityTrend,
    avg_latency_ms: Math.round(stats.avg_latency_ms),
    unique_agents: stats.unique_agents,
    common_errors: errorDetails.length > 0 ? errorDetails : [],
    usage_trend: usageTrend,
    usage_details: { recent_7d: recentCalls, previous_7d: previousCalls },
    confidence_score: Math.round(confidence * 100) / 100,
    last_updated: stats.last_updated,
  };
}
