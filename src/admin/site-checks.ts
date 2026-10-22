import type Database from "better-sqlite3";

// GET /admin/site-checks — read-only summary of the free site checker's log
// (site_checks), for the founder's watch screen and a CSV export.
// Returns domains, scores and grades only. Never returns ip_hash values or raw
// signals; the number of distinct requesters is reported as a count only.
// Writes nothing.

export const SITE_CHECKS_DEFAULT_DAYS = 30;
export const SITE_CHECKS_MAX_DAYS = 365;
const TOP_DOMAINS = 20;
const LATEST = 100;
const GRADES = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"] as const;

export type SiteCheckRow = { id: string; domain: string; score: number; grade: string; created_at: string };

export const INVALID_URL_DOMAIN = "(invalid-url)";

/** Hostname without a leading "www.". A value that is not a URL returns a fixed
 *  marker — never the raw string, which could carry a path or query. */
export function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host || INVALID_URL_DOMAIN;
  } catch {
    return INVALID_URL_DOMAIN;
  }
}

/** Clamp the ?days= query to 1..365; anything unparseable falls back to 30. */
export function parseDays(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return SITE_CHECKS_DEFAULT_DAYS;
  return Math.min(n, SITE_CHECKS_MAX_DAYS);
}

function hasTable(db: Database.Database): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'site_checks'`).get());
}

/** Rows in the window, newest first. created_at is UTC 'YYYY-MM-DD HH:MM:SS'. */
export function siteCheckRows(db: Database.Database, days: number): SiteCheckRow[] {
  if (!hasTable(db)) return [];
  const rows = db
    .prepare(
      `SELECT id, url, score, grade, created_at FROM site_checks
        WHERE created_at >= datetime('now', ?)
        ORDER BY created_at DESC, id`
    )
    .all(`-${days} days`) as Array<{ id: string; url: string; score: number; grade: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, domain: domainOf(r.url), score: r.score, grade: r.grade, created_at: r.created_at }));
}

export function adminSiteChecks(db: Database.Database, days = SITE_CHECKS_DEFAULT_DAYS, now = new Date()) {
  const rows = siteCheckRows(db, days);
  const table = hasTable(db);
  const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

  const allTime = table ? one(`SELECT count(*) AS n FROM site_checks`) : 0;
  const requesters = table
    ? one(`SELECT count(DISTINCT ip_hash) AS n FROM site_checks WHERE ip_hash IS NOT NULL AND created_at >= datetime('now', ?)`, `-${days} days`)
    : 0;
  const first = table ? (db.prepare(`SELECT min(created_at) AS t FROM site_checks`).get() as { t: string | null }).t : null;
  const last = table ? (db.prepare(`SELECT max(created_at) AS t FROM site_checks`).get() as { t: string | null }).t : null;

  const byDomain = new Map<string, { checks: number; last_at: string; last_score: number; last_grade: string }>();
  const byDay = new Map<string, number>();
  const byGrade: Record<string, number> = Object.fromEntries(GRADES.map((g) => [g, 0]));
  const scoreBands: Record<string, number> = { "0-24": 0, "25-49": 0, "50-74": 0, "75-100": 0 };
  for (const r of rows) {
    // rows are newest first, so the first sighting of a domain is its latest check
    const d = byDomain.get(r.domain);
    if (d) d.checks += 1;
    else byDomain.set(r.domain, { checks: 1, last_at: r.created_at, last_score: r.score, last_grade: r.grade });
    const day = r.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
    const band = r.score < 25 ? "0-24" : r.score < 50 ? "25-49" : r.score < 75 ? "50-74" : "75-100";
    scoreBands[band] += 1;
  }

  const domains = [...byDomain.entries()]
    .map(([domain, v]) => ({ domain, ...v }))
    .sort((a, b) => b.checks - a.checks || (a.last_at < b.last_at ? 1 : -1));

  return {
    schema: "kansei-admin-site-checks/v1",
    generated_at: now.toISOString(),
    window_days: days,
    totals: {
      all_time: allTime,
      in_window: rows.length,
      distinct_domains: byDomain.size,
      distinct_requesters: requesters,
      first_check_at: first,
      last_check_at: last,
    },
    by_day: [...byDay.entries()].map(([day, checks]) => ({ day, checks })).sort((a, b) => (a.day < b.day ? 1 : -1)),
    by_grade: byGrade,
    score_bands: scoreBands,
    top_domains: domains.slice(0, TOP_DOMAINS),
    latest: rows.slice(0, LATEST),
  };
}

/** Prefix a cell that a spreadsheet would read as a formula (=, +, -, @, tab, CR, LF). */
export function neutralizeFormula(v: string): string {
  return /^[=+\-@\t\r\n]/.test(v) ? `'${v}` : v;
}

/** CSV of every row in the window (UTF-8 with BOM so Excel opens it as Japanese-safe).
 *  Text cells are formula-neutralized before quoting, since the file is meant for Excel. */
export function siteChecksCsv(rows: SiteCheckRow[]): string {
  const esc = (raw: string) => {
    const v = neutralizeFormula(raw);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = rows.map((r) => [esc(r.id), esc(r.domain), String(r.score), esc(r.grade), esc(r.created_at)].join(","));
  return "﻿id,domain,score,grade,created_at_utc\n" + lines.join("\n") + (lines.length ? "\n" : "");
}
