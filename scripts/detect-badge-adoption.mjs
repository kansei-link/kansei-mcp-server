#!/usr/bin/env node
/**
 * ARI Award 認定バッジの掲載状況を、認定企業の公開サイトから検知する。
 *
 * なぜ要るか: 掲載は起きているのに、こちらに検知手段がなかった。
 * 誰が能動的に使っているかが分からないと、ガイドライン違反も、
 * 版が古いままの掲載も、運営者確認の営業先も分からない。
 *
 * 検知は3通り。バッジは画像に焼き込まれることがあるので、
 * 「リンクがない＝掲載していない」と誤判定しないよう分けて数える。
 *   1. badge_link   … 埋め込みコードどおり認定ページへリンクしている（理想形）
 *   2. badge_image  … バッジ画像は置いているがリンクがない（画像焼き込み等）
 *   3. text_only    … 画像はないが「ARI Award」等の文字表記がある（IR資料・PR等）
 *
 * ⚠️ 検知は「見つかった」ことしか言えない。見つからなかったことは
 * 「掲載していない」の証明にはならない（下層ページ・PDF・画像内文字は拾えない）。
 * 集計時は必ず not_found ではなく checked_pages を併記すること。
 *
 *   node scripts/detect-badge-adoption.mjs [--limit N]
 *
 * 出力: data/discoverability/badge-adoption-<日付>.json（研究データ＝非公開）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const DATE = new Date().toISOString().slice(0, 10);
const UA = 'KanseiLinkBadgeCheck/1.0 (+https://kansei-link.com/ari-award/badge/)';
const SPACING_MS = 2_000;
const TIMEOUT_MS = 15_000;

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

// 認定41社のうち、ドメインが判明しているものを対象にする
const domainMap = JSON.parse(await readFile(resolve(root, 'public/site-checker/domain-map.json'), 'utf8')).domains;
const svc2domain = new Map();
for (const [domain, list] of Object.entries(domainMap)) {
  for (const s of list) if (!svc2domain.has(s.id)) svc2domain.set(s.id, domain);
}
const scores = JSON.parse(await readFile(resolve(root, '..', 'ari-axr-scores-200.json'), 'utf8')).scores;
// 同一ドメインに複数サービスがぶら下がる（freee系など）。ドメイン単位で1回だけ見る。
const byDomain = new Map();
for (const s of scores) {
  if (!['AAA', 'AA', 'A'].includes(s.axr_grade)) continue;
  const domain = svc2domain.get(s.id);
  if (!domain) continue;
  if (!byDomain.has(domain)) byDomain.set(domain, { domain, ids: [], grades: [] });
  byDomain.get(domain).ids.push(s.id);
  byDomain.get(domain).grades.push(s.axr_grade);
}
const certified = [...byDomain.values()];

console.log(`認定(A以上) ${scores.filter(s => ['AAA','AA','A'].includes(s.axr_grade)).length}件中、ドメイン判明 ${certified.length}件`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// バッジ掲載の痕跡。リンク・画像・文字表記を別々に見る。
const LINK_RE = /kansei-link\.com\/ari-award/i;
const IMG_RE = /ari-award-2026-[a-z]+-(?:AAA|AA|A)\.(?:svg|png)/i;
const TEXT_RE = /ARI\s*Award|KanseiLink|カンセイリンク/i;

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// バッジが置かれがちな場所。freeeは /ai/mcp/、ATLEDは /news/ に出していた実績がある。
// トップだけ見ると実際の掲載を取りこぼすので、同一ドメイン内のそれらしいリンクを少しだけ辿る。
const CANDIDATE_PATH = /(\/ai|mcp|news|press|release|award|topics|information|お知らせ)/i;
const MAX_EXTRA = 8;
// 実績のある置き場所は決め打ちでも叩く。freeeは /ai/mcp/、ATLEDは /news/ に出していた。
// トップからのリンク追跡だけだと、階層が深い場合に届かない。
const COMMON_PATHS = ['/ai/mcp/', '/ai/', '/mcp/', '/news/', '/press/', '/topics/', '/information/'];

function sameDomainLinks(html, base) {
  const found = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    if (!u.hostname.endsWith(new URL(base).hostname.replace(/^www\./, ''))) continue;
    if (!CANDIDATE_PATH.test(u.pathname)) continue;
    u.hash = '';
    if (u.href !== base) found.add(u.href);
    if (found.size >= MAX_EXTRA) break;
  }
  return [...found];
}

function classify(html) {
  const link = LINK_RE.test(html);
  const img = IMG_RE.test(html);
  const text = TEXT_RE.test(html);
  return { link, img, text, status: link ? 'badge_link' : img ? 'badge_image' : text ? 'text_only' : null };
}

const out = [];
const targets = certified.slice(0, LIMIT);
for (const [i, c] of targets.entries()) {
  let checked = 0, top = null, base = null;
  for (const u of [`https://${c.domain}`, `https://www.${c.domain}`]) {
    top = await fetchText(u);
    if (top !== null) { checked++; base = u; break; }
  }
  const rec = { domain: c.domain, ids: c.ids, grades: [...new Set(c.grades)], final_url: base };
  if (top === null) {
    rec.status = 'unreachable';
    rec.checked_pages = 0;
  } else {
    let best = classify(top);
    let hitAt = best.status ? base : null;
    if (!best.status) {
      const origin = new URL(base).origin;
      const probes = [
        ...COMMON_PATHS.map(pth => origin + pth),
        ...sameDomainLinks(top, base)
      ];
      const seen = new Set();
      for (const u of probes) {
        if (seen.has(u)) continue;
        seen.add(u);
        await sleep(SPACING_MS);
        const h = await fetchText(u);
        checked++;
        if (h === null) continue;
        const r = classify(h);
        if (r.status) { best = r; hitAt = u; break; }
      }
    }
    rec.status = best.status ?? 'not_found';
    rec.found_at = hitAt;
    rec.signals = { link: best.link, img: best.img, text: best.text };
    rec.checked_pages = checked;
  }
  out.push(rec);
  console.log(`[${i + 1}/${targets.length}] ${c.domain} (${rec.grades.join('/')}) → ${rec.status}${rec.found_at && rec.found_at !== base ? ` @ ${rec.found_at}` : ''} (${rec.checked_pages}p)`);
  await sleep(SPACING_MS);
}

const tally = {};
for (const r of out) tally[r.status] = (tally[r.status] ?? 0) + 1;

const dir = resolve(root, 'data/discoverability');
await mkdir(dir, { recursive: true });
const path = resolve(dir, `badge-adoption-${DATE}.json`);
await writeFile(path, JSON.stringify({
  checked_at: DATE,
  note: '検知できるのはトップページのHTMLのみ。PDF・下層ページ・画像内の文字は拾えないため、not_found は「掲載していない」ことの証明にはならない。',
  total: out.length, tally, results: out
}, null, 1), 'utf8');

console.log(`\nWrote ${path}`);
console.log('内訳:', tally);
const adopted = (tally.badge_link ?? 0) + (tally.badge_image ?? 0) + (tally.text_only ?? 0);
console.log(`何らかの掲載を検知: ${adopted} / ${out.length}（うちリンク付き ${tally.badge_link ?? 0}）`);
