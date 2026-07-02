// inventory-honesty-v2.mjs — 2026-07-02 正直化regen用の完全インベントリ
// 全insightsページ(JA+EN)を対象に「成功率/success ± 数値%」パターンを検出し、
// noindex状態と合わせて作業リストをJSON出力する。読み取り専用。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');
const dirs = [
  ['insights', join(pub, 'insights')],
  ['en/insights', join(pub, 'en', 'insights')],
];

// 成功率系の%主張（前後どちらに%が来ても拾う）
const PATTERNS = [
  /(成功率|success rate|Success Rate|Success)[^<>]{0,40}?\d{1,3}(?:\.\d+)?%/g,
  /\d{1,3}(?:\.\d+)?%[^<>]{0,25}?(成功|success)/gi,
  /(freee|SmartHR|Slack|Chatwork|Salesforce|Sansan|Money Forward|マネーフォワード|Backlog|kintone|Zendesk|Freshdesk|LINE WORKS|KING OF TIME|Shopify|Notion|Asana)[^<>]{0,30}?\d{1,3}(?:\.\d+)?%/g,
];

const out = [];
for (const [tag, dir] of dirs) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const raw = readFileSync(join(dir, f), 'utf8');
    const noindex = /name=["']robots["']\s+content=["']noindex/i.test(raw);
    let body = raw
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, '') // JSは除くがJSON-LDは残す
      .replace(/<div data-kl="kl-disclaimer-banner"[\s\S]*?<\/div>/i, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/style="[^"]*"/gi, '')
      .replace(/(?:%20|%3D|%23|%2C|%22)/g, '_'); // URLエンコード誤検知除去
    const hits = new Set();
    for (const re of PATTERNS) {
      for (const m of body.matchAll(re)) hits.add(m[0].replace(/\s+/g, ' ').slice(0, 90));
    }
    if (hits.size > 0) out.push({ file: `${tag}/${f}`, noindex, count: hits.size, samples: [...hits].slice(0, 8) });
  }
}

out.sort((a, b) => (b.noindex - a.noindex) || b.count - a.count);
const dest = process.argv[2] || 'honesty-inventory.json';
writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  files_flagged: out.length,
  noindexed: out.filter(o => o.noindex).length,
  indexed_dirty: out.filter(o => !o.noindex).map(o => `${o.file} (${o.count})`),
}, null, 2));
