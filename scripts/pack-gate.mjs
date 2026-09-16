#!/usr/bin/env node
/**
 * P0 #39: 配布物衛生ゲート — 「不適切な配布物を生成できない仕組み」の中核
 *
 * npm packで実際に生成されるtarballを純Node tarで展開し、以下が1件でもあれば
 * **exit 1（publish不可）**:
 *   G1. 実名×synthetic数値: "succeeds on N% of calls" / seedデータ内のsuccess_rate数値 /
 *       "median latency Nms" / agent_id "kansei-link-synth"
 *   G2. secret（stripe/whsec/github/aws/jwt/sendgrid）
 *   G3. 未承認Claim経路（恒久条件・Codex 8/16確定）: scripts/claim-dist-allowlist.json が
 *       enabled=false の間は dist/claim* 全FAIL。enabled=true（SECレビューID必須）でも
 *       allowed 外のclaim系ファイルはFAIL。単純解除は存在しない。
 *   G4. seed系ファイル内の個人メール疑い（gmail/yahoo等の個人ドメインをblocklist検知。
 *       ベンダー公開連絡先はカタログ由来として許容）
 *   G5. 内部成果物・テスト・fixtureの混入: qa-internal / CHECKER-NOTE / publish-test /
 *       fixtures/ / smoke-claim* / claim_pii fixture / publish-manifest
 *
 * 使い方:
 *   node scripts/pack-gate.mjs            … npm pack --dry-runせず実パックして検査・検査後tgz削除
 *   node scripts/pack-gate.mjs <tgz>      … 既存tarballを検査（CIやrelease-safetyと併用）
 *
 * リリース手順への固定（#39完了条件）: publishは必ず
 *   pack-gate PASS → release-gate PASS（clean worktree+tag） → publish
 * の順で行い、CI（C1後にGH Actionsへ）はPRごとにpack-gateを実行する。
 */

import { execSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { untgz } from "./lib-tgz.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// G3設定: 環境変数はテスト専用（smoke-dist-hygieneが両状態を検証するため）
const claimAllowlistPath =
  process.env.KANSEI_CLAIM_DIST_ALLOWLIST ?? join(ROOT, "scripts", "claim-dist-allowlist.json");
const claimCfg = existsSync(claimAllowlistPath)
  ? JSON.parse(readFileSync(claimAllowlistPath, "utf8"))
  : { enabled: false, allowed: [] };
// enabled=true の緩和は SECレビューID形式 + allowed一覧の内容ハッシュ束縛の両方が条件
// （route-allowlist の RG2 と対称 — allowed[] を書き換えたら allowed_sha256 も更新が必要
//  で、その組はSECレビュー済みコミットでしか変わらない。Checker監査 P1-3 対応）
const allowedHash = createHash("sha256")
  .update(JSON.stringify([...(claimCfg.allowed ?? [])].sort()))
  .digest("hex");
const claimEnabled =
  claimCfg.enabled === true &&
  /^SEC-\d{4}-\d{2}-\d{2}-\d{3}$/.test(claimCfg.sec_review_id ?? "") &&
  claimCfg.allowed_sha256 === allowedHash;
const claimAllowed = new Set(claimCfg.allowed ?? []);
let tgzPath = process.argv[2];
let packed = false;

if (!tgzPath) {
  const out = execSync("npm pack --json", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  tgzPath = join(ROOT, JSON.parse(out)[0].filename);
  packed = true;
}

const files = untgz(readFileSync(tgzPath));
const errors = [];

const SECRETS = [
  /(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/, /whsec_[A-Za-z0-9]{10,}/,
  /ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, /AKIA[A-Z0-9]{16}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
];
// SYNTH_TEXT: 実名×合成数値の本文パターン — 全ファイル対象（これが実害の本体）
// SYNTH_MARKER: agent_id マーカー — データファイル(seed系/.json)のみ対象。
//   コード内の 'kansei-link-synth' リテラルは隔離migration（schema.tsのDELETE文）が
//   正当に保持するため対象外（Checker監査後のスコープ精密化・緩和ではない:
//   本文パターンは全ファイルで生きており、マーカー単独では名誉毀損リスクを構成しない）
const SYNTH_TEXT = [/succeeds on \d+% of calls/i, /median latency \d+ms/i];
const SYNTH_MARKER = /kansei-link-synth/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

for (const [p, { data }] of files) {
  if (/claim/i.test(p) && /^package\/(dist|src)\//.test(p)) {
    if (!claimEnabled) { errors.push(`G3 未承認Claim経路 (claim-dist-allowlist enabled=false): ${p}`); continue; }
    if (!claimAllowed.has(p)) { errors.push(`G3 allowlist外のclaimファイル: ${p}`); continue; }
    // allowlist内 + enabled=true(SECレビューID有効) → 通過して以降の内容検査へ
  }
  if (/qa-internal|publish-test|CHECKER-NOTE|^package\/fixtures\/|\/fixtures\/|smoke-claim|claim[-_]pii|publish-manifest/i.test(p)) { errors.push(`G5 内部成果物/テスト/fixture: ${p}`); continue; }
  if (!/\.(js|json|md|txt|map)$/.test(p)) continue;
  const text = data.toString("utf8");
  for (const re of SECRETS) if (re.test(text)) errors.push(`G2 secret痕跡: ${p}`);
  const isSeed = /^package\/(src|dist)\/data\//.test(p);
  for (const re of SYNTH_TEXT) if (re.test(text)) errors.push(`G1 synthetic実名: ${p} (${re})`);
  if ((isSeed || p.endsWith(".json")) && SYNTH_MARKER.test(text)) errors.push(`G1 syntheticマーカー(データファイル内): ${p}`);
  if (isSeed && /"success_rate":\s*0?\.\d+/.test(text)) errors.push(`G1 seed内success_rate数値: ${p}`);
  if (isSeed) {
    for (const m of text.match(EMAIL_RE) ?? []) {
      // ベンダー公開連絡先はカタログ由来として許容（audit分類済み）——ただし
      // 明白な個人gmail等は止める
      if (/@(gmail|yahoo|hotmail|outlook|icloud)\./i.test(m)) { errors.push(`G4 個人メール疑い: ${p} (${m.slice(0, 30)})`); break; }
    }
  }
  if (/CHECKER-NOTE/.test(text)) errors.push(`G5 CHECKER-NOTE本文混入: ${p}`);
}

if (packed) rmSync(tgzPath, { force: true });

if (errors.length) {
  console.error(`❌ pack-gate FAIL (${errors.length}) — この状態ではpublishできません:`);
  [...new Set(errors)].slice(0, 20).forEach((e) => console.error("  -", e));
  process.exit(1);
}
console.log(`✅ pack-gate PASS (${files.size} files) — 配布物に synthetic実名/secret/claim/内部成果物 なし`);
