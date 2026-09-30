#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth = natural_task (M-006): the natural-task reading judged from two closed traces.
 *
 *   npx tsx scripts/smoke-marker-natural-task.mts
 *
 * Part A: traces per configuration (lib/natural-task-rules.mjs) on responses shaped as the providers' docs
 *         describe: OpenAI Responses (web_search_call actions, url_citation), Anthropic Messages (server tools,
 *         web_fetch errors, citations, a request without its result), Perplexity Agent API (search_results,
 *         fetch_url_results, output_text.annotations — the [n] markers are never read), Claude Code stream-json
 *         (tool_use / tool_use_result, exactly one init and one successful result). CLOSED SHAPE: every item
 *         typed, the read ones checked field by field; anything else → shape not ok (instrument other); an
 *         unknown well-formed type is skipped and only its name kept.
 * Part B: the artifact — extraction (fenced blocks, files, exactly one), the two official forms (P2 / P3), the
 *         credential slots in their own place, wrong credentials in every place of the entry.
 * Part C: the judgement table (exactly one of pass / false_completion / undetermined / instrument).
 * Part D: run-marker end to end in --dry-run with the M-993 fixture seal and the fake provider: rows,
 *         target.setup (reading.v1.1), privacy (URLs and artifacts only in the two private files), isolation
 *         failure, provider error and failed agent run as instrument rows, a provider-reported model outside the
 *         public grammar kept private, the sheet counted per configuration.
 * Part E: the callers' fixed settings (models, isolation, the child's environment) and the real M-006 taskpack.
 * Part F: Codex's 55 independent cases of fe0d132 (fixtures/natural-task-cases-fe0d132.json), its runner ported.
 * No network, no real seal, no DB, no CLI is started.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { tracesOpenAI, tracesAnthropic, tracesPerplexity, tracesClaudeCode, TRACE_READERS, extractArtifact, judgeArtifact, judgeNaturalTask, OFFICIAL_FORMS, METHOD } from "../exec-harness/lib/natural-task-rules.mjs";
import * as RULES from "../exec-harness/lib/natural-task-rules.mjs";
import { CONFIG_DEFAULTS, CLAUDE_CODE_ARGS, CLAUDE_CODE_ENV_INHERIT, CLAUDE_CODE_ENV_SET, claudeCodeEnv, claudeCodeIsolation, collectWorkFiles } from "../exec-harness/lib/natural-task.mjs";
import { TARGETS } from "../exec-harness/lib/marker-targets.mjs";
import { publicModel, PUBLIC_MODEL, PUBLIC_CLI_VERSION } from "../exec-harness/lib/marker-generic.mjs";
import { PROVIDER_MODELS } from "../exec-harness/lib/llm-ask.mjs";
import { sourceRepoKey } from "../exec-harness/lib/repo-key.mjs";
import { sourceRepoKey as sourceRepoKeyReexport } from "../exec-harness/lib/attribution-rules.mjs";
import { renderSheet } from "../exec-harness/render-reading-sheet.mjs";
import { readmeRows } from "../exec-harness/lib/marker-persist.mjs";
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
const INIT = { type: "system", subtype: "init", tools: ["WebSearch", "WebFetch", "Write"], mcp_servers: [], plugins: [] };
const RESULT = (text: string, over: any = {}) => ({ type: "result", subtype: "success", is_error: false, result: text, ...over });
const refused = (t: any) => t.shape_ok === false && t.instrument === "other" && t.candidates.length === 0 && t.fetched.length === 0 && t.cited.length === 0 && t.text === "";

// ── Part A: traces ───────────────────────────────────────────────────────
{
  // OpenAI Responses
  const oa = (output: any[]) => tracesOpenAI({ output });
  const t1 = oa([
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "web_search_call", status: "completed", action: { type: "search", query: "q", sources: [{ type: "url", url: "https://a.invalid/1" }, { type: "url", url: REPO }, { type: "api", name: "oai-finance" }] } },
    { type: "web_search_call", status: "completed", action: { type: "open_page", url: `${REPO}/tree/main` } },
    { type: "web_search_call", status: "completed", action: { type: "open_page", url: null } },
    { type: "web_search_call", status: "completed", action: { type: "find_in_page", url: "https://a.invalid/1", pattern: "x" } },
    { type: "message", content: [{ type: "output_text", text: "answer", annotations: [{ type: "url_citation", url: `${REPO}?utm_source=chatgpt.com`, title: "t", start_index: 0, end_index: 1 }, { type: "file_citation", file_id: "f" }] }, { type: "output_text", text: "more", annotations: [] }, { type: "refusal", refusal: "no" }] },
  ]);
  expect("A openai: candidates from action.search.sources of type url", t1.shape_ok && JSON.stringify(t1.candidates) === JSON.stringify(["https://a.invalid/1", REPO]));
  expect("A openai: fetched from open_page (null url kept as a request without url) and find_in_page", t1.fetched.length === 3 && t1.fetched[0].url === `${REPO}/tree/main` && t1.fetched[1].url === null && t1.fetched[2].url === "https://a.invalid/1");
  expect("A openai: cited from url_citation annotations of every output_text; text concatenated", JSON.stringify(t1.cited) === JSON.stringify([`${REPO}?utm_source=chatgpt.com`]) && t1.text === "answer\nmore" && t1.tools_used && t1.cited_readable);
  expect("A openai: well-formed items of an unknown type are skipped; only their type names are kept", JSON.stringify(t1.unknown_types) === JSON.stringify(["reasoning", "source:api", "annotation:file_citation", "content:refusal"]), JSON.stringify(t1.unknown_types));
  expect("A openai: sources absent (no include) → no candidates, still readable", oa([{ type: "web_search_call", status: "completed", action: { type: "search", query: "q" } }]).shape_ok && oa([{ type: "web_search_call", action: { type: "search" } }]).candidates.length === 0 && oa([{ type: "web_search_call", action: { type: "search" } }]).tools_used);
  expect("A openai: no tool call → tools_used false, shape ok", !oa([{ type: "message", content: [{ type: "output_text", text: "x", annotations: [] }] }]).tools_used && oa([]).shape_ok);
  expect("A openai: an output_text without an annotations array has no citation trace (cited_readable false), not an empty one", oa([{ type: "message", content: [{ type: "output_text", text: "x" }] }]).shape_ok && oa([{ type: "message", content: [{ type: "output_text", text: "x" }] }]).cited_readable === false && oa([]).cited_readable === false);
  expect("A openai: no output array → shape not ok", refused(tracesOpenAI({})) && refused(tracesOpenAI(null)) && refused(tracesOpenAI({ output: "x" })));
  expect("A openai: a URL inside the answer text is never a trace", oa([{ type: "web_search_call", action: { type: "search" } }, { type: "message", content: [{ type: "output_text", text: `see ${REPO}`, annotations: [] }] }]).cited.length === 0);
  for (const [why, output] of [
    ["an item that is not an object (Codex R6: output [42])", [42]], ["an item that is null", [null]], ["an item without a type", [{ id: "x" }]], ["an item whose type is not a string", [{ type: 7 }]],
    ["web_search_call without action", [{ type: "web_search_call", status: "completed" }]], ["web_search_call whose action has no type", [{ type: "web_search_call", action: { url: REPO } }]],
    ["search whose sources is not an array", [{ type: "web_search_call", action: { type: "search", sources: { url: REPO } } }]], ["a url source without a url", [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url" }] } }]], ["a source that is not an object", [{ type: "web_search_call", action: { type: "search", sources: [REPO] } }]],
    ["open_page whose url is a number", [{ type: "web_search_call", action: { type: "open_page", url: 1 } }]], ["open_page whose url is an object", [{ type: "web_search_call", action: { type: "open_page", url: { href: REPO } } }]],
    ["message without content", [{ type: "message" }]], ["message whose content is a string", [{ type: "message", content: REPO }]], ["a content item that is not an object", [{ type: "message", content: ["x"] }]],
    ["output_text without text", [{ type: "message", content: [{ type: "output_text", annotations: [] }] }]], ["annotations that is not an array", [{ type: "message", content: [{ type: "output_text", text: "x", annotations: { url: REPO } }] }]], ["an annotation without a type", [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [{ url: REPO }] }] }]], ["a url_citation without a url", [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation" }] }] }]],
    ["one broken item after good ones: nothing of the response is kept", [{ type: "web_search_call", action: { type: "open_page", url: REPO } }, 42]],
  ] as const) expect(`A openai shape: ${why} → refused (instrument other), no partial trace`, refused(oa(output as any)));

  // Anthropic Messages
  const an = (content: any[]) => tracesAnthropic({ content });
  const t2 = an([
    { type: "thinking", thinking: "…" },
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: REPO, title: "t", encrypted_content: "e" }, { type: "web_search_result", url: "https://b.invalid/2" }] },
    { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: `${REPO}/blob/main/README.md` } },
    { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: `${REPO}/blob/main/README.md`, retrieved_at: "2026-09-30T00:00:00Z", content: { type: "document", source: {} } } },
    { type: "server_tool_use", id: "f2", name: "web_fetch", input: { url: "https://b.invalid/2" } },
    { type: "web_fetch_tool_result", tool_use_id: "f2", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
    { type: "text", text: "answer", citations: [{ type: "web_search_result_location", url: REPO, title: "t", cited_text: "c" }, { type: "char_location", document_index: 0 }] },
    { type: "text", text: "tail", citations: null },
  ]);
  expect("A anthropic: candidates from web_search_tool_result", t2.shape_ok && JSON.stringify(t2.candidates) === JSON.stringify([REPO, "https://b.invalid/2"]));
  expect("A anthropic: fetched = requests; success from web_fetch_result, failure from the error block (url from the request)", t2.fetched.length === 2 && t2.fetched[0].ok && t2.fetched[0].url === `${REPO}/blob/main/README.md` && !t2.fetched[1].ok && t2.fetched[1].url === "https://b.invalid/2");
  expect("A anthropic: cited from web_search_result_location only (char_location has no url); citations null is no citation", JSON.stringify(t2.cited) === JSON.stringify([REPO]) && t2.text === "answer\ntail" && JSON.stringify(t2.unknown_types) === JSON.stringify(["thinking", "citation:char_location"]));
  const tReq = an([{ type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: REPO } }, { type: "text", text: "x" }]);
  expect("A anthropic: a web_fetch request without its result block is still a request (the request is the reaching), not ok", tReq.shape_ok && tReq.fetched.length === 1 && tReq.fetched[0].url === REPO && tReq.fetched[0].ok === false && tReq.tools_used);
  const tRedir = an([{ type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: "https://short.invalid/x" } }, { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: REPO } }]);
  expect("A anthropic: when the result names another URL than the request, both are kept (the request and where the server ended up)", JSON.stringify(tRedir.fetched) === JSON.stringify([{ url: "https://short.invalid/x", ok: true }, { url: REPO, ok: true }]));
  expect("A anthropic: a failed search (content is an error object) leaves no candidates", an([{ type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }]).shape_ok && an([{ type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }]).candidates.length === 0);
  expect("A anthropic: array of blocks accepted; no content → shape not ok", tracesAnthropic([{ type: "text", text: "x" }]).shape_ok && refused(tracesAnthropic({})) && refused(tracesAnthropic("x")));
  for (const [why, content] of [
    ["a block that is not an object (Codex R6: content [42])", [42]], ["a block without a type", [{ text: "x" }]],
    ["server_tool_use without id", [{ type: "server_tool_use", name: "web_fetch", input: { url: REPO } }]], ["server_tool_use without input", [{ type: "server_tool_use", id: "f", name: "web_fetch" }]], ["a web_fetch request without a url", [{ type: "server_tool_use", id: "f", name: "web_fetch", input: {} }]], ["a web_fetch request whose url is not a string", [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: [REPO] } }]],
    ["two requests with one id", [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: REPO } }, { type: "server_tool_use", id: "f", name: "web_fetch", input: { url: "https://x.invalid/" } }]],
    ["a web_fetch result that answers no request of the response", [{ type: "web_fetch_tool_result", tool_use_id: "zz", content: { type: "web_fetch_result", url: REPO } }]], ["a web_fetch result without tool_use_id", [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: REPO } }, { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: REPO } }]],
    ["a web_fetch result whose content is a string", [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: REPO } }, { type: "web_fetch_tool_result", tool_use_id: "f", content: REPO }]], ["a web_fetch_result without a url", [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: REPO } }, { type: "web_fetch_tool_result", tool_use_id: "f", content: { type: "web_fetch_result" } }]],
    ["a web_search result entry without a url", [{ type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result" }] }]], ["a web_search result whose content is a string", [{ type: "web_search_tool_result", tool_use_id: "s", content: REPO }]],
    ["a text block without text", [{ type: "text" }]], ["citations that is an object", [{ type: "text", text: "x", citations: { url: REPO } }]], ["a web_search_result_location without a url", [{ type: "text", text: "x", citations: [{ type: "web_search_result_location" }] }]],
  ] as const) expect(`A anthropic shape: ${why} → refused (instrument other)`, refused(an(content as any)));

  // Perplexity Agent API
  const pp = (output: any[]) => tracesPerplexity({ output });
  const t3 = pp([
    { type: "search_results", queries: ["q"], results: [{ id: 1, url: "https://c.invalid/1", title: "a" }, { id: 2, url: REPO, title: "b" }, { id: 3, url: "https://c.invalid/3" }] },
    { type: "fetch_url_results", contents: [{ url: REPO, title: "t", snippet: "text" }, { url: "https://c.invalid/9", title: "", snippet: "no_result_returned" }] },
    { type: "function_call", name: "x", arguments: "{}" },
    { type: "message", content: [{ type: "output_text", text: "Answer [2][3] and [7] and [web:1] and [02].", annotations: [{ type: "url_citation", url: "https://c.invalid/3", title: "c", start_index: 0, end_index: 3 }] }] },
  ]);
  expect("A perplexity: candidates from search_results.results", t3.shape_ok && t3.candidates.length === 3 && t3.candidates[1] === REPO);
  expect("A perplexity: fetched from fetch_url_results (no_result_returned = not ok)", t3.fetched.length === 2 && t3.fetched[0].ok && !t3.fetched[1].ok);
  expect("A perplexity: cited = the structured annotations only; the [n] markers of the text are never read ([2] names the sealed repo, yet it is not cited)", JSON.stringify(t3.cited) === JSON.stringify(["https://c.invalid/3"]) && t3.cited_readable && JSON.stringify(t3.unknown_types) === JSON.stringify(["function_call"]), JSON.stringify(t3.cited));
  for (const mark of ["[2]", "[02]", "[[2]]", "[web:2]", "[web:[2]]", "[9]", `${REPO}`]) {
    const t = pp([{ type: "search_results", results: [{ id: 2, url: REPO, title: "fixture" }] }, { type: "message", content: [{ type: "output_text", text: `${mark} answer` }] }]);
    expect(`A perplexity: the marker ${mark.slice(0, 12)} in the answer text is not a citation (Codex R5; no part reads free text)`, t.shape_ok && t.cited.length === 0 && t.cited_readable === false);
  }
  expect("A perplexity: no module export reads [n] markers any more", !("perplexityCitedIds" in RULES) && !/PPLX_MARKER|perplexityCitedIds/.test(readFileSync(join(ROOT, "exec-harness", "lib", "natural-task-rules.mjs"), "utf-8")));
  expect("A perplexity: shape", refused(tracesPerplexity({})) && pp([]).shape_ok && !pp([]).tools_used);
  for (const [why, output] of [
    ["an item that is not an object (Codex R6: output [42])", [42]], ["an item without a type", [{ results: [] }]],
    ["search_results without results", [{ type: "search_results" }]], ["a result without a url", [{ type: "search_results", results: [{ id: 1 }] }]], ["a result that is a string", [{ type: "search_results", results: [REPO] }]],
    ["fetch_url_results without contents", [{ type: "fetch_url_results" }]], ["a fetched content without a url", [{ type: "fetch_url_results", contents: [{ snippet: "x" }] }]], ["a fetched content whose snippet is a number", [{ type: "fetch_url_results", contents: [{ url: REPO, snippet: 1 }] }]],
    ["message without content", [{ type: "message" }]], ["output_text without text", [{ type: "message", content: [{ type: "output_text" }] }]], ["a url_citation without a url", [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", title: "t" }] }] }]],
  ] as const) expect(`A perplexity shape: ${why} → refused (instrument other)`, refused(pp(output as any)));

  // Claude Code stream-json
  const cc = (events: any[]) => tracesClaudeCode(events);
  const t4 = cc([
    INIT,
    { type: "rate_limit_event", info: {} },
    { type: "assistant", message: { content: [{ type: "text", text: "thinking aloud" }, { type: "tool_use", id: "s1", name: "WebSearch", input: { query: "q" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1", content: "…" }] }, tool_use_result: { query: "q", results: [{ tool_use_id: "x", content: [{ title: "t", url: REPO }, { title: "u", url: "https://d.invalid/1" }] }, "a string entry"], durationSeconds: 1 } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "f1", name: "WebFetch", input: { url: `${REPO}#readme`, prompt: "p" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f1", content: "…" }] }, tool_use_result: { bytes: 5000, code: 200, codeText: "OK", result: "summary", durationMs: 10, url: `${REPO}#readme` } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "f2", name: "WebFetch", input: { url: "https://d.invalid/1", prompt: "p" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f2", content: "error", is_error: true }] }, tool_use_result: { bytes: 0, code: 404, codeText: "Not Found", result: "", durationMs: 10, url: "https://d.invalid/1" } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "f3", name: "WebFetch", input: { url: "https://d.invalid/never-answered", prompt: "p" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "f4", name: "WebFetch", input: { url: "https://d.invalid/tool-error", prompt: "p" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f4", content: "Error", is_error: true }] }, tool_use_result: "Error: request failed" },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "c.json", content: "{}" } }] } },
    RESULT(`final text ${REPO}`, { total_cost_usd: 0.1 }),
  ]);
  expect("A claude-code: candidates from WebSearch tool_use_result.results[].content[].url (string entries skipped)", t4.shape_ok && JSON.stringify(t4.candidates) === JSON.stringify([REPO, "https://d.invalid/1"]));
  expect("A claude-code: fetched = WebFetch requests; ok from code 2xx and bytes > 0; a request without a result, or with the tool's error text, is a request", t4.fetched.length === 4 && t4.fetched[0].ok && t4.fetched[0].url === `${REPO}#readme` && !t4.fetched[1].ok && t4.fetched[2].url === "https://d.invalid/never-answered" && !t4.fetched[2].ok && t4.fetched[3].url === "https://d.invalid/tool-error" && !t4.fetched[3].ok);
  expect("A claude-code: no structured citations (cited_readable=false); the result text is never scanned; unknown events and tools only by name", !t4.cited_readable && t4.cited.length === 0 && t4.text.startsWith("final text") && JSON.stringify(t4.unknown_types) === JSON.stringify(["rate_limit_event", "tool_use:Write"]), JSON.stringify(t4.unknown_types));
  const use = { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebFetch", input: { url: REPO, prompt: "p" } }] } };
  for (const [why, events] of [
    ["no init", [RESULT("x")]], ["no result", [INIT]], ["two init events", [INIT, INIT, RESULT("x")]], ["two result events", [INIT, RESULT("x"), RESULT("y")]], ["not an array", {}],
    ["an event that is not an object", [INIT, 42, RESULT("x")]], ["an event without a type", [INIT, { message: {} }, RESULT("x")]],
    ["a result without is_error", [INIT, { type: "result", subtype: "success", result: "x" }]], ["a result without subtype", [INIT, { type: "result", is_error: false, result: "x" }]], ["a result whose is_error is a string", [INIT, { type: "result", subtype: "success", is_error: "false", result: "x" }]], ["a success result whose text is not a string", [INIT, { type: "result", subtype: "success", is_error: false }]],
    ["an assistant event without message.content", [INIT, { type: "assistant", message: {} }, RESULT("x")]], ["a tool_use without id", [INIT, { type: "assistant", message: { content: [{ type: "tool_use", name: "WebFetch", input: { url: REPO } }] } }, RESULT("x")]], ["a WebFetch request without a url", [INIT, { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "WebFetch", input: {} }] } }, RESULT("x")]],
    ["a WebFetch result whose code is a string", [INIT, use, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] }, tool_use_result: { code: "200", bytes: 10 } }, RESULT("x")]], ["a WebFetch result that is an array", [INIT, use, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] }, tool_use_result: [REPO] }, RESULT("x")]],
    ["a WebSearch result without results", [INIT, { type: "assistant", message: { content: [{ type: "tool_use", id: "s", name: "WebSearch", input: {} }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s" }] }, tool_use_result: { query: "q" } }, RESULT("x")]],
  ] as const) expect(`A claude-code shape: ${why} → refused (instrument other)`, refused(tracesClaudeCode(events as any)) && tracesClaudeCode(events as any).cited_readable === false);
  // Codex R3: the agent run itself failed — nothing of it is graded
  for (const [subtype, cls] of [["error_during_execution", "provider_api"], ["error_max_turns", "budget"], ["error_max_budget_usd", "budget"], ["success", "provider_api"]] as const) {
    const t = cc([INIT, use, { type: "result", subtype, is_error: true, errors: ["provider overloaded"] }]);
    expect(`A claude-code: result { subtype: ${subtype}, is_error: true } → instrument ${cls}; the requests seen before it are not kept`, t.shape_ok && t.instrument === cls && t.fetched.length === 0 && t.text === "" && !t.tools_used);
  }
  expect("A claude-code: result { subtype: error_during_execution, is_error: false } is not a success either", cc([INIT, use, { type: "result", subtype: "error_during_execution", is_error: false, result: "x" }]).instrument === "provider_api");
  expect("A every reader is listed once (the fake provider may only name one of these)", Object.keys(TRACE_READERS).join() === "tracesOpenAI,tracesAnthropic,tracesPerplexity,tracesClaudeCode");
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
  expect("B extract: a block or file with a key written twice is not an artifact (JSON.parse would keep the last and hide the first: a Basic credential, another server)", extractArtifact({ text: "```json\n" + JSON.stringify(P2).replace('"env":{', '"env":{"Authorization":"Basic Zm9vOmJhcg==","SYSTEM_URL":"dup",') + "\n```" }).state === "none" && extractArtifact({ text: '```json\n{"mcpServers":{"bad":{"command":"npx","args":["other"]}},"mcpServers":' + JSON.stringify(P2.mcpServers) + "}\n```" }).state === "none" && extractArtifact({ files: [{ name: "c.json", content: '{"mcpServers":{},"mcpServers":{}}' }] }).state === "none" && extractArtifact({ text: fence(P2), files: [{ name: "c.json", content: '{"mcpServers":{},"mcpServers":{}}' }] }).state === "one");
  expect("B extract: file source named", extractArtifact({ files: [{ name: "c.json", content: JSON.stringify(P3) }] }).sources[0] === "file:c.json");
  const j = (o: any) => judgeArtifact(o);
  const p2 = (over: any = {}, args: string[] = ["x/aw-app/dist/custom/admin/server.js"]) => ({ mcpServers: { a: { command: "node", args, env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y" }, ...over } } });
  const p3 = (args: string[], over: any = {}) => ({ mcpServers: { a: { command: "npx", args: ["-y", "mcp-remote", ...args], ...over } } });
  const H = ["--header", "x-system-url: u", "--header", "x-access-token: t"];
  expect("B judge P2: official + auth correct", j(P2).points_official && j(P2).form === "P2" && j(P2).auth_correct && !j(P2).wrong_auth_field);
  expect("B judge P2: forward slashes and lower case of the path accepted", j({ mcpServers: { a: { command: "node", args: ["/opt/AW-APP/dist/custom/admin/SERVER.JS"], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y" } } } }).points_official);
  expect("B judge P2: env missing ACCESS_TOKEN → official but not auth correct", j(p2({ env: { SYSTEM_URL: "x" } })).points_official && !j(p2({ env: { SYSTEM_URL: "x" } })).auth_correct);
  expect("B judge P2: PASSWORD in env → wrong_auth_field", j(p2({ env: { SYSTEM_URL: "x", USERNAME: "u", PASSWORD: "p" } })).wrong_auth_field);
  // Codex R1: the slots in their own place — a name in another place does not count
  expect("B R1 P2: ACCESS_TOKEN / SYSTEM_URL as --header arguments, no env → official, NOT auth correct", j(p2({ env: undefined }, ["x/aw-app/dist/custom/admin/server.js", "--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"])).points_official && !j(p2({ env: undefined }, ["x/aw-app/dist/custom/admin/server.js", "--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"])).auth_correct);
  expect("B R1 P2: one slot in env, the other as a header → not auth correct", !j(p2({ env: { ACCESS_TOKEN: "t" } }, ["x/aw-app/dist/custom/admin/server.js", "--header", "SYSTEM_URL: u"])).auth_correct);
  expect("B R1 P2: the header names of P3 in env → not auth correct; the env names in another case or with a dash → not auth correct", !j(p2({ env: { "x-access-token": "t", "x-system-url": "u" } })).auth_correct && !j(p2({ env: { access_token: "t", system_url: "u" } })).auth_correct && !j(p2({ env: { "ACCESS-TOKEN": "t", "SYSTEM-URL": "u" } })).auth_correct);
  expect("B R1 P2: a slot whose value is not a string (null, a number, an object) is not a slot", !j(p2({ env: { ACCESS_TOKEN: null, SYSTEM_URL: "u" } })).auth_correct && !j(p2({ env: { ACCESS_TOKEN: 1, SYSTEM_URL: "u" } })).auth_correct && !j(p2({ env: ["ACCESS_TOKEN", "SYSTEM_URL"] })).auth_correct);
  expect("B judge: an entry that is not well-formed (args not all strings, env values not all strings, no command) is not an official form", !j(p2({}, ["x/aw-app/dist/custom/admin/server.js", ["--header", "Authorization: Basic x"]] as any)).points_official && !j(p2({ env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", Authorization: ["Basic x"] } })).points_official && !j({ mcpServers: { a: { args: ["x/aw-app/dist/custom/admin/server.js"], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y" } } } }).points_official && !j(p2({ args: "x/aw-app/dist/custom/admin/server.js" })).points_official && j(p2({ args: "x/aw-app/dist/custom/admin/server.js" })).parsed);
  expect("B judge P3: header form official + auth correct (header names in any case)", j(P3).points_official && j(P3).form === "P3" && j(P3).auth_correct && !j(P3).wrong_auth_field && j(p3(["https://h/mcp", "--header", "X-System-Url: u", "--header", "X-ACCESS-TOKEN: t"])).auth_correct);
  expect("B judge P3: query form counts too; one in a header and one in the query counts", j(P3q).points_official && j(P3q).auth_correct && j(p3(["https://h/mcp?x-system-url=u", "--header", "x-access-token: t"])).auth_correct);
  expect("B judge P3: missing x-access-token → official, not auth correct", !j(p3(["https://h/mcp", "--header", "x-system-url: u"])).auth_correct);
  expect("B R1 P3: x-access-token / x-system-url in env, no header and no query → official, NOT auth correct", j(p3(["https://h/mcp"], { env: { "x-access-token": "t", "x-system-url": "u" } })).points_official && !j(p3(["https://h/mcp"], { env: { "x-access-token": "t", "x-system-url": "u" } })).auth_correct);
  expect("B R1 P3: the env names of P2 in env → not auth correct; the slots in the query of ANOTHER url argument → not auth correct", !j(p3(["https://h/mcp"], { env: { ACCESS_TOKEN: "t", SYSTEM_URL: "u" } })).auth_correct && !j(p3(["https://h/mcp", "https://other.invalid/?x-access-token=t&x-system-url=u"])).auth_correct);
  // Codex R2: a wrong credential anywhere in the entry
  const B64 = "Basic Zm9vOmJhcg==";
  expect("B judge P3: Authorization: Basic header → wrong_auth_field", j(p3(["https://h/mcp", ...H, "--header", `Authorization: ${B64}`])).wrong_auth_field);
  expect("B R2: Authorization = Basic … in env (P2) → wrong_auth_field (Codex F3-Basic-env)", j(p2({ env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", Authorization: B64 } })).wrong_auth_field && j(p2({ env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", Authorization: B64 } })).auth_correct);
  expect("B R2: authorization in any case, basic in any case, in env / header / query", j(p2({ env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", AUTHORIZATION: "basic abc" } })).wrong_auth_field && j(p3(["https://h/mcp", ...H, "--header", "authorization: BASIC abc"])).wrong_auth_field && j(p3(["https://h/mcp?Authorization=Basic%20abc", ...H])).wrong_auth_field && j(p3(["https://h/mcp", ...H], { env: { authorization: " Basic abc" } })).wrong_auth_field);
  expect("B R2: Authorization:${AUTH_HEADER} with AUTH_HEADER = Basic … in the entry's env → wrong_auth_field", j(p3(["https://h/mcp", ...H, "--header", "Authorization:${AUTH_HEADER}"], { env: { AUTH_HEADER: B64 } })).wrong_auth_field && !j(p3(["https://h/mcp", ...H, "--header", "Authorization:${AUTH_HEADER}"], { env: { AUTH_HEADER: "Bearer abc" } })).wrong_auth_field);
  expect("B R2: Authorization: Bearer … and the word Basic under another name are not the Basic credential", !j(p3(["https://h/mcp", ...H, "--header", "Authorization: Bearer abc"])).wrong_auth_field && !j(p2({ env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", NOTE: "Basic setup" } })).wrong_auth_field && !j(p2({ env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", Authorization: "Basically none" } })).wrong_auth_field);
  expect("B R2: a wrong credential NAME in every place: env key, header name, query name of any url argument", j(p2({ env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", API_KEY: "k" } })).wrong_auth_field && j(p3(["https://h/mcp", ...H, "--header", "X-API-Key: k"])).wrong_auth_field && j(p3(["https://h/mcp?api_key=k", ...H])).wrong_auth_field && j(p2({}, ["x/aw-app/dist/custom/admin/server.js", "--header", "password: p"])).wrong_auth_field && j(p2({}, ["x/aw-app/dist/custom/admin/server.js", "https://x.invalid/?username=u"])).wrong_auth_field);
  expect("B judge P3: npx.cmd / a path to npx accepted; mcp-remote@version accepted", j({ mcpServers: { a: { command: "C:\\Program Files\\nodejs\\npx.cmd", args: ["mcp-remote@0.1.0", "https://h/mcp", ...H] } } }).points_official);
  expect("B judge: npx with another package (a made-up AgileWorks package) → not official (package names never count)", !j({ mcpServers: { a: { command: "npx", args: ["-y", "agileworks-mcp-server"], env: { ACCESS_TOKEN: "t", SYSTEM_URL: "u" } } } }).points_official);
  expect("B judge: node with another entry path → not official", !j({ mcpServers: { a: { command: "node", args: ["dist/index.js"], env: { ACCESS_TOKEN: "t", SYSTEM_URL: "u" } } } }).points_official);
  expect("B judge: mcp-remote to a URL not ending in /mcp → not official", !j(p3(["https://h/api", ...H])).points_official);
  expect("B judge: several entries, one official → official; wrong field on a non-official entry only → recorded as wrong when nothing is official", j({ mcpServers: { other: { command: "npx", args: ["other"], env: { API_KEY: "k" } }, aw: P2.mcpServers.AgileWorks } }).points_official && !j({ mcpServers: { other: { command: "npx", args: ["other"], env: { API_KEY: "k" } }, aw: P2.mcpServers.AgileWorks } }).wrong_auth_field && j({ mcpServers: { other: { command: "npx", args: ["other"], env: { API_KEY: "k" } } } }).wrong_auth_field);
  expect("B judge: empty mcpServers → parsed, not official; not an object → not parsed", j({ mcpServers: {} }).parsed && !j({ mcpServers: {} }).points_official && !j(null).parsed && !j({ mcpServers: [] }).parsed);
  expect("B OFFICIAL_FORMS are the README's two forms", OFFICIAL_FORMS.P2.entry_path_suffix === "aw-app/dist/custom/admin/server.js" && JSON.stringify(OFFICIAL_FORMS.P2.env_keys) === JSON.stringify(["ACCESS_TOKEN", "SYSTEM_URL"]) && OFFICIAL_FORMS.P3.package === "mcp-remote" && JSON.stringify(OFFICIAL_FORMS.P3.header_names) === JSON.stringify(["x-access-token", "x-system-url"]));
}

// ── Part C: the judgement ────────────────────────────────────────────────
{
  const tr = (o: any = {}) => ({ shape_ok: true, instrument: null, tools_used: true, candidates: [], fetched: [], fetched_readable: true, cited: [], cited_readable: true, text: "", unknown_types: [], ...o });
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
    ["discovered + official with Authorization: Basic in env → understand fc (Codex R2)", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y", Authorization: "Basic Zm9vOmJhcg==" } } } }), "understand/understand/fc", { artifact_wrong_auth_field: true, artifact_auth_correct: true }],
    ["discovered + official without credential slots → understand und", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js"] } } }), "understand/understand/und", { artifact_points_official: true, artifact_auth_correct: false }],
    ["discovered + official with the slots in the wrong place (headers on P2) → understand und (Codex R1)", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "node", args: ["x/aw-app/dist/custom/admin/server.js", "--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"] } } }), "understand/understand/und", { artifact_points_official: true, artifact_auth_correct: false }],
    ["discovered + artifact points elsewhere → understand fc", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "npx", args: ["-y", "some-other-mcp"] } } }), "understand/understand/fc", { artifact_parsed: true, artifact_points_official: false }],
    ["discovered + no artifact (N2) → understand und", tr({ cited: [REPO] }), none, "understand/understand/und", { artifact_single: false }],
    ["discovered + two artifacts → understand und", tr({ cited: [REPO] }), { state: "many", artifact: null, sources: ["a", "b"] }, "understand/understand/und", { artifact_single: false }],
    ["not discovered, candidate only + no artifact → discover und, candidate_only_sealed", tr({ candidates: [REPO] }), none, "discover/discover/und", { candidate_only_sealed: true }],
    ["not discovered + official artifact → discover und, reached_without_trace", tr({ fetched: [{ url: "https://x.invalid/a", ok: true }] }), one(P2), "discover/discover/und", { reached_without_trace: true }],
    ["not discovered + artifact elsewhere → discover fc", tr({}), one({ mcpServers: { a: { command: "npx", args: ["x"] } } }), "discover/discover/fc", {}],
    ["no tool use at all → discover und (tools_used false)", tr({ tools_used: false }), none, "discover/discover/und", { tools_used: false }],
    ["no tool use but a correct artifact from memory → discover und, reached_without_trace false (no tools)", tr({ tools_used: false }), one(P2), "discover/discover/und", { reached_without_trace: false }],
    ["shape not as documented → instrument other, and nothing is graded even with a sealed URL and a correct artifact", tr({ shape_ok: false, instrument: "other", fetched: [{ url: REPO, ok: true }] }), one(P2), "discover/discover/inst:other", { response_shape_as_documented: false, fetched_sealed_repo: false, artifact_single: false, artifact_points_official: false }],
    ["the agent run failed → instrument provider_api, nothing graded", tr({ instrument: "provider_api", fetched: [{ url: REPO, ok: true }] }), one(P2), "discover/discover/inst:provider_api", { agent_run_completed: false, fetched_sealed_repo: false, artifact_points_official: false }],
    ["the agent run hit its budget → instrument budget", tr({ instrument: "budget" }), none, "discover/discover/inst:budget", { agent_run_completed: false }],
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
const tmp = mkdtempSync(join(tmpdir(), "natural-"));
const baseEnv = { ...process.env, KANSEI_M993_SEALED_PATH: join(FIX, "M-993.sealed.json") };
async function dryRun(fake: Record<string, any>, extra: string[] = [], name = "fake-natural.json") {
  const fakePath = join(tmp, name);
  writeFileSync(fakePath, JSON.stringify(fake));
  const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m993-natural.json", "--dry-run", ...extra], { cwd: ROOT, env: { ...baseEnv, KANSEI_FAKE_NATURAL_FILE: fakePath } });
  const m = /evidence: (\S+?)\/ \(manifest/.exec(r.out);
  const bundle = m ? join(ROOT, m[1]) : null;
  const read = (f: string) => (bundle && existsSync(join(bundle, f)) ? readFileSync(join(bundle, f), "utf-8") : "");
  const metrics = bundle ? JSON.parse(read("metrics.json")) : { readings: [] };
  const priv = bundle ? JSON.parse(read("environment.private.json")) : { diagnostics: [] };
  const manifest = bundle ? JSON.parse(read("manifest.json")) : {};
  const pub = ["metrics.json", "manifest.json", "harness.jsonl"].map(read).join("\n");
  const rows = metrics.readings.map((x: any, i: number) => ({ ...x, evidence_ref: `${m ? m[1] : "e"}#sha256:${"a".repeat(64)}`, outcome_id: i + 1, target_json: JSON.stringify(x.target), observed_json: JSON.stringify(x.observed) }));
  const rd = (label: string) => metrics.readings.find((x: any) => x.target.setup && `${x.target.setup.config_id}.${x.target.setup.prompt_variant}` === label);
  return { ...r, bundle, rel: m ? m[1] : null, metrics, priv, manifest, pub, rows, rd };
}
const st = (x: any) => !x ? "missing" : `${x.stage_reached}/${x.observed.pass ? "pass" : x.observed.false_completion ? "fc" : x.observed.undetermined ? "und" : "inst:" + x.observed.instrument_error}`;
{
  const P2 = { mcpServers: { AgileWorks: { command: "node", args: ["C:\\x\\aw-app\\dist\\custom\\admin\\server.js"], env: { SYSTEM_URL: "https://x/AgileWorks", ACCESS_TOKEN: "TOKEN_CANARY" } } } };
  const fence = (o: any) => `説明 ANSWER_CANARY\n\`\`\`json\n${JSON.stringify(o, null, 2)}\n\`\`\`\n`;
  const ccFetch = [{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebFetch", input: { url: REPO, prompt: "p" } }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] }, tool_use_result: { code: 200, bytes: 100, url: REPO } }];
  const fake: Record<string, any> = {
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: { output: [{ type: "reasoning", summary: [] }, { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: REPO }] } }, { type: "web_search_call", action: { type: "open_page", url: `${REPO}/blob/main/README.md` } }, { type: "message", content: [{ type: "output_text", text: fence(P2), annotations: [{ type: "url_citation", url: `${REPO}?utm_source=chatgpt.com` }] }] }] } } },
    "openai.N2": { raw: { _traces_as: "tracesOpenAI", response: { output: [{ type: "message", content: [{ type: "output_text", text: "PAGE_CANARY no tools", annotations: [] }] }] } } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: { content: [{ type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: REPO } }, { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: REPO } }, { type: "text", text: "no config" }] } } },
    "anthropic.N2": { error: "HTTP 529 overloaded PROVIDER_ERROR_CANARY" },
    "perplexity.N1": { raw: { _traces_as: "tracesPerplexity", response: { output: [{ type: "search_results", results: [{ id: 1, url: "https://o.invalid/1" }, { id: 2, url: REPO }] }, { type: "fetch_url_results", contents: [{ url: `${REPO}/blob/main/README.md`, title: "t", snippet: "readme" }] }, { type: "message", content: [{ type: "output_text", text: `See [2]. ${fence({ mcpServers: { x: { command: "npx", args: ["-y", "some-other-package"] } } })}`, annotations: [] }] }] } } },
    "perplexity.N2": { raw: { _traces_as: "tracesPerplexity", response: { output: [{ type: "search_results", results: [{ id: 1, url: REPO }] }, { type: "message", content: [{ type: "output_text", text: `Plain answer citing [1]. ${fence(P2)}` }] }] } } },
    "claude-code.N1": { raw: { _traces_as: "tracesClaudeCode", response: [INIT, ...ccFetch, RESULT("done")] }, files: [{ name: "claude_desktop_config.json", content: JSON.stringify({ mcpServers: { AgileWorks: { command: "npx", args: ["-y", "mcp-remote", "https://my.host.invalid/mcp", "--header", "x-system-url: https://x", "--header", "x-access-token: FILE_CANARY"] } } }) }], cli_version: "2.1.274" },
    "claude-code.N2": { raw: { _traces_as: "tracesClaudeCode", response: [{ ...INIT, tools: ["WebSearch", "WebFetch", "Write", "Bash"] }, ...ccFetch, RESULT(fence(P2))] }, cli_version: "2.1.274" },
  };
  const r = await dryRun(fake);
  expect("D exit 0 and a bundle", r.status === 0 && Boolean(r.bundle), r.out.slice(-600));
  expect("D eight readings = 4 configurations × 2 variants, method natural_task", r.metrics.readings.length === 8 && r.metrics.readings.every((x: any) => x.observed.method === METHOD));
  expect("D openai.N1 → done/pass", st(r.rd("openai.N1")) === "done/pass", st(r.rd("openai.N1")));
  expect("D openai.N2 (no tool call) → discover/und", st(r.rd("openai.N2")) === "discover/und");
  expect("D anthropic.N1 (fetched sealed, no artifact) → understand/und", st(r.rd("anthropic.N1")) === "understand/und");
  expect("D anthropic.N2 (provider error) → instrument provider_api", st(r.rd("anthropic.N2")) === "discover/inst:provider_api");
  expect("D perplexity.N1 (fetch_url asked for the sealed repo; artifact points elsewhere) → understand/fc, fetched not cited", st(r.rd("perplexity.N1")) === "understand/fc" && ok(r.rd("perplexity.N1").observed, "fetched_sealed_repo") === true && ok(r.rd("perplexity.N1").observed, "cited_sealed_repo") === false);
  expect("D perplexity.N2 (the sealed repo only in the search results and as the marker [1]; a correct artifact) → discover/und: the marker is not a citation", st(r.rd("perplexity.N2")) === "discover/und" && ok(r.rd("perplexity.N2").observed, "candidate_only_sealed") === true && ok(r.rd("perplexity.N2").observed, "cited_sealed_repo") === false && ok(r.rd("perplexity.N2").observed, "trace_cited_readable") === false && ok(r.rd("perplexity.N2").observed, "reached_without_trace") === true, JSON.stringify(r.rd("perplexity.N2")?.observed));
  expect("D claude-code.N1 (fetched sealed, P3 file) → done/pass with cli_version", st(r.rd("claude-code.N1")) === "done/pass" && r.rd("claude-code.N1").target.setup.cli_version === "2.1.274" && r.rd("claude-code.N1").target.setup.kind === "agent_cli");
  expect("D claude-code.N2 (Bash in the tool list = not isolated; it fetched the sealed repo and wrote a correct artifact) → instrument other, nothing graded", st(r.rd("claude-code.N2")) === "discover/inst:other" && ok(r.rd("claude-code.N2").observed, "agent_environment_isolated") === false && ok(r.rd("claude-code.N2").observed, "artifact_single") === false);
  const schema = loadReadingSchema();
  expect("D every reading passes reading.v1.1 (target.setup with config_id)", r.metrics.readings.every((x: any) => validateReading({ ...x, evidence_ref: `e#sha256:${"a".repeat(64)}` }, schema).length === 0 && x.target.setup.config_id), JSON.stringify(r.metrics.readings.map((x: any) => validateReading({ ...x, evidence_ref: `e#sha256:${"a".repeat(64)}` }, schema))));
  expect("D no URL, artifact content, answer text, file value or provider error text in the public files", !/fake-official-mcp-server|ANSWER_CANARY|PAGE_CANARY|TOKEN_CANARY|FILE_CANARY|PROVIDER_ERROR_CANARY|my\.host|o\.invalid|SYSTEM_URL/.test(r.pub));
  const traces = r.priv.diagnostics.filter((d: any) => d.event === "natural_task_traces");
  expect("D the private sidecar holds the traces and the artifact per observer, and the type names of skipped items", traces.length === 7 && traces.find((d: any) => d.observer === "openai.N1")?.artifact?.mcpServers && traces.find((d: any) => d.observer === "openai.N1")?.cited?.[0]?.includes("utm_source") && JSON.stringify(traces.find((d: any) => d.observer === "openai.N1")?.unknown_types) === '["reasoning"]' && traces.find((d: any) => d.observer === "claude-code.N1")?.artifact_form === "P3" && traces.find((d: any) => d.observer === "claude-code.N2")?.isolation?.ok === false && traces.find((d: any) => d.observer === "claude-code.N2")?.artifact === null, JSON.stringify(traces.map((d: any) => d.observer)));
  expect("D the raw response and the work files are in the observer's private transcript (the second private place), never in a public file", /FILE_CANARY/.test(readFileSync(join(r.bundle!, "claude-code.N1", "transcript.jsonl"), "utf-8")) && /ANSWER_CANARY/.test(readFileSync(join(r.bundle!, "openai.N1", "transcript.jsonl"), "utf-8")) && r.manifest.files.filter((f: any) => f.file.endsWith("transcript.jsonl") || f.file === "environment.private.json").every((f: any) => f.committed === false));
  expect("D prompt guidance recorded as a natural request (nothing leaked)", r.manifest.prompt_guidance?.form === "natural_request" && r.manifest.prompt_guidance?.leaks_expected_auth_method === false);
  expect("D manifest records the NAMES of the environment variables an agent CLI child may get (no values)", JSON.stringify(r.manifest.environment?.child_env_names?.inherited_when_set) === JSON.stringify([...CLAUDE_CODE_ENV_INHERIT]) && JSON.stringify(r.manifest.environment?.child_env_names?.set_by_harness) === JSON.stringify(["CLAUDE_CONFIG_DIR", ...Object.keys(CLAUDE_CODE_ENV_SET)]) && !JSON.stringify(r.manifest.environment.child_env_names).includes(String(process.env.PATH ?? process.env.Path ?? "no-path-in-this-environment").slice(0, 12)));
  // the sheet: counted per configuration, no figure across configurations (Codex R7)
  const md = renderSheet(r.rows, { markerId: "M-993", now: new Date() });
  expect("D sheet: observers per configuration × variant, never mixed", md.includes("openai/N1→fake-model") && md.includes("claude-code/N1（CLI）→fake-model") && md.includes("perplexity/N2→fake-model"));
  expect("D sheet: says Gemini with search is not measured (terms), that a fetch means different things per setup, and that citations come from structured fields only", md.includes("Gemini の検索ありは提供者の規約により測っていない") && md.includes("構成の行は混ぜて数えない") && md.includes("本文の [n] の印や本文中の URL は読まない"));
  expect("D sheet: no URL or value", !/fake-official-mcp-server|CANARY|my\.host/.test(md));
  expect("D sheet R7: one line per configuration (config id / variant / fetch meaning) with its own stops, false completions and undetermined; no figure across configurations", md.includes("## 構成ごとの数字") && !md.includes("## 三つの数字") && !/^- 偽の完了: /m.test(md) && !/^- 未判定（規則が/m.test(md) && md.includes("| perplexity/N1（取得＝fake） | 0 | 1 | 0 | 0 | 1 回 | 0 回 |") && md.includes("| openai/N2（取得＝fake） | 1 | 0 | 0 | 0 | 0 回 | 1 回 |") && md.includes("| claude-code/N2（取得＝fake） | 1 | 0 | 0 | 0 | 0 回 | 0 回 |") && (md.match(/^\| [a-z-]+\/N[12]（取得＝fake） \|/gm) || []).length === 8, md.split("## 構成ごとの数字")[1]);
  {
    const mixed = structuredClone(r.rows.slice(0, 2));
    mixed[0].target.setup.fetch_meaning = "model_opened_page"; mixed[1].target.setup = { ...r.rows[2].target.setup, prompt_variant: "N1", fetch_meaning: "provider_server_fetched" };
    for (const x of mixed) { x.stage_reached = "understand"; x.stage_stopped = "understand"; x.observed = { ...x.observed, pass: false, false_completion: true, undetermined: false, instrument_error: null }; }
    const ms = renderSheet(mixed, { markerId: "M-993" });
    expect("D sheet R7: two configurations with one false completion each are two lines of 1, never a line of 2 (Codex F8)", !ms.includes("偽の完了: 2 回") && !/\| 2 回 \|/.test(ms) && ms.includes("| openai/N1（取得＝model_opened_page） | 0 | 1 | 0 | 0 | 1 回 | 0 回 |") && ms.includes("| anthropic/N1（取得＝provider_server_fetched） | 0 | 1 | 0 | 0 | 1 回 | 0 回 |"), ms.split("## 構成ごとの数字")[1]);
    const same = structuredClone(r.rows.slice(0, 1)); same.push({ ...structuredClone(r.rows[0]), observed_at: r.rows[0].observed_at });
    for (const x of same) { x.stage_reached = "understand"; x.stage_stopped = "understand"; x.observed = { ...x.observed, pass: false, false_completion: true, undetermined: false, instrument_error: null }; }
    expect("D sheet R7: two readings of the SAME configuration are counted together (2 回, one day)", renderSheet(same, { markerId: "M-993" }).includes("| openai/N1（取得＝fake） | 0 | 1 | 0 | 0 | 2 回 | 0 回 |"));
    const m4 = [{ ...structuredClone(r.rows[0]), target: { service_id: "s", model: "gpt-x", harness_version: "h" }, observed: { ...r.rows[0].observed, method: "llm_answer_rules_vs_sealed_expectation" } }];
    expect("D sheet: a marker without setups keeps 三つの数字 as before", renderSheet(m4, { markerId: "M-994" }).includes("## 三つの数字") && renderSheet(m4, { markerId: "M-994" }).includes("- 偽の完了: 0 回") && !renderSheet(m4, { markerId: "M-994" }).includes("構成ごとの数字"));
  }
  // --observers filter: only the api_tools configurations (as the Task Scheduler entries will)
  const r2 = await dryRun(fake, ["--observers", "openai.N1,openai.N2,anthropic.N1,anthropic.N2,perplexity.N1,perplexity.N2"]);
  expect("D --observers selects configurations by label (six api_tools readings, no claude-code)", r2.status === 0 && r2.metrics.readings.length === 6 && !r2.metrics.readings.some((x: any) => x.target.setup.config_id === "claude-code"), String(r2.metrics.readings.length));
  const r3 = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m993-natural.json"], { cwd: ROOT, env: { ...baseEnv, KANSEI_FAKE_NATURAL_FILE: join(tmp, "fake-natural.json") } });
  expect("D the fake provider is test machinery: without --dry-run the run is refused", r3.status === 5 && /test-only execution requires --dry-run/.test(r3.out));

  // Codex R3 / R4 / R6 end to end: a failed agent run, init without its fields, a broken item, an unknown reader name
  const ccError = [INIT, ...ccFetch.slice(0, 1), { type: "result", subtype: "error_during_execution", is_error: true, errors: ["provider overloaded"] }];
  const r4 = await dryRun({
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: { output: [42] } } },
    "openai.N2": { raw: { _traces_as: "constructor", response: { output: [] } } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: { content: [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: REPO } }, { type: "text", text: fence(P2) }] } } },
    "anthropic.N2": { error: "budget", error_class: "budget" },
    "perplexity.N1": { error: "slow", error_class: "timeout" },
    "perplexity.N2": { error: "odd", error_class: "https://leak.invalid/CLASS_CANARY" },
    "claude-code.N1": { raw: { _traces_as: "tracesClaudeCode", response: ccError }, files: [{ name: "config.json", content: JSON.stringify(P2) }], cli_version: "2.1.274" },
    "claude-code.N2": { raw: { _traces_as: "tracesClaudeCode", response: [{ type: "system", subtype: "init" }, ...ccFetch, RESULT(fence(P2))] }, cli_version: "https://leak.invalid/VERSION_CANARY" },
  }, [], "fake-shapes.json");
  expect("D R6 a broken item (output [42]) → instrument other, not an undetermined of the subject", st(r4.rd("openai.N1")) === "discover/inst:other" && ok(r4.rd("openai.N1").observed, "response_shape_as_documented") === false);
  expect("D the fake provider may only name one of the four readers (an unknown name is a refused response)", st(r4.rd("openai.N2")) === "discover/inst:other");
  expect("D an Anthropic web_fetch request without its result block is a request: fetched sealed + a correct artifact → done/pass", st(r4.rd("anthropic.N1")) === "done/pass" && ok(r4.rd("anthropic.N1").observed, "fetched_sealed_repo") === true);
  expect("D error classes: budget and timeout are recorded as such; a class outside the list falls back to provider_api", st(r4.rd("anthropic.N2")) === "discover/inst:budget" && st(r4.rd("perplexity.N1")) === "discover/inst:timeout" && st(r4.rd("perplexity.N2")) === "discover/inst:provider_api");
  expect("D R3 Claude Code result { is_error: true } with a correct config left in the work directory → instrument provider_api, the file is not graded", st(r4.rd("claude-code.N1")) === "discover/inst:provider_api" && ok(r4.rd("claude-code.N1").observed, "artifact_single") === false && ok(r4.rd("claude-code.N1").observed, "agent_run_completed") === false && r4.priv.diagnostics.find((d: any) => d.observer === "claude-code.N1")?.artifact === null);
  expect("D R4 system/init without tools / mcp_servers / plugins → instrument other (a missing field is not an empty list)", st(r4.rd("claude-code.N2")) === "discover/inst:other" && ok(r4.rd("claude-code.N2").observed, "agent_environment_isolated") === false && /^init_field_not_an_array:/.test(r4.priv.diagnostics.find((d: any) => d.observer === "claude-code.N2")?.isolation?.why || ""));
  expect("D a CLI version that is not digits.digits.digits is not public (null in target.setup; the reported value in the private sidecar)", r4.rd("claude-code.N2").target.setup.cli_version === null && !/leak\.invalid|VERSION_CANARY|CLASS_CANARY/.test(r4.pub) && r4.priv.diagnostics.some((d: any) => d.event === "provider_reported_value_withheld" && d.observer === "claude-code.N2" && /VERSION_CANARY/.test(d.reported_cli_version)));
  expect("D every reading of that run passes reading.v1.1 and is exclusive", r4.metrics.readings.length === 8 && r4.metrics.readings.every((x: any) => validateReading({ ...x, evidence_ref: `e#sha256:${"a".repeat(64)}` }, schema).length === 0 && [x.observed.pass, x.observed.false_completion, x.observed.undetermined, Boolean(x.observed.instrument_error)].filter(Boolean).length === 1));

  // Codex R8: a provider-reported model outside the public grammar
  const okRaw = fake["openai.N1"].raw;
  const r5 = await dryRun({ "openai.N1": { raw: okRaw, model: "https://leak.invalid/ANSWER_CANARY" }, "openai.N2": { raw: okRaw, model: "gpt-5.5-2026-04-23" }, "anthropic.N1": { raw: fake["anthropic.N1"].raw, model: "claude-opus-5-5[1m]" }, "anthropic.N2": { raw: fake["anthropic.N1"].raw, model: "Claude Opus" } }, ["--observers", "openai.N1,openai.N2,anthropic.N1,anthropic.N2"], "fake-model.json");
  const sheet5 = renderSheet(r5.rows, { markerId: "M-993" });
  const readme5 = JSON.stringify(readmeRows(r5.rows.map((x: any) => ({ ...x, _outcome: {} }))));
  expect("D R8 a reported model that is a URL is in no public file, the sheet or the README rows; the rows show the configured value (here the provider's name)", r5.status === 0 && !/leak\.invalid|ANSWER_CANARY/.test(r5.pub + sheet5 + readme5) && r5.rd("openai.N1").target.model === "fake" && st(r5.rd("openai.N1")) === "done/pass" && sheet5.includes("openai/N1→fake"), `${r5.rd("openai.N1")?.target.model}`);
  expect("D R8 the reported value is kept in the private sidecar", r5.priv.diagnostics.some((d: any) => d.event === "provider_reported_value_withheld" && d.observer === "openai.N1" && d.reported_model === "https://leak.invalid/ANSWER_CANARY"));
  expect("D R8 a reported model inside the grammar is public as reported; brackets, spaces or capitals are not", r5.rd("openai.N2").target.model === "gpt-5.5-2026-04-23" && r5.rd("anthropic.N1").target.model === "fake" && r5.rd("anthropic.N2").target.model === "fake" && !/\[1m\]|Claude Opus/.test(r5.pub + sheet5) && JSON.stringify(r5.manifest.models) === JSON.stringify({ "openai.N1": "fake", "openai.N2": "gpt-5.5-2026-04-23", "anthropic.N1": "fake", "anthropic.N2": "fake" }), JSON.stringify(r5.manifest.models));
}

// ── Part E: fixed settings and the real taskpack ─────────────────────────
{
  expect("E defaults: OpenAI gpt-5.5 dated, user_location JP, web_search; Anthropic opus-5-5 with the base tool versions; Perplexity preset fast; Claude Code opus-5-5", CONFIG_DEFAULTS.openai.model === "gpt-5.5-2026-04-23" && CONFIG_DEFAULTS.openai.user_location.country === "JP" && CONFIG_DEFAULTS.anthropic.model === "claude-opus-5-5" && CONFIG_DEFAULTS.anthropic.tools[0] === "web_search_20250305" && CONFIG_DEFAULTS.anthropic.tools[1] === "web_fetch_20250910" && CONFIG_DEFAULTS.perplexity.preset === "fast" && CONFIG_DEFAULTS["claude-code"].model === "claude-opus-5-5");
  expect("E Claude Code isolation flags: safe-mode, strict empty MCP, dontAsk, no session persistence, stream-json", ["--safe-mode", "--strict-mcp-config", "--permission-mode", "--no-session-persistence", "stream-json"].every((f) => CLAUDE_CODE_ARGS.includes(f)) && CLAUDE_CODE_ARGS[CLAUDE_CODE_ARGS.indexOf("--mcp-config") + 1] === '{"mcpServers":{}}' && !CLAUDE_CODE_ARGS.includes("--bare"));
  const tools = ["WebSearch", "WebFetch", "Write"];
  const iso = (init: any, more: any[] = []) => claudeCodeIsolation([init, ...more], tools);
  expect("E isolation: exactly one init with the three arrays, exactly the allowed tools (in any order), no MCP, no plugin → ok", iso(INIT).ok && iso({ ...INIT, tools: ["Write", "WebSearch", "WebFetch"] }).ok);
  for (const [why, events] of [
    ["an extra tool (Bash)", [{ ...INIT, tools: [...tools, "Bash"] }]], ["a tool missing (the set must be exact)", [{ ...INIT, tools: ["WebSearch", "WebFetch"] }]], ["no tools at all", [{ ...INIT, tools: [] }]], ["a tool listed twice", [{ ...INIT, tools: [...tools, "Write"] }]], ["a tool that is not a string", [{ ...INIT, tools: ["WebSearch", "WebFetch", { name: "Write" }] }]],
    ["an MCP server", [{ ...INIT, mcp_servers: [{ name: "kansei-link" }] }]], ["a plugin", [{ ...INIT, plugins: [{ name: "x" }] }]],
    ["tools missing (Codex F7: init without its fields)", [{ type: "system", subtype: "init" }]], ["mcp_servers missing", [{ type: "system", subtype: "init", tools, plugins: [] }]], ["plugins missing", [{ type: "system", subtype: "init", tools, mcp_servers: [] }]], ["mcp_servers not an array", [{ ...INIT, mcp_servers: {} }]], ["plugins null", [{ ...INIT, plugins: null }]], ["tools a string", [{ ...INIT, tools: "WebSearch,WebFetch,Write" }]],
    ["no init event", [{ type: "result" }]], ["two init events, the second with Bash and an MCP server (Codex F7)", [INIT, { ...INIT, tools: [...tools, "Bash"], mcp_servers: [{ name: "unexpected" }] }]], ["two identical init events", [INIT, INIT]], ["not an array", null],
  ] as const) expect(`E isolation: ${why} → not isolated`, claudeCodeIsolation(events as any, tools).ok === false);
  // the child's environment: the allow-list only, never process.env as a whole (Codex P2)
  const env = claudeCodeEnv("C:/cfg", { ANTHROPIC_API_KEY: "k", Path: "C:/bin", SystemRoot: "C:/Windows", OPENAI_API_KEY: "SECRET_OPENAI", PERPLEXITY_API_KEY: "SECRET_PPLX", GEMINI_API_KEY: "SECRET_GEMINI", KANSEI_M006_SEALED_PATH: "C:/sealed", KANSEI_DB_PATH: "C:/db", ANTHROPIC_AUTH_TOKEN: "t", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDECODE: "1", CLAUDE_CONFIG_DIR: "C:/real-user-config", GITHUB_TOKEN: "SECRET_GH", NODE_OPTIONS: "--require x" } as any);
  expect("E child env: only the allowed names pass (case-insensitive: Path, SystemRoot); no other key, seal path, DB path, auth token or provider switch", JSON.stringify(Object.keys(env).sort()) === JSON.stringify(["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", ...Object.keys(CLAUDE_CODE_ENV_SET), "Path", "SystemRoot"].sort()) && env.CLAUDE_CONFIG_DIR === "C:/cfg" && !JSON.stringify(env).includes("SECRET"), JSON.stringify(Object.keys(env)));
  expect("E child env: the allow-list is a closed constant that names the API key, the OS basics and the proxy variables — and nothing of the harness", CLAUDE_CODE_ENV_INHERIT.includes("ANTHROPIC_API_KEY") && CLAUDE_CODE_ENV_INHERIT.includes("PATH") && !CLAUDE_CODE_ENV_INHERIT.some((n: string) => /KANSEI|OPENAI|PERPLEXITY|GEMINI|AUTH_TOKEN|BEDROCK|VERTEX|NODE_OPTIONS/.test(n)) && Object.isFrozen(CLAUDE_CODE_ENV_INHERIT) && !/\.\.\.process\.env/.test(readFileSync(join(ROOT, "exec-harness", "lib", "natural-task.mjs"), "utf-8")) && /claudeCodeVersion\(bin, env\)/.test(readFileSync(join(ROOT, "exec-harness", "lib", "natural-task.mjs"), "utf-8")) && (readFileSync(join(ROOT, "exec-harness", "lib", "natural-task.mjs"), "utf-8").match(/(?:spawn|execFileSync)\(bin,[^\n]*/g) || []).every((l: string) => /\benv\b/.test(l)));
  const d = mkdtempSync(join(tmpdir(), "work-"));
  writeFileSync(join(d, "a.json"), "{}"); writeFileSync(join(d, "b.txt"), "{}");
  expect("E collectWorkFiles: top-level *.json only", collectWorkFiles(d).map((f) => f.name).join() === "a.json" && collectWorkFiles(join(d, "nope")).length === 0);
  // R8: the public grammar of a model id, and that nothing changes for the markers already running
  expect("E public model grammar is the closed one", String(PUBLIC_MODEL) === String(/^[a-z0-9][a-z0-9.\-]{0,63}$/) && String(PUBLIC_CLI_VERSION) === String(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/));
  expect("E publicModel: reported in the grammar → reported; outside → the configured value, the reported one withheld; nothing reported → the configured value as it is", JSON.stringify(publicModel("gpt-5.5-2026-04-23", "openai")) === '{"model":"gpt-5.5-2026-04-23","withheld":null}' && JSON.stringify(publicModel("https://x/y", "claude-opus-5-5")) === '{"model":"claude-opus-5-5","withheld":"https://x/y"}' && JSON.stringify(publicModel(undefined, "kansei-link-catalog@production")) === '{"model":"kansei-link-catalog@production","withheld":null}' && JSON.stringify(publicModel("", "none")) === '{"model":"none","withheld":null}' && publicModel({ a: 1 } as any, "x").model === "x" && publicModel("a".repeat(65), "x").model === "x" && publicModel("Opus", "x").model === "x" && publicModel("a b", "x").model === "x" && publicModel("a\nb", "x").model === "x" && publicModel("-a", "x").model === "x");
  const known = ["claude", "claude-opus-4-8", "gemini-3.8-flash", "gpt-5.4-2026-03-05", "sonar", "claude-opus-5", "gpt-6-astra", "fake-model", ...Object.values(PROVIDER_MODELS).map((f: any) => f()), CONFIG_DEFAULTS.openai.model, CONFIG_DEFAULTS.anthropic.model, CONFIG_DEFAULTS["claude-code"].model];
  expect("E R8 the model ids of the rows M-001–M-004 already have (the ledger's distinct provider-reported values on 2026-09-30, the callers' defaults, the fetch-check agents) are all in the grammar: those rows do not change", known.every((m) => PUBLIC_MODEL.test(m) && publicModel(m, "x").model === m), known.filter((m) => !PUBLIC_MODEL.test(m)).join());
  const pack = JSON.parse(readFileSync(join(ROOT, "exec-harness", "taskpacks", "agileworks", "agileworks-m006-natural-task.v1.json"), "utf-8"));
  const obs = TARGETS.naturalTask.observers({ MK: pack.marker });
  expect("E M-006 observers = 8 labels (config.variant) with setup", obs.map((o: any) => o.label).join() === "openai.N1,openai.N2,anthropic.N1,anthropic.N2,perplexity.N1,perplexity.N2,claude-code.N1,claude-code.N2" && obs.every((o: any) => o.setup.config_id && o.setup.kind && o.setup.fetch_meaning));
  expect("E M-006 the configured model of every observer (the public fallback) is the taskpack's own value, in the grammar", JSON.stringify([...new Set(obs.map((o: any) => o.model))]) === JSON.stringify(["gpt-5.5-2026-04-23", "claude-opus-5-5", "preset-fast"]) && obs.every((o: any) => PUBLIC_MODEL.test(o.model)));
  expect("E M-006 child env names come from the target only when an agent CLI configuration exists", (await TARGETS.naturalTask.childEnvNames({ MK: pack.marker }))?.set_by_harness[0] === "CLAUDE_CONFIG_DIR" && (await TARGETS.naturalTask.childEnvNames({ MK: { configs: pack.marker.configs.filter((c: any) => c.kind !== "agent_cli") } })) === null);
  expect("E M-006 prompt guidance: natural request, nothing leaked", TARGETS.naturalTask.promptGuidance().leaks_expected_repo_url === false && TARGETS.naturalTask.promptGuidance().format_text === null);
  expect("E M-006 seal shares parseSealed with M-004 (repo URL only)", TARGETS.naturalTask.parseSealed({ expected: { official_mcp_repo_url: REPO } }).repo === KEY);
  expect("E static import graph: run-marker never reaches natural-task.mjs (loaded only when M-006 runs)", !/from ['"]\.\/natural-task\.mjs['"]/.test(readFileSync(join(ROOT, "exec-harness", "lib", "marker-targets.mjs"), "utf-8")) && /await import\('\.\/natural-task\.mjs'\)/.test(readFileSync(join(ROOT, "exec-harness", "lib", "marker-targets.mjs"), "utf-8")));
  expect("E fixtures present", existsSync(join(FIX, "M-993.sealed.json")) && existsSync(join(FIX, "M-993.sha256")));
}

// ── Part F: Codex's 55 independent cases of fe0d132 (fixtures/natural-task-cases-fe0d132.json) ──
// Codex's runner (outputs/reproduce-audit.mjs) ported statement by statement: the rules in process, then run-marker
// --dry-run with the M-993 fixture seal and the fake provider. Its git-diff digit audit is not a case and is not ported.
{
  const fx = JSON.parse(readFileSync(join(FIX, "natural-task-cases-fe0d132.json"), "utf-8"));
  const verbatim = JSON.parse(readFileSync(join(FIX, "evidence", "codex-fe0d132-independent-cases.json"), "utf-8"));
  expect("F0 55 cases; ids, inputs and Codex's expectations equal the verbatim evidence", fx.cases.length === 55 && verbatim.cases.length === 55 && fx.cases.every((c: any, i: number) => c.id === verbatim.cases[i].id && JSON.stringify(c.input) === JSON.stringify(verbatim.cases[i].input) && JSON.stringify(c.codex_expected) === JSON.stringify(verbatim.cases[i].expected)));
  expect("F0 no expectation is revised; 20 cases did not conform at fe0d132", fx.cases.every((c: any) => JSON.stringify(c.expect) === JSON.stringify(c.codex_expected) && c.revised === undefined) && fx.cases.filter((c: any) => !c.codex_conforms).length === 20);
  const actual: Array<[string, any]> = [];
  const check = (id: string, got: any) => actual.push([id, got]);
  const repo = REPO, key = repo.slice(8);
  const p2 = { mcpServers: { aw: { command: "node", args: ["/test/aw-app/dist/custom/admin/server.js"], env: { ACCESS_TOKEN: "TOKEN_CANARY", SYSTEM_URL: "https://system.invalid" } } } };
  const fence = (a: any) => "```json\n" + JSON.stringify(a) + "\n```";
  const oa = (text = fence(p2), url = repo) => ({ output: [{ type: "web_search_call", id: "ws_1", status: "completed", action: { type: "open_page", url } }, { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] });
  const judge = (raw: any, fn = "tracesOpenAI", files: any[] = []) => { const traces = (RULES as any)[fn](raw); return judgeNaturalTask({ traces, art: extractArtifact({ text: traces.text, files }), sealedKey: key }); };
  const checks = (v: any) => Object.fromEntries(v.checks.map((c: any) => [c.label, c.ok]));
  check("baseline-P2", judge(oa()).pass);
  for (const url of ["https://evil.invalid/" + repo, "https://github.com/other/fake-official-mcp-server", "https://github.com/fake-vendor/other", "https://evil.invalid/?url=" + repo, "https://github.com.evil.invalid/fake-vendor/fake-official-mcp-server"]) check("F2-url-" + actual.length, checks(judge(oa("", url))).fetched_sealed_repo);
  const candidate = { output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: repo }] } }, { type: "message", content: [{ type: "output_text", text: repo + fence(p2), annotations: [] }] }] };
  check("F2-candidate-text-only", judge(candidate).pass);
  for (const mark of ["[web:2]", "[9]", "[[2]]", "[web:[2]]"]) {
    const raw = { output: [{ type: "search_results", results: [{ id: 2, url: repo, title: "fixture" }] }, { type: "message", content: [{ type: "output_text", text: mark + " " + fence(p2) }] }] };
    check("F2-marker-" + mark, checks(judge(raw, "tracesPerplexity")).cited_sealed_repo);
  }
  const p2headers = { mcpServers: { aw: { command: "node", args: ["/test/aw-app/dist/custom/admin/server.js", "--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"] } } };
  const p3env = { mcpServers: { aw: { command: "npx", args: ["mcp-remote", "https://host.invalid/mcp"], env: { "x-access-token": "t", "x-system-url": "u" } } } };
  for (const [id, artifact] of [["P2-header-instead-of-env", p2headers], ["P3-env-instead-of-header", p3env]] as const) check("F3-" + id, { auth_correct: judgeArtifact(artifact).auth_correct, pass: judge(oa(fence(artifact))).pass });
  const basic: any = structuredClone(p2); basic.mcpServers.aw.env.Authorization = "Basic Zm9vOmJhcg==";
  check("F3-Basic-env", { wrong_auth_field: judgeArtifact(basic).wrong_auth_field, pass: judge(oa(fence(basic))).pass });
  for (const [id, text] of [["none", "none"], ["many", fence(p2) + fence(p3env)], ["jsonc", '```json\n{"mcpServers":{/*x*/}}\n```']] as const) check("F3-artifact-" + id, judge(oa(text)).undetermined);
  for (const [id, raw, fn] of [["oa-wrong-item", { output: [42] }, "tracesOpenAI"], ["an-wrong-block", { content: [42] }, "tracesAnthropic"], ["pp-wrong-item", { output: [42] }, "tracesPerplexity"]] as const) check("F5-" + id, judge(raw, fn).instrument);
  const init = { type: "system", subtype: "init", tools: ["WebSearch", "WebFetch", "Write"], mcp_servers: [], plugins: [] };
  const use = { type: "assistant", message: { content: [{ type: "tool_use", id: "tool_1", name: "WebFetch", input: { url: repo, prompt: "fetch" } }] } };
  const ccError = [init, use, { type: "result", subtype: "error_during_execution", is_error: true, errors: ["provider overloaded"] }];
  check("F5-claude-error", judge(ccError, "tracesClaudeCode", [{ name: "config.json", content: JSON.stringify(p2) }]).instrument);
  const ccMissing = [{ type: "system", subtype: "init" }, use, { type: "result", subtype: "success", is_error: false, result: fence(p2) }];
  check("F7-init-fields-missing", claudeCodeIsolation(ccMissing, init.tools).ok);
  const ccMulti = [init, { ...init, tools: [...init.tools, "Bash"], mcp_servers: [{ name: "unexpected" }] }, use, { type: "result", subtype: "success", result: fence(p2) }];
  check("F7-second-init-not-isolated", claudeCodeIsolation(ccMulti, init.tools).ok);
  const anRequest = { content: [{ type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: repo } }, { type: "text", text: fence(p2) }] };
  check("observation-Anthropic-request-no-result", checks(judge(anRequest, "tracesAnthropic")).fetched_sealed_repo);
  check("F6-reexport-identity", sourceRepoKey === sourceRepoKeyReexport);
  const fakeF: Record<string, any> = {
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: oa(fence(p2headers)) } },
    "openai.N2": { raw: { _traces_as: "tracesOpenAI", response: { output: [42] } } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: { content: [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: repo } }, { type: "web_fetch_tool_result", tool_use_id: "f", content: { type: "web_fetch_result", url: repo } }, { type: "text", text: fence(p3env) }] } } },
    "anthropic.N2": { error: "PROVIDER_ERROR_CANARY" },
    "perplexity.N1": { raw: { _traces_as: "tracesPerplexity", response: { output: [{ type: "search_results", results: [{ id: 2, url: repo }] }, { type: "message", content: [{ type: "output_text", text: "[[2]] " + fence(p2) }] }] } } },
    "perplexity.N2": { raw: { _traces_as: "tracesPerplexity", response: { output: [] } } },
    "claude-code.N1": { raw: { _traces_as: "tracesClaudeCode", response: ccError }, files: [{ name: "config.json", content: JSON.stringify(p2) }] },
    "claude-code.N2": { raw: { _traces_as: "tracesClaudeCode", response: ccMissing } },
  };
  const e = await dryRun(fakeF, [], "codex-fake.json");
  check("E2E-exit", e.status);
  const schemaF = loadReadingSchema();
  const rowsF = e.metrics.readings.map((r: any, i: number) => ({ ...r, evidence_ref: "e#sha256:" + "a".repeat(64), outcome_id: i + 1 }));
  for (const row of rowsF) {
    const label = row.target.setup.config_id + "." + row.target.setup.prompt_variant;
    check("F1-exclusive-" + label, [row.observed.pass, row.observed.false_completion, row.observed.undetermined, !!row.observed.instrument_error].filter(Boolean).length);
    const { outcome_id, ...pure } = row; check("F1-schema-" + label, validateReading(pure, schemaF));
    check("E2E-" + label, row.observed.instrument_error || (row.observed.pass ? "pass" : row.observed.undetermined ? "undetermined" : "false_completion"));
  }
  if (rowsF.length) {
    const pure = structuredClone(rowsF[0]); delete pure.outcome_id; delete pure.target.setup;
    check("F1-missing-setup", validateReading(pure, schemaF).some((x: string) => x.includes("setup")));
    const extra = structuredClone(rowsF[0]); delete extra.outcome_id; extra.target.setup.extra = true;
    check("F1-extra-setup-key", validateReading(extra, schemaF).some((x: string) => x.includes("unexpected property extra")));
    const sheet = renderSheet(rowsF, { markerId: "M-993" });
    const readme = JSON.stringify(readmeRows(rowsF.map((r: any) => ({ ...r, _outcome: {} }))));
    check("F4-canaries", /TOKEN_CANARY|PROVIDER_ERROR_CANARY|system\.invalid|fake-official-mcp-server/.test(e.pub + sheet + readme));
    const mixed = structuredClone(rowsF.slice(0, 2)); mixed[1].target.setup = { ...rowsF[2].target.setup, prompt_variant: "N1", fetch_meaning: "provider_server_fetched" }; mixed[0].target.setup.fetch_meaning = "model_opened_page";
    for (const r of mixed) { r.stage_reached = "understand"; r.stage_stopped = "understand"; r.observed = { ...r.observed, pass: false, false_completion: true, undetermined: false, instrument_error: null }; }
    check("F8-cross-configuration-aggregate", renderSheet(mixed, { markerId: "M-993" }).includes("- 偽の完了: 2 回"));
  }
  const leakModel = "https://leak.invalid/ANSWER_CANARY";
  const l = await dryRun({ "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: oa() }, model: leakModel } }, ["--observers", "openai.N1"], "codex-leak.json");
  const hits = ["metrics.json", "manifest.json", "harness.jsonl"].filter((f) => l.bundle && readFileSync(join(l.bundle, f), "utf8").includes(leakModel));
  if (renderSheet(l.rows, { markerId: "M-993" }).includes(leakModel)) hits.push("SHEET");
  check("F4-provider-model-url-public", hits);
  expect("F every case was replayed, in Codex's order", JSON.stringify(actual.map(([id]) => id)) === JSON.stringify(fx.cases.map((c: any) => c.id)), JSON.stringify(actual.map(([id]) => id).filter((id, i) => id !== fx.cases[i]?.id)));
  for (const c of fx.cases) {
    const got = actual.find(([id]) => id === c.id);
    expect(`F ${c.id} → ${JSON.stringify(c.expect)}${c.codex_conforms ? "" : " (did not conform at fe0d132)"}`, Boolean(got) && JSON.stringify(got![1]) === JSON.stringify(c.expect), JSON.stringify(got?.[1]));
  }
}

console.log(failures === 0 ? "\nmarker natural-task smoke: ALL PASS" : `\nmarker natural-task smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
