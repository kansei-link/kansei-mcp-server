#!/usr/bin/env node
/**
 * ARI Award の格付けを、サービスDBと結合できる形で正本化する。
 *
 * これまで Award の結果は ari-axr-scores-200.json（リポジトリ外）と
 * 掲載ページのHTMLにしかなく、サービスDBには反映されていなかった。
 * そのため診断の対応表は DB の axr_grade を出しており、そこには
 * 一度も採点していないサービスの既定値（50 / BB）が入っていた。
 * 結果として AAA 認定の AgileWorks が診断画面では BB と表示されていた。
 *
 * ここでは採点結果のidをサービスDBのidへ寄せて、id→グレードの表を作る。
 * 一致しない6件は綴りの揺れなので別表で解決する。推測で寄せると
 * 「freee会計」と「freee人事労務」のような取り違えが起きるため、
 * 一致しなかったものは黙って落とさず unresolved に残す。
 *
 *   node scripts/generate-ari-award-map.mjs
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '..');
const SRC = resolve(root, '..', 'ari-axr-scores-200.json');
const DB = process.env.KANSEI_DB_PATH ?? resolve(root, '..', 'kansei-link-mcp', 'kansei-link.db');
const OUT = resolve(root, 'data/ari-award-2026-summer.json');

// 採点時のidとサービスDBのidの綴りの揺れ。目視で確認した対応のみ入れる。
const ALIAS = {
  agileworks: 'agile-works',
  'create-webflow': 'create-web',
  learningbox: 'learningboa',
  'plaid-karte': 'karte', // 採点は「KARTE（PLAID）」1件、DBは製品と会社で別レコード
};

// 採点ファイルは 2026-07-16 の凍結スナップショット。Methodology OS v1 で
// 「Level 0 は凍結保存し、部門制スコアとは別系列」と決めているので、
// 中身が入れ替わったら気づけるようにハッシュと日付を記録する。
const raw = await readFile(SRC, 'utf8');
const srcHash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
const srcMtime = (await stat(SRC)).mtime.toISOString().slice(0, 10);
const parsed = JSON.parse(raw);
const scores = parsed.scores;
const EXPECTED_HASH = process.env.ARI_AWARD_SRC_HASH ?? 'f99cf16387e44334';
if (srcHash !== EXPECTED_HASH) {
  console.warn(`⚠️ 採点ファイルが変わっている（期待 ${EXPECTED_HASH} / 実際 ${srcHash}）。`);
  console.warn('   ARI Award 2026 Summer は凍結された版。新方法論の結果なら別ファイル・別版として出すこと。');
}
const db = new DatabaseSync(DB, { readOnly: true });
const names = new Map(db.prepare('SELECT id, name FROM services').all().map(r => [r.id, r.name]));

const services = [];
const unresolved = [];
for (const s of scores) {
  const id = ALIAS[s.id] ?? s.id;
  if (!names.has(id)) { unresolved.push(s.id); continue; }
  services.push({ service_id: id, name: names.get(id), grade: s.axr_grade, score: s.axr_score });
}
services.sort((a, b) => a.service_id.localeCompare(b.service_id));

const counts = services.reduce((m, s) => (m[s.grade] = (m[s.grade] ?? 0) + 1, m), {});
await writeFile(OUT, JSON.stringify({
  award: 'ARI Award 2026 Summer',
  edition: 'AI Access Level 0 baseline (frozen)',
  frozen: true,
  methodology: '2026-07 時点の AXR。2026-08-25 の Methodology OS v1 で Level 0 ベースラインとして再位置づけ・凍結保存が決定（grandfathering R2-d）。部門制スコアが出ても、この版は書き換えない・直接比較しない。',
  source: 'ari-axr-scores-200.json',
  source_generated: parsed.generated ?? null,
  source_mtime: srcMtime,
  source_sha256_16: srcHash,
  page: 'https://kansei-link.com/ari-award/2026-summer.html',
  note: 'Awardの格付けの正本。サービスDBのaxr_gradeとは別物で、そちらには未採点の既定値が入っている行がある。対外的な格付けはこちらが正。',
  generated_at: new Date().toISOString().slice(0, 10),
  count: services.length,
  grade_counts: counts,
  unresolved, // サービスDBに突合先がないid。データの穴として残す
  services
}, null, 2) + '\n', 'utf8');

console.log(`Wrote ${OUT}`);
console.log(`  ${services.length} / ${scores.length} 件を結合、未解決 ${unresolved.length} 件: ${unresolved.join(', ') || 'なし'}`);
console.log(`  ${Object.entries(counts).sort().map(([g, c]) => `${g}:${c}`).join(' ')}`);
