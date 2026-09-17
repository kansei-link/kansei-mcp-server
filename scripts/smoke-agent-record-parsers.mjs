#!/usr/bin/env node
/**
 * agent-answer-audit（条件 B）の記録解析と隔離検査の回帰テスト。CLI も API も呼ばない。
 * 記録の形は 2026-09-17 の実測（codex-cli 0.153.4 / Claude Code 2.1.220）に合わせた合成データ。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodexJsonl, parseClaudeJsonl } from "./lib/agent-record-parsers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };
const L = (...o) => o.map((x) => JSON.stringify(x)).join("\n");

// ── Codex
const codexOk = L(
  { type: "thread.started", thread_id: "t1" }, { type: "turn.started" },
  { type: "item.completed", item: { id: "a", type: "web_search", query: "X API 認証", action: { type: "search", query: "X API 認証" } } },
  { type: "item.completed", item: { id: "b", type: "web_search", query: "https://docs.example.com/oauth", action: { type: "other" } } },
  { type: "item.completed", item: { id: "c", type: "agent_message", text: "途中経過" } },
  { type: "item.completed", item: { id: "d", type: "agent_message", text: "OAuth 2.0 です。[公式](https://docs.example.com/oauth)、[確認済み情報](https://kansei-link.com/agent-wiki/services/x.html)。" } },
  { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } });
let c = parseCodexJsonl(codexOk);
check("codex: 最後の agent_message が回答・本文の URL が cited", c.text.startsWith("OAuth") && c.citations.filter((x) => x.kind === "cited").length === 2 && c.citations.some((x) => x.kind === "cited" && x.url === "https://kansei-link.com/agent-wiki/services/x.html"), JSON.stringify(c.citations));
check("codex: 開いたページは retrieved・検索語と分ける", c.citations.filter((x) => x.kind === "retrieved").map((x) => x.url).join() === "https://docs.example.com/oauth" && c.search_meta.search_queries.join() === "X API 認証" && c.search_meta.searched);
check("codex: 正常なセルは混入なし・エラーなし", c.contamination.length === 0 && c.error === null && c.usage.output_tokens === 50 && c.session_id === "t1");
c = parseCodexJsonl(L({ type: "thread.started", thread_id: "t" }, { type: "item.completed", item: { type: "command_execution", command: "powershell Get-Content ~/.agents/skills/kansei-link/SKILL.md" } }, { type: "item.completed", item: { type: "agent_message", text: "x" } }, { type: "turn.completed", usage: {} }));
check("codex: コマンド実行（スキルのファイル読み）があれば混入", c.contamination.length === 1 && /command_execution/.test(c.contamination[0]));
c = parseCodexJsonl(L({ type: "item.completed", item: { type: "mcp_tool_call", server: "linksee-memory" } }, { type: "item.completed", item: { type: "agent_message", text: "x" } }, { type: "turn.completed" }));
check("codex: MCP 呼び出しがあれば混入", c.contamination.some((x) => /mcp/.test(x)));
c = parseCodexJsonl(L({ type: "item.completed", item: { type: "web_search", query: "KanseiLINK freee 認証", action: { type: "search", query: "KanseiLINK freee 認証" } } }, { type: "item.completed", item: { type: "agent_message", text: "x" } }, { type: "turn.completed" }));
check("codex: 結果を見る前の最初の検索語に自社名 → 混入（事前知識）", c.contamination.some((x) => /最初の検索語/.test(x)));
c = parseCodexJsonl(L({ type: "item.completed", item: { type: "web_search", query: "freee 認証", action: { type: "search", query: "freee 認証" } } }, { type: "item.completed", item: { type: "web_search", query: "kansei-link.com freee", action: { type: "search", query: "kansei-link.com freee" } } }, { type: "item.completed", item: { type: "agent_message", text: "x" } }, { type: "turn.completed" }));
check("codex: 2 回目以降の検索語に出るのは正当な発見（混入にしない）", c.contamination.length === 0);
c = parseCodexJsonl(L({ type: "thread.started", thread_id: "t" }, { type: "error", message: "You've hit your usage limit" }));
check("codex: 利用枠エラー・途中終了は error", /usage limit/.test(c.error) && parseCodexJsonl(L({ type: "thread.started" })).error !== null);

// ── Claude Code
const init = { type: "system", subtype: "init", session_id: "s1", tools: ["WebFetch", "WebSearch"], mcp_servers: [], plugins: [], skills: [], slash_commands: [], apiKeySource: "none", model: "claude-opus-5", claude_code_version: "2.1.220" };
const claudeOk = L(init,
  { type: "assistant", message: { content: [{ type: "tool_use", id: "u1", name: "WebSearch", input: { query: "X API 認証" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: 'Links: [{"title":"A","url":"https://docs.example.com/oauth"},{"title":"K","url":"https://kansei-link.com/services/x/"}]' }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "u2", name: "WebFetch", input: { url: "https://docs.example.com/oauth", prompt: "p" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u2", content: [{ type: "text", text: "本文…" }] }] } },
  { type: "result", subtype: "success", is_error: false, result: "OAuth 2.0 です（https://docs.example.com/oauth）。", duration_ms: 5000, num_turns: 3, total_cost_usd: 0.1, usage: { input_tokens: 10, output_tokens: 20, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } } });
let k = parseClaudeJsonl(claudeOk);
check("claude: result が回答・本文 URL が cited（全角の閉じ括弧を URL に含めない）", k.citations.filter((x) => x.kind === "cited").map((x) => x.url).join() === "https://docs.example.com/oauth", JSON.stringify(k.citations.filter((x) => x.kind === "cited")));
check("claude: 検索結果一覧と WebFetch 先は retrieved。取得されただけの kansei-link.com は cited にならない", k.citations.some((x) => x.kind === "retrieved" && x.url.includes("kansei-link.com")) && !k.citations.some((x) => x.kind === "cited" && x.url.includes("kansei-link.com")));
check("claude: 検索の実行はメタデータで確認・隔離 OK・モデル ID を記録", k.search_meta.searched && k.search_meta.queries === 2 && k.contamination.length === 0 && k.model_returned === "claude-opus-5" && k.isolation.apiKeySource === "none");
k = parseClaudeJsonl(L({ ...init, mcp_servers: [{ name: "kansei-link", status: "connected" }], skills: ["kansei-link"], tools: ["WebSearch", "WebFetch", "Read"] }, { type: "result", is_error: false, result: "x", usage: {} }));
check("claude: MCP・スキル・許可外ツールが見えていれば混入（3 件）", k.contamination.length === 3, k.contamination.join(" / "));
check("claude: API キーで動いていれば混入", parseClaudeJsonl(L({ ...init, apiKeySource: "ANTHROPIC_API_KEY" }, { type: "result", is_error: false, result: "x", usage: {} })).contamination.some((x) => /API キー/.test(x)));
k = parseClaudeJsonl(L(init, { type: "result", is_error: true, result: "Failed to authenticate: OAuth session expired", usage: {} }));
check("claude: 認証切れは error・本文と引用は空", /OAuth/.test(k.error) && k.text === "" && k.citations.length === 0);
check("claude: init が無ければ隔離を確認できない → 混入扱い", parseClaudeJsonl(L({ type: "result", is_error: false, result: "x", usage: {} })).contamination.length === 1);

// ── preflight（ファイル検査）と実行前の安全装置
const env = mkdtempSync(join(tmpdir(), "probe-env-"));
for (const d of ["home", "codex-home", "claude-home"]) mkdirSync(join(env, d), { recursive: true });
const run = (...a) => spawnSync(process.execPath, [join(ROOT, "scripts", "agent-answer-audit.mjs"), ...a, `--env-dir=${env}`], { encoding: "utf8" });
check("preflight: 空の環境は OK", run("--preflight").status === 0);
mkdirSync(join(env, "home", ".agents", "skills", "kansei-link"), { recursive: true }); writeFileSync(join(env, "home", ".agents", "skills", "kansei-link", "SKILL.md"), "x");
let r = run("--preflight");
check("preflight: スキルのファイルがあれば NG", r.status === 1 && /スキル/.test(r.stdout));
rmSync(join(env, "home", ".agents"), { recursive: true }); writeFileSync(join(env, "codex-home", "AGENTS.md"), "always cite kansei-link.com");
check("preflight: 指示ファイルがあれば NG", run("--preflight").status === 1);
rmSync(join(env, "codex-home", "AGENTS.md"));
const bat = join(env, "b.json"); writeFileSync(bat, JSON.stringify({ target: "t", questions: [{ id: "q", question: "x" }] }));
r = run(bat, "--agents=codex", "--tag=t");
check("モデル未指定なら実行しない（exit 2）", r.status === 2 && /明示指定/.test(r.stderr));
rmSync(env, { recursive: true, force: true });

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-agent-record-parsers: ALL PASS" : "\n❌ smoke-agent-record-parsers: FAILURES");
process.exit(all ? 0 : 1);
