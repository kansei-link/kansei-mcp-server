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

interface WorkaroundDetailRow {
  error_type: string;
  workaround: string;
  total_reports: number;
  success_after: number;
  failure_after: number;
  oldest_report: string;
  newest_report: string;
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

  // Get top pitfalls (error frequency)
  const pitfalls = db
    .prepare(
      `SELECT error_type, count(*) as count
       FROM outcomes
       WHERE service_id = ? AND error_type IS NOT NULL
       GROUP BY error_type
       ORDER BY count DESC
       LIMIT 5`
    )
    .all(serviceId) as { error_type: string; count: number }[];

  // Get workaround details with verification signals
  // For each workaround, check: how many agents reported it,
  // and did outcomes AFTER that workaround trend success or failure?
  const workaroundDetails = db
    .prepare(
      `SELECT
         w.error_type,
         w.workaround,
         count(*) as total_reports,
         -- Count successes reported AFTER this workaround was first shared
         (SELECT count(*) FROM outcomes o2
          WHERE o2.service_id = ? AND o2.success = 1
          AND o2.created_at > (SELECT min(o3.created_at) FROM outcomes o3
            WHERE o3.service_id = ? AND o3.workaround = w.workaround)
         ) as success_after,
         (SELECT count(*) FROM outcomes o4
          WHERE o4.service_id = ? AND o4.success = 0
          AND o4.error_type = w.error_type
          AND o4.created_at > (SELECT min(o5.created_at) FROM outcomes o5
            WHERE o5.service_id = ? AND o5.workaround = w.workaround)
         ) as failure_after,
         min(w.created_at) as oldest_report,
         max(w.created_at) as newest_report
       FROM outcomes w
       WHERE w.service_id = ? AND w.workaround IS NOT NULL
       GROUP BY w.error_type, w.workaround
       ORDER BY total_reports DESC
       LIMIT 10`
    )
    .all(serviceId, serviceId, serviceId, serviceId, serviceId) as WorkaroundDetailRow[];

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
  //
  // IMPORTANT: `auth_method === 'none'` is the AGENT-FRIENDLY case, not an
  // "undocumented" case. Never return a "not documented yet" note for it —
  // that makes agents mistake a no-auth public service for a broken one.
  //
  // Agent-friendliness ordering:
  //   none   → ★ best (no token, no refresh, no rotation, no secret store)
  //   oauth2 → standard (refresh flow but well understood)
  //   bearer → standard
  //   api_key→ requires secure storage + rotation
  //   missing→ actually unknown (the worst case for an agent)
  const auth: Record<string, unknown> = {};
  if (service.api_auth_method === "none") {
    auth.type = "none";
    auth.agent_friendly = true;
    auth.note =
      "認証不要 — そのまま利用可能。トークン管理・リフレッシュ・ローテーション不要。 (No auth required — ready to use. No token management, refresh, or rotation needed.)";
  } else if (guide) {
    auth.type = guide.auth_overview;
    if (guide.auth_token_url) auth.token_url = guide.auth_token_url;
    if (guide.auth_scopes) auth.scopes = guide.auth_scopes;
    if (guide.auth_setup_hint) auth.setup_hint = guide.auth_setup_hint;
    if (guide.sandbox_url) auth.sandbox_url = guide.sandbox_url;
  } else if (service.api_auth_method) {
    auth.type = service.api_auth_method;
    auth.note =
      "Detailed auth guide not yet available. Check docs_url for setup instructions.";
  } else {
    auth.type = "unknown";
    auth.note = "Auth method not documented yet.";
  }

  // Build pitfalls section with anti-spiral safeguards
  const VERIFICATION_THRESHOLD = 2; // min reports before showing as "verified"
  const STALENESS_DAYS = 30; // workarounds older than this get freshness warning
  const now = Date.now();

  const commonPitfalls = pitfalls.map((p) => {
    const fixes = workaroundDetails
      .filter((w) => w.error_type === p.error_type)
      .map((w) => {
        const ageDays = (now - new Date(w.newest_report).getTime()) / (1000 * 60 * 60 * 24);
        const isStale = ageDays > STALENESS_DAYS;

        // Contradiction detection: if failure_after > success_after for same error,
        // the workaround may be wrong (ant death spiral risk)
        const totalAfter = w.success_after + w.failure_after;
        const hasContradiction = totalAfter >= 3 && w.failure_after > w.success_after;

        // Verification level
        let verification: string;
        if (w.total_reports >= VERIFICATION_THRESHOLD * 2 && !hasContradiction) {
          verification = "confirmed"; // Multiple agents agree, no contradictions
        } else if (w.total_reports >= VERIFICATION_THRESHOLD) {
          verification = "verified";  // At least 2 reports
        } else {
          verification = "unverified"; // Single report — use with caution
        }

        const fix: Record<string, unknown> = {
          workaround: w.workaround,
          reported_by: `${w.total_reports} agent(s)`,
          verification,
        };

        // Freshness warning (pheromone evaporation)
        if (isStale) {
          fix.freshness = "stale";
          fix.freshness_warning = `Last reported ${Math.round(ageDays)} days ago. May be outdated.`;
        } else {
          fix.freshness = "fresh";
        }

        // Contradiction warning (death spiral prevention)
        if (hasContradiction) {
          fix.contradiction_warning = `⚠ After this workaround was shared, ${w.failure_after} failures vs ${w.success_after} successes were reported for the same error. This fix may not work — verify independently.`;
        }

        return fix;
      });

    return {
      issue: p.error_type,
      frequency: p.count,
      workarounds: fixes.length > 0 ? fixes : "No workaround reported yet. If you find a fix, report_outcome with a workaround to help others.",
    };
  });

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

  // Check for active inspections (anomaly warnings)
  const activeInspections = db
    .prepare(
      `SELECT anomaly_type, severity, description, status
       FROM inspections
       WHERE service_id = ? AND status IN ('open', 'in_progress')
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
       LIMIT 5`
    )
    .all(serviceId) as Array<{
    anomaly_type: string;
    severity: string;
    description: string;
    status: string;
  }>;

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

    // Active anomaly warnings (scout ant alerts)
    active_warnings: activeInspections.length > 0
      ? activeInspections.map((i) => ({
          type: i.anomaly_type,
          severity: i.severity,
          description: i.description,
          status: i.status,
        }))
      : undefined,
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
