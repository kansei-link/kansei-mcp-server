#!/usr/bin/env node
/**
 * C1 公開前 QA（Founder 2026-09-16 指示）: publishable ビューが 0 行のとき、公開ダッシュボードが
 * 「0%」「0ms」「旧値」へフォールバックしないことの静的検証。
 *   - /api/dashboard/rankings は未計測を success_rate=null / avg_latency_ms=0 で返す（http-server.ts）
 *   - 旧 dashboard は Math.round(null*100)+'%' で「0%」を表示していた（2026-09-16 発見・修正）
 * 検査:
 *   1. 危険パターン（null を丸めて % / ms を付ける式）が dashboard に残っていない（同じ行に null ガードがあれば安全）
 *   2. dashboard 内の pct()/ms() ヘルパーを抽出して実行し、null/0 → '—'、実数 → 値 になる
 *   3. 表の success_rate 描画がすべて pct() 経由
 *   4. 静的配布 JSON（rankings-raw / aeo-data）に数値の success_rate が焼き込まれていない（null のみ）
 *   5. HTML 本文（<script>/<style> を除く）に、数値の % / ms を直書きしない（2026-09-16: 実在ベンダー名つきの
 *      架空の成功率がデモ値として残り、API で上書きされない箇所が画面とソースに出ていた）
 *   6. 描画 JS が指す tbody を id で特定し、その id が HTML に 1 つずつ存在する（カテゴリ表にウォッチリスト行が
 *      描かれていたセレクタ取り違えの再発防止）
 * 使い方: node scripts/smoke-dashboard-null-render.mjs [path/to/dashboard/index.html]（省略時は public/dashboard）
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

const dashPath = process.argv[2] || join(ROOT, "public/dashboard/index.html");
const html = readFileSync(dashPath, "utf8");
const lines = html.split(/\r?\n/);
const risky = [
  /Math\.round\(\s*\w+\.success_rate\s*\*\s*100\s*\)\s*\+\s*'%'/g,
  /Math\.round\(\s*\w+\.avg_latency_ms\s*\)\s*\+\s*'ms/g,
  /avg_success_rate\s*\|\|\s*0\)/g,
  /avg_success\s*\|\|\s*'—'\)\s*\+\s*'%/g,
];
const guarded = (line) => /==\s*null\s*\?/.test(line);
const hits = lines.filter((l) => !guarded(l)).flatMap((l) => risky.flatMap((re) => l.match(re) || []));
check("1. dashboard に null→0%/0ms へ丸める式が残っていない", hits.length === 0, hits.slice(0, 3).join(" | "));

const fnSrc = (name) => { const l = lines.find((x) => x.trim().startsWith(`function ${name}(v)`)); return l ? l.trim() : null; };
const pctSrc = fnSrc("pct"), msSrc = fnSrc("ms");
check("2a. pct()/ms() ヘルパーが dashboard に存在", !!pctSrc && !!msSrc);
if (pctSrc && msSrc) {
  const pct = new Function(`${pctSrc}; return pct;`)(); const ms = new Function(`${msSrc}; return ms;`)();
  check("2b. pct(null)='—' / pct(undefined)='—' / pct(0.83)='83%' / pct(0)='0%'（実測 0% は表示してよい）",
    pct(null) === "—" && pct(undefined) === "—" && pct(0.83) === "83%" && pct(0) === "0%", `${pct(null)} ${pct(0.83)} ${pct(0)}`);
  check("2c. ms(0)='—'（API は未計測を 0 で返す）/ ms(null)='—' / ms(216.4)='216ms'", ms(0) === "—" && ms(null) === "—" && ms(216.4) === "216ms", `${ms(0)} ${ms(216.4)}`);
}
const usesPct = (html.match(/pct\(\w+\.success_rate\)/g) || []).length;
check("3. 表の success_rate 描画がすべて pct() 経由（4 箇所以上）", usesPct >= 4, `${usesPct} sites`);

for (const f of ["public/rankings-raw.json", "public/aeo-data.json"]) {
  const txt = readFileSync(join(ROOT, f), "utf8");
  const numeric = (txt.match(/"success_rate":\s*[0-9.]+/g) || []).length;
  const nulls = (txt.match(/"success_rate":\s*null/g) || []).length;
  check(`4. ${f}: 数値の success_rate が焼き込まれていない`, numeric === 0, `numeric=${numeric} null=${nulls}`);
}

// 5. HTML 本文に数値の % / ms の直書きが無い
const markup = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
const numericText = [...markup.matchAll(/>([^<]*\b\d+(?:\.\d+)?\s*(?:%|ms)\s*)</g)].map((m) => m[1].trim());
check("5a. HTML 本文に数値の % / ms を直書きしていない（値は API からのみ）", numericText.length === 0, numericText.slice(0, 5).join(" | "));
const claimLike = [...markup.matchAll(/(success rate (?:fell|improved|dropped)[^<]*|of my requests fail[^<]*|dropped [A-C]{1,3} &rarr; [A-C]{1,3}[^<]*)/gi)].map((m) => m[1]);
check("5b. 実在企業の変化履歴・発言を装った直書きが無い", claimLike.length === 0, claimLike.slice(0, 3).join(" | "));

// 6. 描画先 tbody は id で一意に指す
const ids = ["overview-category-body", "overview-watch-body", "watchlist-body", "axr-top-body", "rankings-body", "recipes-body"];
const idCount = (id) => (markup.match(new RegExp(`id="${id}"`, "g")) || []).length;
const jsUses = (id) => html.includes(`getElementById('${id}')`);
const badIds = ids.filter((id) => idCount(id) !== 1 || !jsUses(id));
check("6a. 描画先 tbody の id が HTML に 1 つずつあり、JS が getElementById で指している", badIds.length === 0, badIds.join(","));
const fragile = (html.match(/querySelector\('#page-[a-z]+ [^']*tbody'\)/g) || []);
check("6b. tbody を位置依存セレクタ（:nth-child / :last-child 等）で探していない", fragile.length === 0, fragile.slice(0, 3).join(" | "));

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-dashboard-null-render: ALL PASS" : "\n❌ smoke-dashboard-null-render: FAILURES");
process.exit(all ? 0 : 1);
