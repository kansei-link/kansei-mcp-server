#!/usr/bin/env node
/**
 * Add "Pricing" link to nav bars across all HTML pages.
 * Inserts after the Methodology or Insights link in the nav.
 */

import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'fs';

// Use simple approach: find all HTML files
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function findHtml(dir) {
  const results = [];
  try {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      const stat = statSync(full);
      if (stat.isDirectory() && !f.startsWith('.') && f !== 'node_modules' && f !== 'dist') {
        results.push(...findHtml(full));
      } else if (f.endsWith('.html')) {
        results.push(full);
      }
    }
  } catch (e) { /* ignore */ }
  return results;
}

const ROOT = 'public';
const files = findHtml(ROOT);

let updated = 0;

for (const file of files) {
  let html = readFileSync(file, 'utf-8');

  // Skip if already has Pricing in nav
  if (html.includes('>Pricing<') || html.includes('>料金プラン<')) {
    continue;
  }

  // Skip subscription pages, they don't have nav
  if (file.includes('subscription')) continue;

  // Determine if this is an EN or JA page
  const isEn = file.includes('/en/') || file.includes('\\en\\');

  // Determine relative path to pricing.html based on file depth
  const isInsights = file.includes('insights');
  let pricingHref;
  if (isEn && isInsights) {
    pricingHref = '../../pricing.html'; // en/insights/ → pricing.html (wrong, EN has its own)
    // Actually: en/insights/*.html → ../pricing.html
    pricingHref = '../pricing.html';
  } else if (isEn) {
    pricingHref = 'pricing.html';
  } else if (isInsights) {
    pricingHref = '../pricing.html';
  } else {
    pricingHref = 'pricing.html';
  }

  const label = isEn ? 'Pricing' : 'Pricing';

  // Find the nav and insert Pricing after Methodology or About
  // Pattern: look for </li> before <li class="mobile-only"> or before </ul> in nav
  // Strategy: insert after the "About" link
  const aboutPattern = /<li><a href="[^"]*about\.html"[^>]*>About<\/a><\/li>/;
  const match = html.match(aboutPattern);

  if (match) {
    const insertAfter = match[0];
    const pricingLi = `\n        <li><a href="${pricingHref}">Pricing</a></li>`;
    // Insert before About
    html = html.replace(insertAfter, `<li><a href="${pricingHref}">${label}</a></li>\n        ${insertAfter}`);
    writeFileSync(file, html, 'utf-8');
    console.log(`[OK] ${file}`);
    updated++;
  }
}

console.log(`\nDone: ${updated} files updated`);
