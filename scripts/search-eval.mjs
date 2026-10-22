#!/usr/bin/env node
/**
 * search-eval.mjs — 固定の問い 10 本（JA 6・EN 4）＋名指し 5 本で search_services の上位 5 件を記録する。
 *
 * 指示: founder-ops/research/Freshness_2026-10/INSTRUCTION-agent-search-ranking.md
 * 「測ってから直す」: 直す前と後で同じ問いを流し、PR 本文に前後の表を載せる。
 * 本番 DB に依存するので CI では走らせない（手元で）。DB は読み取り専用のコピーを使うこと
 * （searchServices は service_snapshots の search_appearances を更新するため、コピーで）。
 *
 * 使い方:
 *   node scripts/search-eval.mjs --db <copy.db> [--out before.json] [--json]
 *   node scripts/search-eval.mjs --db <copy.db> --compare before.json   … 前後の表（Markdown）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { searchServices } from "../dist/tools/search-services.js";
import { openDb } from "../dist/db/open.js";

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DB = opt("--db"); const OUT = opt("--out"); const COMPARE = opt("--compare");
if (!DB) { console.error("usage: --db <copy.db> [--out file] [--compare before.json] [--json]"); process.exit(2); }

/** 固定の問い（intent, category） — Ren の問いは category=accounting で記録されたのでそのまま */
export const QUERIES = [
  { id: "ja-1", intent: "請求書作成と会計処理を自動化したい", category: "accounting", note: "Ren 10/22" },
  { id: "ja-2", intent: "勤怠を自動で集計したい" },
  { id: "ja-3", intent: "チャットに通知を送りたい" },
  { id: "ja-4", intent: "プロジェクトのタスクを作りたい" },
  { id: "ja-5", intent: "経費精算を自動化" },
  { id: "ja-6", intent: "請求書を作って送りたい" },
  { id: "en-1", intent: "automate invoicing and accounting" },
  { id: "en-2", intent: "create tasks in project management" },
  { id: "en-3", intent: "send a team chat notification" },
  { id: "en-4", intent: "manage HR records" },
];
/** 名指し 5 本: 1 位が変わらないこと */
export const NAMED = [
  { id: "named-freee", intent: "freee で請求書を作る", expect: "freee" },
  { id: "named-kintone", intent: "kintone のレコードを更新したい", expect: "kintone" },
  { id: "named-linear", intent: "create a Linear issue", expect: "linear" },
  { id: "named-notion", intent: "add a page to Notion", expect: "notion" },
  { id: "named-slack", intent: "post a message to Slack", expect: "slack" },
];

const db = openDb(DB);
const run = (q) => searchServices(db, q.intent, q.category, 5).map((r) => ({
  id: r.service_id, score: r.relevance_score, mcp_status: r.mcp_status, basis: r.mcp_status_basis, grade: r.axr_grade, reports: r.usage_count,
  boost: r.evidence_boost ?? null,
}));
const result = { generated_at: new Date().toISOString(), db: DB, queries: {}, named: {} };
for (const q of QUERIES) result.queries[q.id] = { intent: q.intent, category: q.category || null, top5: run(q) };
for (const q of NAMED) { const top = run(q); result.named[q.id] = { intent: q.intent, expect: q.expect, first: top[0]?.id || null, ok: top[0]?.id === q.expect, top5: top }; }
db.close();

if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");

const fmt = (r) => `${r.id}(${r.score}${r.boost ? `+${r.boost}` : ""})`;
if (COMPARE) {
  const before = JSON.parse(readFileSync(COMPARE, "utf8"));
  console.log("| 問い | 前（上位 5） | 後（上位 5） |\n|---|---|---|");
  for (const q of QUERIES) {
    const b = before.queries[q.id]?.top5 || [], a = result.queries[q.id].top5;
    console.log(`| ${q.id} ${q.intent}${q.category ? `（${q.category}）` : ""} | ${b.map(fmt).join("・")} | ${a.map(fmt).join("・")} |`);
  }
  console.log("\n| 名指し | 前 1 位 | 後 1 位 |\n|---|---|---|");
  for (const q of NAMED) console.log(`| ${q.intent} | ${before.named[q.id]?.first} | ${result.named[q.id].first}${result.named[q.id].ok ? "" : " ❌"} |`);
} else if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 1));
} else {
  for (const q of QUERIES) console.log(`${q.id} ${q.intent}${q.category ? `（${q.category}）` : ""}\n   ${result.queries[q.id].top5.map(fmt).join("・")}`);
  for (const q of NAMED) console.log(`${q.id}: ${result.named[q.id].first} ${result.named[q.id].ok ? "ok" : "❌"}`);
}
