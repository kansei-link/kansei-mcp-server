// refresh-sitemap.mjs — 2026-07-02 Phase 0 #5
// sitemap.xml の整備:
// 1. noindex中のページを sitemap から除外（noindex×sitemap掲載は矛盾シグナル）
// 2. git上で実際に変更されたファイルのみ lastmod を更新
//    (mtime はクローン/チェックアウトで全ファイル今日になり得るため使わない)
// 冪等。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');
const sitemapPath = join(pub, 'sitemap.xml');
const today = process.argv.includes('--date')
  ? process.argv[process.argv.indexOf('--date') + 1]
  : new Date().toISOString().slice(0, 10);

function locToFile(loc) {
  let p = loc.replace(/^https:\/\/kansei-link\.com/, '');
  if (p === '' || p === '/') p = '/index.html';
  if (p.endsWith('/')) p += 'index.html';
  if (!/\.[a-z]+$/i.test(p)) p += '.html';
  return join(pub, p.replace(/\//g, '\\').replace(/^\\/, ''));
}

// git変更ファイル一覧 (staged/unstaged 両方)
const gitRoot = resolve(__dirname, '..');
const changed = new Set(
  execSync('git status --porcelain -- public', { cwd: gitRoot, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.slice(3).trim().replace(/"/g, ''))
    .filter(Boolean)
    .map((p) => resolve(gitRoot, p).toLowerCase()),
);

const xml = readFileSync(sitemapPath, 'utf8');
const entries = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
const kept = [];
let dropped = [], touched = 0;

for (const entry of entries) {
  const loc = (entry.match(/<loc>(.*?)<\/loc>/) || [])[1];
  if (!loc) continue;
  const file = locToFile(loc);
  if (existsSync(file)) {
    const html = readFileSync(file, 'utf8');
    if (/name=["']robots["']\s+content=["']noindex/i.test(html)) {
      dropped.push(loc);
      continue;
    }
    // lastmod refresh: git上で変更されたファイルのみ
    if (changed.has(resolve(file).toLowerCase())) {
      let e = entry;
      if (/<lastmod>.*?<\/lastmod>/.test(e)) {
        e = e.replace(/<lastmod>.*?<\/lastmod>/, `<lastmod>${today}</lastmod>`);
      } else {
        e = e.replace(/<\/loc>/, `</loc>\n    <lastmod>${today}</lastmod>`);
      }
      if (e !== entry) touched++;
      kept.push(e);
      continue;
    }
  }
  kept.push(entry);
}

// 3. 再追加: insights配下でindexableなのにsitemapに無いページを復帰させる
//    (noindex解除後の復帰用。URL形式は既存に合わせ .html / ディレクトリは末尾スラッシュ)
import { readdirSync } from 'node:fs';
const keptLocs = new Set(kept.map((e) => (e.match(/<loc>(.*?)<\/loc>/) || [])[1]));
const added = [];
for (const rel of ['insights', 'en/insights']) {
  const dir = join(pub, rel.replace('/', '\\'));
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.html')); } catch { continue; }
  for (const f of files) {
    const html = readFileSync(join(dir, f), 'utf8');
    if (/name=["']robots["']\s+content=["']noindex/i.test(html)) continue;
    const loc = f === 'index.html'
      ? `https://kansei-link.com/${rel}/`
      : `https://kansei-link.com/${rel}/${f}`;
    if (keptLocs.has(loc)) continue;
    kept.push(`<url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`);
    added.push(loc);
  }
}

// services/*/index.html (pSEOページ) の復帰・新規追加
try {
  for (const d of readdirSync(join(pub, 'services'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = join(pub, 'services', d.name, 'index.html');
    if (!existsSync(p)) continue;
    const html = readFileSync(p, 'utf8');
    if (/name=["']robots["']\s+content=["']noindex/i.test(html)) continue;
    const loc = `https://kansei-link.com/services/${d.name}/`;
    if (keptLocs.has(loc)) continue;
    kept.push(`<url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`);
    added.push(loc);
  }
} catch { /* no services dir */ }

const header = xml.slice(0, xml.indexOf('<url>'));
const footer = xml.slice(xml.lastIndexOf('</url>') + '</url>'.length);
writeFileSync(sitemapPath, header + kept.join('\n  ') + footer);

console.log(JSON.stringify({
  total_before: entries.length,
  total_after: kept.length,
  lastmod_updated: touched,
  dropped_noindex: dropped.length,
  added_back: added,
}, null, 2));
