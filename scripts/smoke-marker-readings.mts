#!/usr/bin/env tsx
/**
 * Smoke test for the reading predicate v1 storage (HANDOFF Step 1 T1 / §5 判定).
 *
 *   npx tsx scripts/smoke-marker-readings.mts
 *
 * Checks: schema validation of a sample reading, append-only triggers refuse
 * UPDATE/DELETE, supersedes chain works, and a synthetic outcomes row never
 * appears in publishable_outcomes (uses the real initializeDb schema).
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeDb } from "../src/db/schema.js";
import { newUlid, validateReading, isoWithOffset } from "../exec-harness/lib/reading.mjs";

let failures = 0;
function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures++;
}

const db = new Database(":memory:");
initializeDb(db);
db.prepare("INSERT OR IGNORE INTO services (id, name, category) VALUES ('freee', 'freee', 'accounting')").run();
db.exec(readFileSync(resolve(import.meta.dirname, "../exec-harness/schemas/marker_readings.sql"), "utf-8"));

const digest = "732a4fd91b9395b383d122fa24b9a48c4bd42654f064f806f62b2c95b140b576";
const reading = {
  reading_id: newUlid(),
  claim: "an agent, given only \"the production company\", reports the 2026-08 deal count of the correct freee company",
  marker_id: "M-001",
  expected_digest: digest,
  target: { service_id: "freee", model: "smoke-model", harness_version: "run-marker@0.1.0+0000000" },
  stage_reached: "execute",
  stage_stopped: "understand",
  observed: {
    pass: false,
    method: "harness_direct_api_vs_sealed_expectation",
    checks: [{ label: "deals_call_used_sealed_company", ok: false }],
    false_completion: true,
    ground_truth_consistent: true,
    instrument_error: null,
  },
  evidence_ref: "evidence/freee/2026-09-24/marker-m001/000000#sha256:" + "a".repeat(64),
  observer: "kansei_harness@run-marker@0.1.0",
  kind: "synthetic",
  observed_at: isoWithOffset(new Date()),
  supersedes: null,
};

// 1. schema validation
expect("valid reading passes schema", validateReading(reading).length === 0, validateReading(reading).join("; "));
expect("done with stage_stopped set is rejected", validateReading({ ...reading, stage_reached: "done" }).length > 0);
expect("unknown property is rejected", validateReading({ ...reading, deal_count: 3 }).length > 0);
expect("bad digest is rejected", validateReading({ ...reading, expected_digest: "xyz" }).length > 0);
expect("ulid format", /^[0-9A-HJKMNP-TV-Z]{26}$/.test(reading.reading_id));

// 2. synthetic outcomes row + sidecar insert
const outcomeId = db.prepare(
  `INSERT INTO outcomes (service_id, agent_id_hash, success, provenance, verification_status, model_name, task_type, failed_step)
   VALUES ('freee', 'kansei-marker-harness', 0, 'synthetic', 'assertion_verified', 'smoke-model', 'marker:M-001', 'understand')`
).run().lastInsertRowid;
const ins = db.prepare(`INSERT INTO marker_readings
  (reading_id, outcome_id, claim, marker_id, expected_digest, target_json, stage_reached, stage_stopped, observed_json, evidence_ref, observer, kind, observed_at, supersedes)
  VALUES (@reading_id, @outcome_id, @claim, @marker_id, @expected_digest, @target_json, @stage_reached, @stage_stopped, @observed_json, @evidence_ref, @observer, @kind, @observed_at, @supersedes)`);
ins.run({ ...reading, outcome_id: outcomeId, target_json: JSON.stringify(reading.target), observed_json: JSON.stringify(reading.observed) });
expect("sidecar row inserted", (db.prepare("SELECT COUNT(*) AS n FROM marker_readings").get() as { n: number }).n === 1);

// 3. append-only
let updErr = "";
try { db.prepare("UPDATE marker_readings SET stage_stopped = 'connect' WHERE reading_id = ?").run(reading.reading_id); } catch (e) { updErr = String(e); }
expect("UPDATE refused by trigger", /append-only/.test(updErr), updErr.slice(0, 80));
let delErr = "";
try { db.prepare("DELETE FROM marker_readings WHERE reading_id = ?").run(reading.reading_id); } catch (e) { delErr = String(e); }
expect("DELETE refused by trigger", /append-only/.test(delErr), delErr.slice(0, 80));

// 4. correction via supersedes
const fix = { ...reading, reading_id: newUlid(), stage_stopped: "connect", supersedes: reading.reading_id, observed_at: isoWithOffset(new Date(Date.now() + 1000)) };
expect("correction row validates", validateReading(fix).length === 0, validateReading(fix).join("; "));
ins.run({ ...fix, outcome_id: outcomeId, target_json: JSON.stringify(fix.target), observed_json: JSON.stringify(fix.observed) });
const effective = db.prepare(`SELECT reading_id FROM marker_readings r
   WHERE r.marker_id = 'M-001' AND NOT EXISTS (SELECT 1 FROM marker_readings s WHERE s.supersedes = r.reading_id)`).all() as { reading_id: string }[];
expect("effective rows = 1 after supersede", effective.length === 1 && effective[0].reading_id === fix.reading_id);

// 5. synthetic never publishable — even with 7 same-condition verified rows
for (let i = 0; i < 6; i++) {
  db.prepare(
    `INSERT INTO outcomes (service_id, agent_id_hash, success, provenance, verification_status, model_name, task_type)
     VALUES ('freee', 'kansei-marker-harness', 1, 'synthetic', 'assertion_verified', 'smoke-model', 'marker:M-001')`
  ).run();
}
const pub = db.prepare("SELECT COUNT(*) AS n FROM publishable_outcomes WHERE service_id = 'freee'").get() as { n: number };
expect("publishable_outcomes has 0 synthetic marker rows (7 present)", pub.n === 0, `n=${pub.n}`);
const stats = db.prepare("SELECT COUNT(*) AS n FROM publishable_service_stats WHERE service_id = 'freee'").get() as { n: number };
expect("publishable_service_stats untouched", stats.n === 0, `n=${stats.n}`);

console.log(failures === 0 ? "\nmarker-readings smoke: ALL PASS" : `\nmarker-readings smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
