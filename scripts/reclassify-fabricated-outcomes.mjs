// reclassify-fabricated-outcomes.mjs — 2026-07-03 再発防止のデータ側措置
//
// 旧 gen-aeo-article.mjs / gen-full-article.mjs が reportOutcome() で実DBに
// 注入した架空ベンチマーク行（context 'agent-benchmark-q2-2026'、hash 'anonymous'）と、
// 2026-04-04 の 'anonymous' 一括コールドスタートseed行（reliability-source.ts の
// コメントで「ハッシュだけでは分離不能」とされていた既知の残余）を、
// ブラックリスト済みハッシュ 'test-harness-v1' に再分類する。
// → classifyReliabilitySource() が synthetic として除外するようになり、
//   これらが live 実測に化けることが構造的に不可能になる。
// 行は削除しない（履歴保全・可逆）。冪等。--dry-run で件数確認のみ。
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(resolve(__dirname, '..'), 'kansei-link.db');
const dryRun = process.argv.includes('--dry-run');

const db = new Database(dbPath);

const WHERE_BENCH = `context_masked LIKE '%agent-benchmark%' AND agent_id_hash NOT IN ('test-harness-v1')`;
const WHERE_SEED = `agent_id_hash = 'anonymous' AND date(created_at) = '2026-04-04'`;

const benchCount = db.prepare(`SELECT COUNT(*) c FROM outcomes WHERE ${WHERE_BENCH}`).get().c;
const seedCount = db.prepare(`SELECT COUNT(*) c FROM outcomes WHERE ${WHERE_SEED}`).get().c;

console.log(JSON.stringify({
  dry_run: dryRun,
  fabricated_benchmark_rows: benchCount,
  cold_start_seed_rows_20260404: seedCount,
}, null, 2));

if (!dryRun) {
  const r1 = db.prepare(`UPDATE outcomes SET agent_id_hash = 'test-harness-v1' WHERE ${WHERE_BENCH}`).run();
  const r2 = db.prepare(`UPDATE outcomes SET agent_id_hash = 'test-harness-v1' WHERE ${WHERE_SEED}`).run();
  console.log(JSON.stringify({ reclassified_benchmark: r1.changes, reclassified_seed: r2.changes }, null, 2));

  // 残った 'anonymous' の内訳を表示（本物の可能性があるfield report）
  const remain = db.prepare(
    `SELECT date(created_at) d, COUNT(*) c FROM outcomes WHERE agent_id_hash='anonymous' GROUP BY 1 ORDER BY 1`
  ).all();
  console.log('remaining anonymous by date:', JSON.stringify(remain));
}
db.close();
