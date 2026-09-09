// site-instrumentation.mjs — 公開HTMLの計測・被索引化の共通ロジック（2026-09-08 整合監査②）
//
// 背景: GA4 は371ページで発火していたが、生成器が作った新規ページ45枚（最新・最重要の記事ぜんぶ）に
// スニペットが無く、`add-ga4.mjs` は手動でしか走らないため再発し続けていた。sitemap も refresh が
// どこからも呼ばれず lastmod の69%が7月で凍結・404エントリ2件。
// ここに「注入」と「検査」を1か所にまとめ、prepublish（直す）と gate（CIで赤にする）から使う。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const GA_ID = 'G-NHXMFKT579';
export const GA_MARKER = `gtag-ga4:${GA_ID}`;
export const GA_SNIPPET = `  <!-- Google Analytics 4 (${GA_MARKER}) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>`;

// GAを入れてはいけない/入れる意味がないファイル（所有権確認ファイルは中身が固定でないと検証が壊れる）
export const GA_EXCLUDE = [/^google[0-9a-f]+\.html$/i];

export const SITE = 'https://kansei-link.com';

/** public/ 配下の .html を再帰列挙（node_modules/dist/dotdir 除外） */
export function findHtml(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const st = statSync(full);
    if (st.isDirectory()) { if (!f.startsWith('.') && f !== 'node_modules' && f !== 'dist') out.push(...findHtml(full)); }
    else if (f.endsWith('.html')) out.push(full);
  }
  return out;
}

export const toPosix = (p) => p.split(sep).join('/');
export const isExcluded = (file) => GA_EXCLUDE.some((re) => re.test(file.split(/[\\/]/).pop()));

/** GA注入（冪等）。戻り値: 'injected' | 'skipped' | 'excluded' | 'nohead' */
export function injectGa(file, { dry = false } = {}) {
  if (isExcluded(file)) return 'excluded';
  const html = readFileSync(file, 'utf8');
  if (html.includes(GA_MARKER)) return 'skipped';
  const idx = html.indexOf('<head>');
  if (idx === -1) return 'nohead';
  const at = idx + '<head>'.length;
  if (!dry) writeFileSync(file, html.slice(0, at) + '\n' + GA_SNIPPET + html.slice(at));
  return 'injected';
}

/** sitemap の <loc> → public 配下の実ファイルパス（OS非依存） */
export function locToFile(pub, loc) {
  let p = loc.replace(new RegExp(`^${SITE.replace(/\./g, '\\.')}`), '');
  if (p === '' || p === '/') p = '/index.html';
  if (p.endsWith('/')) p += 'index.html';
  if (!/\.[a-z]+$/i.test(p)) p += '.html';
  return join(pub, ...p.split('/').filter(Boolean));
}

/** 実ファイル → 正規loc（insights は拡張子なし、ディレクトリindexは末尾スラッシュ） */
export function fileToLoc(pub, file) {
  const rel = toPosix(relative(pub, file));
  if (rel === 'index.html') return `${SITE}/`;
  if (rel.endsWith('/index.html')) return `${SITE}/${rel.slice(0, -'index.html'.length)}`;
  if (/^(en\/)?insights\/[a-z0-9-]+\.html$/.test(rel)) return `${SITE}/${rel.replace(/\.html$/, '')}`;
  return `${SITE}/${rel}`;
}

export const isNoindex = (html) => /name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);

/**
 * 検査（変更しない）。戻り値 { gaMissing[], sitemapDead[], notInSitemap[], sitemapCount, htmlCount }
 * - gaMissing: GAマーカー無し（除外ファイルを除く）
 * - sitemapDead: sitemap にあるが実ファイルが無い（=404）
 * - notInSitemap: indexable（noindexでない）なのに sitemap に無い。対象= insights / en/insights / services
 *   （トップ直下の単発ページは意図的に外す運用があるため対象外。必要なら SITEMAP_SCOPE で広げる）
 */
export function checkSite(pub, { sitemapScope = [/^(en\/)?insights\//, /^services\//] } = {}) {
  const files = findHtml(pub);
  const gaMissing = files.filter((f) => !isExcluded(f) && !readFileSync(f, 'utf8').includes(GA_MARKER)).map((f) => toPosix(relative(pub, f)));
  const sm = existsSync(join(pub, 'sitemap.xml')) ? readFileSync(join(pub, 'sitemap.xml'), 'utf8') : '';
  const locs = [...sm.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
  const sitemapDead = locs.filter((loc) => !existsSync(locToFile(pub, loc)));
  const locSet = new Set(locs.map((l) => l.replace(/\.html$/, '').replace(/\/index$/, '/')));
  const notInSitemap = [];
  for (const f of files) {
    const rel = toPosix(relative(pub, f));
    if (!sitemapScope.some((re) => re.test(rel))) continue;
    if (isNoindex(readFileSync(f, 'utf8'))) continue;
    const loc = fileToLoc(pub, f).replace(/\.html$/, '').replace(/\/index$/, '/');
    if (!locSet.has(loc)) notInSitemap.push(rel);
  }
  return { gaMissing, sitemapDead, notInSitemap, sitemapCount: locs.length, htmlCount: files.length };
}
