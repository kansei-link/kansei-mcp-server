#!/usr/bin/env node
/**
 * ランタイム鮮度チェックの判定を台帳に記録し、配布値（services-seed.json）へ反映する。
 *
 * 判定は一次資料を引いて人が行い、ここでは記録と適用だけをする。
 * 確定できないものは unknown のまま残す——憶測で埋めない（misdescription-probe と同じ規律）。
 *
 * 判定の種類:
 *   seed_wrong           配布値が誤り。evidence_url を根拠に訂正する
 *   vendor_verified      事業者の自己申告を検証ゲートが承認した（①の第2ソース）
 *   distributed_correct  配布値が現況。Award側が古いか誤り。Awardは凍結なので触らない
 *   unknown              一次資料で確定できない。次回に持ち越す
 *
 *   node scripts/apply-freshness-verdicts.mjs [--dry-run]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const LEDGER = resolve(root, 'data/runtime-freshness/verdicts.json');
const SEED = resolve(root, 'src/data/services-seed.json');
const DRY = process.argv.includes('--dry-run');

const ledger = JSON.parse(await readFile(LEDGER, 'utf8'));
const seedRaw = JSON.parse(await readFile(SEED, 'utf8'));
const list = seedRaw.services ?? seedRaw;
const byId = new Map(list.map(s => [s.id, s]));

let applied = 0, skipped = 0;
for (const [id, v] of Object.entries(ledger.verdicts)) {
  // 適用するかは verdict の種類ではなく「訂正内容があるか」で決める。
  // 例: legalon は distributed_correct（APIはある＝配布値は正しい）だが、
  // 別件で api_url が死んだドメインを指しており、その訂正は必要だった
  const fields = Object.keys(v.correction ?? {});
  if (fields.length === 0) { skipped++; continue; }
  // 根拠の無い訂正は通さない。自動経路(vendor_verified)でも同じ
  if (!v.evidence_url) throw new Error(`${id}: 訂正(${fields.join(',')})があるのに evidence_url が無い`);
  const s = byId.get(id);
  if (!s) { console.warn(`  ${id}: seed に無い`); continue; }
  for (const [field, val] of Object.entries(v.correction ?? {})) {
    if (s[field] === val) continue;
    console.log(`  ${id}.${field}: ${JSON.stringify(s[field])} -> ${JSON.stringify(val)}`);
    if (!DRY) s[field] = val;
    applied++;
  }
}
if (!DRY && applied) await writeFile(SEED, JSON.stringify(seedRaw, null, 2) + '\n', 'utf8');
console.log(`${DRY ? '[dry-run] ' : ''}${applied}件を反映、${skipped}件は訂正不要（distributed_correct / unknown）`);
if (applied && !DRY) console.log('※ 実際にエージェントへ届くのは次回の npm publish 以降');
