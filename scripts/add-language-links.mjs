#!/usr/bin/env node
// add-language-links.mjs — visible JA⇄EN links in the body (2026-10-21).
//
// Why: crawlers that only follow body links (Brave-style indexes behind Claude's search) reached our
// English pages but almost none of the Japanese ones; the JA/EN pairing lived only in <head> hreflang.
// What: for every public/**/*.html that declares BOTH hreflang="ja" and hreflang="en", put one small
// visible link to the other language right before the first <h1> in <body>, wrapped in
// <!-- lang-switch --> … <!-- /lang-switch -->. EN pages link "日本語版", JA pages link "English".
// Only when the target file exists in public/. Idempotent: a second run changes nothing.
// Does not touch titles, body text, hreflang, canonical or the sitemap.
//
// Usage: node scripts/add-language-links.mjs [--check]   (--check: report only, write nothing)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, sep, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ─── shared with scripts/site-gate.mjs ────────────────────────────
export const OPEN = '<!-- lang-switch -->';
export const CLOSE = '<!-- /lang-switch -->';
const BLOCK_RE = /<!-- lang-switch -->[\s\S]*?<!-- \/lang-switch -->/;

export function listHtml(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listHtml(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out.sort();
}

function hreflangHref(html, lang) {
  const tag = html.match(new RegExp(`<link\\b[^>]*\\bhreflang=["']${lang}["'][^>]*>`, 'i'))?.[0];
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

/** URL from hreflang → root-relative path ("/insights/x") and the file that serves it. */
export function resolveTarget(pub, url) {
  let path;
  try { path = new URL(url, 'https://kansei-link.com').pathname; } catch { return null; }
  let file = path.endsWith('/') ? `${path}index.html` : /\.html?$/i.test(path) ? path : `${path}.html`;
  return { path, file: join(pub, ...file.split('/').filter(Boolean)) };
}

/** Classify one page. self = 'en' if under public/en/, else 'ja'. */
export function analyse(pub, file, html) {
  const ja = hreflangHref(html, 'ja');
  const en = hreflangHref(html, 'en');
  if (!ja || !en) return { paired: false };
  const rel = relative(pub, file).split(sep).join('/');
  const self = rel.startsWith('en/') ? 'en' : 'ja';
  const other = self === 'en' ? 'ja' : 'en';
  const target = resolveTarget(pub, other === 'ja' ? ja : en);
  return {
    paired: true, rel, self, other, target,
    targetExists: !!target && existsSync(target.file),
  };
}

export function blockFor(info) {
  const label = info.other === 'ja' ? '日本語版' : 'English';
  return `${OPEN}<p class="lang-switch" style="margin:0 0 8px;font-size:13px;line-height:1.4;"><a href="${info.target.path}" hreflang="${info.other}" lang="${info.other}" style="color:inherit;">${label}</a></p>${CLOSE}`;
}

/** Same-length copy with <script>, <style> and comments blanked, so "<h1" inside them is not found. */
function maskInert(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, (m) => ' '.repeat(m.length));
}

/** Insert or rewrite the block. Returns { html, status } — status: unchanged | inserted | updated | no_h1. */
export function applyBlock(html, info) {
  const block = blockFor(info);
  const existing = html.match(BLOCK_RE);
  if (existing) {
    if (existing[0] === block) return { html, status: 'unchanged' };
    return { html: html.replace(BLOCK_RE, block), status: 'updated' };
  }
  const masked = maskInert(html);
  const bodyAt = masked.search(/<body\b/i);
  if (bodyAt < 0) return { html, status: 'no_h1' };
  const rel = masked.slice(bodyAt).search(/<h1[\s>]/i);
  if (rel < 0) return { html, status: 'no_h1' };
  const h1At = bodyAt + rel;
  const lineStart = html.lastIndexOf('\n', h1At - 1) + 1;
  const lead = html.slice(lineStart, h1At);
  if (/^[ \t]*$/.test(lead)) {
    // <h1> starts its own line: put the block on the line above with the same indent and the same
    // line ending as that line (some pages are stored with CRLF).
    const lineEnd = html.indexOf('\n', h1At);
    const eol = lineEnd > 0 && html[lineEnd - 1] === '\r' ? '\r\n' : '\n';
    return { html: `${html.slice(0, lineStart)}${lead}${block}${eol}${html.slice(lineStart)}`, status: 'inserted' };
  }
  return { html: `${html.slice(0, h1At)}${block}${html.slice(h1At)}`, status: 'inserted' };
}

/** For site-gate: does the body carry the marked link to the other language? */
export function hasBlock(html, info) {
  const m = html.match(BLOCK_RE);
  if (!m) return false;
  return m[0].includes(`href="${info.target.path}"`);
}

// ─── run (only when executed, not when imported by site-gate) ────
function main() {
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'public');
const check = process.argv.includes('--check');

const counts = { paired: 0, inserted: 0, updated: 0, unchanged: 0 };
const missingTarget = [];
const noH1 = [];

for (const file of listHtml(pub)) {
  const html = readFileSync(file, 'utf8');
  const info = analyse(pub, file, html);
  if (!info.paired) continue;
  counts.paired++;
  if (!info.targetExists) { missingTarget.push(`${info.rel} → ${info.target?.path ?? '(bad hreflang URL)'}`); continue; }
  const { html: next, status } = applyBlock(html, info);
  if (status === 'no_h1') { noH1.push(info.rel); continue; }
  counts[status]++;
  if (next !== html && !check) writeFileSync(file, next);
}

console.log(`[lang-switch] paired pages (hreflang ja+en): ${counts.paired}`);
console.log(`  inserted: ${counts.inserted}  updated: ${counts.updated}  unchanged: ${counts.unchanged}${check ? '  (--check: nothing written)' : ''}`);
console.log(`  skipped, other-language file not in public/: ${missingTarget.length}`);
for (const x of missingTarget) console.log(`      - ${x}`);
console.log(`  skipped, no <h1> in <body>: ${noH1.length}`);
for (const x of noH1) console.log(`      - ${x}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
