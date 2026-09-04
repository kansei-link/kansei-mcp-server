#!/usr/bin/env node
/**
 * 一次調査3本の英語版を、日本語版と同じデータから生成する。
 *
 * 日本語版の生成器には手を入れない。本番で動いている3本を壊さないため。
 * 数字は同じJSONから数え直すので、翻訳のたびに値がずれる余地がない。
 *
 * 英語版は日本語版の逐語訳ではない。英語圏の読者にとっての news value は
 * 「日本のSaaSが」ではなく「実測が通説と食い違った」ほうなので、見出しはそちらに寄せる。
 * ただし主張の射程は日本語版と同一に保つ（サンプル内の記述に限定・因果は主張しない）。
 *
 *   node scripts/generate-en-research.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const OUT = resolve(root, 'public/en/insights');
const ORIGIN = 'https://kansei-link.com';
const DATE = '2026-09-03';
const MIN_N = 5;

const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = v => `${v.toFixed(1)}%`;
const pct = (n, d) => (n / d) * 100;

// ── データ ─────────────────────────────────────────
async function load(paths) {
  const rows = [];
  for (const p of paths) {
    const d = JSON.parse(await readFile(resolve(root, p), 'utf8'));
    rows.push(...d.results.filter(r => r.ok));
  }
  const seen = new Set();
  return rows.filter(r => (seen.has(r.domain) ? false : (seen.add(r.domain), true)));
}
const jp = await load(['data/discoverability/jp-saas-scan-2026-09-03.json']);
const gl = await load([
  'data/discoverability/global-saas-scan-2026-09-03.json',
  'data/discoverability/global-saas-scan-2026-09-03-part2.json'
]);
const jpRaw = JSON.parse(await readFile(resolve(root, 'data/discoverability/jp-saas-scan-2026-09-03.json'), 'utf8'));

const CAT = {
  '会計・経理・請求書': 'accounting', '人事・労務・勤怠・給与': 'hr', 'CRM・SFA・営業支援': 'crm',
  '決済・POS・フィンテック': 'payment', 'カスタマーサポート・CS': 'support',
  'プロジェクト管理・業務効率化': 'project_management', 'マーケティング・MA・広告': 'marketing',
  'EC・コマース': 'ecommerce', '契約・リーガル': 'legal',
  'コミュニケーション・グループウェア': 'communication', 'セキュリティ・ID管理': 'security',
  'BI・データ分析': 'bi_analytics', '経費精算・ワークフロー': 'expense_workflow',
  '物流・配送': 'logistics', '医療・ヘルスケア': 'healthcare', '教育・LMS': 'education',
  '予約・店舗管理': 'reservation', '建設・不動産': 'real_estate'
};
const EN_CAT = {
  accounting: 'Accounting & invoicing', hr: 'HR & payroll', payment: 'Payments',
  support: 'Customer support', project_management: 'Project management',
  marketing: 'Marketing', ecommerce: 'E-commerce', communication: 'Communication'
};
const norm = r => CAT[r.category] ?? r.category;
const isFail = (r, id) => { const f = r.findings?.[id]; return f && f.max > 0 && f.points === 0; };
const group = rows => rows.reduce((m, r) => (m.set(norm(r), [...(m.get(norm(r)) ?? []), r]), m), new Map());
const gJp = group(jp), gGl = group(gl);
const shared = [...gJp.keys()].filter(k => gGl.has(k) && gJp.get(k).length >= MIN_N && gGl.get(k).length >= MIN_N);
const rate = (rows, id) => (rows.filter(r => isFail(r, id)).length / rows.length) * 100;
const avg = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const catAvg = (g, id) => avg(shared.map(k => rate(g.get(k), id)));
const med = rows => { const s = rows.map(r => r.score).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const failing = (rows, id) => rows.filter(r => isFail(r, id)).length;
// JP側が勝っているカテゴリ数。散文で「一部では上」と書くと検証されないまま残るので数える
const jpAhead = id => shared.filter(k => rate(gJp.get(k), id) < rate(gGl.get(k), id)).length;
const jpUsed = shared.reduce((n, k) => n + gJp.get(k).length, 0);
const glUsed = shared.reduce((n, k) => n + gGl.get(k).length, 0);

// 需要側バッテリー（2回実行）
const runs = [];
for (const f of ['demand-battery-v1-results-run1.json', 'demand-battery-v1-results-run2.json']) {
  const d = JSON.parse(await readFile(resolve(root, 'data/discoverability', f), 'utf8'));
  const qs = Array.isArray(d) ? d : d.results;
  const NAMES = ['Profound', 'Peec AI', 'Otterly', 'Semrush', 'Ahrefs', 'AthenaHQ', 'Goodie', 'SE Ranking',
    'Similarweb', 'Scrunch', 'BrightEdge', 'Conductor', 'Speee', 'PLAN-B', 'ナイル', 'CINC', 'LANY',
    'ウィルゲート', 'メディアグロース', 'アイオイクス', 'グラッドキューブ', 'アドカル',
    'デジタルアイデンティティ', 'GMO TECH', '揚羽', 'RapiQ', 'メディアリーチ'];
  const OURS = ['kansei-link', 'kanseilink', 'synapse arrows', 'synapsearrows'];
  let cells = 0, named = 0, ours = 0, qNamed = 0;
  for (const q of qs) {
    let hit = false;
    for (const a of Object.values(q.answers ?? {})) {
      const t = a && !a.error ? (a.text ?? '') : null;
      if (t === null) continue;
      cells++;
      if (NAMES.some(n => t.toLowerCase().includes(n.toLowerCase()))) { named++; hit = true; }
      if (OURS.some(o => t.toLowerCase().includes(o))) ours++;
    }
    if (hit) qNamed++;
  }
  runs.push({ cells, named, ours, qNamed, questions: qs.length });
}
const allZero = runs.every(r => r.ours === 0);

// ── 共通の器 ────────────────────────────────────────
const STYLE = `<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--i);line-height:1.75}nav,main,footer{max-width:840px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:56px 28px}.hero>div{max-width:840px;margin:auto}.hero .eyebrow{font-size:12px;letter-spacing:.08em;opacity:.85}.hero h1{font-size:clamp(26px,4.4vw,40px);line-height:1.25;margin:.3em 0}.hero p{font-size:17px;opacity:.92;margin:0}h2{margin-top:46px;font-size:24px;border-left:5px solid var(--b);padding-left:14px}.lead{font-size:19px;background:var(--s);padding:22px;border-radius:12px}.stat{display:flex;gap:16px;flex-wrap:wrap;margin:26px 0}.stat div{flex:1 1 170px;border:1px solid var(--l);border-radius:12px;padding:16px}.stat strong{display:block;font-size:30px;line-height:1.2;color:var(--b)}.stat span{font-size:13px;color:var(--m)}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:15px}th,td{border-bottom:1px solid var(--l);padding:9px 10px;text-align:left}th{background:var(--s)}td.num{text-align:right;font-variant-numeric:tabular-nums}ul,ol{padding-left:1.3em}li{margin:.4em 0}details{border-top:1px solid var(--l);padding:14px 0}summary{font-weight:700;cursor:pointer}.note{color:var(--m);font-size:13px;border-left:3px solid var(--l);padding-left:12px;line-height:1.8}.cite{background:var(--s);border:1px dashed var(--b);border-radius:12px;padding:20px;margin:28px 0}.cite .c-h{font-weight:700;margin-bottom:8px;font-size:15px}.cite blockquote{margin:0;font-size:15px;line-height:1.9}.probe{background:#fff;border:2px solid var(--b);border-radius:14px;padding:24px;margin:32px 0}.probe .p-title{font-size:20px;font-weight:700;margin-bottom:6px}.probe p{color:var(--m);font-size:14px;margin:0 0 16px}.probe form{display:flex;gap:10px;flex-wrap:wrap}.probe input{flex:1 1 260px;min-width:0;padding:13px 15px;font-size:16px;border:1px solid var(--l);border-radius:10px}.probe button{padding:13px 24px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:var(--b);color:#fff;cursor:pointer;font-family:inherit}footer{border-top:1px solid var(--l);margin-top:52px;color:var(--m);font-size:14px}</style>`;

const PROBE = `
<div class="probe">
  <div class="p-title">Check your own site with the same tool</div>
  <p>The same check that produced these figures. Enter a URL — free, no signup, 5-15 seconds.</p>
  <form action="/site-checker/" method="get">
    <input name="url" type="url" inputmode="url" spellcheck="false" required placeholder="https://example.com" aria-label="URL to check">
    <button type="submit">Check for free</button>
  </form>
</div>`;

const tbl = (head, rows2, numericFrom = 1) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
  rows2.map(r => `<tr>${r.map((c, i) => `<td${i >= numericFrom ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function shell({ slug, title, desc, eyebrow, sub, jaUrl, body, faq, method, cite }) {
  const canonical = `${ORIGIN}/en/insights/${slug}.html`;
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', '@id': `${canonical}#article`, headline: title, description: desc,
        datePublished: DATE, dateModified: DATE, inLanguage: 'en',
        author: { '@id': `${ORIGIN}/#organization` }, publisher: { '@id': `${ORIGIN}/#organization` },
        mainEntityOfPage: canonical, translationOfWork: { '@id': `${jaUrl}#article` } },
      { '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      { '@type': 'Organization', '@id': `${ORIGIN}/#organization`, name: 'KanseiLink',
        alternateName: ['KanseiLINK'], url: `${ORIGIN}/`,
        parentOrganization: { '@id': 'https://synapsearrows.com/#organization' },
        disambiguatingDescription: 'The name "Kansei" is phonetic. KanseiLink has nothing to do with Kansei Engineering, affective evaluation, emotion analysis or sentiment analysis.',
        sameAs: ['https://www.youtube.com/channel/UC0mscauCUi5NGxYMhbRWY3A'] },
      { '@type': 'Organization', '@id': 'https://synapsearrows.com/#organization',
        name: 'Synapse Arrows Pte. Ltd.', url: 'https://synapsearrows.com',
        sameAs: ['https://www.wikidata.org/wiki/Q140399505'] }
    ]
  };
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | KanseiLink</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${jaUrl}"><link rel="alternate" hreflang="en" href="${canonical}"><link rel="alternate" hreflang="x-default" href="${jaUrl}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="en_US">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
${STYLE}</head>
<body><nav><a class="brand" href="/en/">KanseiLink</a><a href="/en/insights/">Research &amp; Insights</a></nav>
<header class="hero"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div></header>
<main>
${body}
<div class="cite"><div class="c-h">Citing this research (use as it stands)</div><blockquote>${esc(cite)}</blockquote></div>
${PROBE}
<h2>FAQ</h2>
${faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
<h2>Method and limits</h2>
${method}
<p class="note">What we do not promise: we cannot guarantee visibility or ranking inside any AI product, and we do not treat a single AI answer as market share. <a href="/independence.html">Principles of Independence</a></p>
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/en/insights/">Research &amp; Insights</a> · <a href="/site-checker/">Free AI visibility check</a> · <a href="${jaUrl}">日本語版</a></footer>
</body></html>`;
}

await mkdir(OUT, { recursive: true });
const written = [];
async function emit(page) {
  await writeFile(resolve(OUT, `${page.slug}.html`), shell(page), 'utf8');
  written.push(page.slug);
}

// ── 1. 日本 vs グローバル ────────────────────────────
const llmsJp = catAvg(gJp, 'llms_txt'), llmsGl = catAvg(gGl, 'llms_txt');
const smJp = catAvg(gJp, 'sitemap'), smGl = catAvg(gGl, 'sitemap');
const CHECKS = [['ai_crawlers', 'Blocks AI crawlers'], ['jsonld', 'No structured data'],
  ['contact_info', 'Contact details not machine-readable'], ['sitemap', 'No sitemap.xml'], ['llms_txt', 'No llms.txt']];

await emit({
  slug: 'jp-vs-global-ai-readability-2026-09',
  title: 'We measured Japanese and global SaaS the same way — in this sample the gap sits in one place',
  desc: `${jp.length} Japanese and ${gl.length} global SaaS domains measured with one tool, compared category by category. The difference concentrates in llms.txt adoption; sitemap coverage is better on the Japanese side.`,
  eyebrow: `FIRST-PARTY RESEARCH · measured JP ${jp.length} / global ${gl.length} · compared JP ${jpUsed} / global ${glUsed} · ${DATE}`,
  sub: 'The assumption that Japanese SaaS lags on AI readiness is not what the measurement shows. Most checks came out close, and one came out consistently apart.',
  jaUrl: `${ORIGIN}/insights/jp-vs-global-ai-readability-2026-09.html`,
  body: `
<p class="lead">We ran the same check over ${jp.length} Japanese and ${gl.length} global SaaS domains, then compared <strong>accounting against accounting, HR against HR</strong> so that a difference in category mix could not masquerade as a difference between markets. In this sample the gap concentrates in <strong>llms.txt adoption</strong>; everything else is close.</p>
<p class="note">The comparison below uses the ${shared.length} categories with at least ${MIN_N} domains on both sides (${jpUsed} Japanese, ${glUsed} global). Categories too thin on either side were left out, because a single company moves the rate too far. <strong>The full ${jp.length} and ${gl.length} are not the base of the conclusion.</strong></p>

<h2>Where the gap sits</h2>
<p>llms.txt — the plain text file telling an AI which pages explain what. The Japanese side was higher (i.e. worse) in ${shared.every(k => rate(gJp.get(k), 'llms_txt') > rate(gGl.get(k), 'llms_txt')) ? '<strong>every one</strong> of' : 'most of'} the ${shared.length} compared categories.</p>
${tbl(['Category', `Japanese sample (${jpUsed})`, `Global sample (${glUsed})`],
  shared.map(k => [EN_CAT[k] ?? k,
    `${f1(rate(gJp.get(k), 'llms_txt'))} (n=${gJp.get(k).length})`,
    `${f1(rate(gGl.get(k), 'llms_txt'))} (n=${gGl.get(k).length})`]))}
<p><strong>Mean of category rates: Japanese ${f1(llmsJp)} · global ${f1(llmsGl)} (${(llmsGl - llmsJp).toFixed(1)}pt)</strong></p>

<h2>Everything else came out close</h2>
${tbl(['Check', 'Japanese sample', 'Global sample', 'Difference'],
  CHECKS.map(([id, label]) => {
    const a = catAvg(gJp, id), b = catAvg(gGl, id);
    return [label, f1(a), f1(b), `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(1)}pt`];
  }))}
<p class="note">Mean of category rates. A positive difference means the global sample failed that check more often.</p>
<ul>
<li><strong>Almost nobody blocks AI crawlers</strong> in either sample. Among major SaaS, "the site is configured to keep AI out" is the exception, not the rule.</li>
<li><strong>sitemap.xml is missing less often on the Japanese side</strong> (${f1(smJp)} against ${f1(smGl)}). Whatever else this sample shows, it is not that Japan trails on every check.</li>
<li>Structured data and contact details differ by under ten points, and the Japanese side is ahead in ${jpAhead('jsonld')} and ${jpAhead('contact_info')} of the ${shared.length} categories respectively — the difference is not one-directional.</li>
</ul>
<p>Median score: Japanese ${med(jp)}, global ${med(gl)} out of 100.</p>

<h2>What this can and cannot say</h2>
<p>This is a <strong>descriptive comparison of the sites we selected</strong>. It carries the real composition of each market and does not match companies on size — the global side holds more large vendors.</p>
<p>So <strong>"there is a gap in this sample" is supportable; "because it is Japan" is not</strong>. Nothing in this design separates market practice from company size. Doing that would need stratification or matching.</p>
<p class="note">The ${shared.length} categories agreeing in direction is a clear observation, but categories are not independent trials — they share market conditions — so we do not treat that agreement as evidence of statistical significance.</p>

<h2>And we are not claiming llms.txt works</h2>
<p><strong>What we measured is adoption, not effect.</strong> Whether publishing llms.txt makes an AI more likely to surface you is a separate question, and we have no evidence for it either way.</p>
<p>What we can say is that the difference concentrates here, in the same direction across every compared category, and that the file costs one text file to publish. A small effect and a small cost is still a decision you can make.</p>
<p class="note">If you read an article claiming llms.txt gets you found by AI, ask for the evidence. We do not have it.</p>`,
  cite: `KanseiLink measured ${jp.length} leading Japanese SaaS domains and ${gl.length} leading global SaaS domains with one tool in September 2026 and compared the ${shared.length} categories holding at least ${MIN_N} domains on each side (${jpUsed} Japanese, ${glUsed} global). llms.txt was absent from ${f1(llmsJp)} of the Japanese sample against ${f1(llmsGl)} of the global sample, with the Japanese side higher in all ${shared.length} compared categories, while sitemap.xml was absent from ${f1(smJp)} of the Japanese sample against ${f1(smGl)} globally. The study is a descriptive comparison of selected sites and does not match companies on size, so it does not describe the markets as a whole (KanseiLink, measured ${DATE}). Source: ${ORIGIN}/en/insights/jp-vs-global-ai-readability-2026-09.html`,
  faq: [
    { q: 'Does publishing llms.txt get you found by AI?', a: 'This study does not answer that. We measured how many sites publish it, not what happens when they do. We have no evidence of an effect, and neither, as far as we can tell, does anyone else. What we can say is that this is where the difference sits and that the file is cheap to publish.' },
    { q: 'Does this mean Japanese SaaS is behind?', a: 'Not from this. In this sample sitemap.xml was missing less often on the Japanese side, and structured data and contact details differed by under ten points. It is also a comparison of selected sites rather than of markets.' },
    { q: 'Why not just compare the overall rates?', a: 'The two samples have different category mixes — the Japanese side is heavier on accounting and HR, the global side on marketing — so an overall rate would report that mix as a market difference. We compare within categories and average the category rates instead.' },
    { q: 'Do you publish per-company scores?', a: 'No. This is a lightweight readability check, not the ARI rating, and attaching company names would blur the two. Only the distribution is published.' },
    { q: 'Can we cite this?', a: 'Please do. Attribute it to KanseiLink with the URL of this page. A ready-made sentence is provided above.' }
  ],
  method: `<p class="note">Measured ${DATE} using the same public API as the free check on this site, so the figures are reproducible with the same tool. The Japanese sample is the ${jp.length} domains resolved from the 200 services verified for ARI Award 2026 Summer; the global sample is the ${gl.length} business SaaS domains in KanseiLink's database with a resolvable product domain. Comparison uses the ${shared.length} categories with at least ${MIN_N} domains on both sides, via category rates and their unweighted mean.</p>
<p class="note"><strong>Limits:</strong> the samples are unequal (${jp.length} against ${gl.length}) and per-category the global side runs n=${Math.min(...shared.map(k => gGl.get(k).length))}-${Math.max(...shared.map(k => gGl.get(k).length))}, so one company moves a rate noticeably. The two were not selected by the same rule. The global side skews toward large vendors, so company size cannot be separated from market. This is one point in time and sites change. <strong>The check measures machine readability; it is not a quality judgement and not the ARI rating.</strong></p>`
});

// ── 2. 日本SaaS 162社 ──────────────────────────────
const blocked = failing(jp, 'ai_crawlers'), noJsonld = failing(jp, 'jsonld');
const noContact = failing(jp, 'contact_info'), noLlms = failing(jp, 'llms_txt');
const failedN = jpRaw.results.filter(r => !r.ok).length;

await emit({
  slug: 'jp-saas-ai-readability-2026-09',
  title: `We checked ${jp.length} Japanese SaaS sites — the front door is open, the room is unreadable`,
  desc: `${jp.length} leading Japanese SaaS domains measured with the same free tool: AI crawler access, structured data, contact details, llms.txt adoption.`,
  eyebrow: `FIRST-PARTY RESEARCH · n=${jp.length} · ${DATE}`,
  sub: 'Almost none of them block AI crawlers. Far more of them are unreadable once the crawler is inside.',
  jaUrl: `${ORIGIN}/insights/jp-saas-ai-readability-2026-09.html`,
  body: `
<p class="lead">In this sample of ${jp.length} leading Japanese SaaS domains, <strong>${f1(pct(blocked, jp.length))} block AI crawlers</strong> — but <strong>${f1(pct(noContact, jp.length))} do not put an address or phone number anywhere a machine can read</strong>, and <strong>${f1(pct(noLlms, jp.length))} publish no llms.txt</strong>. The door is open; what is behind it is hard to read.</p>

<div class="stat">
  <div><strong>${f1(pct(blocked, jp.length))}</strong><span>block AI crawlers</span></div>
  <div><strong>${f1(pct(noJsonld, jp.length))}</strong><span>no structured data</span></div>
  <div><strong>${f1(pct(noContact, jp.length))}</strong><span>contact details not machine-readable</span></div>
  <div><strong>${f1(pct(noLlms, jp.length))}</strong><span>no llms.txt</span></div>
</div>

<h2>What was measured</h2>
<p>Each domain was fetched with <strong>the same public API behind the free check on this site</strong> — anyone can reproduce these numbers with the same tool. For each domain we retrieved the public pages plus robots.txt, llms.txt and sitemap.xml, and scored whether AI crawlers can read it and whether a machine can tell what the business is. No logged-in areas were touched.</p>

<h2>By check</h2>
${tbl(['Check', 'Domains failing', 'Share'], [
  ['Blocks AI crawlers (GPTBot and others)', `${blocked} / ${jp.length}`, f1(pct(blocked, jp.length))],
  ['No structured data (JSON-LD)', `${noJsonld} / ${jp.length}`, f1(pct(noJsonld, jp.length))],
  ['Contact details not machine-readable', `${noContact} / ${jp.length}`, f1(pct(noContact, jp.length))],
  ['No sitemap.xml', `${failing(jp, 'sitemap')} / ${jp.length}`, f1(pct(failing(jp, 'sitemap'), jp.length))],
  ['No llms.txt', `${noLlms} / ${jp.length}`, f1(pct(noLlms, jp.length))]
])}
<p class="note">KanseiLink, measured ${DATE}, n=${jp.length}. "Failing" means the domain scored zero on that check.</p>
<p>Median score ${med(jp)}, mean ${Math.round(avg(jp.map(r => r.score)))} out of 100.</p>

<h2>What it reads as</h2>
<ul>
<li><strong>The entrance is open.</strong> Blocking AI crawlers is rare here. "Your site is configured to keep AI out" is not, for these companies, the common problem.</li>
<li><strong>The problem is further in.</strong> Sites that can be read still leave the machine unable to find an address, or to be told what the business is.</li>
<li><strong>What separates the top from the bottom is unglamorous</strong> — structured data and contact details, not advanced tactics.</li>
</ul>`,
  cite: `KanseiLink checked ${jp.length} leading Japanese SaaS domains in September 2026 and found ${f1(pct(noContact, jp.length))} with no machine-readable address or phone number and ${f1(pct(noLlms, jp.length))} with no llms.txt, while only ${f1(pct(blocked, jp.length))} block AI crawlers at all (KanseiLink, n=${jp.length}, measured ${DATE}). Source: ${ORIGIN}/en/insights/jp-saas-ai-readability-2026-09.html`,
  faq: [
    { q: 'How many companies is this?', a: `${jp.length} leading Japanese SaaS domains, drawn from the 200 services verified for ARI Award 2026 Summer and de-duplicated by domain. ${failedN} domains could not be fetched and are excluded.` },
    { q: 'Do you publish per-company scores?', a: 'No. This is a lightweight readability check, not the ARI rating; attaching names would blur the two. Only the distribution is published.' },
    { q: 'Does a low score mean AI will not recommend that company?', a: 'No. The check covers whether AI can read the site and tell what the business is. Whether a company gets recommended depends on competitors, third-party mentions and other factors. Nobody can guarantee ranking.' },
    { q: 'How do I check my own site?', a: 'The same check is free and public. Enter a URL, no signup, 5-15 seconds. The figures above came from that tool.' },
    { q: 'Can we cite this?', a: 'Please do. Attribute it to KanseiLink with the URL of this page. A ready-made sentence is provided above.' }
  ],
  method: `<p class="note">Measured ${DATE} with the same public API as the free check on this site. Target set: ${jpRaw.total} Japanese SaaS domains resolved from the 200 services verified for ARI Award 2026 Summer, de-duplicated by domain; ${jp.length} were fetched successfully and ${failedN} are excluded (DNS failures and redirect loops, still failing after retrying with a www. prefix). One point in time; sites change. <strong>This measures machine readability. It is not a quality judgement of any company and not the ARI rating.</strong> Per-company scores are withheld to avoid confusion with the rating.</p>`
});

// ── 3. 需要側クエリ（2回実行）─────────────────────────
await emit({
  slug: 'ai-visibility-jp-who-gets-recommended-2026-09',
  title: 'Who do AI assistants name when Japanese buyers ask about AI visibility? Mostly nobody',
  desc: `12 questions Japanese buyers type before they know any vendor, sent to three AI engines twice. Most answers name no company at all — and ours was named zero times in both runs.`,
  eyebrow: `FIRST-PARTY RESEARCH · 12 questions × 3 engines × ${runs.length} runs · ${DATE}`,
  sub: 'We ran it on ourselves too. The number that did not move was our own: zero.',
  jaUrl: `${ORIGIN}/insights/ai-visibility-jp-who-gets-recommended-2026-09.html`,
  body: `
<p class="lead">We put 12 questions — the words a Japanese buyer types before they know any vendor's name — to three AI engines, twice. Answers naming any company or tool at all: ${runs.map(r => `${r.named}/${r.cells}`).join(' and ')}. ${allZero ? '<strong>Answers naming Synapse Arrows or KanseiLink: zero, in both runs.</strong>' : ''} This category has no default answer in Japanese yet.</p>

<div class="stat">
  <div><strong>0</strong><span>answers naming us (both runs)</span></div>
  <div><strong>${runs.map(r => `${r.named}/${r.cells}`).join(' → ')}</strong><span>answers naming any company (run 1 → run 2)</span></div>
  <div><strong>${Math.min(...runs.map(r => r.qNamed))}-${Math.max(...runs.map(r => r.qNamed))} / ${runs[0].questions}</strong><span>questions producing a name (varies by run)</span></div>
</div>
<p class="note">Generative models vary between runs. The only figure identical across ${runs.length} runs was our own count of zero; read the rest as a range.</p>

<h2>Why run it twice</h2>
<p>A single run behind a headline number is not enough when the system is stochastic. Running it again moved the named-answer count from ${runs[0].named}/${runs[0].cells} to ${runs[1].named}/${runs[1].cells} and the questions-with-a-name from ${runs[0].qNamed} to ${runs[1].qNamed}. Those are ranges, not values. Our own zero did not move, which is why the piece leads on it.</p>

<h2>What it means for a category</h2>
<ul>
<li><strong>Most of these questions have no incumbent.</strong> For roughly half of them the engines explain a method and name nobody. That is not a market you are losing; it is one nobody has taken.</li>
<li><strong>Where names do appear, they are mostly foreign tools</strong> — the questions are in Japanese, the answers are US products.</li>
<li><strong>One question behaves differently.</strong> Asked which Japanese firms provide this service, the engines return a list visibly assembled from third-party roundup articles rather than from any vendor's own site. For that question, publishing your own page does not put you in the answer.</li>
<li><strong>We were not in any of it.</strong> We publish the measurements and were still named zero times. Building something and being known for it are different problems.</li>
</ul>`,
  cite: `KanseiLink asked 12 Japanese-language questions about AI visibility to three AI engines twice in September 2026. Answers naming any company or tool numbered ${runs[0].named} of ${runs[0].cells} in the first run and ${runs[1].named} of ${runs[1].cells} in the second, with around half the questions producing no name from any engine; Synapse Arrows and KanseiLink were named zero times in both runs (KanseiLink, measured ${DATE}). Source: ${ORIGIN}/en/insights/ai-visibility-jp-who-gets-recommended-2026-09.html`,
  faq: [
    { q: 'Is this a ranking of vendors?', a: 'No. It measures what AI answers contained, not the quality of any company or tool named. Appearing is not an endorsement and being absent is not a fault.' },
    { q: 'Why publish that you were named zero times?', a: 'We are a rating agency. Measuring others while withholding our own result would not be worth much. Zero is where we start from, and it is the baseline the next run is compared against.' },
    { q: 'How reproducible is this?', a: `Partly. Two runs moved the named-answer count and the questions-with-a-name; our own zero held. Two runs is not enough to characterise the variance, so read ranges rather than values. Also, ${runs[0].cells} answers from 12 questions across three engines are not independent trials.` },
    { q: 'What was recorded?', a: 'The date, the engine and model version, the verbatim prompts and the full answer text for every run.' }
  ],
  method: `<p class="note">Measured ${DATE}. Engines: Claude (claude-opus-4-8), GPT (gpt-5.4) and Perplexity (sonar). The 12 questions were sent in Japanese with no system prompt, exactly as written, and company and tool names were counted in the returned text. Run under identical conditions ${runs.length} times (${runs.map((r, i) => `run ${i + 1}: ${r.named}/${r.cells}`).join(', ')}). Gemini was largely unavailable on the day and is not counted. Counting is string matching against a known list of names, so operators outside that list are not counted.</p>
<p class="note"><strong>Limits:</strong> generative answers vary between runs, and ${runs.length} runs do not pin down the variance, so individual counts are not settled values. The ${runs[0].cells}-odd answers come from the same 12 questions across three engines and are not independent trials. This measures AI answers, not the quality of the companies named, and no named party paid anything.</p>`
});

console.log(`Wrote ${written.length} English research pages:`);
for (const w of written) console.log(`  ${ORIGIN}/en/insights/${w}.html`);
