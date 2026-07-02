// convert-success-to-tier.mjs — 2026-07-02 正直化regen
// public/js/services-data(-en).js の success:"NN%"（実測裏付けのない生数値）を
// UI表示と同じ tier 文字列 (High/Med/Low) に変換する。
// もともと画面は successTier() で tier しか出しておらず、生%はデータ層にだけ露出していた。
// index.html 側の successTier() は tier 文字列を直接受けるよう別途修正する。冪等。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsDir = resolve(__dirname, '..', 'public', 'js');

function tier(p) {
  return p >= 80 ? 'High' : p >= 50 ? 'Med' : 'Low';
}

for (const f of ['services-data.js', 'services-data-en.js']) {
  const p = join(jsDir, f);
  let src = readFileSync(p, 'utf8');
  let n = 0;
  src = src.replace(/success:"(\d{1,3})%"/g, (_, num) => {
    n++;
    return `success:"${tier(parseInt(num, 10))}"`;
  });
  writeFileSync(p, src);
  console.log(`${f}: converted ${n} success values to tiers`);
}
