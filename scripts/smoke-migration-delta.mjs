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
  CREATE TABLE outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT, agent_id_hash TEXT DEFAULT 'anonymous', success INTEGER,
    latency_ms INTEGER, error_type TEXT, workaround TEXT, context_masked TEXT, provenance TEXT, verification_status TEXT,
    attempt_id TEXT, recipe_id TEXT, recipe_version INTEGER, failed_step TEXT, created_at TEXT, is_retry INTEGER DEFAULT 0,
    estimated_users INTEGER, model_name TEXT, agent_type TEXT, task_type TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE service_events (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT, event_type TEXT, title TEXT,
    description TEXT, created_at TEXT, source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE inspections (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT, anomaly_type TEXT, severity TEXT, description TEXT,
    evidence TEXT, status TEXT, resolution TEXT, resolved_by TEXT, created_at TEXT, resolved_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE site_checks (id TEXT PRIMARY KEY, url TEXT, score INTEGER, grade TEXT, findings TEXT, raw_signals TEXT, ip_hash TEXT, created_at TEXT,
    source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE infrastructure_tips (id INTEGER PRIMARY KEY AUTOINCREMENT, tip_id TEXT UNIQUE NOT NULL, category TEXT, title TEXT, from_stack TEXT,
    to_stack TEXT, savings_pct INTEGER, confidence TEXT, conditions TEXT, evidence_url TEXT, evidence_summary TEXT, related_services TEXT,
    created_at TEXT, updated_at TEXT, source_system TEXT, migrated_at TEXT, migration_batch_id TEXT);
  CREATE TABLE execution_attempts (attempt_id TEXT PRIMARY KEY, service_id TEXT, recipe_id TEXT, recipe_version INTEGER, parent_attempt_id TEXT,
    status TEXT NOT NULL DEFAULT 'open', issued_at TEXT, expires_at TEXT, closed_at TEXT,
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
// canonical 独自の site_check（TEXT PK・12桁トークン）。source 側に同じ id で別内容の行を置いて衝突を試験する
db.prepare("INSERT INTO site_checks (id,url,score,grade,created_at) VALUES ('aaaaaaaaaaaa','https://own.example/',70,'A','2026-08-17 08:00:00')").run();
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
  agent_voice_responses: [], agent_feedback: [], service_events: [],
  inspections: [], infrastructure_tips: [], execution_attempts: [],
  site_checks: [
    { id: "bbbbbbbbbbbb", url: "https://new.example/", score: 50, grade: "B", created_at: "2026-08-18 01:00:00" },  // 新規・TEXT PK は id を保持して挿入されること
    // 同 URL・同秒の別チェック（別 id・別内容）。v1 の url|created_at キーはこれを「payload 内重複」として捨てた（C0 で実際に 1 行落ちた）
    { id: "cccccccccccc", url: "https://new.example/", score: 30, grade: "CCC", created_at: "2026-08-18 01:00:00" },
  ],
  // outcomes: 実在列。v1 は error_class/context/agent_id（存在しない）を参照し、service|created_at|success|model|task に縮退していた
  outcomes: [
    { service_id: "freee", agent_id_hash: "h1", success: 1, latency_ms: 120, provenance: "user_reported", created_at: "2026-08-18 02:00:00", model_name: "claude", task_type: "T1" },
    { service_id: "freee", agent_id_hash: "h2", success: 1, latency_ms: 120, provenance: "user_reported", created_at: "2026-08-18 02:00:00", model_name: "claude", task_type: "T1" }, // agent_id_hash だけ違う別報告
    { service_id: "freee", agent_id_hash: "h1", success: 1, latency_ms: 120, provenance: "user_reported", created_at: "2026-08-18 02:00:00", model_name: "claude", task_type: "T1" }, // 1 行目と完全同一＝重複
    { service_id: "mf", attempt_id: "att-x1", agent_id_hash: "h3", success: 0, error_type: "auth", provenance: "user_reported", created_at: "2026-08-18 03:00:00" },
    { service_id: "mf", attempt_id: "att-x2", agent_id_hash: "h3", success: 0, error_type: "auth", provenance: "user_reported", created_at: "2026-08-18 03:00:00" }, // attempt_id だけ違う別実行
  ],
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
check("2b. dry: site_checks 同 URL 同秒の別 id 2 件はどちらも挿入（v1 は 1 件捨てていた）", dry.summary.site_checks.inserted === 2 && dry.summary.site_checks.skippedDupInPayload === 0, JSON.stringify(dry.summary.site_checks));
check("2c. dry: outcomes は agent_id_hash 違い 2 件＋attempt_id 違い 2 件＝4 挿入・完全同一 1 件だけ重複", dry.summary.outcomes.inserted === 4 && dry.summary.outcomes.skippedDupInPayload === 1, JSON.stringify(dry.summary.outcomes));

// 2. apply
const ap = run("apply");
const dbr = new Database(dbPath, { readonly: true });
const leads = dbr.prepare("SELECT id,email,source_system FROM ranking_leads ORDER BY id").all();
check("3. apply: 挿入はid自動採番で衝突なし", ap.summary.ranking_leads.inserted === 2 && leads.length === 4 && new Set(leads.map((l) => l.id)).size === 4, JSON.stringify(leads.map((l) => `${l.id}:${l.email}`)));
const freee = dbr.prepare("SELECT success_rate,total_calls,migration_batch_id FROM model_service_stats WHERE service_id='freee'").get();
check("4. apply: statsのUPSERT反映（0.8→0.9・batch刻印）", freee.success_rate === 0.9 && freee.total_calls === 15 && freee.migration_batch_id === "mig-believable-test-02");
check("5. apply: both@b.jpは1行のまま（二重挿入なし）", dbr.prepare("SELECT COUNT(*) c FROM ranking_leads WHERE email='both@b.jp'").get().c === 1);
// TEXT PK（site_checks）: id を保持して挿入・NULL id ゼロ・既存 id との衝突は skip（C0 batch-02 事故の再発防止）
const sc = dbr.prepare("SELECT id,url,migration_batch_id FROM site_checks ORDER BY created_at").all();
check("5b. apply: site_checks TEXT PK は source の id を保持（bbbb…/cccc…）・NULL id なし", sc.some((r) => r.id === "bbbbbbbbbbbb") && sc.some((r) => r.id === "cccccccccccc") && sc.every((r) => r.id != null),
  JSON.stringify(sc.map((r) => `${r.id}:${r.url}`)));
check("5c. apply: canonical 独自の site_check（aaaa…）は無傷・合計 3 行", sc.find((r) => r.id === "aaaaaaaaaaaa")?.url === "https://own.example/" && sc.length === 3,
  JSON.stringify(ap.summary.site_checks));
const oc = dbr.prepare("SELECT agent_id_hash, attempt_id FROM outcomes ORDER BY id").all();
check("5d. apply: outcomes 4 行（h1/h2/att-x1/att-x2）・重複 1 件は migration_log に skipped_dup_in_payload で記録", oc.length === 4 && new Set(oc.map((r) => r.agent_id_hash + "|" + r.attempt_id)).size === 4
  && dbr.prepare("SELECT COUNT(*) c FROM migration_log WHERE table_name='outcomes' AND action='skipped_dup_in_payload'").get().c === 1, JSON.stringify(oc));
check("5e. migration_log の source_key は v2: 接頭辞（旧ログと分離）", dbr.prepare("SELECT COUNT(*) c FROM migration_log WHERE batch_id='mig-believable-test-02' AND source_key NOT LIKE 'v2:%'").get().c === 0);
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

// 6. NULL id 安全網: TEXT PK 表に id 無しの source 行が来たら表ごと ABORT する（dry でも検出）
const payload4 = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
  site_checks: [{ url: "https://noid.example/", created_at: "2026-08-19 00:00:00" }] } };
writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(payload4)));
let aborted = false, abortMsg = "";
try { run("dry", ["--batch=mig-believable-test-04"]); } catch (e) { aborted = true; abortMsg = String(e.stderr || e.message); }
check("9. NULL id 安全網: id 無し行は dry でも ABORT（exit≠0・メッセージに NULL id）", aborted && /NULL id/.test(abortMsg), abortMsg.trim().split(String.fromCharCode(10))[0].trim());

// 7. 異内容 ID 衝突 = batch 停止（skip しない）。apply でも DB は 1 行も変わらない
const snap = () => { const d = new Database(dbPath, { readonly: true });
  const o = { leads: d.prepare("SELECT COUNT(*) c FROM ranking_leads").get().c, sc: d.prepare("SELECT id,url FROM site_checks ORDER BY id").all(),
    log: d.prepare("SELECT COUNT(*) c FROM migration_log").get().c, b05: d.prepare("SELECT COUNT(*) c FROM migration_log WHERE batch_id='mig-believable-test-05'").get().c };
  d.close(); return JSON.stringify(o); };
const payload5 = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
  ranking_leads: [{ email: "should-not-land@e.jp", source: "webinar", created_at: "2026-08-19 01:00:00" }], // 他表の正常行も巻き戻ること
  site_checks: [
    { id: "dddddddddddd", url: "https://fresh.example/", score: 10, grade: "CCC", created_at: "2026-08-19 01:00:00" },   // 正常行（先に処理される）
    { id: "aaaaaaaaaaaa", url: "https://other.example/", score: 70, grade: "A", created_at: "2026-08-18 02:00:00" },     // 既存 id・内容が違う＝同一視できない衝突
  ] } };
writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(payload5)));
const tryRun = (mode) => { try { run(mode, ["--batch=mig-believable-test-05"]); return { aborted: false, msg: "" }; }
  catch (e) { return { aborted: true, msg: String(e.stderr || e.message) }; } };
const before5 = snap();
const d5 = tryRun("dry");
check("10. 同 id 別内容の衝突: dry で ABORT（exit≠0・identity … different content を明示）", d5.aborted && /identity .* exists with different content|id collision with different content/.test(d5.msg), d5.msg.trim().split(String.fromCharCode(10))[0]);
const a5 = tryRun("apply");
const after5 = snap();
check("11. 同 id 別内容の衝突: apply も ABORT し、同 batch の正常行（lead・site_check dddd…）も含め DB 無変更", a5.aborted && before5 === after5 && !after5.includes("dddddddddddd"),
  a5.aborted ? "unchanged=" + (before5 === after5) : "apply did not abort");

// 8. 同じ id・同じ自然キー（＝同内容）で migration_log に無い行は衝突扱いにしない（実データ照合で既存として skip）
const payload6 = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
  site_checks: [{ id: "aaaaaaaaaaaa", url: "https://own.example/", score: 70, grade: "A", created_at: "2026-08-17 08:00:00" }] } }; // canonical 独自行と同 id・同内容・未ログ
writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(payload6)));
const d6 = run("dry", ["--batch=mig-believable-test-06"]);
check("12. 同 id・同内容（未ログ）は停止せず skippedExisting（停止するのは内容が違う衝突だけ）", d6.summary.site_checks.skippedExisting === 1 && d6.summary.site_checks.inserted === 0 && d6.summary.site_checks.skippedLogged === 0,
  JSON.stringify(d6.summary.site_checks));

// 13. outcomes: 同じ attempt_id で内容が違う 2 行 → 実行識別子は同一視・内容不一致は停止（DB 無変更）
{
  const pl = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
    outcomes: [{ service_id: "mf", attempt_id: "att-x1", agent_id_hash: "h3", success: 1, provenance: "user_reported", created_at: "2026-08-18 03:00:00" }] } }; // 既存 att-x1 は success=0
  writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(pl)));
  const before = snap(); const r = tryRun("apply"); const after = snap();
  check("13. outcomes: 既存 attempt_id と内容が違う行は identity 不一致で ABORT・DB 無変更", r.aborted && /outcomes: identity .*att-x1.* different content/.test(r.msg) && before === after, r.msg.trim().split(String.fromCharCode(10))[0]);
}
// 14. payload 内で同 id・別内容の 2 行（同一性表）→ 停止
{
  const pl = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
    site_checks: [
      { id: "eeeeeeeeeeee", url: "https://e.example/", score: 10, grade: "CCC", created_at: "2026-08-20 00:00:00" },
      { id: "eeeeeeeeeeee", url: "https://e.example/", score: 90, grade: "AAA", created_at: "2026-08-20 00:00:00" },
    ] } };
  writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(pl)));
  const r = tryRun("dry");
  check("14. payload 内の同 id 別内容（site_checks）は skip せず ABORT", r.aborted && /two payload rows share identity/.test(r.msg), r.msg.trim().split(String.fromCharCode(10))[0]);
}
// 15. キー列の実在検証: canonical に無い列をキーが参照したら起動時に停止（v1 の縮退事故の再発防止）
{
  const d = new Database(dbPath); d.exec("ALTER TABLE outcomes DROP COLUMN agent_id_hash"); d.close();
  const pl = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])) } };
  writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(pl)));
  const r = tryRun("dry");
  check("15. キー列が実スキーマに無い → 'key references unknown column' で ABORT", r.aborted && /outcomes: key references unknown column\(s\) agent_id_hash/.test(r.msg), r.msg.trim().split(String.fromCharCode(10))[0]);
  const d2 = new Database(dbPath); d2.exec("ALTER TABLE outcomes ADD COLUMN agent_id_hash TEXT DEFAULT 'anonymous'"); d2.prepare("UPDATE outcomes SET agent_id_hash = CASE WHEN attempt_id IS NULL THEN CASE id WHEN 1 THEN 'h1' ELSE 'h2' END ELSE 'h3' END").run(); d2.close();
}
// 16. recheck（読取専用）: 旧 DB 相当の payload と canonical を再照合し、取りこぼし・内容不一致・重複を列挙する
{
  const d = new Database(dbPath);
  d.prepare("DELETE FROM site_checks WHERE id='cccccccccccc'").run();                       // 取りこぼしを再現
  d.prepare("INSERT INTO execution_attempts (attempt_id,status,issued_at) VALUES ('att1','closed','2026-08-10 00:00:00')").run(); // 旧 DB と内容が違う行を再現（旧 DB 側は open）
  d.close();
  const pl = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
    site_checks: [
      { id: "bbbbbbbbbbbb", url: "https://new.example/", score: 50, grade: "B", created_at: "2026-08-18 01:00:00" },
      { id: "cccccccccccc", url: "https://new.example/", score: 30, grade: "CCC", created_at: "2026-08-18 01:00:00" },
      { id: "ffffffffffff", url: "https://later.example/", score: 40, grade: "BB", created_at: "2026-09-01 00:00:00" }, // cutoff 後の新規
    ],
    execution_attempts: [{ attempt_id: "att1", status: "open", issued_at: "2026-08-10 00:00:00" }],
  } };
  writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(pl)));
  const before = snap();
  const out = run("recheck", ["--cutoff=2026-08-20T00:00:00"]);
  const after = snap();
  check("16a. recheck: site_checks の取りこぼし 1 件（cutoff 前）＋cutoff 後の新規 1 件を分けて報告", out.summary.site_checks.missing === 2 && out.summary.site_checks.missing_before_cutoff === 1 && out.summary.site_checks.missing_rows.some((m) => m.id === "cccccccccccc" && m.before_cutoff === true),
    JSON.stringify({ missing: out.summary.site_checks.missing_rows.map((m) => [m.id, m.before_cutoff]) }));
  check("16b. recheck: attempts の内容不一致 1 件（status）を報告し、DB は無変更", out.summary.execution_attempts.content_mismatch === 1 && out.summary.execution_attempts.mismatch_rows[0].differing.includes("status") && before === after,
    JSON.stringify(out.summary.execution_attempts.mismatch_rows));
  check("16c. recheck: 合計（missing 2・before_cutoff 1・mismatch 1）", out.totals.missing === 2 && out.totals.missing_before_cutoff === 1 && out.totals.mismatch === 1, JSON.stringify(out.totals));
}
// 17. 旧 migration_log（v1 キーの skipped_existing）は v2 キーの再回収を妨げない
{
  const d = new Database(dbPath);
  // v1 の url|created_at キーで skipped_existing と記録された行（C0 で実際に落ちた形）。v2 では別キーになるので妨げない
  d.prepare("INSERT OR IGNORE INTO migration_log (batch_id,source_system,table_name,source_key,new_rowid,action) VALUES ('mig-believable-20260916-02','believable-vibrancy','site_checks','site|https://own.example/|2026-08-17 08:00:00',1,'skipped_existing')").run();
  d.close();
  const pl = { schemas: {}, rows: { ...Object.fromEntries(Object.keys(payload.rows).map((t) => [t, []])),
    site_checks: [{ id: "gggggggggggg", url: "https://own.example/", score: 20, grade: "CCC", created_at: "2026-08-17 08:00:00" }] } }; // 同 URL 同秒の別チェック
  writeFileSync(payloadPath, zlib.gzipSync(JSON.stringify(pl)));
  const r = run("apply", ["--batch=mig-believable-test-07-recheck"]);
  check("17. 旧 v1 キーの skipped_existing ログがあっても、v2 キーの再回収は skippedLogged にならず挿入される", r.summary.site_checks.inserted === 1 && r.summary.site_checks.skippedLogged === 0, JSON.stringify(r.summary.site_checks));
}

rmSync(workDir, { recursive: true, force: true });
const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-migration-delta: ALL PASS" : "\n❌ smoke-migration-delta: FAILURES");
process.exit(all ? 0 : 1);
