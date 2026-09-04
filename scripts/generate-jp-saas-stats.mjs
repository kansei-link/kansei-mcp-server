#!/usr/bin/env node
/**
 * 日本SaaS一括スキャンの集計と、その記事の生成。
 *
 * 数字はすべてスキャン結果JSONから数える。本文に手で書き写した数値は置かない。
 *
 * 引用のされ方を設計している点が重要:
 *   まとめ記事を書く側もAIに下書きさせている前提に立つと、狙うべきは
 *   「引用されやすい数字」ではなく「名前ごと持っていかれる数字」。
 *   そのため本文中の統計は必ず「KanseiLINK調べ（日付・n）」を文の中に含め、
 *   さらに引用用の一文をコピーできる形で置く。数字だけ抜かれても社名が残る。
 *
 *   node scripts/generate-jp-saas-stats.mjs [--scan data/discoverability/jp-saas-scan-<日付>.json]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SLUG = 'jp-saas-ai-readability-2026-09';
const CANONICAL = `https://kansei-link.com/insights/${SLUG}.html`;
const ATTRIB = 'KanseiLINK調べ';

const argIdx = process.argv.indexOf('--scan');
const scanPath = argIdx > -1 ? process.argv[argIdx + 1]
  : 'data/discoverability/jp-saas-scan-2026-09-03.json';
const scan = JSON.parse(await readFile(resolve(root, scanPath), 'utf8'));
const rows = scan.results.filter(r => r.ok);
const failed = scan.results.filter(r => !r.ok);
const N = rows.length;
if (N < 30) throw new Error(`成功件数が少なすぎます (${N})。統計として公開しない。`);

const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = n => Math.round((n / N) * 1000) / 10;
const has = (r, id) => r.findings?.[id];
const failing = id => rows.filter(r => { const f = has(r, id); return f && f.max > 0 && f.points === 0; });

// ── 集計 ───────────────────────────────────────────────────────────
const blocked = failing('ai_crawlers');
const noJsonld = failing('jsonld');
const noTypes = failing('jsonld_types');
const noContact = failing('contact_info');
const noLlms = failing('llms_txt');
const noSitemap = failing('sitemap');
const noOgp = failing('ogp');
const thinText = failing('text_visibility');

const scores = rows.map(r => r.score).sort((a, b) => a - b);
const median = scores[Math.floor(scores.length / 2)];
const mean = Math.round(scores.reduce((s, x) => s + x, 0) / N);
const gradeCount = {};
for (const r of rows) gradeCount[r.grade] = (gradeCount[r.grade] ?? 0) + 1;
const GRADE_ORDER = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'C', 'D', 'F'];
const grades = GRADE_ORDER.filter(g => gradeCount[g]).map(g => [g, gradeCount[g]]);

const byCat = {};
for (const r of rows) {
  (byCat[r.category] ??= []).push(r.score);
}
const catRows = Object.entries(byCat)
  .filter(([, v]) => v.length >= 5)
  .map(([c, v]) => [c, String(v.length), String(Math.round(v.reduce((s, x) => s + x, 0) / v.length))])
  .sort((a, b) => Number(b[2]) - Number(a[2]));

// ── 記事 ───────────────────────────────────────────────────────────
const STAT = (n, what) => `${ATTRIB}（${scan.scanned_at}・n=${N}）では、日本の主要SaaS ${N}ドメインのうち<strong>${pct(n)}%（${n}件）が${what}</strong>`;

const CITE_JA = `KanseiLINKが2026年9月に日本の主要SaaS ${N}ドメインを診断したところ、${pct(noContact.length)}%で住所や電話番号がAIの読み取れる形で書かれておらず、${pct(noLlms.length)}%にAI向けの案内ファイル（llms.txt）がなかった（KanseiLINK調べ・n=${N}・${scan.scanned_at}）。出典: ${CANONICAL}`;

const table = (head, rows2, numeric) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
  rows2.map(r => `<tr>${r.map((c, i) => `<td${numeric && i > 0 ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const faq = [
  { q: `この調査は何社を対象にしていますか？`,
    a: `KanseiLINKのデータベースにある日本の主要SaaS ${N}ドメインです。ARI Award 2026 Summer の検証対象200サービスからドメインが特定できたものを、重複を除いて抽出しました。${failed.length > 0 ? `${failed.length}ドメインは取得に失敗したため集計から除いています。` : ''}` },
  { q: `個社の点数は公開しますか？`,
    a: `していません。この診断はサイトの機械可読性を短時間で測る軽量なもので、ARI Awardの格付けとは別物です。個社名と結びつけると、格付けと混同されるおそれがあるため、分布のみを公開しています。` },
  { q: `スコアが低い会社は、AIに推薦されないということですか？`,
    a: `違います。測っているのは「AIがそのサイトを読めて、何の会社か判別できるか」までです。実際に推薦されるかは競合との相対や第三者からの言及など別の要素が効きます。表示順位は誰にも保証できません。` },
  { q: `自社のスコアはどう調べますか？`,
    a: `同じ診断を無料で公開しています。URLを入れるだけ、登録不要で5〜15秒です。この記事の数字は、その同じツールで測ったものです。` },
  { q: `このデータを記事で引用してもいいですか？`,
    a: `どうぞ。出典として「${ATTRIB}」と本記事のURLを明記してください。引用用の一文を記事内に用意しています。` }
];

const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Article', '@id': `${CANONICAL}#article`,
      headline: `日本のSaaS ${N}サイトを診断したら、AIに読まれる準備はどこまでできていたか`,
      description: `日本の主要SaaS ${N}ドメインを同一の診断ツールで測定。AIクローラーの可否、構造化データ、連絡先の記載、llms.txtの設置率を集計しました。`,
      datePublished: scan.scanned_at, dateModified: scan.scanned_at, inLanguage: 'ja',
      author: { '@id': 'https://kansei-link.com/#organization' },
      publisher: { '@id': 'https://kansei-link.com/#organization' },
      mainEntityOfPage: CANONICAL },
    { '@type': 'Dataset', '@id': `${CANONICAL}#dataset`,
      name: `日本の主要SaaS ${N}ドメインのAI可読性スキャン（${scan.scanned_at}）`,
      description: `公開されている無料診断と同一のAPIで、日本の主要SaaS ${N}ドメインを測定した結果の集計。`,
      creator: { '@id': 'https://kansei-link.com/#organization' },
      dateCreated: scan.scanned_at, inLanguage: 'ja', isAccessibleForFree: true,
      measurementTechnique: '各ドメインの公開ページとrobots.txt・llms.txt・sitemap.xmlを取得し、AIクローラーの可否、構造化データ、機械可読性を採点',
      variableMeasured: ['AIクローラーの可否', '構造化データの有無', '連絡先の機械可読性', 'llms.txtの設置'] },
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

const STYLE = `<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.9}nav,main,footer{max-width:840px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:56px 28px}.hero>div{max-width:840px;margin:auto}.hero .eyebrow{font-size:12px;letter-spacing:.08em;opacity:.85}.hero h1{font-size:clamp(26px,4.4vw,40px);line-height:1.4;margin:.3em 0}.hero p{font-size:17px;opacity:.92;margin:0}h2{margin-top:48px;font-size:24px;border-left:5px solid var(--b);padding-left:14px}.lead{font-size:19px;background:var(--s);padding:22px;border-radius:12px}.stat{display:flex;gap:16px;flex-wrap:wrap;margin:26px 0}.stat div{flex:1 1 170px;border:1px solid var(--l);border-radius:12px;padding:16px}.stat strong{display:block;font-size:32px;line-height:1.2;color:var(--b)}.stat span{font-size:13px;color:var(--m)}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:15px}th,td{border-bottom:1px solid var(--l);padding:9px 10px;text-align:left}th{background:var(--s)}td.num{text-align:right;font-variant-numeric:tabular-nums}details{border-top:1px solid var(--l);padding:14px 0}summary{font-weight:700;cursor:pointer}.note{color:var(--m);font-size:14px;border-left:3px solid var(--l);padding-left:12px;line-height:1.8}.cite{background:var(--s);border:1px dashed var(--b);border-radius:12px;padding:20px;margin:28px 0}.cite .c-h{font-weight:700;margin-bottom:8px}.cite blockquote{margin:0;font-size:15px;line-height:1.9}.probe{background:#fff;border:2px solid var(--b);border-radius:14px;padding:24px;margin:34px 0}.probe .p-title{font-size:20px;font-weight:700;margin-bottom:6px}.probe p{color:var(--m);font-size:14px;margin:0 0 16px}.probe form{display:flex;gap:10px;flex-wrap:wrap}.probe input{flex:1 1 260px;min-width:0;padding:13px 15px;font-size:16px;border:1px solid var(--l);border-radius:10px}.probe button{padding:13px 24px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:var(--b);color:#fff;cursor:pointer;font-family:inherit}footer{border-top:1px solid var(--l);margin-top:56px;color:var(--m);font-size:14px}</style>`;

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日本のSaaS ${N}サイトを診断したら、AIに読まれる準備はどこまでできていたか | KanseiLink</title>
<meta name="description" content="${esc(`${ATTRIB}が日本の主要SaaS ${N}ドメインを同一の診断ツールで測定。AIクローラーの可否、構造化データ、連絡先の記載、llms.txt設置率の分布を公開します。`)}">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${CANONICAL}">
<link rel="alternate" hreflang="ja" href="${CANONICAL}"><link rel="alternate" hreflang="en" href="https://kansei-link.com/en/insights/jp-saas-ai-readability-2026-09.html"><link rel="alternate" hreflang="x-default" href="${CANONICAL}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(`日本のSaaS ${N}サイトを診断したら、AIに読まれる準備はどこまでできていたか`)}"><meta property="og:url" content="${CANONICAL}"><meta property="og:locale" content="ja_JP">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
${STYLE}</head>
<body><nav><a class="brand" href="/">KanseiLink</a><a href="/insights/">Research &amp; Insights</a></nav>
<header class="hero"><div><div class="eyebrow">一次調査 · n=${N} · ${scan.scanned_at}</div>
<h1>日本のSaaS ${N}サイトを診断したら、AIに読まれる準備はどこまでできていたか</h1>
<p>公開している無料診断と同じツールで、日本の主要SaaS ${N}ドメインを測りました。個社名ではなく分布を出します。</p></div></header>
<main>
<p class="lead">${ATTRIB}（${scan.scanned_at}・n=${N}）では、日本の主要SaaS ${N}ドメインのうち<strong>${pct(noContact.length)}%が住所や電話番号をAIの読み取れる形で書いておらず、${pct(noLlms.length)}%はAI向けの案内ファイル（llms.txt）を置いていません</strong>。一方でAIクローラーを拒否しているのは${pct(blocked.length)}%だけでした。<strong>入口は開いているのに、中の情報が機械に読める形になっていない</strong>——これが現在地です。</p>

<div class="stat">
  <div><strong>${pct(blocked.length)}%</strong><span>AIクローラーを拒否している</span></div>
  <div><strong>${pct(noJsonld.length)}%</strong><span>構造化データがない</span></div>
  <div><strong>${pct(noContact.length)}%</strong><span>連絡先がAIに読めない</span></div>
  <div><strong>${pct(noLlms.length)}%</strong><span>llms.txtがない</span></div>
</div>

<h2>何を測ったか</h2>
<p>KanseiLINKのデータベースにある日本の主要SaaS ${N}ドメインに対し、<strong>一般公開している無料診断とまったく同じAPI</strong>を使って測定しました。誰でも同じツールで、同じ数字を再現できます。</p>
<p>各ドメインについて、公開ページとrobots.txt・llms.txt・sitemap.xmlを取得し、AIクローラーが読めるか、会社やサービスの情報が機械可読な形で書かれているかを採点しています。ログインが必要な領域には入っていません。</p>

<h2>項目別の結果</h2>
${table(['項目', '未対応のドメイン', '割合'], [
  ['AIクローラー（GPTBot等）を拒否している', `${blocked.length} / ${N}`, `${pct(blocked.length)}%`],
  ['構造化データ（JSON-LD）がない', `${noJsonld.length} / ${N}`, `${pct(noJsonld.length)}%`],
  ['事業内容の型宣言がない', `${noTypes.length} / ${N}`, `${pct(noTypes.length)}%`],
  ['連絡先・所在地が機械可読でない', `${noContact.length} / ${N}`, `${pct(noContact.length)}%`],
  ['本文のテキスト量が不足', `${thinText.length} / ${N}`, `${pct(thinText.length)}%`],
  ['sitemap.xml がない', `${noSitemap.length} / ${N}`, `${pct(noSitemap.length)}%`],
  ['OGP が揃っていない', `${noOgp.length} / ${N}`, `${pct(noOgp.length)}%`],
  ['llms.txt がない', `${noLlms.length} / ${N}`, `${pct(noLlms.length)}%`]
], true)}
<p class="note">${ATTRIB}（${scan.scanned_at}・n=${N}）。「未対応」は当該項目の得点が0だったドメイン数です。</p>

<h2>スコアの分布</h2>
<p>中央値 <strong>${median}点</strong>、平均 <strong>${mean}点</strong>（100点満点）。</p>
${table(['等級', 'ドメイン数', '割合'], grades.map(([g, c]) => [g, String(c), `${pct(c)}%`]), true)}

<h2>カテゴリ別の平均スコア</h2>
${table(['カテゴリ', 'n', '平均スコア'], catRows, true)}
<p class="note">5ドメイン以上あるカテゴリのみ掲載。nが小さいカテゴリの差は偶然の範囲に入りやすいため、順位として読まないでください。</p>

<h2>読み取れること</h2>
<ul>
<li><strong>入口はほぼ開いている。</strong>AIクローラーを拒否しているのは${pct(blocked.length)}%にとどまりました。「AIに読ませない設定になっている」は、少なくとも主要SaaSでは例外です。</li>
<li><strong>詰まっているのは、その先。</strong>読める状態にはなっているのに、${pct(noContact.length)}%で連絡先が機械可読でなく、${pct(noLlms.length)}%でllms.txtがありません。<strong>「AIに来てもらう」より「来たAIに分かる形で置く」ほうが遅れています。</strong></li>
<li><strong>差がつくのは基本のところ。</strong>上位と下位を分けていたのは高度な施策ではなく、構造化データと連絡先の記載という、地味な項目でした。</li>
</ul>

<div class="cite">
  <div class="c-h">この調査を引用する場合（そのままお使いください）</div>
  <blockquote>${esc(CITE_JA)}</blockquote>
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
<p class="note">${scan.scanned_at} 実施。対象はKanseiLINKのデータベースにある日本の主要SaaS ${scan.total}ドメイン（ARI Award 2026 Summer 検証対象200サービスからドメインを特定し重複を除いたもの）。うち${N}ドメインの取得に成功し、${failed.length}ドメインは取得に失敗したため集計から除いています（内訳はDNSが引けない、リダイレクトが循環する等の技術的理由で、いずれも www. 付きでの再試行後も取得できなかったものです）。測定には一般公開している無料診断と同一のAPIを使用しました。1時点の測定であり、サイトは更新されるため値は変動します。<strong>この診断はサイトの機械可読性を測るものであり、企業の品質評価でも、ARI Awardの格付けでもありません。</strong>個社のスコアは、格付けとの混同を避けるため公開していません。</p>
<p class="note">保証しないこと: AIでの表示順位は保証できません。1回のAI回答をシェアとして扱うこともしません。<a href="/independence.html">独立性のポリシー</a></p>
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/site-checker/">無料AI可視性診断</a> · <a href="https://kansei-link.com/en/insights/jp-saas-ai-readability-2026-09.html">English version</a></footer>
</body></html>`;

await writeFile(resolve(root, 'public/insights', `${SLUG}.html`), html, 'utf8');
console.log(`Wrote public/insights/${SLUG}.html`);
console.log(`  n=${N}（失敗 ${failed.length}）／ 中央値 ${median} 平均 ${mean}`);
console.log(`  クローラー拒否 ${pct(blocked.length)}% ／ 構造化データなし ${pct(noJsonld.length)}% ／ 連絡先不可 ${pct(noContact.length)}% ／ llms.txtなし ${pct(noLlms.length)}%`);
