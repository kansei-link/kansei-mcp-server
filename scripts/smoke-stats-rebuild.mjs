#!/usr/bin/env node
/**
 * P0 #39 residue: service_stats rebuild v1 の検証（Codex 8/16設計・必須9テスト）
 *
 * 方針の検証対象: 値/閾値による推測削除ゼロ・provenance再集計・旧値隔離・冪等・
 * 監査ログ・隔離テーブルの不可視性・telemetry後の正常更新・in-place upgrade。
 *
 *   node scripts/smoke-stats-rebuild.mjs        … LOCAL+CENTRAL 両プロファイル
 *
 * 前提: npm run build 済み（dist/db/schema.js, dist/tools/report-outcome.js を実行）。
 * 本番DB・Railwayには一切触れない（一時DBのみ）。
 */
import { readFileSync, rmSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, "..");
const TMP = mkdtempSync(join(tmpdir(), "kansei-stats-rebuild-"));
process.on("exit", () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const { default: Database } = await import("better-sqlite3");
const { initializeDb } = await import(`file://${join(ROOT, "dist", "db", "schema.js").replace(/\\/g, "/")}`);
const { reportOutcome } = await import(`file://${join(ROOT, "dist", "tools", "report-outcome.js").replace(/\\/g, "/")}`);
const { seedDatabase } = await import(`file://${join(ROOT, "dist", "db", "seed.js").replace(/\\/g, "/")}`);

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const svc = (db, id) => db.prepare("INSERT OR IGNORE INTO services (id, name) VALUES (?, ?)").run(id, id.toUpperCase());
const statsRow = (db, id) => db.prepare("SELECT * FROM service_stats WHERE service_id = ?").get(id);

function insertOutcome(db, o) {
  db.prepare(
    `INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, model_name, task_type, provenance, verification_status, attempt_id, created_at)
     VALUES (@service_id, @agent, @success, @latency, @model, @task, @provenance, @vstatus, @attempt, datetime('now', '-1 day'))`
  ).run({
    service_id: o.svc,
    agent: o.agent ?? "anonymous",
    success: o.success ? 1 : 0,
    latency: "latency" in o ? o.latency : 500,
    model: o.model ?? "claude",
    task: o.task ?? "invoice",
    provenance: o.provenance,
    vstatus: o.vstatus ?? "unverified",
    attempt: o.attempt ?? null,
  });
}

/** 汚染済みv1.2.0相当のservice_stats行を直接注入（旧seed backfill/旧blend相当） */
function contaminate(db, id, calls, rate) {
  db.prepare(
    "INSERT INTO service_stats (service_id, total_calls, success_rate, avg_latency_ms, unique_agents, last_updated) VALUES (?, ?, ?, 700, 3, datetime('now'))"
  ).run(id, calls, rate);
}

// ═══════════════ LOCAL プロファイル（stdio MCP相当・素のDB） ═══════════════
console.log("[LOCAL] provenance別の再集計");
{
  const db = new Database(join(TMP, "local.db"));
  initializeDb(db); // 初回: 空のservice_statsに対してmigrationが走る（marker記録）

  // markerを消して「v1.2.0相当の汚染DB → v1.2.2候補へのin-place upgrade」を再現
  db.prepare("DELETE FROM schema_migrations WHERE migration_id='service_stats_rebuild_v1'").run();
  db.prepare("DELETE FROM migration_audit WHERE migration_id='service_stats_rebuild_v1'").run();
  db.exec("DROP TABLE IF EXISTS service_stats_quarantine");

  for (const s of ["svc-synth", "svc-verified", "svc-mixed", "svc-legacy", "svc-userrep"]) svc(db, s);

  // 1) syntheticのみ + 汚染stats行
  for (let i = 0; i < 5; i++) insertOutcome(db, { svc: "svc-synth", provenance: "synthetic", success: true });
  contaminate(db, "svc-synth", 5, 1.0);

  // 2) verified (kansei_measured, assertion_verified, N=6, 4成功) のみ
  for (let i = 0; i < 6; i++)
    insertOutcome(db, { svc: "svc-verified", provenance: "kansei_measured", vstatus: "assertion_verified", success: i < 4, agent: "measure-1" });
  contaminate(db, "svc-verified", 99, 0.01); // 旧値はデタラメ=再集計で置換されるべき

  // 3) 混在: synthetic 5 + verified 6 (5成功)
  for (let i = 0; i < 5; i++) insertOutcome(db, { svc: "svc-mixed", provenance: "synthetic", success: false });
  for (let i = 0; i < 6; i++)
    insertOutcome(db, { svc: "svc-mixed", provenance: "kansei_measured", vstatus: "assertion_verified", success: i < 5, agent: "measure-1" });
  contaminate(db, "svc-mixed", 11, 0.2);

  // 4) legacy_unknown のみ
  for (let i = 0; i < 8; i++) insertOutcome(db, { svc: "svc-legacy", provenance: "legacy_unknown", success: true });
  contaminate(db, "svc-legacy", 8, 0.9);

  // 5) user_reported 未検証（closed attemptなし）のみ
  for (let i = 0; i < 10; i++) insertOutcome(db, { svc: "svc-userrep", provenance: "user_reported", success: true });
  contaminate(db, "svc-userrep", 10, 0.95);

  initializeDb(db); // ← in-place upgrade（migration実走）

  const synth = statsRow(db, "svc-synth");
  check("1. syntheticのみ → データなし（行なし・0%でない）", synth === undefined);
  check("9a. in-place upgradeで汚染値(100%×5)が消える", synth === undefined);

  const ver = statsRow(db, "svc-verified");
  check(
    "2. verifiedのみ → 正しい再集計値 (6件・4/6成功)",
    ver && ver.total_calls === 6 && Math.abs(ver.success_rate - 4 / 6) < 1e-9,
    JSON.stringify(ver)
  );

  const mixed = statsRow(db, "svc-mixed");
  check(
    "3. 混在 → verifiedだけで再集計 (6件・5/6成功。synthetic 5件は不算入)",
    mixed && mixed.total_calls === 6 && Math.abs(mixed.success_rate - 5 / 6) < 1e-9,
    JSON.stringify(mixed)
  );

  check("4. legacy_unknown → 除外（行なし）", statsRow(db, "svc-legacy") === undefined);
  check("5. user_reported未検証 → 除外（行なし）", statsRow(db, "svc-userrep") === undefined);

  // 隔離テーブル: 旧値が証拠として残る
  const q = db.prepare("SELECT * FROM service_stats_quarantine WHERE service_id='svc-synth'").get();
  check("旧値は隔離テーブルに退避（synthの100%×5が証拠保全）", q && q.total_calls === 5 && q.success_rate === 1.0);

  // 6) 冪等: 2回目のinitializeDb → 同一結果・audit重複なし
  const snapshot1 = JSON.stringify(db.prepare("SELECT * FROM service_stats ORDER BY service_id").all());
  const audit1 = db.prepare("SELECT COUNT(*) c FROM migration_audit WHERE migration_id='service_stats_rebuild_v1'").get().c;
  initializeDb(db);
  const snapshot2 = JSON.stringify(db.prepare("SELECT * FROM service_stats ORDER BY service_id").all());
  const audit2 = db.prepare("SELECT COUNT(*) c FROM migration_audit WHERE migration_id='service_stats_rebuild_v1'").get().c;
  check("6. migration二回実行 → service_stats同一", snapshot1 === snapshot2);
  check("6b. 二回目はaudit行が増えない（冪等マーカー有効）", audit1 === 5 && audit2 === 5, `audit1=${audit1} audit2=${audit2}`);

  // 8) 監査ログ: PIIなしの件数記録
  const metrics = db.prepare("SELECT metric, value FROM migration_audit WHERE migration_id='service_stats_rebuild_v1' ORDER BY metric").all();
  const names = metrics.map((m) => m.metric).join(",");
  check(
    "監査ログ: before/after/quarantined件数が記録（数値のみ・PIIなし）",
    names === "after_nonzero_rows,after_rows,before_nonzero_rows,before_rows,quarantined_rows",
    names
  );

  // 8) telemetry受信後の更新（実コードのreportOutcomeで）
  const res = reportOutcome(db, { service_id: "svc-mixed", success: true, latency_ms: 300 });
  const after = statsRow(db, "svc-mixed");
  check(
    "8. telemetry受信後 → 新統計へ正しく更新（verified6+新規1=7件。synthetic 5件は復活しない）",
    res && after && after.total_calls === 7 && Math.abs(after.success_rate - 6 / 7) < 1e-9,
    JSON.stringify(after)
  );
  const resNew = reportOutcome(db, { service_id: "svc-userrep", success: false, latency_ms: 200 });
  const afterNew = statsRow(db, "svc-userrep");
  check(
    "8b. データなしserviceへの新規telemetry → 行が生まれ、値はuser_reported+kansei_measuredのみ由来",
    resNew && afterNew && afterNew.total_calls === 11,
    JSON.stringify(afterNew)
  );

  // P2-2a: marker削除+quarantine温存 → INSERT OR IGNOREが旧証拠を上書きしない
  db.prepare("DELETE FROM schema_migrations WHERE migration_id='service_stats_rebuild_v1'").run();
  db.prepare("UPDATE service_stats SET total_calls=777 WHERE service_id='svc-verified'").run();
  initializeDb(db);
  const qKept = db.prepare("SELECT total_calls, success_rate FROM service_stats_quarantine WHERE service_id='svc-synth'").get();
  check("P2-2a. 再実行時もquarantineの旧証拠は上書きされない (synth=5件/100%のまま)", qKept && qKept.total_calls === 5 && qKept.success_rate === 1.0, JSON.stringify(qKept));

  db.close();
}

// ═══════════════ P1-1: 本番起動シーケンス（initializeDb→seedDatabase）込みの不変条件 ═══════════════
console.log("[SEED] seedDatabase込みの本番起動シーケンス");
{
  const db = new Database(join(TMP, "seedseq.db"));
  initializeDb(db);
  db.prepare("DELETE FROM schema_migrations WHERE migration_id='service_stats_rebuild_v1'").run();
  db.prepare("DELETE FROM migration_audit").run();
  db.exec("DROP TABLE IF EXISTS service_stats_quarantine");
  svc(db, "svc-seedseq-verified");
  for (let i = 0; i < 6; i++)
    insertOutcome(db, { svc: "svc-seedseq-verified", provenance: "kansei_measured", vstatus: "assertion_verified", success: i < 3, agent: "m1" });
  svc(db, "svc-seedseq-synth");
  for (let i = 0; i < 5; i++) insertOutcome(db, { svc: "svc-seedseq-synth", provenance: "synthetic", success: true });
  contaminate(db, "svc-seedseq-synth", 5, 1.0);

  initializeDb(db);
  seedDatabase(db); // 本番はこの順で毎起動実行される

  const ver = statsRow(db, "svc-seedseq-verified");
  check("P1-1a. seedDatabase後もrebuild値が保持される (6件/50%)", ver && ver.total_calls === 6 && Math.abs(ver.success_rate - 0.5) < 1e-9, JSON.stringify(ver));
  const zeroRows = db.prepare("SELECT COUNT(*) c FROM service_stats WHERE total_calls = 0").get().c;
  check("C1. seedDatabaseは空placeholder行を一切作らない（正本設計=行なし・Codex最終条件）", zeroRows === 0, `zero rows=${zeroRows}`);
  const totalRows = db.prepare("SELECT COUNT(*) c FROM service_stats").get().c;
  const svcCount = db.prepare("SELECT COUNT(*) c FROM services").get().c;
  check("C1b. clean DB: サービス11,000件超・service_statsは信頼可能な1行のみ", svcCount > 11000 && totalRows === 1, `services=${svcCount} stats=${totalRows}`);
  const aggVoices = db.prepare("SELECT COUNT(*) c FROM agent_voice_responses WHERE agent_type='aggregated'").get().c;
  check("P1-1d. seedDatabaseはaggregated voicesを一切注入しない（loader削除確認）", aggVoices === 0);
  const synthAfterSeed = statsRow(db, "svc-seedseq-synth");
  check("P1-1e/C2. 信頼できるoutcomeなし（syntheticのみ）→ 行なし＝データなし", synthAfterSeed === undefined);

  // C7. reader視点: 行なしのserviceはLEFT JOINでNULL（0%ではない）
  const joined = db
    .prepare("SELECT s.id, ss.total_calls AS tc, ss.success_rate AS sr FROM services s LEFT JOIN service_stats ss ON s.id = ss.service_id WHERE s.id = 'svc-seedseq-synth'")
    .get();
  check("C7. 検索/tips/insightsのLEFT JOIN経路 → NULL（データなし）として見える", joined && joined.tc === null && joined.sr === null, JSON.stringify(joined));

  db.close();
}

// ═══════════════ Codex最終条件: placeholder cleanup migration ═══════════════
console.log("[CLEANUP] service_stats_placeholder_cleanup_v1");
{
  const db = new Database(join(TMP, "cleanup.db"));
  initializeDb(db); // 両マーカーが付く
  db.prepare("DELETE FROM schema_migrations WHERE migration_id='service_stats_placeholder_cleanup_v1'").run();
  db.prepare("DELETE FROM migration_audit WHERE migration_id='service_stats_placeholder_cleanup_v1'").run();

  for (const s of ["svc-ph-1", "svc-ph-2", "svc-ph-3", "svc-zero-measured", "svc-rebuilt"]) svc(db, s);
  // 旧seed相当の空placeholder 3行
  for (const s of ["svc-ph-1", "svc-ph-2", "svc-ph-3"])
    db.prepare("INSERT INTO service_stats (service_id) VALUES (?)").run(s);
  // verified「実測0%」相当（total_calls>0）と再構築済み行
  db.prepare("INSERT INTO service_stats (service_id, total_calls, success_rate, avg_latency_ms, unique_agents) VALUES ('svc-zero-measured', 5, 0, 0, 1)").run();
  db.prepare("INSERT INTO service_stats (service_id, total_calls, success_rate, avg_latency_ms, unique_agents) VALUES ('svc-rebuilt', 12, 0.75, 340, 3)").run();
  // quarantine不変の検証準備
  db.exec("CREATE TABLE IF NOT EXISTS service_stats_quarantine (service_id TEXT PRIMARY KEY, total_calls INTEGER, success_rate REAL, avg_latency_ms REAL, unique_agents INTEGER, last_updated TEXT, quarantined_at TEXT DEFAULT (datetime('now')))");
  db.prepare("INSERT OR IGNORE INTO service_stats_quarantine (service_id, total_calls, success_rate) VALUES ('svc-q', 9, 0.5)").run();
  const qBefore = db.prepare("SELECT COUNT(*) c FROM service_stats_quarantine").get().c;

  initializeDb(db); // cleanup実走

  check("C5. 空placeholder 3行のみ削除", db.prepare("SELECT COUNT(*) c FROM service_stats WHERE service_id LIKE 'svc-ph-%'").get().c === 0);
  const zm = statsRow(db, "svc-zero-measured");
  check("C3. verified失敗群の「実測0%」(total_calls=5, rate=0) は絶対に削除されない", zm && zm.total_calls === 5 && zm.success_rate === 0, JSON.stringify(zm));
  check("C5b. 実測値のある行は保持 (12件/75%)", statsRow(db, "svc-rebuilt")?.total_calls === 12);
  const auditRows = db.prepare("SELECT metric, value FROM migration_audit WHERE migration_id='service_stats_placeholder_cleanup_v1' ORDER BY metric").all();
  check("監査: before/deleted/afterが記録 (deleted=3)", auditRows.find((r) => r.metric === "deleted_placeholder_rows")?.value === 3, JSON.stringify(auditRows));

  // C6. 二回実行で同一・audit非重複
  const snap1 = JSON.stringify(db.prepare("SELECT * FROM service_stats ORDER BY service_id").all());
  initializeDb(db);
  const snap2 = JSON.stringify(db.prepare("SELECT * FROM service_stats ORDER BY service_id").all());
  const auditCount2 = db.prepare("SELECT COUNT(*) c FROM migration_audit WHERE migration_id='service_stats_placeholder_cleanup_v1'").get().c;
  check("C6. migration二回実行 → 同一結果・audit非重複", snap1 === snap2 && auditCount2 === 3, `audit=${auditCount2}`);

  // C8. quarantineは変更しない
  check("C8. quarantine行数は不変", db.prepare("SELECT COUNT(*) c FROM service_stats_quarantine").get().c === qBefore);

  // C4. report-outcome初回実行 → 行が新規作成される（行なし状態から）
  svc(db, "svc-fresh-report");
  reportOutcome(db, { service_id: "svc-fresh-report", success: true, latency_ms: 100 });
  const fresh = statsRow(db, "svc-fresh-report");
  check("C4. report-outcome初回 → 行が新規作成 (1件/100%)", fresh && fresh.total_calls === 1 && fresh.success_rate === 1, JSON.stringify(fresh));

  db.close();
}

// ═══════════════ P2-2b/c: エッジ — verified全失敗群・latency全NULL ═══════════════
console.log("[EDGE] 全失敗群・NULL latency");
{
  const db = new Database(join(TMP, "edge.db"));
  initializeDb(db);
  db.prepare("DELETE FROM schema_migrations WHERE migration_id='service_stats_rebuild_v1'").run();
  db.exec("DROP TABLE IF EXISTS service_stats_quarantine");
  svc(db, "svc-allfail");
  for (let i = 0; i < 5; i++)
    insertOutcome(db, { svc: "svc-allfail", provenance: "kansei_measured", vstatus: "assertion_verified", success: false, latency: null, agent: "m1" });
  initializeDb(db);
  const af = statsRow(db, "svc-allfail");
  check(
    "P2-2b. verified全失敗群 → 0%は「実測された0%」として行あり (5件/0%)・データなしと区別",
    af && af.total_calls === 5 && af.success_rate === 0,
    JSON.stringify(af)
  );
  check("P2-2c. latency全NULL → COALESCEで0（NULL/NaN混入なし）", af && af.avg_latency_ms === 0);
  db.close();
}

// ═══════════════ CENTRAL プロファイル（Railway http-server相当） ═══════════════
console.log("[CENTRAL] 中央DB相当（telemetry/attempts/subscriptions併存 + publishable user_reported群）");
{
  const db = new Database(join(TMP, "central.db"));
  initializeDb(db);
  db.prepare("DELETE FROM schema_migrations WHERE migration_id='service_stats_rebuild_v1'").run();
  db.prepare("DELETE FROM migration_audit WHERE migration_id='service_stats_rebuild_v1'").run();
  db.exec("DROP TABLE IF EXISTS service_stats_quarantine");

  // 中央特有のテーブルにデータが存在する状態を再現
  db.prepare("INSERT OR IGNORE INTO subscriptions (email, stripe_customer_id, status, tier) VALUES ('t@example.com','cus_x','active','pro')").run();

  svc(db, "svc-central-mixed");
  svc(db, "svc-central-comm");

  // v1.2.0 fixture相当の汚染行を大量注入（seed backfill再現）
  for (let i = 1; i <= 50; i++) {
    svc(db, `svc-bulk-${i}`);
    contaminate(db, `svc-bulk-${i}`, 1 + (i % 20), ((i * 37) % 101) / 100);
  }

  // 公開条件を満たすuser_reported群: N=50・distinct agents≥5・closed attempts・
  // kansei_measured検証済みbaseline N≥5（同task）
  for (let i = 0; i < 6; i++)
    insertOutcome(db, { svc: "svc-central-comm", provenance: "kansei_measured", vstatus: "assertion_verified", success: i < 5, agent: "measure-1", task: "general", model: "claude" });
  for (let i = 0; i < 50; i++) {
    const attempt = `att-${i}`;
    db.prepare("INSERT INTO execution_attempts (attempt_id, service_id, status, closed_at) VALUES (?, ?, 'closed', datetime('now'))").run(attempt, "svc-central-comm");
    insertOutcome(db, { svc: "svc-central-comm", provenance: "user_reported", success: i < 40, agent: `agent-${i % 5}`, attempt, task: "general", model: "claude" });
  }
  contaminate(db, "svc-central-comm", 999, 0.5);

  // 混在: synthetic + 未検証user_reported のみ → データなしになるべき
  for (let i = 0; i < 4; i++) insertOutcome(db, { svc: "svc-central-mixed", provenance: "synthetic", success: true });
  for (let i = 0; i < 3; i++) insertOutcome(db, { svc: "svc-central-mixed", provenance: "user_reported", success: true });
  contaminate(db, "svc-central-mixed", 7, 1.0);

  initializeDb(db); // in-place upgrade

  const bulkLeft = db.prepare("SELECT COUNT(*) c FROM service_stats WHERE service_id LIKE 'svc-bulk-%'").get().c;
  check("9b. v1.2.0相当の汚染50行 → 全て隔離・service_statsから消滅", bulkLeft === 0);
  const bulkQ = db.prepare("SELECT COUNT(*) c FROM service_stats_quarantine WHERE service_id LIKE 'svc-bulk-%'").get().c;
  check("9c. 隔離テーブルに50行とも証拠保全", bulkQ === 50);

  const comm = statsRow(db, "svc-central-comm");
  check(
    "公開条件を満たすuser_reported群+検証baseline → 再投入 (56件)",
    comm && comm.total_calls === 56,
    JSON.stringify(comm)
  );
  check("synthetic+未検証user_reportedのみ → データなし", statsRow(db, "svc-central-mixed") === undefined);

  // 7) 隔離テーブルの不可視性（DB層）: viewからの参照ゼロ
  const viewRefs = db
    .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='view' AND sql LIKE '%service_stats_quarantine%'")
    .get().c;
  check("7a. どのviewもquarantineを参照しない", viewRefs === 0);

  db.close();
}

// ═══════════════ 7) 隔離テーブルの不可視性（コード層・静的走査） ═══════════════
console.log("[STATIC] quarantine参照の全数走査");
{
  const offenders = [];
  const scan = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (/node_modules|\.git|dist/.test(f)) continue;
        scan(p);
      } else if (/\.(ts|mts|mjs|cjs|js)$/.test(f)) {
        const text = readFileSync(p, "utf8");
        if (text.includes("service_stats_quarantine")) offenders.push(p.slice(ROOT.length + 1));
        // P2-1: raw model_service_stats の読み取り（publishable viewバイパス）も禁止
        if (/(FROM|JOIN)\s+model_service_stats\b/i.test(text)) rawModelReads.push(p.slice(ROOT.length + 1));
      }
    }
  };
  const rawModelReads = [];
  scan(join(ROOT, "src"));
  const bad = offenders.map((o) => o.replace(/\\/g, "/")).filter((o) => o !== "src/db/schema.ts");
  check(
    "7b. src内でquarantineを参照するのはschema.ts(migration本体)のみ — API/検索/ARI/tips/insightsから参照不能",
    bad.length === 0,
    bad.join(", ")
  );
  check(
    "7c. raw model_service_stats を読むコードなし（読みは全てpublishable view経由・P2-1）",
    rawModelReads.length === 0,
    rawModelReads.join(", ")
  );
}

console.log(`\n=== smoke-stats-rebuild: ${pass} passed, ${fail} failed ===`);
if (fail) {
  failures.forEach((f) => console.error("  FAILED:", f));
  process.exit(1);
}
