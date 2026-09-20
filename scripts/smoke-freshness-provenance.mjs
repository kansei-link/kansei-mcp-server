/**
 * Regression guard for the 2026-09-20 freshness incident.
 *
 * What went wrong: `last_refreshed_at` was stamped on every service the refresh
 * pass visited, including the ones whose upstream fetch returned nothing, and
 * the tools presented that date to agents as data freshness. 7,953 rows claimed
 * a refresh no successful read stood behind.
 *
 * What this asserts, against a copy of the real DB:
 *   1. No row carries a verified date without a recorded source.
 *   2. The legacy `last_refreshed_at` never outruns `last_verified_at` — it may
 *      not re-acquire the ability to assert an unbacked check.
 *   3. A row that was visited but never verified reports confidence
 *      "unverified", not a stale-but-plausible "low" with a date attached.
 *   4. Crawl liveness sees runs that died without closing.
 *
 * Usage: node scripts/smoke-freshness-provenance.mjs [path-to.db]   (after build)
 */
import Database from "better-sqlite3";
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { initializeDb } from "../dist/db/schema.js";
import { computeFreshness } from "../dist/utils/freshness.js";
import { checkLiveness } from "../dist/crawler/check-stalled-runs.js";

const source = resolve(process.argv[2] || "kansei-link.db");
const target = resolve("tmp-freshness-provenance-smoke.db");
copyFileSync(source, target);

try {
  const db = new Database(target);
  initializeDb(db);

  const orphanVerified = db
    .prepare(
      "SELECT COUNT(*) AS n FROM services WHERE last_verified_at IS NOT NULL AND last_verified_source IS NULL"
    )
    .get();
  if (orphanVerified.n !== 0) {
    throw new Error(`${orphanVerified.n} services claim a verified date with no source`);
  }

  const legacyAhead = db
    .prepare(
      `SELECT COUNT(*) AS n FROM services
       WHERE last_refreshed_at IS NOT NULL
         AND (last_verified_at IS NULL OR last_refreshed_at > last_verified_at)`
    )
    .get();
  if (legacyAhead.n !== 0) {
    throw new Error(
      `${legacyAhead.n} services have last_refreshed_at asserting more than last_verified_at can back`
    );
  }

  // The exact shape that used to lie: visited, nothing answered.
  const visitedUnverified = db
    .prepare(
      `SELECT * FROM services
       WHERE last_refresh_attempt_at IS NOT NULL AND last_verified_at IS NULL
       LIMIT 1`
    )
    .get();
  if (visitedUnverified) {
    const f = computeFreshness(visitedUnverified);
    if (f.confidence !== "unverified") {
      throw new Error(`visited-but-unverified row reported confidence "${f.confidence}"`);
    }
    if (f.last_verified !== null || f.last_refreshed !== null || f.data_age_days !== null) {
      throw new Error("visited-but-unverified row still exposes a freshness date");
    }
    if (f.last_attempt !== visitedUnverified.last_refresh_attempt_at) {
      throw new Error("the attempt date was dropped — diagnostics need it");
    }
  }

  const liveness = checkLiveness(db);

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN last_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
         SUM(CASE WHEN last_refresh_attempt_at IS NOT NULL AND last_verified_at IS NULL THEN 1 ELSE 0 END) AS visited_only
       FROM services`
    )
    .get();
  db.close();

  console.log(
    JSON.stringify({
      result: "PASS",
      services: counts.total,
      verified: counts.verified,
      visited_but_unverified: counts.visited_only,
      stalled_runs: liveness.stalled.length,
      crawler_silent_days: liveness.silence_days,
    })
  );
} finally {
  rmSync(target, { force: true });
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
}
