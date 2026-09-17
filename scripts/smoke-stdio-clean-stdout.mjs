#!/usr/bin/env node
/**
 * stdio MCP の stdout 衛生（回帰テスト）
 *
 * stdio の stdout は JSON-RPC メッセージ専用。v1.2.2 までは seed / axr のログ（console.log）が
 * stdout に混ざり、公式 MCP SDK の Client では JSON パース失敗として onerror が発火していた。
 * src/stdio-guard.ts を src/index.ts の最初の import にして console.log/info/debug を stderr へ向ける。
 *
 * ログを読み飛ばす独自処理は使わない:
 *   1. 公式 SDK（@modelcontextprotocol/sdk の Client + StdioClientTransport）で connect(=initialize) → tools/list。
 *      client.onerror が 1 件でも発火したら FAIL
 *   2. 同じ条件で子プロセスを直接起動し、stdout の全行が JSON-RPC 2.0 であることを検査
 *   いずれも「初回起動（DB なし）」「再起動（DB あり）」の 2 回
 *   3. 静的検査: src/index.ts の最初の import が ./stdio-guard.js／HTTP サーバーは guard を読まない
 *
 * 使い方: node scripts/smoke-stdio-clean-stdout.mjs [path/to/dist/index.js]（省略時はこのリポジトリの dist）
 * 事前に npm run build が必要。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(process.argv[2] || join(ROOT, "dist", "index.js"));
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(ENTRY)) { console.error(`entry not found: ${ENTRY} — run npm run build first`); process.exit(2); }
const WORK = mkdtempSync(join(tmpdir(), "kansei-stdio-smoke-"));
const DB = join(WORK, "stdio.db");
const env = { ...process.env, KANSEI_DB_PATH: DB, HOME: WORK, USERPROFILE: WORK };

// Windows では子プロセス終了直後も DB ファイルのロックが残ることがあるので、リトライしながら消す
async function removeWithRetry(path, opts = {}) {
  for (let i = 0; i < 40; i++) {
    try { rmSync(path, { force: true, ...opts }); return true; } catch (e) { if (e.code !== "EBUSY" && e.code !== "EPERM") throw e; await sleep(250); }
  }
  return false;
}
const resetDb = async () => { for (const s of ["", "-wal", "-shm"]) await removeWithRetry(DB + s); };

async function sdkRun() {
  const errors = [];
  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env, stderr: "pipe" });
  const client = new Client({ name: "kansei-stdio-smoke", version: "1.0.0" }, { capabilities: {} });
  client.onerror = (e) => errors.push(String(e?.message || e));
  let tools = null, failure = null;
  try {
    await client.connect(transport);
    tools = (await client.listTools()).tools.map((t) => t.name);
  } catch (e) { failure = String(e?.message || e); } finally { try { await client.close(); } catch {} }
  await sleep(500); // 子プロセスの終了を待つ（次回起動・DB 削除の前）
  return { errors, tools, failure };
}

function rawRun() {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [ENTRY], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", requested = false;
    const summarize = () => {
      const lines = out.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
      const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
      const list = parsed.find((o) => o?.id === 2);
      return {
        nonMcp: lines.filter((_, i) => parsed[i]?.jsonrpc !== "2.0"),
        init: !!parsed.find((o) => o?.id === 1)?.result,
        tools: list?.result?.tools?.length ?? 0,
        stderrLines: err.split("\n").filter(Boolean).length,
      };
    };
    const stop = () => { if (requested) return; requested = true; try { child.kill(); } catch {} };
    child.stdout.on("data", (d) => { out += d; if (/"id":2[,}]/.test(out)) setTimeout(stop, 300); });
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", () => resolveRun(summarize())); // 終了を待ってから結果を返す＝DB ロックを残さない
    setTimeout(stop, 60000);
    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw-smoke", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

console.log(`entry: ${ENTRY}`);
try {
  await resetDb();
  const s1 = await sdkRun();
  check("1a. SDK 初回起動: connect(initialize)・tools/list 完了", !s1.failure && (s1.tools?.length ?? 0) > 0, s1.failure || `tools=${s1.tools?.length}`);
  check("1b. SDK 初回起動: client.onerror 0 件（stdout の非 JSON 行なし）", s1.errors.length === 0, s1.errors.slice(0, 2).join(" | "));
  const s2 = await sdkRun();
  check("1c. SDK 再起動（DB あり）: connect・tools/list 完了", !s2.failure && (s2.tools?.length ?? 0) > 0, s2.failure || `tools=${s2.tools?.length}`);
  check("1d. SDK 再起動: client.onerror 0 件", s2.errors.length === 0, s2.errors.slice(0, 2).join(" | "));

  await resetDb();
  const r1 = await rawRun();
  check("2a. RAW 初回起動: stdout は全行 JSON-RPC 2.0", r1.nonMcp.length === 0, r1.nonMcp.slice(0, 2).join(" | "));
  check("2b. RAW 初回起動: initialize と tools/list に応答", r1.init && r1.tools > 0, `tools=${r1.tools}`);
  check("2c. RAW 初回起動: seed ログは stderr に出ている（ログ自体は消していない）", r1.stderrLines > 0, `stderr=${r1.stderrLines}`);
  const r2 = await rawRun();
  check("2d. RAW 再起動: stdout は全行 JSON-RPC 2.0・応答あり", r2.nonMcp.length === 0 && r2.init && r2.tools > 0, r2.nonMcp.slice(0, 2).join(" | "));

  const src = readFileSync(join(ROOT, "src", "index.ts"), "utf8");
  const firstImport = (src.match(/^import\s[^\n]*$/m) || [""])[0].trim();
  check("3a. src/index.ts の最初の import が ./stdio-guard.js", /^import\s+["']\.\/stdio-guard\.js["'];?$/.test(firstImport), firstImport);
  const http = readFileSync(join(ROOT, "src", "http-server.ts"), "utf8");
  check("3b. HTTP サーバーは stdio-guard を読まない（運用ログは stdout のまま）", !/stdio-guard/.test(http));
} finally {
  await removeWithRetry(WORK, { recursive: true });
}

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-stdio-clean-stdout: ALL PASS" : "\n❌ smoke-stdio-clean-stdout: FAILURES");
process.exit(all ? 0 : 1);
