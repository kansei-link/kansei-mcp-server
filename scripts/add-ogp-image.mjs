#!/usr/bin/env node
/**
 * Add og:image meta tag to all HTML pages that don't have one.
 * Uses a default shared OGP image for now.
 * Individual article images can be added later.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const OGP_IMAGE = 'https://kansei-link.com/img/ogp-default.png';
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

const files = findHtml(PUBLIC_DIR);
let updated = 0;

for (const file of files) {
  let html = readFileSync(file, 'utf-8');

  // Skip if already has og:image
  if (html.includes('og:image')) continue;

  // Skip subscription pages
  if (file.includes('subscription')) continue;
  if (file.includes('google')) continue;

  // Add og:image before </head>
  const tag = `  <meta property="og:image" content="${OGP_IMAGE}" />\n  <meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />\n  <meta name="twitter:image" content="${OGP_IMAGE}" />\n`;
  html = html.replace('</head>', tag + '</head>');
  writeFileSync(file, html, 'utf-8');
  console.log(`[OK] ${file}`);
  updated++;
}

console.log(`\nDone: ${updated} files updated`);
