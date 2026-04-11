#!/usr/bin/env node
/**
 * Add hreflang tags to all JA/EN page pairs for multilingual SEO.
 *
 * Inserts into <head>:
 *   <link rel="alternate" hreflang="ja" href="https://kansei-link.com/..." />
 *   <link rel="alternate" hreflang="en" href="https://kansei-link.com/en/..." />
 *   <link rel="alternate" hreflang="x-default" href="https://kansei-link.com/..." />
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const BASE_URL = 'https://kansei-link.com';
const PUBLIC_DIR = 'public';

function findHtml(dir) {
  const results = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const stat = statSync(full);
    if (stat.isDirectory() && !f.startsWith('.') && f !== 'node_modules' && f !== 'dist') {
      results.push(...findHtml(full));
    } else if (f.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = findHtml(PUBLIC_DIR);

// Build a map of JA → EN pairs
// JA files: public/*.html, public/insights/*.html, public/subscription/*.html
// EN files: public/en/*.html, public/en/insights/*.html, public/en/subscription/*.html
const pairs = [];

for (const file of allFiles) {
  const rel = relative(PUBLIC_DIR, file).replace(/\\/g, '/');

  // Skip EN files (we'll process them as part of the JA pair)
  if (rel.startsWith('en/')) continue;

  // Find EN counterpart
  const enRel = 'en/' + rel;
  const enFile = join(PUBLIC_DIR, enRel);

  if (existsSync(enFile)) {
    pairs.push({
      ja: { file, url: `${BASE_URL}/${rel}` },
      en: { file: enFile, url: `${BASE_URL}/${enRel}` },
    });
  } else {
    // JA-only page — add self-referencing hreflang
    pairs.push({
      ja: { file, url: `${BASE_URL}/${rel}` },
      en: null,
    });
  }
}

// Also find EN-only pages (no JA counterpart)
for (const file of allFiles) {
  const rel = relative(PUBLIC_DIR, file).replace(/\\/g, '/');
  if (!rel.startsWith('en/')) continue;

  const jaRel = rel.replace(/^en\//, '');
  const jaFile = join(PUBLIC_DIR, jaRel);
  if (!existsSync(jaFile)) {
    pairs.push({
      ja: null,
      en: { file, url: `${BASE_URL}/${rel}` },
    });
  }
}

let updated = 0;

function addHreflang(file, jaUrl, enUrl) {
  let html = readFileSync(file, 'utf-8');

  // Skip if already has hreflang
  if (html.includes('hreflang=')) return false;

  // Build hreflang tags
  let tags = '';
  if (jaUrl) tags += `  <link rel="alternate" hreflang="ja" href="${jaUrl}" />\n`;
  if (enUrl) tags += `  <link rel="alternate" hreflang="en" href="${enUrl}" />\n`;
  // x-default points to JA (primary language)
  const defaultUrl = jaUrl || enUrl;
  tags += `  <link rel="alternate" hreflang="x-default" href="${defaultUrl}" />\n`;

  // Insert before </head>
  html = html.replace('</head>', tags + '</head>');
  writeFileSync(file, html, 'utf-8');
  return true;
}

for (const pair of pairs) {
  if (pair.ja) {
    if (addHreflang(pair.ja.file, pair.ja.url, pair.en?.url || null)) {
      console.log(`[OK] ${pair.ja.file}`);
      updated++;
    }
  }
  if (pair.en) {
    if (addHreflang(pair.en.file, pair.ja?.url || null, pair.en.url)) {
      console.log(`[OK] ${pair.en.file}`);
      updated++;
    }
  }
}

console.log(`\nDone: ${updated} files updated, ${pairs.length} page pairs found`);
