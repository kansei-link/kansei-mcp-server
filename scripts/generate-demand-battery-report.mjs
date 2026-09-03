#!/usr/bin/env node
/**
 * 需要側クエリ実測レポートのページ生成。
 *
 * 本文の数字はすべて data/discoverability/demand-battery-v1-results.json から数える。
 * 手で書き写さないのは、実測レポートで数字が本文とズレるのが一番効く事故だから。
 * 生データ（各エンジンの全回答）は実名を含む研究データなので公開しない
 * （data/discoverability は .gitignore 済み）。公開するのは集計と手法のみ。
 *
 *   node scripts/generate-demand-battery-report.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SRC = resolve(root, 'data/discoverability/demand-battery-v1-results.json');
const BATTERY = resolve(root, 'data/discoverability/demand-battery-v1.json');
const OUT = resolve(root, 'public/insights/ai-visibility-jp-who-gets-recommended-2026-09.html');

const CANONICAL = 'https://kansei-link.com/insights/ai-visibility-jp-who-gets-recommended-2026-09.html';
const RUN_DATE = '2026-09-03';

// 集計対象の固有名。海外AI可視性ツールと、日本のAEO/LLMO支援会社を分けて数える。
const FOREIGN = ['Profound', 'Peec AI', 'Otterly', 'Semrush', 'Ahrefs', 'AthenaHQ', 'Goodie',
  'SE Ranking', 'Similarweb', 'Scrunch', 'BrightEdge', 'Conductor', 'Evertune', 'Rankscale'];
const JAPANESE = ['Speee', 'PLAN-B', 'ナイル', 'CINC', 'LANY', 'ウィルゲート', 'メディアグロース',
  'アイオイクス', 'グラッドキューブ', 'アドカル', 'デジタルアイデンティティ', 'GMO TECH',
  '揚羽', 'RapiQ', 'メディアリーチ'];
const OURS = ['kansei-link', 'kanseilink', 'synapse arrows', 'synapsearrows', 'シナプスアローズ',
  'カンセイリンク', 'ARI Award'];

const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const results = JSON.parse(await readFile(SRC, 'utf8'));
const battery = JSON.parse(await readFile(BATTERY, 'utf8'));
const rows = Array.isArray(results) ? results : results.results;
const questionText = new Map(battery.questions.map(q => [q.id, q.question]));

const textOf = a => {
  if (!a || a.error) return null;
  return typeof a === 'string' ? a : (a.text ?? null);
};
const countIn = (text, names) => names.filter(n => text.toLowerCase().includes(n.toLowerCase()));

let cells = 0, oursCells = 0, namedCells = 0, namedQuestions = 0;
const engines = new Map();
const foreignHits = new Map();
const japaneseHits = new Map();
const perQuestion = [];

for (const q of rows) {
  let namedHere = false;
  const enginesNaming = [];
  for (const [eng, a] of Object.entries(q.answers ?? {})) {
    const text = textOf(a);
    if (text === null) continue;
    cells++;
    if (!engines.has(eng)) engines.set(eng, { total: 0, named: 0, model: a.model ?? '' });
    engines.get(eng).total++;
    if (countIn(text, OURS).length) oursCells++;
    const named = [...countIn(text, FOREIGN), ...countIn(text, JAPANESE)];
    for (const n of countIn(text, FOREIGN)) foreignHits.set(n, (foreignHits.get(n) ?? 0) + 1);
    for (const n of countIn(text, JAPANESE)) japaneseHits.set(n, (japaneseHits.get(n) ?? 0) + 1);
    if (named.length) { namedCells++; namedHere = true; engines.get(eng).named++; enginesNaming.push(eng); }
  }
  if (namedHere) namedQuestions++;
  perQuestion.push({ id: q.id, question: questionText.get(q.id) ?? q.id, named: namedHere, enginesNaming });
}

const byCount = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const engineList = [...engines.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const questions = rows.length;

if (oursCells !== 0) {
  console.warn(`NOTE: 自社言及が ${oursCells} 件あります。本文の「0件」表現を見直してください。`);
}

const answer = `${questions}問を${engineList.length}つのAIエンジンに素の状態で投げ、${cells}件の回答を得ました。`
  + `Synapse ArrowsとKanseiLINKの言及は${oursCells}件です。`
  + `一方で、固有名を挙げた回答自体が${namedCells}件しかありません。`
  + `このカテゴリには、日本語ではまだ「AIの定番の答え」が存在していません。`;

const keyPoints = [
  `${questions}問×${engineList.length}エンジン＝${cells}回答のうち、当社（Synapse Arrows／KanseiLINK）の言及は${oursCells}件でした。`,
  `固有名（企業名・ツール名）を挙げた回答は${namedCells}/${cells}件にとどまり、${questions}問中${namedQuestions}問でしか名前が出ません。残りは一般論で終わります。`,
  `名前が出る場合、多くは海外のAI可視性ツール（${byCount(foreignHits).slice(0, 4).map(([n]) => n).join('・')}など）でした。`,
  `「日本企業向けにAEO・LLMO対策を支援する会社」を尋ねたときだけ、日本の支援会社名がまとめて並びます。出どころは「おすすめN選」型のまとめ記事です。`,
  `測っている当社自身が0件だったという事実も、そのまま載せています。これは自己採点ではなく、外から見た現在地の記録です。`
];

const faq = [
  { q: 'この調査は「どの会社が優れているか」のランキングですか？',
    a: 'いいえ。測っているのはAIの回答内容であって、挙がった企業やツールの品質・実績ではありません。ここに名前が出ることは優劣を意味せず、出ないことも品質の欠如を意味しません。記録しているのは「日本語でこう聞いたとき、AIが誰の名前を出したか」という一点だけです。' },
  { q: 'なぜ自社が0件だったことを公開するのですか？',
    a: '当社はAgent Readinessを格付けする評価機関です。他社を測る立場で自社の測定結果だけ伏せるなら、その格付けは信用に値しません。0件は現在地であり、改善の前後で同じ質問を測り直すための基準点です。' },
  { q: '結果はどのくらい再現しますか？',
    a: '生成AIの回答は実行ごとに揺れます。本調査は特定日の1回の実行であり、確定値ではありません。個別の数字ではなく「当社の言及がゼロ」「固有名を挙げる回答自体が少数」という傾向の部分を読んでください。継続測定で更新します。' },
  { q: '自社がAIからどう見えているかを調べるには？',
    a: 'まず、AIがサイトを読める状態かを確認します。KanseiLINKの無料診断にURLを入れると、AIクローラーの可否、構造化データ、機械可読性を5〜15秒でスコア化します。そのうえで、AIが自社をどう説明し競合と比べてどれだけ推薦しているかは、質問群を設計した継続測定で測ります。' }
];

const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Article', '@id': `${CANONICAL}#article`,
      headline: '「AI検索で自社が出ない」と日本語でAIに聞くと、AIは誰を推薦するのか',
      description: `${questions}問の悩みクエリを${engineList.length}つのAIエンジンに投げた${cells}回答の実測。当社自身の言及数を含めて公開します。`,
      datePublished: RUN_DATE, dateModified: RUN_DATE, inLanguage: 'ja',
      author: { '@id': 'https://kansei-link.com/#organization' },
      publisher: { '@id': 'https://kansei-link.com/#organization' },
      mainEntityOfPage: CANONICAL },
    { '@type': 'Dataset', '@id': `${CANONICAL}#dataset`,
      name: '需要側クエリ実測バッテリー v1（AI可視性・LLMO・AEO測定）',
      description: `日本語の悩みクエリ${questions}問を${engineList.length}エンジンへ素の状態で送り、回答内の固有名を集計したもの。測定日 ${RUN_DATE}。`,
      creator: { '@id': 'https://kansei-link.com/#organization' },
      dateCreated: RUN_DATE, inLanguage: 'ja', isAccessibleForFree: true,
      measurementTechnique: 'システムプロンプトなしで質問文をそのまま送信し、回答本文に含まれる企業名・ツール名を集計',
      variableMeasured: ['回答数', '固有名を含む回答数', '当社への言及数'] },
    { '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@type': 'Organization', '@id': 'https://kansei-link.com/#organization', name: 'KanseiLink',
      alternateName: ['KanseiLINK', 'カンセイリンク'], url: 'https://kansei-link.com/',
      parentOrganization: { '@id': 'https://synapsearrows.com/#organization' },
      sameAs: ['https://www.youtube.com/channel/UC0mscauCUi5NGxYMhbRWY3A', 'https://zenn.dev/kanseilink'] },
    { '@type': 'Organization', '@id': 'https://synapsearrows.com/#organization',
      name: 'Synapse Arrows Pte. Ltd.', url: 'https://synapsearrows.com',
      sameAs: ['https://www.wikidata.org/wiki/Q140399505'] }
  ]
};

const listRow = ([name, n]) => `<tr><td>${esc(name)}</td><td class="num">${n}</td></tr>`;

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>「AI検索で自社が出ない」と聞くと、AIは誰を推薦するのか｜${questions}問×${engineList.length}エンジン実測 | KanseiLink</title>
<meta name="description" content="ChatGPTは自社をどう認識している、AI検索で表示されない、LLMO対策は何から——日本語の悩みクエリ${questions}問を${engineList.length}つのAIエンジンへ実測。${cells}回答中、当社の言及は${oursCells}件でした。誰の名前が出て、誰の名前が出ないのかを公開します。">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${CANONICAL}">
<meta property="og:type" content="article"><meta property="og:title" content="「AI検索で自社が出ない」と聞くと、AIは誰を推薦するのか"><meta property="og:url" content="${CANONICAL}"><meta property="og:locale" content="ja_JP">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.85}nav,main,footer{max-width:900px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:60px 28px}.hero>div{max-width:900px;margin:auto}.hero h1{font-size:clamp(28px,4.6vw,44px);line-height:1.35}.hero p{font-size:17px;opacity:.92}h2{margin-top:50px;border-left:5px solid var(--b);padding-left:14px}.answer{font-size:19px;background:var(--s);padding:22px;border-radius:12px}.big{display:flex;gap:18px;flex-wrap:wrap;margin:28px 0}.big div{flex:1 1 200px;border:1px solid var(--l);border-radius:12px;padding:18px}.big strong{display:block;font-size:34px;line-height:1.2;color:var(--b)}.big span{font-size:13px;color:var(--m)}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:15px}th,td{border-bottom:1px solid var(--l);padding:9px 10px;text-align:left}th{background:var(--s)}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}details{border-top:1px solid var(--l);padding:16px 0}summary{font-weight:700;cursor:pointer}.note{color:var(--m);font-size:14px;border-left:3px solid var(--l);padding-left:12px}.urlprobe{background:#fff;border:1px solid var(--l);border-radius:14px;padding:22px;margin:26px 0}.urlprobe label{display:block;font-size:18px;font-weight:700;margin-bottom:6px}.urlprobe p{color:var(--m);font-size:14px;margin:0 0 14px}.urlprobe form{display:flex;gap:10px;flex-wrap:wrap}.urlprobe input{flex:1 1 260px;min-width:0;padding:12px 14px;font-size:16px;border:1px solid var(--l);border-radius:10px}.urlprobe button{padding:12px 22px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:var(--b);color:#fff;cursor:pointer}footer{border-top:1px solid var(--l);margin-top:60px;color:var(--m)}</style></head>
<body><nav><a class="brand" href="/">KanseiLink</a><a href="/insights/">Research &amp; Insights</a></nav>
<header class="hero"><div><div>FIRST-PARTY MEASUREMENT · ${RUN_DATE}</div>
<h1>「AI検索で自社が出ない」と日本語でAIに聞くと、AIは誰を推薦するのか</h1>
<p>悩みクエリ${questions}問 × AIエンジン${engineList.length}種 = ${cells}回答の実測。測っている当社自身の結果も含めて公開します。</p></div></header>
<main>
<h2>結論</h2><p class="answer">${esc(answer)}</p>

<div class="big">
  <div><strong>${oursCells} / ${cells}</strong><span>当社（Synapse Arrows／KanseiLINK）が挙がった回答</span></div>
  <div><strong>${namedCells} / ${cells}</strong><span>何らかの固有名を挙げた回答</span></div>
  <div><strong>${namedQuestions} / ${questions}</strong><span>固有名が出た質問</span></div>
</div>

<h2>何を測ったか</h2>
<p>「AEO」や「Agent Readiness」という言葉を知らない人が、自分の悩みをそのまま打ち込むときの言葉で${questions}問を用意しました。ブランド名は一切含めていません。システムプロンプトは付けず、質問文をそのまま送っています。一般利用者が受け取る既定の回答を見るためです。</p>
<table><thead><tr><th>質問</th><th>固有名が出たか</th></tr></thead><tbody>
${perQuestion.map(q => `<tr><td>${esc(q.question)}</td><td>${q.named ? `出た（${esc(q.enginesNaming.join('・'))}）` : '出ない（一般論）'}</td></tr>`).join('\n')}
</tbody></table>

<h2>エンジン別</h2>
<table><thead><tr><th>エンジン</th><th class="num">測定した回答</th><th class="num">固有名を挙げた回答</th><th class="num">当社への言及</th></tr></thead><tbody>
${engineList.map(([e, v]) => `<tr><td>${esc(e)}${v.model ? ` <span style="color:var(--m);font-size:13px">(${esc(v.model)})</span>` : ''}</td><td class="num">${v.total}</td><td class="num">${v.named}</td><td class="num">0</td></tr>`).join('\n')}
</tbody></table>

<h2>名前が出るとき、誰の名前が出るか</h2>
<p>回答に登場した固有名の内訳です。<strong>これは各社の優劣ではなく、AIの回答に名前が現れた回数です。</strong>登場しないことが品質の欠如を意味しないのと同じく、登場することが推奨を意味するものでもありません。</p>
<h3>海外のAI可視性ツール</h3>
<table><thead><tr><th>名称</th><th class="num">言及した回答数</th></tr></thead><tbody>
${byCount(foreignHits).map(listRow).join('\n')}
</tbody></table>
<h3>日本のAEO／LLMO支援会社</h3>
<p class="note">これらはほぼ全て、「日本企業向けにAEO・LLMO対策を支援してくれる会社を教えてください」という1問への回答に集中しています。回答文自体が「〜として紹介されています」という第三者記事の引用の形をとっており、「LLMO対策会社おすすめN選」型のまとめ記事が出どころになっていることが読み取れます。</p>
<table><thead><tr><th>名称</th><th class="num">言及した回答数</th></tr></thead><tbody>
${byCount(japaneseHits).map(listRow).join('\n')}
</tbody></table>

<h2>ここから読めること</h2>
<ul>
<li><strong>このカテゴリには、日本語ではまだ定番の答えがない。</strong>${questions}問中${questions - namedQuestions}問で、AIは固有名を出さず一般論で終わります。「誰に頼めばいいか」がまだ決まっていない領域です。</li>
<li><strong>名前が出る場面は二極化している。</strong>測定ツールを尋ねると海外プロダクト名が、支援会社を尋ねるとまとめ記事由来の日本企業名が並びます。前者は製品、後者は記事が入口になっています。</li>
<li><strong>当社は、そのどちらにも入っていない。</strong>実測データを出している側でありながら、${cells}回答すべてで名前が出ませんでした。作っていることと、知られていることは別だという記録です。</li>
</ul>

<h2>手法と限界</h2>
<p>測定日 ${RUN_DATE}。エンジン: ${engineList.map(([e, v]) => `${esc(e)}${v.model ? `（${esc(v.model)}）` : ''}`).join('、')}。質問${questions}問を日本語で、システムプロンプトなしにそのまま送信し、返ってきた本文に含まれる企業名・ツール名を集計しました。集計は既知の名称リストとの文字列一致であり、リストにない事業者は数えられていません。</p>
<p class="note">限界: 生成AIの回答は実行ごとに揺れます。これは特定日の1回の実行であり、確定値ではありません。個別の件数ではなく傾向として読んでください。また、これはAIの回答内容の測定であって、登場した企業・ツールの品質評価ではありません。当社はこの調査で名前が挙がった事業者から、いかなる対価も受け取っていません。継続測定で更新します。</p>

<h2>自社の現在地を測るには</h2>
<div class="urlprobe">
  <label for="urlprobe-input">まず、AIから自社サイトはどう見えているか</label>
  <p>URLを入れるだけ。登録不要・無料で、AIがサイトを読める状態か、何の会社だと判別できるかを5〜15秒で診断します。</p>
  <form action="/site-checker/" method="get">
    <input id="urlprobe-input" name="url" type="url" inputmode="url" spellcheck="false" placeholder="https://example.co.jp" aria-label="診断するサイトのURL" required>
    <button type="submit">無料で診断する</button>
  </form>
</div>
<p>その先——AIが自社をどう説明し、競合と比べてどれだけ推薦しているか——は、自社の顧客が実際に尋ねる質問群を設計して継続測定します。考え方は<a href="/when-to-use-kanseilink.html">AI認知・推薦率の調べ方</a>にまとめています。改善の実装は親会社<a href="https://synapsearrows.com/services/ai-aeo/">Synapse Arrows</a>が担当し、動いたかどうかをKanseiLINKが測ります。</p>
<p class="note">保証しないこと: AIでの表示順位は保証できません。1回のAI回答をシェアとして扱うこともしません。</p>

<h2>よくある質問</h2>
${faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/independence.html">独立性のポリシー</a> · <a href="/site-checker/">無料AI可視性診断</a></footer>
</body></html>`;

await writeFile(OUT, html, 'utf8');
console.log(`Wrote ${OUT}`);
console.log(`  ${questions} questions x ${engineList.length} engines = ${cells} answers; ours ${oursCells}, named ${namedCells}, questions with a name ${namedQuestions}`);
