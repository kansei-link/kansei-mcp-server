#!/usr/bin/env node
/**
 * API ガイドの docs_url 訂正が、新規 DB と旧 DB の両方に届き、繰り返しても変わらないことの回帰テスト（2026-09-18）。
 *   1. fresh DB: moneyforward の docs_url が公式開発者サイト・旧ホスト（developer.moneyforward.com）がガイドのどの列にも無い
 *   2. old DB: 旧 docs_url・旧文言を持つ行がある DB に seed を当てる → docs_url と文言が直る・他列（base_url 等）は不変
 *   3. 冪等: もう一度 seed を当てても行は一切変わらない（updated_at も動かない）
 *   4. 他サービスのガイド行数は不変
 * 実行前に npm run build（dist を使う）。一時 DB のみ使用。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { initializeDb } = await import("../dist/db/schema.js");
const { seedDatabase } = await import("../dist/db/seed.js");

const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };
const T = mkdtempSync(join(tmpdir(), "guides-docs-url-"));
const OLD_HOST = "developer.moneyforward.com";
const NEW_DOCS = "https://developers.biz.moneyforward.com/";
const cols = ["base_url", "api_version", "auth_overview", "auth_token_url", "auth_scopes", "auth_setup_hint", "sandbox_url", "key_endpoints", "request_content_type", "pagination_style", "rate_limit", "error_format", "quickstart_example", "agent_tips", "docs_url"];
const rowOf = (db) => db.prepare("SELECT * FROM service_api_guides WHERE service_id = 'moneyforward'").get();
const anyOldHost = (db) => db.prepare(`SELECT COUNT(*) AS n FROM service_api_guides WHERE ${cols.map((c) => `${c} LIKE '%${OLD_HOST}%'`).join(" OR ")}`).get().n;

// 1. fresh DB
{
  const db = new Database(join(T, "fresh.db")); initializeDb(db); seedDatabase(db);
  const r = rowOf(db);
  check("1a. fresh DB: moneyforward の docs_url が公式開発者サイト", r?.docs_url === NEW_DOCS, r?.docs_url);
  check("1b. fresh DB: 旧ホストがガイドのどの列にも無い", anyOldHost(db) === 0);
  db.close();
}
// 2. old DB（旧 docs_url・旧文言・運用者が編集した base_url を持つ）→ 3. 冪等 → 4. 行数不変
{
  const db = new Database(join(T, "old.db")); initializeDb(db); seedDatabase(db);
  const before = db.prepare("SELECT COUNT(*) AS n FROM service_api_guides").get().n;
  db.prepare("UPDATE service_api_guides SET docs_url = 'https://developer.moneyforward.com/docs/accounting', auth_setup_hint = 'Easiest: https://beta.mcp.developers.biz.moneyforward.com/mcp/ca/v3 (Remote MCP available to all plans since March 2026). Manual: register at developer.moneyforward.com, get client_id/secret.', base_url = 'https://operator-edited.example/api/v3/', updated_at = '2026-07-01 00:00:00' WHERE service_id = 'moneyforward'").run();
  seedDatabase(db);
  const r1 = rowOf(db);
  check("2a. old DB: seed を当てると docs_url が直る", r1.docs_url === NEW_DOCS, r1.docs_url);
  check("2b. old DB: 旧文言（register at developer.moneyforward.com）も直る・旧ホストは 0 件", !r1.auth_setup_hint.includes(OLD_HOST) && r1.auth_setup_hint.includes("app-portal.moneyforward.com") && anyOldHost(db) === 0);
  check("2c. old DB: 運用者が編集した他列（base_url）は上書きされない（insert-once のまま）", r1.base_url === "https://operator-edited.example/api/v3/", r1.base_url);
  check("2d. old DB: updated_at が更新される", r1.updated_at !== "2026-07-01 00:00:00", r1.updated_at);
  seedDatabase(db);
  const r2 = rowOf(db);
  check("3. 冪等: 2 回目の seed で行が一切変わらない（updated_at 含む）", JSON.stringify(r1) === JSON.stringify(r2));
  const after = db.prepare("SELECT COUNT(*) AS n FROM service_api_guides").get().n;
  check("4. ガイドの行数は不変", before === after, `${before} → ${after}`);
  db.close();
}
rmSync(T, { recursive: true, force: true });
const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-api-guides-docs-url: ALL PASS" : "\n❌ smoke-api-guides-docs-url: FAILURES");
process.exit(all ? 0 : 1);
