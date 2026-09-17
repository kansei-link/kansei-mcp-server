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
//   8. (2026-09-16 Codex P1) 自然キーを実在列だけで組み直す（v1 は outcomes/inspections/tips で存在しない列を参照し、
//      実質 service_id|created_at|success だけで同一視していた）。原 ID を持つ表（site_checks/execution_attempts/
//      infrastructure_tips、attempt_id 付き outcomes）は ID を同一性とし、同 ID で内容が違えば停止。原 ID の無い表は
//      実在列の全内容をキーにする。キーは v2: 接頭辞で旧 migration_log と分離。起動時にキー列の実在を検証。
//      recheck モード（読取専用）で旧 DB の payload と canonical を再照合し、取りこぼし・内容不一致を列挙する
//   7. (2026-09-16 C0 事後修正) id を捨てるのは INTEGER PRIMARY KEY の表だけ。TEXT PK（site_checks）は
//      source の id を保持。自然キーが一致しないのに既存 id と衝突する行（＝同じ id に別内容）が 1 件でも
//      あれば batch 全体を停止する（skip すると source 行が黙って失われるため）。挿入後に id NULL を検査して throw
//
// 実行: NODE_PATH=/app/node_modules node migrate-believable-delta.cjs <dry|apply|recheck> \
//         --batch=mig-believable-YYYYMMDD-NN [--since=2026-08-16T12:00:00] \
//         [--payload=/tmp/migrate-payload.json.gz] [--db=/data/kansei-link.db]
// payloadは batch-01 と同形式（{schemas:{}, rows:{table:[...]}}）。

const D = require("better-sqlite3");
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");

const MODE = process.argv[2];
if (!["dry", "apply", "recheck"].includes(MODE)) { console.error("usage: node migrate-believable-delta.cjs dry|apply|recheck --batch=... [--since=ISO] [--cutoff=ISO] [--payload=path] [--db=path]"); process.exit(2); }
// 同名フラグは後勝ち（CLI慣例・呼び出し側のデフォルト上書きを許す）
const arg = (name, dflt) => { const m = [...process.argv].reverse().find((a) => a.startsWith(`--${name}=`)); return m ? m.slice(name.length + 3) : dflt; };
const BATCH = arg("batch", MODE === "recheck" ? "recheck" : null);
if (!BATCH) { console.error("--batch=mig-believable-YYYYMMDD-NN is required"); process.exit(2); }
const CUTOFF = arg("cutoff", null); // recheck: この時刻以前の行を「C0 時点で存在していた行」として分ける
const SINCE = arg("since", null);
const PAYLOAD_PATH = arg("payload", "/tmp/migrate-payload.json.gz");
const DB_PATH = arg("db", process.env.KANSEI_DB_PATH || "/data/kansei-link.db");
const SOURCE = "believable-vibrancy";

const sha = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

// ── キー定義 v2（Codex P1 2026-09-16）
// 原則: (a) 参照する列は keyCols に列挙し、起動時に canonical の実スキーマと照合する（存在しない列を参照して
//          キーが縮退する v1 の事故を構造的に防ぐ）
//       (b) 原 ID を持つ表は identity（ID）で同一視し、contentCols の内容が違えば「同一視できない衝突」として停止
//       (c) 原 ID を持たない表は実在列の全内容をキーにする（同秒・同内容の完全同一行だけが同一視される）
const KEY_VERSION = "v2"; // 旧ログ（v1 キー）と混ざらないよう接頭辞で分離＝再回収を旧 skipped_existing が妨げない
const nz = (v) => (v === undefined || v === null ? "" : String(v));
const fpCols = (r, cols) => sha(JSON.stringify(cols.map((c) => (r[c] === undefined ? null : r[c]))));
const contentDiff = (src, dst, cols) => cols.filter((c) => c in src && (src[c] ?? null) !== (dst[c] ?? null));
const OUTCOME_CONTENT = ["service_id", "agent_id_hash", "success", "latency_ms", "error_type", "workaround", "context_masked", "provenance", "verification_status", "recipe_id", "recipe_version", "failed_step", "created_at", "is_retry", "estimated_users", "model_name", "agent_type", "task_type", "input_tokens", "output_tokens", "cost_usd"];
const INSPECTION_CONTENT = ["service_id", "anomaly_type", "severity", "description", "evidence", "status", "resolution", "resolved_by", "created_at", "resolved_at"];
const SITE_CHECK_CONTENT = ["url", "score", "grade", "findings", "raw_signals", "ip_hash", "created_at"];
const TIP_CONTENT = ["category", "title", "from_stack", "to_stack", "savings_pct", "confidence", "conditions", "evidence_url", "evidence_summary", "related_services", "created_at", "updated_at"];
const ATTEMPT_CONTENT = ["service_id", "recipe_id", "recipe_version", "parent_attempt_id", "status", "issued_at", "expires_at", "closed_at"];
const TABLES = [
  { name: "ranking_leads", keyCols: ["email", "source", "created_at"],
    key: (r) => ["lead", r.email, r.source, r.created_at].join("|") },
  { name: "agent_feedback", keyCols: ["agent_id", "created_at", "subject", "body"],
    key: (r) => ["fb", r.agent_id, r.created_at, sha(`${r.subject}\n${r.body}`)].join("|") },
  { name: "agent_voice_responses", keyCols: ["service_id", "agent_type", "question_id", "response_choice", "response_text"],
    key: (r) => ["voice", r.service_id, r.agent_type, r.question_id, r.response_choice, sha(r.response_text || "")].join("|") },
  // outcomes: 実行識別子（attempt_id）があればそれが同一性。無ければ実在列の全内容（v1 は error_class/context/agent_id
  // という存在しない列を参照し、service_id|created_at|success|model|task に縮退していた）
  { name: "outcomes", keyCols: ["attempt_id", ...OUTCOME_CONTENT], contentCols: OUTCOME_CONTENT,
    key: (r) => (r.attempt_id != null && r.attempt_id !== "" ? ["out", "att", r.attempt_id].join("|") : ["out", r.service_id, r.created_at, nz(r.success), nz(r.agent_id_hash), nz(r.provenance), nz(r.model_name), nz(r.task_type), nz(r.error_type), nz(r.latency_ms), fpCols(r, OUTCOME_CONTENT)].join("|")) },
  { name: "service_events", keyCols: ["service_id", "event_type", "created_at", "title"],
    key: (r) => ["ev", r.service_id, r.event_type, r.created_at, sha(r.title || "")].join("|") },
  // inspections: v1 は findings（存在しない列）を参照 → 実在列の全内容
  { name: "inspections", keyCols: INSPECTION_CONTENT,
    key: (r) => ["insp", r.service_id, r.created_at, nz(r.anomaly_type), nz(r.severity), nz(r.status), fpCols(r, INSPECTION_CONTENT)].join("|") },
  // site_checks: 原 ID（TEXT PK・12 桁トークン）が同一性。v1 の url|created_at は同 URL 同秒の別チェックを 1 件に潰した
  { name: "site_checks", keyCols: ["id", ...SITE_CHECK_CONTENT], contentCols: SITE_CHECK_CONTENT,
    key: (r) => ["site", nz(r.id)].join("|") },
  // infrastructure_tips: tip_id（UNIQUE）が同一性。v1 は body（存在しない列）を参照
  { name: "infrastructure_tips", keyCols: ["tip_id", ...TIP_CONTENT], contentCols: TIP_CONTENT,
    key: (r) => ["tip", nz(r.tip_id)].join("|") },
  { name: "execution_attempts", keyCols: ["attempt_id", ...ATTEMPT_CONTENT], contentCols: ATTEMPT_CONTENT,
    key: (r) => ["exec", r.attempt_id].join("|") },
  // upsert表のsource_keyは「自然キー@last_updated」で版管理する。
  // 素の自然キーをログに載せると、一度記録された時点で以後の数値更新が
  // skippedLoggedで止まる（Codex指摘）。版付きなら新しいlast_updatedは
  // 新キー＝再処理対象になり、実データ照合側(existing)がUPDATE判定する。
  { name: "model_service_stats", keyCols: ["service_id", "model_name", "task_type", "last_updated"],
    key: (r) => ["mss", r.service_id, r.model_name, r.task_type].join("|"),
    version: (r) => r.last_updated || "", upsert: true },
];
for (const t of TABLES) { const k0 = t.key; t.key = (r) => `${KEY_VERSION}:${k0(r)}`; }

const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(PAYLOAD_PATH)).toString());
const db = new D(DB_PATH, { readonly: MODE === "recheck" });
db.pragma("foreign_keys = OFF");

if (MODE !== "recheck") db.exec(`CREATE TABLE IF NOT EXISTS migration_log(
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
    const tinfo = db.prepare(`PRAGMA table_info(${t.name})`).all();
    const cols = tinfo.map((c) => c.name);
    // キーが参照する列は canonical の実スキーマに存在しなければならない（v1 の縮退事故の再発防止）
    const missingKeyCols = (t.keyCols || []).filter((c) => !cols.includes(c));
    if (missingKeyCols.length) throw new Error(`${t.name}: key references unknown column(s) ${missingKeyCols.join(",")} — aborting`);
    // id を捨てるのは「id が INTEGER PRIMARY KEY（rowid 別名・AUTOINCREMENT）」の表だけ。
    // TEXT PK（site_checks の 12 桁トークン等）は SQLite が NULL を通してしまい、到達不能行になる
    // （C0 batch-02 で 297 行が id NULL になった事故の再発防止）。TEXT PK は source の id を保持し、
    // 既存 id と衝突したら batch を停止する（同内容の再送は existing 照合で先に skip 済み）。
    const idCol = tinfo.find((c) => c.name === "id");
    const dropId = !!idCol && idCol.pk === 1 && /^INTEGER$/i.test(idCol.type || "");
    const idExists = idCol && !dropId ? db.prepare(`SELECT 1 FROM ${t.name} WHERE id = ?`) : null;
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
    if (MODE === "recheck") {
      // 読取専用: payload（旧 DB）の各行を v2 キーで canonical と突合し、無い行・同一性一致だが内容が違う行を列挙
      const norm2 = (s) => String(s || "").replace("T", " ");
      const isBefore = (r) => !CUTOFF || norm2(r.created_at || r.issued_at || r.last_updated || "9999") <= norm2(CUTOFF);
      const missing = [], mismatch = [], dupInPayload = []; const seen = new Set(); let matched = 0;
      for (const row of rows) {
        const k = t.key(row);
        if (seen.has(k)) { dupInPayload.push({ key: k, id: row.id ?? row.attempt_id ?? row.tip_id ?? null }); continue; }
        seen.add(k);
        const hit = existing.get(k);
        if (!hit) { missing.push({ key: k, id: row.id ?? row.attempt_id ?? row.tip_id ?? null, created_at: row.created_at || row.issued_at || row.last_updated || null, before_cutoff: isBefore(row) }); continue; }
        const diffCols = t.contentCols && !t.upsert ? contentDiff(row, hit, t.contentCols) : [];
        if (diffCols.length) { mismatch.push({ key: k, id: row.id ?? row.attempt_id ?? row.tip_id ?? null, differing: diffCols }); continue; }
        matched++;
      }
      summary[t.name] = { source: rows.length, matched, missing: missing.length, missing_before_cutoff: missing.filter((m) => m.before_cutoff).length, content_mismatch: mismatch.length, dup_in_payload: dupInPayload.length,
        missing_rows: missing.slice(0, 50), mismatch_rows: mismatch.slice(0, 50), dup_rows: dupInPayload.slice(0, 20) };
      continue;
    }
    let inserted = 0, updated = 0, skippedExisting = 0, skippedLogged = 0, skippedDupInPayload = 0;
    const seenInPayload = new Map(); // 同一payload内の重複キー: 同一性表は内容が違えば停止、同内容なら 1 件だけ処理
    for (const row of rows) {
      const k = t.key(row);
      const logKey = t.version ? `${k}@${t.version(row)}` : k;
      if (seenInPayload.has(logKey)) {
        const first = seenInPayload.get(logKey);
        if (t.contentCols && !t.upsert && contentDiff(row, first, t.contentCols).length) {
          throw new Error(`${t.name}: two payload rows share identity ${k} with different content — aborting batch`);
        }
        logIns.run(BATCH, SOURCE, t.name, `${logKey}#dup${skippedDupInPayload + 1}`, null, "skipped_dup_in_payload");
        skippedDupInPayload++; continue;
      }
      seenInPayload.set(logKey, row);
      const hit = existing.get(k);
      // 同一性（原 ID）で一致したのに内容が違う＝同一視できない衝突。skip すると source の内容が失われ、
      // 上書きすると canonical の行が壊れる。どちらも黙って起こしてはいけないので停止（Codex P1）。
      // 「ログ済み」の判定より先に行う＝過去 batch で記録済みのキーでも内容の食い違いは隠さない
      if (hit && t.contentCols && !t.upsert) {
        const differing = contentDiff(row, hit, t.contentCols);
        if (differing.length) throw new Error(`${t.name}: identity ${k} exists with different content (columns: ${differing.join(",")}) — aborting batch`);
      }
      if (logged.has(logKey)) { skippedLogged++; continue; }
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
      if (dropId) delete r.id; // INTEGER PK のみ非保持 — AUTOINCREMENT 衝突を構造的に排除
      else if (idExists && r.id != null && idExists.get(r.id)) {
        // ここに来る＝自然キーは一致しない（同内容なら existing で skip 済み）のに id だけ既存と同じ。
        // skip すると source 行が消え、上書きすると既存行が壊れる。どちらも黙って起こしてはいけないので停止。
        throw new Error(`${t.name}: id collision with different content (id=${r.id}, source key=${k}) — aborting batch`);
      }
      const useCols = Object.keys(r).filter((c) => cols.includes(c));
      const info = db.prepare(`INSERT INTO ${t.name} (${useCols.join(",")}) VALUES (${useCols.map(() => "?").join(",")})`)
        .run(...useCols.map((c) => r[c]));
      existing.set(k, { ...row, __rid: info.lastInsertRowid }); // payload後続行のUPSERT/skip判定用
      logIns.run(BATCH, SOURCE, t.name, logKey, info.lastInsertRowid, "inserted");
      inserted++;
    }
    // 挿入後の安全網: この batch の行に id NULL があれば表ごと巻き戻す（dry でも apply でも検出）
    if (idCol) {
      const nullIds = db.prepare(`SELECT COUNT(*) c FROM ${t.name} WHERE id IS NULL AND migration_batch_id = ?`).get(BATCH).c;
      if (nullIds > 0) throw new Error(`${t.name}: ${nullIds} rows would have NULL id — aborting batch`);
    }
    summary[t.name] = { source: rows.length, inserted, updated, skippedExisting, skippedLogged, skippedDupInPayload };
  }
  if (MODE === "dry") throw new Error("__DRY_RUN_ROLLBACK__");
});

if (MODE === "recheck") {
  // 読取専用モード: トランザクションを張らず（readonly 接続）同じ表ループを走らせる
  try { tx(); } catch (e) { if (e.message !== "__DRY_RUN_ROLLBACK__") { console.error("ABORTED:", e.message); process.exit(1); } }
  const totals = Object.values(summary).reduce((a, s) => ({ missing: a.missing + s.missing, missing_before_cutoff: a.missing_before_cutoff + s.missing_before_cutoff, mismatch: a.mismatch + s.content_mismatch }), { missing: 0, missing_before_cutoff: 0, mismatch: 0 });
  console.log(JSON.stringify({ mode: MODE, key_version: KEY_VERSION, cutoff: CUTOFF, totals, summary }, null, 1));
  process.exit(0);
}
try { tx(); } catch (e) {
  if (e.message !== "__DRY_RUN_ROLLBACK__") { console.error("ABORTED:", e.message); process.exit(1); }
}
console.log(JSON.stringify({ mode: MODE, batch: BATCH, since: SINCE, key_version: KEY_VERSION, summary }, null, 1));
