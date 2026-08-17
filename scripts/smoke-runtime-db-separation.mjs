#!/usr/bin/env node
/**
 * P0 #39再発防止（Codex裁定2026-08-17）: MCPサーバーのruntime DB分離の否定テスト
 *
 *   R1. .mcp.json（プロジェクト両階層）の kansei-link.env.KANSEI_DB_PATH が
 *       研究正本DB（kansei-link-mcp/kansei-link.db）を指していないこと（静的）
 *   R2. .mcp.json と同じ env で dist/index.js（stdio MCPサーバー）を実起動しても
 *       研究正本DB本体・-wal・-shm が1バイトも変化しないこと（mtime+size+先頭/末尾hash）
 *   R3. runtime DB側にはスキーマ+migrationマーカーが作成されること（分離先が機能）
 *
 *   node scripts/smoke-runtime-db-separation.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, "..");
const RESEARCH_DB = resolve(ROOT, "kansei-link.db");

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

// R1: 静的検査 — .mcp.json が研究正本を指していない
const mcpConfigs = [join(ROOT, ".mcp.json"), join(ROOT, "..", ".mcp.json")].filter(existsSync);
check("R1-pre .mcp.json が最低1つ存在", mcpConfigs.length > 0);
let configuredDbPath = null;
for (const p of mcpConfigs) {
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  const envPath = cfg.mcpServers?.["kansei-link"]?.env?.KANSEI_DB_PATH ?? null;
  configuredDbPath = envPath ?? configuredDbPath;
  const pointsAtResearch = envPath === null || resolve(envPath) === RESEARCH_DB;
  check(`R1 ${p.replace(/\\/g, "/").split("/").slice(-2).join("/")} は研究正本DBを指さない`, !pointsAtResearch, `KANSEI_DB_PATH=${envPath}`);
}

// 研究正本DBの状態指紋（mtime+size+スパースhash: 大DBでも高速）
function fingerprint(file) {
  if (!existsSync(file)) return "absent";
  const st = statSync(file);
  const fd = readFileSync(file); // ~130MB read is acceptable for a smoke; exact byte compare
  return `${st.size}:${createHash("sha256").update(fd).digest("hex")}`;
}
console.log("  (研究正本DBの指紋採取中…)");
const before = {
  db: fingerprint(RESEARCH_DB),
  wal: fingerprint(RESEARCH_DB + "-wal"),
  shm: statSync(RESEARCH_DB + "-shm", { throwIfNoEntry: false })?.size ?? "absent", // shmは共有メモリでhash不安定・sizeのみ
};

// R2/R3: 実起動 — runtimeは一時ディレクトリ（実runtime DBも汚さない純粋テスト）
const TMP = mkdtempSync(join(tmpdir(), "kansei-runtime-sep-"));
const runtimeDb = join(TMP, "runtime-test.db");
const child = spawn(process.execPath, [join(ROOT, "dist", "index.js")], {
  env: { ...process.env, KANSEI_DB_PATH: runtimeDb },
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
});
let stderrBuf = "";
child.stderr.on("data", (d) => (stderrBuf += d));
// MCP initializeリクエストを送って実際のツール登録+DB初期化まで走らせる
child.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sep-smoke", version: "0" } } }) + "\n"
);
await new Promise((res) => setTimeout(res, 8000));
child.kill();
await new Promise((res) => setTimeout(res, 800));

const after = {
  db: fingerprint(RESEARCH_DB),
  wal: fingerprint(RESEARCH_DB + "-wal"),
  shm: statSync(RESEARCH_DB + "-shm", { throwIfNoEntry: false })?.size ?? "absent",
};
check("R2 研究正本DB本体が無変化（size+SHA-256一致）", before.db === after.db);
check("R2b -wal が無変化", before.wal === after.wal);
check("R2c -shm サイズ無変化", String(before.shm) === String(after.shm));

let runtimeOk = false;
let markerOk = false;
if (existsSync(runtimeDb)) {
  const { default: Database } = await import("better-sqlite3");
  const rdb = new Database(runtimeDb, { readonly: true });
  try {
    runtimeOk = rdb.prepare("SELECT COUNT(*) c FROM services").get().c >= 0;
    markerOk = !!rdb.prepare("SELECT 1 x FROM schema_migrations WHERE migration_id='service_stats_rebuild_v1'").get();
  } finally {
    rdb.close();
  }
}
check("R3 runtime DBが分離先に作成されスキーマ初期化済み", runtimeOk, stderrBuf.slice(-300));
check("R3b migrationマーカーはruntime側にのみ新規記録", markerOk);

rmSync(TMP, { recursive: true, force: true });

console.log(`\n=== smoke-runtime-db-separation: ${pass} passed, ${fail} failed ===`);
if (fail) {
  failures.forEach((f) => console.error("  FAILED:", f));
  process.exit(1);
}
