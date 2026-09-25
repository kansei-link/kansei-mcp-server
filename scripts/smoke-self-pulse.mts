#!/usr/bin/env tsx
/**
 * Smoke test for src/crawler/self-pulse.ts (HANDOFF Step 1 T4 / §5 判定).
 *
 *   npx tsx scripts/smoke-self-pulse.mts
 *
 * Builds an in-memory DB, plants a crawl run that died while 'running',
 * and checks that the DISPLAY status becomes 'unknown' after the 30h
 * baseline without any row being rewritten. Exit 1 on any failure.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeSelfPulse, parseDbTime } from "../src/crawler/self-pulse.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const utc = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

let failures = 0;
function expect(label: string, actual: unknown, wanted: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)})`}`);
  if (!ok) failures++;
}

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      sources_crawled TEXT DEFAULT '[]',
      discovered_count INTEGER DEFAULT 0,
      auto_accepted_count INTEGER DEFAULT 0,
      review_queue_count INTEGER DEFAULT 0,
      rejected_count INTEGER DEFAULT 0,
      duplicates_count INTEGER DEFAULT 0,
      errors TEXT DEFAULT '[]'
    );
  `);
  db.exec(readFileSync(resolve(import.meta.dirname, "../exec-harness/schemas/marker_readings.sql"), "utf-8"));
  return db;
}

// 0. parse helper
expect("parseDbTime: sqlite utc", parseDbTime("2026-09-24 03:00:00")?.toISOString(), "2026-09-24T03:00:00.000Z");
expect("parseDbTime: iso offset", parseDbTime("2026-09-24T12:00:00+09:00")?.toISOString(), "2026-09-24T03:00:00.000Z");

// 1. empty tables -> unknown / null, nothing invented
{
  const db = freshDb();
  const p = computeSelfPulse(db, { now: NOW });
  expect("empty: crawler unknown", p.crawler.display_status, "unknown");
  expect("empty: crawler hours null", p.crawler.hours_since_last_success, null);
  expect("empty: crawler within_baseline null", p.crawler.within_baseline, null);
  expect("empty: marker unknown", p.marker.display_status, "unknown");
  expect("empty: marker last null", p.marker.last_observation_at, null);
}

// 2. a run that died while 'running' 40h ago -> unknown (row untouched)
{
  const db = freshDb();
  db.prepare("INSERT INTO crawl_runs (started_at, status) VALUES (?, 'running')").run(utc(40));
  const p = computeSelfPulse(db, { now: NOW });
  expect("dead running 40h: display unknown", p.crawler.display_status, "unknown");
  expect("dead running 40h: row still says running", db.prepare("SELECT status FROM crawl_runs").pluck().get(), "running");
  expect("dead running 40h: no success -> within_baseline null", p.crawler.within_baseline, null);
}

// 3. a run started 1h ago and still running -> running
{
  const db = freshDb();
  db.prepare("INSERT INTO crawl_runs (started_at, finished_at, status) VALUES (?, ?, 'success')").run(utc(26), utc(25));
  db.prepare("INSERT INTO crawl_runs (started_at, status) VALUES (?, 'running')").run(utc(1));
  const p = computeSelfPulse(db, { now: NOW });
  expect("live running 1h: display running", p.crawler.display_status, "running");
  expect("live running 1h: hours since success 25", p.crawler.hours_since_last_success, 25);
  expect("live running 1h: within baseline", p.crawler.within_baseline, true);
}

// 4. last success 5h ago -> success, within baseline
{
  const db = freshDb();
  db.prepare("INSERT INTO crawl_runs (started_at, finished_at, status) VALUES (?, ?, 'success')").run(utc(6), utc(5));
  const p = computeSelfPulse(db, { now: NOW });
  expect("success 5h: display success", p.crawler.display_status, "success");
  expect("success 5h: within baseline", p.crawler.within_baseline, true);
}

// 5. last success 40h ago, then dead running 35h ago -> unknown, outside baseline
{
  const db = freshDb();
  db.prepare("INSERT INTO crawl_runs (started_at, finished_at, status) VALUES (?, ?, 'success_with_errors')").run(utc(41), utc(40));
  db.prepare("INSERT INTO crawl_runs (started_at, status) VALUES (?, 'running')").run(utc(35));
  const p = computeSelfPulse(db, { now: NOW });
  expect("stale + dead: display unknown", p.crawler.display_status, "unknown");
  expect("stale + dead: hours since success 40", p.crawler.hours_since_last_success, 40);
  expect("stale + dead: outside baseline", p.crawler.within_baseline, false);
}

// 6. baseline override honoured (HEALTH.json value is passed in by the CLI)
{
  const db = freshDb();
  db.prepare("INSERT INTO crawl_runs (started_at, status) VALUES (?, 'running')").run(utc(10));
  expect("baseline 8h: 10h running -> unknown", computeSelfPulse(db, { now: NOW, crawlerMaxHours: 8 }).crawler.display_status, "unknown");
  expect("baseline 30h: 10h running -> running", computeSelfPulse(db, { now: NOW, crawlerMaxHours: 30 }).crawler.display_status, "running");
}

// 7. marker pulse: 2h ago fresh, 30h ago unknown
{
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO marker_readings
    (reading_id, claim, marker_id, expected_digest, target_json, stage_reached, stage_stopped, observed_json, evidence_ref, observer, kind, observed_at)
    VALUES (?, 'smoke claim', 'M-001', ?, '{}', 'done', NULL, '{"pass":true}', 'evidence/x#sha256:' || ?, 'kansei_harness@smoke', 'synthetic', ?)`);
  const digest = "0".repeat(64);
  ins.run("01ARZ3NDEKTSV4RRFFQ69G5FAV", digest, digest, iso(30));
  expect("marker 30h: unknown", computeSelfPulse(db, { now: NOW }).marker.display_status, "unknown");
  ins.run("01ARZ3NDEKTSV4RRFFQ69G5FAW", digest, digest, iso(2));
  const p = computeSelfPulse(db, { now: NOW });
  expect("marker 2h: fresh", p.marker.display_status, "fresh");
  expect("marker 2h: hours 2", p.marker.hours_since_last_observation, 2);
}

// Compare unrounded ages: even one millisecond beyond a boundary is stale.
for (const over of [0, 1]) {
  const db = freshDb();
  const crawlerTime = new Date(NOW.getTime() - 30 * 3_600_000 - over).toISOString();
  const markerTime = new Date(NOW.getTime() - 24 * 3_600_000 - over).toISOString();
  db.prepare("INSERT INTO crawl_runs(started_at,finished_at,status) VALUES(?,?,'success')").run(crawlerTime, crawlerTime);
  db.prepare("INSERT INTO crawl_runs(started_at,status) VALUES(?,'running')").run(crawlerTime);
  db.prepare(`INSERT INTO marker_readings(reading_id,claim,marker_id,expected_digest,target_json,stage_reached,stage_stopped,observed_json,evidence_ref,observer,kind,observed_at)
    VALUES('boundary','boundary test','M-001',?,'{}','done',NULL,'{}','test','kansei_harness@smoke','synthetic',?)`).run('a'.repeat(64), markerTime);
  const p = computeSelfPulse(db, { now: NOW });
  expect(`crawler 30h + ${over}ms`, p.crawler.display_status, over ? 'unknown' : 'running');
  expect(`success baseline 30h + ${over}ms`, p.crawler.within_baseline, !over);
  expect(`marker 24h + ${over}ms`, p.marker.display_status, over ? 'unknown' : 'fresh');
  expect(`boundary rows untouched +${over}ms`, db.prepare("SELECT status FROM crawl_runs ORDER BY id DESC LIMIT 1").pluck().get(), 'running');
  db.close();
}

console.log(failures === 0 ? "\nself-pulse smoke: ALL PASS" : `\nself-pulse smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
