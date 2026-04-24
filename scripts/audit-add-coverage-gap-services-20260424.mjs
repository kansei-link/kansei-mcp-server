#!/usr/bin/env node
/**
 * Add services to close coverage gaps identified by audit 2026-04-24.
 *
 * The audit found 2 queries that returned ZERO results (翻訳, 動画配信) and
 * 6 queries with wildly wrong top-1 results (アンケート returning credit-card
 * tool, EDI returning Twitter, etc.). This script adds 6 carefully-chosen
 * services that correctly fill those semantic gaps.
 *
 * Entries added use mcp_status='api_only' — we're registering the SaaS/API,
 * not claiming an MCP server exists for it. When a real MCP appears later
 * (or a community PR), the crawler / refresh pipeline can update the row.
 *
 *   node scripts/audit-add-coverage-gap-services-20260424.mjs
 *   node scripts/audit-add-coverage-gap-services-20260424.mjs --dry-run
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const DRY_RUN = process.argv.includes("--dry-run");

const services = [
  // 翻訳ギャップ (zero-result query #41)
  {
    id: "deepl",
    name: "DeepL",
    namespace: "DeepL SE",
    description: "High-accuracy neural machine translation API, strong Japanese↔English performance used by many JP enterprises.",
    category: "AI & LLM",
    tags: JSON.stringify(["translation", "nmt", "jp-native", "multilingual"]),
    mcp_endpoint: null,
    mcp_status: "api_only",
    api_url: "https://api.deepl.com/v2/",
    api_auth_method: "api_key",
    trust_score: 0.8,
    axr_score: null,
    axr_grade: null,
    axr_dims: null,
    axr_facade: 0,
  },
  {
    id: "google-translate",
    name: "Google Cloud Translation",
    namespace: "Google Cloud",
    description: "Google Cloud's translation API covering 130+ languages. Broad coverage with neural translation (NMT) models.",
    category: "AI & LLM",
    tags: JSON.stringify(["translation", "google-cloud", "nmt", "multilingual"]),
    mcp_endpoint: null,
    mcp_status: "api_only",
    api_url: "https://translation.googleapis.com/language/translate/v2",
    api_auth_method: "oauth2",
    trust_score: 0.8,
    axr_score: null,
    axr_grade: null,
    axr_dims: null,
    axr_facade: 0,
  },
  // 動画配信ギャップ (zero-result query #57)
  {
    id: "vimeo",
    name: "Vimeo",
    namespace: "Vimeo",
    description: "Video hosting, streaming, and player platform. Developer API for uploads, transcoding, embedded playback, analytics.",
    category: "Media & Content",
    tags: JSON.stringify(["video-hosting", "streaming", "embed"]),
    mcp_endpoint: null,
    mcp_status: "api_only",
    api_url: "https://api.vimeo.com/",
    api_auth_method: "oauth2",
    trust_score: 0.75,
    axr_score: null,
    axr_grade: null,
    axr_dims: null,
    axr_facade: 0,
  },
  // アンケート / Survey ギャップ (bad query #45)
  {
    id: "typeform",
    name: "Typeform",
    namespace: "Typeform",
    description: "Conversational form and survey builder with developer API for creating forms, retrieving responses, and webhooks.",
    category: "Productivity",
    tags: JSON.stringify(["forms", "survey", "webhook"]),
    mcp_endpoint: null,
    mcp_status: "api_only",
    api_url: "https://api.typeform.com/",
    api_auth_method: "oauth2",
    trust_score: 0.75,
    axr_score: null,
    axr_grade: null,
    axr_dims: null,
    axr_facade: 0,
  },
  // EDI ギャップ (bad query #58 — 物流/B2B Japan)
  {
    id: "edi-ace",
    name: "EDI-ACE",
    namespace: "NTT Data",
    description: "Japanese B2B EDI platform (流通BMS 対応). Standard EDI for distribution and logistics integrations between retailers, wholesalers, and manufacturers in Japan.",
    category: "Data & Analytics",
    tags: JSON.stringify(["edi", "b2b", "jp-native", "logistics", "流通bms"]),
    mcp_endpoint: null,
    mcp_status: "api_only",
    api_url: null,
    api_auth_method: null,
    trust_score: 0.7,
    axr_score: null,
    axr_grade: null,
    axr_dims: null,
    axr_facade: 0,
  },
  // バックアップ ギャップ (bad query #52)
  {
    id: "aws-backup",
    name: "AWS Backup",
    namespace: "Amazon Web Services",
    description: "Centralized, policy-based backup service for AWS resources (EBS, RDS, DynamoDB, EFS, S3, etc.) with cross-region and cross-account protection.",
    category: "File Storage",
    tags: JSON.stringify(["backup", "aws", "disaster-recovery", "cloud"]),
    mcp_endpoint: null,
    mcp_status: "api_only",
    api_url: "https://backup.us-east-1.amazonaws.com/",
    api_auth_method: "api_key",
    trust_score: 0.75,
    axr_score: null,
    axr_grade: null,
    axr_dims: null,
    axr_facade: 0,
  },
];

const db = new Database(dbPath);
console.log("=== add coverage-gap services (2026-04-24 audit) ===");
console.log(DRY_RUN ? "(dry-run — no changes)" : "");

const insertOrSkip = db.prepare(`
  INSERT OR IGNORE INTO services
    (id, name, namespace, description, category, tags, mcp_endpoint,
     mcp_status, api_url, api_auth_method, trust_score, axr_score,
     axr_grade, axr_dims, axr_facade)
  VALUES
    (@id, @name, @namespace, @description, @category, @tags, @mcp_endpoint,
     @mcp_status, @api_url, @api_auth_method, @trust_score, @axr_score,
     @axr_grade, @axr_dims, @axr_facade)
`);

const insertStats = db.prepare(`
  INSERT OR IGNORE INTO service_stats (service_id) VALUES (?)
`);

let added = 0;
let skipped = 0;

for (const s of services) {
  const existing = db.prepare("SELECT id FROM services WHERE id = ?").get(s.id);
  if (existing) {
    console.log(`  [skip] ${s.id}: already exists`);
    skipped++;
    continue;
  }
  console.log(`  [add ] ${s.id} — ${s.name} (${s.category})`);
  if (DRY_RUN) continue;
  insertOrSkip.run(s);
  insertStats.run(s.id);
  added++;
}

console.log(`\nadded: ${added}, skipped: ${skipped}`);
db.close();
