#!/usr/bin/env node
// site-gate.mjs — 公開前検査（変更しない・違反があれば exit 1）。2026-09-08 整合監査②
//
// 使い方: node scripts/site-gate.mjs            … 検査のみ
//         node scripts/site-gate.mjs --json     … 機械可読
// CI（deploy-pages.yml）が Upload の前に呼ぶ。赤なら公開されない＝
// 「新しい記事ほど計測されていない」「sitemapが404を指す」を構造的に再発させない。
// 直すのは scripts/site-prepublish.mjs。
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from './lib/site-instrumentation.mjs';
import { listHtml, analyse, hasBlock } from './add-language-links.mjs';
import { findHtml } from './lib/site-instrumentation.mjs';
import { checkAskLine, seedServiceIds } from './lib/ask-line.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'public');
const r = checkSite(pub);

// 2026-10-13: MCP Registry の server.json が package.json とずれない（npm 1.2.4／Registry 1.1.1／
// サイト 1.1.0 の三つが食い違っていた）。server.json は scripts/generate-ard.mjs が package.json から作り、
// 自社カード（src/data/ard-entries.json の mcpServer）と同じ元から出る。直すのは生成器の再実行。
function checkServerJson() {
  const out = [];
  const read = (...p) => { const f = resolve(root, ...p); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  const pkg = read('package.json');
  const site = read('public', '.well-known', 'mcp', 'server.json');
  const top = read('server.json');
  const card = read('src', 'data', 'ard-entries.json')?.entries?.['kansei-link-mcp']?.mcpServer;
  if (!site) return ['public/.well-known/mcp/server.json が無い'];
  if (!card) return ['src/data/ard-entries.json の自社カードに mcpServer が無い'];
  if (site.version !== pkg.version) out.push(`server.json version ${site.version} ≠ package.json ${pkg.version}`);
  if (site.packages?.[0]?.version !== pkg.version) out.push(`server.json packages[0].version ${site.packages?.[0]?.version} ≠ package.json ${pkg.version}`);
  if (site.remotes?.[0]?.url !== card.remotes?.[0]?.url) out.push(`server.json remotes[0].url ${site.remotes?.[0]?.url} ≠ 自社カード ${card.remotes?.[0]?.url}`);
  if (JSON.stringify(site) !== JSON.stringify(card)) out.push('server.json と自社カードの mcpServer の内容が違う');
  if (top && JSON.stringify(top) !== JSON.stringify(site)) out.push('リポジトリ直下の server.json と public/.well-known/mcp/server.json の内容が違う');
  return out;
}
r.serverJsonMismatch = checkServerJson();

// 2026-10-21: hreflang の対（ja と en）を持つページは、本文に相手言語への見えるリンクを持つ
// （<!-- lang-switch --> の中）。巡回が <head> の hreflang ではなく本文のリンクを辿るため。
// 相手のファイルが public/ に無いページは数えるだけ（hreflang 側の不備・別件）。
// 直すのは node scripts/add-language-links.mjs。
function checkLangSwitch() {
  const missing = [], targetAbsent = [];
  for (const file of listHtml(pub)) {
    const html = readFileSync(file, 'utf8');
    const info = analyse(pub, file, html);
    if (!info.paired) continue;
    if (!info.targetExists) { targetAbsent.push(`${info.rel} → ${info.target?.path ?? '?'}`); continue; }
    if (!hasBlock(html, info)) missing.push(info.rel);
  }
  return { missing, targetAbsent };
}
const lang = checkLangSwitch();
r.langSwitchMissing = lang.missing;
r.langSwitchTargetAbsent = lang.targetAbsent;
// 2026-10-21: the visible ask line (scripts/add-ask-line.mjs). Markers must be paired, one per page, and the
// service id must be one the production ask accepts (services-seed.json) — otherwise the line sends readers to a 404.
function checkAskLines() {
  const ids = seedServiceIds(root);
  const out = [];
  for (const f of findHtml(pub)) {
    const html = readFileSync(f, 'utf8');
    if (!html.includes('ask-line')) continue;
    for (const p of checkAskLine(html, ids)) out.push(`${f.slice(pub.length + 1).replaceAll(sep, '/')}: ${p}`);
  }
  return out;
}
r.askLineBroken = checkAskLines();
const problems = r.gaMissing.length + r.sitemapDead.length + r.notInSitemap.length + r.serverJsonMismatch.length + r.langSwitchMissing.length + r.askLineBroken.length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: problems === 0, ...r }, null, 2));
} else {
  console.log(`[site-gate] html=${r.htmlCount} sitemap=${r.sitemapCount}`);
  const show = (label, arr) => { if (arr.length) { console.log(`  ✗ ${label}: ${arr.length}`); for (const x of arr.slice(0, 50)) console.log(`      - ${x}`); if (arr.length > 50) console.log(`      … +${arr.length - 50}`); } else console.log(`  ✓ ${label}: 0`); };
  show('GA4マーカー無し（計測されないページ）', r.gaMissing);
  show('sitemapが指すが実ファイル無し（404）', r.sitemapDead);
  show('indexableなのにsitemap未掲載（insights/services）', r.notInSitemap);
  show('server.json が package.json／自社カードとずれている', r.serverJsonMismatch);
  show('hreflang の対があるのに本文に相手言語へのリンク無し（lang-switch）', r.langSwitchMissing);
  show('ask の一行の印が壊れている／id が seed に無い', r.askLineBroken);
  if (r.langSwitchTargetAbsent.length) console.log(`  ・参考（失敗にしない）: hreflang の相手のファイルが public/ に無い: ${r.langSwitchTargetAbsent.length}`);
  console.log(problems === 0 ? '[site-gate] ✅ PASS' : `[site-gate] ❌ FAIL (${problems})  → node scripts/site-prepublish.mjs／add-language-links.mjs で修正`);
}
process.exit(problems === 0 ? 0 : 1);
