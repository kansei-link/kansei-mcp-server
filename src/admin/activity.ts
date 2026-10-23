import type Database from "better-sqlite3";
import { notesWritesEnabled, notesDailyLimits, countToday } from "../notes/store.js";
import { askLogEnabled, askCandidates, askUnknownServiceIds, dailyCap, dailySlotsUsed } from "../ask/engine.js";
import { ensureUsageLogSchema, usageSummary } from "../mcp-usage-log.js";

// GET /admin/activity — one read-only summary for the founder's watch screen.
// Counts and already-public note text only. Never returns IPs, raw user agents, or
// question text (ask_log holds none of those). Writes nothing.

/** Alert thresholds, in one place. */
export const ACTIVITY_ALERTS = {
  writesPerHour: 20,          // notes + results in the last hour, all services
  dailyCapShare: 0.5,         // share of a daily cap used today (notes, results, ask)
  sameServicePerHour: 10,     // notes + results for one service in the last hour
} as const;

const BODY_MAX = 200;
const LATEST = 20;
const ASK_TOP = 10;

type Count = { n: number };
const ratio = (used: number, cap: number) => (cap > 0 ? Math.round((used / cap) * 1000) / 1000 : null);

export function adminActivity(db: Database.Database, now = new Date()) {
  ensureUsageLogSchema(db); // idempotent; the summary below reads the table
  const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as Count).n;
  // created_at / asked_at are stored as UTC 'YYYY-MM-DD HH:MM:SS' (datetime('now')).
  const since = (mod: string) => `datetime('now', '${mod}')`;

  // ─── notes ───
  const notes24 = one(`SELECT count(*) AS n FROM agent_notes WHERE created_at >= ${since("-24 hours")}`);
  const notes7d = one(`SELECT count(*) AS n FROM agent_notes WHERE created_at >= ${since("-7 days")}`);
  const results24 = one(`SELECT count(*) AS n FROM agent_note_results WHERE created_at >= ${since("-24 hours")}`);
  const results7d = one(`SELECT count(*) AS n FROM agent_note_results WHERE created_at >= ${since("-7 days")}`);
  const notesHour = one(`SELECT count(*) AS n FROM agent_notes WHERE created_at >= ${since("-1 hour")}`);
  const resultsHour = one(`SELECT count(*) AS n FROM agent_note_results WHERE created_at >= ${since("-1 hour")}`);

  // status column only ever holds 'unverified' today; verified/lived are reported so the shape is stable.
  const statusRows = db.prepare(`SELECT status, count(*) AS n FROM agent_notes WHERE hidden = 0 GROUP BY status`).all() as Array<{ status: string; n: number }>;
  const byStatus: Record<string, number> = { unverified: 0, verified: 0, lived: 0 };
  for (const r of statusRows) byStatus[r.status] = r.n;
  const hiddenNotes = one(`SELECT count(*) AS n FROM agent_notes WHERE hidden = 1`);

  const limits = notesDailyLimits();
  const notesToday = countToday(db, "agent_notes");
  const resultsToday = countToday(db, "agent_note_results");

  const latest = (db.prepare(`SELECT id, service_id, task, symptom, status, hidden, created_at
      FROM agent_notes ORDER BY created_at DESC, id LIMIT ?`).all(LATEST) as Array<{
        id: string; service_id: string; task: string; symptom: string; status: string; hidden: number; created_at: string;
      }>).map((r) => ({
        id: r.id,
        service_id: r.service_id,
        title: r.task,
        status: r.status,
        hidden: r.hidden === 1,
        created_at: r.created_at,
        // Hidden notes are no longer public, so their text is not repeated here.
        body: r.hidden === 1 ? null : (r.symptom.length > BODY_MAX ? `${r.symptom.slice(0, BODY_MAX)}…` : r.symptom),
      }));

  const hotServices = db.prepare(`SELECT service_id, count(*) AS n FROM (
        SELECT service_id FROM agent_notes WHERE created_at >= ${since("-1 hour")}
        UNION ALL
        SELECT n.service_id FROM agent_note_results r JOIN agent_notes n ON n.id = r.note_id
          WHERE r.created_at >= ${since("-1 hour")}
      ) GROUP BY service_id HAVING count(*) > ? ORDER BY n DESC`).all(ACTIVITY_ALERTS.sameServicePerHour) as Array<{ service_id: string; n: number }>;

  // ─── ask ───
  const askWindow = (mod: string) => db.prepare(`SELECT count(*) AS asks, coalesce(sum(match_count > 0), 0) AS matched
      FROM ask_log WHERE asked_at >= ${since(mod)}`).get() as { asks: number; matched: number };
  const ask24 = askWindow("-24 hours");
  const ask7d = askWindow("-7 days");
  const askCap = dailyCap();
  const askUsed = dailySlotsUsed(now);
  const topUnmatched = (askCandidates(db).candidates as unknown[]).slice(0, ASK_TOP);

  // ─── alerts ───
  const alerts: string[] = [];
  const writesHour = notesHour + resultsHour;
  if (writesHour > ACTIVITY_ALERTS.writesPerHour) alerts.push(`writes in the last hour: ${writesHour} (> ${ACTIVITY_ALERTS.writesPerHour})`);
  const share = ACTIVITY_ALERTS.dailyCapShare;
  if (limits.notes > 0 && notesToday / limits.notes > share) alerts.push(`notes daily cap: ${notesToday}/${limits.notes} used (> ${share * 100}%)`);
  if (limits.results > 0 && resultsToday / limits.results > share) alerts.push(`results daily cap: ${resultsToday}/${limits.results} used (> ${share * 100}%)`);
  for (const h of hotServices) alerts.push(`service ${h.service_id}: ${h.n} writes in the last hour (> ${ACTIVITY_ALERTS.sameServicePerHour})`);
  if (askCap > 0 && askUsed / askCap > share) alerts.push(`ask daily cap: ${askUsed}/${askCap} used (> ${share * 100}%)`);

  return {
    schema: "kansei-admin-activity/v1",
    generated_at: now.toISOString(),
    notes: {
      writes_enabled: notesWritesEnabled(),
      last_24h: { notes: notes24, results: results24 },
      last_7d: { notes: notes7d, results: results7d },
      last_1h: { notes: notesHour, results: resultsHour },
      by_status: { ...byStatus, hidden: hiddenNotes },
      daily_cap: {
        day: "JST",
        notes: { used: notesToday, limit: limits.notes, ratio: ratio(notesToday, limits.notes) },
        results: { used: resultsToday, limit: limits.results, ratio: ratio(resultsToday, limits.results) },
      },
      latest,
    },
    ask: {
      log_enabled: askLogEnabled(),
      last_24h: { asks: ask24.asks, matched: ask24.matched, unmatched: ask24.asks - ask24.matched },
      last_7d: { asks: ask7d.asks, matched: ask7d.matched, unmatched: ask7d.asks - ask7d.matched },
      daily_cap: { day: "UTC", used: askUsed, limit: askCap, ratio: ratio(askUsed, askCap), note: "in-process counter; resets on restart" },
      top_unmatched_30d: topUnmatched,
      // service ids asked for that do not exist (problem service-not-found), last 7 days, top 20;
      // malformed = strings that did not look like an id (count only, no content kept)
      unknown_service_ids_7d: askUnknownServiceIds(db, 7, 20),
    },
    // ─── hosted /mcp usage (stage 2a) — counts only; see src/mcp-usage-log.ts for what a row holds ───
    mcp_usage: usageSummary(db, 7),
    alerts,
    thresholds: ACTIVITY_ALERTS,
  };
}
