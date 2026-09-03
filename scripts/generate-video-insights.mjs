import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'content/video-insights.json');
const outputPath = resolve(root, 'public/insights/videos/index.html');
const articlesDir = resolve(root, 'content/video-articles');
const data = JSON.parse(await readFile(manifestPath, 'utf8'));

const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const youtubeUrl = item => item.kind === 'short'
  ? `https://www.youtube.com/shorts/${item.id}`
  : `https://www.youtube.com/watch?v=${item.id}`;
const thumb = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const embedUrl = id => `https://www.youtube.com/embed/${id}`;
const channelUrl = data.channel.url;
const channelSameAs = [data.channel.url, data.channel.handleUrl].filter(Boolean);
// PT11M6S -> 11:06 (表示用)。従来の naive replace は "11:7" / "20:" を生んでいた
const humanDuration = iso => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 'Video';
  const [h, mi, se] = [m[1], m[2], m[3]].map(v => Number(v || 0));
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(mi)}:${pad(se)}` : `${mi}:${pad(se)}`;
};

const ids = new Set();
for (const item of data.videos) {
  if (!/^[\w-]{11}$/.test(item.id)) throw new Error(`Invalid YouTube id: ${item.id}`);
  if (ids.has(item.id)) throw new Error(`Duplicate YouTube id: ${item.id}`);
  if (data.excludedVideoIds.includes(item.id)) throw new Error(`Excluded video leaked into manifest: ${item.id}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.uploadDate || '')) throw new Error(`Missing uploadDate: ${item.id}`);
  if (!/^PT(\d+H)?(\d+M)?(\d+S)?$/.test(item.duration || '')) throw new Error(`Missing duration: ${item.id}`);
  ids.add(item.id);
}
for (const item of data.videos.filter(item => item.parentId)) {
  if (!ids.has(item.parentId)) throw new Error(`Missing parent ${item.parentId} for ${item.id}`);
}

const byId = new Map(data.videos.map(item => [item.id, item]));
// Shorts は親の長尺動画の解説記事を継承する（記事なしの行き止まりを作らない）
const articleFor = item => item.articleUrl || (item.parentId ? byId.get(item.parentId)?.articleUrl : null) || null;
const longVideos = data.videos.filter(item => item.kind === 'video');
const shorts = data.videos.filter(item => item.kind === 'short');
const videoObject = item => ({
  '@type': 'VideoObject',
  '@id': `https://kansei-link.com/insights/videos/#${item.id}`,
  name: item.title,
  description: item.summary || item.title,
  thumbnailUrl: thumb(item.id),
  uploadDate: item.uploadDate,
  duration: item.duration,
  contentUrl: youtubeUrl(item),
  embedUrl: embedUrl(item.id),
  inLanguage: 'ja',
  isFamilyFriendly: true,
  genre: item.category,
  publisher: { '@id': 'https://kansei-link.com/#organization' },
  creator: { '@id': `${channelUrl}#channel` },
  isPartOf: { '@id': 'https://kansei-link.com/insights/videos/#page' },
  ...(articleFor(item) ? { subjectOf: { '@type': 'Article', '@id': `https://kansei-link.com${articleFor(item)}#article` } } : {}),
  ...(item.parentId ? { isBasedOn: { '@id': `https://kansei-link.com/insights/videos/#${item.parentId}` } } : {}),
  ...(item.shortId ? { hasPart: { '@id': `https://kansei-link.com/insights/videos/#${item.shortId}` } } : {})
});
const listItems = data.videos.map((item, index) => ({
  '@type': 'ListItem',
  position: index + 1,
  url: youtubeUrl(item),
  item: videoObject(item)
}));
const cards = items => items.map(item => `
  <article class="card">
    <a class="thumb" href="${esc(articleFor(item) || youtubeUrl(item))}">
      <img src="${thumb(item.id)}" alt="${esc(item.title)}" width="480" height="360" loading="lazy">
      <span>${item.kind === 'short' ? 'Short' : esc(humanDuration(item.duration))}</span>
    </a>
    <div class="body"><div class="category">${esc(item.category)}</div><h2><a href="${esc(articleFor(item) || youtubeUrl(item))}">${esc(item.title)}</a></h2>
    ${item.summary ? `<p>${esc(item.summary)}</p>` : ''}
    <div class="actions"><a href="${youtubeUrl(item)}">YouTube</a>${articleFor(item) ? `<a href="${esc(articleFor(item))}">解説記事</a>` : ''}</div></div>
  </article>`).join('');

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {'@type':'CollectionPage','@id':'https://kansei-link.com/insights/videos/#page',name:'SYNAPSE 動画ライブラリ',url:'https://kansei-link.com/insights/videos/',inLanguage:'ja',dateModified:data.updated,publisher:{'@id':'https://kansei-link.com/#organization'},mainEntity:{'@type':'ItemList',numberOfItems:data.videos.length,itemListElement:listItems}},
    {'@type':'Organization','@id':'https://kansei-link.com/#organization',name:'KanseiLink',alternateName:['KanseiLINK','カンセイリンク'],url:'https://kansei-link.com/',parentOrganization:{'@id':'https://synapsearrows.com/#organization'},sameAs:channelSameAs},
    {'@type':'Organization','@id':'https://synapsearrows.com/#organization',name:'Synapse Arrows Pte. Ltd.',url:'https://synapsearrows.com',sameAs:['https://www.wikidata.org/wiki/Q140399505']},
    {'@type':['Organization','Brand'],'@id':`${channelUrl}#channel`,name:data.channel.name,url:channelUrl,sameAs:channelSameAs,parentOrganization:{'@id':'https://synapsearrows.com/#organization'}}
  ]
};

const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SYNAPSE 動画ライブラリ｜AIと経営・名著・公式レポート | KanseiLink</title>
<meta name="description" content="Synapse ArrowsとKanseiLinkによるAI・経営動画を一覧化。名著解説、AIサービス、公式レポート、AI経営会議を長尺動画とShortsで視聴できます。">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="https://kansei-link.com/insights/videos/">
<meta property="og:type" content="website"><meta property="og:title" content="SYNAPSE 動画ライブラリ"><meta property="og:url" content="https://kansei-link.com/insights/videos/">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>:root{--blue:#1a3fd6;--ink:#101828;--muted:#667085;--line:#e4e7ec;--soft:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--ink);line-height:1.7}nav,main,footer{max-width:1180px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--line)}nav a,a{color:var(--blue)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:64px 28px}.hero>div{max-width:1180px;margin:auto}.hero h1{font-size:clamp(32px,5vw,54px);margin:.2em 0}.hero p{font-size:19px;max-width:760px}.stats{display:flex;gap:14px;flex-wrap:wrap;margin-top:20px}.stats span{background:#ffffff20;border:1px solid #ffffff38;border-radius:999px;padding:6px 14px}.section-title{font-size:30px;margin-top:48px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:22px}.card{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}.thumb{display:block;position:relative;aspect-ratio:16/9;background:#111}.thumb img{width:100%;height:100%;object-fit:cover}.thumb span{position:absolute;right:8px;bottom:8px;background:#000c;color:#fff;border-radius:4px;padding:2px 7px;font-size:12px}.body{padding:18px}.category{color:var(--blue);font-size:12px;font-weight:700}.card h2{font-size:18px;line-height:1.5;margin:.4em 0}.card h2 a{color:var(--ink);text-decoration:none}.card p{color:var(--muted);font-size:14px}.actions{display:flex;gap:14px;font-size:14px}footer{border-top:1px solid var(--line);margin-top:60px;color:var(--muted)}@media(max-width:600px){nav,main,footer{padding-left:18px;padding-right:18px}.hero{padding:44px 18px}}</style>
</head><body>
<nav><a class="brand" href="/">KanseiLink</a><a href="/insights/">Research &amp; Insights</a></nav>
<header class="hero"><div><div>OFFICIAL VIDEO LIBRARY</div><h1>SYNAPSE 動画ライブラリ</h1><p>AI社員と人間が、これからの経営と仕事を考える。名著、AIサービス、公式レポートを動画と記事でつなぎます。</p><div class="stats"><span>長尺 ${longVideos.length}本</span><span>Shorts ${shorts.length}本</span><span>合計 ${data.videos.length}本</span></div></div></header>
<main><h2 class="section-title">長尺動画</h2><div class="grid">${cards(longVideos)}</div><h2 class="section-title">Shorts</h2><p>Shortsは対応する長尺動画・解説記事とセットで整理しています。</p><div class="grid">${cards(shorts)}</div></main>
<footer>最終更新 ${esc(data.updated)} · © 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="${esc(channelUrl)}">YouTubeチャンネル（${esc(data.channel.name)}）</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="https://zenn.dev/kanseilink">Zenn</a></footer>
</body></html>`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, 'utf8');

const articleTemplate = article => {
  const video = data.videos.find(item => item.id === article.videoId);
  if (!video || video.kind !== 'video') throw new Error(`Article references unknown long video: ${article.videoId}`);
  const canonical = `https://kansei-link.com/insights/${article.slug}.html`;
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'Article','@id':`${canonical}#article`,headline:article.title,description:article.description,datePublished:article.date,dateModified:article.date,inLanguage:'ja',author:{'@id':'https://kansei-link.com/#organization'},publisher:{'@id':'https://kansei-link.com/#organization'},mainEntityOfPage:canonical},
    {'@type':'VideoObject','@id':`${canonical}#video`,name:video.title,description:video.summary,thumbnailUrl:thumb(video.id),contentUrl:youtubeUrl(video),embedUrl:embedUrl(video.id),duration:video.duration,uploadDate:video.uploadDate,inLanguage:'ja',genre:video.category,publisher:{'@id':'https://kansei-link.com/#organization'},creator:{'@id':`${channelUrl}#channel`},isPartOf:{'@id':'https://kansei-link.com/insights/videos/#page'}},
    {'@type':'FAQPage',mainEntity:article.faq.map(item=>({'@type':'Question',name:item.question,acceptedAnswer:{'@type':'Answer',text:item.answer}}))},
    {'@type':'Organization','@id':'https://kansei-link.com/#organization',name:'KanseiLink',alternateName:['KanseiLINK','カンセイリンク'],url:'https://kansei-link.com/',parentOrganization:{'@id':'https://synapsearrows.com/#organization'},sameAs:channelSameAs},
    {'@type':'Organization','@id':'https://synapsearrows.com/#organization',name:'Synapse Arrows Pte. Ltd.',url:'https://synapsearrows.com',sameAs:['https://www.wikidata.org/wiki/Q140399505']},
    {'@type':['Organization','Brand'],'@id':`${channelUrl}#channel`,name:data.channel.name,url:channelUrl,sameAs:channelSameAs,parentOrganization:{'@id':'https://synapsearrows.com/#organization'}}
  ]};
  const points = article.keyPoints.map(point=>`<li>${esc(point)}</li>`).join('');
  const transcript = article.transcript.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('');
  const sources = article.sources.map(source=>`<li><a href="${esc(source.url)}">${esc(source.name)}</a> — ${esc(source.note)}</li>`).join('');
  const faq = article.faq.map(item=>`<details><summary>${esc(item.question)}</summary><p>${esc(item.answer)}</p></details>`).join('');
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(article.title)} | KanseiLink</title><meta name="description" content="${esc(article.description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(article.title)}"><meta property="og:description" content="${esc(article.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${thumb(video.id)}"><script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.85}nav,main,footer{max-width:900px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:60px 28px}.hero>div{max-width:900px;margin:auto}.hero h1{font-size:clamp(30px,5vw,48px);line-height:1.3}.video{position:relative;aspect-ratio:16/9;margin:36px 0;background:#000;border-radius:14px;overflow:hidden}.video img,.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.video img{object-fit:cover}.video button{position:absolute;inset:0;width:100%;border:0;background:transparent;cursor:pointer}.video button:after{content:"▶";display:grid;place-items:center;width:76px;height:54px;margin:auto;border-radius:14px;background:#e62117;color:#fff;font-size:28px}.sr{position:absolute;width:1px;height:1px;overflow:hidden}h2{margin-top:50px;border-left:5px solid var(--b);padding-left:14px}.answer{font-size:19px;background:var(--s);padding:22px;border-radius:12px}details{border-top:1px solid var(--l);padding:16px 0}summary{font-weight:700;cursor:pointer}footer{border-top:1px solid var(--l);margin-top:60px;color:var(--m)}</style></head>
<body><nav><a class="brand" href="/">KanseiLink</a><a href="/insights/videos/">動画ライブラリ</a></nav><header class="hero"><div><div>VIDEO GUIDE</div><h1>${esc(article.title)}</h1><p>${esc(article.description)}</p></div></header><main>
<div class="video" data-youtube-id="${video.id}"><img src="${thumb(video.id)}" alt="${esc(video.title)}" width="480" height="360"><button type="button" aria-label="動画を再生"><span class="sr">動画を再生</span></button></div>
<p><a href="${youtubeUrl(video)}">YouTubeで見る</a></p><h2>結論</h2><p class="answer">${esc(article.answer)}</p><h2>要点</h2><ul>${points}</ul>
<h2>文字起こし</h2><details><summary>全文を読む</summary>${transcript}</details><h2>よくある質問</h2>${faq}<h2>出典</h2><ul>${sources}</ul>
</main><footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/insights/videos/">SYNAPSE 動画ライブラリ</a> · <a href="${esc(channelUrl)}">YouTubeチャンネル</a> · <a href="/insights/">Research &amp; Insights</a></footer>
<script>document.querySelectorAll('[data-youtube-id] button').forEach(function(b){b.addEventListener('click',function(){var c=b.parentElement,i=document.createElement('iframe');i.src='https://www.youtube-nocookie.com/embed/'+c.dataset.youtubeId+'?autoplay=1';i.title='動画';i.allow='autoplay; encrypted-media; picture-in-picture; web-share';i.allowFullscreen=true;c.replaceChildren(i)})});</script></body></html>`;
};

let articleCount = 0;
for (const filename of await readdir(articlesDir)) {
  if (!filename.endsWith('.json') || filename.startsWith('_')) continue;
  const article = JSON.parse(await readFile(resolve(articlesDir, filename), 'utf8'));
  for (const key of ['videoId','slug','title','description','date','answer','keyPoints','transcript','faq','sources']) {
    if (article[key] == null) throw new Error(`${filename}: missing ${key}`);
  }
  const articlePath = resolve(root, 'public/insights', `${article.slug}.html`);
  await writeFile(articlePath, articleTemplate(article), 'utf8');
  articleCount++;
}
console.log(`Generated video hub (${longVideos.length} long, ${shorts.length} Shorts) and ${articleCount} article(s).`);
