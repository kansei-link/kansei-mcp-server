/**
 * Anomaly Detector — KanseiLink's "偵察アリ dispatcher"
 *
 * Runs after each report_outcome to detect patterns that need inspection.
 * Like an ant colony's alarm pheromone system — triggers scout ants
 * when something smells wrong.
 *
 * Anomaly types:
 * - success_rate_crash:  Success rate dropped sharply (service may be down)
 * - contradicted_workaround: A popular workaround isn't actually helping
 * - error_spike: Sudden burst of same error type
 * - latency_anomaly: Response times suddenly much higher than baseline
 * - single_source_bias: All reports from one agent (could be misconfigured)
 */

import type Database from "better-sqlite3";

interface Anomaly {
  service_id: string;
  anomaly_type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  evidence: Record<string, unknown>;
}

/**
 * Run anomaly detection for a service after a new outcome is reported.
 * Creates inspection entries for any anomalies found.
 * Returns the list of new anomalies detected (empty = all clear).
 */
export function detectAnomalies(
  db: Database.Database,
  serviceId: string
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Only run detection if we have enough data
  const totalCount = db
    .prepare("SELECT count(*) as cnt FROM outcomes WHERE service_id = ?")
    .get(serviceId) as { cnt: number };
  if (totalCount.cnt < 5) return anomalies; // need minimum data

  // 1. Success rate crash detection
  const crashAnomaly = detectSuccessRateCrash(db, serviceId);
  if (crashAnomaly) anomalies.push(crashAnomaly);

  // 2. Contradicted workaround detection
  const contradictions = detectContradictedWorkarounds(db, serviceId);
  anomalies.push(...contradictions);

  // 3. Error spike detection
  const spike = detectErrorSpike(db, serviceId);
  if (spike) anomalies.push(spike);

  // 4. Latency anomaly detection
  const latency = detectLatencyAnomaly(db, serviceId);
  if (latency) anomalies.push(latency);

  // 5. Single source bias
  const bias = detectSingleSourceBias(db, serviceId);
  if (bias) anomalies.push(bias);

  // Insert new anomalies into inspection queue (avoid duplicates)
  for (const anomaly of anomalies) {
    // Check if same anomaly already exists and is still open
    const existing = db
      .prepare(
        `SELECT id FROM inspections
         WHERE service_id = ? AND anomaly_type = ? AND status = 'open'
         LIMIT 1`
      )
      .get(anomaly.service_id, anomaly.anomaly_type);

    if (!existing) {
      db.prepare(
        `INSERT INTO inspections (service_id, anomaly_type, severity, description, evidence)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        anomaly.service_id,
        anomaly.anomaly_type,
        anomaly.severity,
        anomaly.description,
        JSON.stringify(anomaly.evidence)
      );
    }
  }

  return anomalies;
}

/**
 * Detect: success rate dropped >25% in last 24h vs previous 7 days
 */
function detectSuccessRateCrash(
  db: Database.Database,
  serviceId: string
): Anomaly | null {
  const baseline = db
    .prepare(
      `SELECT avg(success) as rate FROM outcomes
       WHERE service_id = ? AND created_at BETWEEN datetime('now', '-8 days') AND datetime('now', '-1 day')`
    )
    .get(serviceId) as { rate: number | null };

  const recent = db
    .prepare(
      `SELECT avg(success) as rate, count(*) as cnt FROM outcomes
       WHERE service_id = ? AND created_at >= datetime('now', '-1 day')`
    )
    .get(serviceId) as { rate: number | null; cnt: number };

  if (!baseline.rate || !recent.rate || recent.cnt < 3) return null;

  const drop = baseline.rate - recent.rate;
  if (drop > 0.25) {
    return {
      service_id: serviceId,
      anomaly_type: "success_rate_crash",
      severity: drop > 0.5 ? "critical" : "high",
      description: `Success rate crashed from ${Math.round(baseline.rate * 100)}% to ${Math.round(recent.rate * 100)}% in the last 24 hours.`,
      evidence: {
        baseline_rate: Math.round(baseline.rate * 100) / 100,
        recent_rate: Math.round(recent.rate * 100) / 100,
        drop_percent: Math.round(drop * 100),
        recent_reports: recent.cnt,
      },
    };
  }
  return null;
}

/**
 * Detect: workaround reported as fix, but failures continue after
 */
function detectContradictedWorkarounds(
  db: Database.Database,
  serviceId: string
): Anomaly[] {
  const results: Anomaly[] = [];

  const workarounds = db
    .prepare(
      `SELECT workaround, error_type, count(*) as report_count,
              min(created_at) as first_reported
       FROM outcomes
       WHERE service_id = ? AND workaround IS NOT NULL
       GROUP BY workaround, error_type
       HAVING count(*) >= 2`
    )
    .all(serviceId) as Array<{
    workaround: string;
    error_type: string;
    report_count: number;
    first_reported: string;
  }>;

  for (const w of workarounds) {
    // Count failures of same error type AFTER workaround was first shared
    const afterStats = db
      .prepare(
        `SELECT
           sum(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
           sum(CASE WHEN success = 0 AND error_type = ? THEN 1 ELSE 0 END) as failures
         FROM outcomes
         WHERE service_id = ? AND created_at > ?`
      )
      .get(w.error_type, serviceId, w.first_reported) as {
      successes: number | null;
      failures: number | null;
    };

    const successes = afterStats.successes ?? 0;
    const failures = afterStats.failures ?? 0;

    // If failures significantly outnumber successes, flag it
    if (failures >= 3 && failures > successes * 1.5) {
      results.push({
        service_id: serviceId,
        anomaly_type: "contradicted_workaround",
        severity: failures > successes * 3 ? "high" : "medium",
        description: `Workaround "${w.workaround}" for ${w.error_type} may be incorrect. ${failures} failures vs ${successes} successes after it was shared.`,
        evidence: {
          workaround: w.workaround,
          error_type: w.error_type,
          times_reported: w.report_count,
          failures_after: failures,
          successes_after: successes,
        },
      });
    }
  }

  return results;
}

/**
 * Detect: same error type suddenly appears 3x more than baseline
 */
function detectErrorSpike(
  db: Database.Database,
  serviceId: string
): Anomaly | null {
  // Recent 24h error counts by type
  const recentErrors = db
    .prepare(
      `SELECT error_type, count(*) as cnt FROM outcomes
       WHERE service_id = ? AND error_type IS NOT NULL
       AND created_at >= datetime('now', '-1 day')
       GROUP BY error_type
       ORDER BY cnt DESC
       LIMIT 1`
    )
    .get(serviceId) as { error_type: string; cnt: number } | undefined;

  if (!recentErrors || recentErrors.cnt < 3) return null;

  // Baseline: daily average of this error type over past 7 days
  const baseline = db
    .prepare(
      `SELECT count(*) / 7.0 as daily_avg FROM outcomes
       WHERE service_id = ? AND error_type = ?
       AND created_at BETWEEN datetime('now', '-8 days') AND datetime('now', '-1 day')`
    )
    .get(serviceId, recentErrors.error_type) as { daily_avg: number };

  const spike = baseline.daily_avg > 0
    ? recentErrors.cnt / baseline.daily_avg
    : recentErrors.cnt; // if no baseline, any 3+ is notable

  if (spike >= 3) {
    return {
      service_id: serviceId,
      anomaly_type: "error_spike",
      severity: spike >= 5 ? "high" : "medium",
      description: `${recentErrors.error_type} errors spiked ${Math.round(spike)}x above baseline in the last 24 hours.`,
      evidence: {
        error_type: recentErrors.error_type,
        recent_24h: recentErrors.cnt,
        baseline_daily: Math.round(baseline.daily_avg * 100) / 100,
        spike_multiplier: Math.round(spike * 10) / 10,
      },
    };
  }
  return null;
}

/**
 * Detect: avg latency jumped >2x from baseline
 */
function detectLatencyAnomaly(
  db: Database.Database,
  serviceId: string
): Anomaly | null {
  const baseline = db
    .prepare(
      `SELECT avg(latency_ms) as avg_ms FROM outcomes
       WHERE service_id = ? AND latency_ms IS NOT NULL
       AND created_at BETWEEN datetime('now', '-8 days') AND datetime('now', '-1 day')`
    )
    .get(serviceId) as { avg_ms: number | null };

  const recent = db
    .prepare(
      `SELECT avg(latency_ms) as avg_ms, count(*) as cnt FROM outcomes
       WHERE service_id = ? AND latency_ms IS NOT NULL
       AND created_at >= datetime('now', '-1 day')`
    )
    .get(serviceId) as { avg_ms: number | null; cnt: number };

  if (!baseline.avg_ms || !recent.avg_ms || recent.cnt < 3) return null;

  const ratio = recent.avg_ms / baseline.avg_ms;
  if (ratio >= 2) {
    return {
      service_id: serviceId,
      anomaly_type: "latency_anomaly",
      severity: ratio >= 5 ? "high" : "medium",
      description: `Average latency jumped from ${Math.round(baseline.avg_ms)}ms to ${Math.round(recent.avg_ms)}ms (${Math.round(ratio)}x increase).`,
      evidence: {
        baseline_ms: Math.round(baseline.avg_ms),
        recent_ms: Math.round(recent.avg_ms),
        ratio: Math.round(ratio * 10) / 10,
        recent_reports: recent.cnt,
      },
    };
  }
  return null;
}

/**
 * Detect: all outcomes from a single agent (no diversity = unreliable)
 */
function detectSingleSourceBias(
  db: Database.Database,
  serviceId: string
): Anomaly | null {
  const stats = db
    .prepare(
      `SELECT count(DISTINCT agent_id_hash) as agents, count(*) as total
       FROM outcomes WHERE service_id = ?`
    )
    .get(serviceId) as { agents: number; total: number };

  // Only flag if significant volume but single source
  if (stats.agents === 1 && stats.total >= 10) {
    return {
      service_id: serviceId,
      anomaly_type: "single_source_bias",
      severity: "low",
      description: `All ${stats.total} reports come from a single agent. Data may not be representative.`,
      evidence: {
        unique_agents: stats.agents,
        total_reports: stats.total,
      },
    };
  }
  return null;
}
