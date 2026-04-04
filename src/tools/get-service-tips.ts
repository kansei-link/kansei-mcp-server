import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

interface ServiceRow {
  id: string;
  name: string;
  category: string | null;
  api_url: string | null;
  api_auth_method: string | null;
  mcp_endpoint: string | null;
  mcp_status: string | null;
  trust_score: number;
}

interface GuideRow {
  base_url: string;
  api_version: string | null;
  auth_overview: string;
  auth_token_url: string | null;
  auth_scopes: string | null;
  auth_setup_hint: string | null;
  sandbox_url: string | null;
  rate_limit: string | null;
  quickstart_example: string;
  agent_tips: string | null;
  docs_url: string | null;
}

interface StatsRow {
  total_calls: number;
  success_rate: number;
  avg_latency_ms: number;
  unique_agents: number;
}

interface PitfallRow {
  error_type: string;
  count: number;
  workaround: string | null;
}

interface RecentOutcomeRow {
  success: number;
  latency_ms: number | null;
  error_type: string | null;
  workaround: string | null;
  created_at: string;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "get_service_tips",
    {
      title: "Get Service Tips",
      description:
        "Get practical tips before using an MCP service. Returns auth setup, common pitfalls, workarounds from other agents, and reliability data. Like checking restaurant reviews before visiting.",
      inputSchema: z.object({
        service_id: z
          .string()
          .describe("ID of the MCP service you plan to use"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ service_id }) => {
      const result = getServiceTips(db, service_id);
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

export function getServiceTips(db: Database.Database, serviceId: string): object {
  // Get service info
  const service = db
    .prepare(
      "SELECT id, name, category, api_url, api_auth_method, mcp_endpoint, mcp_status, trust_score FROM services WHERE id = ?"
    )
    .get(serviceId) as ServiceRow | undefined;

  if (!service) {
    return {
      error: `Service '${serviceId}' not found. Use search_services to find valid service IDs.`,
    };
  }

  // Get API guide if available
  const guide = db
    .prepare("SELECT * FROM service_api_guides WHERE service_id = ?")
    .get(serviceId) as GuideRow | undefined;

  // Get community stats
  const stats = db
    .prepare("SELECT total_calls, success_rate, avg_latency_ms, unique_agents FROM service_stats WHERE service_id = ?")
    .get(serviceId) as StatsRow | undefined;

  // Get top pitfalls with workarounds
  const pitfalls = db
    .prepare(
      `SELECT o.error_type, count(*) as count,
              (SELECT w.workaround FROM outcomes w
               WHERE w.service_id = ? AND w.error_type = o.error_type AND w.workaround IS NOT NULL
               ORDER BY w.created_at DESC LIMIT 1) as workaround
       FROM outcomes o
       WHERE o.service_id = ? AND o.error_type IS NOT NULL
       GROUP BY o.error_type
       ORDER BY count DESC
       LIMIT 5`
    )
    .all(serviceId, serviceId) as PitfallRow[];

  // Get most recent outcomes for freshness signal
  const recentOutcomes = db
    .prepare(
      `SELECT success, latency_ms, error_type, workaround, created_at
       FROM outcomes
       WHERE service_id = ?
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all(serviceId) as RecentOutcomeRow[];

  // Build auth section
  const auth: Record<string, unknown> = {};
  if (guide) {
    auth.type = guide.auth_overview;
    if (guide.auth_token_url) auth.token_url = guide.auth_token_url;
    if (guide.auth_scopes) auth.scopes = guide.auth_scopes;
    if (guide.auth_setup_hint) auth.setup_hint = guide.auth_setup_hint;
    if (guide.sandbox_url) auth.sandbox_url = guide.sandbox_url;
  } else if (service.api_auth_method) {
    auth.type = service.api_auth_method;
    auth.note = "Detailed auth guide not yet available. Check docs_url for setup instructions.";
  } else {
    auth.type = "unknown";
    auth.note = "Auth method not documented yet.";
  }

  // Build pitfalls section
  const commonPitfalls = pitfalls.map((p) => ({
    issue: p.error_type,
    frequency: p.count,
    fix: p.workaround ?? "No workaround reported yet",
  }));

  // Build reliability summary
  let reliabilityLabel: string;
  if (!stats || stats.total_calls === 0) {
    reliabilityLabel = "no_data";
  } else if (stats.success_rate >= 0.95) {
    reliabilityLabel = "excellent";
  } else if (stats.success_rate >= 0.8) {
    reliabilityLabel = "good";
  } else if (stats.success_rate >= 0.6) {
    reliabilityLabel = "fair";
  } else {
    reliabilityLabel = "poor";
  }

  // Build recent activity summary
  const recentActivity = recentOutcomes.length > 0
    ? {
        last_report: recentOutcomes[0].created_at,
        last_5_results: recentOutcomes.map((o) => ({
          success: o.success === 1,
          latency_ms: o.latency_ms,
          error: o.error_type ?? undefined,
        })),
      }
    : null;

  // Assemble tips
  const tips: Record<string, unknown> = {
    service_id: service.id,
    service_name: service.name,
    category: service.category,
    trust_score: service.trust_score,

    // Connection info
    connection: {
      mcp_endpoint: service.mcp_endpoint ?? null,
      mcp_status: service.mcp_status,
      api_url: service.api_url ?? guide?.base_url ?? null,
      docs_url: guide?.docs_url ?? null,
    },

    // Auth guide
    auth,

    // Reliability
    reliability: {
      label: reliabilityLabel,
      success_rate: stats ? Math.round(stats.success_rate * 100) / 100 : null,
      avg_latency_ms: stats ? Math.round(stats.avg_latency_ms) : null,
      total_reports: stats?.total_calls ?? 0,
      unique_agents: stats?.unique_agents ?? 0,
    },

    // Pitfalls from community
    common_pitfalls: commonPitfalls.length > 0 ? commonPitfalls : "No issues reported yet — you may be among the first to use this service!",

    // Recent activity
    recent_activity: recentActivity,
  };

  // Add rate limit and agent tips from guide
  if (guide) {
    if (guide.rate_limit) tips.rate_limit = guide.rate_limit;
    if (guide.agent_tips) {
      try {
        tips.agent_tips = JSON.parse(guide.agent_tips);
      } catch {
        tips.agent_tips = guide.agent_tips;
      }
    }
    if (guide.quickstart_example) tips.quickstart = guide.quickstart_example;
  }

  return tips;
}
