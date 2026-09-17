#!/usr/bin/env node
/**
 * Agent Wiki の本番生成 — サイトに載せる側。
 *
 * 生成器（`scripts/agent-wiki/build.mjs`）とDBアダプタは dogfood ブランチで作られたもので、
 * ここでは**本番の入口**だけを持つ。決めるのは3つ:
 *
 *  1. **誰のページを出すか（選定方針）**
 *     DBには11,000件以上ある。全部出すと、大半が registry_inferred＝未検証の薄いページになる。
 *     出所の階梯を等級から外した（RCA ④）のと同じ理由で、**検証できたものだけを載せる**のが既定。
 *       - 台帳 `verdicts.json` に判定のあるもの（人が一次資料で確認 or 事業者申告が検証を通過）
 *       - ARI Award で A以上の認定を持つもの（公開している格付けの対象）
 *     `--all` で全件も出せるが、既定にはしない。
 *
 *  2. **どこへ出すか**
 *     既定は `build/agent-wiki/`（gitignore・公開されない）。
 *     `--publish` を付けたときだけ `public/agent-wiki/` に出る＝GitHub Pagesで公開される。
 *     **C1解錠まで --publish を使わないこと。** public/ に置いた瞬間に公開される。
 *
 *  3. **試作の痕跡を外す**
 *     生成器は既定でPROTOTYPEバナーを出す。本番は { prototype: false } と実URLを渡す。
 *
 *   node scripts/build-agent-wiki.mjs            # ステージングへ（安全）
 *   node scripts/build-agent-wiki.mjs --publish  # public/ へ＝公開（C1後）
 *   node scripts/build-agent-wiki.mjs --all      # 選定せず全件
 */
import { readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildAgentWiki } from './agent-wiki/build.mjs';

const root = resolve(import.meta.dirname, '..');
// 研究DBではなく**配布seed**を読む。verdictによる訂正はseedに入っており、
// エージェントがMCP経由で受け取る値と、このページの値を一致させる
const SEED = resolve(root, 'src/data/services-seed.json');
const SITE = 'https://kansei-link.com/agent-wiki';
const PUBLISH = process.argv.includes('--publish');
const ALL = process.argv.includes('--all');
// 準実験（PROBE 事前登録）用: 段階投入と対照群の保全
//   --only=<id,id,...>        出力をこの id だけに限定（検証済み集合に無い id があれば停止）
//   --forbid=<id,id,...>      対照群。1 件でも出力対象・出力物に現れたら停止（wait-list control を公開しない）
//   --ledger-sha256=<hex>     判定台帳 verdicts.json の版を固定。一致しなければ停止（台帳は git 管理外）
const listArg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3).split(',').map((x) => x.trim()).filter(Boolean) : null; };
const ONLY = listArg('only');
const FORBID = listArg('forbid') ?? [];
const LEDGER_SHA = (process.argv.find((x) => x.startsWith('--ledger-sha256=')) || '').slice('--ledger-sha256='.length) || null;
if (ALL && ONLY) { console.error('[agent-wiki] --all と --only は併用できない'); process.exit(2); }
const OUT = PUBLISH ? resolve(root, 'public/agent-wiki') : resolve(root, 'build/agent-wiki');

// ── 出所の台帳（人の判定・事業者申告の検証結果）─────────────
// gitignore されているので本番CIには無い。無ければ「検証済みゼロ」として扱う＝
// 何も出ないので、気づかず未検証データを公開してしまうことがない
let verdicts = {};
const LEDGER = resolve(root, 'data/runtime-freshness/verdicts.json');
let ledgerSha = null;
if (existsSync(LEDGER)) ledgerSha = createHash('sha256').update(readFileSync(LEDGER)).digest('hex');
if (LEDGER_SHA) {
  if (!ledgerSha) { console.error(`[agent-wiki] 判定台帳が無い: ${LEDGER}（git 管理外。固定版をここへ置くこと）`); process.exit(2); }
  if (ledgerSha !== LEDGER_SHA) { console.error(`[agent-wiki] 判定台帳の版が違う: 期待 ${LEDGER_SHA.slice(0, 16)}… / 実際 ${ledgerSha.slice(0, 16)}…`); process.exit(2); }
}
if (existsSync(LEDGER)) {
  const led = JSON.parse(readFileSync(LEDGER, 'utf8')).verdicts ?? {};
  for (const [id, v] of Object.entries(led)) {
    if (v.verdict === 'seed_wrong' || v.verdict === 'vendor_verified') verdicts[id] = 'verdict';
    else if (v.verdict === 'distributed_correct') verdicts[id] = 'curated';
  }
}

// ── ARI Award の認定（A以上のみ公開している）────────────────
const awardIds = new Set();
const awardGrades = new Map();
const AWARD = resolve(root, 'data/ari-award-2026-summer.json');
if (existsSync(AWARD)) {
  for (const s of JSON.parse(readFileSync(AWARD, 'utf8')).services) {
    if (['AAA', 'AA', 'A'].includes(s.grade)) {
      awardIds.add(s.service_id);
      awardGrades.set(s.service_id, s.grade);
      verdicts[s.service_id] ??= 'curated'; // 認定＝人が採点したもの
    }
  }
}

// ── 出す対象を決める ────────────────────────────────
const seedRaw = JSON.parse(readFileSync(SEED, 'utf8'));
const seedRows = seedRaw.services ?? seedRaw;
const byId = new Map(seedRows.map(r => [r.id, r]));

let targets;
if (ALL) {
  targets = seedRows;
} else {
  const ids = [...new Set([...Object.keys(verdicts), ...awardIds])].filter(id => byId.has(id));
  if (!ids.length) {
    console.error('[agent-wiki] 検証済みのサービスが0件。台帳もAwardデータも読めていない可能性がある。');
    console.error('[agent-wiki] 未検証データを気づかず公開しないよう、ここで止める。全件出すなら --all。');
    process.exit(2);
  }
  targets = ids.map(id => byId.get(id));
}

if (ONLY) {
  const verifiedIds = new Set(targets.map((r) => r.id));
  const notVerified = ONLY.filter((id) => !verifiedIds.has(id));
  if (notVerified.length) {
    console.error(`[agent-wiki] --only に検証済み集合に無い id がある: ${notVerified.join(', ')}（台帳の版・id の正規化を確認）`);
    process.exit(2);
  }
  const onlySet = new Set(ONLY);
  targets = targets.filter((r) => onlySet.has(r.id));
}
const forbiddenInTargets = targets.filter((r) => FORBID.includes(r.id)).map((r) => r.id);
if (forbiddenInTargets.length) {
  console.error(`[agent-wiki] 対照群（--forbid）が出力対象に入っている: ${forbiddenInTargets.join(', ')} — 停止`);
  process.exit(2);
}

const GRADE_WORTHY = new Set(['verdict', 'publisher_verified', 'curated']);
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };
const UNSET = (v) => !v || v === 'unknown' || v === 'none' || v === 'no_public_api';

/** seedの1行 → §1レコード。出所の階梯を消費して confirmed / unverified に振り分ける。 */
function toRecord(r) {
  const verified = GRADE_WORTHY.has(verdicts[r.id]);
  const confirmed = [], unverified = [];
  const put = (field, value) => (verified ? confirmed : unverified).push({ field, value });
  if (r.mcp_endpoint) put('公開MCP', `${r.mcp_endpoint}（${r.mcp_status ?? '?'}）`);
  if (!UNSET(r.api_auth_method)) put('認証方式', r.api_auth_method);
  if (r.api_url) put('API/開発者ドキュメント', r.api_url);
  if (r.category) put('カテゴリ', r.category);

  // 等級は**公開しているAward（AI Access Level 0）だけ**。
  // ランタイムのAXRは別尺度で、registry_inferred を含むため公開面には出さない
  const award = awardGrades.get(r.id);
  return {
    service_id: r.id,
    display_name: r.name,
    category: r.category ?? 'SaaS',
    official_domain: hostOf(r.api_url),
    confirmed, vendor: [], unverified, unconfirmed: [],
    delegation_scope: null,
    grade: award ? { value: award, scale: 'AI Access Level 0（ARI Award 2026 Summer・凍結）' } : null,
    last_verified: null,
  };
}

const records = targets.map(toRecord);
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true }); // 消えたサービスのページを残さない
const n = buildAgentWiki(records, OUT, { site: SITE, prototype: false });

// 出力物の最終検査: 出力ディレクトリのページ集合＝対象集合／対照群の id が HTML・sitemap のどこにも無い
const outPages = readdirSync(join(OUT, 'services')).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
const expectPages = targets.map((r) => r.id).sort();
if (JSON.stringify(outPages) !== JSON.stringify(expectPages)) {
  console.error(`[agent-wiki] 出力ページ集合が対象と一致しない: 出力 ${outPages.length} / 対象 ${expectPages.length}`);
  process.exit(2);
}
if (FORBID.length) {
  const files = [join(OUT, 'index.html'), join(OUT, 'sitemap.xml'), ...outPages.map((id) => join(OUT, 'services', `${id}.html`))];
  const leaks = [];
  for (const f of files) {
    const txt = readFileSync(f, 'utf8');
    for (const id of FORBID) if (txt.includes(`services/${id}.html`) || existsSync(join(OUT, 'services', `${id}.html`))) leaks.push(`${id} in ${f.slice(OUT.length + 1)}`);
  }
  if (leaks.length) { console.error(`[agent-wiki] 対照群が出力物に残っている: ${[...new Set(leaks)].join(' | ')} — 停止`); process.exit(2); }
}

const withGrade = records.filter(r => r.grade).length;
const withConfirmed = records.filter(r => r.confirmed.length).length;
console.log(`[agent-wiki] ${n}サービス → ${OUT}`);
console.log(`[agent-wiki]   判定台帳 sha256: ${ledgerSha ? ledgerSha.slice(0, 16) + '…' : '（台帳なし）'}${LEDGER_SHA ? '（版固定 OK）' : ''}${ONLY ? ` ／ 限定生成 ${ONLY.length} 件` : ''}${FORBID.length ? ` ／ 対照群 ${FORBID.length} 件の混入なし` : ''}`);
console.log(`[agent-wiki]   確認済みの情報あり: ${withConfirmed} ／ Award等級あり: ${withGrade}`);
console.log(PUBLISH
  ? '[agent-wiki] ⚠️ public/ に出力した。次のpushで公開される。'
  : '[agent-wiki] ステージング出力（gitignore・非公開）。公開は --publish で。');
