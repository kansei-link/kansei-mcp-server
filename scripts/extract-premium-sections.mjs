#!/usr/bin/env node
/**
 * Extract premium (data-tier) sections OUT of the static article HTML.
 *
 * Why: the repo is public and GitHub Pages serves the raw HTML, so any
 * "gated" content left in the page source is readable by everyone. Real
 * enforcement = the content lives only in the Railway server DB and is
 * served by GET /api/premium to authenticated subscribers.
 *
 * What this does, per article containing a data-tier section:
 *   1. Extracts the inner HTML of  <div data-tier="pro"> … </div><!-- /data-tier="pro" -->
 *   2. Replaces it with an empty placeholder carrying data-premium-id
 *      (public/js/paywall.js fetches + injects the content for subscribers)
 *   3. Collects all sections into premium-sections.local.json (GITIGNORED —
 *      never commit it; upload with scripts/upload-premium-content.mjs)
 *
 * Idempotent: files already carrying data-premium-id are skipped.
 *
 * Usage:  node scripts/extract-premium-sections.mjs [--dry]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import path from "path";

const DRY = process.argv.includes("--dry");
const PUBLIC_DIR = "public";
const OUT_FILE = "premium-sections.local.json";

const ARTICLE_DIRS = ["insights", "en/insights"];

// Markers produced by scripts/add-paywall-to-articles.mjs
const OPEN_RE = /<div data-tier="(pro|team)">/g;

function closeMarker(tier) {
  return `</div><!-- /data-tier="${tier}" -->`;
}

const sections = [];
let filesUpdated = 0;
let filesSkipped = 0;

for (const dir of ARTICLE_DIRS) {
  const full = path.join(PUBLIC_DIR, dir);
  if (!existsSync(full)) continue;

  for (const name of readdirSync(full)) {
    if (!name.endsWith(".html")) continue;
    const filePath = path.join(full, name);
    let html = readFileSync(filePath, "utf-8");

    if (!html.includes("data-tier=")) continue;
    if (html.includes("data-premium-id=")) {
      console.log(`[SKIP] ${filePath} — already migrated`);
      filesSkipped++;
      continue;
    }

    const articleBase = `${dir}/${name.replace(/\.html$/, "")}`; // e.g. insights/accounting-saas-aeo-2026
    const lang = dir.startsWith("en/") ? "en" : "ja";

    let sectionIndex = 0;
    let changed = false;

    // Repeatedly find the first remaining open marker and its close marker.
    for (;;) {
      OPEN_RE.lastIndex = 0;
      const open = OPEN_RE.exec(html);
      if (!open) break;

      const tier = open[1];
      const close = closeMarker(tier);
      const innerStart = open.index + open[0].length;
      const closeIdx = html.indexOf(close, innerStart);
      if (closeIdx === -1) {
        console.error(`[ERROR] ${filePath} — open marker without close marker; manual fix needed`);
        process.exitCode = 1;
        break;
      }

      const inner = html.slice(innerStart, closeIdx);
      if (inner.trim().length < 100) {
        console.error(`[ERROR] ${filePath} — extracted section suspiciously small (${inner.trim().length} chars)`);
        process.exitCode = 1;
        break;
      }

      sectionIndex++;
      const articleId = sectionIndex === 1 ? articleBase : `${articleBase}--s${sectionIndex}`;
      sections.push({ article_id: articleId, tier, lang, html: inner });

      const placeholder =
        `<div data-tier="${tier}" data-premium-id="${articleId}">\n` +
        `      <!-- Premium section: served from the KanseiLink API to subscribers. Not included in static HTML. -->\n` +
        `    ${close}`;

      html = html.slice(0, open.index) + placeholder + html.slice(closeIdx + close.length);
      changed = true;
    }

    if (changed) {
      if (!DRY) writeFileSync(filePath, html, "utf-8");
      console.log(`[OK] ${filePath} — ${sectionIndex} section(s) → ${articleBase}`);
      filesUpdated++;
    }
  }
}

if (!DRY && sections.length > 0) {
  writeFileSync(
    OUT_FILE,
    JSON.stringify({ generated_at: new Date().toISOString(), sections }, null, 2),
    "utf-8"
  );
}

const totalBytes = sections.reduce((n, s) => n + s.html.length, 0);
console.log(
  `\nDone${DRY ? " (dry run)" : ""}: ${filesUpdated} file(s) migrated, ${filesSkipped} skipped, ` +
  `${sections.length} section(s) → ${OUT_FILE} (${Math.round(totalBytes / 1024)} KB total)`
);
if (sections.length > 0 && !DRY) {
  console.log(`Next: node scripts/upload-premium-content.mjs   (requires CRAWLER_SECRET + deployed /admin/premium-content)`);
}
