#!/usr/bin/env node
/**
 * dual-run 日次照合 — 常時稼働ランナー版。
 *
 * 旧版（kansei-ops-runtime@deb5e60）は `railway ssh` で両サービスに入り、
 * ローカルのタスクスケジューラから走らせていた。PCが落ちている日は実行されず、
 * ログに OK_GAP_48h / OK_GAP_72h が残る——「7日連続観測」が満たせない原因がこれ。
 *
 * 変えた点は2つ:
 *
 *  1. **CLI依存を外した。** 両サービスの `/admin/dualrun-digest` を HTTPS で叩く。
 *     Railway CLI もインフラ全体に効くトークンも要らないので、
 *     Railway cron でも GitHub Actions でもローカルでも同じように走る。
 *     認可は既存の CRAWLER_SECRET に相乗り（新しい秘密を増やさない）。
 *
 *  2. **ログを揮発FSに書かない。** cronコンテナのファイルシステムは消えるので、
 *     既定では DB のテーブル `dualrun_reconcile_log` に書く。
 *     DBを開けなければ**黙って続けず終了する**——「回っているつもりで記録が消えていた」が
 *     この移設で一番避けたい失敗なので、ここは静かに失敗させない。
 *
 * 環境変数:
 *   DUALRUN_BELIEVABLE_URL  例 https://<believable>.up.railway.app
 *   DUALRUN_CANONICAL_URL   例 https://<canonical>.up.railway.app
 *   CRAWLER_SECRET          両サービス共通のadmin秘密
 *   KANSEI_DB_PATH          ログ書き込み先DB（既定 /data/kansei-link.db）
 *
 *   node scripts/dualrun-reconcile.mjs [--local-csv <path>] [--dry-run]
 */
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const LOCAL_CSV = arg('--local-csv');
const DRY = process.argv.includes('--dry-run');
const BASELINE_CUTOFF = '2026-08-16 04:05:00';

const SIDES = {
  believable: process.env.DUALRUN_BELIEVABLE_URL,
  canonical: process.env.DUALRUN_CANONICAL_URL,
};
const SECRET = process.env.CRAWLER_SECRET;
for (const [name, url] of Object.entries(SIDES)) {
  if (!url) { console.error(`[dualrun] ${name} のURLが未設定（DUALRUN_${name.toUpperCase()}_URL）`); process.exit(2); }
}
if (!SECRET) { console.error('[dualrun] CRAWLER_SECRET が未設定'); process.exit(2); }

async function fetchSide(name, base) {
  const url = `${base.replace(/\/+$/, '')}/admin/dualrun-digest?since=${encodeURIComponent(BASELINE_CUTOFF)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${SECRET}` }, signal: ctl.signal });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const [B, C] = await Promise.all([
  fetchSide('believable', SIDES.believable),
  fetchSide('canonical', SIDES.canonical),
]);

const bMap = new Map(B.events.map((e) => [e.event_id, e.event_type]));
const cMap = new Map(C.events.map((e) => [e.event_id, e.event_type]));
const onlyB = [...bMap.keys()].filter((id) => !cMap.has(id));
const onlyC = [...cMap.keys()].filter((id) => !bMap.has(id));
const common = [...bMap.keys()].filter((id) => cMap.has(id)).length;
// 同一event_idでevent_typeが食い違う＝台帳の記録差
const typeDiff = [...bMap.keys()].filter((id) => cMap.has(id) && bMap.get(id) !== cMap.get(id));
const cSubs = new Map(C.subs.map((s) => [s.id, s]));
const stateDiff = B.subs.filter((s) => {
  const t = cSubs.get(s.id);
  return t && (t.status !== s.status || t.tier !== s.tier || t.cape !== s.cape);
});

const mismatch = onlyB.length || onlyC.length || typeDiff.length || stateDiff.length;
const status = mismatch ? 'MISMATCH' : 'OK';
const row = {
  ran_at: new Date().toISOString(),
  believable_total: bMap.size, canonical_total: cMap.size, common,
  only_believable: onlyB.length, only_canonical: onlyC.length,
  type_diff: typeDiff.length, state_diff: stateDiff.length,
  status, runner: process.env.DUALRUN_RUNNER || 'unknown',
};

console.log(`[dualrun] ${status} common=${common} onlyB=${onlyB.length} onlyC=${onlyC.length} ` +
  `typeDiff=${typeDiff.length} stateDiff=${stateDiff.length} runner=${row.runner}`);
if (mismatch) {
  console.error(`[dualrun] onlyB=${JSON.stringify(onlyB.slice(0, 5))} onlyC=${JSON.stringify(onlyC.slice(0, 5))}`);
}
if (DRY) { console.log('[dualrun] --dry-run: 記録しない'); process.exit(mismatch ? 1 : 0); }

// ── 記録 ─────────────────────────────────────────────
// 揮発FSに書いて「回っているつもり」が最悪ケース。書けなければ黙って終わらない。
if (LOCAL_CSV) {
  const header = 'ran_at,believable_total,canonical_total,common,only_believable,only_canonical,type_diff,state_diff,status,runner\n';
  if (!existsSync(LOCAL_CSV)) writeFileSync(LOCAL_CSV, header);
  appendFileSync(LOCAL_CSV, Object.values(row).join(',') + '\n');
  console.log(`[dualrun] recorded -> ${LOCAL_CSV}（ローカル実行モード）`);
} else {
  const dbPath = process.env.KANSEI_DB_PATH || '/data/kansei-link.db';
  if (!existsSync(dbPath)) {
    console.error(`[dualrun] 記録先DBが無い: ${dbPath}`);
    console.error('[dualrun] 揮発FSに書いて記録が消えるのを避けるため、ここで失敗させる。');
    console.error('[dualrun] ローカルで試すなら --local-csv <path> を付けること。');
    process.exit(3);
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS dualrun_reconcile_log (
    ran_at TEXT PRIMARY KEY,
    believable_total INTEGER, canonical_total INTEGER, common INTEGER,
    only_believable INTEGER, only_canonical INTEGER,
    type_diff INTEGER, state_diff INTEGER,
    status TEXT, runner TEXT
  )`);
  db.prepare(`INSERT OR REPLACE INTO dualrun_reconcile_log
    (ran_at,believable_total,canonical_total,common,only_believable,only_canonical,type_diff,state_diff,status,runner)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(row));
  const n = db.prepare('SELECT COUNT(*) c FROM dualrun_reconcile_log').get().c;
  console.log(`[dualrun] recorded -> ${dbPath}:dualrun_reconcile_log（通算 ${n} 行）`);
}
process.exit(mismatch ? 1 : 0);
