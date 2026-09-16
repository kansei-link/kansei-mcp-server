#!/usr/bin/env node
/**
 * P0 #39: 公開 API ルートの allowlist ゲート
 *
 * 検査内容（1件でも違反があれば exit 1）:
 *   RG1. 実ルート（src/http-server.ts、dist/http-server.js があれば両方から抽出）と
 *        route-allowlist.json の routes が完全一致すること — 追加/削除/メソッド変更を検知
 *   RG2. allowlist の routes 一覧の SHA-256 が sec_reviews のいずれかのエントリの
 *        routes_sha256 と一致すること — allowlist を書き換えたら新しい SEC レビュー
 *        エントリ（review_id 付き）を追加しない限り FAIL
 *   RG3. 該当 sec_reviews エントリの review_id が SEC-YYYY-MM-DD-NNN 形式であること
 *
 * 使い方:
 *   node scripts/route-gate.mjs                     … 通常検査
 *   node scripts/route-gate.mjs --print-routes      … 抽出結果の canonical JSON を表示（allowlist 更新用）
 *   node scripts/route-gate.mjs --src <file> --allowlist <file>  … テスト用の対象差し替え
 *
 * allowlist の正しい更新手順（SEC レーン必須）:
 *   1. ルート変更の diff を SEC レビューへ提出し review_id を発番
 *   2. --print-routes の出力で routes を置換
 *   3. sec_reviews に {review_id, routes_sha256(=--print-routes が表示), date, note} を追記
 *   4. 変更コミットのメッセージに review_id を記載
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const srcPath = argOf("--src") ?? join(ROOT, "src", "http-server.ts");
const distPath = argOf("--dist") ?? join(ROOT, "dist", "http-server.js");
const allowlistPath = argOf("--allowlist") ?? join(ROOT, "route-allowlist.json");

const ROUTE_RE = /\bapp\.(get|post|put|delete|patch|all)\(\s*\r?\n?\s*["'`]([^"'`]+)["'`]/g;

function extractRoutes(file) {
  const text = readFileSync(file, "utf8");
  // 番兵: Router()/app.route()/変数パス登録は本抽出regexで拾えないため、出現したら
  // 即FAIL（静かなallowlist漏れを許さない — Checker監査 P2-3 対応）
  const sentinel = text.match(/\bexpress\.Router\s*\(|\bRouter\s*\(\)|\bapp\.route\s*\(|\bapp\.(get|post|put|delete|patch|all)\(\s*[^"'`\s)]/g);
  if (sentinel) {
    console.error(
      `❌ route-gate FAIL: 抽出regex対象外のルート登録形式を検出 (${file}): ${[...new Set(sentinel)].join(", ")}\n` +
        `  Router()/app.route()/変数パスは静かにallowlistから漏れるため禁止。リテラルパスの app.<method>("...") で登録してください。`
    );
    process.exit(1);
  }
  const routes = new Set();
  for (const m of text.matchAll(ROUTE_RE)) {
    routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return [...routes].sort();
}

function canonical(routes) {
  return JSON.stringify(routes.map((r) => (typeof r === "string" ? r : `${r.method} ${r.path}`)).sort());
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

const actual = extractRoutes(srcPath);
if (existsSync(distPath) && !argOf("--src")) {
  const distRoutes = extractRoutes(distPath);
  const srcSet = new Set(actual);
  const distSet = new Set(distRoutes);
  const onlySrc = actual.filter((r) => !distSet.has(r));
  const onlyDist = distRoutes.filter((r) => !srcSet.has(r));
  if (onlySrc.length || onlyDist.length) {
    console.error(`❌ route-gate FAIL: src と dist のルートが不一致（buildが古い可能性）`);
    onlySrc.forEach((r) => console.error(`  - src のみ: ${r}`));
    onlyDist.forEach((r) => console.error(`  - dist のみ: ${r}`));
    process.exit(1);
  }
}

if (args.includes("--print-routes")) {
  console.log(JSON.stringify({ routes: actual, routes_sha256: sha256(canonical(actual)) }, null, 1));
  process.exit(0);
}

if (!existsSync(allowlistPath)) {
  console.error(`❌ route-gate FAIL: allowlist がありません: ${allowlistPath}`);
  process.exit(1);
}

const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const allowed = (allowlist.routes ?? []).slice().sort();
const errors = [];

// RG1: 実ルート vs allowlist
const allowedSet = new Set(allowed);
const actualSet = new Set(actual);
for (const r of actual) if (!allowedSet.has(r)) errors.push(`RG1 allowlist外のルートが追加されています: ${r}`);
for (const r of allowed) if (!actualSet.has(r)) errors.push(`RG1 allowlistにあるルートが実装から消えています: ${r}`);

// RG2: allowlist 自体の変更に SEC レビューが紐付いているか
const hash = sha256(canonical(allowed));
const reviews = allowlist.sec_reviews ?? [];
const matching = reviews.find((r) => r.routes_sha256 === hash);
if (!matching) {
  errors.push(
    `RG2 allowlist の routes（sha256=${hash.slice(0, 16)}…）に対応する SEC レビューエントリがありません — ` +
      `allowlist を変更した場合は sec_reviews に review_id 付きエントリを追加してください`
  );
} else if (!/^SEC-\d{4}-\d{2}-\d{2}-\d{3}$/.test(matching.review_id ?? "")) {
  // RG3: review_id 形式
  errors.push(`RG3 SEC レビューIDが不正です: "${matching.review_id}"（形式: SEC-YYYY-MM-DD-NNN）`);
}

if (errors.length) {
  console.error(`❌ route-gate FAIL (${errors.length}):`);
  errors.slice(0, 30).forEach((e) => console.error("  -", e));
  process.exit(1);
}
console.log(`✅ route-gate PASS (${actual.length} routes, sec_review=${matching.review_id})`);
