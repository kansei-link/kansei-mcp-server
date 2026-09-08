#!/usr/bin/env node
// site-gate.mjs — 公開前検査（変更しない・違反があれば exit 1）。2026-09-08 整合監査②
//
// 使い方: node scripts/site-gate.mjs            … 検査のみ
//         node scripts/site-gate.mjs --json     … 機械可読
// CI（deploy-pages.yml）が Upload の前に呼ぶ。赤なら公開されない＝
// 「新しい記事ほど計測されていない」「sitemapが404を指す」を構造的に再発させない。
// 直すのは scripts/site-prepublish.mjs。
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from './lib/site-instrumentation.mjs';

const pub = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const r = checkSite(pub);
const problems = r.gaMissing.length + r.sitemapDead.length + r.notInSitemap.length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: problems === 0, ...r }, null, 2));
} else {
  console.log(`[site-gate] html=${r.htmlCount} sitemap=${r.sitemapCount}`);
  const show = (label, arr) => { if (arr.length) { console.log(`  ✗ ${label}: ${arr.length}`); for (const x of arr.slice(0, 50)) console.log(`      - ${x}`); if (arr.length > 50) console.log(`      … +${arr.length - 50}`); } else console.log(`  ✓ ${label}: 0`); };
  show('GA4マーカー無し（計測されないページ）', r.gaMissing);
  show('sitemapが指すが実ファイル無し（404）', r.sitemapDead);
  show('indexableなのにsitemap未掲載（insights/services）', r.notInSitemap);
  console.log(problems === 0 ? '[site-gate] ✅ PASS' : `[site-gate] ❌ FAIL (${problems})  → node scripts/site-prepublish.mjs で修正`);
}
process.exit(problems === 0 ? 0 : 1);
