#!/usr/bin/env node
/**
 * ランタイム鮮度チェック — エージェントに配っている事実が現況かを検証する作業表を作る。
 *
 * 対象は「事実」であって格付けではない。格付け（AI Access Level 0 / AXR Runtime）は
 * 別スケールとして分離済みで、すり合わせてはいけない（founder-ops/CANON-Grade-Scales-v1.md）。
 * ここで見るのは `mcp_status` / `api_auth_method` / `api_url` ——
 * 誤っているとエージェントが誤った認証フローを試す、実害のあるフィールド。
 *
 * 同じ事実が3箇所にあり、値が食い違っている:
 *   1. src/data/services-seed.json … npmパッケージに同梱＝**エージェントに実際に配られる**
 *   2. 研究DB kansei-link.db      … 日次クローラが更新する運用側
 *   3. ari-axr-scores-200.json    … Award採点時(2026-07-16)の調査。**凍結・触らない**
 *
 * 3は基準点であって正解ではない。7週間で現況が変わった可能性があるため、
 * 食い違い＝誤りとは限らない。判定は一次資料を引いて人が行う:
 *   drift          … 配布値が現況・Awardが古い（Awardは凍結のまま、ドリフトとして記録）
 *   seed_wrong     … 配布値が誤り → 訂正する
 *   unknown        … 一次資料で確定できない → 憶測で埋めない
 *
 *   node scripts/runtime-freshness-check.mjs [--limit 30] [--field auth|mcp|all]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '..');
const DB = process.env.KANSEI_DB_PATH ?? resolve(root, '..', 'kansei-link-mcp', 'kansei-link.db');
const AWARD_SRC = resolve(root, '..', 'ari-axr-scores-200.json');
const OUT_DIR = resolve(root, 'data/runtime-freshness');
const LEDGER = resolve(OUT_DIR, 'verdicts.json');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('--limit', 40));
const FIELD = arg('--field', 'all');

// 採点時idとサービスDBのidの綴りの揺れ（CANON参照）
const ALIAS = { agileworks: 'agile-works', 'create-webflow': 'create-web', learningbox: 'learningboa', 'plaid-karte': 'karte' };

const seedRaw = JSON.parse(await readFile(resolve(root, 'src/data/services-seed.json'), 'utf8'));
const seed = new Map((seedRaw.services ?? seedRaw).map(s => [s.id, s]));
const award = JSON.parse(await readFile(AWARD_SRC, 'utf8')).scores;
const db = new DatabaseSync(DB, { readOnly: true });

// すでに判定済みのものは作業表から外す。反復して回せるようにするため。
let ledger = { checked_at: null, verdicts: {} };
if (existsSync(LEDGER)) ledger = JSON.parse(await readFile(LEDGER, 'utf8'));

const norm = v => (v === '' || v === undefined ? null : v);
const rows = [];
for (const a of award) {
  const id = ALIAS[a.id] ?? a.id;
  const s = seed.get(id);
  if (!s) continue;
  const r = db.prepare('SELECT name, category, usage_count, mcp_status, api_auth_method FROM services WHERE id = ?').get(id);
  if (!r) continue;

  const authDiff = norm(s.api_auth_method) !== norm(a.api_auth_method);
  const mcpDiff = norm(s.mcp_status) !== norm(a.mcp_status);
  if (!authDiff && !mcpDiff) continue;
  if (FIELD === 'auth' && !authDiff) continue;
  if (FIELD === 'mcp' && !mcpDiff) continue;
  if (ledger.verdicts[id]) continue;

  const calls = db.prepare(
    'SELECT COALESCE(SUM(total_calls), 0) c FROM publishable_service_stats WHERE service_id = ?'
  ).get(id)?.c ?? 0;

  // 食い違いの「向き」で分類する。件数ではなく実害で並べたいため。
  //   conflict_overclaim   配布値はAPIがあると言い、Award調査は公開APIなしと結論した
  //                        → エージェントが存在しないAPIを探しに行く。最優先
  //   missed_official_mcp  Award調査は公式/サードパーティMCPを確認、配布値は不特定
  //                        → 認定パートナーのMCPを我々が隠している
  //   less_specific        配布値が unknown で、Award に値がある。矛盾はしていない
  //   vocab                unknown と null の差。情報量は同じ
  // 'none' は「MCPなし」の意味で、APIがあるという主張ではない。overclaim に数えない
  const HAS_API = v => v && !['unknown', 'no_public_api', 'none'].includes(v);
  const sMcp = norm(s.mcp_status), aMcp = norm(a.mcp_status);
  const sAuth = norm(s.api_auth_method), aAuth = norm(a.api_auth_method);
  const UNSET = v => v === null || v === 'unknown';

  let kind, priority;
  if (aMcp === 'no_public_api' && (HAS_API(sMcp) || (sAuth && !UNSET(sAuth) && !aAuth))) {
    kind = 'conflict_overclaim'; priority = 100;
  } else if (['official', 'third_party'].includes(aMcp) && !['official', 'third_party'].includes(sMcp)) {
    kind = 'missed_official_mcp'; priority = 80;
  } else if (authDiff && !UNSET(sAuth) && !UNSET(aAuth)) {
    kind = 'conflict_auth'; priority = 90;   // 双方が別の認証方式を主張＝誤った認証を試させる
  } else if (UNSET(sMcp) && !UNSET(aMcp)) {
    kind = 'less_specific'; priority = 30;
  } else {
    kind = 'vocab'; priority = 10;
  }
  if (['AAA', 'AA', 'A'].includes(a.axr_grade)) priority += 15;  // 対外的に見られている
  if (calls > 0) priority += 20;                                  // 実際に使われている

  rows.push({
    service_id: id, name: r.name, category: r.category,
    award_grade: a.axr_grade, calls, usage_count: r.usage_count ?? 0, kind, priority,
    fields: {
      api_auth_method: authDiff
        ? { distributed: norm(s.api_auth_method), runtime_db: norm(r.api_auth_method), award_2026_07_16: norm(a.api_auth_method) } : null,
      mcp_status: mcpDiff
        ? { distributed: norm(s.mcp_status), runtime_db: norm(r.mcp_status), award_2026_07_16: norm(a.mcp_status) } : null,
    },
    verdict: null,       // drift | seed_wrong | unknown
    evidence_url: null,  // 一次資料。憶測で埋めない
    checked_at: null,
  });
}
rows.sort((a, b) => b.priority - a.priority || a.service_id.localeCompare(b.service_id));

await mkdir(OUT_DIR, { recursive: true });
const batch = rows.slice(0, LIMIT);
const out = resolve(OUT_DIR, `worklist-${new Date().toISOString().slice(0, 10)}.json`);
await writeFile(out, JSON.stringify({
  generated_at: new Date().toISOString().slice(0, 10),
  note: 'エージェントに配っている事実の検証用。Awardは2026-07-16の凍結基準点であって正解ではない。判定は一次資料を引いて行い、確定できなければ unknown のまま残す。',
  distributed_via: 'src/data/services-seed.json（npmパッケージ同梱）',
  total_divergent: rows.length,
  in_this_batch: batch.length,
  already_adjudicated: Object.keys(ledger.verdicts).length,
  items: batch
}, null, 2) + '\n', 'utf8');

console.log(`食い違い ${rows.length}件（判定済み ${Object.keys(ledger.verdicts).length}件は除外）`);
console.log(`Wrote ${out}（上位 ${batch.length}件）\n`);
const byKind = rows.reduce((m, r) => (m[r.kind] = (m[r.kind] ?? 0) + 1, m), {});
const ORDER = ['conflict_overclaim', 'conflict_auth', 'missed_official_mcp', 'less_specific', 'vocab'];
const DESC = {
  conflict_overclaim: '配布値はAPIありと言い、Award調査は公開APIなしと結論 → 存在しないAPIを探させる',
  conflict_auth: '双方が別の認証方式を主張 → 誤った認証フローを試させる',
  missed_official_mcp: 'Award調査は公式/3rd party MCPを確認、配布値は不特定 → 認定パートナーのMCPを隠している',
  less_specific: '配布値が unknown。矛盾はしていない（情報量の差）',
  vocab: 'unknown と null の差。情報量は同じ',
};
console.log('分類:');
for (const k of ORDER) if (byKind[k]) console.log(`  ${String(byKind[k]).padStart(4)} ${k.padEnd(20)} ${DESC[k]}`);
console.log();
console.log('要対応（上位）:');
console.log('優先 サービス                    Award 分類');
for (const r of batch.filter(x => x.priority >= 80).slice(0, 20)) {
  console.log(`${String(r.priority).padStart(4)} ${r.service_id.padEnd(28)} ${(r.award_grade ?? '-').padEnd(5)} ${r.kind}`);
}
