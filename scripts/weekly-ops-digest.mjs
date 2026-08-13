#!/usr/bin/env node
/**
 * 週次Opsダイジェスト — Company OS の自動計測レイヤー（OPS-BOARD §5）
 *
 * 毎週月曜8:30にタスクスケジューラから実行。Founderが月曜に見る1枚を自動生成する。
 * 集計対象:
 *   1. AI引用トレンド（weekly-trend.csv 直近2行の差分）
 *   2. センサー/Outcome（DB: provenance別・直近7日）
 *   3. attempt相関の稼働（execution_attempts があれば open/closed）
 *   4. npm週間DL（@kansei-link/mcp-server・認知指標）
 *   5. Evidence資産（bundleディレクトリ数・Test Pack数）
 *   6. レーン活動（kansei-link-mcp の直近7日コミット）
 *   7. 承認待ちキュー（OPS-BOARD §4 をそのまま転記）
 *
 * 出力: reports/ops-digest-YYYY-MM-DD.md
 * 解除: schtasks /delete /tn "KanseiLink Weekly Ops Digest" /f
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const KANSEI_DIR = join(ROOT, '..');
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // JST
const lines = [];
const md = (s) => lines.push(s);

md(`# KanseiLINK 週次Opsダイジェスト — ${TODAY}`);
md('');
md('> 自動生成（weekly-ops-digest.mjs・毎週月曜8:30）。作戦盤: `founder-ops/OPS-BOARD.md`');
md('');

/* 1. AI引用トレンド */
try {
  const csv = readFileSync(join(ROOT, 'data', 'discoverability', 'weekly-trend.csv'), 'utf8').trim().split('\n');
  const header = csv[0].split(',');
  const rows = csv.slice(1).map((r) => r.split(','));
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const idx = (name) => header.indexOf(name);
  md('## 1. AI引用（battery v2・20問）');
  md(`- 最新 ${last[idx('date')]}: Perplexity言及 **${last[idx('perplexity_mentions')] || '-'}/20** ・公式URL引用 ${last[idx('pplx_official_url_citations')] || '-'}回` + (prev ? `（前回 ${prev[idx('date')]}: ${prev[idx('perplexity_mentions')] || '-'}/20）` : '（初回比較なし）'));
  md(`- 実行エンジン: ${last[idx('engines_run')] || '-'}。詳細: \`data/discoverability/citation-battery-v2-results-${last[idx('date')]}.md\``);
} catch (e) { md('## 1. AI引用'); md(`- 取得失敗: ${e.message.slice(0, 80)}`); }
md('');

/* 2-3. DB系 */
try {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(join(ROOT, 'kansei-link.db'), { readonly: true });
  md('## 2. センサー / Outcome（DB）');
  const prov = db.prepare("SELECT provenance, COUNT(*) n FROM outcomes GROUP BY provenance ORDER BY n DESC").all();
  md(`- 累計: ${prov.map((p) => `${p.provenance} ${p.n}`).join(' / ')}`);
  const week = db.prepare("SELECT provenance, COUNT(*) n FROM outcomes WHERE created_at >= datetime('now','-7 days') GROUP BY provenance").all();
  md(`- 直近7日: ${week.length ? week.map((p) => `${p.provenance} ${p.n}`).join(' / ') : '新規なし'}`);
  const sensors = db.prepare("SELECT COUNT(DISTINCT agent_id_hash) n FROM outcomes WHERE provenance='user_reported' AND created_at >= datetime('now','-7 days')").get();
  md(`- **生きてるセンサー（7日・user_reported主体数）: ${sensors.n}**（North Star）`);
  try {
    const att = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END) open FROM execution_attempts").get();
    md(`- attempt相関: 発行${att.total}・未クローズ${att.open}`);
  } catch { md('- attempt相関: テーブル未作成（lookup発行分は未永続）'); }
  const fresh = db.prepare("SELECT COUNT(*) n FROM recipes WHERE last_verified_at IS NOT NULL").get();
  const recipes = db.prepare('SELECT COUNT(*) n FROM recipes').get();
  md(`- Recipe鮮度: 検証日付き ${fresh.n}/${recipes.n}`);
  db.close();
} catch (e) { md('## 2. センサー / Outcome'); md(`- DB読取失敗: ${e.message.slice(0, 80)}`); }
md('');

/* 4. npm DL */
md('## 3. 配布（認知指標）');
try {
  const res = await fetch('https://api.npmjs.org/downloads/point/last-week/@kansei-link/mcp-server');
  const j = await res.json();
  md(`- npm週間DL（@kansei-link/mcp-server）: **${j.downloads ?? '-'}**（${j.start}〜${j.end}）※認知指標。センサー稼働の証拠ではない`);
} catch (e) { md(`- npm DL取得失敗: ${e.message.slice(0, 60)}`); }
md('');

/* 5. Evidence資産 */
md('## 4. Evidence資産');
try {
  const evRoot = join(ROOT, 'evidence');
  let bundles = 0; const services = [];
  if (existsSync(evRoot)) for (const svc of readdirSync(evRoot)) {
    services.push(svc);
    for (const d of readdirSync(join(evRoot, svc))) bundles += readdirSync(join(evRoot, svc, d)).filter((x) => !x.includes('.')).length + (existsSync(join(evRoot, svc, d, 'manifest.json')) ? 1 : 0) > 0 ? 1 : 0;
  }
  const packs = [];
  const tpRoot = join(ROOT, 'exec-harness', 'taskpacks');
  if (existsSync(tpRoot)) for (const svc of readdirSync(tpRoot)) packs.push(...readdirSync(join(tpRoot, svc)).filter((f) => f.endsWith('.json')).map((f) => `${svc}/${f}`));
  md(`- Test Pack: ${packs.length}本（${packs.join(', ') || 'なし'}）`);
  md(`- Evidence Bundle: 対象サービス ${services.join(', ') || 'なし'}・日付ディレクトリ${bundles}個`);
} catch (e) { md(`- 集計失敗: ${e.message.slice(0, 60)}`); }
md('');

/* 6. レーン活動 */
md('## 5. 直近7日の実装活動（kansei-link-mcp）');
try {
  const log = execSync('git log --since="7 days ago" --oneline', { cwd: ROOT }).toString().trim();
  const n = log ? log.split('\n').length : 0;
  md(`- コミット ${n} 件`);
  if (n) md(log.split('\n').slice(0, 10).map((l) => `  - ${l}`).join('\n'));
} catch (e) { md(`- git取得失敗: ${e.message.slice(0, 60)}`); }
md('');

/* 7. 承認待ちキュー転記 */
md('## 6. Founder承認待ち（OPS-BOARD §4より転記）');
try {
  const board = readFileSync(join(KANSEI_DIR, 'founder-ops', 'OPS-BOARD.md'), 'utf8');
  const m = board.match(/## 4\. 承認待ちキュー[^\n]*\n([\s\S]*?)\n## /);
  md(m ? m[1].trim() : '- OPS-BOARD §4を読めませんでした');
} catch (e) { md(`- 転記失敗: ${e.message.slice(0, 60)}`); }
md('');
md('---');
md('次のアクション: メインセッションで「週次レビュー」→ kl-chief がOPS-BOARDの今週行を更新します。');

const outPath = join(ROOT, 'reports', `ops-digest-${TODAY}.md`);
writeFileSync(outPath, lines.join('\n'));
console.log(`wrote ${outPath}`);
