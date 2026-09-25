#!/usr/bin/env tsx
/**
 * Self-pulse — the instrument reports its own last observation time.
 *
 * CANON-ReaderSide-Map v1 §3 principle 8: an instrument must publish when a
 * reading last came back, and say `unknown` when it has not. This module reads
 * `crawl_runs` and `marker_readings` and derives a DISPLAY status. It never
 * rewrites rows (append-only discipline): a crawl run that is still recorded
 * as 'running' after the baseline window is shown as `unknown`, because the
 * writer (src/crawler/run.ts) only flips the status when the process survives.
 *
 * Usage:
 *   npx tsx src/crawler/self-pulse.ts                 # KANSEI_DB_PATH or ./kansei-link.db
 *   npx tsx src/crawler/self-pulse.ts --db <path>
 *
 * Output: one JSON object on stdout. No table is modified.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type CrawlerDisplayStatus = "success" | "success_with_errors" | "failed" | "running" | "unknown";

export interface SelfPulse {
  computed_at: string;
  crawler: {
    table_present: boolean;
    last_run: { started_at: string | null; finished_at: string | null; recorded_status: string | null };
    display_status: CrawlerDisplayStatus;
    reason: string;
    last_success_finished_at: string | null;
    hours_since_last_success: number | null;
    baseline_max_hours: number;
    within_baseline: boolean | null;
  };
  marker: {
    table_present: boolean;
    last_observation_at: string | null;
    hours_since_last_observation: number | null;
    max_hours: number;
    display_status: "fresh" | "unknown";
    reason: string;
  };
}

export interface SelfPulseOptions {
  now?: Date;
  /** Hours after which a recorded 'running' crawl (or a missing success) is shown as unknown. Default 30 = HEALTH.json baseline. */
  crawlerMaxHours?: number;
  /** Hours after which the marker instrument is shown as unknown. Default 24 (one reading per day). */
  markerMaxHours?: number;
}

/** SQLite datetime('now') strings have no zone and are UTC; ISO strings carry their own offset. */
export function parseDbTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(s);
  const d = m ? new Date(`${m[1]}T${m[2]}Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

export function computeSelfPulse(db: Database.Database, opts: SelfPulseOptions = {}): SelfPulse {
  const now = opts.now ?? new Date();
  const crawlerMax = opts.crawlerMaxHours ?? 30;
  const markerMax = opts.markerMaxHours ?? 24;

  // ── crawler ─────────────────────────────────────────────────────
  const crawler: SelfPulse["crawler"] = {
    table_present: false,
    last_run: { started_at: null, finished_at: null, recorded_status: null },
    display_status: "unknown",
    reason: "crawl_runs table absent",
    last_success_finished_at: null,
    hours_since_last_success: null,
    baseline_max_hours: crawlerMax,
    within_baseline: null,
  };

  if (tableExists(db, "crawl_runs")) {
    crawler.table_present = true;
    const last = db
      .prepare("SELECT started_at, finished_at, status FROM crawl_runs ORDER BY id DESC LIMIT 1")
      .get() as { started_at: string | null; finished_at: string | null; status: string | null } | undefined;
    const lastOk = db
      .prepare(
        `SELECT finished_at FROM crawl_runs
          WHERE status IN ('success','success_with_errors') AND finished_at IS NOT NULL
          ORDER BY finished_at DESC LIMIT 1`
      )
      .get() as { finished_at: string } | undefined;

    if (!last) {
      crawler.reason = "no crawl run recorded";
    } else {
      crawler.last_run = { started_at: last.started_at, finished_at: last.finished_at, recorded_status: last.status };
      const started = parseDbTime(last.started_at);
      if (last.status === "running") {
        const age = started ? hoursBetween(started, now) : null;
        if (age === null) {
          crawler.display_status = "unknown";
          crawler.reason = "recorded 'running' but started_at unreadable";
        } else if (age > crawlerMax) {
          crawler.display_status = "unknown";
          crawler.reason = `recorded 'running' for ${age}h (> ${crawlerMax}h baseline): process probably died without closing the row`;
        } else {
          crawler.display_status = "running";
          crawler.reason = `recorded 'running' for ${age}h (within ${crawlerMax}h baseline)`;
        }
      } else if (last.status === "success" || last.status === "success_with_errors" || last.status === "failed") {
        crawler.display_status = last.status;
        crawler.reason = `last run recorded '${last.status}'`;
      } else {
        crawler.display_status = "unknown";
        crawler.reason = `last run has unrecognised status '${String(last.status)}'`;
      }
    }

    if (lastOk) {
      const fin = parseDbTime(lastOk.finished_at);
      crawler.last_success_finished_at = lastOk.finished_at;
      if (fin) {
        const age = hoursBetween(fin, now);
        crawler.hours_since_last_success = Math.round(age * 10) / 10;
        crawler.within_baseline = age <= crawlerMax;
      }
    } else if (crawler.table_present) {
      crawler.within_baseline = null;
      if (crawler.display_status !== "running") {
        // No success ever: whatever the last row says, the instrument has not returned a reading.
        crawler.display_status = crawler.display_status === "failed" ? "failed" : "unknown";
        if (!crawler.reason.includes("unrecognised") && crawler.display_status === "unknown")
          crawler.reason = `${crawler.reason}; no successful run on record`;
      }
    }
  }

  // ── marker (sealed dye) ──────────────────────────────────────────
  const marker: SelfPulse["marker"] = {
    table_present: false,
    last_observation_at: null,
    hours_since_last_observation: null,
    max_hours: markerMax,
    display_status: "unknown",
    reason: "marker_readings table absent",
  };

  if (tableExists(db, "marker_readings")) {
    marker.table_present = true;
    const row = db.prepare("SELECT MAX(observed_at) AS t FROM marker_readings").get() as { t: string | null };
    if (!row?.t) {
      marker.reason = "no reading recorded";
    } else {
      marker.last_observation_at = row.t;
      const t = parseDbTime(row.t);
      if (!t) {
        marker.reason = "observed_at unreadable";
      } else {
        const age = hoursBetween(t, now);
        marker.hours_since_last_observation = Math.round(age * 10) / 10;
        if (age <= markerMax) {
          marker.display_status = "fresh";
          marker.reason = `last reading ${age}h ago (<= ${markerMax}h)`;
        } else {
          marker.display_status = "unknown";
          marker.reason = `last reading ${age}h ago (> ${markerMax}h): no reading came back`;
        }
      }
    }
  }

  return { computed_at: now.toISOString(), crawler, marker };
}

/** Reads HEALTH.json's crawler_last_success_hours_ago.max (first code reader of that baseline). */
export function readCrawlerBaselineHours(healthJsonPath: string, fallback = 30): number {
  try {
    if (!existsSync(healthJsonPath)) return fallback;
    const h = JSON.parse(readFileSync(healthJsonPath, "utf-8"));
    const v = h?.baselines?.crawler_last_success_hours_ago?.max;
    return typeof v === "number" && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf("--db");
  const dbPath =
    dbIdx >= 0 ? args[dbIdx + 1] : process.env.KANSEI_DB_PATH ?? resolve(import.meta.dirname, "../../kansei-link.db");
  const baseline = readCrawlerBaselineHours(resolve(import.meta.dirname, "../../HEALTH.json"));
  if (!existsSync(dbPath)) {
    console.log(JSON.stringify({ error: "db_not_found", db: dbPath }, null, 2));
    process.exit(2);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    console.log(JSON.stringify(computeSelfPulse(db, { crawlerMaxHours: baseline }), null, 2));
  } finally {
    db.close();
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
