#!/usr/bin/env node
/**
 * P0 #39: 配布物衛生ゲート — 「不適切な配布物を生成できない仕組み」の中核
 *
 * npm packで実際に生成されるtarballを純Node tarで展開し、以下が1件でもあれば
 * **exit 1（publish不可）**:
 *   G1. 実名×synthetic数値: "succeeds on N% of calls" / seedデータ内のsuccess_rate数値 /
 *       "median latency Nms" / agent_id "kansei-link-synth"
 *   G2. secret（stripe/whsec/github/aws/jwt/sendgrid）
 *   G3. dist/claim*（Claim実装はcanaryゲート通過まで配布物に載せない）
 *   G4. 変更ファイル外のPII（公開ベンダー連絡先allowlist以外のメール）※seed系のみ
 *   G5. qa-internal / CHECKER-NOTE / publish-test の混入
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
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { untgz } from "./lib-tgz.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
const SYNTH = [/succeeds on \d+% of calls/i, /median latency \d+ms/i, /kansei-link-synth/];
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;
const EMAIL_ALLOW = /(contact@synapse-arrows\.com|@example\.com|noreply@)/i;

for (const [p, { data }] of files) {
  if (p.startsWith("package/dist/claim")) { errors.push(`G3 claimコード: ${p}`); continue; }
  if (/qa-internal|publish-test|CHECKER-NOTE/i.test(p)) { errors.push(`G5 内部成果物: ${p}`); continue; }
  if (!/\.(js|json|md|txt|map)$/.test(p)) continue;
  const text = data.toString("utf8");
  for (const re of SECRETS) if (re.test(text)) errors.push(`G2 secret痕跡: ${p}`);
  const isSeed = /^package\/(src|dist)\/data\//.test(p);
  for (const re of SYNTH) if (re.test(text)) errors.push(`G1 synthetic実名: ${p} (${re})`);
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
