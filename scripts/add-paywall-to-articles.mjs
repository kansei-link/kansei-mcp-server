#!/usr/bin/env node
/**
 * Add paywall gating to category AEO articles.
 *
 * Strategy:
 * - The AXR data section (auto-injected) becomes data-tier="pro"
 * - Free users see: overview, service analysis, FAQ, AXR headline stats
 * - Pro users see: full AXR distribution, top services, top recipes
 * - Adds paywall.js script tag before </body>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const JA_DIR = 'public/insights';
const EN_DIR = 'public/en/insights';

const CATEGORIES = [
  'accounting', 'hr', 'communication', 'crm', 'ecommerce',
  'marketing', 'payment', 'project-mgmt', 'support', 'bi-analytics'
];

let updated = 0;
let skipped = 0;

for (const cat of CATEGORIES) {
  for (const [dir, paywallPath] of [[JA_DIR, '/js/paywall.js'], [EN_DIR, '/js/paywall.js']]) {
    const file = `${dir}/${cat}-saas-aeo-2026.html`;
    if (!existsSync(file)) {
      console.log(`[SKIP] ${file} — not found`);
      skipped++;
      continue;
    }

    let html = readFileSync(file, 'utf-8');

    // Skip if already has paywall
    if (html.includes('data-tier=')) {
      console.log(`[SKIP] ${file} — already has paywall`);
      skipped++;
      continue;
    }

    // 1. Wrap AXR section with data-tier="pro"
    // The AXR section starts with <!-- AXR × Recipe Test Section -->
    // and ends with <!-- /AXR Section -->
    const axrStart = '<!-- AXR × Recipe Test Section';
    const axrEnd = '<!-- /AXR Section -->';

    const startIdx = html.indexOf(axrStart);
    const endIdx = html.indexOf(axrEnd);

    if (startIdx === -1 || endIdx === -1) {
      console.log(`[SKIP] ${file} — no AXR section found`);
      skipped++;
      continue;
    }

    // Insert opening div before the AXR comment
    html = html.slice(0, startIdx) +
           '<div data-tier="pro">\n    ' +
           html.slice(startIdx, endIdx + axrEnd.length) +
           '\n    </div><!-- /data-tier="pro" -->' +
           html.slice(endIdx + axrEnd.length);

    // 2. Add paywall.js if not already present
    if (!html.includes('paywall.js')) {
      html = html.replace('</body>', `<script src="${paywallPath}"></script>\n</body>`);
    }

    writeFileSync(file, html, 'utf-8');
    console.log(`[OK] ${file}`);
    updated++;
  }
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
