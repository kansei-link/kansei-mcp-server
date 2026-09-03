import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'content/video-insights.json');
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

const articles = [];
for (const filename of (await readdir(articlesDir)).sort()) {
  if (!filename.endsWith('.json') || filename.startsWith('_')) continue;
  articles.push({ filename, ...JSON.parse(await readFile(resolve(articlesDir, filename), 'utf8')) });
}

const byId = new Map(data.videos.map(item => [item.id, item]));
// Shorts は親の長尺動画の解説記事を継承する（記事なしの行き止まりを作らない）
const articleFor = item => item.articleUrl || (item.parentId ? byId.get(item.parentId)?.articleUrl : null) || null;
// 英語ハブは英語版が存在する記事だけへリンクする（実行時に articleSlugsEn が埋まる）
const articleSlugsEn = new Set(articles.filter(a => a.en).map(a => a.slug));
const enBySlug = new Map(articles.filter(a => a.en).map(a => [a.slug, a.en]));
// EN側のカードは英語記事の見出しを使う。動画タイトル自体は日本語なので、
// 元タイトルを併記して YouTube 上の動画との同一性を落とさない。
const enArticleFor = item => {
  const url = articleFor(item);
  if (!url) return null;
  return enBySlug.get(url.replace('/insights/', '').replace('.html', '')) || null;
};
const CATEGORY_EN = {
  'AI経営': 'AI & management',
  '名著・経営': 'Business classics',
  'AIサービス': 'AI services',
  '公式レポート': 'Official reports',
  'プロダクト': 'Product'
};
const cardCategory = (item, locale) => {
  if (locale !== 'en') return item.category;
  const label = CATEGORY_EN[item.category];
  if (!label) throw new Error(`No English label for category: ${item.category}`);
  return label;
};
const cardTitle = (item, locale) => {
  const en = locale === 'en' ? enArticleFor(item) : null;
  return en ? en.title : item.title;
};
const cardSummary = (item, locale) => {
  const en = locale === 'en' ? enArticleFor(item) : null;
  return en ? en.description : item.summary;
};
const articleForLocale = (item, locale) => {
  const url = articleFor(item);
  if (!url) return null;
  if (locale === 'ja') return url;
  const slug = url.replace('/insights/', '').replace('.html', '');
  return articleSlugsEn.has(slug) ? `/en${url}` : null;
};
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
const cards = (items, locale) => items.map(item => `
  <article class="card">
    <a class="thumb" href="${esc(articleForLocale(item, locale) || youtubeUrl(item))}">
      <img src="${thumb(item.id)}" alt="${esc(item.title)}" width="480" height="360" loading="lazy">
      <span>${item.kind === 'short' ? 'Short' : esc(humanDuration(item.duration))}</span>
    </a>
    <div class="body"><div class="category">${esc(cardCategory(item, locale))}</div><h2><a href="${esc(articleForLocale(item, locale) || youtubeUrl(item))}">${esc(cardTitle(item, locale))}</a></h2>
    ${cardSummary(item, locale) ? `<p>${esc(cardSummary(item, locale))}</p>` : ''}${locale === 'en' && cardTitle(item, locale) !== item.title ? `<p class="orig" lang="ja">Video title: ${esc(item.title)}</p>` : ''}
    <div class="actions"><a href="${youtubeUrl(item)}">YouTube</a>${articleForLocale(item, locale) ? `<a href="${esc(articleForLocale(item, locale))}">${locale === 'en' ? 'Article' : '解説記事'}</a>` : ''}</div></div>
  </article>`).join('');

const HUB = {
  ja: {
    lang: 'ja', prefix: '', dir: 'public/insights/videos',
    title: 'SYNAPSE 動画ライブラリ｜AIと経営・名著・公式レポート | KanseiLink',
    desc: 'Synapse ArrowsとKanseiLinkによるAI・経営動画を一覧化。名著解説、AIサービス、公式レポート、AI経営会議を長尺動画とShortsで視聴できます。',
    name: 'SYNAPSE 動画ライブラリ', kicker: 'OFFICIAL VIDEO LIBRARY',
    lead: 'AI社員と人間が、これからの経営と仕事を考える。名著、AIサービス、公式レポートを動画と記事でつなぎます。',
    statLong: n => `長尺 ${n}本`, statShort: n => `Shorts ${n}本`, statAll: n => `合計 ${n}本`,
    secLong: '長尺動画', secShort: 'Shorts',
    shortNote: 'Shortsは対応する長尺動画・解説記事とセットで整理しています。',
    insights: 'Research &amp; Insights', updated: '最終更新 ', channel: 'YouTubeチャンネル',
    other: 'English version', videoNote: ''
  },
  en: {
    lang: 'en', prefix: '/en', dir: 'public/en/insights/videos',
    title: 'SYNAPSE video library — AI and management, business classics, official reports | KanseiLink',
    desc: 'Every public video from Synapse Arrows and KanseiLink, with the English write-up for each: business classics, AI services, official AI reports and AI board discussions.',
    name: 'SYNAPSE video library', kicker: 'OFFICIAL VIDEO LIBRARY',
    lead: 'An AI colleague and a human thinking through the future of management and work. Videos connected to evidence-backed articles.',
    statLong: n => `${n} long-form`, statShort: n => `${n} Shorts`, statAll: n => `${n} total`,
    secLong: 'Long-form videos', secShort: 'Shorts',
    shortNote: 'Each Short is grouped with its long-form video and the article for that video.',
    insights: 'Research &amp; Insights', updated: 'Last updated ', channel: 'YouTube channel',
    other: '日本語版',
    videoNote: 'The videos are narrated in Japanese. Every long-form video has an English write-up on this site with the key points, the full transcript in translation, an FAQ and primary sources.'
  }
};

for (const locale of ['ja', 'en']) {
  const h = HUB[locale];
  const pageId = `https://kansei-link.com${h.prefix}/insights/videos/`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {'@type':'CollectionPage','@id':`${pageId}#page`,name:h.name,url:pageId,inLanguage:h.lang,dateModified:data.updated,publisher:{'@id':'https://kansei-link.com/#organization'},mainEntity:{'@type':'ItemList',numberOfItems:data.videos.length,itemListElement:listItems}},
      {'@type':'Organization','@id':'https://kansei-link.com/#organization',name:'KanseiLink',alternateName:['KanseiLINK','カンセイリンク'],url:'https://kansei-link.com/',parentOrganization:{'@id':'https://synapsearrows.com/#organization'},sameAs:channelSameAs},
      {'@type':'Organization','@id':'https://synapsearrows.com/#organization',name:'Synapse Arrows Pte. Ltd.',url:'https://synapsearrows.com',sameAs:['https://www.wikidata.org/wiki/Q140399505']},
      {'@type':['Organization','Brand'],'@id':`${channelUrl}#channel`,name:data.channel.name,url:channelUrl,sameAs:channelSameAs,parentOrganization:{'@id':'https://synapsearrows.com/#organization'}}
    ]
  };
  const html = `<!DOCTYPE html>
<html lang="${h.lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.title)}</title>
<meta name="description" content="${esc(h.desc)}">
<meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${pageId}"><link rel="alternate" hreflang="ja" href="https://kansei-link.com/insights/videos/"><link rel="alternate" hreflang="en" href="https://kansei-link.com/en/insights/videos/"><link rel="alternate" hreflang="x-default" href="https://kansei-link.com/insights/videos/">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(h.name)}"><meta property="og:url" content="${pageId}"><meta property="og:locale" content="${h.lang === 'en' ? 'en_US' : 'ja_JP'}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>:root{--blue:#1a3fd6;--ink:#101828;--muted:#667085;--line:#e4e7ec;--soft:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--ink);line-height:1.7}nav,main,footer{max-width:1180px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--line)}nav a,a{color:var(--blue)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:64px 28px}.hero>div{max-width:1180px;margin:auto}.hero h1{font-size:clamp(32px,5vw,54px);margin:.2em 0}.hero p{font-size:19px;max-width:760px}.stats{display:flex;gap:14px;flex-wrap:wrap;margin-top:20px}.stats span{background:#ffffff20;border:1px solid #ffffff38;border-radius:999px;padding:6px 14px}.section-title{font-size:30px;margin-top:48px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:22px}.card{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}.thumb{display:block;position:relative;aspect-ratio:16/9;background:#111}.thumb img{width:100%;height:100%;object-fit:cover}.thumb span{position:absolute;right:8px;bottom:8px;background:#000c;color:#fff;border-radius:4px;padding:2px 7px;font-size:12px}.body{padding:18px}.category{color:var(--blue);font-size:12px;font-weight:700}.card h2{font-size:18px;line-height:1.5;margin:.4em 0}.card h2 a{color:var(--ink);text-decoration:none}.card p{color:var(--muted);font-size:14px}.card p.orig{font-size:12px;opacity:.75}.actions{display:flex;gap:14px;font-size:14px}footer{border-top:1px solid var(--line);margin-top:60px;color:var(--muted)}@media(max-width:600px){nav,main,footer{padding-left:18px;padding-right:18px}.hero{padding:44px 18px}}</style>
</head><body>
<nav><a class="brand" href="${h.prefix}/">KanseiLink</a><a href="${h.prefix}/insights/">${h.insights}</a></nav>
<header class="hero"><div><div>${h.kicker}</div><h1>${esc(h.name)}</h1><p>${esc(h.lead)}</p><div class="stats"><span>${esc(h.statLong(longVideos.length))}</span><span>${esc(h.statShort(shorts.length))}</span><span>${esc(h.statAll(data.videos.length))}</span></div></div></header>
<main>${h.videoNote ? `<p>${esc(h.videoNote)}</p>` : ''}<h2 class="section-title">${esc(h.secLong)}</h2><div class="grid">${cards(longVideos, locale)}</div><h2 class="section-title">${esc(h.secShort)}</h2><p>${esc(h.shortNote)}</p><div class="grid">${cards(shorts, locale)}</div></main>
<footer>${h.updated}${esc(data.updated)} · © 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="${esc(channelUrl)}">${esc(h.channel)}（${esc(data.channel.name)}）</a> · <a href="${h.prefix}/insights/">${h.insights}</a> · <a href="https://zenn.dev/kanseilink">Zenn</a> · <a href="${locale === 'en' ? '/insights/videos/' : '/en/insights/videos/'}">${esc(h.other)}</a></footer>
</body></html>`;
  const dir = resolve(root, h.dir);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'index.html'), html, 'utf8');
}

// 記事1本につき JA と EN を同じテンプレートから出す。
// 動画は日本語のままなので、EN側でも VideoObject の inLanguage は 'ja' を保つ
// （Article は 'en'）。EN読者に「動画は日本語」であることを本文でも明示する。
const T = {
  ja: {
    lang: 'ja', prefix: '', kicker: 'VIDEO GUIDE',
    nav: 'KanseiLink', navLib: '動画ライブラリ',
    watch: 'YouTubeで見る', answer: '結論', points: '要点',
    transcript: '文字起こし', openAll: '全文を読む',
    faq: 'よくある質問', sources: '出典', play: '動画を再生',
    videoNote: '', libLabel: 'SYNAPSE 動画ライブラリ',
    channel: 'YouTubeチャンネル', insights: 'Research &amp; Insights'
  },
  en: {
    lang: 'en', prefix: '/en', kicker: 'VIDEO GUIDE',
    nav: 'KanseiLink', navLib: 'Video library',
    watch: 'Watch on YouTube', answer: 'The short answer', points: 'Key points',
    transcript: 'Transcript', openAll: 'Read the full transcript',
    faq: 'FAQ', sources: 'Sources', play: 'Play the video',
    videoNote: 'The video is narrated in Japanese. This page is the English write-up: the same argument, key points, full transcript in translation, FAQ and primary sources.',
    libLabel: 'SYNAPSE video library',
    channel: 'YouTube channel', insights: 'Research &amp; Insights'
  }
};

const articleTemplate = (article, locale) => {
  const t = T[locale];
  const c = locale === 'en' ? article.en : article;
  const video = data.videos.find(item => item.id === article.videoId);
  if (!video || video.kind !== 'video') throw new Error(`Article references unknown long video: ${article.videoId}`);
  const canonical = `https://kansei-link.com${t.prefix}/insights/${article.slug}.html`;
  const jaUrl = `https://kansei-link.com/insights/${article.slug}.html`;
  const enUrl = `https://kansei-link.com/en/insights/${article.slug}.html`;
  const hreflang = article.en
    ? `<link rel="alternate" hreflang="ja" href="${jaUrl}"><link rel="alternate" hreflang="en" href="${enUrl}"><link rel="alternate" hreflang="x-default" href="${jaUrl}">`
    : '';
  const schema = {'@context':'https://schema.org','@graph':[
    {'@type':'Article','@id':`${canonical}#article`,headline:c.title,description:c.description,datePublished:article.date,dateModified:article.date,inLanguage:t.lang,author:{'@id':'https://kansei-link.com/#organization'},publisher:{'@id':'https://kansei-link.com/#organization'},mainEntityOfPage:canonical,...(article.en?{translationOfWork:{'@id':`${jaUrl}#article`}}:{})},
    {'@type':'VideoObject','@id':`${canonical}#video`,name:video.title,description:video.summary,thumbnailUrl:thumb(video.id),contentUrl:youtubeUrl(video),embedUrl:embedUrl(video.id),duration:video.duration,uploadDate:video.uploadDate,inLanguage:'ja',genre:video.category,publisher:{'@id':'https://kansei-link.com/#organization'},creator:{'@id':`${channelUrl}#channel`},isPartOf:{'@id':'https://kansei-link.com/insights/videos/#page'}},
    {'@type':'FAQPage',mainEntity:c.faq.map(item=>({'@type':'Question',name:item.question,acceptedAnswer:{'@type':'Answer',text:item.answer}}))},
    {'@type':'Organization','@id':'https://kansei-link.com/#organization',name:'KanseiLink',alternateName:['KanseiLINK','カンセイリンク'],url:'https://kansei-link.com/',parentOrganization:{'@id':'https://synapsearrows.com/#organization'},sameAs:channelSameAs},
    {'@type':'Organization','@id':'https://synapsearrows.com/#organization',name:'Synapse Arrows Pte. Ltd.',url:'https://synapsearrows.com',sameAs:['https://www.wikidata.org/wiki/Q140399505']},
    {'@type':['Organization','Brand'],'@id':`${channelUrl}#channel`,name:data.channel.name,url:channelUrl,sameAs:channelSameAs,parentOrganization:{'@id':'https://synapsearrows.com/#organization'}}
  ]};
  const points = c.keyPoints.map(point=>`<li>${esc(point)}</li>`).join('');
  const transcript = c.transcript.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('');
  const sources = c.sources.map(source=>`<li><a href="${esc(source.url)}">${esc(source.name)}</a> — ${esc(source.note)}</li>`).join('');
  const faq = c.faq.map(item=>`<details><summary>${esc(item.question)}</summary><p>${esc(item.answer)}</p></details>`).join('');
  return `<!DOCTYPE html><html lang="${t.lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.title)} | KanseiLink</title><meta name="description" content="${esc(c.description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}">${hreflang}
<meta property="og:type" content="article"><meta property="og:title" content="${esc(c.title)}"><meta property="og:description" content="${esc(c.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${thumb(video.id)}"><meta property="og:locale" content="${t.lang === 'en' ? 'en_US' : 'ja_JP'}"><script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.85}nav,main,footer{max-width:900px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:60px 28px}.hero>div{max-width:900px;margin:auto}.hero h1{font-size:clamp(30px,5vw,48px);line-height:1.3}.video{position:relative;aspect-ratio:16/9;margin:36px 0;background:#000;border-radius:14px;overflow:hidden}.video img,.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.video img{object-fit:cover}.video button{position:absolute;inset:0;width:100%;border:0;background:transparent;cursor:pointer}.video button:after{content:"▶";display:grid;place-items:center;width:76px;height:54px;margin:auto;border-radius:14px;background:#e62117;color:#fff;font-size:28px}.sr{position:absolute;width:1px;height:1px;overflow:hidden}h2{margin-top:50px;border-left:5px solid var(--b);padding-left:14px}.answer{font-size:19px;background:var(--s);padding:22px;border-radius:12px}.note{color:var(--m);font-size:14px;border-left:3px solid var(--l);padding-left:12px}details{border-top:1px solid var(--l);padding:16px 0}summary{font-weight:700;cursor:pointer}footer{border-top:1px solid var(--l);margin-top:60px;color:var(--m)}</style></head>
<body><nav><a class="brand" href="${t.prefix}/">KanseiLink</a><a href="${t.prefix}/insights/videos/">${t.navLib}</a></nav><header class="hero"><div><div>${t.kicker}</div><h1>${esc(c.title)}</h1><p>${esc(c.description)}</p></div></header><main>
<div class="video" data-youtube-id="${video.id}"><img src="${thumb(video.id)}" alt="${esc(video.title)}" width="480" height="360"><button type="button" aria-label="${t.play}"><span class="sr">${t.play}</span></button></div>
<p><a href="${youtubeUrl(video)}">${t.watch}</a></p>${t.videoNote ? `<p class="note">${t.videoNote}</p>` : ''}<h2>${t.answer}</h2><p class="answer">${esc(c.answer)}</p><h2>${t.points}</h2><ul>${points}</ul>
<h2>${t.transcript}</h2><details><summary>${t.openAll}</summary>${transcript}</details><h2>${t.faq}</h2>${faq}<h2>${t.sources}</h2><ul>${sources}</ul>
</main><footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="${t.prefix}/insights/videos/">${t.libLabel}</a> · <a href="${esc(channelUrl)}">${t.channel}</a> · <a href="${t.prefix}/insights/">${t.insights}</a>${article.en ? ` · <a href="${t.lang === 'en' ? jaUrl : enUrl}">${t.lang === 'en' ? '日本語版' : 'English version'}</a>` : ''}</footer>
<script>document.querySelectorAll('[data-youtube-id] button').forEach(function(b){b.addEventListener('click',function(){var c=b.parentElement,i=document.createElement('iframe');i.src='https://www.youtube-nocookie.com/embed/'+c.dataset.youtubeId+'?autoplay=1';i.title='動画';i.allow='autoplay; encrypted-media; picture-in-picture; web-share';i.allowFullscreen=true;c.replaceChildren(i)})});</script></body></html>`;
};

const REQUIRED = ['title','description','answer','keyPoints','transcript','faq','sources'];
let jaCount = 0, enCount = 0;
for (const filename of await readdir(articlesDir)) {
  if (!filename.endsWith('.json') || filename.startsWith('_')) continue;
  const article = JSON.parse(await readFile(resolve(articlesDir, filename), 'utf8'));
  // jaGenerated:false = 日本語ページは手書きが正。ここは英語版の入力としてだけ使うので
  // 日本語フィールドは持たせない（二重管理でのドリフトを避ける）。
  const writesJa = article.jaGenerated !== false;
  for (const key of ['videoId','slug','date',...(writesJa ? REQUIRED : [])]) {
    if (article[key] == null) throw new Error(`${filename}: missing ${key}`);
  }
  if (!writesJa && !article.en) throw new Error(`${filename}: jaGenerated:false requires an en block`);
  if (article.en) {
    for (const key of REQUIRED) {
      if (article.en[key] == null) throw new Error(`${filename}: missing en.${key}`);
    }
    if (writesJa && (article.en.keyPoints.length !== article.keyPoints.length || article.en.faq.length !== article.faq.length
        || article.en.transcript.length !== article.transcript.length || article.en.sources.length !== article.sources.length)) {
      throw new Error(`${filename}: en block is out of sync with the Japanese one`);
    }
  }
  // jaGenerated:false = 日本語ページは手書きを正とし、ここからは英語版だけ出す
  if (writesJa) {
    await writeFile(resolve(root, 'public/insights', `${article.slug}.html`), articleTemplate(article, 'ja'), 'utf8');
    jaCount++;
  }
  if (article.en) {
    await mkdir(resolve(root, 'public/en/insights'), { recursive: true });
    await writeFile(resolve(root, 'public/en/insights', `${article.slug}.html`), articleTemplate(article, 'en'), 'utf8');
    enCount++;
  }
}
console.log(`Generated video hub (${longVideos.length} long, ${shorts.length} Shorts), ${jaCount} JA article(s) and ${enCount} EN article(s).`);
