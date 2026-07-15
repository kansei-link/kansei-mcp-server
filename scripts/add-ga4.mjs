#!/usr/bin/env node
/**
 * Inject GA4 (gtag.js) into the <head> of every HTML page under public/, idempotently.
 *
 * Usage: node scripts/add-ga4.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const GA_ID = 'G-NHXMFKT579';
const PUBLIC_DIR = 'public';
const DRY = process.argv.includes('--dry');
const MARKER = `gtag-ga4:${GA_ID}`;

const SNIPPET = `  <!-- Google Analytics 4 (${MARKER}) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>`;

function findHtml(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const st = statSync(full);
    if (st.isDirectory() && !f.startsWith('.') && f !== 'node_modules' && f !== 'dist') out.push(...findHtml(full));
    else if (f.endsWith('.html')) out.push(full);
  }
  return out;
}

let injected = 0, skipped = 0, nohead = 0;
for (const file of findHtml(PUBLIC_DIR)) {
  const html = readFileSync(file, 'utf8');
  if (html.includes(MARKER)) { skipped++; continue; }
  const idx = html.indexOf('<head>');
  if (idx === -1) { nohead++; console.warn('  no <head>:', file); continue; }
  const at = idx + '<head>'.length;
  const next = html.slice(0, at) + '\n' + SNIPPET + html.slice(at);
  if (!DRY) writeFileSync(file, next);
  injected++;
}

console.log(`GA4 ${GA_ID} → injected:${injected} skipped(already):${skipped} no-head:${nohead}${DRY ? ' [DRY]' : ''}`);
