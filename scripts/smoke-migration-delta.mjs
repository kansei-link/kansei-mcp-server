#!/usr/bin/env node
/**
 * Phase A0: migrate-believable-delta.cjs のフィクスチャ検証（ローカル・本番非接触）。
 *
 * 再現するシナリオ（Codexが指摘したbatch-02の危険をそのまま試験）:
 *   - batch-01適用済み（id保持で挿入・migration_logはid由来キー）のcanonical
 *   - 切替後にcanonical独自の新規リードが増えている（AUTOINCREMENT id衝突の温床）
 *   - source側: 既存行 + 新規行 + canonical独自行と同内容の行 + 数値が更新された
 *     model_service_stats + 未変更のmodel_service_stats
 * 期待:
 *   - 新規のみ挿入（id非保持・衝突なし）
 *   - canonical独自の同内容行は二重挿入されない（実データ自然キー照合）
 *   - model_service_statsはlast_updatedが新しい行だけUPDATE
 *   - 再実行でinserted=0/updated=0（idempotent）
 *   - --since フィルタで残留分だけに絞れる（batch-03モード）
 */

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

const workDir = mkdtempSync(join(tmpdir(), "kansei-delta-smoke-"));
const dbPath = join(workDir, "canonical.db");
const payloadPath = join(workDir, "payload.json.gz");

// ── canonical フィクスチャ（batch-01適用済み + 独自新規行）
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE ranking_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, source TEXT, created_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE model_service_stats (service_id TEXT, model_name TEXT, task_type TEXT, success_rate REAL,
    total_calls INTEGER, last_updated TEXT, source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE agent_voice_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT, agent_type TEXT,
    agent_id TEXT, question_id TEXT, response_choice TEXT, response_text TEXT, confidence REAL, created_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE agent_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, feedback_type TEXT, service_id TEXT,
    subject TEXT, body TEXT, priority TEXT, status TEXT, created_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT, success INTEGER, created_at TEXT,
    model_name TEXT, task_type TEXT, error_class TEXT, context TEXT, agent_id TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE service_events (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT, event_type TEXT, title TEXT,
    description TEXT, created_at TEXT, source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE inspections (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT, status TEXT, findings TEXT, created_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE site_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, service_id TEXT, created_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE infrastructure_tips (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT, category TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE execution_attempts (attempt_id TEXT PRIMARY KEY, service_id TEXT, status TEXT, issued_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE migration_log (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT, source_system TEXT,
    table_name TEXT, source_key TEXT, new_rowid INTEGER, action TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_system, table_name, source_key));
`);
// batch-01で移行済みのリード（id保持=id 1・ログはid由来キー"1"）
db.prepare("INSERT INTO ranking_leads (id,email,source,created_at,source_system,migration_batch_id) VALUES (1,'old@a.jp','badge','2026-08-01 10:00:00','believable-vibrancy','mig-believable-20260816-01')").run();
db.prepare("INSERT INTO migration_log (batch_id,source_system,table_name,source_key,new_rowid,action) VALUES ('mig-believable-20260816-01','believable-vibrancy','ranking_leads','1',1,'inserted')").run();
// 切替後にcanonicalへ直接入った新規リード（source側にも同内容が残留しているケース）
db.prepare("INSERT INTO ranking_leads (email,source,created_at) VALUES ('both@b.jp','award_csv','2026-08-17 09:00:00')").run();
// batch-01移行済みのmodel_service_stats（source側で数値が動いたものと動かないもの）
db.prepare("INSERT INTO model_service_stats (service_id,model_name,task_type,success_rate,total_calls,last_updated,source_system) VALUES ('freee','claude','T1',0.8,10,'2026-08-15 00:00:00','believable-vibrancy')").run();
db.prepare("INSERT INTO model_service_stats (service_id,model_name,task_type,success_rate,total_calls,last_updated,source_system) VALUES ('mf','gpt','T1',0.5,4,'2026-08-15 00:00:00','believable-vibrancy')").run();
db.close();

// ── source ペイロード
const payload = { schemas: {}, rows: {
  ranking_leads: [
    { id: 1, email: "old@a.jp", source: "badge", created_at: "2026-08-01 10:00:00" },      // batch-01で移行済み→実データ照合でskip
    { id: 60, email: "new@c.jp", source: "webinar", created_at: "2026-08-16 20:00:00" },    // 新規→挿入（canonical側id 2と衝突しないこと）
    { id: 61, email: "both@b.jp", source: "award_csv", created_at: "2026-08-17 09:00:00" }, // canonical独自行と同内容→skip
    { id: 62, email: "late@d.jp", source: "webinar", created_at: "2026-08-17 12:00:00" },   // --since試験用の残留分
    { id: 63, email: "new@c.jp", source: "webinar", created_at: "2026-08-16 20:00:00" },    // 同一payload内の重複自然キー→1件だけ入ること
  ],
  model_service_stats: [
    { service_id: "freee", model_name: "claude", task_type: "T1", success_rate: 0.9, total_calls: 15, last_updated: "2026-08-16 12:00:00" }, // 更新あり→UPDATE
    { service_id: "mf", model_name: "gpt", task_type: "T1", success_rate: 0.5, total_calls: 4, last_updated: "2026-08-15 00:00:00" },        // 未変更→skip
  ],
  agent_voice_responses: [], agent_feedback: [], outcomes: [], service_events: [],
  inspections: [], site_checks: [], infrastructure_tips: [], execution_attempts: [],
} };
writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(payload)));

const run = (mode, extra = []) => JSON.parse(execFileSync(process.execPath,
  [join(ROOT, "scripts", "migrate-believable-delta.cjs"), mode, "--batch=mig-believable-test-02", `--payload=${payloadPath}`, `--db=${dbPath}`, ...extra],
  { encoding: "utf8" }));

// 1. dry-run（--sinceなし = batch-02モード）
const dry = run("dry");
check("1. dry: leads 新規2挿入・移行済み1+同内容1=skip・payload内重複1=skip", dry.summary.ranking_leads.inserted === 2 && dry.summary.ranking_leads.skippedExisting === 2 && dry.summary.ranking_leads.skippedDupInPayload === 1,
  JSON.stringify(dry.summary.ranking_leads)); // 60,62=挿入 / 1,61=skip / 63=payload内重複
check("2. dry: model_service_stats 更新1・未変更skip1", dry.summary.model_service_stats.updated === 1 && dry.summary.model_service_stats.skippedExisting === 1);

// 2. apply
const ap = run("apply");
const dbr = new Database(dbPath, { readonly: true });
const leads = dbr.prepare("SELECT id,email,source_system FROM ranking_leads ORDER BY id").all();
check("3. apply: 挿入はid自動採番で衝突なし", ap.summary.ranking_leads.inserted === 2 && leads.length === 4 && new Set(leads.map((l) => l.id)).size === 4, JSON.stringify(leads.map((l) => `${l.id}:${l.email}`)));
const freee = dbr.prepare("SELECT success_rate,total_calls,migration_batch_id FROM model_service_stats WHERE service_id='freee'").get();
check("4. apply: statsのUPSERT反映（0.8→0.9・batch刻印）", freee.success_rate === 0.9 && freee.total_calls === 15 && freee.migration_batch_id === "mig-believable-test-02");
check("5. apply: both@b.jpは1行のまま（二重挿入なし）", dbr.prepare("SELECT COUNT(*) c FROM ranking_leads WHERE email='both@b.jp'").get().c === 1);
dbr.close();

// 3. idempotency
const re = run("apply");
const totals = Object.values(re.summary).reduce((a, s) => ({ ins: a.ins + s.inserted, upd: a.upd + s.updated }), { ins: 0, upd: 0 });
check("6. 再実行: inserted=0/updated=0（idempotent）", totals.ins === 0 && totals.upd === 0);

// 4. batch-03モード（--since=切替時刻 → 残留分だけが対象になる）
const d3 = run("dry", ["--since=2026-08-17T00:00:00"]);
check("7. --since: 対象がsource 2行（both/late）に絞られskip済みで挿入0", d3.summary.ranking_leads.source === 2 && d3.summary.ranking_leads.inserted === 0,
  JSON.stringify(d3.summary.ranking_leads));

// 5. batch-03での継続更新（Codex修正2の核心）: batch-02でログ済みのstatsに、さらに新しい
//    last_updatedのデータが来たとき、版付きlogKeyのおかげでskipされずUPDATEされること
const payload3 = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
  model_service_stats: [
    { service_id: "freee", model_name: "claude", task_type: "T1", success_rate: 0.95, total_calls: 25, last_updated: "2026-08-18 06:00:00" },
  ] } };
writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(payload3)));
const b3 = run("apply", ["--batch=mig-believable-test-03"]);
const dbr3 = new Database(dbPath, { readonly: true });
const freee3 = dbr3.prepare("SELECT success_rate,total_calls,migration_batch_id FROM model_service_stats WHERE service_id='freee'").get();
dbr3.close();
check("8. batch-03: ログ済み自然キーでも新last_updatedはUPDATEされる（0.9→0.95）", b3.summary.model_service_stats.updated === 1 && freee3.success_rate === 0.95 && freee3.migration_batch_id === "mig-believable-test-03",
  JSON.stringify({ summary: b3.summary.model_service_stats, row: freee3 }));

rmSync(workDir, { recursive: true, force: true });
const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-migration-delta: ALL PASS" : "\n❌ smoke-migration-delta: FAILURES");
process.exit(all ? 0 : 1);
