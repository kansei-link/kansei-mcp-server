#!/usr/bin/env node
/**
 * 「公式MCPを出しても、見つけてもらえない」— 需要側の空白3問に答える一次調査。
 *
 * v2の需要側監査で、この3問は固有名がひとつも出なかった＝定番の答えが無い:
 *   e02 エージェントが自社SaaSに接続しようとして失敗する原因は？
 *   e03 自社SaaSをエージェントから使いやすくするには何を直す？
 *   e04 公式MCPサーバーを出すべき？出すとどんな効果がある？
 *
 * その空白に、我々だけが持っている実測で答える——**自社の失敗を含めて**。
 * 数字は verdicts 台帳から数え直すので、本文と実測がずれない。
 *
 *   node scripts/generate-mcp-discoverability-report.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SLUG = 'mcp-discoverability-gap-2026-09';
const CANONICAL = `https://kansei-link.com/insights/${SLUG}.html`;
const DATE = '2026-09-07';

const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const led = JSON.parse(await readFile(resolve(root, 'data/runtime-freshness/verdicts.json'), 'utf8')).verdicts;
const V = Object.entries(led);
const total = V.length;
const hiddenMcp = V.filter(([, v]) => v.verdict === 'seed_wrong' && String(v.correction?.mcp_status).includes('official'));
const withdrawn = V.filter(([, v]) => v.verdict === 'seed_wrong' && v.correction?.mcp_status === 'none');
const unknown = V.filter(([, v]) => v.verdict === 'unknown');
// 23件は均質ではない。接続方法まで確定したものと、存在は確認できたが
// 接続先が公開されていないものが混ざる。1つの数字にまとめない
const withEndpoint = hiddenMcp.filter(([, v]) => v.correction?.mcp_endpoint);
const existsOnly = hiddenMcp.filter(([, v]) => !v.correction?.mcp_endpoint);
// 根拠の実態。分類名は実データどおりにする——「一次資料」と呼べるものばかりではなく
// （PR TIMESや業界メディアを含む）、根拠URLが無いものも「未調査」とは限らない
const withExternalUrl = V.filter(([, v]) => String(v.evidence_url ?? '').startsWith('http'));
const internalRef = V.filter(([, v]) => v.evidence_url && !String(v.evidence_url).startsWith('http'));
const noSourceUrl = V.filter(([, v]) => !v.evidence_url);
// そのうち「一次資料をまだ見ていない」と明記したもの
const uninvestigated = noSourceUrl.filter(([, v]) => /未確認|当たっていない/.test(v.finding ?? ''));

// 事業者自身のドメイン／公式GitHub組織が根拠になっているものだけ実名で出す。
// 根拠が業界メディアのもの・限定提供のものは載せない（HANDOFF-VerifiedNames 参照）
const NAMEABLE = [
  ['AgileWorks（エイトレッド）', 'https://www.atled.jp/news/20260727_01/'],
  ['Square', 'https://developer.squareup.com/docs/mcp'],
  ['カラーミーショップ', 'https://github.com/pepabo/colormeshop-mcp'],
  ['OneLogin', 'https://github.com/onelogin/onelogin-mcp'],
  ['kickflow', 'https://tech.kickflow.co.jp/entry/2025/05/13/110046'],
  ['fincode byGMO', 'https://github.com/fincode-byGMO/fincode-mcp'],
  ['GMOトラスト・ログイン', 'https://blog.trustlogin.com/2026/mcp'],
  ['Jooto', 'https://www.jooto.com/news/20260529_mcp-cli/'],
];

const STYLE = `<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--i);line-height:1.9}nav,main,footer{max-width:840px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:56px 28px}.hero>div{max-width:840px;margin:auto}.hero .eyebrow{font-size:12px;letter-spacing:.08em;opacity:.85}.hero h1{font-size:clamp(26px,4.4vw,40px);line-height:1.3;margin:.3em 0}.hero p{font-size:17px;opacity:.92;margin:0}h2{margin-top:48px;font-size:24px;border-left:5px solid var(--b);padding-left:14px}h3{margin-top:32px;font-size:19px}.lead{font-size:19px;background:var(--s);padding:22px;border-radius:12px}.stat{display:flex;gap:16px;flex-wrap:wrap;margin:26px 0}.stat div{flex:1 1 180px;border:1px solid var(--l);border-radius:12px;padding:16px}.stat strong{display:block;font-size:32px;line-height:1.2;color:var(--b)}.stat span{font-size:13px;color:var(--m)}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:15px}th,td{border-bottom:1px solid var(--l);padding:10px;text-align:left;vertical-align:top}th{background:var(--s)}ul,ol{padding-left:1.3em}li{margin:.5em 0}.note{color:var(--m);font-size:13px;border-left:3px solid var(--l);padding-left:12px;line-height:1.9}.cite{background:var(--s);border:1px dashed var(--b);border-radius:12px;padding:20px;margin:30px 0}.cite .c-h{font-weight:700;margin-bottom:8px;font-size:15px}.cite blockquote{margin:0;font-size:15px}.probe{background:#fff;border:2px solid var(--b);border-radius:14px;padding:24px;margin:34px 0}.probe .p-title{font-size:20px;font-weight:700;margin-bottom:6px}.probe p{color:var(--m);font-size:14px;margin:0 0 16px}.probe form{display:flex;gap:10px;flex-wrap:wrap}.probe input{flex:1 1 260px;min-width:0;padding:13px 15px;font-size:16px;border:1px solid var(--l);border-radius:10px}.probe button{padding:13px 24px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:var(--b);color:#fff;cursor:pointer;font-family:inherit}details{border-top:1px solid var(--l);padding:14px 0}summary{font-weight:700;cursor:pointer}footer{border-top:1px solid var(--l);margin-top:54px;color:var(--m);font-size:14px}</style>`;

const FAQ = [
  { q: '公式MCPサーバーを出す意味はありますか？',
    a: `あります。ただし「出せば見つかる」ではありません。事業者自身が提供を告知している${NAMEABLE.length}件が、SaaS統合の専門データベース（当社）の配布データに反映されていませんでした。出したあとに、第三者のデータベースやAIの回答に載っているかを確認する工程が要ります。` },
  { q: '公式MCPレジストリに登録すれば十分ですか？',
    a: '当社の経験では不十分でした。実名で挙げた3件（Square・AgileWorks・kickflow）は公式レジストリの検索で見つからず、いずれも事業者自身のサイトやGitHubで告知されていました。レジストリを起点にした収集では、そうした提供に届きません。ただしこれは「登録されていない」の証明ではなく、検索で見つからなかったという測定結果です。' },
  { q: 'エージェントが接続に失敗する原因で多いものは？',
    a: `参照しているデータが間違っている場合があります。当社の配布データにも、公開APIの裏づけが取れないまま「APIあり・認証方式は○○」と記載されていた例が${withdrawn.length}件ありました。エージェントは、裏づけの取れない認証方式を試すことになります。` },
  { q: '自社の状態を確認するには？',
    a: 'まず自社サイトが機械から読めるかを無料で確認できます（登録不要・5〜15秒）。そのうえで、公式MCPを出しているなら、それが第三者のデータベースやAIの回答に正しく載っているかを確認してください。' },
];

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>公式MCPを出しても見つけてもらえない — 告知されていた${NAMEABLE.length}件を当社は反映できていなかった | KanseiLINK</title>
<meta name="description" content="事業者自身が提供を告知している公式MCPサーバー${NAMEABLE.length}件を、SaaS統合の専門データベースが反映できていなかった。MCP記載の訂正は計${hiddenMcp.length}件。事業者が何を確認すべきかを実測から示します。">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${CANONICAL}">
<meta property="og:type" content="article"><meta property="og:title" content="公式MCPを出しても見つけてもらえない"><meta property="og:url" content="${CANONICAL}">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Article', '@id': `${CANONICAL}#article`,
      headline: `公式MCPを出しても見つけてもらえない — 告知されていた${NAMEABLE.length}件を当社は反映できていなかった`,
      datePublished: DATE, dateModified: DATE, inLanguage: 'ja',
      author: { '@id': 'https://kansei-link.com/#organization' },
      publisher: { '@id': 'https://kansei-link.com/#organization' }, mainEntityOfPage: CANONICAL },
    { '@type': 'FAQPage', mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@type': 'Organization', '@id': 'https://kansei-link.com/#organization', name: 'KanseiLINK',
      url: 'https://kansei-link.com/', parentOrganization: { '@type': 'Organization', name: 'Synapse Arrows Pte. Ltd.', url: 'https://synapsearrows.com' } }
  ]
})}</script>
${STYLE}</head>
<body><nav><a class="brand" href="/">KanseiLINK</a><a href="/insights/">Research &amp; Insights</a></nav>
<header class="hero"><div><div class="eyebrow">一次調査 · 判定${total}件 · ${DATE}</div>
<h1>公式MCPを出しても、見つけてもらえない</h1>
<p>事業者自身が公式MCPの提供を告知している${NAMEABLE.length}件を、当社の配布データは正しく反映できていませんでした。</p></div></header>
<main>
<p class="lead">事業者が自社サイトやGitHubで<strong>公式MCPサーバーの提供を告知している${NAMEABLE.length}件</strong>について、SaaS統合の専門データベースがその提供を反映できていませんでした。そのデータベースは当社のものです。<strong>「出せば見つかる」が成り立たない</strong>ことを、自分の失敗として確認した記録です。</p>

<div class="stat">
  <div><strong>${NAMEABLE.length}</strong><span>提供が告知されていたのに、配布データに反映できていなかった<br>（訂正前は「API のみ」3件・「不明」5件）</span></div>
  <div><strong>${hiddenMcp.length}</strong><span>MCPの記載を訂正した総数<br>（導入方法まで記録できたもの ${withEndpoint.length}）</span></div>
  <div><strong>${withdrawn.length}</strong><span>裏づけの取れないAPI記載を取り下げた</span></div>
  <div><strong>${unknown.length}</strong><span>提供の有無を確認できなかった</span></div>
</div>

<h2>何が起きていたか</h2>
<p>当社はSaaSの接続情報（公式MCPの有無・認証方式・APIの所在）をAIエージェント向けに配布しています。その配布データを公開情報と突き合わせ、MCPに関する記載を${hiddenMcp.length}件訂正しました。</p>
<p>そのうち<strong>事業者自身の告知で提供が裏づけられた${NAMEABLE.length}件</strong>を挙げます。根拠はすべて<strong>事業者自身のドメイン、または公式GitHub組織</strong>です。訂正前の当社の記載は「APIのみ」が3件、「不明」が5件でした。<strong>「提供なし」と書いていたわけではありませんが、提供されている事実を反映できていなかった</strong>点は同じです。</p>
<table><thead><tr><th>サービス</th><th>提供元自身の一次資料</th></tr></thead><tbody>
${NAMEABLE.map(([name, url]) => `<tr><td>${esc(name)}</td><td><a href="${esc(url)}" rel="noopener" target="_blank">${esc(url.replace(/^https?:\/\//, ''))}</a></td></tr>`).join('')}
</tbody></table>
<p class="note"><strong>${hiddenMcp.length}件は均質ではありません。</strong>訂正前の記載は「提供なし」だけでなく、不明・第三者提供・接続情報の欠落など様々です。導入方法まで記録できたのは${withEndpoint.length}件で、残り${existsOnly.length}件は<strong>提供は確認できたが、当社が導入方法を確認できていない</strong>ものです（限定提供のBeta、接続先が公開資料に見当たらないもの、根拠が業界メディアのものを含む）。実名で挙げているのは、根拠が事業者自身の発表にある${NAMEABLE.length}件だけです。</p>

<h2>原因は「登録先」ではありませんでした</h2>

<h3>① 公式レジストリの検索では見つからなかった</h3>
<p>上の表で挙げた${NAMEABLE.length}件のうち3件（Square・AgileWorks・kickflow）について、公式MCPレジストリを検索しました。<strong>いずれも検索結果は0件</strong>でした。3件とも、事業者自身のサイトやGitHubでは提供を告知しています。</p>
<p class="note">これは<strong>「レジストリに登録されていない」の証明ではありません</strong>。検索で見つからなかった、という測定結果です。名称の付け方や検索条件によって拾えていない可能性は残ります。</p>
<p>いずれにせよ、<strong>当社がレジストリだけを見ていたために、この3件を拾えなかった</strong>ことは事実です。一次提供者が自社ドキュメントやGitHubで配っている場合、レジストリを起点にした収集では届きません。</p>

<h3>② 見つけても、既存のサービス情報と結びつかない</h3>
<p>レジストリの登録名から機械的に作った識別子は、こちらが持っているサービスの識別子と一致しません。仮にレジストリで見つかるようになっても、別のレコードが増えるだけで、元のサービスの行は「接続方法なし」のままでした。</p>
<p>ドメインで突き合わせる方法も試しましたが、<strong>それだけでは足りませんでした</strong>。カラーミーショップは、サービスのURLが <code>shop-pro.jp</code>、MCPのエンドポイントが <code>colorme.app</code> で別ドメインです。GitHub組織の <code>pepabo</code> がGMOペパボだと<strong>人が認識して初めて</strong>繋がりました。</p>

<h3>③ 「公式かどうか」を通信方式で判定していた</h3>
<p>HTTP/SSEでホストされていれば公式、という推論が入っていました。<strong>誰が公開したかを見ていません</strong>。この判定では、個人が作ったラッパーがベンダー自身のサーバーと同じ扱いになります。</p>

<h2>事業者が確認すべきこと（実測から）</h2>
<ol>
<li><strong>出しただけで終わりにしない。</strong> 公式MCPを提供しているなら、第三者のデータベースやAIの回答に、それが載っているかを確認する</li>
<li><strong>自社ドメイン上のページから、そのサーバーを指す。</strong> 保有を裏づけられるのは、そのドメインを支配している人だけが置ける記述です。当社が実名で載せられた${NAMEABLE.length}件は、すべてこれが根拠でした</li>
<li><strong>接続方法と在り処を分けて書く。</strong> リポジトリURLは「在り処」であって接続方法ではありません。起動コマンドやリモートMCPのURLを別に明示してください</li>
<li><strong>兄弟製品と混ざっていないか見る。</strong> 同じドメインの別製品のAPIが、自社製品の情報として流通していることがあります（当社も取り違えていました）</li>
</ol>

<h2>正直に書いておくこと</h2>
<p>この記事の${hiddenMcp.length}件は、<strong>当社の配布データの誤り</strong>です。他社の不備を数えたものではありません。SaaS統合の情報を専門に扱っている当社が取りこぼしていた、という事実がそのまま「出せば見つかるわけではない」の証拠になっています。</p>
<p>数字の性格も書いておきます。${hiddenMcp.length}件は<strong>MCPの記載を訂正した総数</strong>で、訂正前の値は様々です。「提供されている事実を反映できていなかった」と言い切れるのは、<strong>事業者自身の告知で裏づけた${NAMEABLE.length}件</strong>です。見出しの数字にこの${NAMEABLE.length}件を使っているのはそのためです。</p>
<p>また、${unknown.length}件は<strong>「提供が確認できなかった」</strong>と記録しています。<strong>「MCPが無い」とは書いていません。</strong> 不在は証明できないためで、この区別は当社の記載方針として決めています。</p>

<div class="cite"><div class="c-h">引用される場合（この文のままお使いください）</div>
<blockquote>KanseiLINKは2026年9月、自社が配布するSaaS接続データを公開情報と突き合わせ、<strong>事業者自身が提供を告知している公式MCPサーバー${NAMEABLE.length}件を、配布データに反映できていなかった</strong>ことを確認した。MCPに関する記載の訂正は計${hiddenMcp.length}件。当社がレジストリを起点に収集していたことが要因のひとつで、実名で挙げた3件は公式レジストリの検索では見つからなかった（KanseiLINK・判定${total}件・${DATE}実測）。出典: ${CANONICAL}</blockquote></div>

<div class="probe"><div class="p-title">自社サイトがAIから読めるか、無料で確認する</div>
<p>URLを入れるだけ。登録不要・5〜15秒。</p>
<form action="/site-checker/" method="get">
<input name="url" type="url" inputmode="url" spellcheck="false" required placeholder="https://example.com" aria-label="診断するURL">
<button type="submit">無料で診断する</button></form></div>

<h2>よくある質問</h2>
${FAQ.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}

<h2>調査方法</h2>
<p class="note">当社が配布するサービスデータ（npmパッケージ同梱）を公開情報と突き合わせ、${total}件について判定した。<strong>内訳は、外部URLを根拠に持つもの${withExternalUrl.length}件（事業者自身の発表のほか、プレスリリース配信や業界メディアを含む）、社内の作業記録を参照しているもの${internalRef.length}件、根拠URLを記録していないもの${noSourceUrl.length}件。</strong>実名を挙げているのは、根拠が事業者自身のドメインまたは公式GitHub組織にある${NAMEABLE.length}件だけ。レジストリの検索は2026年9月に実施。<strong>本記事は当社の接続情報の正確性についてのものであり、各社の品質評価ではない。格付け（ARI Award）とは別の調査。</strong></p>
<p class="note">確認できなかった${unknown.length}件については「提供が無い」とは記載しない。公開情報に記載が見当たらないことは、不在の証明にならないため。このうち${uninvestigated.length}件は<strong>一次資料をまだ調べていない</strong>ものと明記しており、調べれば提供が見つかる可能性がある。残りは調査したが確認できなかったもの。</p>
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/site-checker/">無料AI可視性診断</a></footer>
</body></html>`;

// 既定はステージング。public/ に置くと push で即公開されるので、
// 審査を通す前に事故が起きないようにする
const PUBLISH = process.argv.includes('--publish');
const outRel = PUBLISH ? `public/insights/${SLUG}.html` : `build/insights/${SLUG}.html`;
await mkdir(resolve(root, PUBLISH ? 'public/insights' : 'build/insights'), { recursive: true });
await writeFile(resolve(root, outRel), html, 'utf8');
console.log(`Wrote ${outRel}${PUBLISH ? '  ⚠️ 次のpushで公開される' : '（ステージング・非公開）'}`);
console.log(`  取りこぼし ${hiddenMcp.length} ／ 取り下げ ${withdrawn.length} ／ 確認できず ${unknown.length} ／ 判定総数 ${total}`);
console.log(`  実名で掲載: ${NAMEABLE.length}件`);
