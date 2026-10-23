// regen-aeo-data.mjs — 2026-07-03 公開データファイル再生成（telemetry gate済み）
// gen-ranking-page.mjs の後継。seed/注入は一切行わず、実DBから
// public/aeo-data.json と public/rankings-raw.json を生成する。
import { getDb } from "../dist/db/connection.js";
import { generateArticle } from "../dist/tools/generate-aeo-article.js";
import fs from "node:fs";

const db = getDb();
// Disclosure stage 1 (2026-10-23): the public JSON is a summary — top 50 overall, top 10 per category.
// The full list is not a public bulk export (see DESIGN-disclosure-layers-v1 §4-5).
const TOP = 50, PER_CATEGORY = 10;
const full = generateArticle(db, { quarter: "Q2 2026", format: "json", topN: TOP });
const category_rankings = Object.fromEntries(Object.entries(full.category_rankings || {}).map(([k, v]) => [k, { ...v, rankings: (v.rankings || []).slice(0, PER_CATEGORY), total_in_category: (v.rankings || []).length }]));
const json = { ...full, meta: { ...full.meta, note: `Public summary: top ${TOP} overall and top ${PER_CATEGORY} per category. Totals are in summary. Per-service cards: https://kansei-link.com/services/<id>/` }, summary: { ...full.summary, overall_listed: (full.overall_top || []).length }, category_rankings };
fs.writeFileSync("public/aeo-data.json", JSON.stringify(json, null, 2));

const rankings = json.overall_top;
fs.writeFileSync(
  "public/rankings-raw.json",
  JSON.stringify({ rankings, summary: json.summary, catRankings: json.category_rankings }, null, 2), // same summary shape as aeo-data.json
);

const withRate = rankings.filter((r) => r.success_rate !== null);
console.log("overall_top:", rankings.length, "| entries with public success_rate:", withRate.length);
withRate.slice(0, 8).forEach((r) => console.log("  rate kept:", r.service_id, r.success_rate + "%", r.total_agent_calls, "calls"));
console.log("top3:", rankings.slice(0, 3).map((r) => `${r.service_id}:${r.grade}:${r.success_rate === null ? "null" : r.success_rate}`).join(", "));
console.log("verified total:", json.summary?.agent_readiness ? JSON.stringify(json.summary.agent_readiness) : "n/a");
