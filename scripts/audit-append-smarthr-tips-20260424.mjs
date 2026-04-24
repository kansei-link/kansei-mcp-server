#!/usr/bin/env node
/**
 * Append reliability tips to SmartHR based on audit 2026-04-24 deep-dive.
 * Patterns surfaced from real agent outcome reports — not guesses.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "..", "kansei-link.db"));

const SMARTHR_NEW_TIPS = [
  "Prefer the v2 REST endpoint over v1. Multiple agents reported v1 returns inconsistent results on /employees — v2 fixes several of those edge cases.",
  "OAuth access tokens expire faster than the documented 24h in practice (often 1-2h). Implement proactive refresh: if your last token mint was >60 minutes ago, refresh before any write operation to avoid 401 mid-transaction.",
  "For bulk employee exports, paginate by department rather than by offset. Single-org exports timeout on large tenants; department-scoped requests finish in seconds.",
];

const row = db
  .prepare(`SELECT service_id, agent_tips FROM service_api_guides WHERE service_id = 'smarthr'`)
  .get();
if (!row) {
  console.error("SmartHR service_api_guides row not found");
  process.exit(1);
}

let tips;
try {
  tips = JSON.parse(row.agent_tips ?? "[]");
} catch {
  tips = [];
}
const before = tips.length;
for (const t of SMARTHR_NEW_TIPS) {
  if (!tips.some((existing) => existing === t)) tips.push(t);
}
const after = tips.length;

console.log(`tips before: ${before}, after: ${after}, added: ${after - before}`);
if (after > before) {
  db.prepare(`UPDATE service_api_guides SET agent_tips = ? WHERE service_id = 'smarthr'`).run(JSON.stringify(tips));
  console.log("[applied]");
}
db.close();
