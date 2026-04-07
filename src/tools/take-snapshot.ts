import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * take_snapshot: Captures daily metrics snapshot for a service (or all services).
 * Designed to run once per day via scheduled task or manual trigger.
 * Powers time-series consulting reports for SaaS companies.
 */
export function register(server: McpServer, db: Database.Database): void {
  server.tool(
    "take_snapshot",
    "Capture daily metrics snapshot for time-series analysis. Run daily to build historical data for consulting reports.",
    {
      service_id: z
        .string()
        .optional()
        .describe("Specific service to snapshot. Omit to snapshot ALL services."),
      snapshot_date: z
        .string()
        .optional()
        .describe("Date to snapshot (YYYY-MM-DD). Defaults to today."),
    },
    async ({ service_id, snapshot_date }) => {
      const date =
        snapshot_date ||
        new Date().toISOString().split("T")[0];

      // Get target services
      const services = service_id
        ? db.prepare("SELECT id, category, trust_score FROM services WHERE id = ?").all(service_id) as any[]
        : db.prepare("SELECT id, category, trust_score FROM services").all() as any[];

      if (services.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "no_services_found", service_id }),
            },
          ],
        };
      }

      const results: any[] = [];

      const upsertSnapshot = db.prepare(`
        INSERT INTO service_snapshots (
          service_id, snapshot_date,
          total_reports, success_rate, avg_latency_ms, p95_latency_ms, unique_agents,
          error_distribution, workaround_count,
          complaint_count, praise_count,
          recipe_usage_count, solo_usage_count,
          search_appearances, search_selections,
          category_rank, category_total,
          new_agents_count, trust_score,
          calls_per_agent_per_day, estimated_total_users
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(service_id, snapshot_date) DO UPDATE SET
          total_reports = excluded.total_reports,
          success_rate = excluded.success_rate,
          avg_latency_ms = excluded.avg_latency_ms,
          p95_latency_ms = excluded.p95_latency_ms,
          unique_agents = excluded.unique_agents,
          error_distribution = excluded.error_distribution,
          workaround_count = excluded.workaround_count,
          complaint_count = excluded.complaint_count,
          praise_count = excluded.praise_count,
          recipe_usage_count = excluded.recipe_usage_count,
          solo_usage_count = excluded.solo_usage_count,
          search_appearances = excluded.search_appearances,
          search_selections = excluded.search_selections,
          category_rank = excluded.category_rank,
          category_total = excluded.category_total,
          new_agents_count = excluded.new_agents_count,
          trust_score = excluded.trust_score,
          calls_per_agent_per_day = excluded.calls_per_agent_per_day,
          estimated_total_users = excluded.estimated_total_users
      `);

      for (const svc of services) {
        // --- Reliability metrics from outcomes table ---
        const dayOutcomes = db
          .prepare(
            `SELECT success, latency_ms, error_type, workaround, agent_id_hash
             FROM outcomes
             WHERE service_id = ? AND date(created_at) = ?`
          )
          .all(svc.id, date) as any[];

        const totalReports = dayOutcomes.length;
        const successCount = dayOutcomes.filter((o: any) => o.success).length;
        const successRate = totalReports > 0 ? successCount / totalReports : 0;

        const latencies = dayOutcomes
          .map((o: any) => o.latency_ms)
          .filter((l: any) => l != null)
          .sort((a: number, b: number) => a - b);
        const avgLatency =
          latencies.length > 0
            ? latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length
            : 0;
        const p95Latency =
          latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.95)]
            : 0;

        const uniqueAgents = new Set(dayOutcomes.map((o: any) => o.agent_id_hash)).size;

        // Error distribution
        const errorDist: Record<string, number> = {};
        for (const o of dayOutcomes) {
          if (o.error_type) {
            errorDist[o.error_type] = (errorDist[o.error_type] || 0) + 1;
          }
        }

        const workaroundCount = dayOutcomes.filter(
          (o: any) => o.workaround && o.workaround.trim() !== ""
        ).length;

        // --- Agent sentiment from feedback ---
        const complaints = db
          .prepare(
            `SELECT count(*) as cnt FROM agent_feedback
             WHERE service_id = ? AND date(created_at) = ?
             AND feedback_type IN ('bug_report', 'complaint', 'api_issue')`
          )
          .get(svc.id, date) as any;

        const praises = db
          .prepare(
            `SELECT count(*) as cnt FROM agent_feedback
             WHERE service_id = ? AND date(created_at) = ?
             AND feedback_type IN ('praise', 'suggestion')`
          )
          .get(svc.id, date) as any;

        // --- Calls per agent per day (usage intensity = proxy for user count) ---
        const callsPerAgent = uniqueAgents > 0 ? totalReports / uniqueAgents : 0;

        // --- Estimated total users from agent reports ---
        const estimatedUsersData = db
          .prepare(
            `SELECT SUM(estimated_users) as total FROM outcomes
             WHERE service_id = ? AND date(created_at) = ? AND estimated_users IS NOT NULL`
          )
          .get(svc.id, date) as any;
        const estimatedTotalUsers = estimatedUsersData?.total || 0;

        // --- Usage patterns: read existing search/recipe counts (instrumented live) ---
        const existingSnapshot = db
          .prepare(
            `SELECT search_appearances, search_selections, recipe_usage_count
             FROM service_snapshots WHERE service_id = ? AND snapshot_date = ?`
          )
          .get(svc.id, date) as any;

        const searchAppearances = existingSnapshot?.search_appearances || 0;
        const searchSelections = existingSnapshot?.search_selections || 0;
        const recipeUsage = existingSnapshot?.recipe_usage_count || 0;
        const soloUsage = totalReports;

        // --- New agents (first-time users of this service) ---
        const newAgents = db
          .prepare(
            `SELECT count(DISTINCT agent_id_hash) as cnt FROM outcomes
             WHERE service_id = ? AND date(created_at) = ?
             AND agent_id_hash NOT IN (
               SELECT DISTINCT agent_id_hash FROM outcomes
               WHERE service_id = ? AND date(created_at) < ?
             )`
          )
          .get(svc.id, date, svc.id, date) as any;

        // --- Category ranking by trust_score ---
        const categoryServices = db
          .prepare(
            "SELECT id, trust_score FROM services WHERE category = ? ORDER BY trust_score DESC"
          )
          .all(svc.category) as any[];

        const categoryRank =
          categoryServices.findIndex((s: any) => s.id === svc.id) + 1;
        const categoryTotal = categoryServices.length;

        // --- Upsert snapshot ---
        upsertSnapshot.run(
          svc.id,
          date,
          totalReports,
          Math.round(successRate * 1000) / 1000,
          Math.round(avgLatency),
          Math.round(p95Latency),
          uniqueAgents,
          JSON.stringify(errorDist),
          workaroundCount,
          complaints?.cnt || 0,
          praises?.cnt || 0,
          recipeUsage,
          soloUsage,
          searchAppearances,
          searchSelections,
          categoryRank,
          categoryTotal,
          newAgents?.cnt || 0,
          svc.trust_score,
          Math.round(callsPerAgent * 100) / 100,
          estimatedTotalUsers
        );

        results.push({
          service_id: svc.id,
          snapshot_date: date,
          total_reports: totalReports,
          success_rate: Math.round(successRate * 1000) / 1000,
          avg_latency_ms: Math.round(avgLatency),
          p95_latency_ms: Math.round(p95Latency),
          unique_agents: uniqueAgents,
          error_distribution: errorDist,
          workaround_count: workaroundCount,
          complaint_count: complaints?.cnt || 0,
          praise_count: praises?.cnt || 0,
          new_agents: newAgents?.cnt || 0,
          category_rank: `${categoryRank}/${categoryTotal}`,
          trust_score: svc.trust_score,
          calls_per_agent_per_day: Math.round(callsPerAgent * 100) / 100,
          estimated_total_users: estimatedTotalUsers,
          search_funnel: { appearances: searchAppearances, selections: searchSelections },
          recipe_usage: recipeUsage,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                snapshots_taken: results.length,
                snapshot_date: date,
                services: results,
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
