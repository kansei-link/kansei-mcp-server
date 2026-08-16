// 双子統合 Phase C0/C2: believable→canonical 差分移行（batch-02/03共用）
//
// batch-01 (migrate-believable-20260816.cjs) との違い＝Codexレビュー反映:
//   1. 「canonical側が空」前提を撤廃 — 切替後にcanonicalへ新規行が入っていても動く
//   2. 全テーブルでid非保持・自然キー挿入 — believable/canonical双方の新規AUTOINCREMENT
//      idが衝突しても安全
//   3. 重複判定は migration_log だけでなく「canonical実データの自然キー」に対しても行う
//      — canonical側で独自に生まれた同内容行を二重挿入しない
//   4. model_service_stats は挿入でなくUPSERT — source側 last_updated が新しい場合のみ
//      数値を更新（batch-01の「記録済みはskip」では更新が落ちる問題の解消）
//   5. subscriptions は対象外 — Stripe APIを正本として sync-subscriptions-from-stripe.mjs
//      で再同期する（DB行コピーでは状態が古い）
//   6. --since=<ISO> でsource抽出を絞れる（batch-03: 切替時刻以降の残留のみ）
//
// 実行: NODE_PATH=/app/node_modules node migrate-believable-delta.cjs <dry|apply> \
//         --batch=mig-believable-YYYYMMDD-NN [--since=2026-08-16T12:00:00] \
//         [--payload=/tmp/migrate-payload.json.gz] [--db=/data/kansei-link.db]
// payloadは batch-01 と同形式（{schemas:{}, rows:{table:[...]}}）。

const D = require("better-sqlite3");
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");

const MODE = process.argv[2];
if (!["dry", "apply"].includes(MODE)) { console.error("usage: node migrate-believable-delta.cjs dry|apply --batch=... [--since=ISO] [--payload=path] [--db=path]"); process.exit(2); }
// 同名フラグは後勝ち（CLI慣例・呼び出し側のデフォルト上書きを許す）
const arg = (name, dflt) => { const m = [...process.argv].reverse().find((a) => a.startsWith(`--${name}=`)); return m ? m.slice(name.length + 3) : dflt; };
const BATCH = arg("batch", null);
if (!BATCH) { console.error("--batch=mig-believable-YYYYMMDD-NN is required"); process.exit(2); }
const SINCE = arg("since", null);
const PAYLOAD_PATH = arg("payload", "/tmp/migrate-payload.json.gz");
const DB_PATH = arg("db", process.env.KANSEI_DB_PATH || "/data/kansei-link.db");
const SOURCE = "believable-vibrancy";

const sha = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

// 自然キー定義（idに依存しない・両DBで同一内容→同一キー）
const TABLES = [
  { name: "ranking_leads", key: (r) => ["lead", r.email, r.source, r.created_at].join("|") },
  { name: "agent_feedback", key: (r) => ["fb", r.agent_id, r.created_at, sha(`${r.subject}\n${r.body}`)].join("|") },
  { name: "agent_voice_responses", key: (r) => ["voice", r.service_id, r.agent_type, r.question_id, r.response_choice, sha(r.response_text || "")].join("|") },
  { name: "outcomes", key: (r) => ["out", r.service_id, r.created_at, r.success, r.model_name || "", r.task_type || "", sha(JSON.stringify([r.error_class, r.context, r.agent_id]))].join("|") },
  { name: "service_events", key: (r) => ["ev", r.service_id, r.event_type, r.created_at, sha(r.title || "")].join("|") },
  { name: "inspections", key: (r) => ["insp", r.service_id, r.created_at, sha(JSON.stringify([r.status, r.findings]))].join("|") },
  { name: "site_checks", key: (r) => ["site", r.url || r.service_id, r.created_at].join("|") },
  { name: "infrastructure_tips", key: (r) => ["tip", sha(JSON.stringify([r.title, r.body, r.category]))].join("|") },
  { name: "execution_attempts", key: (r) => ["exec", r.attempt_id].join("|") },
  // upsert表のsource_keyは「自然キー@last_updated」で版管理する。
  // 素の自然キーをログに載せると、一度記録された時点で以後の数値更新が
  // skippedLoggedで止まる（Codex指摘）。版付きなら新しいlast_updatedは
  // 新キー＝再処理対象になり、実データ照合側(existing)がUPDATE判定する。
  { name: "model_service_stats", key: (r) => ["mss", r.service_id, r.model_name, r.task_type].join("|"),
    version: (r) => r.last_updated || "", upsert: true },
];

const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(PAYLOAD_PATH)).toString());
const db = new D(DB_PATH);
db.pragma("foreign_keys = OFF");

db.exec(`CREATE TABLE IF NOT EXISTS migration_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL, source_system TEXT NOT NULL, table_name TEXT NOT NULL,
  source_key TEXT NOT NULL, new_rowid INTEGER, action TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_system, table_name, source_key))`);

const summary = {};
const tx = db.transaction(() => {
  for (const t of TABLES) {
    let rows = payload.rows[t.name] || [];
    // ISO("2026-08-17T00:00:00")とSQL("2026-08-17 09:00:00")の混在に耐えるよう'T'を空白へ正規化して比較
    const norm = (s) => String(s).replace("T", " ");
    if (SINCE) rows = rows.filter((r) => norm(r.created_at || r.last_updated || "9999") >= norm(SINCE));
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name);
    for (const tag of ["source_system", "migrated_at", "migration_batch_id"]) {
      if (!cols.includes(tag)) { db.exec(`ALTER TABLE ${t.name} ADD COLUMN ${tag} TEXT`); cols.push(tag); }
    }
    // migration_log既載（batch-01のid由来キーとbatch-02+の自然キーは形式が違うため、
    // batch-01分は下の実データ自然キー照合が受け止める）
    const logged = new Set(db.prepare(`SELECT source_key FROM migration_log WHERE source_system=? AND table_name=?`).all(SOURCE, t.name).map((r) => r.source_key));
    // canonical実データの自然キー集合（id非依存＝batch-01でid保持挿入した行も、
    // canonical独自の新規行も、同内容なら必ずここで一致する）
    const existing = new Map(db.prepare(`SELECT rowid AS __rid, * FROM ${t.name}`).all().map((r) => [t.key(r), r]));
    const logIns = db.prepare(`INSERT OR IGNORE INTO migration_log(batch_id,source_system,table_name,source_key,new_rowid,action) VALUES (?,?,?,?,?,?)`);
    let inserted = 0, updated = 0, skippedExisting = 0, skippedLogged = 0, skippedDupInPayload = 0;
    const seenInPayload = new Set(); // 同一payload内の重複自然キーは1件だけ処理
    for (const row of rows) {
      const k = t.key(row);
      const logKey = t.version ? `${k}@${t.version(row)}` : k;
      if (seenInPayload.has(logKey)) { skippedDupInPayload++; continue; }
      seenInPayload.add(logKey);
      if (logged.has(logKey)) { skippedLogged++; continue; }
      const hit = existing.get(k);
      if (hit) {
        // last_updated比較はepoch正規化（"2026-08-17T.."と"2026-08-17 .."の混在で
        // 文字列比較が誤判定するのを防ぐ・Codex補足対応）。パース不能は0扱い。
        const toEpoch = (s) => { const v = Date.parse(String(s || "").replace(" ", "T") + (String(s || "").match(/[Zz]|[+-]\d{2}:?\d{2}$/) ? "" : "Z")); return Number.isFinite(v) ? v : 0; };
        if (t.upsert && toEpoch(row.last_updated) > toEpoch(hit.last_updated)) {
          const dataCols = Object.keys(row).filter((c) => cols.includes(c) && c !== "id");
          db.prepare(`UPDATE ${t.name} SET ${dataCols.map((c) => `${c}=?`).join(",")}, source_system=?, migrated_at=?, migration_batch_id=? WHERE rowid=?`)
            .run(...dataCols.map((c) => row[c]), SOURCE, new Date().toISOString(), BATCH, hit.__rid);
          hit.last_updated = row.last_updated; // 以後の比較は更新後の値と行う
          logIns.run(BATCH, SOURCE, t.name, logKey, hit.__rid, "updated");
          updated++;
        } else {
          logIns.run(BATCH, SOURCE, t.name, logKey, hit.__rid, "skipped_existing");
          skippedExisting++;
        }
        continue;
      }
      const r = { ...row, source_system: SOURCE, migrated_at: new Date().toISOString(), migration_batch_id: BATCH };
      delete r.id; // id非保持 — AUTOINCREMENT衝突を構造的に排除
      const useCols = Object.keys(r).filter((c) => cols.includes(c));
      const info = db.prepare(`INSERT INTO ${t.name} (${useCols.join(",")}) VALUES (${useCols.map(() => "?").join(",")})`)
        .run(...useCols.map((c) => r[c]));
      existing.set(k, { ...row, __rid: info.lastInsertRowid }); // payload後続行のUPSERT/skip判定用
      logIns.run(BATCH, SOURCE, t.name, logKey, info.lastInsertRowid, "inserted");
      inserted++;
    }
    summary[t.name] = { source: rows.length, inserted, updated, skippedExisting, skippedLogged, skippedDupInPayload };
  }
  if (MODE === "dry") throw new Error("__DRY_RUN_ROLLBACK__");
});

try { tx(); } catch (e) {
  if (e.message !== "__DRY_RUN_ROLLBACK__") { console.error("ABORTED:", e.message); process.exit(1); }
}
console.log(JSON.stringify({ mode: MODE, batch: BATCH, since: SINCE, summary }, null, 1));
