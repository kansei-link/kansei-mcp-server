#!/usr/bin/env node
/**
 * Regenerate src/data/services-seed.json + recipes-seed.json from current DB.
 *
 * Run this after the daily crawler accepts new services so that Railway's
 * next deploy picks them up.
 *
 *   node scripts/regen-seed.mjs
 *
 * Safe to run any time — writes a clean snapshot. Diff the output before
 * committing if you want to review what changed.
 */
import Database from "better-sqlite3";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const servicesOut = path.join(__dirname, "..", "src", "data", "services-seed.json");
const recipesOut = path.join(__dirname, "..", "src", "data", "recipes-seed.json");
const changelogOut = path.join(__dirname, "..", "src", "data", "changelog-seed.json");

if (!existsSync(dbPath)) {
  console.error(`[regen-seed] DB not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// ---------- services ----------
const serviceRows = db
  .prepare(
    `SELECT id, name, namespace, description, category, tags,
            mcp_endpoint, mcp_status, api_url, api_auth_method, trust_score,
            axr_score, axr_grade, axr_dims, axr_facade
     FROM services
     ORDER BY id ASC`
  )
  .all();

const services = serviceRows.map((r) => {
  const out = {
    id: r.id,
    name: r.name,
    namespace: r.namespace || "",
    description: r.description || "",
    category: r.category || "other",
    tags: r.tags || "[]",
    mcp_endpoint: r.mcp_endpoint || "",
    mcp_status: r.mcp_status || "none",
    trust_score: r.trust_score ?? 0.5,
  };
  if (r.api_url) out.api_url = r.api_url;
  if (r.api_auth_method) out.api_auth_method = r.api_auth_method;
  if (r.axr_score !== null && r.axr_score !== undefined) out.axr_score = r.axr_score;
  if (r.axr_grade) out.axr_grade = r.axr_grade;
  if (r.axr_dims) {
    try {
      out.axr_dims = typeof r.axr_dims === "string" ? JSON.parse(r.axr_dims) : r.axr_dims;
    } catch {
      /* drop malformed dims */
    }
  }
  if (r.axr_facade !== null && r.axr_facade !== undefined) out.axr_facade = r.axr_facade;
  return out;
});

// ---------- recipes ----------
const recipeRows = db
  .prepare(
    `SELECT id, goal, description, steps, required_services, gotchas
     FROM recipes
     ORDER BY id ASC`
  )
  .all();

const recipes = recipeRows.map((r) => {
  const parseJson = (v, fallback) => {
    if (!v) return fallback;
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  };
  return {
    id: r.id,
    goal: r.goal,
    description: r.description || "",
    steps: parseJson(r.steps, []),
    required_services: parseJson(r.required_services, []),
    gotchas: parseJson(r.gotchas, []),
  };
});

// ---------- changelog ----------
// Only sync entries from the last 180 days to keep the seed file bounded.
// Older history stays in the live DB but doesn't get re-seeded into Railway
// on every deploy (Railway's DB keeps its own long-tail via persistence).
const changelogRows = db
  .prepare(
    `SELECT service_id, change_date, change_type, summary, details
     FROM service_changelog
     WHERE change_date >= date('now', '-180 days')
     ORDER BY change_date DESC, service_id ASC`
  )
  .all();

const changelog = changelogRows.map((r) => {
  const out = {
    service_id: r.service_id,
    change_date: r.change_date,
    change_type: r.change_type,
    summary: r.summary,
  };
  if (r.details) out.details = r.details;
  return out;
});

// ---------- write ----------
// Preserve pre-change counts for a human-readable diff summary.
const prevServicesCount = existsSync(servicesOut)
  ? JSON.parse(readFileSync(servicesOut, "utf-8")).length
  : 0;
const prevRecipesCount = existsSync(recipesOut)
  ? JSON.parse(readFileSync(recipesOut, "utf-8")).length
  : 0;
const prevChangelogCount = existsSync(changelogOut)
  ? JSON.parse(readFileSync(changelogOut, "utf-8")).length
  : 0;

writeFileSync(servicesOut, JSON.stringify(services, null, 2) + "\n", "utf-8");
writeFileSync(recipesOut, JSON.stringify(recipes, null, 2) + "\n", "utf-8");
writeFileSync(changelogOut, JSON.stringify(changelog, null, 2) + "\n", "utf-8");

console.log("=== regen-seed ===");
console.log(`services:  ${prevServicesCount} -> ${services.length}  (${services.length - prevServicesCount >= 0 ? "+" : ""}${services.length - prevServicesCount})`);
console.log(`recipes:   ${prevRecipesCount} -> ${recipes.length}  (${recipes.length - prevRecipesCount >= 0 ? "+" : ""}${recipes.length - prevRecipesCount})`);
console.log(`changelog: ${prevChangelogCount} -> ${changelog.length}  (${changelog.length - prevChangelogCount >= 0 ? "+" : ""}${changelog.length - prevChangelogCount})  [last 180 days]`);
console.log();
console.log(`wrote: ${servicesOut}`);
console.log(`wrote: ${recipesOut}`);
console.log(`wrote: ${changelogOut}`);

db.close();
