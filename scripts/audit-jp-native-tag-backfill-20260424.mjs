#!/usr/bin/env node
/**
 * Backfill `jp-native` tag on well-known JP SaaS services so the new
 * JP-native search boost (audit 2026-04-24 recommendation #4) actually
 * activates for them.
 *
 * Services tagged here are known JP-market-native products. Adding the
 * tag lets search_services rank them above Slack / SendGrid / etc. for
 * Japanese-language queries.
 *
 *   node scripts/audit-jp-native-tag-backfill-20260424.mjs
 *   node scripts/audit-jp-native-tag-backfill-20260424.mjs --dry-run
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const DRY_RUN = process.argv.includes("--dry-run");

// Curated list of unambiguously JP-native SaaS already in the DB.
// Order matters for logs only — dedupe enforced at tag-level.
const JP_NATIVE_IDS = [
  "freee", "freee-hr", "moneyforward", "smarthr", "sansan",
  "chatwork", "kintone", "garoon", "backlog", "cloudsign",
  "base-ec", "stores-jp", "lineworks", "line-messaging", "line-pay",
  "jooto", "kingoftime", "hubspot-jp", "shopify-jp", "rakuten-travel",
  "treasure-data", "salesgo", "gmo-sign", "yayoi", "freee-payroll",
  "jobcan", "cybozu-office", "smaregi", "airregi", "square-jp",
  "paypay", "yamato-b2", "sagawa", "japan-post", "toyokeizai",
  "toyocloud", "bmr", "edi-ace", "misoca",
];

const db = new Database(dbPath);
console.log("=== jp-native tag backfill ===");
console.log(DRY_RUN ? "(dry-run — no changes)" : "");

let added = 0;
let skipped = 0;
let notFound = 0;

for (const id of JP_NATIVE_IDS) {
  const row = db.prepare("SELECT id, name, tags FROM services WHERE id = ?").get(id);
  if (!row) {
    notFound++;
    continue;
  }
  const tags = (row.tags ?? "").toLowerCase();
  if (tags.includes("jp-native") || tags.includes("jp_native")) {
    skipped++;
    continue;
  }
  // Parse existing tags (may be JSON array or comma-separated)
  let tagList;
  try {
    const parsed = JSON.parse(row.tags || "[]");
    tagList = Array.isArray(parsed) ? parsed : [];
  } catch {
    tagList = (row.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  }
  tagList.push("jp-native");
  const newTags = JSON.stringify(tagList);

  console.log(`  [add] ${id} (${row.name}) — jp-native`);
  if (DRY_RUN) continue;
  db.prepare("UPDATE services SET tags = ? WHERE id = ?").run(newTags, id);
  added++;
}

console.log(`\nadded: ${added}, skipped (already tagged): ${skipped}, not found: ${notFound}`);
db.close();
