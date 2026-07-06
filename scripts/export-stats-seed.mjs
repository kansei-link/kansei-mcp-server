#!/usr/bin/env node
/**
 * Export non-empty service_stats rows to src/data/service-stats-seed.json.
 *
 * Companion to aggregate-voices.mjs: voices-seed.json and this file are
 * synthesized from the same outcomes pool, so a fresh deploy's insights
 * agree with its voices instead of claiming "No usage data yet".
 * seed.ts backfills only rows still at total_calls = 0 — live stats win.
 *
 *   node scripts/export-stats-seed.mjs
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const outPath = path.join(__dirname, "..", "src", "data", "service-stats-seed.json");

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare(
    `SELECT service_id, total_calls, success_rate, avg_latency_ms, unique_agents, last_updated
     FROM service_stats
     WHERE total_calls > 0
     ORDER BY service_id`
  )
  .all();
db.close();

fs.writeFileSync(outPath, JSON.stringify(rows, null, 1) + "\n");
console.log(`wrote ${rows.length} stats rows -> ${path.relative(process.cwd(), outPath)}`);
