#!/usr/bin/env node
/**
 * render-reading-sheet — draw the one page people see, from the append-only ledger.
 *
 *   node exec-harness/render-reading-sheet.mjs <marker_id> [--db <path>] [--out <path>] [--now <iso>]
 *
 * Reads marker_readings (effective rows only: not superseded) for one marker and
 * writes founder-ops/research/Marker-<ID>_<date>/SHEET.md (HANDOFF §6). Contains:
 *   1. the claim, the sealed fingerprint, the period, the observers
 *   2. one row per reading: date / observer / stage reached / stage stopped / verdict /
 *      false completion / ground-truth consistency / evidence digest
 *   3. three numbers: days stopped per stage, false-completion count, last observation
 *      (or 「不明」 when older than 24h)
 * Never: ranks, scores, comparisons with other vendors, tenant values, counts, amounts.
 * The renderer only reads; it writes nothing to the DB.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const KANSEI_ROOT = join(ROOT, '..');
const args = process.argv.slice(2);
const markerId = args.find((a) => !a.startsWith('--'));
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

if (existsSync(join(ROOT, '.env'))) for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }

const STAGES = ['discover', 'understand', 'connect', 'execute'];
const STAGE_JA = { discover: '発見', understand: '理解', connect: '接続', execute: '完遂', done: '完了' };
const FORBIDDEN_WORDS = /順位|ランキング|点数|スコア|他社|比較|円|¥|\$[0-9]/;

export function loadRows(db, id) {
  return db.prepare(`SELECT * FROM marker_readings r
     WHERE r.marker_id = ? AND NOT EXISTS (SELECT 1 FROM marker_readings s WHERE s.supersedes = r.reading_id)
     ORDER BY observed_at ASC`).all(id).map((r) => ({ ...r, target: JSON.parse(r.target_json), observed: JSON.parse(r.observed_json) }));
}

export function renderSheet(rows, { markerId, now = new Date() }) {
  const agent = rows.filter((r) => r.outcome_id != null);
  const gt = rows.filter((r) => r.outcome_id == null);
  const claim = agent[0]?.claim || rows[0]?.claim || '(no readings yet)';
  const digest = rows[0]?.expected_digest || '—';
  const dates = rows.map((r) => r.observed_at.slice(0, 10));
  const period = rows.length ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : '—';
  const observerOf = (r) => (r.observer.startsWith('kansei_harness') ? (r.target.model && r.target.model !== 'none' ? `harness→${r.target.model}` : 'harness') : `${r.observer}${r.target.model && r.target.model !== 'none' ? `（${r.target.model}）` : ''}`);
  const observers = [...new Set(agent.map(observerOf))];
  const verdict = (r) => r.observed.instrument_error ? `計器:${r.observed.instrument_error}` : r.observed.pass ? 'pass' : 'fail';
  const gtOf = (r) => r.observed.ground_truth_consistent === true ? '一致' : r.observed.ground_truth_consistent === false ? '不一致' : '—';
  const digestOf = (r) => (r.evidence_ref.split('#sha256:')[1] || '').slice(0, 12) + '…';

  const stopDays = {}; for (const s of STAGES) stopDays[s] = new Set();
  for (const r of agent) if (r.stage_stopped) stopDays[r.stage_stopped].add(r.observed_at.slice(0, 10));
  const falseCompletions = agent.filter((r) => r.observed.false_completion).length;
  const last = rows.length ? rows.map((r) => new Date(r.observed_at)).sort((a, b) => b - a)[0] : null;
  const ageH = last ? (now.getTime() - last.getTime()) / 3_600_000 : null;
  const lastText = last && ageH <= 24 ? rows.map((r) => r.observed_at).sort().at(-1) : '不明';

  const lines = [];
  lines.push(`# 読みの表 — ${markerId}`);
  lines.push('');
  lines.push(`- 主張: ${claim}`);
  lines.push(`- 色素の指紋（封印ファイルの sha256）: \`${digest}\``);
  lines.push(`- 期間: ${period}（有効行 ${agent.length}・正解側の行 ${gt.length}）`);
  lines.push(`- 観測者: ${observers.length ? observers.join('、') : '—'}`);
  lines.push(`- 描画: ${now.toISOString()}（この表は台帳から機械的に描く。序列・得点・他ベンダーとの並置・対象の生値は載せない）`);
  lines.push('');
  lines.push('## 一日一行');
  lines.push('');
  lines.push('| 日付 | 観測者 | 到達 | 止まった臓器 | 判定 | 偽の完了 | 正解側の整合 | 証拠の指紋 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of agent) lines.push(`| ${r.observed_at.slice(0, 10)} | ${observerOf(r)} | ${STAGE_JA[r.stage_reached] || r.stage_reached} | ${r.stage_stopped ? STAGE_JA[r.stage_stopped] : '—'} | ${verdict(r)} | ${r.observed.false_completion ? 'あり' : '—'} | ${gtOf(r)} | ${digestOf(r)} |`);
  if (!agent.length) lines.push('| — | — | — | — | — | — | — | — |');
  if (gt.length) {
    lines.push('');
    lines.push('### 正解側の行（封印の期待 vs ハーネスの直接読み）');
    lines.push('');
    lines.push('| 日付 | 整合 | 証拠の指紋 |');
    lines.push('|---|---|---|');
    for (const r of gt) lines.push(`| ${r.observed_at.slice(0, 10)} | ${r.observed.pass ? '一致' : '不一致'} | ${digestOf(r)} |`);
  }
  lines.push('');
  lines.push('## 三つの数字');
  lines.push('');
  lines.push('| 臓器 | 止まった日数 |');
  lines.push('|---|---|');
  for (const s of STAGES) lines.push(`| ${STAGE_JA[s]} | ${stopDays[s].size} |`);
  lines.push('');
  lines.push(`- 偽の完了: ${falseCompletions} 回`);
  lines.push(`- 計器の最終観測: ${lastText}${last && ageH > 24 ? `（最後の読みから ${Math.floor(ageH)} 時間・24 時間を超えたため「不明」）` : ''}`);
  lines.push('');
  const md = lines.join('\n') + '\n';
  const leak = md.match(FORBIDDEN_WORDS);
  if (leak) throw new Error(`sheet contains a forbidden word: ${leak[0]}`);
  if (/(^|[^0-9a-f])[0-9]{8,}([^0-9a-f]|$)/.test(md.replace(/[0-9a-f]{12}…/g, ''))) throw new Error('sheet contains a long digit run (possible tenant value)');
  return md;
}

function defaultOut(id) {
  const base = join(KANSEI_ROOT, 'founder-ops', 'research');
  const prefix = `Marker-${id.replace(/-/g, '')}_`;
  const dir = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith(prefix)).sort().at(-1) : null;
  return join(base, dir || `${prefix}${new Date().toISOString().slice(0, 10)}`, 'SHEET.md');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!markerId) { console.error('usage: node exec-harness/render-reading-sheet.mjs <marker_id> [--db <path>] [--out <path>] [--now <iso>]'); process.exit(1); }
  const dbPath = flag('db', process.env.KANSEI_DB_PATH);
  if (!dbPath || !existsSync(dbPath)) { console.error('KANSEI_DB_PATH (or --db) must point at the marker DB'); process.exit(2); }
  const db = new Database(dbPath, { readonly: true });
  const rows = loadRows(db, markerId);
  db.close();
  const md = renderSheet(rows, { markerId, now: flag('now', null) ? new Date(flag('now')) : new Date() });
  const out = flag('out', defaultOut(markerId));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(`sheet: ${out} (${rows.length} row(s))`);
}
