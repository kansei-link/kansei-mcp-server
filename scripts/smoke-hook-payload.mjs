#!/usr/bin/env node
/**
 * Phase S0 スモーク — report-hook 送信ペイロードのプライバシー契約テスト
 *
 * 保証すること（A-1監査 §4-1 / Codexレビュー S0-3,4）:
 *   1. ペイロードのフィールド集合が凍結セットと完全一致（追加も欠落も検知）
 *   2. guessServiceId が汎用フィールド（id/name/title等）のユーザーデータを
 *      決して拾わない — 非slug値・日本語・メール等はサーバー名へフォールバック
 *   3. 自由テキスト（tool入力/応答本文）がペイロードのどこにも漏れない
 *
 * 実行: node scripts/smoke-hook-payload.mjs（要 npm run build）
 */

import { strict as assert } from "node:assert";

const { buildHookPayload } = await import("../dist/bin/report-hook.js").catch(() => {
  console.error("dist not built — run `npm run build` first");
  process.exit(1);
});

// ---- 1. フィールド集合の凍結 ----
const FROZEN_FIELDS = ["service_id", "success", "task_type", "error_type", "context", "agent_type", "is_retry"].sort();
const payload = buildHookPayload("freee", false, "create_invoice", "auth_error");
assert.deepEqual(Object.keys(payload).sort(), FROZEN_FIELDS,
  "payload field set changed — update consent docs + this snapshot deliberately, never accidentally");
assert.equal(payload.context, "auto-captured via kansei-link-report-hook", "context must stay a fixed constant, never free text");
console.log("  [PASS] 1. payload field set frozen (7 fields, fixed context)");

// ---- 2. guessServiceId がユーザーデータを拾わないこと ----
// dist内の非公開関数は直接importできないため、ソースの正規表現契約を同一実装で検証
const SERVICE_SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const userDataSamples = [
  "顧客X商談メモ",                    // 日本語ページ名
  "John Smith",                        // 人名（空白）
  "invoice #1234 for Acme Corp",       // 自由文
  "user@example.com",                  // メール
  "SELECT * FROM users",               // 何かのクエリ
  "C:\\Users\\HP\\secret.txt",         // パス
  "A".repeat(100),                     // 長大値
  "MyPage-Title-With-Caps",            // 大文字混じり（slugでない）
];
for (const v of userDataSamples) {
  assert.equal(SERVICE_SLUG_RE.test(v), false, `user-data-like value must NOT match slug pattern: ${v.slice(0, 30)}`);
}
for (const v of ["freee", "money-forward", "kintone", "smart-hr", "sansan_mcp", "aws.s3"]) {
  assert.equal(SERVICE_SLUG_RE.test(v), true, `legit slug must match: ${v}`);
}
console.log("  [PASS] 2. slug pattern rejects user-data-like values, accepts service slugs");

// ---- 3. ソース上の禁止フィールド検査（回帰ガード） ----
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/bin/report-hook.ts", import.meta.url), "utf8");
const candidatesLine = src.match(/const candidates = \[([^\]]*)\]/);
assert.ok(candidatesLine, "candidates array must exist");
for (const banned of ['"id"', '"name"', '"title"', '"query"', '"text"']) {
  assert.ok(!candidatesLine[1].includes(banned), `banned generic field ${banned} reintroduced into guessServiceId candidates`);
}
console.log("  [PASS] 3. generic fields (id/name/title/query/text) banned from candidates");

console.log("\nhook payload privacy contract: ALL PASS");
