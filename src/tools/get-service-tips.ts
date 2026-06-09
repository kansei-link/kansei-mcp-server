import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { kanseiAppLink } from "../utils/app-link.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  classifyReliabilitySource,
  gradeLabel,
} from "../utils/reliability-source.js";

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
            text: JSON.stringify({ ...result, _meta: { source: "kansei-link", kansei_link: kanseiAppLink("service_profile_tips", { service_id }) } }, null, 2),
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

  // Build reliability summary — separating MEASURED (live) telemetry from
  // ESTIMATES (seed/eval/scout). `service_stats` blends both, so we classify
  // provenance and present the live-only rate as the headline `success_rate`,
  // keeping any estimate in a clearly-labeled `estimated_success_rate`.
  const relSource = classifyReliabilitySource(db, service.id);
  const estimatedRate =
    stats && stats.total_calls > 0
      ? Math.round(stats.success_rate * 100) / 100
      : null;
  const liveRate =
    relSource.live_success_rate != null
      ? Math.round(relSource.live_success_rate * 100) / 100
      : null;
  const avgLatency = stats ? Math.round(stats.avg_latency_ms) : null;

  let reliability: Record<string, unknown>;
  if (relSource.basis === "none") {
    reliability = {
      basis: "none",
      measured: false,
      label: "no_data",
      success_rate: null,
      total_reports: 0,
      note: relSource.note,
    };
  } else if (relSource.basis === "estimated") {
    // Seed/eval-only: never present the estimate as a measured success_rate.
    reliability = {
      basis: "estimated",
      measured: false,
      label: "estimated",
      success_rate: null,
      estimated_success_rate: estimatedRate,
      avg_latency_ms: avgLatency,
      live_reports: 0,
      estimated_reports: relSource.estimated_reports,
      note: relSource.note,
    };
  } else {
    // live | mixed — at least one genuine field report exists.
    reliability = {
      basis: relSource.basis,
      measured: true,
      label: liveRate != null ? gradeLabel(liveRate) : "no_data",
      success_rate: liveRate, // live-only — the honest measured number
      avg_latency_ms: avgLatency,
      live_reports: relSource.live_reports,
      unique_agents: relSource.live_agents,
      note: relSource.note,
    };
    if (relSource.basis === "mixed") {
      reliability.estimated_success_rate = estimatedRate;
      reliability.estimated_reports = relSource.estimated_reports;
    }
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

    // Reliability (provenance-aware: measured live vs. internal estimate)
    reliability,

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

  // === Fix ②: Report→Tips Pipeline ===
  // Surface high-quality insights from outcomes and agent_feedback
  // so that reports flow into what agents actually read.

  // 1. Successful workarounds that actually helped (verified by subsequent success)
  const provenWorkarounds = db
    .prepare(
      `SELECT
         w.error_type,
         w.workaround,
         count(*) as times_reported,
         (SELECT count(*) FROM outcomes o2
          WHERE o2.service_id = ? AND o2.success = 1
          AND o2.created_at >= w.created_at) as successes_after
       FROM outcomes w
       WHERE w.service_id = ? AND w.workaround IS NOT NULL AND w.success = 1
       GROUP BY w.error_type, w.workaround
       HAVING times_reported >= 1
       ORDER BY times_reported DESC, successes_after DESC
       LIMIT 5`
    )
    .all(serviceId, serviceId) as Array<{
    error_type: string;
    workaround: string;
    times_reported: number;
    successes_after: number;
  }>;

  // 2. Recurring unresolved failures (errors without any successful workaround)
  const unresolvedFailures = db
    .prepare(
      `SELECT
         error_type,
         count(*) as occurrences,
         max(created_at) as last_seen
       FROM outcomes
       WHERE service_id = ? AND success = 0 AND error_type IS NOT NULL
       AND error_type NOT IN (
         SELECT DISTINCT o2.error_type FROM outcomes o2
         WHERE o2.service_id = ? AND o2.success = 1 AND o2.workaround IS NOT NULL
         AND o2.error_type IS NOT NULL
       )
       GROUP BY error_type
       HAVING occurrences >= 2
       ORDER BY occurrences DESC
       LIMIT 3`
    )
    .all(serviceId, serviceId) as Array<{
    error_type: string;
    occurrences: number;
    last_seen: string;
  }>;

  // 3. Agent feedback (community observations about this service)
  const agentFeedback = db
    .prepare(
      `SELECT subject, body, created_at
       FROM agent_feedback
       WHERE subject LIKE ? OR subject LIKE ?
       ORDER BY created_at DESC
       LIMIT 3`
    )
    .all(`%${serviceId}%`, `%${service.name}%`) as Array<{
    subject: string;
    body: string;
    created_at: string;
  }>;

  // 4. Recent success patterns (what's working NOW — most recent successful contexts)
  const recentSuccessPatterns = db
    .prepare(
      `SELECT context_masked, workaround, created_at
       FROM outcomes
       WHERE service_id = ? AND success = 1 AND context_masked IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 3`
    )
    .all(serviceId) as Array<{
    context_masked: string;
    workaround: string | null;
    created_at: string;
  }>;

  // Assemble field insights (only include non-empty sections)
  const fieldInsights: Record<string, unknown> = {};

  if (provenWorkarounds.length > 0) {
    fieldInsights.proven_fixes = provenWorkarounds.map((w) => ({
      error: w.error_type,
      fix: w.workaround,
      confidence: w.times_reported >= 3 ? "high" : w.times_reported >= 2 ? "medium" : "low",
      reported_by: `${w.times_reported} agent(s)`,
    }));
  }

  if (unresolvedFailures.length > 0) {
    fieldInsights.known_blockers = unresolvedFailures.map((f) => ({
      error: f.error_type,
      occurrences: f.occurrences,
      last_seen: f.last_seen,
      status: "No workaround found yet. If you find a fix, please report_outcome.",
    }));
  }

  if (agentFeedback.length > 0) {
    fieldInsights.community_notes = agentFeedback.map((f) => ({
      subject: f.subject,
      note: f.body.length > 300 ? f.body.substring(0, 300) + "..." : f.body,
      date: f.created_at,
    }));
  }

  if (recentSuccessPatterns.length > 0) {
    fieldInsights.recent_success_patterns = recentSuccessPatterns.map((s) => ({
      context: s.context_masked,
      approach: s.workaround ?? "Standard flow",
      date: s.created_at,
    }));
  }

  if (Object.keys(fieldInsights).length > 0) {
    tips.field_insights = fieldInsights;
    tips.field_insights_note =
      "Auto-derived from real agent usage reports. " +
      "proven_fixes = workarounds that led to success. " +
      "known_blockers = errors with no known fix yet. " +
      "community_notes = agent observations. " +
      "recent_success_patterns = what's working now.";
  }

  return tips;
}
