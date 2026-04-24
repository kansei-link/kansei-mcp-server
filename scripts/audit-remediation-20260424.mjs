#!/usr/bin/env node
/**
 * Audit remediation script (2026-04-24)
 *
 * Addresses findings from _audit-report-2026-04-24.md:
 *   Action 1: Archive 1 dead endpoint (lofder-dsers-mcp-product, 404)
 *             + mark Zapier as auth-required (for crawler exclusion on 401s)
 *   Action 2: Reclassify 4-6 community repos misclassified to DeFi & Web3
 *             or with clearly-wrong categories (Confluence, Bifrost, Trace,
 *             LeanKG + any others that match the pattern)
 *
 * Safe to re-run: every statement is idempotent (INSERT OR IGNORE / UPDATE
 * only touches known-bad rows).
 *
 *   node scripts/audit-remediation-20260424.mjs              # apply
 *   node scripts/audit-remediation-20260424.mjs --dry-run    # preview
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const DRY_RUN = process.argv.includes("--dry-run");

const db = new Database(dbPath);

// ─── Action 1: Archive dead endpoints ─────────────────────────────
const archives = [
  {
    id: "lofder-dsers-mcp-product",
    reason: "GitHub repo deleted (404 confirmed via audit 2026-04-24)",
  },
];

// Mark services that return 401 (auth required) so the crawler doesn't keep
// flagging them as "broken". Zapier is the known case — its MCP endpoint
// IS live, just requires an API key the crawler doesn't have.
const authRequired = [
  {
    id: "zapier",
    note: "Zapier MCP endpoint returns 401 without API key — expected behavior",
  },
];

// ─── Action 2: Reclassify misclassified community repos ───────────
// From audit report clearly-wrong + questionable-with-obvious-signal lists.
// Only includes entries where the correct category is UNAMBIGUOUS.
// Ambiguous cases (Heroku, ActiveCampaign) are left for human review.
const reclassifications = [
  {
    id: "confluence",
    before: "groupware",
    after: "Knowledge & Docs",
    reason: "Atlassian wiki — textbook Knowledge & Docs. groupware is too generic.",
  },
  {
    id: "maximhq-bifrost",
    before: "DeFi & Web3",
    after: "AI & LLM",
    reason: "Bifrost is an AI model gateway, not blockchain. Classifier defaulted to DeFi due to sparse description.",
  },
  {
    id: "nikolai-vysotskyi-trace-mcp",
    before: "DeFi & Web3",
    after: "AI & LLM",
    reason: "Trace is AI observability/tracing. Not blockchain-related.",
  },
  {
    id: "freepeak-leankg",
    before: "DeFi & Web3",
    after: "Developer Tools",
    reason: "LeanKG is a knowledge-graph dev tool. Not DeFi.",
  },
];

// ─── Execute ─────────────────────────────────────────────────────
console.log("=== audit remediation 2026-04-24 ===");
console.log(DRY_RUN ? "(dry-run — no changes will be written)" : "");

// Verify schema: does services have an `archived` column?
const cols = db.prepare("PRAGMA table_info(services)").all().map((c) => c.name);
const hasArchived = cols.includes("archived");
if (!hasArchived) {
  console.log("[!] services.archived column not found. Skipping archive. Use axr_score=NULL approach.");
}

// ─── Apply Action 1 ──────────────────────────────────────────────
console.log("\n--- Action 1: archive dead endpoints ---");
for (const a of archives) {
  const row = db.prepare("SELECT id, name, axr_score FROM services WHERE id = ?").get(a.id);
  if (!row) {
    console.log(`  [skip] ${a.id}: not in services table`);
    continue;
  }
  console.log(`  ${a.id} (${row.name}) — ${a.reason}`);
  if (DRY_RUN) continue;

  if (hasArchived) {
    db.prepare("UPDATE services SET archived = 1, axr_score = NULL, axr_grade = NULL WHERE id = ?").run(a.id);
  } else {
    // Fallback: hide from rankings by nulling axr_score (same pattern as infra cleanup)
    db.prepare("UPDATE services SET axr_score = NULL, axr_grade = NULL WHERE id = ?").run(a.id);
  }
}

console.log("\n--- Zapier auth-required note (descriptive only) ---");
for (const z of authRequired) {
  const row = db.prepare("SELECT id, name, api_auth_method FROM services WHERE id = ?").get(z.id);
  if (!row) {
    console.log(`  [skip] ${z.id}: not in services table`);
    continue;
  }
  console.log(`  ${z.id} (${row.name}): current api_auth_method="${row.api_auth_method ?? "null"}" — ${z.note}`);
  // Only update if currently null — don't overwrite community-enriched values.
  if (DRY_RUN) continue;
  if (!row.api_auth_method) {
    db.prepare("UPDATE services SET api_auth_method = 'api_key' WHERE id = ?").run(z.id);
    console.log(`    → set api_auth_method = 'api_key'`);
  } else {
    console.log(`    (already has api_auth_method, not overwriting)`);
  }
}

// ─── Apply Action 2 ──────────────────────────────────────────────
console.log("\n--- Action 2: reclassify misclassified community repos ---");
let appliedCount = 0;
for (const r of reclassifications) {
  const row = db.prepare("SELECT id, name, category FROM services WHERE id = ?").get(r.id);
  if (!row) {
    console.log(`  [skip] ${r.id}: not in services table`);
    continue;
  }
  console.log(`  ${r.id} (${row.name})`);
  console.log(`    ${row.category} → ${r.after}  — ${r.reason}`);
  if (DRY_RUN) continue;
  if (row.category !== r.after) {
    db.prepare("UPDATE services SET category = ? WHERE id = ?").run(r.after, r.id);
    appliedCount++;
  } else {
    console.log(`    (already ${r.after}, no change)`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────
console.log("\n=== summary ===");
console.log(`archive candidates processed: ${archives.length}`);
console.log(`auth-required marked:         ${authRequired.length}`);
console.log(`reclassifications applied:    ${appliedCount} / ${reclassifications.length}`);
if (DRY_RUN) console.log("(dry-run — nothing written)");

db.close();
