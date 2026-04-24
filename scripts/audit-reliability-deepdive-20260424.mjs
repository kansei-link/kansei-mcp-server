#!/usr/bin/env node
/**
 * Reliability deep-dive: Chatwork (success 0.66) + SmartHR (success 0.39)
 *
 * Audit 2026-04-24 flagged these two as high-usage, low-success. Pull the
 * actual `outcomes` records to see WHY they fail — error_type distribution,
 * workaround patterns, context hints — then write consolidated tips to
 * `service_api_guides.agent_tips` so future agents start with the cures
 * pre-loaded via get_service_tips.
 *
 *   node scripts/audit-reliability-deepdive-20260424.mjs
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");

const db = new Database(dbPath);
const targets = ["chatwork", "smarthr"];

console.log("=== reliability deep-dive ===\n");

for (const id of targets) {
  const stats = db
    .prepare(
      `SELECT s.name, ss.total_calls, ss.success_rate, ss.avg_latency_ms
       FROM services s
       LEFT JOIN service_stats ss ON ss.service_id = s.id
       WHERE s.id = ?`
    )
    .get(id);

  console.log(
    `── ${stats.name} (${id}) — total_calls=${stats.total_calls}, success_rate=${stats.success_rate}, avg_latency=${stats.avg_latency_ms}ms`
  );

  // Error type distribution
  const errorDist = db
    .prepare(
      `SELECT
         CASE WHEN success = 1 THEN 'SUCCESS' ELSE COALESCE(error_type, '(unclassified)') END AS outcome,
         COUNT(*) AS n
       FROM outcomes
       WHERE service_id = ?
       GROUP BY outcome
       ORDER BY n DESC`
    )
    .all(id);

  console.log("  error_type distribution:");
  for (const r of errorDist) console.log(`    ${r.n.toString().padStart(4)}  ${r.outcome}`);

  // Top workarounds (if any agents reported one)
  const workarounds = db
    .prepare(
      `SELECT workaround, COUNT(*) AS n
       FROM outcomes
       WHERE service_id = ? AND workaround IS NOT NULL AND workaround != ''
       GROUP BY workaround
       ORDER BY n DESC
       LIMIT 5`
    )
    .all(id);

  if (workarounds.length > 0) {
    console.log("  top workarounds:");
    for (const w of workarounds) {
      console.log(`    [${w.n}×] ${w.workaround.slice(0, 160)}${w.workaround.length > 160 ? "…" : ""}`);
    }
  } else {
    console.log("  top workarounds: (none reported)");
  }

  // Recent failures (up to 10) with context
  const recent = db
    .prepare(
      `SELECT error_type, workaround, created_at
       FROM outcomes
       WHERE service_id = ? AND success = 0
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .all(id);
  console.log(`  recent 10 failures (timestamps only):`);
  for (const r of recent) {
    console.log(`    ${r.created_at}  [${r.error_type ?? "?"}]  ${r.workaround ? "+ workaround" : ""}`);
  }
  console.log();
}

// Generate agent_tips updates based on findings
// These are written to service_api_guides.agent_tips as JSON array entries.
// The exact content depends on what error distribution we see above — this
// script prints what WOULD be appended; human reviews before a follow-up
// script actually writes them.

console.log("=== proposed agent_tips ===");
console.log("(These are NOT auto-written — review first, apply via a follow-up script)\n");

for (const id of targets) {
  const guide = db
    .prepare(`SELECT service_id, agent_tips FROM service_api_guides WHERE service_id = ?`)
    .get(id);
  const existing = (() => {
    try {
      return JSON.parse(guide?.agent_tips ?? "[]");
    } catch {
      return [];
    }
  })();
  console.log(`── ${id} — existing agent_tips count: ${existing.length}`);
  if (existing.length > 0) {
    for (const t of existing) console.log(`    • ${String(t).slice(0, 140)}`);
  }
  console.log();
}

db.close();

console.log("Deep-dive done. Next: write findings to DECISIONS.md + craft targeted tips for reliability-problem services.");
