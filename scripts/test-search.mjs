#!/usr/bin/env node
/**
 * Direct search quality test — bypasses MCP, calls searchServices directly.
 * Verifies that v3 algorithm changes are working.
 */
import { searchServices } from "../dist/tools/search-services.js";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.KANSEI_DB_PATH || path.join(__dirname, "..", "kansei-link.db");

const db = new Database(dbPath);

const queries = [
  { intent: "AI inference API", expected: ["groq", "openai-api", "cohere", "mistral"] },
  { intent: "勤怠管理", expected: ["kingoftime", "jobcan", "teamspirit"] },
  { intent: "電子契約", expected: ["cloudsign", "freee-sign"] },
  { intent: "CI/CD deployment", expected: ["github-actions", "circleci", "render", "fly-io"] },
  { intent: "customer data platform", expected: ["segment", "mixpanel", "amplitude", "bdash"] },
  { intent: "e-commerce order management", expected: ["shopify-jp", "base-ec", "bigcommerce"] },
  { intent: "employee onboarding HR", expected: ["smarthr", "freee-hr", "bamboohr", "gusto"] },
  { intent: "project task management", expected: ["backlog", "asana", "clickup", "notion"] },
];

for (const { intent, expected } of queries) {
  const results = searchServices(db, intent, undefined, 15);
  const ids = results.map((r) => r.service_id);
  const scores = results.map((r) => `${r.service_id}(${r.relevance_score})`);

  const found = expected.filter((e) => ids.includes(e));
  const missing = expected.filter((e) => !ids.includes(e));
  const grade = found.length === expected.length ? "PASS" :
                found.length >= expected.length * 0.7 ? "PARTIAL" : "FAIL";

  console.log(`\n--- "${intent}" [${grade}] ---`);
  console.log(`  Top 10: ${scores.join(", ")}`);
  console.log(`  Found: ${found.join(", ")} | Missing: ${missing.join(", ") || "none"}`);

  // Show category of top 3
  const top3 = results.slice(0, 3).map((r) => `${r.service_id}[${r.category}]`);
  console.log(`  Top 3: ${top3.join(", ")}`);
}

db.close();
