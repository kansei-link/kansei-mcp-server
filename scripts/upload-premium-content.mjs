#!/usr/bin/env node
/**
 * Upload extracted premium sections to the Railway server DB.
 *
 * Reads premium-sections.local.json (created by extract-premium-sections.mjs)
 * and POSTs it to /admin/premium-content, authenticated with CRAWLER_SECRET.
 *
 * Usage:
 *   CRAWLER_SECRET=...  node scripts/upload-premium-content.mjs
 *   CRAWLER_SECRET=...  KANSEI_API_BASE=http://localhost:3000  node scripts/upload-premium-content.mjs
 *
 * Run this AFTER each deploy that changes premium sections (the JSON is
 * gitignored — content must never land in the public repo).
 */

import { readFileSync, existsSync } from "fs";

const IN_FILE = "premium-sections.local.json";
const API_BASE = (process.env.KANSEI_API_BASE || "https://kansei-link-mcp-production-b054.up.railway.app").replace(/\/+$/, "");
const SECRET = process.env.CRAWLER_SECRET;

if (!SECRET) {
  console.error("CRAWLER_SECRET env var required");
  process.exit(1);
}
if (!existsSync(IN_FILE)) {
  console.error(`${IN_FILE} not found — run: node scripts/extract-premium-sections.mjs`);
  process.exit(1);
}

const payload = JSON.parse(readFileSync(IN_FILE, "utf-8"));
const sections = payload.sections ?? [];
console.log(`Uploading ${sections.length} section(s) to ${API_BASE}/admin/premium-content …`);

const res = await fetch(`${API_BASE}/admin/premium-content`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ sections }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok || !body.ok) {
  console.error(`Upload failed (HTTP ${res.status}):`, JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(`OK — upserted ${body.upserted} section(s).`);

// Verify inventory matches
const inv = await fetch(`${API_BASE}/admin/premium-content`, {
  headers: { Authorization: `Bearer ${SECRET}` },
});
const invBody = await inv.json().catch(() => ({}));
console.log(`Server now holds ${invBody.count} premium section(s).`);
