#!/usr/bin/env node
/**
 * agent-answer-audit の「途中停止からの再開」と「スキル退避の異常終了からの復旧」の回帰テスト。
 * 偽の CLI（PROBE_STUB_CLI）と偽のホスト側ホーム（PROBE_HOST_HOME）を使う。利用枠も本物の ~/.agents/skills も触らない。
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

const T = mkdtempSync(join(tmpdir(), "probe-resume-"));
const env = join(T, "env"); for (const d of ["home", "codex-home", "claude-home"]) mkdirSync(join(env, d), { recursive: true });
const host = join(T, "host"); mkdirSync(join(host, ".agents", "skills", "some-skill"), { recursive: true }); writeFileSync(join(host, ".agents", "skills", "some-skill", "SKILL.md"), "x");
const ctl = join(T, "control.json"); // { fail: ["質問文の一部"], hang: bool }
const stub = join(T, "stub.mjs");
writeFileSync(stub, `import { readFileSync } from "node:fs";
const agent = process.argv[2]; if (process.argv.includes("--version")) { console.log("stub 0.0.0"); process.exit(0); } let q = ""; for await (const c of process.stdin) q += c;
const ctl = JSON.parse(readFileSync(${JSON.stringify(ctl)}, "utf8"));
if (ctl.hang) await new Promise((r) => setTimeout(r, 60000));
if ((ctl.fail ?? []).some((f) => q.includes(f))) { console.log(JSON.stringify(agent === "codex" ? { type: "error", message: "You've hit your usage limit" } : { type: "result", is_error: true, result: "usage limit", usage: {} })); process.exit(1); }
const L = agent === "codex"
  ? [{ type: "thread.started", thread_id: "t" }, { type: "item.completed", item: { type: "web_search", query: "x", action: { type: "search", query: "x" } } }, { type: "item.completed", item: { type: "agent_message", text: "答え https://example.com/a" } }, { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }]
  : [{ type: "system", subtype: "init", session_id: "s", tools: ["WebSearch", "WebFetch"], mcp_servers: [], plugins: [], skills: [], apiKeySource: "none", model: "m" }, { type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "x" } }] } }, { type: "result", is_error: false, result: "答え https://example.com/a", usage: {} }];
console.log(L.map((x) => JSON.stringify(x)).join("\\n"));
`);
const bat = join(T, "b.json"); writeFileSync(bat, JSON.stringify({ target: "t", questions: [{ id: "q1", question: "ひとつめ" }, { id: "q2", question: "ふたつめ" }, { id: "q3", question: "みっつめ" }] }));
const base = [join(ROOT, "scripts", "agent-answer-audit.mjs"), bat, `--env-dir=${env}`, "--codex-model=cm", "--claude-model=am", "--park-host-skills", "--tag=t", `--out-dir=${T}`];
const childEnvVars = { ...process.env, PROBE_STUB_CLI: stub, PROBE_HOST_HOME: host };
const run = (...extra) => spawnSync(process.execPath, [...base, ...extra], { encoding: "utf8", env: childEnvVars });
const load = () => JSON.parse(readFileSync(join(T, "agent-runs-t", "results.json"), "utf8"));
const skillsOk = () => existsSync(join(host, ".agents", "skills", "some-skill", "SKILL.md")) && !existsSync(join(host, ".agents", "skills.parked-by-probe"));

// 1. 途中で失敗するセルがある回
writeFileSync(ctl, JSON.stringify({ fail: ["ふたつめ"] }));
let r = run();
let out = load();
check("1a. 失敗セルがあっても有効回答は保存され、complete=false", r.status === 0 && out.complete === false && !out.results[0].answers.codex.error && out.results[1].answers.codex.invalid_kind === "infra" && !out.results[2].answers.claude.error, r.stderr.slice(0, 200));
check("1b. 終了後にホスト側スキルが戻っている", skillsOk());
const askedAtQ1 = out.results[0].answers.codex.asked_at;

// 2. 再開
check("2a. --resume なしで同じ tag は拒否（上書きしない）", run().status === 2);
check("2b. 条件（モデル）が違う --resume は拒否", spawnSync(process.execPath, [...base.map((a) => (a === "--codex-model=cm" ? "--codex-model=other" : a)), "--resume"], { encoding: "utf8", env: childEnvVars }).status === 2);
writeFileSync(ctl, JSON.stringify({ fail: [] }));
r = run("--resume"); out = load();
check("2c. --resume は失敗セルだけ引き直す（2 セル）・有効セルは引き直さない・complete=true", /今回実行 2 セル/.test(r.stdout) && out.complete === true && out.results[0].answers.codex.asked_at === askedAtQ1 && out.runs.length === 2, (r.stdout.match(/今回実行.*/) || [""])[0]);
check("2d. 失敗した回の生記録も残る（retry ファイルが別名）", readdirSync(join(T, "agent-runs-t", "raw")).some((f) => /q2\.codex\.retry-/.test(f)) && existsSync(join(T, "agent-runs-t", "raw", "q2.codex.jsonl")));
r = run("--resume");
check("2e. 完了済みの回に --resume しても何も実行しない", /今回実行 0 セル/.test(r.stdout));

// 3. 3 セル連続の基盤側失敗で停止 → 再開
rmSync(join(T, "agent-runs-t"), { recursive: true });
writeFileSync(ctl, JSON.stringify({ fail: ["ひとつめ", "ふたつめ", "みっつめ"] }));
r = run("--agents=codex"); out = load();
check("3. 3 セル連続失敗で停止し、理由を記録。スキルは戻る", out.stopped?.agent === "codex" && out.complete === false && skillsOk());

// 4. 異常終了（プロセスを強制終了＝終了処理が走らない）→ 次回起動で復旧
rmSync(join(T, "agent-runs-t"), { recursive: true });
writeFileSync(ctl, JSON.stringify({ hang: true }));
const child = spawn(process.execPath, [...base, "--agents=codex"], { env: childEnvVars, stdio: "ignore" });
await new Promise((res) => { const t = setInterval(() => { if (existsSync(join(host, ".agents", "skills.parked-by-probe"))) { clearInterval(t); res(); } }, 100); setTimeout(() => { clearInterval(t); res(); }, 15000); });
const parkedDuringRun = existsSync(join(host, ".agents", "skills.parked-by-probe")) && !existsSync(join(host, ".agents", "skills"));
child.kill("SIGKILL"); await new Promise((res) => child.on("close", res));
check("4a. 実行中は退避されている。強制終了すると退避されたまま残る（＝復旧が必要な状態を再現）", parkedDuringRun && existsSync(join(host, ".agents", "skills.parked-by-probe")));
writeFileSync(ctl, JSON.stringify({ fail: [] }));
r = run("--agents=claude"); // Codex を含まない実行でも、起動時にまず戻す
check("4b. 次の起動（Codex を含まない実行でも）で最初に元へ戻す", /ホスト側スキルを戻した/.test(r.stdout) && skillsOk(), r.stdout.split("\n").find((l) => /戻した/.test(l)) ?? "");
r = spawnSync(process.execPath, [join(ROOT, "scripts", "agent-answer-audit.mjs"), "--restore-host-skills", `--env-dir=${env}`], { encoding: "utf8", env: childEnvVars });
check("4c. 復旧だけを行う --restore-host-skills が使える（戻すものが無ければ何もしない）", r.status === 0 && skillsOk(), r.stdout.trim().slice(0, 120));

rmSync(T, { recursive: true, force: true });
const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-agent-audit-resume: ALL PASS" : "\n❌ smoke-agent-audit-resume: FAILURES");
process.exit(all ? 0 : 1);
