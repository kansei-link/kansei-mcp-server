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
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAgentWiki } from './agent-wiki/build.mjs';

const root = resolve(import.meta.dirname, '..');
// 研究DBではなく**配布seed**を読む。verdictによる訂正はseedに入っており、
// エージェントがMCP経由で受け取る値と、このページの値を一致させる
const SEED = resolve(root, 'src/data/services-seed.json');
const SITE = 'https://kansei-link.com/agent-wiki';
const PUBLISH = process.argv.includes('--publish');
const ALL = process.argv.includes('--all');
const OUT = PUBLISH ? resolve(root, 'public/agent-wiki') : resolve(root, 'build/agent-wiki');

// ── 出所の台帳（人の判定・事業者申告の検証結果）─────────────
// gitignore されているので本番CIには無い。無ければ「検証済みゼロ」として扱う＝
// 何も出ないので、気づかず未検証データを公開してしまうことがない
let verdicts = {};
const LEDGER = resolve(root, 'data/runtime-freshness/verdicts.json');
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

const withGrade = records.filter(r => r.grade).length;
const withConfirmed = records.filter(r => r.confirmed.length).length;
console.log(`[agent-wiki] ${n}サービス → ${OUT}`);
console.log(`[agent-wiki]   確認済みの情報あり: ${withConfirmed} ／ Award等級あり: ${withGrade}`);
console.log(PUBLISH
  ? '[agent-wiki] ⚠️ public/ に出力した。次のpushで公開される。'
  : '[agent-wiki] ステージング出力（gitignore・非公開）。公開は --publish で。');
