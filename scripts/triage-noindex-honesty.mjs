// triage-noindex-honesty.mjs — 2026-07-02 noindex解除ゲート判定
// noindex中の各ページについて、<style>/<script>/免責バナーを除いた本文から
// パーセント数値主張を検出し、clean(解除可) / dirty(誠実化待ち) に分類する。
// 読み取り専用。何も書き換えない。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dirs = [
  ['', resolve(__dirname, '..', 'public', 'insights')],
  ['en/', resolve(__dirname, '..', 'public', 'en', 'insights')],
];

const result = { clean: [], dirty: [] };

for (const [tag, dir] of dirs) {
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.html')); } catch { continue; }
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    if (!/name=["']robots["']\s+content=["']noindex/i.test(raw)) continue; // noindex中のみ対象

    let body = raw
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<div data-kl="kl-disclaimer-banner"[\s\S]*?<\/div>/i, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // 数値%の出現（例: 31% / 90.5% / 成功率90%超）— width:100% 等は style 除去済みだが
    // inline style が残る場合に備え style属性も除去
    body = body.replace(/style="[^"]*"/gi, '');

    const matches = [...body.matchAll(/\d{1,3}(?:\.\d+)?%/g)].map(m => m[0]);
    // 周辺コンテキスト付きサンプル（最大5件）
    const samples = [];
    for (const m of body.matchAll(/.{0,50}\d{1,3}(?:\.\d+)?%.{0,30}/g)) {
      if (samples.length >= 5) break;
      samples.push(m[0].replace(/\s+/g, ' ').trim());
    }

    const entry = { file: tag + f, pct_count: matches.length, samples };
    (matches.length === 0 ? result.clean : result.dirty).push(entry);
  }
}

result.dirty.sort((a, b) => a.pct_count - b.pct_count);
console.log(JSON.stringify({
  clean_count: result.clean.length,
  dirty_count: result.dirty.length,
  clean: result.clean.map(e => e.file),
  dirty: result.dirty,
}, null, 2));
