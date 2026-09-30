#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth = natural_task (M-006): the natural-task reading judged from two closed traces.
 *
 *   npx tsx scripts/smoke-marker-natural-task.mts
 *
 * Part A: traces per configuration (lib/natural-task-rules.mjs) on responses shaped as the providers' docs
 *         describe (2026-09-29): OpenAI Responses (web_search_call actions, url_citation), Anthropic Messages
 *         (server tools, web_fetch errors, citations), Perplexity Agent API ([n] markers → results[].id),
 *         Claude Code stream-json (tool_use / tool_use_result, no citations); malformed shapes.
 * Part B: the artifact — extraction (fenced blocks, files, exactly one) and the two official forms (P2 / P3),
 *         credential slots, Basic / API-key names, package names never count.
 * Part C: the judgement table (exactly one of pass / false_completion / undetermined / instrument).
 * Part D: run-marker end to end in --dry-run with the M-993 fixture seal and the fake provider: rows,
 *         target.setup (reading.v1.1), privacy (URLs and artifacts only in environment.private.json),
 *         isolation failure and provider error as instrument rows, the sheet per configuration.
 * Part E: the callers' fixed settings (models, isolation flags) and the real M-006 taskpack's observers.
 * No network, no real seal, no DB, no CLI is started.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { tracesOpenAI, tracesAnthropic, tracesPerplexity, tracesClaudeCode, perplexityCitedIds, extractArtifact, judgeArtifact, judgeNaturalTask, OFFICIAL_FORMS, METHOD } from "../exec-harness/lib/natural-task-rules.mjs";
import { CONFIG_DEFAULTS, CLAUDE_CODE_ARGS, claudeCodeIsolation, collectWorkFiles } from "../exec-harness/lib/natural-task.mjs";
import { TARGETS } from "../exec-harness/lib/marker-targets.mjs";
import { renderSheet } from "../exec-harness/render-reading-sheet.mjs";
import { validateReading, loadReadingSchema } from "../exec-harness/lib/reading.mjs";
import { assertExclusive } from "../exec-harness/lib/llm-answer-rules.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FIX = join(ROOT, "exec-harness", "fixtures");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };
const spawnAsync = (cmd: string, args: string[], opts: any): Promise<{ status: number | null; out: string }> => new Promise((res) => { const p = spawn(cmd, args, opts); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ status: code, out })); });

const REPO = "https://github.com/fake-vendor/fake-official-mcp-server";
const KEY = "github.com/fake-vendor/fake-official-mcp-server";
const ok = (v: any, label: string) => (v.checks || []).find((c: any) => c.label === label)?.ok;

// ── Part A: traces ───────────────────────────────────────────────────────
{
  // OpenAI Responses
  const oa = (output: any[]) => tracesOpenAI({ output });
  const t1 = oa([
    { type: "web_search_call", status: "completed", action: { type: "search", query: "q", sources: [{ type: "url", url: "https://a.invalid/1" }, { type: "url", url: REPO }] } },
    { type: "web_search_call", status: "completed", action: { type: "open_page", url: `${REPO}/tree/main` } },
    { type: "web_search_call", status: "completed", action: { type: "open_page", url: null } },
    { type: "web_search_call", status: "completed", action: { type: "find_in_page", url: "https://a.invalid/1", pattern: "x" } },
    { type: "message", content: [{ type: "output_text", text: "answer", annotations: [{ type: "url_citation", url: `${REPO}?utm_source=chatgpt.com`, title: "t", start_index: 0, end_index: 1 }] }, { type: "output_text", text: "more", annotations: [] }] },
  ]);
  expect("A openai: candidates from action.search.sources", JSON.stringify(t1.candidates) === JSON.stringify(["https://a.invalid/1", REPO]));
  expect("A openai: fetched from open_page (null url kept as a request without url) and find_in_page", t1.fetched.length === 3 && t1.fetched[0].url === `${REPO}/tree/main` && t1.fetched[1].url === null && t1.fetched[2].url === "https://a.invalid/1");
  expect("A openai: cited from url_citation annotations of every output_text; text concatenated", JSON.stringify(t1.cited) === JSON.stringify([`${REPO}?utm_source=chatgpt.com`]) && t1.text === "answer\nmore" && t1.tools_used);
  expect("A openai: sources absent (no include) → no candidates, still readable", oa([{ type: "web_search_call", status: "completed" }]).candidates.length === 0 && oa([{ type: "web_search_call" }]).tools_used && oa([{ type: "web_search_call" }]).fetched_readable);
  expect("A openai: no tool call → tools_used false, shape ok", !oa([{ type: "message", content: [{ type: "output_text", text: "x" }] }]).tools_used && oa([]).shape_ok);
  expect("A openai: no output array → shape not ok", !tracesOpenAI({}).shape_ok && !tracesOpenAI(null).shape_ok && !tracesOpenAI({ output: "x" }).shape_ok);
  expect("A openai: a URL inside the answer text is never a trace", oa([{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: `see ${REPO}` }] }]).cited.length === 0);
  // Anthropic Messages
  const an = (content: any[]) => tracesAnthropic({ content });
  const t2 = an([
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: REPO, title: "t", encrypted_content: "e" }, { type: "web_search_result", url: "https://b.invalid/2" }] },
    { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: `${REPO}/blob/main/README.md` } },
    { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: `${REPO}/blob/main/README.md`, retrieved_at: "2026-09-30T00:00:00Z", content: { type: "document", source: {} } } },
    { type: "server_tool_use", id: "f2", name: "web_fetch", input: { url: "https://b.invalid/2" } },
    { type: "web_fetch_tool_result", tool_use_id: "f2", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
    { type: "text", text: "answer", citations: [{ type: "web_search_result_location", url: REPO, title: "t", cited_text: "c" }, { type: "char_location", document_index: 0 }] },
  ]);
  expect("A anthropic: candidates from web_search_tool_result", JSON.stringify(t2.candidates) === JSON.stringify([REPO, "https://b.invalid/2"]));
  expect("A anthropic: fetched = requests; success from web_fetch_result, failure from the error block (url from the request)", t2.fetched.length === 2 && t2.fetched[0].ok && t2.fetched[0].url === `${REPO}/blob/main/README.md` && !t2.fetched[1].ok && t2.fetched[1].url === "https://b.invalid/2");
  expect("A anthropic: cited from web_search_result_location only (char_location has no url)", JSON.stringify(t2.cited) === JSON.stringify([REPO]) && t2.text === "answer");
  expect("A anthropic: a failed search (content is an error object) leaves no candidates", an([{ type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }]).candidates.length === 0);
  expect("A anthropic: array of blocks accepted; no content → shape not ok", tracesAnthropic([{ type: "text", text: "x" }]).shape_ok && !tracesAnthropic({}).shape_ok && !tracesAnthropic("x").shape_ok);
  // Perplexity Agent API
  const pp = (output: any[]) => tracesPerplexity({ output });
  const t3 = pp([
    { type: "search_results", queries: ["q"], results: [{ id: 1, url: "https://c.invalid/1", title: "a" }, { id: 2, url: REPO, title: "b" }, { id: 3, url: "https://c.invalid/3" }] },
    { type: "fetch_url_results", contents: [{ url: REPO, title: "t", snippet: "text" }, { url: "https://c.invalid/9", title: "", snippet: "no_result_returned" }] },
    { type: "message", content: [{ type: "output_text", text: "Answer [2][3] and [7] and [web:1] and [02]." }] },
  ]);
  expect("A perplexity: candidates from search_results.results", t3.candidates.length === 3 && t3.candidates[1] === REPO);
  expect("A perplexity: fetched from fetch_url_results (no_result_returned = not ok)", t3.fetched.length === 2 && t3.fetched[0].ok && !t3.fetched[1].ok);
  expect("A perplexity: cited = [digits] markers → results ids within the list ([7] out of range and [web:1] ignored; [02] = id 2 once)", JSON.stringify(t3.cited) === JSON.stringify([REPO, "https://c.invalid/3"]), JSON.stringify(t3.cited));
  expect("A perplexity: perplexityCitedIds keeps only [digits]", JSON.stringify(perplexityCitedIds("x [1] [12] [web:3] [a] [4]")) === JSON.stringify(["1", "12", "4"]));
  expect("A perplexity: a repo URL in the answer text without a marker is never a trace", pp([{ type: "search_results", results: [] }, { type: "message", content: [{ type: "output_text", text: REPO }] }]).cited.length === 0);
  expect("A perplexity: shape", !tracesPerplexity({}).shape_ok && pp([]).shape_ok && !pp([]).tools_used);
  // Claude Code stream-json
  const cc = (events: any[]) => tracesClaudeCode(events);
  const init = { type: "system", subtype: "init", tools: ["WebSearch", "WebFetch", "Write"], mcp_servers: [], plugins: [] };
  const t4 = cc([
    init,
    { type: "assistant", message: { content: [{ type: "tool_use", id: "s1", name: "WebSearch", input: { query: "q" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1", content: "…" }] }, tool_use_result: { query: "q", results: [{ tool_use_id: "x", content: [{ title: "t", url: REPO }, { title: "u", url: "https://d.invalid/1" }] }, "a string entry"], durationSeconds: 1 } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "f1", name: "WebFetch", input: { url: `${REPO}#readme`, prompt: "p" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f1", content: "…" }] }, tool_use_result: { bytes: 5000, code: 200, codeText: "OK", result: "summary", durationMs: 10, url: `${REPO}#readme` } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "f2", name: "WebFetch", input: { url: "https://d.invalid/1", prompt: "p" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f2", content: "error", is_error: true }] }, tool_use_result: { bytes: 0, code: 404, codeText: "Not Found", result: "", durationMs: 10, url: "https://d.invalid/1" } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "f3", name: "WebFetch", input: { url: "https://d.invalid/never-answered", prompt: "p" } }] } },
    { type: "result", subtype: "success", result: `final text ${REPO}`, total_cost_usd: 0.1 },
  ]);
  expect("A claude-code: candidates from WebSearch tool_use_result.results[].content[].url (string entries skipped)", JSON.stringify(t4.candidates) === JSON.stringify([REPO, "https://d.invalid/1"]));
  expect("A claude-code: fetched = WebFetch requests; ok from code 2xx and bytes > 0; a request without a result is a request", t4.fetched.length === 3 && t4.fetched[0].ok && t4.fetched[0].url === `${REPO}#readme` && !t4.fetched[1].ok && t4.fetched[2].url === "https://d.invalid/never-answered" && !t4.fetched[2].ok);
  expect("A claude-code: no structured citations (cited_readable=false); the result text is never scanned", !t4.cited_readable && t4.cited.length === 0 && t4.text.startsWith("final text"));
  expect("A claude-code: missing init or result → shape not ok", !cc([{ type: "result", result: "x" }]).shape_ok && !cc([init]).shape_ok && !tracesClaudeCode({} as any).shape_ok);
}

// ── Part B: the artifact ─────────────────────────────────────────────────
{
  const P2 = { mcpServers: { AgileWorks: { command: "C:\\nvm4w\\nodejs\\node", args: ["C:\\temp\\agileworks-mcp-server\\aw-app\\dist\\custom\\admin\\server.js"], env: { SYSTEM_URL: "https://sample.co.jp/AgileWorks", ACCESS_TOKEN: "abc" } } } };
  const P3 = { mcpServers: { AgileWorks: { command: "npx", args: ["-y", "mcp-remote", "https://sample.co.jp/mcp", "--header", "x-system-url: https://example.com/AgileWorks", "--header", "x-access-token: abc"] } } };
  const P3q = { mcpServers: { AgileWorks: { command: "npx", args: ["-y", "mcp-remote", "https://sample.co.jp/mcp?x-system-url=https://e.com/AgileWorks&x-access-token=abc"] } } };
  const fence = (o: any, lang = "json") => `text\n\`\`\`${lang}\n${JSON.stringify(o, null, 2)}\n\`\`\`\ntext`;
  expect("B extract: one fenced json block with mcpServers → one", extractArtifact({ text: fence(P2) }).state === "one");
  expect("B extract: fence without a language tag → one", extractArtifact({ text: fence(P2, "") }).state === "one");
  expect("B extract: no block → none; block without mcpServers → none; JSONC / trailing comma → none", extractArtifact({ text: "no config" }).state === "none" && extractArtifact({ text: fence({ servers: {} }) }).state === "none" && extractArtifact({ text: "```json\n{ \"mcpServers\": { /* c */ } }\n```" }).state === "none" && extractArtifact({ text: "```json\n{ \"mcpServers\": {}, }\n```" }).state === "none");
  expect("B extract: the same artifact in a file and a block → one; two different → many", extractArtifact({ text: fence(P2), files: [{ name: "claude_desktop_config.json", content: JSON.stringify(P2) }] }).state === "one" && extractArtifact({ text: fence(P2), files: [{ name: "x.json", content: JSON.stringify(P3) }] }).state === "many");
  expect("B extract: file source named", extractArtifact({ files: [{ name: "c.json", content: JSON.stringify(P3) }] }).sources[0] === "file:c.json");
  const j = (o: any) => judgeArtifact(o);
  expect("B judge P2: official + auth correct", j(P2).points_official && j(P2).form === "P2" && j(P2).auth_correct && !j(P2).wrong_auth_field);
  expect("B judge P2: forward slashes and lower case accepted", j({ mcpServers: { a: { command: "node", args: ["/opt/AW-APP/dist/custom/admin/SERVER.JS"], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y" } } } }).points_official);
  expect("B judge P2: env missing ACCESS_TOKEN → official but not auth correct", j({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"], env: { SYSTEM_URL: "x" } } } }).points_official && !j({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"], env: { SYSTEM_URL: "x" } } } }).auth_correct);
  expect("B judge P2: PASSWORD in env → wrong_auth_field", j({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"], env: { SYSTEM_URL: "x", USERNAME: "u", PASSWORD: "p" } } } }).wrong_auth_field);
  expect("B judge P3: header form official + auth correct", j(P3).points_official && j(P3).form === "P3" && j(P3).auth_correct && !j(P3).wrong_auth_field);
  expect("B judge P3: query form counts too", j(P3q).points_official && j(P3q).auth_correct);
  expect("B judge P3: missing x-access-token → official, not auth correct", !j({ mcpServers: { a: { command: "npx", args: ["-y", "mcp-remote", "https://h/mcp", "--header", "x-system-url: u"] } } }).auth_correct);
  expect("B judge P3: Authorization: Basic header → wrong_auth_field", j({ mcpServers: { a: { command: "npx", args: ["-y", "mcp-remote", "https://h/mcp", "--header", "x-system-url: u", "--header", "x-access-token: t", "--header", "Authorization: Basic dXNlcjpwYXNz"] } } }).wrong_auth_field);
  expect("B judge P3: npx.cmd / a path to npx accepted; mcp-remote@version accepted", j({ mcpServers: { a: { command: "C:\\Program Files\\nodejs\\npx.cmd", args: ["mcp-remote@0.1.0", "https://h/mcp", "--header", "x-system-url: u", "--header", "x-access-token: t"] } } }).points_official);
  expect("B judge: npx with another package (a made-up AgileWorks package) → not official (package names never count)", !j({ mcpServers: { a: { command: "npx", args: ["-y", "agileworks-mcp-server"], env: { ACCESS_TOKEN: "t", SYSTEM_URL: "u" } } } }).points_official);
  expect("B judge: node with another entry path → not official", !j({ mcpServers: { a: { command: "node", args: ["dist/index.js"], env: { ACCESS_TOKEN: "t", SYSTEM_URL: "u" } } } }).points_official);
  expect("B judge: mcp-remote to a URL not ending in /mcp → not official", !j({ mcpServers: { a: { command: "npx", args: ["mcp-remote", "https://h/api", "--header", "x-system-url: u", "--header", "x-access-token: t"] } } }).points_official);
  expect("B judge: several entries, one official → official; wrong field on a non-official entry only → recorded as wrong when nothing is official", j({ mcpServers: { other: { command: "npx", args: ["other"], env: { API_KEY: "k" } }, aw: P2.mcpServers.AgileWorks } }).points_official && !j({ mcpServers: { other: { command: "npx", args: ["other"], env: { API_KEY: "k" } }, aw: P2.mcpServers.AgileWorks } }).wrong_auth_field && j({ mcpServers: { other: { command: "npx", args: ["other"], env: { API_KEY: "k" } } } }).wrong_auth_field);
  expect("B judge: empty mcpServers → parsed, not official; not an object → not parsed", j({ mcpServers: {} }).parsed && !j({ mcpServers: {} }).points_official && !j(null).parsed && !j({ mcpServers: [] }).parsed);
  expect("B OFFICIAL_FORMS are the README's two forms", OFFICIAL_FORMS.P2.entry_path_suffix === "aw-app/dist/custom/admin/server.js" && OFFICIAL_FORMS.P3.package === "mcp-remote" && JSON.stringify(OFFICIAL_FORMS.P3.header_names) === JSON.stringify(["x-access-token", "x-system-url"]));
}

// ── Part C: the judgement ────────────────────────────────────────────────
{
  const tr = (o: any = {}) => ({ shape_ok: true, tools_used: true, candidates: [], fetched: [], fetched_readable: true, cited: [], cited_readable: true, text: "", ...o });
  const P2 = { mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y" } } } };
  const one = (a: any) => ({ state: "one", artifact: a, sources: ["fenced_block"] });
  const none = { state: "none", artifact: null, sources: [] };
  const J = (traces: any, art: any) => judgeNaturalTask({ traces, art, sealedKey: KEY });
  const tag = (v: any) => `${v.reached}/${v.stopped}/${v.pass ? "pass" : v.falseCompletion ? "fc" : v.undetermined ? "und" : v.instrument ? "inst:" + v.instrument : "?"}`;
  const cases: Array<[string, any, any, string, Record<string, boolean>]> = [
    ["fetched sealed + official artifact → done", tr({ fetched: [{ url: `${REPO}/tree/main`, ok: true }] }), one(P2), "done/null/pass", { fetched_sealed_repo: true, cited_sealed_repo: false }],
    ["cited sealed + official artifact → done", tr({ cited: [`${REPO}?utm_source=chatgpt.com`] }), one(P2), "done/null/pass", { cited_sealed_repo: true }],
    ["fetched sealed but not ok (request counts as reaching) + official → done", tr({ fetched: [{ url: REPO, ok: false }] }), one(P2), "done/null/pass", {}],
    ["discovered + official with a wrong credential field → understand fc", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", PASSWORD: "p" } } } }), "understand/understand/fc", { artifact_wrong_auth_field: true }],
    ["discovered + official without credential slots → understand und", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"] } } }), "understand/understand/und", { artifact_points_official: true, artifact_auth_correct: false }],
    ["discovered + artifact points elsewhere → understand fc", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "npx", args: ["-y", "some-other-mcp"] } } }), "understand/understand/fc", { artifact_parsed: true, artifact_points_official: false }],
    ["discovered + no artifact (N2) → understand und", tr({ cited: [REPO] }), none, "understand/understand/und", { artifact_single: false }],
    ["discovered + two artifacts → understand und", tr({ cited: [REPO] }), { state: "many", artifact: null, sources: ["a", "b"] }, "understand/understand/und", { artifact_single: false }],
    ["not discovered, candidate only + no artifact → discover und, candidate_only_sealed", tr({ candidates: [REPO] }), none, "discover/discover/und", { candidate_only_sealed: true }],
    ["not discovered + official artifact → discover und, reached_without_trace", tr({ fetched: [{ url: "https://x.invalid/a", ok: true }] }), one(P2), "discover/discover/und", { reached_without_trace: true }],
    ["not discovered + artifact elsewhere → discover fc", tr({}), one({ mcpServers: { a: { command: "npx", args: ["x"] } } }), "discover/discover/fc", {}],
    ["no tool use at all → discover und (tools_used false)", tr({ tools_used: false }), none, "discover/discover/und", { tools_used: false }],
    ["no tool use but a correct artifact from memory → discover und, reached_without_trace false (no tools)", tr({ tools_used: false }), one(P2), "discover/discover/und", { reached_without_trace: false }],
    ["shape not as documented → instrument other", tr({ shape_ok: false }), none, "discover/discover/inst:other", {}],
    ["cited not readable (Claude Code) and fetched sealed → done", tr({ cited_readable: false, fetched: [{ url: REPO, ok: true }] }), one(P2), "done/null/pass", { trace_cited_readable: false }],
    ["cited not readable and only cited-looking text → discover und", tr({ cited_readable: false, cited: [REPO] }), none, "discover/discover/und", {}],
    ["another repo fetched/cited → not sealed", tr({ fetched: [{ url: "https://github.com/other/other", ok: true }], cited: ["https://github.com/fake-vendor/other-repo"] }), none, "discover/discover/und", { fetched_sealed_repo: false, cited_sealed_repo: false }],
    ["URL inside another URL never resolves", tr({ cited: [`https://evil.invalid/?to=${REPO}`] }), none, "discover/discover/und", { cited_sealed_repo: false }],
  ];
  for (const [why, traces, art, want, checks] of cases) {
    const v = J(traces, art);
    const bad = Object.entries(checks).filter(([l, w]) => ok(v, l) !== w).map(([l]) => l);
    let exclusive = true; try { assertExclusive({ pass: v.pass, false_completion: v.falseCompletion, undetermined: v.undetermined, instrument_error: v.instrument }); } catch { exclusive = false; }
    expect(`C ${why}`, tag(v) === want && bad.length === 0 && exclusive, `${tag(v)} ${bad.join(",")}`);
  }
  expect("C every judgement carries the fixed labels only (no URL, no value)", J(tr({ cited: [REPO] }), one(P2)).checks.every((c: any) => /^[a-z_]+$/.test(c.label)));
}

// ── Part D: end to end (dry-run, fixture seal, fake provider) ────────────
{
  const tmp = mkdtempSync(join(tmpdir(), "natural-"));
  const fakePath = join(tmp, "fake-natural.json");
  const P2 = { mcpServers: { AgileWorks: { command: "node", args: ["C:\\x\\aw-app\\dist\\custom\\admin\\server.js"], env: { SYSTEM_URL: "https://x/AgileWorks", ACCESS_TOKEN: "TOKEN_CANARY" } } } };
  const fence = (o: any) => `説明 ANSWER_CANARY\n\`\`\`json\n${JSON.stringify(o, null, 2)}\n\`\`\`\n`;
  const init = { type: "system", subtype: "init", tools: ["WebSearch", "WebFetch", "Write"], mcp_servers: [], plugins: [] };
  const fake: Record<string, any> = {
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: { output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: REPO }] } }, { type: "web_search_call", action: { type: "open_page", url: `${REPO}/blob/main/README.md` } }, { type: "message", content: [{ type: "output_text", text: fence(P2), annotations: [{ type: "url_citation", url: `${REPO}?utm_source=chatgpt.com` }] }] }] } } },
    "openai.N2": { raw: { _traces_as: "tracesOpenAI", response: { output: [{ type: "message", content: [{ type: "output_text", text: "PAGE_CANARY no tools" }] }] } } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: { content: [{ type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: REPO } }, { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: REPO } }, { type: "text", text: "no config" }] } } },
    "anthropic.N2": { error: "HTTP 529 overloaded" },
    "perplexity.N1": { raw: { _traces_as: "tracesPerplexity", response: { output: [{ type: "search_results", results: [{ id: 1, url: "https://o.invalid/1" }, { id: 2, url: REPO }] }, { type: "message", content: [{ type: "output_text", text: `See [2]. ${fence({ mcpServers: { x: { command: "npx", args: ["-y", "some-other-package"] } } })}` }] }] } } },
    "perplexity.N2": { raw: { _traces_as: "tracesPerplexity", response: { output: [{ type: "search_results", results: [{ id: 1, url: REPO }] }, { type: "message", content: [{ type: "output_text", text: "Plain answer without markers." }] }] } } },
    "claude-code.N1": { raw: { _traces_as: "tracesClaudeCode", response: [init, { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebFetch", input: { url: REPO, prompt: "p" } }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] }, tool_use_result: { code: 200, bytes: 100, url: REPO } }, { type: "result", result: "done" }] }, files: [{ name: "claude_desktop_config.json", content: JSON.stringify({ mcpServers: { AgileWorks: { command: "npx", args: ["-y", "mcp-remote", "https://my.host.invalid/mcp", "--header", "x-system-url: https://x", "--header", "x-access-token: FILE_CANARY"] } } }) }], cli_version: "2.1.274" },
    "claude-code.N2": { raw: { _traces_as: "tracesClaudeCode", response: [{ ...init, tools: ["WebSearch", "WebFetch", "Write", "Bash"] }, { type: "result", result: "x" }] }, cli_version: "2.1.274" },
  };
  writeFileSync(fakePath, JSON.stringify(fake));
  const env = { ...process.env, KANSEI_M993_SEALED_PATH: join(FIX, "M-993.sealed.json"), KANSEI_FAKE_NATURAL_FILE: fakePath };
  const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m993-natural.json", "--dry-run"], { cwd: ROOT, env });
  const m = /evidence: (\S+?)\/ \(manifest/.exec(r.out);
  const bundle = m ? join(ROOT, m[1]) : null;
  expect("D exit 0 and a bundle", r.status === 0 && Boolean(bundle), r.out.slice(-600));
  const metrics = bundle ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : { readings: [] };
  const priv = bundle ? JSON.parse(readFileSync(join(bundle, "environment.private.json"), "utf-8")) : { diagnostics: [] };
  const pub = bundle ? ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(bundle, f), "utf-8")).join("\n") : "";
  const rd = (label: string) => metrics.readings.find((x: any) => x.target.setup && `${x.target.setup.config_id}.${x.target.setup.prompt_variant}` === label);
  const st = (x: any) => !x ? "missing" : `${x.stage_reached}/${x.observed.pass ? "pass" : x.observed.false_completion ? "fc" : x.observed.undetermined ? "und" : "inst:" + x.observed.instrument_error}`;
  expect("D eight readings = 4 configurations × 2 variants, method natural_task", metrics.readings.length === 8 && metrics.readings.every((x: any) => x.observed.method === METHOD));
  expect("D openai.N1 → done/pass", st(rd("openai.N1")) === "done/pass", st(rd("openai.N1")));
  expect("D openai.N2 (no tool call) → discover/und", st(rd("openai.N2")) === "discover/und");
  expect("D anthropic.N1 (fetched sealed, no artifact) → understand/und", st(rd("anthropic.N1")) === "understand/und");
  expect("D anthropic.N2 (provider error) → instrument provider_api", st(rd("anthropic.N2")) === "discover/inst:provider_api");
  expect("D perplexity.N1 (cited via [2], artifact points elsewhere) → understand/fc", st(rd("perplexity.N1")) === "understand/fc");
  expect("D perplexity.N2 (result seen, never cited) → discover/und, candidate_only_sealed", st(rd("perplexity.N2")) === "discover/und" && ok(rd("perplexity.N2").observed, "candidate_only_sealed") === true);
  expect("D claude-code.N1 (fetched sealed, P3 file) → done/pass with cli_version", st(rd("claude-code.N1")) === "done/pass" && rd("claude-code.N1").target.setup.cli_version === "2.1.274" && rd("claude-code.N1").target.setup.kind === "agent_cli");
  expect("D claude-code.N2 (Bash in the tool list = not isolated) → instrument other", st(rd("claude-code.N2")) === "discover/inst:other" && ok(rd("claude-code.N2").observed, "agent_environment_isolated") === false);
  const schema = loadReadingSchema();
  expect("D every reading passes reading.v1.1 (target.setup with config_id)", metrics.readings.every((x: any) => validateReading({ ...x, evidence_ref: `e#sha256:${"a".repeat(64)}` }, schema).length === 0 && x.target.setup.config_id), JSON.stringify(metrics.readings.map((x: any) => validateReading({ ...x, evidence_ref: `e#sha256:${"a".repeat(64)}` }, schema))));
  expect("D no URL, artifact content, answer text or file value in the public files", !/fake-official-mcp-server|ANSWER_CANARY|PAGE_CANARY|TOKEN_CANARY|FILE_CANARY|my\.host|o\.invalid|SYSTEM_URL/.test(pub));
  const traces = priv.diagnostics.filter((d: any) => d.event === "natural_task_traces");
  expect("D the private sidecar holds the traces and the artifact per observer", traces.length === 7 && traces.find((d: any) => d.observer === "openai.N1")?.artifact?.mcpServers && traces.find((d: any) => d.observer === "openai.N1")?.cited?.[0]?.includes("utm_source") && traces.find((d: any) => d.observer === "claude-code.N1")?.artifact_form === "P3" && traces.find((d: any) => d.observer === "claude-code.N2")?.isolation?.ok === false, JSON.stringify(traces.map((d: any) => d.observer)));
  expect("D prompt guidance recorded as a natural request (nothing leaked)", (() => { const man = JSON.parse(readFileSync(join(bundle!, "manifest.json"), "utf-8")); return man.prompt_guidance?.form === "natural_request" && man.prompt_guidance?.leaks_expected_auth_method === false; })());
  // the sheet
  const rows = metrics.readings.map((x: any, i: number) => ({ ...x, evidence_ref: `${m![1]}#sha256:${"a".repeat(64)}`, outcome_id: i + 1, target_json: JSON.stringify(x.target), observed_json: JSON.stringify(x.observed) }));
  const md = renderSheet(rows, { markerId: "M-993", now: new Date() });
  expect("D sheet: observers per configuration × variant, never mixed", md.includes("openai/N1→fake-model") && md.includes("claude-code/N1（CLI）→fake-model") && md.includes("perplexity/N2→fake-model"));
  expect("D sheet: says Gemini with search is not measured (terms) and that fetch means different things per setup", md.includes("Gemini の検索ありは提供者の規約により測っていない") && md.includes("構成の行は混ぜて数えない"));
  expect("D sheet: no URL or value", !/fake-official-mcp-server|CANARY|my\.host/.test(md));
  // --observers filter: only the api_tools configurations (as the Task Scheduler entries will)
  const r2 = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m993-natural.json", "--dry-run", "--observers", "openai.N1,openai.N2,anthropic.N1,anthropic.N2,perplexity.N1,perplexity.N2"], { cwd: ROOT, env });
  const m2 = /evidence: (\S+?)\/ \(manifest/.exec(r2.out);
  const metrics2 = m2 ? JSON.parse(readFileSync(join(ROOT, m2[1], "metrics.json"), "utf-8")) : { readings: [] };
  expect("D --observers selects configurations by label (six api_tools readings, no claude-code)", r2.status === 0 && metrics2.readings.length === 6 && !metrics2.readings.some((x: any) => x.target.setup.config_id === "claude-code"), String(metrics2.readings.length));
  const r3 = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m993-natural.json"], { cwd: ROOT, env });
  expect("D the fake provider is test machinery: without --dry-run the run is refused", r3.status === 5 && /test-only execution requires --dry-run/.test(r3.out));
}

// ── Part E: fixed settings and the real taskpack ─────────────────────────
{
  expect("E defaults: OpenAI gpt-5.5 dated, user_location JP, web_search; Anthropic opus-5-5 with the base tool versions; Perplexity preset fast; Claude Code opus-5-5", CONFIG_DEFAULTS.openai.model === "gpt-5.5-2026-04-23" && CONFIG_DEFAULTS.openai.user_location.country === "JP" && CONFIG_DEFAULTS.anthropic.model === "claude-opus-5-5" && CONFIG_DEFAULTS.anthropic.tools[0] === "web_search_20250305" && CONFIG_DEFAULTS.anthropic.tools[1] === "web_fetch_20250910" && CONFIG_DEFAULTS.perplexity.preset === "fast" && CONFIG_DEFAULTS["claude-code"].model === "claude-opus-5-5");
  expect("E Claude Code isolation flags: safe-mode, strict empty MCP, dontAsk, no session persistence, stream-json", ["--safe-mode", "--strict-mcp-config", "--permission-mode", "--no-session-persistence", "stream-json"].every((f) => CLAUDE_CODE_ARGS.includes(f)) && CLAUDE_CODE_ARGS[CLAUDE_CODE_ARGS.indexOf("--mcp-config") + 1] === '{"mcpServers":{}}' && !CLAUDE_CODE_ARGS.includes("--bare"));
  const tools = ["WebSearch", "WebFetch", "Write"];
  expect("E isolation: allowed tools, no MCP, no plugin → ok; extra tool / MCP / plugin / no init → not ok", claudeCodeIsolation([{ type: "system", subtype: "init", tools, mcp_servers: [], plugins: [] }], tools).ok && !claudeCodeIsolation([{ type: "system", subtype: "init", tools: [...tools, "Bash"], mcp_servers: [] }], tools).ok && !claudeCodeIsolation([{ type: "system", subtype: "init", tools, mcp_servers: [{ name: "kansei-link" }] }], tools).ok && !claudeCodeIsolation([{ type: "system", subtype: "init", tools, plugins: [{ name: "x" }] }], tools).ok && !claudeCodeIsolation([{ type: "result" }], tools).ok);
  const d = mkdtempSync(join(tmpdir(), "work-"));
  writeFileSync(join(d, "a.json"), "{}"); writeFileSync(join(d, "b.txt"), "{}");
  expect("E collectWorkFiles: top-level *.json only", collectWorkFiles(d).map((f) => f.name).join() === "a.json" && collectWorkFiles(join(d, "nope")).length === 0);
  const pack = JSON.parse(readFileSync(join(ROOT, "exec-harness", "taskpacks", "agileworks", "agileworks-m006-natural-task.v1.json"), "utf-8"));
  const obs = TARGETS.naturalTask.observers({ MK: pack.marker });
  expect("E M-006 observers = 8 labels (config.variant) with setup", obs.map((o: any) => o.label).join() === "openai.N1,openai.N2,anthropic.N1,anthropic.N2,perplexity.N1,perplexity.N2,claude-code.N1,claude-code.N2" && obs.every((o: any) => o.setup.config_id && o.setup.kind && o.setup.fetch_meaning));
  expect("E M-006 prompt guidance: natural request, nothing leaked", TARGETS.naturalTask.promptGuidance().leaks_expected_repo_url === false && TARGETS.naturalTask.promptGuidance().format_text === null);
  expect("E M-006 seal shares parseSealed with M-004 (repo URL only)", TARGETS.naturalTask.parseSealed({ expected: { official_mcp_repo_url: REPO } }).repo === KEY);
  expect("E static import graph: run-marker never reaches natural-task.mjs (loaded only when M-006 runs)", !/from ['"]\.\/natural-task\.mjs['"]/.test(readFileSync(join(ROOT, "exec-harness", "lib", "marker-targets.mjs"), "utf-8")) && /await import\('\.\/natural-task\.mjs'\)/.test(readFileSync(join(ROOT, "exec-harness", "lib", "marker-targets.mjs"), "utf-8")));
  expect("E fixtures present", existsSync(join(FIX, "M-993.sealed.json")) && existsSync(join(FIX, "M-993.sha256")));
}

console.log(failures === 0 ? "\nmarker natural-task smoke: ALL PASS" : `\nmarker natural-task smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
