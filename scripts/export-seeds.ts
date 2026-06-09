#!/usr/bin/env tsx
/**
 * Export current DB state → seed JSON files for npm packaging.
 * Run before `npm publish` to ensure seed data matches the live DB.
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../kansei-link.db");
const DATA_DIR = resolve(import.meta.dirname, "../src/data");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// 1. Export services (exclude archived)
const services = db.prepare(`
  SELECT id, name, namespace, description, category, tags,
         mcp_endpoint, mcp_status, trust_score, axr_score, axr_grade, axr_facade,
         api_url, api_auth_method, mcp_tool_count, avg_tool_def_tokens,
         github_stars, github_pushed_at, npm_version
  FROM services
  WHERE archived = 0
  ORDER BY trust_score DESC, id
`).all();

writeFileSync(
  resolve(DATA_DIR, "services-seed.json"),
  JSON.stringify(services),
  "utf-8"
);
console.error(`services: ${services.length}`);

// 2. Export recipes
const recipes = db.prepare(
  "SELECT id, goal, description, steps, required_services, gotchas FROM recipes ORDER BY id"
).all();
writeFileSync(
  resolve(DATA_DIR, "recipes-seed.json"),
  JSON.stringify(recipes),
  "utf-8"
);
console.error(`recipes: ${recipes.length}`);

// 3. Export API guides
const guides = db.prepare(
  "SELECT * FROM service_api_guides ORDER BY service_id"
).all();
writeFileSync(
  resolve(DATA_DIR, "api-guides-seed.json"),
  JSON.stringify(guides),
  "utf-8"
);
console.error(`guides: ${guides.length}`);

db.close();
console.error("Done — seed files updated.");
