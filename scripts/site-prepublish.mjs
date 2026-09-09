#!/usr/bin/env node
// site-prepublish.mjs — 公開前に「計測」と「被索引化」を機械的に揃える（冪等）。2026-09-08 整合監査②
//
//   1. GA4 を public/**/*.html に注入（無いページだけ・所有権確認ファイルは除外）
//   2. sitemap.xml を refresh-sitemap.mjs で整備（noindex除外・変更分lastmod・insights/services復帰・404エントリ除去）
//   3. site-gate.mjs と同じ検査を最後に走らせ、残っていれば exit 1
//
// 使い方: 生成器（generate-*.mjs）で public/ を書いた後、commit前に
//   node scripts/site-prepublish.mjs [--dry]
// 生成器側を改修しない理由: 生成器は10本あり各自 <head> を吐く。1本ずつ直しても次の生成器で再発する。
// 「公開の直前に必ず通る1か所」で揃える方が構造的に強い（CIの gate が忘れを止める）。
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findHtml, injectGa, checkSite } from './lib/site-instrumentation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const pub = resolve(HERE, '..', 'public');
const DRY = process.argv.includes('--dry');

// 1. GA4
const tally = { injected: 0, skipped: 0, excluded: 0, nohead: 0 };
const injectedFiles = [];
for (const f of findHtml(pub)) {
  const r = injectGa(f, { dry: DRY });
  tally[r]++;
  if (r === 'injected') injectedFiles.push(f);
  if (r === 'nohead') console.warn(`  [ga4] <head> 無し: ${f}`);
}
console.log(`[prepublish] GA4: injected=${tally.injected} already=${tally.skipped} excluded=${tally.excluded} nohead=${tally.nohead}${DRY ? ' [DRY]' : ''}`);

// 2. sitemap
if (!DRY) {
  const out = execFileSync(process.execPath, [resolve(HERE, 'refresh-sitemap.mjs')], { encoding: 'utf8' });
  console.log('[prepublish] sitemap: ' + out.trim().replace(/\n/g, '\n  '));
}

// 3. gate
const r = checkSite(pub);
const problems = r.gaMissing.length + r.sitemapDead.length + r.notInSitemap.length;
console.log(`[prepublish] gate: gaMissing=${r.gaMissing.length} sitemapDead=${r.sitemapDead.length} notInSitemap=${r.notInSitemap.length}`);
for (const x of [...r.gaMissing, ...r.sitemapDead, ...r.notInSitemap].slice(0, 30)) console.log(`   - ${x}`);
console.log(problems === 0 ? '[prepublish] ✅ 公開可' : '[prepublish] ❌ 残件あり（手当てが要る）');
process.exit(problems === 0 || DRY ? 0 : 1);
