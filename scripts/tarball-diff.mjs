#!/usr/bin/env node
/**
 * v1.2.0（公開済み）と v1.2.1候補 のtarballをファイル単位SHA-256で比較（Codex条件1）
 *
 * 許可される差分（hotfixの意図した範囲）:
 *   package.json（versionのみ想定）／README.md／CLAUDE.md（※npx修正の同種doc・
 *   Codex許可リスト外のため明示フラグで報告）／
 *   dist/bin/{install-hooks,report-hook,usage-hook,wrapped}.js
 *
 * STOP条件（1件でもexit 1）:
 *   dist/claim* の存在／dist/http-server.js・dist/stripe.js・dist/data/(seed JSON)
 *   の差分／上記許可リスト外のあらゆる差分
 *
 * Usage: node tarball-diff.mjs <v1.2.0.tgz> <v1.2.1-candidate.tgz> [--report <out.md>]
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [oldTgz, newTgz] = process.argv.slice(2);
const reportIdx = process.argv.indexOf("--report");
const reportPath = reportIdx > 0 ? process.argv[reportIdx + 1] : null;
if (!oldTgz || !newTgz) { console.error("usage: node tarball-diff.mjs <old.tgz> <new.tgz> [--report out.md]"); process.exit(2); }

const ALLOWED = new Set([
  "package/package.json",
  "package/README.md",
  "package/dist/bin/install-hooks.js",
  "package/dist/bin/report-hook.js",
  "package/dist/bin/usage-hook.js",
  "package/dist/bin/wrapped.js",
]);
// 対応ビルド物のsourcemap（4 binの.js.map）は許可ビルド物の付随として明示報告
const ALLOWED_FLAGGED = new Set([
  "package/dist/bin/install-hooks.js.map",
  "package/dist/bin/report-hook.js.map",
  "package/dist/bin/usage-hook.js.map",
  "package/dist/bin/wrapped.js.map",
]);
// 備考: CLAUDE.mdはnpm filesに含まれずtarball不在（リポジトリ側の修正はC1 merge対象）
const FORBIDDEN_PREFIX = ["package/dist/claim"];
const FORBIDDEN_EXACT = ["package/dist/http-server.js", "package/dist/stripe.js"];
const FORBIDDEN_PATTERN = /package\/dist\/data\/.*seed.*\.json$/i;

function extract(tgz) {
  const dir = mkdtempSync(join(tmpdir(), "tgz-"));
  // --force-local: GNU tar(win)がC:のコロンをリモート指定と誤解釈するのを防ぐ
  execSync(`tar --force-local -xzf "${tgz.replace(/\\/g, "/")}" -C "${dir.replace(/\\/g, "/")}"`, { stdio: "pipe" });
  return dir;
}
function walk(dir, base = "") {
  const out = {};
  for (const e of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, walk(dir, rel));
    else out[rel] = createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex");
  }
  return out;
}

const dOld = extract(oldTgz), dNew = extract(newTgz);
const hOld = walk(dOld), hNew = walk(dNew);

const added = Object.keys(hNew).filter((f) => !(f in hOld));
const removed = Object.keys(hOld).filter((f) => !(f in hNew));
const changed = Object.keys(hNew).filter((f) => f in hOld && hOld[f] !== hNew[f]);
const identical = Object.keys(hNew).filter((f) => f in hOld && hOld[f] === hNew[f]).length;

const errors = [];
const allowedDiffs = [], flaggedDiffs = [], forbiddenDiffs = [];
for (const f of [...added, ...changed]) {
  if (FORBIDDEN_PREFIX.some((p) => f.startsWith(p)) || FORBIDDEN_EXACT.includes(f) || FORBIDDEN_PATTERN.test(f)) {
    forbiddenDiffs.push(f); errors.push(`FORBIDDEN diff: ${f}${added.includes(f) ? " (added)" : ""}`);
  } else if (ALLOWED.has(f)) allowedDiffs.push(f);
  else if (ALLOWED_FLAGGED.has(f)) flaggedDiffs.push(f);
  else { forbiddenDiffs.push(f); errors.push(`diff outside allowlist: ${f}${added.includes(f) ? " (added)" : ""}`); }
}
for (const f of removed) errors.push(`file removed from package: ${f}`);

// 重要ファイルの不変確認（明示チェック）
const mustBeIdentical = ["package/dist/http-server.js", "package/dist/stripe.js", "package/dist/index.js", "package/dist/db/schema.js"];
const identityChecks = mustBeIdentical.map((f) => ({ f, ok: f in hOld && f in hNew && hOld[f] === hNew[f] }));
identityChecks.filter((c) => !c.ok).forEach((c) => errors.push(`must-be-identical failed: ${c.f}`));
const claimFiles = Object.keys(hNew).filter((f) => f.includes("claim"));
if (claimFiles.length) errors.push(`claim artifacts present in candidate: ${claimFiles.join(",")}`);

const report = [
  `# Tarball diff report: v1.2.0 (published) vs v1.2.1 candidate — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `- old: ${oldTgz} / new: ${newTgz}`,
  `- files: old=${Object.keys(hOld).length} new=${Object.keys(hNew).length} identical=${identical}`,
  `- **判定: ${errors.length === 0 ? "PASS（差分は許可リスト内のみ）" : `FAIL（${errors.length}件）`}**`,
  ``,
  `## 許可された差分（${allowedDiffs.length}）`,
  ...allowedDiffs.map((f) => `- ${f} (${added.includes(f) ? "added" : "changed"})`),
  ``,
  `## フラグ付き差分（Codex許可リスト外だが同種doc修正・要確認: ${flaggedDiffs.length}）`,
  ...flaggedDiffs.map((f) => `- ${f}`),
  ``,
  `## 禁止/想定外の差分（${forbiddenDiffs.length}）`,
  ...(forbiddenDiffs.length ? forbiddenDiffs.map((f) => `- ❌ ${f}`) : ["- なし"]),
  ``,
  `## 不変確認（must-be-identical）`,
  ...identityChecks.map((c) => `- [${c.ok ? "x" : " "}] ${c.f}`),
  `- [${claimFiles.length === 0 ? "x" : " "}] dist/claim* が候補tarballに存在しない`,
  ``,
  `## 全変更ファイルのSHA-256`,
  ...[...allowedDiffs, ...flaggedDiffs].map((f) => `- ${f}\n  - old: ${hOld[f] ?? "(absent)"}\n  - new: ${hNew[f]}`),
].join("\n");

if (reportPath) writeFileSync(reportPath, report);
console.log(report.split("\n").slice(0, 12).join("\n"));
rmSync(dOld, { recursive: true, force: true });
rmSync(dNew, { recursive: true, force: true });
process.exit(errors.length === 0 ? 0 : 1);
