/**
 * Recipe Drift Detection.
 *
 * For each recipe, check whether its required_services have been failing
 * enough lately to warrant an auto-appended gotcha.
 *
 * Signals we watch:
 *   - Rolling 14-day success rate drop (vs the all-time baseline)
 *   - High workaround_count (agents finding their own fixes)
 *   - Open inspections of severity 'high' against a referenced service
 *
 * When triggered, we append (idempotently) a gotcha string to the recipe.
 * This is the Tier-B KanseiLink moat: recipes auto-harden as reality drifts.
 */
import type Database from "better-sqlite3";

const WINDOW_DAYS = 14;
const SUCCESS_DROP_THRESHOLD = 0.15; // drop ≥15pp → flag
const MIN_REPORTS = 10; // need enough volume to trust the signal
const WORKAROUND_RATIO_THRESHOLD = 0.25; // >25% of recent calls required a workaround

export interface DriftSummary {
  recipes_scanned: number;
  gotchas_appended: number;
  services_flagged: number;
}

interface RecipeRow {
  id: string;
  goal: string;
  required_services: string; // JSON array of service ids
  gotchas: string; // JSON array of strings
}

interface ServiceStatsRow {
  service_id: string;
  recent_success_rate: number;
  baseline_success_rate: number;
  recent_reports: number;
  recent_workarounds: number;
  service_name: string;
}

export function detectRecipeDrift(db: Database.Database): DriftSummary {
  const recipes = db
    .prepare("SELECT id, goal, required_services, gotchas FROM recipes")
    .all() as RecipeRow[];

  const getStats = db.prepare(`
    SELECT
      s.id as service_id,
      s.name as service_name,
      COALESCE(recent.success_rate, 1.0) as recent_success_rate,
      COALESCE(baseline.success_rate, 1.0) as baseline_success_rate,
      COALESCE(recent.total_reports, 0) as recent_reports,
      COALESCE(recent.workaround_count, 0) as recent_workarounds
    FROM services s
    LEFT JOIN (
      SELECT
        service_id,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
        COUNT(*) as total_reports,
        SUM(CASE WHEN workaround IS NOT NULL AND TRIM(workaround) != '' THEN 1 ELSE 0 END) as workaround_count
      FROM outcomes
      WHERE date(created_at) >= date('now', ?)
      GROUP BY service_id
    ) recent ON recent.service_id = s.id
    LEFT JOIN (
      SELECT
        service_id,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
      FROM outcomes
      WHERE date(created_at) < date('now', ?)
      GROUP BY service_id
    ) baseline ON baseline.service_id = s.id
    WHERE s.id = ?
  `);

  const getOpenInspections = db.prepare(`
    SELECT anomaly_type, description FROM inspections
    WHERE service_id = ? AND status = 'open' AND severity IN ('high', 'critical')
    ORDER BY created_at DESC LIMIT 3
  `);

  const updateRecipe = db.prepare(
    "UPDATE recipes SET gotchas = ? WHERE id = ?"
  );

  const flaggedServices = new Set<string>();
  let gotchasAppended = 0;

  const windowArg = `-${WINDOW_DAYS} days`;

  for (const recipe of recipes) {
    let serviceIds: string[] = [];
    try {
      serviceIds = JSON.parse(recipe.required_services || "[]");
    } catch {
      continue;
    }
    if (serviceIds.length === 0) continue;

    let existingGotchas: string[] = [];
    try {
      existingGotchas = JSON.parse(recipe.gotchas || "[]");
    } catch {
      existingGotchas = [];
    }
    const existingSet = new Set(existingGotchas);
    const newGotchas: string[] = [];

    for (const sid of serviceIds) {
      const stats = getStats.get(windowArg, windowArg, sid) as ServiceStatsRow | undefined;
      if (!stats) continue;

      const drop = stats.baseline_success_rate - stats.recent_success_rate;
      const workaroundRatio =
        stats.recent_reports > 0 ? stats.recent_workarounds / stats.recent_reports : 0;

      // Success-rate drop signal
      if (stats.recent_reports >= MIN_REPORTS && drop >= SUCCESS_DROP_THRESHOLD) {
        const msg = `⚠️ Auto-detected drift (${new Date().toISOString().slice(0, 10)}): ${stats.service_name} success rate dropped ${(drop * 100).toFixed(0)}pp over last ${WINDOW_DAYS}d (baseline ${(stats.baseline_success_rate * 100).toFixed(0)}% → recent ${(stats.recent_success_rate * 100).toFixed(0)}%). Investigate auth/rate-limit changes before running this recipe at scale.`;
        if (!existingSet.has(msg)) {
          newGotchas.push(msg);
          flaggedServices.add(sid);
        }
      }

      // Workaround-density signal (agents finding their own fixes)
      if (stats.recent_reports >= MIN_REPORTS && workaroundRatio >= WORKAROUND_RATIO_THRESHOLD) {
        const msg = `⚠️ Auto-detected friction (${new Date().toISOString().slice(0, 10)}): ${(workaroundRatio * 100).toFixed(0)}% of recent ${stats.service_name} calls required agent-side workarounds. Check get_service_tips for current gotchas before using this recipe.`;
        if (!existingSet.has(msg)) {
          newGotchas.push(msg);
          flaggedServices.add(sid);
        }
      }

      // Inspection signal — propagate high-severity open anomalies
      const inspections = getOpenInspections.all(sid) as Array<{
        anomaly_type: string;
        description: string;
      }>;
      for (const insp of inspections) {
        const msg = `⚠️ Open inspection on ${stats.service_name}: [${insp.anomaly_type}] ${insp.description}`;
        if (!existingSet.has(msg)) {
          newGotchas.push(msg);
          flaggedServices.add(sid);
        }
      }
    }

    if (newGotchas.length > 0) {
      const merged = [...existingGotchas, ...newGotchas];
      updateRecipe.run(JSON.stringify(merged), recipe.id);
      gotchasAppended += newGotchas.length;
    }
  }

  return {
    recipes_scanned: recipes.length,
    gotchas_appended: gotchasAppended,
    services_flagged: flaggedServices.size,
  };
}
