#!/usr/bin/env node
/**
 * Canary公開パッケージ再現ビルド+漏えい検査+SHA-256 manifest（L3レーン・公開はしない）
 *
 * 実デプロイ予定構成を growth-mvp/publish-test/ に再現:
 *   profiles/{slug}.html  … Profile（公開候補）
 *   claim/index.html      … Claimフォーム（配線はC1後・手順書参照）
 *   install/{client}.html … インストールページ6種
 *
 * 検査（1件でもerrorならexit 1・パッケージ削除）:
 *   - ファイルallowlist: .htmlのみ（manifest/qa-internal/seed等の混在=error）
 *   - 禁止パターン0件: CHECKER-NOTE / HTMLコメント / qa-internal / seed_ /
 *     unverified_not_rendered / 内部パス(growth-mvp・C:\・scratchpad・qa-internal) /
 *     provenance内部語(synthetic/legacy_unknown/kansei_probe/user_reported/vendor_reported) /
 *     スコア数値(点満点・スコア\d) / 順位数値(\d+位・rank表記) /
 *     PII(メールアドレス※公式連絡先contact@synapse-arrows.comのみ許容)
 *   - publish-manifest.json: 全ファイルのSHA-256（改竄・入替検知用の公開時照合基準）
 *
 * Usage: node scripts/build-publish-package.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "growth-mvp", "publish-test");
const errors = [];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "profiles"), { recursive: true });
mkdirSync(join(OUT, "claim"), { recursive: true });
mkdirSync(join(OUT, "install"), { recursive: true });

// 1. 収集（コピー元の.html以外は最初から拾わない）
const profileSrc = join(ROOT, "growth-mvp", "profile-drafts");
for (const f of readdirSync(profileSrc)) {
  if (!f.endsWith(".html")) { errors.push(`profile-drafts/に非HTML: ${f}（公開ディレクトリ規律違反）`); continue; }
  copyFileSync(join(profileSrc, f), join(OUT, "profiles", f));
}
copyFileSync(join(ROOT, "growth-mvp", "claim-form-draft.html"), join(OUT, "claim", "index.html"));
const installSrc = join(ROOT, "growth-mvp", "install-drafts");
for (const f of readdirSync(installSrc)) {
  if (!f.endsWith(".html")) { errors.push(`install-drafts/に非HTML: ${f}`); continue; }
  copyFileSync(join(installSrc, f), join(OUT, "install", f));
}

// 2. 漏えい検査（可視・非可視の両層=生HTML全文）
const FORBIDDEN = [
  [/CHECKER-NOTE/i, "CHECKER-NOTE"],
  [/<!--/, "HTMLコメント"],
  [/qa-internal/i, "内部ディレクトリ名"],
  [/seed_[a-z]/i, "seed_プレフィクス"],
  [/unverified_not_rendered/i, "内部ステータス語"],
  [/growth-mvp[\/\\]/i, "内部パス(growth-mvp)"],
  [/C:\\Users|scratchpad/i, "ローカルパス"],
  [/\b(synthetic|legacy_unknown|kansei_probe|user_reported|vendor_reported)\b/, "provenance内部語"],
  [/\d+\s*点満点|スコア\s*[:：]?\s*\d+|\bscore\s*[:=]\s*\d+/i, "スコア数値"],
  [/\d+\s*位|rank\s*[:=]\s*\d+|順位\s*[:：]\s*\d+/i, "順位数値"],
];
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;
const ALLOWED_EMAILS = new Set(["contact@synapse-arrows.com", "you@your-company.co.jp", "you@example.com"]); // 公式連絡先+入力例プレースホルダのみ

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
const files = walk(OUT);
for (const f of files) {
  if (!f.endsWith(".html")) { errors.push(`公開パッケージに非HTML: ${f}`); continue; }
  const raw = readFileSync(f, "utf8");
  for (const [re, label] of FORBIDDEN) {
    if (re.test(raw)) errors.push(`${f.replace(OUT, "")}: ${label}`);
  }
  for (const m of raw.match(EMAIL_RE) ?? []) {
    if (!ALLOWED_EMAILS.has(m.toLowerCase())) errors.push(`${f.replace(OUT, "")}: 想定外メールアドレス ${m}`);
  }
}

// 3. SHA-256 manifest（公開時の照合基準・パッケージ外に置く）
const manifest = files.filter((f) => f.endsWith(".html")).map((f) => ({
  path: f.replace(OUT, "").replace(/\\/g, "/"),
  sha256: createHash("sha256").update(readFileSync(f)).digest("hex"),
}));
writeFileSync(join(ROOT, "growth-mvp", "publish-manifest.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  file_count: manifest.length,
  allowlist_rule: "publish-test/配下は.htmlのみ・本manifestに無いファイルは公開しない",
  files: manifest,
}, null, 1));

if (errors.length) {
  console.error(`❌ 漏えい検査 ${errors.length}件のerror — パッケージを削除します:`);
  errors.slice(0, 20).forEach((e) => console.error("  -", e));
  rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
}
console.log(`✅ publish package: ${manifest.length}ファイル（.htmlのみ）・漏えい検査error 0・manifest生成済み`);
console.log(`   ${join("growth-mvp", "publish-test")} / publish-manifest.json`);
