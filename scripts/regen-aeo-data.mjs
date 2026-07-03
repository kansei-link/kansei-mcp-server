// regen-aeo-data.mjs — 2026-07-03 公開データファイル再生成（telemetry gate済み）
// gen-ranking-page.mjs の後継。seed/注入は一切行わず、実DBから
// public/aeo-data.json と public/rankings-raw.json を生成する。
import { getDb } from "../dist/db/connection.js";
import { generateArticle } from "../dist/tools/generate-aeo-article.js";
import fs from "node:fs";

const db = getDb();
const json = generateArticle(db, { quarter: "Q2 2026", format: "json", topN: 100 });
fs.writeFileSync("public/aeo-data.json", JSON.stringify(json, null, 2));

const rankings = json.overall_top;
fs.writeFileSync(
  "public/rankings-raw.json",
  JSON.stringify({ rankings, summary: json.summary, catRankings: json.category_rankings }, null, 2),
);

const withRate = rankings.filter((r) => r.success_rate !== null);
console.log("overall_top:", rankings.length, "| entries with public success_rate:", withRate.length);
withRate.slice(0, 8).forEach((r) => console.log("  rate kept:", r.service_id, r.success_rate + "%", r.total_agent_calls, "calls"));
console.log("top3:", rankings.slice(0, 3).map((r) => `${r.service_id}:${r.grade}:${r.success_rate === null ? "null" : r.success_rate}`).join(", "));
console.log("verified total:", json.summary?.agent_readiness ? JSON.stringify(json.summary.agent_readiness) : "n/a");
