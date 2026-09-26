#!/usr/bin/env tsx
/**
 * Crawl liveness check — two failures that look identical from the outside and
 * are not.
 *
 *   1. STALLED  — a crawl_runs row still says 'running' long after it started.
 *                 run.ts closes a row on success and on a caught exception, so
 *                 a row left open means the process died without either: killed,
 *                 crashed, or the machine went away.
 *   2. SILENT   — no run has *finished* recently. This is the one that hurt:
 *                 run 39 opened 2026-07-26 07:05 and never closed, and because
 *                 nothing watched for it the crawler stayed dead for ~8 weeks
 *                 while every service record quietly aged.
 *
 * A stalled row is also silent, but silence can happen with no stalled row at
 * all (cron disabled, host down), so both are reported independently.
 *
 * Usage:
 *   npx tsx src/crawler/check-stalled-runs.ts                    # report, exit 1 on problems
 *   npx tsx src/crawler/check-stalled-runs.ts --fix              # also mark stalled rows
 *   npx tsx src/crawler/check-stalled-runs.ts --json             # machine-readable
 *   npx tsx src/crawler/check-stalled-runs.ts --stall-hours 12 --silence-days 2
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

/**
 * A full crawl has legitimately taken over 10 hours (run 38: 22:23 → 08:35), so
 * the stall threshold has to clear that comfortably or the check cries wolf on
 * a healthy long run.
 */
const DEFAULT_STALL_HOURS = 24;
/** The daily crawler should finish something well inside this window. */
const DEFAULT_SILENCE_DAYS = 3;

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
}

export interface LivenessReport {
  ok: boolean;
  stalled: Array<{ id: number; started_at: string; age_hours: number }>;
  last_finished: { id: number; finished_at: string; status: string } | null;
  silence_days: number | null;
  silent: boolean;
  thresholds: { stall_hours: number; silence_days: number };
}

function hoursSince(iso: string, now: Date): number {
  // SQLite datetime('now') is UTC without a zone marker; make that explicit
  // rather than letting the runtime read it as local time.
  const t = new Date(iso.replace(" ", "T") + "Z").getTime();
  return (now.getTime() - t) / (1000 * 60 * 60);
}

export function checkLiveness(
  db: Database.Database,
  opts: { stallHours?: number; silenceDays?: number; now?: Date } = {}
): LivenessReport {
  const stallHours = opts.stallHours ?? DEFAULT_STALL_HOURS;
  const silenceDays = opts.silenceDays ?? DEFAULT_SILENCE_DAYS;
  const now = opts.now ?? new Date();

  const open = db
    .prepare(
      `SELECT id, started_at, finished_at, status FROM crawl_runs
       WHERE status = 'running' AND finished_at IS NULL
       ORDER BY started_at`
    )
    .all() as RunRow[];

  const stalled = open
    .map((r) => ({ id: r.id, started_at: r.started_at, age_hours: hoursSince(r.started_at, now) }))
    .filter((r) => r.age_hours > stallHours)
    .map((r) => ({ ...r, age_hours: Math.round(r.age_hours * 10) / 10 }));

  // 'stalled' rows carry a finished_at, but we wrote it — the crawler never got
  // there. Counting them would let `--fix` silence the very alarm it is meant to
  // raise: close six dead runs, and the crawler looks alive again. Only a run
  // the process itself closed (success / success_with_errors / failed) is
  // evidence that anything ran.
  const lastFinished = db
    .prepare(
      `SELECT id, finished_at, status FROM crawl_runs
       WHERE finished_at IS NOT NULL AND status <> 'stalled'
       ORDER BY finished_at DESC LIMIT 1`
    )
    .get() as { id: number; finished_at: string; status: string } | undefined;

  const silenceElapsed = lastFinished
    ? hoursSince(lastFinished.finished_at, now) / 24
    : null;
  const silent = silenceElapsed === null || silenceElapsed > silenceDays;

  return {
    ok: stalled.length === 0 && !silent,
    stalled,
    last_finished: lastFinished ?? null,
    silence_days: silenceElapsed === null ? null : Math.round(silenceElapsed * 10) / 10,
    silent,
    thresholds: { stall_hours: stallHours, silence_days: silenceDays },
  };
}

/** Close out rows whose process is gone. Returns how many were marked. */
export function markStalled(db: Database.Database, ids: number[]): number {
  if (ids.length === 0) return 0;
  const stmt = db.prepare(
    `UPDATE crawl_runs
     SET status = 'stalled', finished_at = datetime('now'),
         errors = json_insert(COALESCE(NULLIF(errors, ''), '[]'), '$[#]',
                              'marked stalled by check-stalled-runs: process exited without closing the run')
     WHERE id = ? AND status = 'running'`
  );
  const tx = db.transaction((xs: number[]) => {
    let n = 0;
    for (const id of xs) n += stmt.run(id).changes;
    return n;
  });
  return tx(ids);
}

function main() {
  const args = process.argv.slice(2);
  const numArg = (flag: string, fallback: number) => {
    const i = args.indexOf(flag);
    if (i === -1) return fallback;
    const v = Number(args[i + 1]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const report = checkLiveness(db, {
    stallHours: numArg("--stall-hours", DEFAULT_STALL_HOURS),
    silenceDays: numArg("--silence-days", DEFAULT_SILENCE_DAYS),
  });

  if (args.includes("--fix") && report.stalled.length > 0) {
    const n = markStalled(db, report.stalled.map((r) => r.id));
    console.error(`[liveness] marked ${n} run(s) as stalled`);
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`[liveness] stall threshold ${report.thresholds.stall_hours}h | silence threshold ${report.thresholds.silence_days}d`);
    for (const r of report.stalled) {
      console.error(`  ✗ STALLED run #${r.id} — opened ${r.started_at}, still 'running' ${r.age_hours}h later`);
    }
    if (report.silent) {
      console.error(
        report.last_finished
          ? `  ✗ SILENT — last finished run #${report.last_finished.id} at ${report.last_finished.finished_at} (${report.silence_days} days ago)`
          : `  ✗ SILENT — no crawl run has ever finished`
      );
      console.error(`      Every service record is ageing while nothing re-reads upstream.`);
    }
    if (report.ok) console.error("  ✓ crawler is alive");
  }

  db.close();
  if (!report.ok) process.exit(1);
}

// Only run when invoked directly, so the checks stay importable from ops code.
if (process.argv[1] && process.argv[1].includes("check-stalled-runs")) main();
