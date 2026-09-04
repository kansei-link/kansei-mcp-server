#!/usr/bin/env node
/**
 * 日本 vs グローバルの比較記事を、スキャン結果から生成する。
 *
 * 数字は本文に書き写さず、すべてここで数える。
 * カテゴリ構成の違いが差に化けるのを避けるため、結論に使うのは
 * 「両市場でMIN_N件以上あるカテゴリの率」と「その単純平均」。
 * 全体率は参考として出す（compare-markets.mjs と同じ考え方）。
 *
 * ⚠️ 測ったのは設置率の差であって、llms.txt が AI可視性を上げるかは検証していない。
 * 本文でも効果は「未検証」と書くこと。断定した瞬間に、批判している一般論と同じになる。
 *
 *   node scripts/generate-market-comparison.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SLUG = 'jp-vs-global-ai-readability-2026-09';
const CANONICAL = `https://kansei-link.com/insights/${SLUG}.html`;
const DATE = '2026-09-03';
const MIN_N = 5;

const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

const CATEGORY_MAP = {
  '会計・経理・請求書': 'accounting', '人事・労務・勤怠・給与': 'hr', 'CRM・SFA・営業支援': 'crm',
  '決済・POS・フィンテック': 'payment', 'カスタマーサポート・CS': 'support',
  'プロジェクト管理・業務効率化': 'project_management', 'マーケティング・MA・広告': 'marketing',
  'EC・コマース': 'ecommerce', '契約・リーガル': 'legal',
  'コミュニケーション・グループウェア': 'communication', 'セキュリティ・ID管理': 'security',
  'BI・データ分析': 'bi_analytics', '経費精算・ワークフロー': 'expense_workflow',
  '物流・配送': 'logistics', '医療・ヘルスケア': 'healthcare', '教育・LMS': 'education',
  '予約・店舗管理': 'reservation', '建設・不動産': 'real_estate'
};
const LABEL = {
  accounting: '会計・請求', hr: '人事・勤怠', crm: 'CRM・営業', payment: '決済',
  support: 'カスタマーサポート', project_management: 'プロジェクト管理', marketing: 'マーケティング',
  ecommerce: 'EC', communication: 'コミュニケーション'
};
const norm = r => CATEGORY_MAP[r.category] ?? r.category;
const isFail = (r, id) => { const f = r.findings?.[id]; return f && f.max > 0 && f.points === 0; };
const group = rows => rows.reduce((m, r) => (m.set(norm(r), [...(m.get(norm(r)) ?? []), r]), m), new Map());
const gJp = group(jp), gGl = group(gl);
const shared = [...gJp.keys()].filter(k => gGl.has(k) && gJp.get(k).length >= MIN_N && gGl.get(k).length >= MIN_N);
const rate = (rows, id) => (rows.filter(r => isFail(r, id)).length / rows.length) * 100;
const avg = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const catAvg = (g, id) => avg(shared.map(k => rate(g.get(k), id)));
const f1 = v => `${v.toFixed(1)}%`;
const med = rows => { const s = rows.map(r => r.score).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const CHECKS = [
  ['ai_crawlers', 'AIクローラーを拒否している'],
  ['jsonld', '構造化データがない'],
  ['contact_info', '連絡先が機械可読でない'],
  ['sitemap', 'sitemap.xml がない'],
  ['llms_txt', 'llms.txt がない']
];

// 比較に使ったのは shared カテゴリ分だけ。測定総数との差を隠さない。
const jpUsed = shared.reduce((n, k) => n + gJp.get(k).length, 0);
const glUsed = shared.reduce((n, k) => n + gGl.get(k).length, 0);

const llmsJp = catAvg(gJp, 'llms_txt'), llmsGl = catAvg(gGl, 'llms_txt');
const llmsAllWorse = shared.every(k => rate(gJp.get(k), 'llms_txt') > rate(gGl.get(k), 'llms_txt'));
const sitemapJp = catAvg(gJp, 'sitemap'), sitemapGl = catAvg(gGl, 'sitemap');

const CITE = `KanseiLINKが2026年9月に日本の主要SaaS ${jp.length}ドメインとグローバルの主要SaaS ${gl.length}ドメインを同一の診断ツールで測定し、両市場に${MIN_N}件以上あった${shared.length}カテゴリ（日本${jpUsed}件・グローバル${glUsed}件）で比較したところ、llms.txt の未設置率は日本側サンプル ${f1(llmsJp)}、グローバル側サンプル ${f1(llmsGl)}で、比較した${shared.length}カテゴリすべてで日本側が上回った。一方 sitemap.xml の未設置率は日本側 ${f1(sitemapJp)}、グローバル側 ${f1(sitemapGl)}で日本側のほうが低かった。本調査は選定したサイト群の記述的比較であり、企業規模を揃えていないため市場全体の性質を示すものではない（KanseiLINK調べ・${DATE}）。出典: ${CANONICAL}`;

const tbl = (head, rows2) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
  rows2.map(r => `<tr>${r.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const faq = [
  { q: 'llms.txt を設置すればAIに見つけてもらえますか？',
    a: 'それはこの調査では検証していません。今回測ったのは設置率の差だけで、llms.txt があるとAIの回答に出やすくなるかどうかは別の問題です。効果を主張する材料は、現時点で私たちにもありません。分かっているのは、この一点だけ市場間で差が大きいという事実です。' },
  { q: 'では、なぜ llms.txt に注目するのですか？',
    a: '比較した項目の中で、差がここだけ突出しており、しかも比較した全カテゴリで同じ方向だったからです。加えて設置コストがほぼゼロ（テキストファイル1枚）なので、仮に効果が小さくても損失が小さい、という実務上の理由もあります。' },
  { q: '日本のSaaSはAI対応が遅れているということですか？',
    a: 'この調査からは、そこまでは言えません。今回のサンプルでは sitemap.xml の未設置率は日本側のほうが低く、構造化データや連絡先の差も1割未満でした。ただしこれは選んだサイト群の比較であって、市場全体の性質を示すものではありません。言えるのは「今回測った範囲では、日本が全項目で劣るという結果にはならなかった」までです。' },
  { q: '個社名は公開しますか？',
    a: 'していません。この診断はサイトの機械可読性を短時間で測る軽量なもので、ARI Awardの格付けとは別物です。個社名と結びつけると格付けと混同されるおそれがあるため、分布のみを公開しています。' },
  { q: 'このデータを引用してもいいですか？',
    a: 'どうぞ。出典として「KanseiLINK調べ」と本記事のURLを明記してください。引用用の一文を記事内に用意しています。' }
];

const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Article', '@id': `${CANONICAL}#article`,
      headline: '日本とグローバルの主要SaaSを同じ基準で測った — このサンプルでは、差は一点に集中していた',
      description: `日本の主要SaaS ${jp.length}ドメインとグローバルSaaS ${gl.length}ドメインを同一の診断ツールで比較。カテゴリを揃えて集計しました。`,
      datePublished: DATE, dateModified: DATE, inLanguage: 'ja',
      author: { '@id': 'https://kansei-link.com/#organization' },
      publisher: { '@id': 'https://kansei-link.com/#organization' }, mainEntityOfPage: CANONICAL },
    { '@type': 'Dataset', '@id': `${CANONICAL}#dataset`,
      name: `日本・グローバルSaaSのAI可読性比較（${DATE}）`,
      description: `日本 ${jp.length}ドメイン、グローバル ${gl.length}ドメインを同一APIで測定し、カテゴリを揃えて比較した集計。`,
      creator: { '@id': 'https://kansei-link.com/#organization' },
      dateCreated: DATE, inLanguage: 'ja', isAccessibleForFree: true,
      measurementTechnique: '公開ページとrobots.txt・llms.txt・sitemap.xmlを取得し採点。両市場で5件以上あるカテゴリの率と、その単純平均で比較',
      variableMeasured: CHECKS.map(c => c[1]) },
    { '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@type': 'Organization', '@id': 'https://kansei-link.com/#organization', name: 'KanseiLink',
      alternateName: ['KanseiLINK', 'カンセイリンク'], url: 'https://kansei-link.com/',
      parentOrganization: { '@id': 'https://synapsearrows.com/#organization' },
      disambiguatingDescription: '社名の「Kansei」は語感に由来するもので、感性工学・感性評価・感情分析／センチメント分析とは無関係です。',
      sameAs: ['https://www.youtube.com/channel/UC0mscauCUi5NGxYMhbRWY3A', 'https://zenn.dev/kanseilink'] },
    { '@type': 'Organization', '@id': 'https://synapsearrows.com/#organization',
      name: 'Synapse Arrows Pte. Ltd.', url: 'https://synapsearrows.com',
      sameAs: ['https://www.wikidata.org/wiki/Q140399505'] }
  ]
};

const STYLE = `<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.9}nav,main,footer{max-width:860px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:56px 28px}.hero>div{max-width:860px;margin:auto}.hero .eyebrow{font-size:12px;letter-spacing:.08em;opacity:.85}.hero h1{font-size:clamp(26px,4.4vw,40px);line-height:1.4;margin:.3em 0}.hero p{font-size:17px;opacity:.92;margin:0}h2{margin-top:48px;font-size:24px;border-left:5px solid var(--b);padding-left:14px}.lead{font-size:19px;background:var(--s);padding:22px;border-radius:12px}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:15px}th,td{border-bottom:1px solid var(--l);padding:9px 10px;text-align:left}th{background:var(--s)}td.num{text-align:right;font-variant-numeric:tabular-nums}tr.avg td{font-weight:700;background:#fafbff}ul{padding-left:1.3em}li{margin:.4em 0}details{border-top:1px solid var(--l);padding:14px 0}summary{font-weight:700;cursor:pointer}.note{color:var(--m);font-size:13px;border-left:3px solid var(--l);padding-left:12px;line-height:1.8}.cite{background:var(--s);border:1px dashed var(--b);border-radius:12px;padding:20px;margin:28px 0}.cite .c-h{font-weight:700;margin-bottom:8px;font-size:15px}.cite blockquote{margin:0;font-size:15px;line-height:1.9}.probe{background:#fff;border:2px solid var(--b);border-radius:14px;padding:24px;margin:34px 0}.probe .p-title{font-size:20px;font-weight:700;margin-bottom:6px}.probe p{color:var(--m);font-size:14px;margin:0 0 16px}.probe form{display:flex;gap:10px;flex-wrap:wrap}.probe input{flex:1 1 260px;min-width:0;padding:13px 15px;font-size:16px;border:1px solid var(--l);border-radius:10px}.probe button{padding:13px 24px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:var(--b);color:#fff;cursor:pointer;font-family:inherit}footer{border-top:1px solid var(--l);margin-top:56px;color:var(--m);font-size:14px}</style>`;

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日本とグローバルの主要SaaSを同じ基準で測った — このサンプルでは、差は一点に集中していた | KanseiLink</title>
<meta name="description" content="${esc(`日本の主要SaaS ${jp.length}ドメインとグローバルSaaS ${gl.length}ドメインを同一の診断ツールで比較。カテゴリを揃えて集計したところ、差はllms.txtの設置率に集中し、sitemapは日本のほうが整備されていました。`)}">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${CANONICAL}">
<link rel="alternate" hreflang="ja" href="${CANONICAL}"><link rel="alternate" hreflang="en" href="https://kansei-link.com/en/insights/jp-vs-global-ai-readability-2026-09.html"><link rel="alternate" hreflang="x-default" href="${CANONICAL}">
<meta property="og:type" content="article"><meta property="og:title" content="日本とグローバルの主要SaaSを同じ基準で測った — このサンプルでは、差は一点に集中していた"><meta property="og:url" content="${CANONICAL}"><meta property="og:locale" content="ja_JP">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
${STYLE}</head>
<body><nav><a class="brand" href="/">KanseiLink</a><a href="/insights/">Research &amp; Insights</a></nav>
<header class="hero"><div><div class="eyebrow">一次調査 · 測定 日本${jp.length}/グローバル${gl.length} · 比較に使用 日本${jpUsed}/グローバル${glUsed} · ${DATE}</div>
<h1>日本とグローバルの主要SaaSを同じ基準で測った — このサンプルでは、差は一点に集中していた</h1>
<p>今回測った範囲では、「日本は全面的に遅れている」という結果にはなりませんでした。ほとんどの項目で差は小さく、sitemapはこのサンプルでは日本側が上。ただし1項目だけ、比較した全カテゴリで差がつきました。</p></div></header>
<main>
<p class="lead">日本の主要SaaS ${jp.length}ドメインとグローバルSaaS ${gl.length}ドメインを、同じ診断ツールで測りました。カテゴリ構成の違いが差に化けないよう、<strong>会計は会計と、人事は人事と</strong>比べています。結果、<strong>このサンプルでは差が llms.txt の設置率に集中し、他の項目はおおむね互角</strong>でした。</p>
<p class="note">なお以下の比較は、両市場に${MIN_N}件以上あった${shared.length}カテゴリ（日本${jpUsed}件・グローバル${glUsed}件）で行っています。片方の市場に${MIN_N}件未満しかなかったカテゴリは、偶然の幅が大きすぎるため比較から外しました。<strong>測定した全${jp.length}件・${gl.length}件がそのまま結論の母数ではありません。</strong></p>

<h2>このサンプルで差が集中していた一点</h2>
<p>llms.txt（AIに「どのページを見れば何が分かるか」を案内するテキストファイル）の<strong>未設置率</strong>です。比較した${shared.length}カテゴリの${llmsAllWorse ? '<strong>すべてで</strong>' : '多くで'}日本が上回りました。</p>
${tbl(['カテゴリ', `日本側サンプル (計${jpUsed})`, `グローバル側サンプル (計${glUsed})`],
  [...shared.map(k => [LABEL[k] ?? k, `${f1(rate(gJp.get(k), 'llms_txt'))} (n=${gJp.get(k).length})`, `${f1(rate(gGl.get(k), 'llms_txt'))} (n=${gGl.get(k).length})`])])}
<p><strong>カテゴリ率の平均: 日本側 ${f1(llmsJp)} ／ グローバル側 ${f1(llmsGl)}（差 ${(llmsGl - llmsJp).toFixed(1)}pt）</strong></p>

<h2>他の項目は、このサンプルではおおむね互角</h2>
${tbl(['項目', '日本側サンプル', 'グローバル側サンプル', '差'],
  CHECKS.map(([id, label]) => {
    const a = catAvg(gJp, id), b = catAvg(gGl, id);
    return [label, f1(a), f1(b), `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(1)}pt`];
  }))}
<p class="note">カテゴリ率の平均。プラスはグローバル側サンプルの未対応率が高いことを示します。</p>
<ul>
<li><strong>AIクローラーの拒否は、どちらのサンプルでもほぼ皆無。</strong>少なくとも今回測った主要SaaSでは、「AIに読ませない設定になっている」は例外でした。</li>
<li><strong>sitemap.xml は日本側サンプルのほうが未設置率が低い</strong>（${f1(sitemapJp)} 対 ${f1(sitemapGl)}）。少なくとも「日本はどの項目でも遅れている」という形にはなっていません。</li>
<li>構造化データと連絡先の差は1割未満で、カテゴリによっては日本側が上回ります。</li>
</ul>
<p>スコアの中央値は日本側 ${med(jp)}点、グローバル側 ${med(gl)}点（100点満点）でした。</p>

<h2>この調査が言えること、言えないこと</h2>
<p>これは<strong>選定したサイト群の記述的な比較</strong>です。現実の市場構成をそのまま含んでおり、企業規模を揃えていません。グローバル側には大手が多く含まれます。</p>
<p>したがって<strong>「このサンプルでは差があった」までは言えますが、「日本市場だから／日本企業だからこうなる」とは言えません</strong>。差の原因が市場慣行なのか企業規模なのかは、この設計では切り分けられていないためです。規模を揃えた比較をするには、層別分析かマッチングが別途必要です。</p>
<p class="note">また、比較した8カテゴリすべてで同じ方向だったことは観察としては明確ですが、カテゴリ同士は共通の市場要因を受けるため独立した試行ではありません。この一致を統計的な有意性の証拠として扱うことはしていません。</p>

<h2>ただし、llms.txt が効くとは言っていません</h2>
<p>ここは正確に書きます。<strong>この調査で測ったのは設置率の差だけです。</strong>llms.txt を置くとAIの回答に出やすくなるかどうかは、検証していません。効果を主張できる材料は、現時点で私たちにもありません。</p>
<p>分かっているのは、<strong>比較した項目の中で差がここだけ突出しており、しかも全カテゴリで同じ方向だった</strong>という事実です。そのうえで実務的に言えば、llms.txt はテキストファイル1枚なので<strong>設置コストがほぼゼロ</strong>です。効果が小さくても損失は小さい、という判断はできます。</p>
<p class="note">「置けばAIに見つけてもらえる」と書いている記事を見かけたら、その根拠を確認してください。私たちは持っていません。</p>

<div class="cite">
  <div class="c-h">この調査を引用する場合（そのままお使いください）</div>
  <blockquote>${esc(CITE)}</blockquote>
</div>

<div class="probe">
  <div class="p-title">自社のスコアを同じツールで測る</div>
  <p>この記事の数字を出したのと同じ診断です。URLを入れるだけ・登録不要・無料。5〜15秒で結果が出ます。</p>
  <form action="/site-checker/" method="get">
    <input name="url" type="url" inputmode="url" spellcheck="false" required placeholder="https://example.co.jp" aria-label="診断するサイトのURL">
    <button type="submit">無料で診断する</button>
  </form>
</div>

<h2>よくある質問</h2>
${faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}

<h2>手法と限界</h2>
<p class="note">${DATE} 実施。一般公開している無料診断と同一のAPIで測定しました。日本側はARI Award 2026 Summer 検証対象200サービスからドメインを特定した${jp.length}件、グローバル側はKanseiLINKのデータベースで製品ドメインが判明した業務系SaaS ${gl.length}件です。カテゴリ構成の違いが差に化けるのを避けるため、両市場で${MIN_N}件以上あるカテゴリ（${shared.length}カテゴリ）に絞り、カテゴリ別の率とその単純平均で比較しています。<strong>この絞り込みにより、比較に使ったのは日本${jpUsed}件（測定した${jp.length}件の${Math.round(jpUsed / jp.length * 100)}%）、グローバル${glUsed}件（同${Math.round(glUsed / gl.length * 100)}%）です。</strong>除外したのはCRM・セキュリティ・生産性・デザインなど、どちらかの市場で件数が足りなかったカテゴリです。</p>
<p class="note"><strong>限界:</strong> ①両市場で母数が異なり（${jp.length}対${gl.length}）、カテゴリ別のグローバル側は n=${Math.min(...shared.map(k => gGl.get(k).length))}〜${Math.max(...shared.map(k => gGl.get(k).length))}と小さいため、1社の違いで率が動きます。②選定基準が同一ではありません（日本＝既存の検証対象リスト、グローバル＝製品ドメインが判明した全件）。③グローバル側には大手が多く含まれるため、差の一部が市場ではなく企業規模に由来する可能性を排除できていません。<strong>したがって「差はある」までは言えますが、その原因が市場なのか企業規模なのかは、この設計では切り分けられていません。</strong>④1時点の測定であり、サイトは更新されるため値は変動します。</p>
<p class="note">この診断はサイトの機械可読性を測るものであり、企業の品質評価でも、ARI Awardの格付けでもありません。個社のスコアは、格付けとの混同を避けるため公開していません。保証しないこと: AIでの表示順位は保証できません。1回のAI回答をシェアとして扱うこともしません。<a href="/independence.html">独立性のポリシー</a></p>
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/site-checker/">無料AI可視性診断</a> · <a href="/insights/jp-saas-ai-readability-2026-09.html">日本のSaaS ${jp.length}サイトの調査</a> · <a href="https://kansei-link.com/en/insights/jp-vs-global-ai-readability-2026-09.html">English version</a></footer>
</body></html>`;

await writeFile(resolve(root, 'public/insights', `${SLUG}.html`), html, 'utf8');
console.log(`Wrote public/insights/${SLUG}.html`);
console.log(`  日本 n=${jp.length} / グローバル n=${gl.length} / 比較カテゴリ ${shared.length}`);
console.log(`  llms.txt未設置 日本 ${f1(llmsJp)} / グローバル ${f1(llmsGl)}（全カテゴリで日本が上回る: ${llmsAllWorse}）`);
