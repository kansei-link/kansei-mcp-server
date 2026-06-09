#!/usr/bin/env tsx
/**
 * KanseiLINK Watchdog — Success Rate Monitor + Dead Service Reporter
 *
 * Scans outcomes table for:
 *   1. Services with declining success rates → re-verification queue
 *   2. Services with 0% success in recent window → dead candidate
 *   3. Services with no outcomes in 30+ days → stale candidate
 *
 * Also generates a health report for vendor notifications.
 *
 * Usage:
 *   npx tsx src/crawler/watchdog.ts                # full scan
 *   npx tsx src/crawler/watchdog.ts --report       # generate JSON report
 *   npx tsx src/crawler/watchdog.ts --fix          # auto-queue re-verification
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

interface ServiceHealth {
  service_id: string;
  name: string;
  trust_score: number;
  mcp_status: string;
  total_outcomes: number;
  recent_outcomes: number;       // last 7 days
  overall_success_rate: number;
  recent_success_rate: number;   // last 7 days
  rate_delta: number;            // recent - overall (negative = declining)
  last_outcome_days_ago: number;
  alert_level: "critical" | "warning" | "stale" | "healthy";
  alert_reason: string;
}

function main() {
  const args = process.argv.slice(2);
  const generateReport = args.includes("--report");
  const autoFix = args.includes("--fix");

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // ── 1. Get all services with outcomes ──────────────────────────
  const services = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.trust_score,
      s.mcp_status,
      count(o.id) as total_outcomes,
      sum(CASE WHEN o.created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as recent_outcomes,
      round(avg(o.success) * 100, 1) as overall_success_rate,
      round(avg(CASE WHEN o.created_at >= datetime('now', '-7 days') THEN o.success ELSE NULL END) * 100, 1) as recent_success_rate,
      round(julianday('now') - julianday(max(o.created_at)), 0) as last_outcome_days_ago
    FROM services s
    JOIN outcomes o ON s.id = o.service_id
    GROUP BY s.id
    HAVING total_outcomes >= 3
    ORDER BY total_outcomes DESC
  `).all() as Array<{
    id: string; name: string; trust_score: number; mcp_status: string;
    total_outcomes: number; recent_outcomes: number;
    overall_success_rate: number; recent_success_rate: number | null;
    last_outcome_days_ago: number;
  }>;

  console.error(`[watchdog] Analyzing ${services.length} services with outcomes...`);

  // ── 2. Classify health ─────────────────────────────────────────
  const results: ServiceHealth[] = [];

  for (const s of services) {
    const recentRate = s.recent_success_rate ?? -1;
    const delta = recentRate >= 0 ? recentRate - s.overall_success_rate : 0;

    let alertLevel: ServiceHealth["alert_level"] = "healthy";
    let alertReason = "";

    // Critical: recent success rate < 20% with enough data
    if (s.recent_outcomes >= 3 && recentRate >= 0 && recentRate < 20) {
      alertLevel = "critical";
      alertReason = `Recent success rate ${recentRate}% (${s.recent_outcomes} calls in 7d)`;
    }
    // Critical: overall success rate 0% with decent sample
    else if (s.total_outcomes >= 5 && s.overall_success_rate === 0) {
      alertLevel = "critical";
      alertReason = `0% success across ${s.total_outcomes} outcomes`;
    }
    // Warning: declining success rate (> 20% drop)
    else if (s.recent_outcomes >= 3 && delta < -20) {
      alertLevel = "warning";
      alertReason = `Success rate dropped ${Math.abs(delta).toFixed(0)}% (${s.overall_success_rate}% → ${recentRate}%)`;
    }
    // Warning: low overall success rate
    else if (s.total_outcomes >= 5 && s.overall_success_rate < 40) {
      alertLevel = "warning";
      alertReason = `Low overall success rate: ${s.overall_success_rate}%`;
    }
    // Stale: no outcomes in 30+ days
    else if (s.last_outcome_days_ago > 30) {
      alertLevel = "stale";
      alertReason = `No outcomes in ${s.last_outcome_days_ago} days`;
    }

    results.push({
      service_id: s.id,
      name: s.name,
      trust_score: s.trust_score,
      mcp_status: s.mcp_status,
      total_outcomes: s.total_outcomes,
      recent_outcomes: s.recent_outcomes,
      overall_success_rate: s.overall_success_rate,
      recent_success_rate: recentRate >= 0 ? recentRate : s.overall_success_rate,
      rate_delta: delta,
      last_outcome_days_ago: s.last_outcome_days_ago,
      alert_level: alertLevel,
      alert_reason: alertReason,
    });
  }

  // ── 3. Summary ─────────────────────────────────────────────────
  const critical = results.filter((r) => r.alert_level === "critical");
  const warning = results.filter((r) => r.alert_level === "warning");
  const stale = results.filter((r) => r.alert_level === "stale");
  const healthy = results.filter((r) => r.alert_level === "healthy");

  console.error("\n═══════════════════════════════════════════════════");
  console.error("  KanseiLINK Watchdog — Health Report");
  console.error("═══════════════════════════════════════════════════");
  console.error(`  Services analyzed:  ${results.length}`);
  console.error(`  🔴 Critical:        ${critical.length}`);
  console.error(`  🟡 Warning:         ${warning.length}`);
  console.error(`  ⚪ Stale:           ${stale.length}`);
  console.error(`  🟢 Healthy:         ${healthy.length}`);

  if (critical.length > 0) {
    console.error("\n  🔴 CRITICAL:");
    for (const r of critical.slice(0, 15)) {
      console.error(`    ${r.service_id} [${r.trust_score}] — ${r.alert_reason}`);
    }
  }

  if (warning.length > 0) {
    console.error("\n  🟡 WARNING:");
    for (const r of warning.slice(0, 15)) {
      console.error(`    ${r.service_id} [${r.trust_score}] — ${r.alert_reason}`);
    }
  }

  if (stale.length > 0) {
    console.error(`\n  ⚪ STALE (${stale.length} services, showing top 10):`);
    for (const r of stale.slice(0, 10)) {
      console.error(`    ${r.service_id} — ${r.alert_reason}`);
    }
  }

  // ── 4. Auto-fix: trust downgrade + re-verify list ───────────────
  if (autoFix) {
    // Downgrade trust for critical services
    const downgrade = db.prepare(
      "UPDATE services SET trust_score = MAX(trust_score - 0.1, 0.1) WHERE id = ? AND trust_score > 0.1"
    );
    let downgraded = 0;
    for (const r of critical) {
      const d = downgrade.run(r.service_id);
      if (d.changes > 0) downgraded++;
    }
    if (downgraded > 0) {
      console.error(`\n  → ${downgraded} critical services trust downgraded by 0.1`);
    }

    // Mark dead candidates in DB
    const markDead = db.prepare(
      "UPDATE services SET mcp_status = 'dead' WHERE id = ? AND mcp_status = 'verified'"
    );
    let markedDead = 0;
    for (const r of critical.filter((c) => c.overall_success_rate === 0 && c.total_outcomes >= 5)) {
      const d = markDead.run(r.service_id);
      if (d.changes > 0) markedDead++;
    }
    if (markedDead > 0) {
      console.error(`  → ${markedDead} zero-success services marked as 'dead'`);
    }

    // Write re-verification list for health-probe consumption
    const reverifyList = [...critical, ...warning].map((r) => ({
      service_id: r.service_id,
      priority: r.alert_level === "critical" ? "high" : "medium",
      reason: r.alert_reason,
    }));
    const reverifyPath = resolve(import.meta.dirname, "../data/reverify-queue.json");
    writeFileSync(reverifyPath, JSON.stringify(reverifyList, null, 2), "utf-8");
    console.error(`  → ${reverifyList.length} services written to reverify-queue.json`);
  }

  // ── 5. Generate report ─────────────────────────────────────────
  if (generateReport) {
    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        total: results.length,
        critical: critical.length,
        warning: warning.length,
        stale: stale.length,
        healthy: healthy.length,
      },
      critical: critical.map((r) => ({
        service_id: r.service_id,
        name: r.name,
        trust_score: r.trust_score,
        success_rate: r.overall_success_rate,
        recent_success_rate: r.recent_success_rate,
        total_outcomes: r.total_outcomes,
        reason: r.alert_reason,
      })),
      warning: warning.map((r) => ({
        service_id: r.service_id,
        name: r.name,
        trust_score: r.trust_score,
        success_rate: r.overall_success_rate,
        reason: r.alert_reason,
      })),
      vendor_report_candidates: [...critical, ...warning]
        .filter((r) => r.trust_score >= 0.5)
        .map((r) => ({
          service_id: r.service_id,
          name: r.name,
          issue: r.alert_reason,
          action: r.alert_level === "critical"
            ? "Service appears down — immediate attention recommended"
            : "Degraded performance detected — review recommended",
        })),
    };

    const reportPath = resolve(import.meta.dirname, "../data/watchdog-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.error(`\n  Report saved to ${reportPath}`);
  }

  console.error("═══════════════════════════════════════════════════");
  db.close();
}

main();
