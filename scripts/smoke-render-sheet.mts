#!/usr/bin/env tsx
/**
 * Smoke test for exec-harness/render-reading-sheet.mjs (HANDOFF Step 2 §6).
 *
 *   npx tsx scripts/smoke-render-sheet.mts
 *
 * Builds an in-memory ledger with fake readings (two markers, a superseded row,
 * an instrument row, a ground-truth row) and checks the sheet: only effective
 * rows, the three numbers, 「不明」 after 24h, no ranks/scores/values, and the
 * real marker DB (read-only) renders M-001 without throwing.
 */
import Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { renderSheet, loadRows } from "../exec-harness/render-reading-sheet.mjs";

const ROOT = resolve(import.meta.dirname, "..");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };

const db = new Database(":memory:");
db.exec("CREATE TABLE outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT); INSERT INTO outcomes DEFAULT VALUES;");
db.exec(readFileSync(join(ROOT, "exec-harness", "schemas", "marker_readings.sql"), "utf-8"));
const ins = db.prepare(`INSERT INTO marker_readings (reading_id, outcome_id, claim, marker_id, expected_digest, target_json, stage_reached, stage_stopped, observed_json, evidence_ref, observer, kind, observed_at, supersedes)
  VALUES (@id, @oid, @claim, @mk, @dg, @tj, @sr, @ss, @oj, @ev, @ob, 'synthetic', @at, @sup)`);
const dg = "a".repeat(64);
const ev = (n: string) => `evidence/x/${n}#sha256:${n.toLowerCase().replace(/[^0-9a-f]/g, "e").padEnd(64, "f")}`;
const row = (o: any) => ins.run({ id: o.id, oid: o.oid === undefined ? 1 : o.oid, claim: o.claim ?? "テスト主張", mk: o.mk ?? "M-777", dg, tj: JSON.stringify({ service_id: "x", model: o.model ?? "m", harness_version: "h" }), sr: o.sr, ss: o.ss ?? null, oj: JSON.stringify({ pass: o.pass, method: "harness_direct_api_vs_sealed_expectation", checks: [], false_completion: o.fc ?? false, ground_truth_consistent: o.gt ?? true, instrument_error: o.inst ?? null }), ev: ev(o.id.slice(-4)), ob: o.ob ?? "kansei_harness@run-marker@0.4.0", at: o.at, sup: o.sup ?? null });
row({ id: "01AAAAAAAAAAAAAAAAAAAAAAA1", sr: "understand", ss: "understand", pass: false, fc: true, at: "2026-09-20T09:50:00+09:00" });
row({ id: "01AAAAAAAAAAAAAAAAAAAAAAA2", sr: "done", pass: true, at: "2026-09-21T09:50:00+09:00" });
row({ id: "01AAAAAAAAAAAAAAAAAAAAAAA3", sr: "done", pass: true, at: "2026-09-21T10:00:00+09:00", sup: "01AAAAAAAAAAAAAAAAAAAAAAA2" }); // correction of day 2
row({ id: "01AAAAAAAAAAAAAAAAAAAAAAA4", sr: "discover", ss: "discover", pass: false, inst: "provider_api", at: "2026-09-22T09:50:00+09:00" });
row({ id: "01AAAAAAAAAAAAAAAAAAAAAAA5", oid: null, sr: "done", pass: false, gt: false, at: "2026-09-22T09:49:00+09:00" }); // ground-truth row
row({ id: "01AAAAAAAAAAAAAAAAAAAAAAA6", sr: "done", pass: true, at: "2026-09-23T09:50:00+09:00", ob: "codex@0.153.4", model: "gpt-6-astra" });
row({ id: "01BBBBBBBBBBBBBBBBBBBBBBB1", mk: "M-778", sr: "done", pass: true, at: "2026-09-23T09:50:00+09:00" }); // other marker

const rows = loadRows(db, "M-777");
expect("effective rows exclude the superseded one and other markers", rows.length === 5 && !rows.some((r) => r.reading_id.endsWith("A2")) && !rows.some((r) => r.marker_id === "M-778"));
const md = renderSheet(rows, { markerId: "M-777", now: new Date("2026-09-23T12:00:00+09:00") });
expect("has the claim, fingerprint and period", md.includes("テスト主張") && md.includes(dg) && md.includes("2026-09-20 〜 2026-09-23"));
expect("observers listed incl. agent CLI observer", md.includes("codex@0.153.4（gpt-6-astra）"));
expect("day rows: 4 agent rows", (md.match(/^\| 2026-09-2\d \| /gm) || []).length === 4 + 1, `${(md.match(/^\| 2026-09-2\d \| /gm) || []).length}`);
expect("false completion marked and counted", md.includes("| あり |") && md.includes("偽の完了: 1 回"));
expect("instrument row shown as 計器", md.includes("計器:provider_api"));
expect("stop days per stage", md.includes("| 発見 | 1 |") && md.includes("| 理解 | 1 |") && md.includes("| 接続 | 0 |"));
expect("ground-truth section header present (not just the footer count)", md.includes("### 正解側の行（封印の期待 vs ハーネスの直接読み）"));
expect("ground-truth section has exactly one 不一致 row and it is not in the day table", (md.split("### 正解側の行")[1] || "").split("## 三つの数字")[0].match(/^\| 2026-09-22 \| 不一致 \| /gm)?.length === 1);
expect("ground-truth row kept outcome_id null (counted in period line)", md.includes("正解側の行 1）"));
let hexAdjacent = false; try { renderSheet([{ ...rows[0], claim: "主張 a12345678b を含む" }], { markerId: "M-777" }); } catch { hexAdjacent = true; }
expect("renderer refuses an 8-digit run even between hex letters", hexAdjacent);
expect("last observation fresh (2h)", md.includes("計器の最終観測: 2026-09-23T09:50:00+09:00"));
const stale = renderSheet(rows, { markerId: "M-777", now: new Date("2026-09-25T12:00:00+09:00") });
expect("last observation 不明 after 24h", /計器の最終観測: 不明/.test(stale));
expect("no ranks/scores/comparison/values words", !/順位|ランキング|点数|スコア|他社|¥/.test(md));
let threw = false; try { renderSheet([{ ...rows[0], claim: "点数を付ける主張" }], { markerId: "M-777" }); } catch { threw = true; }
expect("renderer refuses a sheet containing a forbidden word", threw);
expect("empty ledger renders placeholders", renderSheet([], { markerId: "M-000" }).includes("(no readings yet)"));

// real ledger, read-only
const real = process.env.KANSEI_DB_PATH || join(ROOT, "kansei-marker.db");
if (existsSync(real)) {
  const rdb = new Database(real, { readonly: true });
  const r1 = loadRows(rdb, "M-001"); rdb.close();
  const sheet = renderSheet(r1, { markerId: "M-001" });
  expect("real M-001 ledger renders", sheet.includes("# 読みの表 — M-001") && r1.length >= 1, `${r1.length} rows`);
  expect("real sheet has no 8+ digit runs outside digests", !/(^|[^0-9a-f])[0-9]{8,}([^0-9a-f]|$)/.test(sheet.replace(/[0-9a-f]{12}…/g, "").replace(/`[0-9a-f]{64}`/g, "")));
} else console.log("SKIP  real ledger not present");

console.log(failures === 0 ? "\nrender-sheet smoke: ALL PASS" : `\nrender-sheet smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
