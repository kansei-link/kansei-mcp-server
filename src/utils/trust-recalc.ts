/**
 * Trust Score Recalculation Engine
 *
 * Michie's formula:
 *   Base:
 *     Official MCP = 0.5, Third-party MCP = 0.4, API only = 0.3, No API = 0.1
 *   Bonuses (+0.1 each, max +0.5):
 *     - API docs available
 *     - Auth guide available
 *     - Category specialist (focused service, not broad platform)
 *     - Agent reports exist
 *     - High success rate (>80%)
 *
 * Replaces the static trust_score in seed data with dynamic, evidence-based scores.
 */

import type Database from "better-sqlite3";

interface ServiceRow {
  id: string;
  mcp_endpoint: string | null;
  mcp_status: string | null;
  api_url: string | null;
  tags: string | null;
  trust_score: number;
}

interface StatsRow {
  service_id: string;
  total_calls: number;
  success_rate: number;
}

export function recalculateTrustScores(db: Database.Database): {
  updated: number;
  changes: Array<{ id: string; old: number; new: number }>;
} {
  const services = db
    .prepare(
      "SELECT id, mcp_endpoint, mcp_status, api_url, tags, trust_score FROM services"
    )
    .all() as ServiceRow[];

  const guidesSet = new Set(
    (
      db
        .prepare("SELECT service_id FROM service_api_guides")
        .all() as Array<{ service_id: string }>
    ).map((g) => g.service_id)
  );

  const statsMap = new Map<string, StatsRow>();
  const stats = db
    .prepare("SELECT service_id, total_calls, success_rate FROM service_stats")
    .all() as StatsRow[];
  for (const s of stats) statsMap.set(s.service_id, s);

  const changes: Array<{ id: string; old: number; new: number }> = [];

  const updateStmt = db.prepare(
    "UPDATE services SET trust_score = ? WHERE id = ?"
  );

  const transaction = db.transaction(() => {
    for (const s of services) {
      // Base score
      let base: number;
      if (s.mcp_endpoint && s.mcp_status === "official") {
        base = 0.5;
      } else if (s.mcp_endpoint) {
        base = 0.4;
      } else if (s.api_url) {
        base = 0.3;
      } else {
        base = 0.1;
      }

      // Bonus: API docs (has api_url)
      const hasApiDocs = !!s.api_url;

      // Bonus: Auth guide
      const hasAuthGuide = guidesSet.has(s.id);

      // Bonus: Category specialist (5 or fewer tags = focused)
      const tags = (s.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const isSpecialist = tags.length > 0 && tags.length <= 5;

      // Bonus: Agent data exists
      const agentStats = statsMap.get(s.id);
      const hasAgentData = agentStats && agentStats.total_calls >= 1;

      // Bonus: High success rate
      const highSuccess =
        agentStats &&
        agentStats.total_calls >= 3 &&
        agentStats.success_rate >= 0.8;

      const newScore = Math.min(
        1.0,
        base +
          (hasApiDocs ? 0.1 : 0) +
          (hasAuthGuide ? 0.1 : 0) +
          (isSpecialist ? 0.1 : 0) +
          (hasAgentData ? 0.1 : 0) +
          (highSuccess ? 0.1 : 0)
      );

      const rounded = Math.round(newScore * 1000) / 1000;
      if (rounded !== s.trust_score) {
        changes.push({ id: s.id, old: s.trust_score, new: rounded });
        updateStmt.run(rounded, s.id);
      }
    }
  });

  transaction();

  return { updated: changes.length, changes };
}
