/**
 * Daily snapshot engine — writes one row per service to service_snapshots.
 *
 * Extracted from src/tools/take-snapshot.ts so the daily cron can call it
 * without going through the MCP tool interface. The tool itself should be
 * refactored to call this function.
 */
import type Database from "better-sqlite3";

export interface SnapshotResult {
  service_id: string;
  snapshot_date: string;
  total_reports: number;
  success_rate: number;
  unique_agents: number;
  complaint_count: number;
  praise_count: number;
  new_agents: number;
  category_rank: number;
  category_total: number;
}

export interface SnapshotSummary {
  snapshot_date: string;
  services_snapshotted: number;
  active_services: number; // services with at least 1 report today
  total_reports: number;
  total_unique_agents: number;
}

export function snapshotAllServices(
  db: Database.Database,
  snapshotDate?: string
): { summary: SnapshotSummary; results: SnapshotResult[] } {
  const date = snapshotDate || new Date().toISOString().split("T")[0];

  const services = db
    .prepare("SELECT id, category, trust_score FROM services")
    .all() as Array<{ id: string; category: string; trust_score: number }>;

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

  const results: SnapshotResult[] = [];
  let activeServices = 0;
  let totalReports = 0;
  const globalAgents = new Set<string>();

  // Precompute category rankings once
  const categoryMap = new Map<string, Array<{ id: string; trust_score: number }>>();
  for (const svc of services) {
    const arr = categoryMap.get(svc.category) || [];
    arr.push({ id: svc.id, trust_score: svc.trust_score });
    categoryMap.set(svc.category, arr);
  }
  for (const arr of categoryMap.values()) {
    arr.sort((a, b) => b.trust_score - a.trust_score);
  }

  const tx = db.transaction(() => {
    for (const svc of services) {
      const dayOutcomes = db
        .prepare(
          `SELECT success, latency_ms, error_type, workaround, agent_id_hash, estimated_users
           FROM outcomes
           WHERE service_id = ? AND date(created_at) = ?`
        )
        .all(svc.id, date) as Array<{
        success: number;
        latency_ms: number | null;
        error_type: string | null;
        workaround: string | null;
        agent_id_hash: string;
        estimated_users: number | null;
      }>;

      const reports = dayOutcomes.length;
      if (reports > 0) activeServices++;
      totalReports += reports;

      const successCount = dayOutcomes.filter((o) => o.success).length;
      const successRate = reports > 0 ? successCount / reports : 0;

      const latencies = dayOutcomes
        .map((o) => o.latency_ms)
        .filter((l): l is number => l != null)
        .sort((a, b) => a - b);
      const avgLatency =
        latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : 0;
      const p95Latency =
        latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

      const agentHashes = new Set(dayOutcomes.map((o) => o.agent_id_hash));
      agentHashes.forEach((h) => globalAgents.add(h));
      const uniqueAgents = agentHashes.size;

      const errorDist: Record<string, number> = {};
      for (const o of dayOutcomes) {
        if (o.error_type) errorDist[o.error_type] = (errorDist[o.error_type] || 0) + 1;
      }

      const workaroundCount = dayOutcomes.filter(
        (o) => o.workaround && o.workaround.trim() !== ""
      ).length;

      const complaints = db
        .prepare(
          `SELECT count(*) as cnt FROM agent_feedback
           WHERE service_id = ? AND date(created_at) = ?
           AND feedback_type IN ('bug_report', 'complaint', 'api_issue')`
        )
        .get(svc.id, date) as { cnt: number };

      const praises = db
        .prepare(
          `SELECT count(*) as cnt FROM agent_feedback
           WHERE service_id = ? AND date(created_at) = ?
           AND feedback_type IN ('praise', 'suggestion')`
        )
        .get(svc.id, date) as { cnt: number };

      const callsPerAgent = uniqueAgents > 0 ? reports / uniqueAgents : 0;

      const estimatedUsersRow = db
        .prepare(
          `SELECT SUM(estimated_users) as total FROM outcomes
           WHERE service_id = ? AND date(created_at) = ? AND estimated_users IS NOT NULL`
        )
        .get(svc.id, date) as { total: number | null };
      const estimatedTotalUsers = estimatedUsersRow.total || 0;

      // Preserve live-instrumented counters if they were written before
      const existing = db
        .prepare(
          `SELECT search_appearances, search_selections, recipe_usage_count
           FROM service_snapshots WHERE service_id = ? AND snapshot_date = ?`
        )
        .get(svc.id, date) as
        | { search_appearances: number; search_selections: number; recipe_usage_count: number }
        | undefined;

      const searchAppearances = existing?.search_appearances || 0;
      const searchSelections = existing?.search_selections || 0;
      const recipeUsage = existing?.recipe_usage_count || 0;

      const newAgents = db
        .prepare(
          `SELECT count(DISTINCT agent_id_hash) as cnt FROM outcomes
           WHERE service_id = ? AND date(created_at) = ?
           AND agent_id_hash NOT IN (
             SELECT DISTINCT agent_id_hash FROM outcomes
             WHERE service_id = ? AND date(created_at) < ?
           )`
        )
        .get(svc.id, date, svc.id, date) as { cnt: number };

      const cats = categoryMap.get(svc.category) || [];
      const categoryRank = cats.findIndex((s) => s.id === svc.id) + 1;
      const categoryTotal = cats.length;

      upsertSnapshot.run(
        svc.id,
        date,
        reports,
        Math.round(successRate * 1000) / 1000,
        Math.round(avgLatency),
        Math.round(p95Latency),
        uniqueAgents,
        JSON.stringify(errorDist),
        workaroundCount,
        complaints.cnt,
        praises.cnt,
        recipeUsage,
        reports,
        searchAppearances,
        searchSelections,
        categoryRank,
        categoryTotal,
        newAgents.cnt,
        svc.trust_score,
        Math.round(callsPerAgent * 100) / 100,
        estimatedTotalUsers
      );

      results.push({
        service_id: svc.id,
        snapshot_date: date,
        total_reports: reports,
        success_rate: Math.round(successRate * 1000) / 1000,
        unique_agents: uniqueAgents,
        complaint_count: complaints.cnt,
        praise_count: praises.cnt,
        new_agents: newAgents.cnt,
        category_rank: categoryRank,
        category_total: categoryTotal,
      });
    }
  });
  tx();

  return {
    summary: {
      snapshot_date: date,
      services_snapshotted: services.length,
      active_services: activeServices,
      total_reports: totalReports,
      total_unique_agents: globalAgents.size,
    },
    results,
  };
}
