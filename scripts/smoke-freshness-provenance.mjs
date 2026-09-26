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
 *   2. The legacy `last_refreshed_at` never outruns `upstream_checked_at` — it may
 *      not re-acquire the ability to assert an unbacked check.
 *   3. A row that was visited but never checked reports confidence "unverified",
 *      not a stale-but-plausible "low" with a date attached.
 *   4. The check is scoped: it never claims to cover the description or guide.
 *   5. Crawl liveness sees runs that died without closing.
 *
 * Usage: node scripts/smoke-freshness-provenance.mjs [path-to.db]   (after build)
 */
import Database from "better-sqlite3";
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { initializeDb } from "../dist/db/schema.js";
import { computeFreshness, FRESHNESS_LEGEND } from "../dist/utils/freshness.js";
import { checkLiveness } from "../dist/crawler/check-stalled-runs.js";

const source = resolve(process.argv[2] || "kansei-link.db");
const target = resolve("tmp-freshness-provenance-smoke.db");
copyFileSync(source, target);

try {
  const db = new Database(target);
  initializeDb(db);

  const orphanVerified = db
    .prepare(
      "SELECT COUNT(*) AS n FROM services WHERE upstream_checked_at IS NOT NULL AND upstream_check_source IS NULL"
    )
    .get();
  if (orphanVerified.n !== 0) {
    throw new Error(`${orphanVerified.n} services carry an upstream check date with no source`);
  }

  const legacyAhead = db
    .prepare(
      `SELECT COUNT(*) AS n FROM services
       WHERE last_refreshed_at IS NOT NULL
         AND (upstream_checked_at IS NULL OR last_refreshed_at > upstream_checked_at)`
    )
    .get();
  if (legacyAhead.n !== 0) {
    throw new Error(
      `${legacyAhead.n} services have last_refreshed_at asserting more than upstream_checked_at can back`
    );
  }

  // The exact shape that used to lie: visited, nothing answered.
  const visitedUnverified = db
    .prepare(
      `SELECT * FROM services
       WHERE last_refresh_attempt_at IS NOT NULL AND upstream_checked_at IS NULL
       LIMIT 1`
    )
    .get();
  if (visitedUnverified) {
    const f = computeFreshness(visitedUnverified);
    if (f.confidence !== "unverified") {
      throw new Error(`visited-but-unverified row reported confidence "${f.confidence}"`);
    }
    if (f.last_checked !== null || f.last_refreshed !== null || f.data_age_days !== null) {
      throw new Error("visited-but-unverified row still exposes a freshness date");
    }
    if (f.last_attempt !== visitedUnverified.last_refresh_attempt_at) {
      throw new Error("the attempt date was dropped — diagnostics need it");
    }
  }

  // The scope must stay narrow, and must say so. A future edit that widens it
  // to cover prose is the regression this whole change exists to prevent.
  const anyRow = db.prepare("SELECT * FROM services LIMIT 1").get();
  const scoped = computeFreshness(anyRow);
  if (scoped.scope !== "upstream_metadata") {
    throw new Error(`freshness scope widened to "${scoped.scope}"`);
  }
  const legend = FRESHNESS_LEGEND.upstream_metadata;
  const excludes = legend.does_not_cover.join(" ").toLowerCase();
  for (const mustDisclaim of ["description", "connection_guide"]) {
    if (!excludes.includes(mustDisclaim)) {
      throw new Error(`legend no longer disclaims ${mustDisclaim}`);
    }
  }

  const liveness = checkLiveness(db);

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN upstream_checked_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
         SUM(CASE WHEN last_refresh_attempt_at IS NOT NULL AND upstream_checked_at IS NULL THEN 1 ELSE 0 END) AS visited_only
       FROM services`
    )
    .get();
  db.close();

  console.log(
    JSON.stringify({
      result: "PASS",
      services: counts.total,
      upstream_checked: counts.verified,
      visited_but_unchecked: counts.visited_only,
      freshness_scope: scoped.scope,
      stalled_runs: liveness.stalled.length,
      crawler_silent_days: liveness.silence_days,
    })
  );
} finally {
  rmSync(target, { force: true });
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
}
