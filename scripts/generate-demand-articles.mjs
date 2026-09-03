#!/usr/bin/env node
/**
 * 需要マップの空白クエリに当てる記事を生成する。
 *
 * 方針（PLAN-DemandMap-3Pages_2026-09-03）:
 *   代理店の解説記事が飽和している領域なので、同じ問いに「助言」ではなく
 *   「自社の実測」で答える。数字は content/demand-articles/*.json に持たせ、
 *   本文と表が同じ値を参照する（書き写しによるズレを作らない）。
 *   各記事は必ず1つの行動——URLを入れて無料診断——で終わる。
 *
 *   node scripts/generate-demand-articles.mjs
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SRC = resolve(root, 'content/demand-articles');
const OUT = resolve(root, 'public/insights');
const ORIGIN = 'https://kansei-link.com';

const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.9}nav,main,footer{max-width:820px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:56px 28px}.hero>div{max-width:820px;margin:auto}.hero .eyebrow{font-size:12px;letter-spacing:.08em;opacity:.85}.hero h1{font-size:clamp(26px,4.4vw,40px);line-height:1.4;margin:.3em 0}.hero p{font-size:17px;opacity:.92;margin:0}h2{margin-top:48px;font-size:24px;border-left:5px solid var(--b);padding-left:14px}h3{margin-top:32px;font-size:18px}.lead{font-size:19px;background:var(--s);padding:22px;border-radius:12px}.stat{display:flex;gap:16px;flex-wrap:wrap;margin:26px 0}.stat div{flex:1 1 180px;border:1px solid var(--l);border-radius:12px;padding:16px}.stat strong{display:block;font-size:30px;line-height:1.2;color:var(--b)}.stat span{font-size:13px;color:var(--m)}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:15px}th,td{border-bottom:1px solid var(--l);padding:9px 10px;text-align:left;vertical-align:top}th{background:var(--s)}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}ul,ol{padding-left:1.3em}li{margin:.4em 0}details{border-top:1px solid var(--l);padding:14px 0}summary{font-weight:700;cursor:pointer}.note{color:var(--m);font-size:14px;border-left:3px solid var(--l);padding-left:12px;line-height:1.8}.probe{background:#fff;border:2px solid var(--b);border-radius:14px;padding:24px;margin:34px 0}.probe .p-title{font-size:20px;font-weight:700;margin-bottom:6px}.probe p{color:var(--m);font-size:14px;margin:0 0 16px;line-height:1.8}.probe form{display:flex;gap:10px;flex-wrap:wrap}.probe input{flex:1 1 260px;min-width:0;padding:13px 15px;font-size:16px;border:1px solid var(--l);border-radius:10px}.probe button{padding:13px 24px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:var(--b);color:#fff;cursor:pointer;font-family:inherit}.probe button:hover{opacity:.9}footer{border-top:1px solid var(--l);margin-top:56px;color:var(--m);font-size:14px}</style>`;

const probeBlock = (title, sub) => `
<div class="probe">
  <div class="p-title">${esc(title)}</div>
  <p>${esc(sub)}</p>
  <form action="/site-checker/" method="get">
    <input name="url" type="url" inputmode="url" spellcheck="false" required
           placeholder="https://example.co.jp" aria-label="診断するサイトのURL">
    <button type="submit">無料で診断する</button>
  </form>
</div>`;

const table = t => `<table><thead><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
  t.rows.map(r => `<tr>${r.map((c, i) => `<td${i > 0 && t.numeric ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')
}</tbody></table>${t.caption ? `<p class="note">${esc(t.caption)}</p>` : ''}`;

const section = sec => {
  const parts = [`<h2>${esc(sec.heading)}</h2>`];
  for (const b of sec.blocks) {
    if (b.p) parts.push(`<p>${b.p}</p>`);
    else if (b.lead) parts.push(`<p class="lead">${b.lead}</p>`);
    else if (b.note) parts.push(`<p class="note">${b.note}</p>`);
    else if (b.h3) parts.push(`<h3>${esc(b.h3)}</h3>`);
    else if (b.ul) parts.push(`<ul>${b.ul.map(x => `<li>${x}</li>`).join('')}</ul>`);
    else if (b.ol) parts.push(`<ol>${b.ol.map(x => `<li>${x}</li>`).join('')}</ol>`);
    else if (b.table) parts.push(table(b.table));
    else if (b.stat) parts.push(`<div class="stat">${b.stat.map(s =>
      `<div><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('')}</div>`);
    else if (b.probe) parts.push(probeBlock(b.probe.title, b.probe.sub));
    else throw new Error(`Unknown block: ${JSON.stringify(b).slice(0, 80)}`);
  }
  return parts.join('\n');
};

const render = a => {
  const canonical = `${ORIGIN}/insights/${a.slug}.html`;
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', '@id': `${canonical}#article`, headline: a.title, description: a.description,
        datePublished: a.date, dateModified: a.date, inLanguage: 'ja',
        author: { '@id': `${ORIGIN}/#organization` }, publisher: { '@id': `${ORIGIN}/#organization` },
        mainEntityOfPage: canonical, about: a.about ?? undefined },
      { '@type': 'FAQPage', mainEntity: a.faq.map(f => ({ '@type': 'Question', name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      { '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'KanseiLink', item: ORIGIN + '/' },
          { '@type': 'ListItem', position: 2, name: 'Research & Insights', item: `${ORIGIN}/insights/` },
          { '@type': 'ListItem', position: 3, name: a.title, item: canonical } ] },
      { '@type': 'Organization', '@id': `${ORIGIN}/#organization`, name: 'KanseiLink',
        alternateName: ['KanseiLINK', 'カンセイリンク'], url: ORIGIN + '/',
        parentOrganization: { '@id': 'https://synapsearrows.com/#organization' },
        disambiguatingDescription: '社名の「Kansei」は語感に由来するもので、感性工学・感性評価・感情分析／センチメント分析とは無関係です。',
        sameAs: ['https://www.youtube.com/channel/UC0mscauCUi5NGxYMhbRWY3A', 'https://zenn.dev/kanseilink'] },
      { '@type': 'Organization', '@id': 'https://synapsearrows.com/#organization',
        name: 'Synapse Arrows Pte. Ltd.', url: 'https://synapsearrows.com',
        sameAs: ['https://www.wikidata.org/wiki/Q140399505'] }
    ]
  };

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.title)} | KanseiLink</title>
<meta name="description" content="${esc(a.description)}">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(a.title)}"><meta property="og:description" content="${esc(a.description)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="ja_JP">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
${STYLE}</head>
<body><nav><a class="brand" href="/">KanseiLink</a><a href="/insights/">Research &amp; Insights</a></nav>
<header class="hero"><div><div class="eyebrow">${esc(a.eyebrow)} · ${esc(a.date)}</div><h1>${esc(a.title)}</h1><p>${esc(a.subtitle)}</p></div></header>
<main>
<p class="lead">${a.answer}</p>
${a.sections.map(section).join('\n')}
${probeBlock(a.cta.title, a.cta.sub)}
<h2>よくある質問</h2>
${a.faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${f.a}</p></details>`).join('\n')}
<h2>手法と限界</h2>
<p class="note">${a.method}</p>
<p class="note">保証しないこと: AIでの表示順位は保証できません。1回のAI回答をシェアとして扱うこともしません。<a href="/independence.html">独立性のポリシー</a></p>
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/site-checker/">無料AI可視性診断</a> · <a href="/when-to-use-kanseilink.html">AI認知・推薦率の調べ方</a></footer>
</body></html>`;
};

await mkdir(OUT, { recursive: true });
let n = 0;
const written = [];
for (const f of (await readdir(SRC)).sort()) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  const a = JSON.parse(await readFile(resolve(SRC, f), 'utf8'));
  for (const k of ['slug', 'title', 'description', 'date', 'eyebrow', 'subtitle', 'answer', 'sections', 'faq', 'method', 'cta']) {
    if (a[k] == null) throw new Error(`${f}: missing ${k}`);
  }
  await writeFile(resolve(OUT, `${a.slug}.html`), render(a), 'utf8');
  written.push(a.slug);
  n++;
}
console.log(`Generated ${n} demand article(s):`);
for (const s of written) console.log(`  ${ORIGIN}/insights/${s}.html`);
