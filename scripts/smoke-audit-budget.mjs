#!/usr/bin/env node
/**
 * ai-answer-audit の費用計算と予算停止の回帰テスト（API は呼ばない）
 *   - 単価と費用計算が、2026-09-17 の疎通テストの実使用量で手計算と一致する
 *   - 次の 1 問を投げる前に「実費＋同時に走る呼び出し分の見込み」で止まる（投げてから超える、をしない）
 *   - 単価表に無いモデルで --budget-usd を指定すると、呼び出す前に止まる
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Budget, costOf, priceFor, INITIAL_RESERVE } from "./lib/audit-budget.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 疎通テストの実使用量（claude-opus-4-8: 入力 38,781・出力 3,755・検索 3 回／gpt-5.4: 入力 8,697・出力 2,807・検索 1 回）
const cA = costOf("anthropic", "claude-opus-4-8", { input_tokens: 38781, output_tokens: 3755, cache_read_input_tokens: 0 }, 3);
check("Claude Opus 4.8: 38,781×5 + 3,755×25（/100万）+ 検索 3×0.01 = 0.31778", near(cA, 0.193905 + 0.093875 + 0.03), String(cA));
const cO = costOf("openai", "gpt-5.4", { input_tokens: 8697, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2807 }, 1);
check("GPT-5.4: 8,697×2.5 + 2,807×15（/100万）+ 検索 1×0.01 = 0.07385", near(cO, 0.0217425 + 0.042105 + 0.01), String(cO));
check("OpenAI の cached 入力は cached 単価で計上", near(costOf("openai", "gpt-5.4-2026-03-05", { input_tokens: 1000000, input_tokens_details: { cached_tokens: 400000 }, output_tokens: 0 }, 0), 0.6 * 2.5 + 0.4 * 0.25));
check("単価表に無いモデルは null（gpt-5.4-mini を gpt-5.4 と取り違えない）", priceFor("openai", "gpt-5.4-mini") === null && costOf("anthropic", "claude-unknown-9", { input_tokens: 1 }, 0) === null);
check("Perplexity sonar はリクエスト料を安全側（high）で計上", near(costOf("perplexity", "sonar", { prompt_tokens: 1000, completion_tokens: 1000 }, 1), 0.002 + 0.012));
check("Perplexity: 応答が請求額を返したらそれを使う", near(costOf("perplexity", "sonar", { prompt_tokens: 47, completion_tokens: 782, cost: { total_cost: 0.00583 } }, null), 0.00583));

// 予算停止
const b = new Budget(1.0);
check("初回: 見込み（anthropic 1.0 + openai 0.3）が上限 1.0 を超えるので 1 問も投げない", b.canStart(["anthropic", "openai"]).ok === false);
const b2 = new Budget(5.0);
let asked = 0;
while (b2.canStart(["anthropic", "openai"]).ok) { b2.record("anthropic", 0.32); b2.record("openai", 0.07); asked++; if (asked > 100) break; }
const s = b2.summary();
check("実費が上限を超えない（止まった時点で spent ≤ limit）", s.spent_usd <= 5.0 && asked > 0, `asked=${asked} spent=${s.spent_usd}`);
check("止まる理由は『次の 1 問の見込みを足すと超える』", b2.spent + b2.reserve("anthropic") + b2.reserve("openai") > 5.0);
const b3 = new Budget(10); b3.record("anthropic", 0.9);
check("実績が初期見積もりを上回ったら見込みを引き上げる（最大実費×1.5）", near(b3.reserve("anthropic"), 1.35) && b3.reserve("openai") === INITIAL_RESERVE.openai);
const b4 = new Budget(10); const charged = b4.record("openai", null);
check("使用量が返らない成功呼び出しは見込み額で計上（安く見積もらない）", charged === INITIAL_RESERVE.openai && b4.summary().calls_without_usage === 1);

// CLI: 単価表に無いモデル → 呼び出し前に停止（ダミー鍵。exit 2 なので API には到達しない）
const tmp = mkdtempSync(join(tmpdir(), "audit-budget-"));
const bat = join(tmp, "b.json"); writeFileSync(bat, JSON.stringify({ target: "smoke", questions: [{ id: "q1", question: "x" }] }));
const r = spawnSync(process.execPath, [join(ROOT, "scripts", "ai-answer-audit.mjs"), bat, "--engines=openai", "--budget-usd=1"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "dummy", OPENAI_AUDIT_MODEL: "gpt-unknown-0" } });
check("CLI: 単価表に無いモデル＋--budget-usd は exit 2 で実行しない", r.status === 2 && /単価表/.test(r.stderr), (r.stderr || "").trim().split("\n").pop()?.slice(0, 120));
rmSync(tmp, { recursive: true, force: true });

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-audit-budget: ALL PASS" : "\n❌ smoke-audit-budget: FAILURES");
process.exit(all ? 0 : 1);
