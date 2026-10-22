#!/usr/bin/env node
// generate-mcp-ja-pages.mjs — 日本語の「〇〇 MCP」ページ（/mcp/<id>/）と一覧（/mcp/）を
// src/data/mcp-ja-pages.json から作る。ページは手で直さない（直すのは JSON）。
//
// 決定: founder-ops/research/WhyRead_2026-10/PLAN-ja-saas-mcp-pages-v0.md（Michie 2026-10-22）。
// 型: 結論の一行（ある／確認できない）→ 所在・提供の形・認証・公式の手順（ある場合）／
//     確認した情報源・公式 API（無い場合）→ 詰まりどころ（現場メモ・ask の一行）→ 出典と確認日。
// 「存在しない」「対応していない」とは書かない。非公式のサーバーの名前は並べない。
//
// 併せて:
//   - 英語のサービスページ public/services/<id>/index.html に hreflang の対（ja → /mcp/<id>/）を足す
//     （その後 scripts/add-language-links.mjs が本文の言語リンクを入れる）
//   - public/sitemap.xml に 11 本を足す（無い時だけ）
//
// 使い方: node scripts/generate-mcp-ja-pages.mjs && node scripts/add-language-links.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askLineBlock, seedServiceIds } from './lib/ask-line.mjs';
import { GA_SNIPPET } from './lib/site-instrumentation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'public');
const SITE = 'https://kansei-link.com';
const data = JSON.parse(readFileSync(resolve(root, 'src', 'data', 'mcp-ja-pages.json'), 'utf8'));
const seedIds = seedServiceIds(root);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a = (url, text) => `<a href="${esc(url)}" rel="noopener">${esc(text ?? url)}</a>`;
const month = data.as_of.slice(0, 7).replace('-', '年') + '月';

const HOSTING = {
  vendor: '提供元が運用するサーバーに接続する（リモート）',
  self: '自分の環境で動かす（ローカル）',
  both: '自分の環境で動かす（ローカル）／自分で HTTP サーバーとして立てる',
  unstated: '公式の情報には書かれていない',
};

const CSS = `<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd;--ok:#067647;--okbg:#e7f6ec;--na:#475467;--nabg:#f2f4f7}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.85}nav,main,footer{max-width:900px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:52px 28px}.hero>div{max-width:900px;margin:auto}.hero h1{font-size:clamp(24px,4.2vw,38px);line-height:1.4;margin:.2em 0}.hero p{font-size:17px;opacity:.92}.eyebrow{font-size:13px;letter-spacing:.06em;opacity:.85}h2{margin-top:46px;border-left:5px solid var(--b);padding-left:14px;font-size:21px}.answer{font-size:18px;background:var(--s);padding:20px 22px;border-radius:12px;margin:22px 0}.lv{display:inline-block;padding:1px 10px;border-radius:999px;font-weight:700;font-size:13px;white-space:nowrap}.lv-ok{background:var(--okbg);color:var(--ok)}.lv-na{background:var(--nabg);color:var(--na)}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:15px}th,td{border-bottom:1px solid var(--l);padding:9px 10px;text-align:left;vertical-align:top}th{background:var(--s);white-space:nowrap}table.card th{width:170px;color:var(--m);font-weight:500}code{background:var(--s);padding:1px 5px;border-radius:4px;font-size:13px;overflow-wrap:anywhere}.note{color:var(--m);font-size:14px;border-left:3px solid var(--l);padding-left:12px}ul.src{padding-left:20px;font-size:14px}ul.src li{margin:4px 0;overflow-wrap:anywhere}.ask-line{margin:14px 0 0;padding:10px 12px;border:1px solid var(--l);border-radius:6px;background:var(--s);font-size:13px;line-height:1.6;color:var(--na);overflow-wrap:anywhere}footer{border-top:1px solid var(--l);margin-top:60px;color:var(--m);font-size:14px}.wrap{overflow-x:auto}@media (max-width:600px){table.card th{width:110px}}</style>`;

function head({ title, description, path, type = 'Article', dateModified, name }) {
  const url = `${SITE}${path}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': type,
    '@id': `${url}#page`,
    headline: title,
    name: title,
    inLanguage: 'ja',
    url,
    datePublished: data.published_on,
    dateModified,
    description,
    author: { '@type': 'Organization', name: 'KanseiLink', url: SITE },
    publisher: { '@type': 'Organization', name: 'Synapse Arrows Pte. Ltd.', url: 'https://synapsearrows.com' },
    ...(name ? { about: { '@type': 'SoftwareApplication', name } } : {}),
  };
  return `<!DOCTYPE html><html lang="ja"><head>
${GA_SNIPPET}<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | KanseiLink</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:locale" content="ja_JP"><meta property="og:site_name" content="KanseiLink"><meta property="og:image" content="${SITE}/img/ogp-default.png">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${CSS}
</head>`;
}

const NAV = `<nav><a class="brand" href="/">KanseiLink</a><a href="/mcp/">日本の SaaS の公式 MCP 対応状況</a></nav>`;
const footer = (extra = '') => `<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/mcp/">公式 MCP 対応状況の一覧</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/independence.html">独立性のポリシー</a>${extra}</footer>`;

function sourcesList(item) {
  return `<ul class="src">${item.sources.map((s) => `<li>${a(s.url, s.title)}（${esc(s.kind)}）— ${esc(s.result)}。確認日 ${esc(s.accessed)}</li>`).join('')}</ul>`;
}

function pageFor(item) {
  const path = `/mcp/${item.id}/`;
  const official = item.status === 'official';
  const title = `${item.name} MCP｜公式サーバーの有無とつなぎ方（${month}時点）`;
  const conclusion = official
    ? `${item.name}には、提供元の${item.company}が公開する公式の MCP サーバーがあります（${item.confirmed_on} 確認）。${item.summary ? ' ' + item.summary : ''}`
    : `${item.confirmed_on} 時点で、${item.company}による公式の MCP サーバーの公開は、下に挙げた公式の情報源では確認できませんでした。${item.summary ? ' ' + item.summary : ''}`;
  const description = official
    ? `${item.name}の公式 MCP サーバー（${item.company}）の所在・提供の形・認証方式と公式の手順へのリンク。${item.confirmed_on} に一次資料で確認。`
    : `${item.confirmed_on} 時点で${item.company}による公式 MCP サーバーの公開は公式の情報源では確認できませんでした。確認した情報源と、代わりに使える公式 API をまとめています。`;
  const svcPage = item.has_service_page ? `/services/${item.id}/` : null;
  const hreflang = svcPage
    ? `<link rel="alternate" hreflang="ja" href="${SITE}${path}"><link rel="alternate" hreflang="en" href="${SITE}${svcPage}">`
    : '';

  let body = '';
  if (official) {
    const rows = [
      ['提供元', esc(item.company)],
      ['所在', [item.location?.repo ? `リポジトリ: ${a(item.location.repo)}` : '', item.location?.endpoint ? `接続先: <code>${esc(item.location.endpoint)}</code>` : '', item.location?.note ? esc(item.location.note) : ''].filter(Boolean).join('<br>') || '公式の情報には書かれていない'],
      ['提供の形', esc(HOSTING[item.hosting] ?? item.hosting) + (item.hosting_note ? `<br><span class="note">${esc(item.hosting_note)}</span>` : '')],
      ['認証方式', esc(item.auth) + (item.auth_note ? `<br><span class="note">${esc(item.auth_note)}</span>` : '')],
      ['公式の手順', item.setup_url ? a(item.setup_url, item.setup_label || item.setup_url) : '公式の手順書は見つかっていない'],
      ['但し書き', item.caveats ? esc(item.caveats) : 'なし'],
    ];
    body += `<h2>公式 MCP サーバーの所在とつなぎ方</h2>
<table class="card">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
<p class="note">手順そのものは提供元の文書に従ってください。ここには写しません。認証方式は README だけでなく、提供元の文書全体から読み取った範囲で書いています。</p>`;
  } else {
    body += `<h2>確認した情報源（${item.confirmed_on}）</h2>
<p>次の公式の情報源を開き、MCP サーバーの提供についての記載を探しました。</p>
${sourcesList(item)}
<h2>代わりに使える公式の手段</h2>
<table class="card">
<tr><th>公式 API</th><td>${item.api?.url ? a(item.api.url, item.api.label || item.api.url) : '公式の API 文書は見つかっていない'}</td></tr>
<tr><th>認証方式</th><td>${esc(item.api?.auth || '公式の情報には書かれていない')}</td></tr>
${item.request_channel?.url ? `<tr><th>要望の窓口</th><td>${a(item.request_channel.url, item.request_channel.label)}</td></tr>` : ''}
</table>
<p class="note">第三者が作った非公式の MCP サーバーが見つかる場合もありますが、提供元の保証はありません。</p>`;
  }

  // 詰まりどころ
  const pit = [];
  for (const fn of item.field_notes || []) pit.push(`<li>現場メモ ${a(fn.url, fn.id)}: ${esc(fn.summary)}</li>`);
  for (const p of item.pitfalls || []) pit.push(`<li>${esc(p.text)}${p.url ? `（${a(p.url, p.label || '公式の説明')}）` : ''}</li>`);
  body += `<h2>詰まりどころ</h2>
${pit.length ? `<ul>${pit.join('')}</ul>` : '<p>このサービスについての現場メモは、まだありません。</p>'}
${askLineBlock({ id: item.id, name: item.name, lang: 'ja' })}`;

  // 出典
  body += `<h2>出典と確認日</h2>
${official ? sourcesList(item) : `<p>上の「確認した情報源」と同じです。</p>`}
${item.changed_since ? `<p class="note">2026-10-07 の一覧からの変化: ${esc(item.changed_since)}</p>` : ''}
<p class="note">このページは事実の記録です。順位や評価は付けていません。内容が変わっていたら ${a('mailto:contact@synapse-arrows.com', 'contact@synapse-arrows.com')} までお知らせください。英語の接続情報は ${svcPage ? a(svcPage, `${item.name} のサービスページ`) : '準備中'}にあります。</p>`;

  return `${head({ title, description, path, dateModified: item.confirmed_on, name: item.name })}
<body>${NAV}
<header class="hero"><div><div class="eyebrow">${esc(item.name)} × MCP · ${month}時点</div>
<h1>${esc(title)}</h1>
<p>${esc(item.name)}（${esc(item.company)}）の公式 MCP サーバーについて、${esc(item.confirmed_on)} に一次資料で確かめた範囲を書いています。</p></div></header>
<main>
<p class="answer"><span class="lv ${official ? 'lv-ok' : 'lv-na'}">${official ? '公式 MCP あり' : '公式 MCP は確認できない'}</span><br>${esc(conclusion)}</p>
${body}
</main>
${footer(svcPage ? ` · ${a(svcPage, 'English (service page)')}` : '')}
</body></html>
`.replace('<link rel="canonical"', `${hreflang}<link rel="canonical"`);
}

function indexPage() {
  const path = '/mcp/';
  const title = `日本の SaaS の公式 MCP 対応状況（${month}時点）`;
  const description = `日本の SaaS ${data.items.length} 社について、提供元による公式 MCP サーバーの有無・提供の形・確認日を一次資料で確かめて一覧にしています。順位や点数は付けません。`;
  const rows = data.items.map((it) => {
    const official = it.status === 'official';
    return `<tr><td>${a(`/mcp/${it.id}/`, it.name)}<br><span class="note" style="border:0;padding:0">${esc(it.company)}</span></td><td><span class="lv ${official ? 'lv-ok' : 'lv-na'}">${official ? 'あり' : '確認できない'}</span></td><td>${official ? esc(HOSTING[it.hosting] ?? it.hosting) : '—'}</td><td>${esc(it.confirmed_on)}</td></tr>`;
  }).join('');
  return `${head({ title, description, path, type: 'WebPage', dateModified: data.as_of })}
<body>${NAV}
<header class="hero"><div><div class="eyebrow">MCP · 日本の SaaS · ${month}時点</div>
<h1>${esc(title)}</h1>
<p>提供元が公開する公式の MCP サーバーがあるかどうかを、会社のニュース・開発者向けサイト・GitHub の組織・公式 MCP Registry で確かめた記録です。「確認できない」は、見た範囲で記載が無かったという意味で、「存在しない」ではありません。</p></div></header>
<main>
<div class="wrap"><table>
<thead><tr><th>サービス</th><th>公式 MCP</th><th>提供の形</th><th>確認日</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="note">順位や点数は付けていません。各ページに、見た情報源の URL と日付を全部書いています。今後、社数を増やしていきます。英語の接続情報は各サービスページ（/services/）にあります。</p>
<h2>読み方</h2>
<ul>
<li><strong>あり</strong>: 提供元自身が MCP サーバーを公開している（公式の告知・文書・リポジトリのいずれかで確認）。β や一部契約向けなどの但し書きは各ページに。</li>
<li><strong>確認できない</strong>: 確認日の時点で、提供元の公式の情報源に記載が無かった。第三者製の非公式サーバーは数えません。</li>
<li><strong>提供の形</strong>: 提供元が運用するサーバーに接続する（リモート）か、自分の環境で動かす（ローカル）か。</li>
</ul>
</main>
${footer()}
</body></html>
`;
}

// ── write pages ──
let written = 0;
for (const item of data.items) {
  if (!seedIds.has(item.id)) throw new Error(`id "${item.id}" は services-seed.json に無い（勝手に id を作らない）`);
  item.has_service_page = existsSync(resolve(pub, 'services', item.id, 'index.html'));
  const dir = resolve(pub, 'mcp', item.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'index.html'), pageFor(item));
  written++;
}
mkdirSync(resolve(pub, 'mcp'), { recursive: true });
writeFileSync(resolve(pub, 'mcp', 'index.html'), indexPage());
written++;

// ── hreflang pair on the English service pages (idempotent) ──
let paired = 0;
for (const item of data.items) {
  if (!item.has_service_page) continue;
  const f = resolve(pub, 'services', item.id, 'index.html');
  let html = readFileSync(f, 'utf8');
  const tags = `<link rel="alternate" hreflang="en" href="${SITE}/services/${item.id}/">\n  <link rel="alternate" hreflang="ja" href="${SITE}/mcp/${item.id}/">`;
  if (html.includes(`hreflang="ja" href="${SITE}/mcp/${item.id}/"`)) continue;
  if (/hreflang=/.test(html)) throw new Error(`${f}: 別の hreflang が既にある`);
  const canon = html.match(/[ \t]*<link rel="canonical"[^>]*>/);
  if (!canon) throw new Error(`${f}: canonical が無い`);
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  html = html.replace(canon[0], `${canon[0]}${eol}  ${tags.replace('\n', eol)}`);
  writeFileSync(f, html);
  paired++;
}

// ── sitemap ──
const smFile = resolve(pub, 'sitemap.xml');
let sm = readFileSync(smFile, 'utf8');
let added = 0;
const urls = ['/mcp/', ...data.items.map((it) => `/mcp/${it.id}/`)];
for (const u of urls) {
  const loc = `${SITE}${u}`;
  if (sm.includes(`<loc>${loc}</loc>`)) continue;
  const entry = `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${data.as_of}</lastmod>\n    <changefreq>monthly</changefreq>\n  </url>\n`;
  sm = sm.replace('</urlset>', `${entry}</urlset>`);
  added++;
}
writeFileSync(smFile, sm);

console.log(`[generate-mcp-ja-pages] pages=${written} hreflang_pairs_added=${paired} sitemap_added=${added}`);
