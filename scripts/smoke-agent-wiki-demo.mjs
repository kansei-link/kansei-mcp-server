#!/usr/bin/env node
/**
 * agent-wiki-demo（Wiki の URL を渡す／渡さないデモ）の回帰テスト。
 * 偽の CLI（PROBE_STUB_CLI）と偽のホスト側ホーム（PROBE_HOST_HOME）を使う。利用枠も本物の ~/.agents/skills も触らない。
 * 検査:
 *   1. --dry-run は実行器を呼ばず、5 タスク × 2 群 × 回数の順番を出す（ABBA）
 *   2. Wiki あり: 渡した URL を最初に開いても無効にしない（免除を記録）・Wiki を開いた記録・自動判定・時間/token/検索回数
 *   3. Wiki なし: 最初の検索に自社関連語 → 無効（免除しない）
 *   4. 許可外ツールは Wiki ありでも無効
 *   5. 定点測定との分離: 出力先が AgentWiki-Probe_* / agent-runs-* なら停止。結果は results[] を持たない（score-probe.cjs は読めない）
 *   6. --resume: 有効・無効のセッションは引き直さず、基盤側の失敗だけ引き直す。失敗した回の記録は残す
 *   7. Codex: ホスト側スキルの退避と復旧（実行器の機能をそのまま使う）
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

const T = mkdtempSync(join(tmpdir(), "wiki-demo-"));
const KEEP = process.argv.includes("--keep"); // 記録例を取り出すときだけ作業フォルダを残す
const env = join(T, "env"); for (const d of ["home", "codex-home", "claude-home"]) mkdirSync(join(env, d), { recursive: true });
const host = join(T, "host"); mkdirSync(join(host, ".agents", "skills", "some-skill"), { recursive: true }); writeFileSync(join(host, ".agents", "skills", "some-skill", "SKILL.md"), "x");
const ctl = join(T, "control.json");
const stub = join(T, "stub.mjs");
writeFileSync(stub, `import { readFileSync } from "node:fs";
const agent = process.argv[2]; if (process.argv.includes("--version")) { console.log("stub 0.0.0"); process.exit(0); }
let q = ""; for await (const c of process.stdin) q += c;
const ctl = JSON.parse(readFileSync(${JSON.stringify(ctl)}, "utf8"));
const wiki = (q.match(/https:\\/\\/kansei-link\\.com\\/agent-wiki\\/services\\/[a-z0-9-]+\\.html/) || [])[0];
if (ctl.fail) { console.log(JSON.stringify(agent === "codex" ? { type: "error", message: "usage limit" } : { type: "result", is_error: true, result: "usage limit", usage: {} })); process.exit(1); }
const found = "https://kansei-link.com/agent-wiki/services/square.html"; // Wiki なし群が検索で見つける（crossover）／最初から開く（事前知識）
const answer = "認証は OAuth 2.0。公式MCP: https://mcp.squareup.com/sse 。ドキュメント https://developer.squareup.com/docs\\n\`\`\`json\\n{\\"mcpServers\\":{\\"square\\":{\\"url\\":\\"https://mcp.squareup.com/sse\\"}}}\\n\`\`\`" + (wiki ? " 参考 " + wiki : !wiki && ctl.crossover ? " 参考 " + found : "");
const firstQuery = ctl.contaminate ? "kansei-link square mcp" : "Square MCP server";
if (agent === "codex") {
  const L = [{ type: "thread.started", thread_id: "t" }];
  if (wiki) L.push({ type: "item.completed", item: { type: "web_search", action: { type: "open_page", url: wiki } } });
  L.push({ type: "item.completed", item: { type: "web_search", action: { type: "search", query: firstQuery, queries: [firstQuery] } } });
  if (!wiki && ctl.crossover) L.push({ type: "item.completed", item: { type: "web_search", action: { type: "open_page", url: found } } });
  L.push({ type: "item.completed", item: { type: "web_search", action: { type: "open_page", url: "https://developer.squareup.com/docs/mcp" } } });
  L.push({ type: "item.completed", item: { type: "agent_message", text: answer } }, { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 50 } });
  console.log(L.map((x) => JSON.stringify(x)).join("\\n"));
} else {
  const uses = [];
  if (wiki) uses.push({ type: "tool_use", name: "WebFetch", input: { url: wiki, prompt: "read" } });
  if (!wiki && ctl.directWiki) uses.push({ type: "tool_use", name: "WebFetch", input: { url: found, prompt: "read" } });
  uses.push({ type: "tool_use", name: "WebSearch", input: { query: firstQuery } });
  if (!wiki && ctl.crossover) uses.push({ type: "tool_use", name: "WebFetch", input: { url: found, prompt: "read" } });
  uses.push({ type: "tool_use", name: "WebFetch", input: { url: "https://developer.squareup.com/docs/mcp", prompt: "read" } });
  if (ctl.badTool) uses.push({ type: "tool_use", name: "Bash", input: { command: "ls" } });
  const L = [{ type: "system", subtype: "init", session_id: "s", tools: ["WebSearch", "WebFetch"], mcp_servers: [], plugins: [], skills: [], apiKeySource: "none", model: "claude-opus-5" },
    ...uses.map((u) => ({ type: "assistant", message: { content: [u] } })),
    { type: "result", is_error: false, result: answer, duration_ms: 1234, num_turns: 4, usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 970, output_tokens: 60 } }];
  console.log(L.map((x) => JSON.stringify(x)).join("\\n"));
}
`);
const tasksFile = join(T, "tasks.json");
// 実際の tasks.json は読まない: 基準値が公開ページの訂正で変わる（2026-09-18 に square が /sse → /mcp）と、偽の CLI の固定回答とずれてテストが落ちる。テストは固定データだけを使う
const tasks = null;
writeFileSync(tasksFile, JSON.stringify(tasks ?? { record_type: "agent_wiki_demo_tasks", common_instruction: "公式情報を優先する", wiki_hint: "参考資料: {url}", tasks: [{ id: "square", service_id: "square", wiki_url: "https://kansei-link.com/agent-wiki/services/square.html", prompt: "Square の接続準備", wiki_confirmed: [{ field: "公開MCP", value: "https://mcp.squareup.com/sse" }], checks: [{ id: "auth", label: "OAuth", type: "regex", pattern: "OAuth" }, { id: "mcp_url", label: "mcp", type: "url", host: "mcp.squareup.com", path_prefix: "/sse" }, { id: "config", label: "config", type: "config_block", contains: "mcp.squareup.com" }] }] }));
const demoOut = join(T, "AgentWiki-Demo");
const childEnv = { ...process.env, PROBE_STUB_CLI: stub, PROBE_HOST_HOME: host };
const run = (extra) => spawnSync(process.execPath, [join(ROOT, "scripts", "agent-wiki-demo.mjs"), tasksFile, `--env-dir=${env}`, ...extra], { encoding: "utf8", env: childEnv });
const load = (tag) => JSON.parse(readFileSync(join(demoOut, `demo-runs-${tag}`, "demo-results.json"), "utf8"));
const setCtl = (c) => writeFileSync(ctl, JSON.stringify(c));

// 1. dry-run
setCtl({});
let r = run(["--agent=claude", "--model=m", "--reps=3", "--tag=dry", `--out-dir=${demoOut}`, "--dry-run"]);
const nTasks = (tasks ?? { tasks: [1] }).tasks.length;
const lines = r.stdout.split("\n").filter((l) => /^\s+\d+\. r\d-/.test(l));
check("1. dry-run: 実行器を呼ばず、タスク × 2 群 × 3 回の順番を出す", r.status === 0 && lines.length === nTasks * 2 * 3 && !existsSync(join(demoOut, "demo-runs-dry")), `${lines.length} 行`);
check("1b. 順番は繰り返しごとに先後が入れ替わる（ABBA）", /r1-square-(with|without)_wiki/.test(lines[0]) && lines[0].includes(lines[0].includes("without") ? "without" : "with_wiki") && (lines[0].includes("without") !== lines[nTasks * 2].includes("without")), `${lines[0].trim()} / ${lines[nTasks * 2]?.trim()}`);

// 2. Wiki あり／なし（claude）
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=c1", `--out-dir=${demoOut}`]);
let D = load("c1");
const w = D.sessions.find((s) => s.arm === "with_wiki"); const wo = D.sessions.find((s) => s.arm === "without_wiki");
check("2a. 2 セッション・record_type=agent_wiki_demo・results[] を持たない", r.status === 0 && D.sessions.length === 2 && D.record_type === "agent_wiki_demo" && !("results" in D), r.stderr.slice(-200));
check("2b. Wiki あり: 渡した URL を最初に開いても有効・免除を記録", w.status === "ok" && w.contamination_waived.length === 1 && /自社関連語/.test(w.contamination_waived[0]), JSON.stringify([w.status, w.error, w.contamination_waived]));
check("2c. Wiki あり: Wiki を開いた記録（渡したページ）・回答に確認済み値", w.wiki.opened_given_page && w.wiki.opened.length === 1 && w.wiki.confirmed_values_in_answer.find((f) => f.field === "公開MCP").appears);
check("2d. 自動判定・時間・token・検索回数・開いたページ数", w.outcome.auto_pass === true && w.outcome.auto_checks.every((c) => c.pass) && w.cost.wall_ms > 0 && w.cost.input_tokens === 1000 && w.cost.output_tokens === 60 && w.tool_use.web_searches === 1 && w.tool_use.pages_opened === 2 && w.outcome.judge.success === null, JSON.stringify([w.cost, w.tool_use.web_searches, w.tool_use.pages_opened]));
check("2e. Wiki なし: 有効・Wiki は開いていない・プロンプトに URL なし", wo.status === "ok" && wo.wiki.opened.length === 0 && wo.wiki_url_given === null && wo.contamination_waived.length === 0 && w.prompt_sha256 !== wo.prompt_sha256);
check("2f. 集計: 群ごとの有効数・自動判定・Wiki を開いた数", D.summary.find((x) => x.arm === "with_wiki" && x.task_id === "square").wiki_opened === 1 && D.summary.find((x) => x.arm === "without_wiki" && x.task_id === "square").wiki_not_used === 1);
const qOf = (tag, sid) => JSON.parse(readFileSync(join(demoOut, `demo-runs-${tag}`, "_sessions", sid, "battery.json"), "utf8")).questions[0].question;
const qWith = qOf("c1", "r1-square-with_wiki"); const qWithout = qOf("c1", "r1-square-without_wiki");
const T0 = tasks ?? JSON.parse(readFileSync(tasksFile, "utf8"));
check("2g. 群の差は Wiki の URL の 1 行だけ（公式を優先する指示は両群に共通）", qWith === `${qWithout}\n\n参考資料: https://kansei-link.com/agent-wiki/services/square.html` && qWithout.includes(T0.common_instruction) && !/kansei|agent-wiki/i.test(qWithout), JSON.stringify(qWith.slice(qWithout.length)));

// 2h. Wiki なし群が検索を経て Agent Wiki を自然発見 → 無効にせず crossover として別記録・主な数字から外す
setCtl({ crossover: true });
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=cx", `--out-dir=${demoOut}`]);
D = load("cx");
const cx = D.sessions.find((s) => s.arm === "without_wiki"); const rowX = D.summary.find((x) => x.arm === "without_wiki");
check("2h. crossover: Wiki なしで自然発見しても有効・crossover に開いた／引用した URL・検索語", cx.status === "ok" && cx.crossover && cx.crossover.opened.length === 1 && cx.crossover.cited.length === 1 && cx.crossover.search_queries[0] === "Square MCP server" && D.sessions.find((s) => s.arm === "with_wiki").crossover === null, JSON.stringify(cx.crossover));
check("2i. crossover は集計の主な数字（valid）から外し、件数と一覧を別に出す", rowX.valid === 0 && rowX.crossover === 1 && D.crossovers.length === 1 && D.crossovers[0].session_id === cx.session_id, JSON.stringify(rowX));
setCtl({ directWiki: true });
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=cd", `--out-dir=${demoOut}`]);
D = load("cd");
check("2j. Wiki なしで最初の呼び出しから Wiki を開く（事前知識）は crossover ではなく無効", D.sessions.find((s) => s.arm === "without_wiki").status === "invalid_contamination" && D.crossovers.length === 0);
setCtl({ crossover: true });
r = run(["--agent=codex", "--model=gpt-x", "--reps=1", "--tasks=square", "--tag=cxc", `--out-dir=${demoOut}`, "--park-host-skills"]);
D = load("cxc");
check("2k. Codex でも crossover を記録", D.sessions.find((s) => s.arm === "without_wiki").crossover?.opened.length === 1 && D.crossovers.length === 1, JSON.stringify(D.sessions.map((s) => [s.arm, s.status, s.error])));

// 3. Wiki なしで最初の検索に自社関連語 → 無効（免除しない）。Wiki ありは免除
setCtl({ contaminate: true });
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=c2", `--out-dir=${demoOut}`]);
D = load("c2");
check("3. 最初の検索に自社関連語: Wiki なしは無効・Wiki ありは有効（免除）", D.sessions.find((s) => s.arm === "without_wiki").status === "invalid_contamination" && D.sessions.find((s) => s.arm === "with_wiki").status === "ok");

// 4. 許可外ツールは Wiki ありでも無効
setCtl({ badTool: true });
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=c3", `--out-dir=${demoOut}`]);
D = load("c3");
check("4. 許可外ツール（Bash）は両群とも無効", D.sessions.every((s) => s.status === "invalid_contamination" && /許可外/.test(s.error)), JSON.stringify(D.sessions.map((s) => [s.arm, s.status])));

// 5. 分離
setCtl({});
r = run(["--agent=claude", "--model=m", "--reps=1", "--tasks=square", "--tag=x", `--out-dir=${join(T, "research", "AgentWiki-Probe_2026-09-17")}`]);
const r2 = run(["--agent=claude", "--model=m", "--reps=1", "--tasks=square", "--tag=x", `--out-dir=${join(T, "agent-runs-B-post")}`]);
check("5a. 出力先が定点測定の領域なら停止", r.status === 2 && /定点測定/.test(r.stderr) && r2.status === 2);
const scorer = join(ROOT, "..", "founder-ops", "research", "AgentWiki-Probe_2026-09-17", "score-probe.cjs");
if (existsSync(scorer)) {
  const s = spawnSync(process.execPath, [scorer, join(demoOut, "demo-runs-c1", "demo-results.json"), "--no-waves"], { encoding: "utf8" });
  check("5b. score-probe.cjs はデモの結果を採点できずに止まる（被引用率に混ざらない）", s.status !== 0, (s.stderr || "").split("\n").find((l) => /Error/.test(l)) ?? "");
}

// 6. --resume
setCtl({ fail: true });
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=c4", `--out-dir=${demoOut}`]);
D = load("c4");
const infraFirst = D.sessions.every((s) => s.status === "infra_error");
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=c4", `--out-dir=${demoOut}`]);
check("6a. 結果がある回を --resume なしで再実行すると停止", infraFirst && r.status === 2 && /--resume/.test(r.stderr));
setCtl({});
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=c4", `--out-dir=${demoOut}`, "--resume"]);
D = load("c4");
const sessDirs = readdirSync(join(demoOut, "demo-runs-c4", "_sessions"));
check("6b. --resume: 基盤側の失敗だけ引き直し、失敗した回の記録は残す", D.complete && D.sessions.every((s) => s.status === "ok") && sessDirs.filter((d) => /\.failed-/.test(d)).length === 2 && D.runs.length === 2, sessDirs.join(","));
r = run(["--agent=claude", "--model=other", "--reps=1", "--tasks=square", "--tag=c4", `--out-dir=${demoOut}`, "--resume"]);
check("6c. --resume で条件（モデル）が違えば停止", r.status === 2 && /条件/.test(r.stderr));
setCtl({ contaminate: true });
const before = JSON.stringify(load("c2").sessions.map((s) => s.status));
r = run(["--agent=claude", "--model=claude-opus-5", "--reps=1", "--tasks=square", "--tag=c2", `--out-dir=${demoOut}`, "--resume"]);
check("6d. --resume: 混入で無効のセッションは引き直さない", JSON.stringify(load("c2").sessions.map((s) => s.status)) === before && /complete=true/.test(r.stdout));

// 7. Codex（ホスト側スキルの退避と復旧は実行器の機能）
setCtl({});
r = run(["--agent=codex", "--model=gpt-x", "--reps=1", "--tasks=square", "--tag=x1", `--out-dir=${demoOut}`]);
check("7a. Codex: ホスト側スキルが見えるのに --park-host-skills なし → 実行器が開始前に停止し、デモも止まる", r.status === 2 && load("x1").stopped && load("x1").sessions.length === 0);
r = run(["--agent=codex", "--model=gpt-x", "--reps=1", "--tasks=square", "--tag=x2", `--out-dir=${demoOut}`, "--park-host-skills"]);
D = load("x2");
const cw = D.sessions.find((s) => s.arm === "with_wiki");
check("7b. Codex: 有効・Wiki を開いた記録・token（入力 1000・キャッシュ 400）・スキルは元の場所に戻る", D.sessions.every((s) => s.status === "ok") && cw.wiki.opened_given_page && cw.cost.input_tokens === 1000 && cw.cost.cached_input_tokens === 400 && cw.tool_use.web_searches === 1 && cw.wiki.confirmed_values_in_answer.every((f) => f.appears) && existsSync(join(host, ".agents", "skills", "some-skill", "SKILL.md")) && !existsSync(join(host, ".agents", "skills.parked-by-probe")), JSON.stringify([cw.status, cw.error, cw.tool_use]));

if (KEEP) console.log(`\n  作業フォルダ（残した）: ${T}`); else rmSync(T, { recursive: true, force: true });
const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-agent-wiki-demo: ALL PASS" : "\n❌ smoke-agent-wiki-demo: FAILURES");
process.exit(all ? 0 : 1);
