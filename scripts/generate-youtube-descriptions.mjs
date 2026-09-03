// YouTube 説明欄・チャンネル概要に貼る「逆リンク」原稿を manifest から生成する。
// 動画側→サイト側のエッジが無いとチャンネルがエンティティグラフの葉のままになる。
// 出力: content/youtube-descriptions.txt（人間がYouTube Studioで貼る／人間ゲート）
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(await readFile(resolve(root, 'content/video-insights.json'), 'utf8'));
const SITE = 'https://kansei-link.com';
const LIB = `${SITE}/insights/videos/`;
const byId = new Map(data.videos.map(v => [v.id, v]));
const articleFor = v => v.articleUrl || (v.parentId ? byId.get(v.parentId)?.articleUrl : null) || null;
const ytUrl = v => v.kind === 'short'
  ? `https://www.youtube.com/shorts/${v.id}`
  : `https://www.youtube.com/watch?v=${v.id}`;

const SIGNATURE = [
  '制作: Synapse Arrows Pte. Ltd.（シンガポール・UEN 202308737G）',
  'https://synapsearrows.com',
  'KanseiLINK — AIエージェントがSaaSを実際に使えるかを実測して格付けする独立評価機関',
  `${SITE}`
].join('\n');

const out = [];
out.push('# YouTube 逆リンク貼り付け原稿');
out.push(`# 生成: ${data.updated} / scripts/generate-youtube-descriptions.mjs`);
out.push('# 使い方: 既存の説明文は消さず、末尾にこのブロックを追記する。');
out.push('');
out.push('='.repeat(70));
out.push('■ チャンネル概要（YouTube Studio > カスタマイズ > 基本情報 > 説明）の末尾に追記');
out.push('='.repeat(70));
out.push('');
out.push('シンガポールのAI企業 Synapse Arrows が運営する、AIと経営のチャンネルです。');
out.push('名著の解説、AIサービスの検証、AnthropicやOpenAIの公式レポートの日本語解説、');
out.push('AI社員を交えた経営会議を配信しています。');
out.push('');
out.push('長尺動画にはすべて、要点・文字起こし・FAQ・出典を載せた解説記事があります。');
out.push(`全動画＋解説記事の一覧: ${LIB}`);
out.push('');
out.push(SIGNATURE);
out.push('');
out.push('# チャンネルのリンク欄（最大5件）に設定する:');
out.push(`#   1. 動画ライブラリ        ${LIB}`);
out.push(`#   2. KanseiLINK           ${SITE}`);
out.push('#   3. Synapse Arrows       https://synapsearrows.com');
out.push('#   4. Linksee Memory       https://linksee.app');
out.push('#   5. Zenn                 https://zenn.dev/kanseilink');
out.push('');

for (const v of data.videos) {
  const art = articleFor(v);
  const parent = v.parentId ? byId.get(v.parentId) : null;
  out.push('');
  out.push('='.repeat(70));
  out.push(`■ ${v.kind === 'short' ? '[Shorts] ' : ''}${v.title}`);
  out.push(`  ${ytUrl(v)}`);
  out.push('='.repeat(70));
  out.push('');
  out.push('──────────');
  if (parent) out.push(`▼ 本編（長尺）\nhttps://youtu.be/${parent.id}`);
  if (art) {
    out.push(`${parent ? '\n' : ''}▼ 解説記事（要点・文字起こし・FAQ・出典）\n${SITE}${art}`);
  }
  out.push(`\n▼ 全動画＋解説記事の一覧\n${LIB}`);
  out.push('');
  out.push(SIGNATURE);
  out.push('');
}

const path = resolve(root, 'content/youtube-descriptions.txt');
await writeFile(path, out.join('\n'), 'utf8');
const withArticle = data.videos.filter(v => articleFor(v)).length;
console.log(`Wrote ${path} — ${data.videos.length} videos, ${withArticle} with an article link.`);
