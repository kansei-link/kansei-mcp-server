// externalize-homepage-array.mjs — 2026-07-02 Phase 0 #4
// index.html / en/index.html に直埋めされた `const services = [...]`（各~2.3MB・11,081行）を
// public/js/services-data(-en).js へ外出しし、HTML本体を軽量化する。
// - UIの挙動は不変（外部scriptの top-level const は後続scriptから参照可能）
// - 生の success% が HTML文書から消える副次効果あり（表示は元々 High/Med/Low tier のみ）
// 冪等: マーカーが無ければスキップ。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');
mkdirSync(join(pub, 'js'), { recursive: true });

const HEAD = '<script>\n// Service data (embedded for static site)\nconst services = [';

const targets = [
  { html: join(pub, 'index.html'), out: 'services-data.js', src: '/js/services-data.js' },
  { html: join(pub, 'en', 'index.html'), out: 'services-data-en.js', src: '/js/services-data-en.js' },
];

for (const t of targets) {
  let html = readFileSync(t.html, 'utf8');
  const before = html.length;
  const start = html.indexOf(HEAD);
  if (start === -1) { console.log(`SKIP (no marker): ${t.html}`); continue; }
  const arrStart = start + '<script>\n'.length;
  const endIdx = html.indexOf('\n];', arrStart);
  if (endIdx === -1) { console.log(`SKIP (no array end): ${t.html}`); continue; }
  const arrEnd = endIdx + '\n];'.length;

  const arrayBlock = html.slice(arrStart, arrEnd); // "// Service data ...\nconst services = [ ... \n];"
  writeFileSync(join(pub, 'js', t.out), arrayBlock + '\n');

  html = html.slice(0, start)
    + `<script src="${t.src}"></script>\n<script>`
    + html.slice(arrEnd);
  writeFileSync(t.html, html);
  console.log(`${t.html}: ${before} -> ${html.length} bytes (extracted ${arrayBlock.length} to js/${t.out})`);
}
