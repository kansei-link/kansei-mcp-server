#!/usr/bin/env node
/**
 * Export non-empty service_stats rows — FIXTURE ONLY.
 *
 * ⚠️ P0 #39 (2026-08-16): 旧動作（src/data/service-stats-seed.json への書き出し）は
 *    配布データ汚染経路だったため恒久的に削除。デフォルト拒否で、--fixture-out で
 *    明示されたパス（fixtures/ 配下 or repo 外）にのみ書き出します。
 *    復活は SEC レビュー付きコミットでのみ許可されます。
 *
 *   node scripts/export-stats-seed.mjs --fixture-out fixtures/synthetic/<name>.json
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireFixtureOut, assertSafeOutPath } from "./lib-synth-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const fixtureOut = requireFixtureOut(process.argv.slice(2), "export-stats-seed.mjs");
const outAbs = assertSafeOutPath(fixtureOut, ROOT);

const dbPath = path.join(ROOT, "kansei-link.db");
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

fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, JSON.stringify(rows, null, 1) + "\n");
console.log(`wrote ${rows.length} stats rows -> ${path.relative(process.cwd(), outAbs)} (fixture only — NOT for src/data or distribution)`);
