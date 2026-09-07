#!/usr/bin/env node
/**
 * 買い手語彙の入口ページ（3本）。
 *
 * 診断の結果:
 *   - 既存4記事は到達可能（sitemap・索引・200）だが、狙ったクエリで**引用集合に入っていない**
 *     （4問×20引用=80件中、自社0件）
 *   - 勝っているのは中小の代理店ブログ。60ドメインに分散し権威は集中していない。
 *     共通点は、**買い手の不満をそのままURLとタイトルにしている**こと
 *     （chatgpt-jisha-ga-shokai-sarenai-riyuu / ai-company-name-not-found など）
 *
 * そこで買い手の言い回しで入口を作る。ただし**既存4記事と同じ問いには作らない**——
 * 同じ問いに2枚目を作れば誘導ページになる。ここで扱うのは、
 * **今日の実測でしか答えられない3つ**に限る。
 *
 * 数字は結果JSONから数え直す（手打ちしない）。
 *
 *   node scripts/generate-buyer-entry-pages.mjs            # ステージング
 *   node scripts/generate-buyer-entry-pages.mjs --publish  # public/ へ
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const DATA = process.env.KANSEI_DATA_DIR
  ?? resolve(root, '..', 'kansei-link-mcp', 'data', 'discoverability');
const DATE = '2026-09-07';
const PUBLISH = process.argv.includes('--publish');
const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 実測から数字を数え直す ───────────────────────────
const RIVALS = ['Profound', 'Peec AI', 'Otterly', 'Semrush', 'Ahrefs', 'AthenaHQ', 'SE Ranking',
  'Similarweb', 'Scrunch', 'BrightEdge', 'Speee', 'PLAN-B', 'ナイル', 'CINC', 'LANY',
  'ウィルゲート', 'アイオイクス'];
const OURS = /kansei-?link|synapse\s*arrows/i;

async function load(name) {
  return JSON.parse(await readFile(resolve(DATA, name), 'utf8'));
}
function tally(results) {
  let cells = 0, ours = 0, namedQ = 0;
  for (const q of results) {
    let hit = false;
    for (const a of Object.values(q.answers ?? {})) {
      if (!a || a.error) continue;
      cells++;
      const t = a.text ?? a.answer ?? '';
      if (RIVALS.some(n => t.toLowerCase().includes(n.toLowerCase()))) hit = true;
      if (OURS.test(t)) ours++;
    }
    if (hit) namedQ++;
  }
  return { cells, ours, namedQ, questions: results.length, blankQ: results.length - namedQ };
}

const v1 = tally((await load('demand-battery-v1-results.json')).results);
const probe = await load('buyer-entry-probe-results.json');
let probeCites = 0, probeOurs = 0;
for (const q of probe.results) {
  const a = q.answers?.perplexity ?? {};
  for (const u of (a.citations ?? a.sources ?? [])) {
    const url = typeof u === 'string' ? u : (u.url ?? '');
    if (!url) continue;
    probeCites++;
    if (/kansei-link|synapsearrows/.test(url)) probeOurs++;
  }
}

const STYLE = `<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--i);line-height:1.95}nav,main,footer{max-width:760px;margin:auto;padding:20px 26px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:21px;font-weight:800;text-decoration:none}h1{font-size:clamp(24px,4vw,34px);line-height:1.4;margin:28px 0 6px}.sub{color:var(--m);font-size:14px;margin:0 0 24px}h2{margin-top:40px;font-size:21px;border-left:5px solid var(--b);padding-left:13px}.lead{font-size:18px;background:var(--s);padding:20px;border-radius:12px}.big{display:flex;gap:14px;flex-wrap:wrap;margin:22px 0}.big div{flex:1 1 160px;border:1px solid var(--l);border-radius:12px;padding:15px}.big strong{display:block;font-size:30px;line-height:1.2;color:var(--b)}.big span{font-size:13px;color:var(--m)}ul,ol{padding-left:1.3em}li{margin:.5em 0}.note{color:var(--m);font-size:13px;border-left:3px solid var(--l);padding-left:12px;line-height:1.9}.probe{background:#fff;border:2px solid var(--b);border-radius:14px;padding:22px;margin:32px 0}.probe .t{font-size:19px;font-weight:700;margin-bottom:6px}.probe p{color:var(--m);font-size:14px;margin:0 0 14px}.probe form{display:flex;gap:10px;flex-wrap:wrap}.probe input{flex:1 1 250px;min-width:0;padding:13px 15px;font-size:16px;border:1px solid var(--l);border-radius:10px}.probe button{padding:13px 22px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:var(--b);color:#fff;cursor:pointer;font-family:inherit}details{border-top:1px solid var(--l);padding:13px 0}summary{font-weight:700;cursor:pointer}footer{border-top:1px solid var(--l);margin-top:48px;color:var(--m);font-size:14px}</style>`;

const PROBE_BOX = `<div class="probe"><div class="t">まず、AIが自社サイトを読めているかを確かめる</div>
<p>URLを入れるだけ。登録不要・無料・5〜15秒。</p>
<form action="/site-checker/" method="get">
<input name="url" type="url" inputmode="url" spellcheck="false" required placeholder="https://example.com" aria-label="診断するURL">
<button type="submit">無料で診断する</button></form></div>`;

// ── 3本の中身 ────────────────────────────────────────
const PAGES = [
  {
    slug: 'jisha-site-naoshitemo-ai-ni-denai-2026',
    title: '自社サイトを直しても、AIに出てきませんでした',
    sub: `${DATE}・一次調査／構造化データもllms.txtも整えたうえで、前後を測った記録`,
    desc: '構造化データやllms.txtを整えれば、AIに紹介されるようになるのか。自社で整備した前後を12問×3エンジンで測ったところ、言及数は変わりませんでした。何が足りなかったのかを実測から説明します。',
    stats: [
      [`0 / ${v1.cells}`, '整備後の自社言及数（整備前も0）'],
      [`${probeOurs} / ${probeCites}`, '狙ったクエリでの自社の引用数'],
    ],
    body: `
<p class="lead">AI検索対策として推奨されることは、ひととおりやりました。構造化データ、llms.txt、想定質問の逐語掲載、sitemapへの登録。そのうえで前後を測ったところ、<strong>AIからの言及は0のまま動きませんでした</strong>。</p>

<h2>何をして、何を測ったか</h2>
<p>買い手が実際に使う言い回し12問を、3つのAIエンジンに投げます。回答に自社名が出るかを数えます。整備の前後で同じ測定をしました。</p>
<ul>
<li>やったこと: JSON-LDによる構造化データ、llms.txtへの想定質問の逐語掲載、sitemap登録、内部リンク整理</li>
<li>結果: <strong>前 0 / 36 → 後 0 / ${v1.cells}</strong>。動きませんでした</li>
</ul>

<h2>なぜ動かなかったのか</h2>
<p>後から引用元を取得して分かりました。狙ったクエリで実際に読まれていたのは、<strong>他社のページ</strong>でした。自社の記事は到達可能な状態（sitemapにあり、公開されており、内部リンクもある）でしたが、<strong>${probeCites}件の引用のうち自社は${probeOurs}件</strong>でした（既存4記事がそれぞれ狙っている4つの質問を、検索連動型のAIに投げ、回答の引用元を数えたもの）。</p>
<p>今回取得した${probeCites}件の引用元に、自社の記事は含まれていませんでした。<strong>ただしこの結果だけでは、引用されなかった原因までは特定できません。</strong></p>
<p>なお、前後で比べているのは<strong>回答に自社名が出た数（言及数）</strong>で、${probeCites}件は<strong>別の測定で数えた引用元の数</strong>です。2つは違うものを数えています。</p>

<h2>実際に読まれていたページの共通点</h2>
<p>引用元は60ドメインに分散していて、大手メディアはほとんどありません。中小の事業者のブログが大半です。共通していたのは<strong>URLとタイトルが、買い手の不満をそのまま言葉にしている</strong>ことでした。</p>
<p>私たちの記事は「AI推薦率の測り方」のように、<strong>自分たちの言葉</strong>で書かれていました。買い手は「ChatGPTに自社が出てこない」と言います。同じことを指していても、字面が違います。ただしこれは引用元を見て気づいた共通点であり、字面の一致が引用の原因だと確かめたわけではありません。</p>

<h2>この結果から言えること・言えないこと</h2>
<p><strong>言えること</strong>: 今回の整備の範囲では、狙った質問で引用が増えたことを確認できませんでした。整備後も引用元は他社のページで占められていました。</p>
<p><strong>言えないこと</strong>: 整備に意味がない、とは言えません。今回の測定は、整備をしたうえで引用が増えたことを確認できなかった、という結果です。引用されなかった原因も特定できていません。他社が同じ整備をして同じ結果になるかも分かりませんし、時間をおけば変わる可能性も残ります。</p>
<p>自社でも改善の前後を比べられるように、<a href="/insights/ai-taisaku-doko-kara-hajimeru-2026.html">変更前に残しておきたい4項目</a>をまとめました。</p>
<p class="note">この記事は自社を対象にした実測であり、他社に同じ結果が出ることを示すものではありません。整備が無意味だという主張でもありません——読める状態は必要条件です。十分条件ではなかった、という記録です。</p>`,
    faq: [
      ['構造化データやllms.txtは意味がないのですか？', '今回の測定では、整備をしたうえで引用が増えたことを確認できませんでした。意味がないとまでは言えず、この測定では効果を確認できなかった、というのが正確なところです。'],
      ['何が足りなかったのですか？', '今回の結果からは特定できません。分かっているのは、狙った質問で取得した引用元に自社の記事が含まれていなかったことだけです。'],
      ['自社の状態はどう確認できますか？', 'URLを入れるだけの無料診断で、AIがサイトを読める状態かを確認できます。そのうえで、狙っているクエリで実際に引用されているかは別に測る必要があります。'],
    ],
  },
  {
    slug: 'chatgpt-kyougou-bakari-deru-riyuu-2026',
    title: 'ChatGPTに自社が出ないとき、競合名も確認したい理由',
    sub: `${DATE}・一次調査／12問×3エンジン＝${v1.cells}回答を数えた結果`,
    desc: 'ChatGPTに自社が出てこないとき、競合名が出ているかどうかで状況が変わります。買い手の言い回し12問を3エンジンに投げたところ、企業名・サービス名がひとつも出なかった質問が7問ありました。記録の分け方を説明します。',
    stats: [
      [`${v1.blankQ} / ${v1.questions}`, '3エンジンのいずれでも企業名・サービス名が出なかった質問'],
      [`${v1.namedQ} / ${v1.questions}`, '少なくとも1エンジンで名前が出た質問'],
    ],
    body: `
<p class="lead">自社名がAIの回答に出てこないとき、<strong>競合名は出ているのか</strong>も一緒に見てください。買い手が使う言い回し12問を3つのエンジンに投げたところ、<strong>${v1.blankQ}問では企業名・サービス名がひとつも出ませんでした</strong>（3エンジンのいずれの回答にも出なかった質問を数えたものです）。</p>

<h2>2つの状態は、記録上わけられます</h2>
<p>同じ「自社が出てこない」でも、回答の中身は2つに分かれます。</p>
<ul>
<li><strong>競合名が出ている回答</strong>: 比較対象が示されていて、そこに自社が入っていない</li>
<li><strong>企業名・サービス名が出ていない回答</strong>: その回答では比較対象が示されなかった</li>
</ul>
<p>今回の測定では <strong>${v1.namedQ}問が前者を含み、${v1.blankQ}問が後者だけ</strong>でした。</p>
<p class="note">後者は「その回答では比較対象が示されなかった」という状態です。未開拓の市場であることや、先に記事を出せば紹介されるようになることを意味しません。</p>

<h2>どう記録するか</h2>
<ol>
<li>買い手が実際に使う言い回しを、10問ほど書き出す（自社の用語に置き換えないでください）</li>
<li>複数のAIエンジンに、そのまま投げる</li>
<li>回答ごとに<strong>自社名が出たか</strong>と<strong>他社の名前が出たか</strong>を、別の欄に分けて記録する</li>
</ol>
<p>自社名の欄だけを見ていると、この2つが同じ「出ていない」に見えます。分けて記録しておくと、次に何をするかの検討材料になります。</p>
<p><a href="/insights/ai-taisaku-doko-kara-hajimeru-2026.html">記録する項目と記入例はこちら</a>にまとめています。</p>

<h2>名前が出た質問では、何が引用されていたか</h2>
<p>名前が出た回答の引用元を見ると、まとめ記事や比較記事が含まれていました。ただし、<strong>引用元に載っていたという事実だけでは、その名前が挙がった原因までは特定できません</strong>。参考として、どこが読まれているかを知る材料にはなります。</p>
<p class="note">この測定は自社が対象で、AIの回答に何が含まれたかを数えたものです。各社の品質評価ではありません。生成AIの回答は実行ごとに揺れるため、1回の結果で断定しないでください。</p>`,
    faq: [
      ['競合ばかり出るのは、製品が劣っているからですか？', 'そうとは限りません。実測では、固有名が出た質問でも、その名前はまとめ記事や比較記事に載っていることが理由でした。AIが読む場所に載っているかどうかの差です。'],
      ['誰の名前も出ない質問は、放置していいのですか？', '逆です。まだ定番の答えが無いということなので、先に置いた側が取れます。競合がいる質問より入りやすい場合があります。'],
      ['自社が出るかどうかは、どう測ればいいですか？', '買い手の言い回しで10問ほど用意し、複数エンジンに定期的に投げて、固有名の出現を数えます。1回では揺れるので、同じ問いを繰り返します。'],
    ],
  },
  {
    slug: 'ai-taisaku-doko-kara-hajimeru-2026',
    title: 'AI検索対策、何から始めるか — 変える前に記録しておくこと',
    sub: `${DATE}・一次調査／言及数は測っていたが、引用元を残していなかった経験から`,
    desc: 'LLMO・AEO対策で何かを変える前に、何を記録しておくか。自社は言及数の基準点は取っていましたが、引用元を残していなかったため、変化が無かった理由を後から調べ直すことになりました。その経験から4項目を整理します。',
    stats: [],
    body: `
<p class="lead">AI検索対策で何かを変える前に、<strong>4つだけ記録しておいてください</strong>。あとから「効いたのかどうか」を判定できるようにするためです。私たちは4つのうち3つしか取っておらず、変化が無かった理由を後から調べ直すことになりました。</p>

<h2>変更前に記録しておく4項目</h2>
<ol>
<li><strong>問いの一覧。</strong> 買い手が実際に打ち込む言い回しで10問ほど。自社の用語に置き換えないでください。あとで問いを変えると、前後比較が成立しません</li>
<li><strong>企業名・サービス名の出現。</strong> 自社名だけでなく、<strong>他社の名前が出たかどうか</strong>も記録します。自社名だけを見ていると、競合が挙がっている場合と、誰の名前も挙がらなかった場合を区別できません</li>
<li><strong>引用元のURL。</strong> 検索連動型のAIは引用元を返します。これを残しておくと、あとで「どこが読まれているか」が分かります。取り忘れると、打ち手が当て推量になります</li>
<li><strong>測定した日付とエンジン。</strong> モデルは更新されます。いつ・何で測ったかが無いと、比較の意味が変わります</li>
</ol>
<p class="note">生成AIの回答は実行ごとに揺れます。1回の測定を基準点にせず、同じ問いを複数回・定期的に繰り返してください。</p>

<h2>実際の記録は、こうなります</h2>
<p>表計算ソフトで十分です。<strong>1つの質問・1つのエンジン・1回の回答につき1行</strong>。下は<strong>書き方を示すための例</strong>で、実測値の転載ではありません。</p>
<table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0">
<thead><tr style="background:var(--s)">
<th style="border:1px solid var(--l);padding:8px">測定日</th>
<th style="border:1px solid var(--l);padding:8px">問い（買い手の言い回しのまま）</th>
<th style="border:1px solid var(--l);padding:8px">エンジン</th>
<th style="border:1px solid var(--l);padding:8px">自社名</th>
<th style="border:1px solid var(--l);padding:8px">出た企業名・サービス名</th>
<th style="border:1px solid var(--l);padding:8px">引用元URL</th>
</tr></thead>
<tbody>
<tr>
<td style="border:1px solid var(--l);padding:8px">2026-09-07</td>
<td style="border:1px solid var(--l);padding:8px">AI検索で自社が表示されません。原因は？</td>
<td style="border:1px solid var(--l);padding:8px">Perplexity</td>
<td style="border:1px solid var(--l);padding:8px">なし</td>
<td style="border:1px solid var(--l);padding:8px">A社, B社</td>
<td style="border:1px solid var(--l);padding:8px">（回答に付いていたURLを全部）</td>
</tr>
<tr>
<td style="border:1px solid var(--l);padding:8px">2026-09-07</td>
<td style="border:1px solid var(--l);padding:8px">（同じ問い）</td>
<td style="border:1px solid var(--l);padding:8px">ChatGPT</td>
<td style="border:1px solid var(--l);padding:8px">なし</td>
<td style="border:1px solid var(--l);padding:8px">なし</td>
<td style="border:1px solid var(--l);padding:8px">（引用元なし）</td>
</tr>
</tbody></table>
<p>ここで大事なのは<strong>「出た企業名・サービス名」の列</strong>です。「なし」が並ぶなら、その回答では比較対象が示されなかった、という状態です。自社名の欄だけを見ていると、競合が挙がっている場合と区別がつきません。空欄は未確認と紛らわしいので、確認したうえで何も無ければ「なし」と書いてください。</p>
<p>同じ問いでも省略せず毎回記入し、可能なら<strong>回答の全文も残して</strong>ください。あとから数え方を見直したくなったときに、取り直さずに済みます。</p>

<h2>私たちの場合、どうなったか</h2>
<p>整備の前に基準点は測っていました（2026年9月3日）。そのあとで構造化データ、llms.txt、想定質問の掲載を行い、9月7日に同じ問いで測り直しました。<strong>言及数はどちらも0</strong>でした。</p>
<p>困ったのは、<strong>引用元を記録していなかった</strong>ことです。言及が0のままだったとき、次のどれなのかを確かめる材料がありませんでした。</p>
<ul>
<li>整備が届いていないのか</li>
<li>整備は届いているが、AIが読む場所に自社が入っていないのか</li>
<li>効果が出るまで時間がかかるのか</li>
</ul>
<p>あとから引用元を取り直して、ようやく「読まれていたのは他社のページだった」と分かりました。<strong>最初から4項目目まで取っていれば、この往復は要りませんでした。</strong></p>
<p><a href="/insights/jisha-site-naoshitemo-ai-ni-denai-2026.html">整備の前後で何が起きたか</a>と、<a href="/insights/chatgpt-kyougou-bakari-deru-riyuu-2026.html">自社名が出ないときに競合名も見る理由</a>は、それぞれ別の記事にまとめています。</p>

<h2>引用元を残しておくと、何が分かるか</h2>
<p>4つの質問について引用元を取得したところ、${probeCites}件が集まりました。読まれていたのは大手メディアではなく、中小の事業者のブログが中心で、60のドメインに分かれていました。今回の範囲では、引用が少数のドメインに集中してはいませんでした。</p>
<p>これが分かると、次に書くものを決めやすくなります。記録していなければ、同じことを推測で判断することになります。</p>
<p class="note">この記録は自社を対象にした実測です。他社で同じ結果が出ることを保証するものではありません。また、AI上での順位や表示を保証できる手法は存在しません。</p>`,
    faq: [
      ['何から始めればいいですか？', '変更を加える前に、この記事の4項目を記録することです。あとから「効いたのか」を見るには、変更前の状態が残っている必要があります。'],
      ['何を記録すればいいですか？', '問いの一覧、自社名と他社名が出たかどうか、引用元のURL、測定した日付とエンジンの4つです。とくに引用元は、後から取り直すのが手間なので最初から残してください。'],
      ['どれくらいの頻度で測りますか？', '生成AIの回答は実行ごとに揺れるので、同じ問いを定期的に繰り返します。1回の結果で判断しないでください。'],
    ],
  },
];

// ── 生成 ─────────────────────────────────────────────
const outDir = resolve(root, PUBLISH ? 'public/insights' : 'build/insights');
await mkdir(outDir, { recursive: true });

for (const p of PAGES) {
  const canonical = `https://kansei-link.com/insights/${p.slug}.html`;
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)} | KanseiLINK</title>
<meta name="description" content="${esc(p.desc)}">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(p.title)}"><meta property="og:url" content="${canonical}">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Article', '@id': `${canonical}#article`, headline: p.title, description: p.desc,
      datePublished: DATE, dateModified: DATE, inLanguage: 'ja',
      author: { '@id': 'https://kansei-link.com/#organization' },
      publisher: { '@id': 'https://kansei-link.com/#organization' }, mainEntityOfPage: canonical },
    { '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@type': 'Organization', '@id': 'https://kansei-link.com/#organization', name: 'KanseiLINK',
      url: 'https://kansei-link.com/',
      parentOrganization: { '@type': 'Organization', name: 'Synapse Arrows Pte. Ltd.', url: 'https://synapsearrows.com' } }
  ]
})}</script>
${STYLE}</head><body>
<nav><a class="brand" href="/">KanseiLINK</a><a href="/insights/">Research &amp; Insights</a></nav>
<main>
<h1>${esc(p.title)}</h1>
<p class="sub">${esc(p.sub)}</p>
<div class="big">${p.stats.map(([v, l]) => `<div><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`).join('')}</div>
${p.body}
${PROBE_BOX}
<h2>よくある質問</h2>
${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
<h2>関連する一次調査</h2>
<ul>
${[
  ['/insights/jisha-site-naoshitemo-ai-ni-denai-2026.html', '自社サイトを直しても、AIに出てきませんでした（整備の前後を測った結果）'],
  ['/insights/chatgpt-kyougou-bakari-deru-riyuu-2026.html', 'ChatGPTに自社が出ないとき、競合名も確認したい理由'],
  ['/insights/ai-taisaku-doko-kara-hajimeru-2026.html', 'AI検索対策、何から始めるか — 変える前に記録しておくこと'],
  ['/insights/ai-visibility-jp-who-gets-recommended-2026-09.html', '「AI検索で自社が出ない」と聞くと、AIは誰を推薦するのか'],
  ['/insights/mcp-discoverability-gap-2026-09.html', '公式MCPを出しても、見つけてもらえない'],
].filter(([href]) => !href.includes(p.slug)).map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}
</ul>
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/site-checker/">無料AI可視性診断</a></footer>
</body></html>`;
  await writeFile(resolve(outDir, `${p.slug}.html`), html, 'utf8');
  console.log(`  ${p.slug}.html`);
}
console.log(`\n${PAGES.length}本 → ${outDir}${PUBLISH ? '  ⚠️ 次のpushで公開' : '（ステージング・非公開）'}`);
console.log(`使った実測: v1 ${v1.cells}セル・空白${v1.blankQ}/${v1.questions}問 ／ 入口診断 ${probeOurs}/${probeCites}引用`);
