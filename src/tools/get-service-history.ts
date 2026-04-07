import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * get_service_history: Time-series intelligence for a service.
 * Returns historical metrics, trend analysis, event correlations, and competitive position.
 * Designed for generating consulting reports to SaaS companies.
 */
export function register(server: McpServer, db: Database.Database): void {
  server.tool(
    "get_service_history",
    "Get time-series metrics history for a service. Shows trends, regressions, competitive position changes, and event correlations. Use for consulting reports.",
    {
      service_id: z.string().describe("Service to analyze"),
      period: z
        .enum(["7d", "30d", "90d", "all"])
        .default("30d")
        .describe("Time period to analyze"),
      compare_with: z
        .string()
        .optional()
        .describe("Competitor service_id to compare against"),
    },
    async ({ service_id, period, compare_with }) => {
      // Determine date range
      const periodDays: Record<string, number> = {
        "7d": 7,
        "30d": 30,
        "90d": 90,
        all: 9999,
      };
      const days = periodDays[period] || 30;
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);
      const sinceDateStr = sinceDate.toISOString().split("T")[0];

      // Service info
      const service = db
        .prepare("SELECT * FROM services WHERE id = ?")
        .get(service_id) as any;
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

      // --- Snapshots ---
      const snapshots = db
        .prepare(
          `SELECT * FROM service_snapshots
           WHERE service_id = ? AND snapshot_date >= ?
           ORDER BY snapshot_date ASC`
        )
        .all(service_id, sinceDateStr) as any[];

      // --- Events in this period ---
      const events = db
        .prepare(
          `SELECT * FROM service_events
           WHERE (service_id = ? OR service_id IS NULL) AND event_date >= ?
           ORDER BY event_date ASC`
        )
        .all(service_id, sinceDateStr) as any[];

      // --- Trend analysis ---
      const trends = analyzeTrends(snapshots);

      // --- Key incidents (days where success_rate dropped significantly) ---
      const incidents = detectIncidents(snapshots, events);

      // --- Competitive comparison ---
      let comparison = null;
      if (compare_with) {
        const competitorSnapshots = db
          .prepare(
            `SELECT * FROM service_snapshots
             WHERE service_id = ? AND snapshot_date >= ?
             ORDER BY snapshot_date ASC`
          )
          .all(compare_with, sinceDateStr) as any[];

        const competitorService = db
          .prepare("SELECT id, name, category, trust_score FROM services WHERE id = ?")
          .get(compare_with) as any;

        comparison = buildComparison(
          service,
          snapshots,
          competitorService,
          competitorSnapshots
        );
      }

      // --- Agent adoption curve ---
      const adoptionCurve = snapshots.map((s: any) => ({
        date: s.snapshot_date,
        unique_agents: s.unique_agents,
        new_agents: s.new_agents_count,
        cumulative_reports: s.total_reports,
      }));

      // --- Top workarounds (friction signals) ---
      const topWorkarounds = db
        .prepare(
          `SELECT workaround, error_type, count(*) as cnt
           FROM outcomes
           WHERE service_id = ? AND workaround IS NOT NULL AND workaround != ''
           AND created_at >= ?
           GROUP BY workaround
           ORDER BY cnt DESC
           LIMIT 10`
        )
        .all(service_id, sinceDateStr) as any[];

      // --- Top complaints ---
      const topComplaints = db
        .prepare(
          `SELECT subject, body, priority, created_at
           FROM agent_feedback
           WHERE service_id = ? AND feedback_type IN ('bug_report', 'complaint', 'api_issue')
           AND created_at >= ?
           ORDER BY created_at DESC
           LIMIT 10`
        )
        .all(service_id, sinceDateStr) as any[];

      // --- Business impact summary ---
      const businessImpact = calculateBusinessImpact(snapshots);

      const report = {
        service: {
          id: service.id,
          name: service.name,
          category: service.category,
          current_trust_score: service.trust_score,
        },
        period,
        snapshot_count: snapshots.length,
        trends,
        business_impact: businessImpact,
        incidents,
        events,
        adoption_curve: adoptionCurve,
        top_workarounds: topWorkarounds,
        top_complaints: topComplaints,
        competitive_comparison: comparison,
        consulting_highlights: generateHighlights(
          service,
          trends,
          incidents,
          topWorkarounds,
          businessImpact
        ),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    }
  );
}

function analyzeTrends(snapshots: any[]): any {
  if (snapshots.length < 2) {
    return { status: "insufficient_data", message: "Need at least 2 snapshots for trend analysis" };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const mid = snapshots[Math.floor(snapshots.length / 2)];

  return {
    success_rate: {
      start: first.success_rate,
      mid: mid.success_rate,
      end: last.success_rate,
      change: Math.round((last.success_rate - first.success_rate) * 1000) / 1000,
      direction: last.success_rate > first.success_rate ? "improving" : last.success_rate < first.success_rate ? "declining" : "stable",
    },
    latency: {
      start_avg: first.avg_latency_ms,
      end_avg: last.avg_latency_ms,
      change_ms: Math.round(last.avg_latency_ms - first.avg_latency_ms),
      direction: last.avg_latency_ms < first.avg_latency_ms ? "improving" : last.avg_latency_ms > first.avg_latency_ms ? "degrading" : "stable",
    },
    agent_adoption: {
      start_unique: first.unique_agents,
      end_unique: last.unique_agents,
      total_new_agents: snapshots.reduce((sum: number, s: any) => sum + (s.new_agents_count || 0), 0),
      direction: last.unique_agents > first.unique_agents ? "growing" : "flat",
    },
    category_rank: {
      start: `${first.category_rank}/${first.category_total}`,
      end: `${last.category_rank}/${last.category_total}`,
      improved: last.category_rank < first.category_rank,
    },
    workaround_rate: {
      total: snapshots.reduce((sum: number, s: any) => sum + s.workaround_count, 0),
      avg_per_day: Math.round(
        snapshots.reduce((sum: number, s: any) => sum + s.workaround_count, 0) / snapshots.length * 100
      ) / 100,
      trend: "Workarounds indicate API friction — agents are finding their own fixes instead of the API working correctly.",
    },
  };
}

function detectIncidents(snapshots: any[], events: any[]): any[] {
  const incidents: any[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];

    // Success rate dropped by more than 10%
    if (prev.success_rate - curr.success_rate > 0.1) {
      const relatedEvents = events.filter(
        (e: any) =>
          e.event_date >= prev.snapshot_date && e.event_date <= curr.snapshot_date
      );
      incidents.push({
        date: curr.snapshot_date,
        type: "success_rate_drop",
        severity: prev.success_rate - curr.success_rate > 0.2 ? "critical" : "warning",
        from: prev.success_rate,
        to: curr.success_rate,
        drop: Math.round((prev.success_rate - curr.success_rate) * 1000) / 1000,
        related_events: relatedEvents,
        errors_on_day: curr.error_distribution,
      });
    }

    // Latency spike (>50% increase)
    if (prev.avg_latency_ms > 0 && curr.avg_latency_ms / prev.avg_latency_ms > 1.5) {
      incidents.push({
        date: curr.snapshot_date,
        type: "latency_spike",
        severity: curr.avg_latency_ms / prev.avg_latency_ms > 2 ? "critical" : "warning",
        from_ms: prev.avg_latency_ms,
        to_ms: curr.avg_latency_ms,
        multiplier: Math.round((curr.avg_latency_ms / prev.avg_latency_ms) * 10) / 10,
      });
    }
  }

  return incidents;
}

function buildComparison(
  service: any,
  snapshots: any[],
  competitor: any,
  competitorSnapshots: any[]
): any {
  if (!competitor) return { error: "competitor_not_found" };

  const svcAvgSuccess =
    snapshots.length > 0
      ? snapshots.reduce((s: number, r: any) => s + r.success_rate, 0) / snapshots.length
      : 0;
  const compAvgSuccess =
    competitorSnapshots.length > 0
      ? competitorSnapshots.reduce((s: number, r: any) => s + r.success_rate, 0) /
        competitorSnapshots.length
      : 0;

  const svcAvgLatency =
    snapshots.length > 0
      ? snapshots.reduce((s: number, r: any) => s + r.avg_latency_ms, 0) / snapshots.length
      : 0;
  const compAvgLatency =
    competitorSnapshots.length > 0
      ? competitorSnapshots.reduce((s: number, r: any) => s + r.avg_latency_ms, 0) /
        competitorSnapshots.length
      : 0;

  return {
    service: { id: service.id, name: service.name },
    competitor: { id: competitor.id, name: competitor.name },
    avg_success_rate: {
      service: Math.round(svcAvgSuccess * 1000) / 1000,
      competitor: Math.round(compAvgSuccess * 1000) / 1000,
      winner: svcAvgSuccess > compAvgSuccess ? service.id : competitor.id,
    },
    avg_latency: {
      service: Math.round(svcAvgLatency),
      competitor: Math.round(compAvgLatency),
      winner: svcAvgLatency < compAvgLatency ? service.id : competitor.id,
    },
    trust_score: {
      service: service.trust_score,
      competitor: competitor.trust_score,
      winner: service.trust_score > competitor.trust_score ? service.id : competitor.id,
    },
    total_reports: {
      service: snapshots.reduce((s: number, r: any) => s + r.total_reports, 0),
      competitor: competitorSnapshots.reduce((s: number, r: any) => s + r.total_reports, 0),
    },
  };
}

function calculateBusinessImpact(snapshots: any[]): any {
  if (snapshots.length === 0) return { status: "no_data" };

  const totalReports = snapshots.reduce((s: number, r: any) => s + r.total_reports, 0);
  const totalNewAgents = snapshots.reduce((s: number, r: any) => s + (r.new_agents_count || 0), 0);
  const peakAgents = Math.max(...snapshots.map((s: any) => s.unique_agents));

  return {
    total_agent_interactions: totalReports,
    new_agent_adoptions: totalNewAgents,
    peak_daily_agents: peakAgents,
    agent_growth_narrative:
      totalNewAgents > 0
        ? `${totalNewAgents} new agents adopted this service during the period. Each agent represents a potential pipeline of end-user actions.`
        : "No new agent adoption detected. Consider improving MCP discoverability and documentation.",
    business_translation:
      "Each unique agent typically serves 10-100+ end users. Agent adoption is a leading indicator of user growth through AI channels.",
  };
}

function generateHighlights(
  service: any,
  trends: any,
  incidents: any[],
  workarounds: any[],
  businessImpact: any
): string[] {
  const highlights: string[] = [];

  if (trends.status === "insufficient_data") {
    highlights.push("⚠️ Not enough historical data yet. Run daily snapshots to build time-series intelligence.");
    return highlights;
  }

  // Success rate trend
  if (trends.success_rate.direction === "declining") {
    highlights.push(
      `🔴 Success rate declining: ${trends.success_rate.start} → ${trends.success_rate.end} (${trends.success_rate.change > 0 ? "+" : ""}${trends.success_rate.change})`
    );
  } else if (trends.success_rate.direction === "improving") {
    highlights.push(
      `🟢 Success rate improving: ${trends.success_rate.start} → ${trends.success_rate.end}`
    );
  }

  // Latency
  if (trends.latency.direction === "degrading") {
    highlights.push(
      `🟡 Latency increasing: ${trends.latency.start_avg}ms → ${trends.latency.end_avg}ms (+${trends.latency.change_ms}ms)`
    );
  }

  // Incidents
  if (incidents.length > 0) {
    const critical = incidents.filter((i) => i.severity === "critical").length;
    highlights.push(
      `🚨 ${incidents.length} incidents detected (${critical} critical) — investigate API changes or infrastructure issues`
    );
  }

  // Workarounds = friction
  if (workarounds.length > 0) {
    highlights.push(
      `🔧 ${workarounds.length} unique workarounds reported by agents — indicates API friction points that should be addressed natively`
    );
  }

  // Business impact
  if (businessImpact.new_agent_adoptions > 0) {
    highlights.push(
      `📈 ${businessImpact.new_agent_adoptions} new agents adopted this service — potential reach of ${businessImpact.new_agent_adoptions * 50}+ end users`
    );
  }

  return highlights;
}
