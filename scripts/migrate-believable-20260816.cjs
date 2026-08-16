// 双子統合 Step4-5: believable→canonical 選択移行スクリプト
// 実行: node /tmp/merge.js dry|apply  （canonicalコンテナ内・payload=/tmp/migrate-payload.json.gz）
const D = require("better-sqlite3");
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");

const MODE = process.argv[2];
if (!["dry", "apply"].includes(MODE)) { console.error("usage: node merge.js dry|apply"); process.exit(2); }
const BATCH = "mig-believable-20260816-01";
const SOURCE = "believable-vibrancy";
const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync("/tmp/migrate-payload.json.gz")).toString());

const db = new D(process.env.KANSEI_DB_PATH || "/data/kansei-link.db");
db.pragma("foreign_keys = OFF");

// 対象と方式: preserveId=正規側が空である前提でid保持 / voicesは自然キー重複排除+id自動採番
const TABLES = [
  { name: "ranking_leads", preserveId: true },
  { name: "subscriptions", preserveId: true },
  { name: "agent_feedback", preserveId: true },
  { name: "outcomes", preserveId: true },
  { name: "model_service_stats", preserveId: true, sourceKey: (r) => [r.service_id, r.model_name, r.task_type].join("|") },
  { name: "inspections", preserveId: true },
  { name: "site_checks", preserveId: true },
  { name: "infrastructure_tips", preserveId: true },
  { name: "execution_attempts", preserveId: true, sourceKey: (r) => r.attempt_id },
  { name: "service_events", preserveId: true },
  { name: "agent_voice_responses", preserveId: false,
    // シードは環境ごとにタイムスタンプが異なるため内容ベースで重複判定（実測: 207件=シード一致 / 21件オーガニック）
    dupKey: (r) => [r.service_id, r.agent_type, r.question_id, r.response_choice, crypto.createHash("sha1").update(String(r.response_text || "")).digest("hex").slice(0, 12)].join("|") },
];

// 旧スキーマ(source_rowid INTEGER)の空テーブルが残っていたら作り直す（監査行があれば触らない）
const mlExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration_log'`).get();
if (mlExists) {
  const mlCols = db.prepare(`PRAGMA table_info(migration_log)`).all().map((c) => c.name);
  const mlCount = db.prepare(`SELECT COUNT(*) c FROM migration_log`).get().c;
  if (!mlCols.includes("source_key") && mlCount === 0) db.exec(`DROP TABLE migration_log`);
  else if (!mlCols.includes("source_key")) throw new Error("migration_log has rows with old schema — manual review needed");
}
db.exec(`CREATE TABLE IF NOT EXISTS migration_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL, source_system TEXT NOT NULL, table_name TEXT NOT NULL,
  source_key TEXT NOT NULL, new_rowid INTEGER, action TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_system, table_name, source_key))`);

const summary = {};
const tx = db.transaction(() => {
  for (const t of TABLES) {
    const rows = payload.rows[t.name] || [];
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name);
    for (const tag of ["source_system", "migrated_at", "migration_batch_id"]) {
      if (!cols.includes(tag)) { db.exec(`ALTER TABLE ${t.name} ADD COLUMN ${tag} TEXT`); cols.push(tag); }
    }
    // 「空である」前提の検証（preserveId表のみ・移行済み行は除いて数える）
    if (t.preserveId) {
      const pre = db.prepare(`SELECT COUNT(*) c FROM ${t.name} WHERE source_system IS NULL OR source_system != ?`).get(SOURCE).c;
      if (pre > 0) throw new Error(`${t.name}: expected empty canonical table but found ${pre} non-migrated rows — aborting (id collision risk)`);
    }
    const keyOf = t.sourceKey || ((r) => String(r.id));
    const logged = new Set(db.prepare(`SELECT source_key FROM migration_log WHERE source_system=? AND table_name=?`).all(SOURCE, t.name).map((r) => r.source_key));
    // voices重複排除用: 正規側既存の自然キー集合
    let existingKeys = null;
    if (t.dupKey) existingKeys = new Set(db.prepare(`SELECT * FROM ${t.name}`).all().map(t.dupKey));
    const logIns = db.prepare(`INSERT INTO migration_log(batch_id,source_system,table_name,source_key,new_rowid,action) VALUES (?,?,?,?,?,?)`);
    let inserted = 0, skippedLogged = 0, skippedDup = 0;
    for (const row of rows) {
      if (logged.has(keyOf(row))) { skippedLogged++; continue; }
      if (existingKeys && existingKeys.has(t.dupKey(row))) { logIns.run(BATCH, SOURCE, t.name, keyOf(row), null, "skipped_duplicate"); skippedDup++; continue; }
      const r = { ...row, source_system: SOURCE, migrated_at: new Date().toISOString(), migration_batch_id: BATCH };
      if (!t.preserveId) delete r.id;
      const useCols = Object.keys(r).filter((c) => cols.includes(c));
      const missing = Object.keys(r).filter((c) => !cols.includes(c) && c !== "id");
      if (missing.length) throw new Error(`${t.name}: payload columns missing on canonical: ${missing.join(",")}`);
      const info = db.prepare(`INSERT INTO ${t.name} (${useCols.join(",")}) VALUES (${useCols.map(() => "?").join(",")})`)
        .run(...useCols.map((c) => r[c]));
      logIns.run(BATCH, SOURCE, t.name, keyOf(row), info.lastInsertRowid, "inserted");
      inserted++;
    }
    summary[t.name] = { source: rows.length, inserted, skippedLogged, skippedDup };
  }
  if (MODE === "dry") throw new Error("__DRY_RUN_ROLLBACK__");
});

try { tx(); } catch (e) {
  if (e.message !== "__DRY_RUN_ROLLBACK__") { console.error("ABORTED:", e.message); process.exit(1); }
}
console.log(JSON.stringify({ mode: MODE, batch: BATCH, summary }, null, 1));
if (MODE === "apply") {
  const post = {};
  for (const t of TABLES) post[t.name] = db.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get().c;
  post.migration_log = db.prepare(`SELECT action, COUNT(*) c FROM migration_log WHERE batch_id=? GROUP BY action`).all(BATCH);
  console.log("POST_COUNTS=" + JSON.stringify(post));
}
