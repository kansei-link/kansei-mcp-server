// finalize-insights-reindex.mjs — 2026-07-02 正直化regen最終工程
// 1. insights内の絶対URLを extensionless に正規化（canonical/hreflang/og:url/JSON-LD含む）
//    — canonicalの主流(162ファイル)が extensionless で、sitemapの.html形式と不整合だったため統一
// 2. 誠実化完了に伴い、insights配下の noindex を全て index, follow へ解除
// 冪等。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');
const dirs = [join(pub, 'insights'), join(pub, 'en', 'insights')];

const NOINDEX_RE = /<meta\s+name=(["'])robots\1\s+content=(["'])noindex[^"']*\2\s*\/?>/gi;

let urlFixed = 0, reindexed = 0, files = 0;
for (const dir of dirs) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const p = join(dir, f);
    let html = readFileSync(p, 'utf8');
    const orig = html;

    // 1) URL正規化: /insights/index.html → /insights/、/insights/<slug>.html → /insights/<slug>
    html = html
      .replace(/https:\/\/kansei-link\.com\/(en\/)?insights\/index\.html/g, 'https://kansei-link.com/$1insights/')
      .replace(/(https:\/\/kansei-link\.com\/(?:en\/)?insights\/[a-z0-9-]+)\.html/g, '$1');

    // 2) noindex解除
    const before = html;
    html = html.replace(NOINDEX_RE, '<meta name="robots" content="index, follow">');
    if (html !== before) reindexed++;

    if (html !== orig) {
      writeFileSync(p, html);
      files++;
      if (html.length !== before.length || before !== orig) urlFixed++;
    }
  }
}
console.log(JSON.stringify({ files_changed: files, noindex_lifted: reindexed }, null, 2));
