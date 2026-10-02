#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth = natural_task (M-006): the natural-task reading judged from two closed traces.
 *
 *   npx tsx scripts/smoke-marker-natural-task.mts
 *
 * Two configurations since 2026-10-02 (Codex review of 79e624d): OpenAI Responses (web_search) and Anthropic
 * Messages (web_search + web_fetch). Perplexity and Claude Code are not configurations (taskpack not_measured).
 *
 * Part A: the shape table (lib/natural-task-rules.mjs SHAPES) and its one checker: what each reader takes from a
 *         response shaped as docs/provider-shapes/ copies; the top level (OpenAI status / error / output — N4;
 *         Anthropic turns, content never coerced — N2, stop_reason, pause_turn); every required field of a known
 *         type (N3); unknown well-formed types skipped by name; a block without annotations / citations cites nothing
 *         of its own while the other blocks' citations stay; a field that is not in the table is never read.
 * Part B: the artifact — extraction, and the README's two forms read by position with three values
 *         (official / other / unclear — N1), the credential slots in their own place, wrong credentials anywhere.
 * Part C: the judgement table (exactly one of pass / false_completion / undetermined / instrument).
 * Part D: run-marker end to end in --dry-run with the M-993 fixture seal and the fake provider.
 * Part E: the callers (loopback fetch; continuation of pause_turn), the removed parts, the real M-006 taskpack.
 * Part M: mutation tests, machine-made: from good responses (two providers × N1 / N2) every field of the table is
 *         deleted (when required) or given another type (42 / null / [] / {}), the top level is made 42, the OpenAI
 *         status failed, the Anthropic content 42 — every one must be the instrument other (never pass / false
 *         completion / undetermined). From the two official artifacts every part of command / args / env is broken
 *         one at a time — none may be done.
 * Part F: Codex's 55 cases of fe0d132 (fixtures/natural-task-cases-fe0d132.json), its runner ported.
 * Part G: Codex's 83 cases of 79e624d (fixtures/natural-task-cases-79e624d.json), its runner ported.
 * No network, no real seal, no DB, no CLI is started.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { tracesOpenAI, tracesAnthropic, TRACE_READERS, SHAPES, WEB_SEARCH_CONTENT, checkShape, extractArtifact, judgeArtifact, judgeNaturalTask, entryForm, OFFICIAL_FORMS, METHOD } from "../exec-harness/lib/natural-task-rules.mjs";
import * as RULES from "../exec-harness/lib/natural-task-rules.mjs";
import * as CALLER from "../exec-harness/lib/natural-task.mjs";
import { CONFIG_DEFAULTS, MAX_CONTINUATIONS, runNaturalTask } from "../exec-harness/lib/natural-task.mjs";
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
const LIB = join(ROOT, "exec-harness", "lib");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };
const spawnAsync = (cmd: string, args: string[], opts: any): Promise<{ status: number | null; out: string }> => new Promise((res) => { const p = spawn(cmd, args, opts); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ status: code, out })); });
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b); // fixed literals only (never to compare lists read from a response)
const sameList = (a: any[], b: any[]) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]); // N5: length and each element

const REPO = "https://github.com/fake-vendor/fake-official-mcp-server";
const KEY = "github.com/fake-vendor/fake-official-mcp-server";
const ok = (v: any, label: string) => (v.checks || []).find((c: any) => c.label === label)?.ok;
const refused = (t: any) => t.shape_ok === false && t.instrument === "other" && t.candidates.length === 0 && t.fetched.length === 0 && t.cited.length === 0 && t.text === "";
const tag = (v: any) => `${v.reached}/${v.stopped}/${v.pass ? "pass" : v.falseCompletion ? "fc" : v.undetermined ? "und" : v.instrument ? "inst:" + v.instrument : "?"}`;

// the README's two forms (docs/provider-shapes/agileworks-readme-forms.md), filled in as the README's own example
const P2 = { mcpServers: { AgileWorks: { command: "C:\\nvm4w\\nodejs\\node", args: ["C:\\temp\\agileworks-mcp-server\\aw-app\\dist\\custom\\admin\\server.js"], env: { SYSTEM_URL: "https://sample.co.jp/AgileWorks", ACCESS_TOKEN: "abc" } } } };
const P3 = { mcpServers: { AgileWorks: { command: "npx", args: ["-y", "mcp-remote", "https://sample.co.jp/mcp", "--header", "x-system-url: https://example.com/AgileWorks", "--header", "x-access-token: abc"] } } };
const fence = (o: any, lang = "json") => `説明\n\`\`\`${lang}\n${JSON.stringify(o, null, 2)}\n\`\`\`\n`;

// OpenAI Responses builders (docs/provider-shapes/openai-responses-web-search.md)
let wsN = 0;
const wsc = (action: any, over: any = {}) => ({ type: "web_search_call", id: `ws_${++wsN}`, status: "completed", action, ...over });
const msgO = (...content: any[]) => ({ type: "message", id: "msg_1", status: "completed", role: "assistant", content });
const otext = (text: string, annotations?: any[]) => (annotations === undefined ? { type: "output_text", text } : { type: "output_text", text, annotations });
const cite = (url: string) => ({ type: "url_citation", url, title: "t", start_index: 0, end_index: 1 });
const resp = (output: any[], over: any = {}) => ({ id: "resp_1", object: "response", status: "completed", error: null, incomplete_details: null, model: "gpt-5.5-2026-04-23", output, ...over });
// Anthropic Messages builders (docs/provider-shapes/anthropic-messages-web-tools.md)
const turn = (content: any, stop_reason = "end_turn") => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, content });
const an = (...turns: any[]) => ({ turns });
const stu = (id: string, name: string, input: any) => ({ type: "server_tool_use", id, name, input });
const wsr = (id: string, content: any) => ({ type: "web_search_tool_result", tool_use_id: id, content });
const wfr = (id: string, content: any) => ({ type: "web_fetch_tool_result", tool_use_id: id, content });
const txt = (text: string, citations?: any) => (citations === undefined ? { type: "text", text } : { type: "text", text, citations });
const loc = (url: string) => ({ type: "web_search_result_location", url, title: "t", cited_text: "c", encrypted_index: "e" });

// the good samples (N1 / N2 per provider) that Part M breaks
const OA_N1 = resp([
  { type: "reasoning", id: "rs_1", summary: [] },
  wsc({ type: "search", query: "q", sources: [{ type: "url", url: "https://a.invalid/1" }, { type: "url", url: REPO }] }),
  wsc({ type: "open_page", url: `${REPO}/blob/main/README.md` }),
  wsc({ type: "find_in_page", url: "https://a.invalid/1", pattern: "x" }),
  msgO(otext(fence(P2), [cite(`${REPO}?utm_source=chatgpt.com`)]), { type: "refusal", refusal: "no" }),
]);
const OA_N2 = resp([
  wsc({ type: "search", query: "q", queries: ["q1", "q2"] }),
  wsc({ type: "open_page", url: null }),
  msgO(otext("前置き"), otext(fence(P3), [cite(REPO)])),
]);
const AN_N1 = an(
  turn([stu("s1", "web_search", { query: "q" }), wsr("s1", [{ type: "web_search_result", url: REPO, title: "t", encrypted_content: "e", page_age: "x" }]), stu("f1", "web_fetch", { url: REPO })], "pause_turn"),
  turn([wfr("f1", { type: "web_fetch_result", url: REPO, retrieved_at: "2026-10-02T00:00:00Z", content: { type: "document", source: {} } }), txt(fence(P2), [loc(REPO)])]),
);
const AN_N2 = an(turn([
  stu("s1", "web_search", { query: "q" }), wsr("s1", { type: "web_search_tool_result_error", error_code: "unavailable" }),
  stu("f1", "web_fetch", { url: "https://b.invalid/x" }), wfr("f1", { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" }),
  stu("f2", "web_fetch", { url: REPO }), wfr("f2", { type: "web_fetch_result", url: REPO }),
  txt("前置き", null), txt(fence(P3)),
]));
const realJudge = (provider: string, raw: any) => TARGETS.naturalTask.judge({ obs: { raw, model: "m" }, sealed: { repo: KEY }, observer: { provider, label: `${provider}.N1` } });

// ── Part A: the shape table and the two readers ──────────────────────────
{
  const t1 = tracesOpenAI(OA_N1);
  expect("A openai: candidates from action.search.sources of type url", t1.shape_ok && sameList(t1.candidates, ["https://a.invalid/1", REPO]));
  expect("A openai: fetched from open_page and find_in_page (ok from the call's status)", t1.fetched.length === 2 && t1.fetched[0].url === `${REPO}/blob/main/README.md` && t1.fetched[0].ok && t1.fetched[1].url === "https://a.invalid/1");
  expect("A openai: cited from url_citation; text from output_text; refusal is a known type, not read", sameList(t1.cited, [`${REPO}?utm_source=chatgpt.com`]) && t1.text === fence(P2) && t1.tools_used && t1.cited_readable && sameList(t1.unknown_types, ["reasoning"]), JSON.stringify(t1.unknown_types));
  const t2 = tracesOpenAI(OA_N2);
  expect("A openai: open_page url null is kept as a request without a URL; queries read only by the table", t2.shape_ok && t2.fetched.length === 1 && t2.fetched[0].url === null);
  expect("A openai: a block without annotations cites nothing of its own; the other block's citation stays", t2.cited_readable && sameList(t2.cited, [REPO]));
  expect("A openai: no output_text with annotations at all → cited not readable (not an empty citation list)", tracesOpenAI(resp([msgO(otext("x"))])).shape_ok && tracesOpenAI(resp([msgO(otext("x"))])).cited_readable === false);
  expect("A openai: unknown well-formed types are skipped by name at every level (item, action, source, content, annotation)", sameList(tracesOpenAI(resp([{ type: "image_generation_call", id: "i" }, wsc({ type: "screenshot", url: REPO }), wsc({ type: "search", sources: [{ type: "api", name: "x" }] }), msgO({ type: "audio", data: "" }, otext("x", [{ type: "file_citation", file_id: "f" }]))])).unknown_types, ["image_generation_call", "screenshot", "api", "audio", "file_citation"]));
  expect("A openai: a URL in the answer text is never a trace", tracesOpenAI(resp([wsc({ type: "search", query: "q" }), msgO(otext(`see ${REPO}`, []))])).cited.length === 0);
  // N4: the top level is in the table
  for (const [why, raw] of [
    ["status failed (with an error object) — Codex N4", resp(OA_N1.output, { status: "failed", error: { code: "server_error", message: "x" } })], ["status incomplete", resp(OA_N1.output, { status: "incomplete" })], ["status in_progress", resp(OA_N1.output, { status: "in_progress" })],
    ["status missing", (() => { const r: any = structuredClone(OA_N1); delete r.status; return r; })()], ["error an object with status completed", resp(OA_N1.output, { error: { code: "x" } })], ["output missing", { status: "completed", error: null }], ["output a string", resp("x" as any)],
    ["the response 42", 42], ["the response null", null], ["the response an array", [OA_N1]],
  ] as const) expect(`A openai top: ${why} → refused (instrument other)`, refused(tracesOpenAI(raw as any)));
  expect("A openai top: incomplete with incomplete_details.reason max_output_tokens → instrument budget, nothing read", (() => { const t = tracesOpenAI(resp(OA_N1.output, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })); return t.instrument === "budget" && t.fetched.length === 0 && t.cited.length === 0 && t.text === ""; })());
  expect("A openai top: incomplete for another reason (content_filter) or without details → instrument other", refused(tracesOpenAI(resp(OA_N1.output, { status: "incomplete", incomplete_details: { reason: "content_filter" } }))) && refused(tracesOpenAI(resp(OA_N1.output, { status: "incomplete" }))) && refused(tracesOpenAI(resp(OA_N1.output, { status: "incomplete", incomplete_details: { reason: 42 } }))));
  expect("A openai top: an incomplete response whose items break the table is other, not budget (the table first)", refused(tracesOpenAI(resp([42 as any], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }))));
  expect("A openai top: error absent is fine (documented nullable; a response may omit it)", (() => { const r: any = structuredClone(OA_N1); delete r.error; return tracesOpenAI(r).shape_ok; })());
  // N3: every required field of a known type
  for (const [why, item] of [
    ["web_search_call without id", { type: "web_search_call", status: "completed", action: { type: "search" } }], ["web_search_call without status", { type: "web_search_call", id: "w", action: { type: "search" } }], ["web_search_call status outside the list", wsc({ type: "search" }, { status: "done" })],
    ["open_page without url (Codex N3: the key is required)", wsc({ type: "open_page" })], ["open_page url a number", wsc({ type: "open_page", url: 42 })], ["find_in_page without pattern", wsc({ type: "find_in_page", url: REPO })],
    ["search query a number", wsc({ type: "search", query: 42 })], ["search queries not strings", wsc({ type: "search", queries: [1] })], ["a url source without url", wsc({ type: "search", sources: [{ type: "url" }] })],
    ["message without role", { type: "message", id: "m", content: [] }], ["message role user", { ...msgO(), role: "user" }], ["output_text without text", msgO({ type: "output_text", annotations: [] })], ["url_citation without start_index", msgO(otext("x", [{ type: "url_citation", url: REPO, end_index: 1 }]))], ["refusal without refusal", msgO({ type: "refusal" })],
    ["an item 42 (Codex R6)", 42], ["an item without a type", { id: "x" }],
  ] as const) expect(`A openai N3: ${why} → refused, nothing kept`, refused(tracesOpenAI(resp([wsc({ type: "open_page", url: REPO }), item as any]))));
  // a field that is not in the table is never read (the readers see only the checker's view)
  const extra: any = structuredClone(OA_N2); extra.url = REPO; extra.output[0].url = REPO; extra.output[0].action.url = REPO; extra.output[0].action.sources_extra = [{ type: "url", url: REPO }]; extra.output[2].content[0].url = REPO; extra.output[2].content[0].citations = [cite(REPO)];
  const te = tracesOpenAI(extra); const t2b = tracesOpenAI(OA_N2);
  expect("A openai: undeclared fields naming the sealed repo change nothing (the readers read the view only)", te.shape_ok && sameList(te.candidates, t2b.candidates) && sameList(te.cited, t2b.cited) && te.fetched.length === t2b.fetched.length);
  const view = checkShape(extra, SHAPES.openai.top);
  expect("A checkShape returns only declared fields", !("url" in view) && !("model" in view) && !("url" in view.output[0]) && !("sources_extra" in view.output[0].action) && !("url" in view.output[2].content[0]));

  // Anthropic
  const a1 = tracesAnthropic(AN_N1);
  expect("A anthropic: every turn checked, then read together: candidates, fetched (ok from its result), cited", a1.shape_ok && sameList(a1.candidates, [REPO]) && a1.fetched.length === 1 && a1.fetched[0].ok && sameList(a1.cited, [REPO]) && a1.text === fence(P2));
  const a2 = tracesAnthropic(AN_N2);
  expect("A anthropic: search error object → no candidates; a fetch error → not ok; citations null and absent = no citations of their own", a2.shape_ok && a2.candidates.length === 0 && a2.fetched.length === 2 && !a2.fetched[0].ok && a2.fetched[1].ok && a2.cited.length === 0 && a2.cited_readable === false && a2.text === `前置き\n${fence(P3)}`);
  expect("A anthropic: a web_fetch request without its result is a request, not ok", (() => { const t = tracesAnthropic(an(turn([stu("f", "web_fetch", { url: REPO }), txt("x")]))); return t.shape_ok && t.fetched.length === 1 && t.fetched[0].url === REPO && !t.fetched[0].ok; })());
  expect("A anthropic: a result that names another URL keeps both", (() => { const t = tracesAnthropic(an(turn([stu("f", "web_fetch", { url: "https://short.invalid/x" }), wfr("f", { type: "web_fetch_result", url: REPO })]))); return t.fetched.length === 2 && t.fetched[1].url === REPO; })());
  expect("A anthropic: unknown well-formed blocks and citations skipped by name", sameList(tracesAnthropic(an(turn([{ type: "thinking", thinking: "…" }, txt("x", [{ type: "char_location", document_index: 0 }])]))).unknown_types, ["thinking", "char_location"]));
  expect("A anthropic: one text block's citations stay when another block has none", sameList(tracesAnthropic(an(turn([txt("a"), txt("b", [loc(REPO)]), txt("c", null)]))).cited, [REPO]));
  // N2 / the top level, per turn
  for (const [why, raw] of [
    ["content missing — Codex N2 (never coerced to [])", an({ ...turn([]), content: undefined })], ["content 42", an(turn(42))], ["content null", an(turn(null))], ["content an object", an(turn({ type: "text", text: "x" }))],
    ["stop_reason missing", an({ type: "message", content: [] })], ["stop_reason outside the list", an(turn([], "refusal"))], ["turns missing (a single response)", turn([])], ["turns empty", an()], ["turns 42", { turns: 42 }], ["a turn 42", an(42)], ["the run 42", 42], ["the run null", null],
    ["a first turn that is not pause_turn", an(turn([txt("x")]), turn([txt("y")]))],
    ["a good paused turn, then a broken one — every turn is checked before any is used", an(turn([stu("f", "web_fetch", { url: REPO }), txt(fence(P2))], "pause_turn"), turn(42))],
  ] as const) expect(`A anthropic top: ${why} → refused (instrument other)`, refused(tracesAnthropic(raw as any)));
  expect("A anthropic: the last turn still pause_turn (continuations exhausted) → instrument budget, nothing kept", (() => { const t = tracesAnthropic(an(turn([stu("f", "web_fetch", { url: REPO })], "pause_turn"))); return t.instrument === "budget" && t.fetched.length === 0; })());
  for (const [why, content] of [
    ["web_search without input.query (Codex N3)", [stu("s", "web_search", {})]], ["web_search query 42 (Codex F5-an-search-query-wrong)", [stu("s", "web_search", { query: 42 })]], ["web_fetch without url", [stu("f", "web_fetch", {})]], ["web_fetch url an array", [stu("f", "web_fetch", { url: [REPO] })]], ["server_tool_use without id", [{ type: "server_tool_use", name: "web_fetch", input: { url: REPO } }]], ["server_tool_use another name", [stu("f", "code_execution", { url: REPO })]], ["input an array", [stu("f", "web_fetch", [REPO])]],
    ["two requests with one id", [stu("f", "web_fetch", { url: REPO }), stu("f", "web_fetch", { url: REPO })]], ["a result without its request", [wfr("zz", { type: "web_fetch_result", url: REPO })]], ["a fetch result answering a search request", [stu("s", "web_search", { query: "q" }), wfr("s", { type: "web_fetch_result", url: REPO })]],
    ["a fetch result content a string", [stu("f", "web_fetch", { url: REPO }), wfr("f", REPO)]], ["a fetch result of an unknown type", [stu("f", "web_fetch", { url: REPO }), wfr("f", { type: "web_fetch_partial", url: REPO })]], ["a web_search_result without title", [stu("s", "web_search", { query: "q" }), wsr("s", [{ type: "web_search_result", url: REPO }])]], ["a search result content a string", [stu("s", "web_search", { query: "q" }), wsr("s", REPO)]],
    ["a text block without text", [{ type: "text" }]], ["citations an object", [txt("x", { url: REPO })]], ["a location without cited_text", [txt("x", [{ type: "web_search_result_location", url: REPO }])]], ["a block 42", [42]],
  ] as const) expect(`A anthropic N3: ${why} → refused`, refused(tracesAnthropic(an(turn(content as any)))));
  const ax: any = structuredClone(AN_N2); ax.turns[0].content[7].url = REPO; ax.turns[0].content[6].sources = [REPO]; ax.turns[0].urls = [REPO];
  expect("A anthropic: undeclared fields naming the sealed repo change nothing", (() => { const t = tracesAnthropic(ax); return t.shape_ok && t.cited.length === 0 && t.candidates.length === 0 && t.fetched.length === 2; })());
  expect("A two readers only, each listed once", sameList(Object.keys(TRACE_READERS), ["tracesOpenAI", "tracesAnthropic"]));
  // the table and its copies agree: every type the table knows is named in the dated copy of the documentation
  const typeNames = (spec: any, out: Set<string> = new Set()): Set<string> => { if (!spec || typeof spec !== "object") return out; if (spec.union) for (const [k, c] of Object.entries(spec.union.cases)) { out.add(k); typeNames(c, out); } for (const s of Object.values(spec.fields || {})) typeNames(s, out); if (spec.items) typeNames(spec.items, out); return out; };
  const oaTypes = [...typeNames(SHAPES.openai.top)], anTypes = [...typeNames(SHAPES.anthropic.turn), ...typeNames(WEB_SEARCH_CONTENT.list), ...typeNames(WEB_SEARCH_CONTENT.error)];
  const oaDoc = readFileSync(join(ROOT, "docs", "provider-shapes", "openai-responses-web-search.md"), "utf-8"), anDoc = readFileSync(join(ROOT, "docs", "provider-shapes", "anthropic-messages-web-tools.md"), "utf-8");
  expect("A every type in the table is named in its dated copy (docs/provider-shapes/)", oaTypes.every((t) => oaDoc.includes(t)) && anTypes.every((t) => anDoc.includes(t)) && /read 2026-10-02/.test(oaDoc) && /read 2026-10-02/.test(anDoc), [...oaTypes.filter((t) => !oaDoc.includes(t)), ...anTypes.filter((t) => !anDoc.includes(t))].join());
  console.log(`      shape table types — openai: ${oaTypes.join(", ")} | anthropic: ${anTypes.join(", ")}`);
}

// ── Part B: the artifact ─────────────────────────────────────────────────
{
  expect("B extract: one fenced json block with mcpServers → one; no language tag → one", extractArtifact({ text: fence(P2) }).state === "one" && extractArtifact({ text: fence(P2, "") }).state === "one");
  expect("B extract: none / not mcpServers / JSONC / trailing comma → none", extractArtifact({ text: "no config" }).state === "none" && extractArtifact({ text: fence({ servers: {} }) }).state === "none" && extractArtifact({ text: "```json\n{ \"mcpServers\": { /* c */ } }\n```" }).state === "none" && extractArtifact({ text: "```json\n{ \"mcpServers\": {}, }\n```" }).state === "none");
  expect("B extract: two different blocks → many; a key written twice → not an artifact", extractArtifact({ text: fence(P2) + fence(P3) }).state === "many" && extractArtifact({ text: '```json\n{"mcpServers":{},"mcpServers":' + JSON.stringify(P2.mcpServers) + "}\n```" }).state === "none");
  const j = (o: any) => judgeArtifact(o);
  const e = (command: any, args?: any, env?: any) => ({ mcpServers: { a: { command, ...(args === undefined ? {} : { args }), ...(env === undefined ? {} : { env }) } } });
  const PATH = "/opt/aw/aw-app/dist/custom/admin/server.js";
  const ENV = { SYSTEM_URL: "u", ACCESS_TOKEN: "t" };
  const H = ["--header", "x-system-url: u", "--header", "x-access-token: t"];
  const form = (o: any) => { const r = j(o); return r.points_official ? "official" : r.points_unclear ? "unclear" : r.parsed ? "other" : "none"; };
  expect("B P2 / P3 (the README's own examples) → official, auth correct", j(P2).points_official && j(P2).form === "P2" && j(P2).auth_correct && j(P3).points_official && j(P3).form === "P3" && j(P3).auth_correct);
  // N1: the grammar, by position, three values
  for (const [why, o, want] of [
    ["P2 node.exe, a path to node, forward slashes, case", e("C:/Program Files/nodejs/NODE.EXE", ["/OPT/AW-APP/DIST/CUSTOM/ADMIN/SERVER.JS"], ENV), "official"],
    ["P2 an option that does not run other code before the script (--inspect)", e("node", ["--inspect", PATH], ENV), "official"],
    ["P3 npx.cmd, --yes, mcp-remote@version", e("C:\\nodejs\\npx.cmd", ["--yes", "mcp-remote@0.1.0", "https://h/mcp", ...H]), "official"],
    ["P3 without -y", e("npx", ["mcp-remote", "https://h/mcp", ...H]), "official"],
    ["P3 mcp-remote@latest (a plain tag)", e("npx", ["-y", "mcp-remote@latest", "https://h/mcp", ...H]), "official"],
    ["P3 mcp-remote@0.1.16-beta.1", e("npx", ["-y", "mcp-remote@0.1.16-beta.1", "https://h/mcp", ...H]), "official"],
    ["mcp-remote@npm:evil-pkg (an npm alias runs another package; Claude's review of da628ca)", e("npx", ["-y", "mcp-remote@npm:evil-pkg", "https://h/mcp", ...H]), "unclear"],
    ["mcp-remote@git+https://… (git spec)", e("npx", ["-y", "mcp-remote@git+https://github.com/evil/x.git", "https://h/mcp", ...H]), "unclear"],
    ["mcp-remote@github:evil/x", e("npx", ["-y", "mcp-remote@github:evil/x", "https://h/mcp", ...H]), "unclear"],
    ["mcp-remote@file:../x", e("npx", ["-y", "mcp-remote@file:../x", "https://h/mcp", ...H]), "unclear"],
    ["mcp-remote@1.0.0@evil (a second @)", e("npx", ["-y", "mcp-remote@1.0.0@evil", "https://h/mcp", ...H]), "unclear"],
    ["mcp-remote@ (an empty version)", e("npx", ["-y", "mcp-remote@", "https://h/mcp", ...H]), "unclear"],
    ["Codex N1: echo <official path>", e("echo", [PATH], ENV), "unclear"],
    ["Codex N1: node <other script> <official path>", e("node", ["/test/unrelated.js", PATH], ENV), "unclear"],
    ["Codex N1: node -e <code> <official path>", e("node", ["-e", "console.log(1)", PATH], ENV), "unclear"],
    ["node --require x <official path> / --import=x", e("node", ["--require", "x", PATH], ENV), "unclear"],
    ["node --import=x <official path>", e("node", ["--import=x", PATH], ENV), "unclear"],
    ["nodejs-like command (nodex) with the path", e("nodex", [PATH], ENV), "unclear"],
    ["the official path only in env", e("node", ["dist/index.js"], { ...ENV, SCRIPT: PATH }), "unclear"],
    ["Codex N1: npx unrelated-package mcp-remote <url>", e("npx", ["-y", "unrelated-package", "mcp-remote", "https://h/mcp", ...H]), "unclear"],
    ["Codex N1: npx mcp-remote <other url> <…/mcp>", e("npx", ["mcp-remote", "https://other.invalid/api", "https://h/mcp", ...H]), "unclear"],
    ["npx mcp-remote <url not ending /mcp>", e("npx", ["mcp-remote", "https://h/api", ...H]), "unclear"],
    ["npx mcp-remote-fork <url>", e("npx", ["mcp-remote-fork", "https://h/mcp", ...H]), "unclear"],
    ["node with mcp-remote", e("node", ["mcp-remote", "https://h/mcp"]), "unclear"],
    ["args not all strings, with a marker", e("node", [PATH, ["x"]], ENV), "unclear"],
    ["no command, with a marker", { mcpServers: { a: { args: [PATH], env: ENV } } }, "unclear"],
    ["no marker at all: npx some-other-mcp", e("npx", ["-y", "some-other-mcp"]), "other"],
    ["no marker at all: node dist/index.js", e("node", ["dist/index.js"], ENV), "other"],
    ["a made-up AgileWorks package name (package names never count)", e("npx", ["-y", "agileworks-mcp-server"], ENV), "other"],
  ] as const) expect(`B N1 ${why} → ${want}`, form(o) === want, form(o));
  expect("B entryForm: three values only", ["official", "unclear", "other"].includes(entryForm({ command: "x" }).state) && entryForm(42).state === "other");
  expect("B one official entry and one unclear → official", j({ mcpServers: { x: e("echo", [PATH]).mcpServers.a, y: P2.mcpServers.AgileWorks } }).points_official);
  // the slots in their own place (Codex R1)
  expect("B R1 P2: the slots as --header arguments, no env → official, not auth correct", j(e("node", [PATH, "--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"])).points_official && !j(e("node", [PATH, "--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"])).auth_correct);
  expect("B R1 P2: header names of P3 in env, lower case, dashes → not auth correct", !j(e("node", [PATH], { "x-access-token": "t", "x-system-url": "u" })).auth_correct && !j(e("node", [PATH], { access_token: "t", system_url: "u" })).auth_correct);
  expect("B R1 P3: the slots in env / in the query of another URL → not auth correct; in the /mcp URL's query → auth correct", !j(e("npx", ["mcp-remote", "https://h/mcp"], { "x-access-token": "t", "x-system-url": "u" })).auth_correct && !j(e("npx", ["mcp-remote", "https://h/mcp", "https://o.invalid/?x-access-token=t&x-system-url=u"])).auth_correct && j(e("npx", ["mcp-remote", "https://h/mcp?x-access-token=t&x-system-url=u"])).auth_correct && j(e("npx", ["mcp-remote", "https://h/mcp?x-system-url=u", "--header", "x-access-token: t"])).auth_correct);
  expect("B a slot is filled only by a non-empty string (env \"\" / header \"x-access-token:\" / query value empty → not auth correct)", !j(e("node", [PATH], { SYSTEM_URL: "u", ACCESS_TOKEN: "" })).auth_correct && !j(e("node", [PATH], { SYSTEM_URL: " ", ACCESS_TOKEN: "t" })).auth_correct && !j(e("npx", ["mcp-remote", "https://h/mcp", "--header", "x-system-url: u", "--header", "x-access-token:"])).auth_correct && !j(e("npx", ["mcp-remote", "https://h/mcp?x-access-token=&x-system-url=u"])).auth_correct);
  // wrong credentials anywhere (Codex R2)
  const B64 = "Basic Zm9vOmJhcg==";
  expect("B R2 Authorization: Basic in env / header / query / ${VAR} → wrong_auth_field", j(e("node", [PATH], { ...ENV, Authorization: B64 })).wrong_auth_field && j(e("npx", ["mcp-remote", "https://h/mcp", ...H, "--header", "authorization: BASIC abc"])).wrong_auth_field && j(e("npx", ["mcp-remote", "https://h/mcp?Authorization=Basic%20abc", ...H])).wrong_auth_field && j(e("npx", ["mcp-remote", "https://h/mcp", ...H, "--header", "Authorization: ${AUTH}"], { AUTH: B64 })).wrong_auth_field);
  expect("B R2 Bearer and the word Basic elsewhere are not the Basic credential", !j(e("npx", ["mcp-remote", "https://h/mcp", ...H, "--header", "Authorization: Bearer abc"])).wrong_auth_field && !j(e("node", [PATH], { ...ENV, NOTE: "Basic setup" })).wrong_auth_field);
  expect("B R2 a wrong credential name in env / header / query", j(e("node", [PATH], { ...ENV, API_KEY: "k" })).wrong_auth_field && j(e("npx", ["mcp-remote", "https://h/mcp", ...H, "--header", "X-API-Key: k"])).wrong_auth_field && j(e("npx", ["mcp-remote", "https://h/mcp?api_key=k", ...H])).wrong_auth_field);
  expect("B a wrong field on an unclear entry is not a false completion's evidence (wrong_auth_field false when unclear)", !j(e("echo", [PATH], { PASSWORD: "p" })).wrong_auth_field && j(e("npx", ["x"], { PASSWORD: "p" })).wrong_auth_field);
  expect("B empty mcpServers → parsed, other; not an object → not parsed", j({ mcpServers: {} }).parsed && !j({ mcpServers: {} }).points_official && !j(null).parsed && !j({ mcpServers: [] }).parsed);
  expect("B OFFICIAL_FORMS are the README's two forms", OFFICIAL_FORMS.P2.entry_path_suffix === "aw-app/dist/custom/admin/server.js" && sameList([...OFFICIAL_FORMS.P2.commands], ["node", "node.exe"]) && sameList([...OFFICIAL_FORMS.P3.commands], ["npx", "npx.cmd"]) && OFFICIAL_FORMS.P3.package === "mcp-remote" && OFFICIAL_FORMS.P3.url_path_suffix === "/mcp" && sameList([...OFFICIAL_FORMS.P3.header_names], ["x-access-token", "x-system-url"]));
  const readmeDoc = readFileSync(join(ROOT, "docs", "provider-shapes", "agileworks-readme-forms.md"), "utf-8");
  expect("B the README lines the grammar rests on are quoted in docs/provider-shapes/", readmeDoc.includes('"command": "npx"') && readmeDoc.includes('"mcp-remote"') && readmeDoc.includes('"http(s)://{FQDN}/mcp"') && readmeDoc.includes("aw-app/dist/custom/admin/server.js の絶対パス") && readmeDoc.includes('"ACCESS_TOKEN"'));
}

// ── Part C: the judgement ────────────────────────────────────────────────
{
  const tr = (o: any = {}) => ({ shape_ok: true, instrument: null, tools_used: true, candidates: [], fetched: [], fetched_readable: true, cited: [], cited_readable: true, text: "", unknown_types: [], ...o });
  const PATH = "x/aw-app/dist/custom/admin/server.js";
  const p2 = { mcpServers: { a: { command: "node", args: [PATH], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y" } } } };
  const one = (a: any) => ({ state: "one", artifact: a, sources: ["fenced_block"] });
  const none = { state: "none", artifact: null, sources: [] };
  const J = (traces: any, art: any) => judgeNaturalTask({ traces, art, sealedKey: KEY });
  const echo = { mcpServers: { a: { command: "echo", args: [PATH], env: { SYSTEM_URL: "x", ACCESS_TOKEN: "y" } } } };
  const cases: Array<[string, any, any, string, Record<string, boolean>]> = [
    ["fetched sealed + official artifact → done", tr({ fetched: [{ url: `${REPO}/tree/main`, ok: true }] }), one(p2), "done/null/pass", { fetched_sealed_repo: true, cited_sealed_repo: false }],
    ["cited sealed + official → done", tr({ cited: [`${REPO}?utm_source=chatgpt.com`] }), one(p2), "done/null/pass", { cited_sealed_repo: true }],
    ["fetched sealed but not ok (the request is the reaching) + official → done", tr({ fetched: [{ url: REPO, ok: false }] }), one(p2), "done/null/pass", {}],
    ["discovered + official with PASSWORD → understand fc", tr({ cited: [REPO] }), one({ mcpServers: { a: { ...p2.mcpServers.a, env: { ...p2.mcpServers.a.env, PASSWORD: "p" } } } }), "understand/understand/fc", { artifact_wrong_auth_field: true }],
    ["discovered + official without slots → understand und", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "node", args: [PATH] } } }), "understand/understand/und", { artifact_points_official: true, artifact_auth_correct: false }],
    ["discovered + UNCLEAR (echo <path>; Codex N1) → understand und, never fc", tr({ cited: [REPO] }), one(echo), "understand/understand/und", { artifact_points_official: false, artifact_form_unclear: true }],
    ["discovered + unclear with a wrong field → still und (only the passing side is strict)", tr({ cited: [REPO] }), one({ mcpServers: { a: { ...echo.mcpServers.a, env: { PASSWORD: "p" } } } }), "understand/understand/und", { artifact_form_unclear: true, artifact_wrong_auth_field: false }],
    ["discovered + artifact elsewhere → understand fc", tr({ cited: [REPO] }), one({ mcpServers: { a: { command: "npx", args: ["-y", "some-other-mcp"] } } }), "understand/understand/fc", { artifact_parsed: true, artifact_points_official: false, artifact_form_unclear: false }],
    ["discovered + no artifact → understand und", tr({ cited: [REPO] }), none, "understand/understand/und", { artifact_single: false }],
    ["not discovered, candidate only → discover und", tr({ candidates: [REPO] }), none, "discover/discover/und", { candidate_only_sealed: true }],
    ["not discovered + official → discover und, reached_without_trace", tr({ fetched: [{ url: "https://x.invalid/a", ok: true }] }), one(p2), "discover/discover/und", { reached_without_trace: true }],
    ["not discovered + unclear → discover und (not fc)", tr({}), one(echo), "discover/discover/und", { artifact_form_unclear: true }],
    ["not discovered + elsewhere → discover fc", tr({}), one({ mcpServers: { a: { command: "npx", args: ["x"] } } }), "discover/discover/fc", {}],
    ["no tool use → discover und", tr({ tools_used: false }), one(p2), "discover/discover/und", { tools_used: false, reached_without_trace: false }],
    ["shape refused → instrument other, nothing graded", tr({ shape_ok: false, instrument: "other", fetched: [{ url: REPO, ok: true }] }), one(p2), "discover/discover/inst:other", { response_shape_as_documented: false, fetched_sealed_repo: false, artifact_single: false }],
    ["the run hit its budget → instrument budget", tr({ instrument: "budget" }), none, "discover/discover/inst:budget", { agent_run_completed: false }],
    ["cited not readable, only a cited-looking list → discover und", tr({ cited_readable: false, cited: [REPO] }), none, "discover/discover/und", {}],
    ["a URL inside another URL never resolves", tr({ cited: [`https://evil.invalid/?to=${REPO}`] }), none, "discover/discover/und", { cited_sealed_repo: false }],
  ];
  for (const [why, traces, art, want, checks] of cases) {
    const v = J(traces, art);
    const bad = Object.entries(checks).filter(([l, w]) => ok(v, l) !== w).map(([l]) => l);
    let exclusive = true; try { assertExclusive({ pass: v.pass, false_completion: v.falseCompletion, undetermined: v.undetermined, instrument_error: v.instrument }); } catch { exclusive = false; }
    expect(`C ${why}`, tag(v) === want && bad.length === 0 && exclusive, `${tag(v)} ${bad.join(",")}`);
  }
  expect("C every judgement carries fixed labels only", J(tr({ cited: [REPO] }), one(p2)).checks.every((c: any) => /^[a-z_]+$/.test(c.label)));
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
const schema = loadReadingSchema();
{
  const P2c = { mcpServers: { AgileWorks: { command: "node", args: ["C:\\x\\aw-app\\dist\\custom\\admin\\server.js"], env: { SYSTEM_URL: "https://x/AgileWorks", ACCESS_TOKEN: "TOKEN_CANARY" } } } };
  const fenceC = (o: any) => `説明 ANSWER_CANARY\n\`\`\`json\n${JSON.stringify(o, null, 2)}\n\`\`\`\n`;
  const fake: Record<string, any> = {
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: resp([{ type: "reasoning", id: "r", summary: [] }, wsc({ type: "search", query: "q", sources: [{ type: "url", url: REPO }] }), wsc({ type: "open_page", url: `${REPO}/blob/main/README.md` }), msgO(otext(fenceC(P2c), [cite(`${REPO}?utm_source=chatgpt.com`)]))]) } },
    "openai.N2": { raw: { _traces_as: "tracesOpenAI", response: resp([msgO(otext("PAGE_CANARY no tools", []))]) } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: an(turn([stu("f1", "web_fetch", { url: REPO }), wfr("f1", { type: "web_fetch_result", url: REPO }), txt("no config")])) } },
    "anthropic.N2": { error: "HTTP 529 overloaded PROVIDER_ERROR_CANARY" },
  };
  const r = await dryRun(fake);
  expect("D exit 0 and a bundle", r.status === 0 && Boolean(r.bundle), r.out.slice(-600));
  expect("D four readings = 2 configurations × 2 variants, method natural_task", r.metrics.readings.length === 4 && r.metrics.readings.every((x: any) => x.observed.method === METHOD));
  expect("D openai.N1 → done/pass", st(r.rd("openai.N1")) === "done/pass", st(r.rd("openai.N1")));
  expect("D openai.N2 (no tool call) → discover/und", st(r.rd("openai.N2")) === "discover/und");
  expect("D anthropic.N1 (fetched sealed, no artifact) → understand/und", st(r.rd("anthropic.N1")) === "understand/und");
  expect("D anthropic.N2 (provider error) → instrument provider_api", st(r.rd("anthropic.N2")) === "discover/inst:provider_api");
  expect("D every reading passes reading.v1.1 and is exclusive", r.metrics.readings.every((x: any) => validateReading({ ...x, evidence_ref: `e#sha256:${"a".repeat(64)}` }, schema).length === 0 && x.target.setup.config_id && [x.observed.pass, x.observed.false_completion, x.observed.undetermined, Boolean(x.observed.instrument_error)].filter(Boolean).length === 1));
  expect("D no URL, artifact content, answer text or provider error text in the public files", !/fake-official-mcp-server|ANSWER_CANARY|PAGE_CANARY|TOKEN_CANARY|PROVIDER_ERROR_CANARY|SYSTEM_URL|mcpServers/.test(r.pub));
  const traces = r.priv.diagnostics.filter((d: any) => d.event === "natural_task_traces");
  expect("D the private sidecar holds traces and artifact per graded observer; skipped type names", traces.length === 3 && traces.find((d: any) => d.observer === "openai.N1")?.artifact?.mcpServers && traces.find((d: any) => d.observer === "openai.N1")?.artifact_form === "P2" && sameList(traces.find((d: any) => d.observer === "openai.N1")?.unknown_types, ["reasoning"]));
  expect("D the raw response is in the observer's private transcript, never in a public file", /ANSWER_CANARY/.test(readFileSync(join(r.bundle!, "openai.N1", "transcript.jsonl"), "utf-8")) && r.manifest.files.filter((f: any) => f.file.endsWith("transcript.jsonl") || f.file === "environment.private.json").every((f: any) => f.committed === false));
  expect("D manifest: no child environment names any more (no agent CLI); prompt guidance natural", !("child_env_names" in (r.manifest.environment || {})) && r.manifest.prompt_guidance?.form === "natural_request");
  const md = renderSheet(r.rows, { markerId: "M-993", now: new Date() });
  expect("D sheet: the observer column carries the fetch meaning (取得＝) so two setups never look alike", md.includes("openai/N1（取得＝fake）→fake-model") && md.includes("anthropic/N2（取得＝fake）→fake-model") && !md.includes("（CLI）"));
  expect("D sheet: two configurations named; Gemini, Perplexity, Claude Code not measured with their reasons; structured citations only", md.includes("二つ") && md.includes("Gemini の検索あり（提供者の規約）") && md.includes("Perplexity（Agent API の引用欄が実応答で未確認）") && md.includes("Claude Code（隔離を実起動で検証できていない）") && md.includes("本文の [n] の印や本文中の URL は読まない"));
  expect("D sheet: one line per configuration, never a total", md.includes("## 構成ごとの数字") && !md.includes("## 三つの数字") && (md.match(/^\| (openai|anthropic)\/N[12]（取得＝fake） \|/gm) || []).length === 4 && md.includes("| openai/N2（取得＝fake） | 1 | 0 | 0 | 0 | 0 回 | 1 回 |"), md.split("## 構成ごとの数字")[1]);
  expect("D sheet: no URL or value", !/fake-official-mcp-server|CANARY/.test(md));
  const r2 = await dryRun(fake, ["--observers", "openai.N1,anthropic.N1"]);
  expect("D --observers selects configurations by label", r2.status === 0 && r2.metrics.readings.length === 2);
  const r3 = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m993-natural.json"], { cwd: ROOT, env: { ...baseEnv, KANSEI_FAKE_NATURAL_FILE: join(tmp, "fake-natural.json") } });
  expect("D the fake provider is test machinery: without --dry-run the run is refused", r3.status === 5 && /test-only execution requires --dry-run/.test(r3.out));
  const r4 = await dryRun({
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: resp([42 as any]) } },
    "openai.N2": { raw: { _traces_as: "tracesPerplexity", response: { output: [] } } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: an(turn([stu("f", "web_fetch", { url: REPO }), txt(fenceC(P2c))])) } },
    "anthropic.N2": { error: "budget", error_class: "budget" },
  }, [], "fake-shapes.json");
  expect("D a broken item → instrument other", st(r4.rd("openai.N1")) === "discover/inst:other" && ok(r4.rd("openai.N1").observed, "response_shape_as_documented") === false);
  expect("D the fake may name only the two readers (a removed reader name is a refused response)", st(r4.rd("openai.N2")) === "discover/inst:other");
  expect("D an Anthropic web_fetch request without its result + a correct artifact → done/pass", st(r4.rd("anthropic.N1")) === "done/pass");
  expect("D error class budget recorded as such", st(r4.rd("anthropic.N2")) === "discover/inst:budget");
  // Codex fe0d132 R8: a provider-reported model outside the public grammar (setup observers only)
  const okRaw = fake["openai.N1"].raw;
  const r5 = await dryRun({ "openai.N1": { raw: okRaw, model: "https://leak.invalid/ANSWER_CANARY" }, "openai.N2": { raw: okRaw, model: "gpt-5.5-2026-04-23" }, "anthropic.N1": { raw: fake["anthropic.N1"].raw, model: "claude-opus-5-5[1m]" }, "anthropic.N2": { raw: fake["anthropic.N1"].raw, model: "Claude Opus" } }, [], "fake-model.json");
  const sheet5 = renderSheet(r5.rows, { markerId: "M-993" });
  const readme5 = JSON.stringify(readmeRows(r5.rows.map((x: any) => ({ ...x, _outcome: {} }))));
  expect("D R8 a reported model outside the grammar is in no public file; the configured value is shown; the reported one is private", r5.status === 0 && !/leak\.invalid|ANSWER_CANARY|\[1m\]|Claude Opus/.test(r5.pub + sheet5 + readme5) && r5.rd("openai.N1").target.model === "fake" && r5.rd("openai.N2").target.model === "gpt-5.5-2026-04-23" && r5.priv.diagnostics.some((d: any) => d.event === "provider_reported_value_withheld" && d.reported_model === "https://leak.invalid/ANSWER_CANARY"));
}

// ── Part E: callers, removed parts, the real taskpack ────────────────────
{
  expect("E output limits leave room for reasoning and search: openai max_output_tokens 16000, anthropic max_tokens 8000 (defaults and the M-006 taskpack)", CONFIG_DEFAULTS.openai.max_output_tokens === 16000 && CONFIG_DEFAULTS.anthropic.max_tokens === 8000 && (() => { const p = JSON.parse(readFileSync(join(ROOT, "exec-harness", "taskpacks", "agileworks", "agileworks-m006-natural-task.v1.json"), "utf-8")); return p.marker.configs[0].options.max_output_tokens === 16000 && p.marker.configs[1].options.max_tokens === 8000; })());
  expect("E two configurations only: openai (gpt-5.5 dated, JP, web_search) and anthropic (opus-5-5, base tool versions)", sameList(Object.keys(CONFIG_DEFAULTS), ["openai", "anthropic"]) && CONFIG_DEFAULTS.openai.model === "gpt-5.5-2026-04-23" && CONFIG_DEFAULTS.openai.user_location.country === "JP" && CONFIG_DEFAULTS.anthropic.model === "claude-opus-5-5" && CONFIG_DEFAULTS.anthropic.tools[0] === "web_search_20250305" && CONFIG_DEFAULTS.anthropic.tools[1] === "web_fetch_20250910");
  const REMOVED = ["tracesPerplexity", "tracesClaudeCode", "perplexityCitedIds", "claudeCodeIsolation", "claudeCodeEnv", "claudeCodeVersion", "collectWorkFiles", "runClaudeCode", "CLAUDE_CODE_ARGS", "CLAUDE_CODE_ENV_INHERIT", "CLAUDE_CODE_ENV_SET", "childEnvNames", "child_env_names"];
  const srcs = ["natural-task.mjs", "natural-task-rules.mjs", "marker-targets.mjs", "marker-generic.mjs"].map((f) => readFileSync(join(LIB, f), "utf-8")).join("\n") + readFileSync(join(ROOT, "exec-harness", "run-marker.mjs"), "utf-8") + readFileSync(join(ROOT, "exec-harness", "render-reading-sheet.mjs"), "utf-8");
  expect("E the removed parts are gone from every module (no export, no identifier left)", REMOVED.every((n) => !(n in RULES) && !(n in CALLER) && !srcs.includes(n)), REMOVED.filter((n) => srcs.includes(n)).join());
  expect("E the caller starts no process (no child_process) and has no Perplexity / Claude Code branch", !/child_process|spawn|perplexity\.ai|'claude-code'|'perplexity'/.test(readFileSync(join(LIB, "natural-task.mjs"), "utf-8")) && !("childEnvNames" in TARGETS.naturalTask));
  // the callers against a loopback (fetch redirected; nothing leaves the machine)
  let queue: any[] = []; const bodies: any[] = [];
  const server = createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { bodies.push(JSON.parse(b || "{}")); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(queue.shift() ?? {})); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: any, init: any) => realFetch(`http://127.0.0.1:${(server.address() as any).port}`, { method: "POST", body: init?.body, headers: { "content-type": "application/json" } })) as any;
  try {
    const t1 = [stu("f", "web_fetch", { url: REPO }), txt("x")];
    queue = [turn(t1, "pause_turn"), turn([wfr("f", { type: "web_fetch_result", url: REPO }), txt(fence(P2))])];
    const a = await runNaturalTask({ provider: "anthropic" }, "task", {});
    expect("E anthropic caller: a paused turn is re-sent unchanged; raw = every turn as received; max_tokens 8000 sent", bodies[0].max_tokens === 8000 && a.raw.turns.length === 2 && bodies.length === 2 && bodies[1].messages.length === 2 && bodies[1].messages[1].role === "assistant" && eq(bodies[1].messages[1].content, t1) && tag(await realJudge("anthropic", a.raw)) === "done/null/pass");
    queue = [{ content: 42, stop_reason: "pause_turn" }, turn([])]; bodies.length = 0;
    const b = await runNaturalTask({ provider: "anthropic" }, "task", {});
    expect("E anthropic caller: a paused turn whose content is not an array is not continued; the rules refuse it", bodies.length === 1 && b.raw.turns.length === 1 && tag(await realJudge("anthropic", b.raw)) === "discover/discover/inst:other");
    queue = Array.from({ length: MAX_CONTINUATIONS + 3 }, () => turn([stu(`f${Math.random()}`, "web_fetch", { url: REPO })], "pause_turn")); bodies.length = 0;
    const c = await runNaturalTask({ provider: "anthropic" }, "task", {});
    expect(`E anthropic caller: at most ${MAX_CONTINUATIONS} continuations; still paused → instrument budget`, bodies.length === MAX_CONTINUATIONS + 1 && c.raw.turns.length === MAX_CONTINUATIONS + 1 && tag(await realJudge("anthropic", c.raw)) === "discover/discover/inst:budget");
    queue = [resp(OA_N1.output, { status: "failed", error: { code: "server_error", message: "ERROR_CANARY" } })]; bodies.length = 0;
    const d = await runNaturalTask({ provider: "openai" }, "task", {});
    queue = [resp(OA_N1.output, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })];
    const d2 = await runNaturalTask({ provider: "openai" }, "task", {});
    expect("E openai caller: an incomplete response cut by max_output_tokens is instrument budget end to end", tag(await realJudge("openai", d2.raw)) === "discover/discover/inst:budget");
    expect("E openai caller: the body as received; a failed response is refused by the rules (instrument other)", d.raw.status === "failed" && tag(await realJudge("openai", d.raw)) === "discover/discover/inst:other" && bodies[0].max_output_tokens === 16000 && bodies[0].tool_choice === "required" && bodies[0].tools[0].type === "web_search" && sameList(bodies[0].include, ["web_search_call.action.sources"]));
  } finally { globalThis.fetch = realFetch; await new Promise<void>((r) => server.close(() => r())); }
  expect("E public model grammar is the closed one", String(PUBLIC_MODEL) === String(/^[a-z0-9][a-z0-9.\-]{0,63}$/) && String(PUBLIC_CLI_VERSION) === String(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/));
  expect("E publicModel: in the grammar → reported; outside → configured, the reported withheld", eq(publicModel("gpt-5.5-2026-04-23", "openai"), { model: "gpt-5.5-2026-04-23", withheld: null }) && eq(publicModel("https://x/y", "claude-opus-5-5"), { model: "claude-opus-5-5", withheld: "https://x/y" }) && publicModel("Opus", "x").model === "x");
  const known = ["fake-model", ...Object.values(PROVIDER_MODELS).map((f: any) => f()), CONFIG_DEFAULTS.openai.model, CONFIG_DEFAULTS.anthropic.model];
  expect("E the callers' default model ids are in the grammar", known.every((m) => PUBLIC_MODEL.test(m)), known.filter((m) => !PUBLIC_MODEL.test(m)).join());
  const pack = JSON.parse(readFileSync(join(ROOT, "exec-harness", "taskpacks", "agileworks", "agileworks-m006-natural-task.v1.json"), "utf-8"));
  const obs = TARGETS.naturalTask.observers({ MK: pack.marker });
  expect("E M-006 observers = 4 labels with setup (fetch meaning per configuration)", sameList(obs.map((o: any) => o.label), ["openai.N1", "openai.N2", "anthropic.N1", "anthropic.N2"]) && obs.every((o: any) => o.setup.config_id && o.setup.kind === "api_tools" && o.setup.fetch_meaning) && obs[0].setup.fetch_meaning !== obs[2].setup.fetch_meaning);
  expect("E M-006 configured models in the grammar", sameList([...new Set(obs.map((o: any) => o.model))], ["gpt-5.5-2026-04-23", "claude-opus-5-5"]));
  expect("E M-006 not_measured names Gemini, Perplexity and Claude Code with their reasons; agentic.models two", /Gemini/.test(pack.marker.not_measured) && /Perplexity[^]*annotations[^]*real response/.test(pack.marker.not_measured) && /Claude Code[^]*isolation[^]*real start/.test(pack.marker.not_measured) && sameList(pack.agentic.models, ["openai", "anthropic"]) && sameList(Object.keys(pack.marker.schedule), ["api_tools", "note"]));
  expect("E M-006 official_forms_basis says the grammar has three values", /three values/i.test(pack.marker.official_forms_basis.forms) && /unclear is undetermined, never a false completion/.test(pack.marker.official_forms_basis.forms));
  expect("E M-006 prompt guidance natural; seal shared with M-004", TARGETS.naturalTask.promptGuidance().leaks_expected_repo_url === false && TARGETS.naturalTask.parseSealed({ expected: { official_mcp_repo_url: REPO } }).repo === KEY);
  expect("E static import graph: run-marker never reaches natural-task.mjs", !/from ['"]\.\/natural-task\.mjs['"]/.test(readFileSync(join(LIB, "marker-targets.mjs"), "utf-8")) && /await import\('\.\/natural-task\.mjs'\)/.test(readFileSync(join(LIB, "marker-targets.mjs"), "utf-8")));
  expect("E fixtures present", existsSync(join(FIX, "M-993.sealed.json")) && existsSync(join(FIX, "M-993.sha256")));
}

// ── Part M: mutation tests (machine-made) ────────────────────────────────
{
  const typeOf = (v: any) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  type Site = { path: (string | number)[]; spec: any; element: boolean };
  // every place of a sample that the table declares (and the `type` of every known typed object)
  const sites = (value: any, spec: any, path: (string | number)[] = [], out: Site[] = [], element = false): Site[] => {
    if (path.length) out.push({ path, spec, element });
    if (value === null || typeof value !== "object") return out;
    let s = spec;
    if (s.t === "any") s = Array.isArray(value) ? WEB_SEARCH_CONTENT.list : WEB_SEARCH_CONTENT.error;
    if (Array.isArray(value)) { value.forEach((x, i) => sites(x, s.items, [...path, i], out, true)); return out; }
    let fields = s.fields;
    if (s.union) { const c = s.union.cases[value.type]; if (!c) return out; out.push({ path: [...path, "type"], spec: { t: "string" }, element: false }); fields = c.fields; }
    for (const [k, fs] of Object.entries(fields || {})) if (Object.hasOwn(value, k)) sites(value[k], fs, [...path, k], out, false);
    return out;
  };
  const setAt = (root: any, path: (string | number)[], v: any, del = false) => { const r = structuredClone(root); let o = r; for (const k of path.slice(0, -1)) o = o[k]; const last = path[path.length - 1]; if (del) delete o[last]; else o[last] = v; return r; };
  const getAt = (root: any, path: (string | number)[]) => path.reduce((o, k) => o[k], root);
  const KINDS: Array<[string, any]> = [["42", 42], ["null", null], ["array", []], ["object", {}]];
  const mutants = (sample: any, rootSpec: any) => {
    const out: Array<{ why: string; raw: any }> = [];
    for (const s of sites(sample, rootSpec)) {
      const cur = getAt(sample, s.path); const where = s.path.join(".");
      if (!s.element && !s.spec.opt) out.push({ why: `${where} deleted`, raw: setAt(sample, s.path, null, true) });
      for (const [n, v] of KINDS) {
        // not a type change by the TABLE's type ([] where the table says array — also for a field that is null now —, 42 where it says number)
        if (typeOf(v) === s.spec.t && s.spec.t !== "object") continue;
        if (typeOf(v) === typeOf(cur) && typeOf(cur) !== "object") continue;
        if (s.spec.t === "any" && Array.isArray(v)) continue; // web_search_tool_result.content: an empty list is the other documented shape (a search with no results)
        if (v === null && s.spec.nullable) continue; // documented null
        out.push({ why: `${where} → ${n}`, raw: setAt(sample, s.path, structuredClone(v)) });
      }
    }
    return out;
  };
  const counts: Record<string, number> = {};
  const failed: string[] = [];
  const run = async (provider: string, label: string, list: Array<{ why: string; raw: any }>) => {
    counts[label] = list.length;
    for (const m of list) { const v = await realJudge(provider, m.raw); if (!(v.instrument === "other" && !v.pass && !v.falseCompletion && !v.undetermined)) failed.push(`${label}: ${m.why} → ${tag(v)}`); }
  };
  for (const [label, sample] of [["openai.N1", OA_N1], ["openai.N2", OA_N2]] as const) {
    expect(`M sample ${label} is good (done/pass) before it is broken`, tag(await realJudge("openai", sample)) === "done/null/pass");
    const list = mutants(sample, SHAPES.openai.top);
    for (const [n, v] of [...KINDS, ["string", "x"]] as Array<[string, any]>) list.push({ why: `top → ${n}`, raw: v });
    for (const s of ["failed", "incomplete", "in_progress", "cancelled", "queued"]) list.push({ why: `status ${s}`, raw: { ...sample, status: s } });
    list.push({ why: "status failed + error object", raw: { ...sample, status: "failed", error: { code: "server_error", message: "x" } } });
    list.push({ why: "error object with status completed", raw: { ...sample, error: { code: "x", message: "y" } } });
    list.push({ why: "status incomplete, reason content_filter", raw: { ...sample, status: "incomplete", incomplete_details: { reason: "content_filter" } } });
    await run("openai", label, list);
  }
  const anRoot = { t: "object", fields: { turns: { t: "array", items: SHAPES.anthropic.turn } } };
  for (const [label, sample] of [["anthropic.N1", AN_N1], ["anthropic.N2", AN_N2]] as const) {
    expect(`M sample ${label} is good (done/pass) before it is broken`, tag(await realJudge("anthropic", sample)) === "done/null/pass");
    const list = mutants(sample, anRoot);
    for (const [n, v] of [...KINDS, ["string", "x"]] as Array<[string, any]>) list.push({ why: `top → ${n}`, raw: v });
    list.push({ why: "turns []", raw: { turns: [] } });
    for (let i = 0; i < sample.turns.length; i++) { list.push({ why: `turns.${i}.content → 42 (explicit)`, raw: setAt(sample, ["turns", i, "content"], 42) }); list.push({ why: `turns.${i} → a single response without turns`, raw: sample.turns[i] }); }
    await run("anthropic", label, list);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`      response mutations: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ")} = ${total}`);
  expect(`M every response mutation (${total}) is the instrument other — never pass / false completion / undetermined`, failed.length === 0 && total > 0, failed.slice(0, 12).join(" | "));

  // the artifacts: break command / each argument / env one part at a time; none may be done
  const wrap = (art: any) => resp([wsc({ type: "open_page", url: REPO }), msgO(otext(fence(art), []))]);
  const artMutants = (art: any, form: "P2" | "P3") => {
    const out: Array<{ why: string; art: any }> = [];
    const entryPath = ["mcpServers", "AgileWorks"];
    const entry = getAt(art, entryPath);
    const BAD: Array<[string, any]> = [...KINDS, ["empty string", ""], ["x", "x"]];
    for (const [n, v] of BAD) out.push({ why: `command → ${n}`, art: setAt(art, [...entryPath, "command"], structuredClone(v)) });
    out.push({ why: "command deleted", art: setAt(art, [...entryPath, "command"], null, true) });
    for (const [n, v] of [...KINDS, ["x", "x"]] as Array<[string, any]>) out.push({ why: `args → ${n}`, art: setAt(art, [...entryPath, "args"], structuredClone(v)) });
    out.push({ why: "args deleted", art: setAt(art, [...entryPath, "args"], null, true) });
    entry.args.forEach((a: string, i: number) => {
      for (const [n, v] of BAD) out.push({ why: `args[${i}] (${a.slice(0, 18)}) → ${n}`, art: setAt(art, [...entryPath, "args", i], structuredClone(v)) });
      if (!(form === "P3" && a === "-y")) { const r = structuredClone(art); getAt(r, [...entryPath, "args"]).splice(i, 1); out.push({ why: `args[${i}] (${a.slice(0, 18)}) removed`, art: r }); } // -y removed is still the README's form
      if (/^x-(access-token|system-url):/.test(a)) out.push({ why: `args[${i}] value emptied`, art: setAt(art, [...entryPath, "args", i], a.split(":")[0] + ":") });
    });
    if (entry.env) {
      for (const [n, v] of KINDS) out.push({ why: `env → ${n}`, art: setAt(art, [...entryPath, "env"], structuredClone(v)) });
      out.push({ why: "env deleted", art: setAt(art, [...entryPath, "env"], null, true) });
      for (const k of Object.keys(entry.env)) {
        for (const [n, v] of [...KINDS, ["empty string", ""]] as Array<[string, any]>) out.push({ why: `env.${k} → ${n}`, art: setAt(art, [...entryPath, "env", k], structuredClone(v)) });
        out.push({ why: `env.${k} deleted`, art: setAt(art, [...entryPath, "env", k], null, true) });
      }
    }
    for (const [n, v] of [...KINDS, ["x", "x"]] as Array<[string, any]>) out.push({ why: `entry → ${n}`, art: setAt(art, entryPath, structuredClone(v)) });
    for (const [n, v] of [["42", 42], ["null", null], ["array", []], ["empty object", {}]] as Array<[string, any]>) out.push({ why: `mcpServers → ${n}`, art: setAt(art, ["mcpServers"], structuredClone(v)) });
    return out;
  };
  const artCounts: Record<string, number> = {}; const artFailed: string[] = [];
  for (const [form, art] of [["P2", P2], ["P3", P3]] as const) {
    expect(`M artifact ${form} is done before it is broken`, tag(await realJudge("openai", wrap(art))) === "done/null/pass");
    const list = artMutants(art, form);
    artCounts[form] = list.length;
    for (const m of list) { const v = await realJudge("openai", wrap(m.art)); let exclusive = true; try { assertExclusive({ pass: v.pass, false_completion: v.falseCompletion, undetermined: v.undetermined, instrument_error: v.instrument }); } catch { exclusive = false; } if (v.pass || v.reached === "done" || !exclusive) artFailed.push(`${form}: ${m.why} → ${tag(v)}`); }
  }
  // the version position of P3 (Claude's review of da628ca): npm alias / git / github: / file: / URL / a second @ / an empty version
  const VERSIONS = ["npm:evil-pkg", "npm:mcp-remote@0.1.16", "git+https://github.com/evil/x.git", "git://github.com/evil/x.git", "github:evil/mcp-remote", "evil/mcp-remote", "file:../evil", "https://evil.invalid/x.tgz", "1.0.0@evil", "@evil", "", "1.0.0#evil", "1.0.0/x", "latest:x", " 1.0.0", "-1.0.0", "1.0.0 ", "x\ny"];
  const pkgAt = P3.mcpServers.AgileWorks.args.indexOf("mcp-remote");
  const verFailed: string[] = [];
  for (const ver of VERSIONS) { const v = await realJudge("openai", wrap(setAt(P3, ["mcpServers", "AgileWorks", "args", pkgAt], `mcp-remote@${ver}`))); if (v.pass || v.reached === "done" || !ok(v, "artifact_form_unclear")) verFailed.push(`${JSON.stringify(ver)} → ${tag(v)}`); }
  for (const ver of ["latest", "0.1.16", "0.1.16-beta.1"]) { const v = await realJudge("openai", wrap(setAt(P3, ["mcpServers", "AgileWorks", "args", pkgAt], `mcp-remote@${ver}`))); if (!v.pass) verFailed.push(`control ${ver} → ${tag(v)}`); }
  artCounts.P3_version = VERSIONS.length;
  console.log(`      artifact mutations: P2 ${artCounts.P2}, P3 ${artCounts.P3}, P3 version position ${artCounts.P3_version} = ${artCounts.P2 + artCounts.P3 + artCounts.P3_version}`);
  expect(`M the version position of P3: every alias / git / github: / file: / URL / odd version (${VERSIONS.length}) is unclear, never done; a plain tag or semver stays official`, verFailed.length === 0, verFailed.join(" | "));
  expect(`M no broken artifact (${artCounts.P2 + artCounts.P3}) is done`, artFailed.length === 0, artFailed.slice(0, 12).join(" | "));
}

// replay adapter (fixtures' notes): the documented top level, only where a pre-table case lacks it
let adapted = 0;
const adapt = (raw: any, reader: string) => {
  const plain = raw !== null && typeof raw === "object" && !Array.isArray(raw);
  if (reader === "tracesOpenAI" && plain && !Object.hasOwn(raw, "status")) { adapted++; return { status: "completed", error: null, ...raw }; }
  if (reader === "tracesAnthropic" && plain && !Object.hasOwn(raw, "turns")) { adapted++; return { turns: [{ stop_reason: "end_turn", ...raw }] }; }
  return raw;
};
const adaptFake = (fake: Record<string, any>) => Object.fromEntries(Object.entries(fake).map(([k, v]) => [k, v?.raw?._traces_as ? { ...v, raw: { ...v.raw, response: adapt(v.raw.response, v.raw._traces_as) } } : v]));
const NO_CONFIG = "no_configuration";

// ── Part F: Codex's 55 cases of fe0d132 ──────────────────────────────────
{
  const fx = JSON.parse(readFileSync(join(FIX, "natural-task-cases-fe0d132.json"), "utf-8"));
  const verbatim = JSON.parse(readFileSync(join(FIX, "evidence", "codex-fe0d132-independent-cases.json"), "utf-8"));
  expect("F0 55 cases; ids, inputs and Codex's expectations equal the verbatim evidence", fx.cases.length === 55 && verbatim.cases.length === 55 && fx.cases.every((c: any, i: number) => c.id === verbatim.cases[i].id && eq(c.input, verbatim.cases[i].input) && eq(c.codex_expected, verbatim.cases[i].expected)));
  const nc = fx.cases.filter((c: any) => c.expect === NO_CONFIG);
  expect("F0 only the removed configurations' cases are revised (no_configuration); every other expectation is Codex's", fx.cases.every((c: any) => (c.expect === NO_CONFIG ? /perplexity|claude|marker|pp-|F7-/i.test(c.id) && typeof c.revised === "string" : eq(c.expect, c.codex_expected) && c.revised === undefined)) && nc.length === 20);
  console.log(`      fe0d132: ${fx.cases.length} cases, ${nc.length} no_configuration (not replayed), ${fx.cases.length - nc.length} replayed`);
  const actual: Array<[string, any]> = [];
  const check = (id: string, got: any) => actual.push([id, got]);
  const repo = REPO, key = repo.slice(8);
  const p2 = { mcpServers: { aw: { command: "node", args: ["/test/aw-app/dist/custom/admin/server.js"], env: { ACCESS_TOKEN: "TOKEN_CANARY", SYSTEM_URL: "https://system.invalid" } } } };
  const fenceF = (a: any) => "```json\n" + JSON.stringify(a) + "\n```";
  const oa = (text = fenceF(p2), url = repo) => ({ output: [{ type: "web_search_call", id: "ws_1", status: "completed", action: { type: "open_page", url } }, { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] });
  const judge = (raw: any, fn = "tracesOpenAI", files: any[] = []) => { const traces = (RULES as any)[fn](adapt(raw, fn)); return judgeNaturalTask({ traces, art: extractArtifact({ text: traces.text, files }), sealedKey: key }); };
  const checks = (v: any) => Object.fromEntries(v.checks.map((c: any) => [c.label, c.ok]));
  check("baseline-P2", judge(oa()).pass);
  for (const url of ["https://evil.invalid/" + repo, "https://github.com/other/fake-official-mcp-server", "https://github.com/fake-vendor/other", "https://evil.invalid/?url=" + repo, "https://github.com.evil.invalid/fake-vendor/fake-official-mcp-server"]) check("F2-url-" + actual.length, checks(judge(oa("", url))).fetched_sealed_repo);
  const candidate = { output: [{ type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: repo }] } }, { type: "message", content: [{ type: "output_text", text: repo + fenceF(p2), annotations: [] }] }] };
  check("F2-candidate-text-only", judge(candidate).pass);
  const p2headers = { mcpServers: { aw: { command: "node", args: ["/test/aw-app/dist/custom/admin/server.js", "--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"] } } };
  const p3env = { mcpServers: { aw: { command: "npx", args: ["mcp-remote", "https://host.invalid/mcp"], env: { "x-access-token": "t", "x-system-url": "u" } } } };
  for (const [id, artifact] of [["P2-header-instead-of-env", p2headers], ["P3-env-instead-of-header", p3env]] as const) check("F3-" + id, { auth_correct: judgeArtifact(artifact).auth_correct, pass: judge(oa(fenceF(artifact))).pass });
  const basic: any = structuredClone(p2); basic.mcpServers.aw.env.Authorization = "Basic Zm9vOmJhcg==";
  check("F3-Basic-env", { wrong_auth_field: judgeArtifact(basic).wrong_auth_field, pass: judge(oa(fenceF(basic))).pass });
  for (const [id, text] of [["none", "none"], ["many", fenceF(p2) + fenceF(p3env)], ["jsonc", '```json\n{"mcpServers":{/*x*/}}\n```']] as const) check("F3-artifact-" + id, judge(oa(text)).undetermined);
  for (const [id, raw, fn] of [["oa-wrong-item", { output: [42] }, "tracesOpenAI"], ["an-wrong-block", { content: [42] }, "tracesAnthropic"]] as const) check("F5-" + id, judge(raw, fn).instrument);
  const anRequest = { content: [{ type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: repo } }, { type: "text", text: fenceF(p2) }] };
  check("observation-Anthropic-request-no-result", checks(judge(anRequest, "tracesAnthropic")).fetched_sealed_repo);
  check("F6-reexport-identity", sourceRepoKey === sourceRepoKeyReexport);
  const fakeF: Record<string, any> = adaptFake({
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: oa(fenceF(p2headers)) } },
    "openai.N2": { raw: { _traces_as: "tracesOpenAI", response: { output: [42] } } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: { content: [{ type: "server_tool_use", id: "f", name: "web_fetch", input: { url: repo } }, { type: "web_fetch_tool_result", tool_use_id: "f", content: { type: "web_fetch_result", url: repo } }, { type: "text", text: fenceF(p3env) }] } } },
    "anthropic.N2": { error: "PROVIDER_ERROR_CANARY" },
  });
  const e = await dryRun(fakeF, [], "codex-fake.json");
  check("E2E-exit", e.status);
  const rowsF = e.metrics.readings.map((r: any, i: number) => ({ ...r, evidence_ref: "e#sha256:" + "a".repeat(64), outcome_id: i + 1 }));
  for (const row of rowsF) {
    const label = row.target.setup.config_id + "." + row.target.setup.prompt_variant;
    check("F1-exclusive-" + label, [row.observed.pass, row.observed.false_completion, row.observed.undetermined, !!row.observed.instrument_error].filter(Boolean).length);
    const { outcome_id, ...pure } = row; check("F1-schema-" + label, validateReading(pure, schema));
    check("E2E-" + label, row.observed.instrument_error || (row.observed.pass ? "pass" : row.observed.undetermined ? "undetermined" : "false_completion"));
  }
  if (rowsF.length) {
    const pure = structuredClone(rowsF[0]); delete pure.outcome_id; delete pure.target.setup;
    check("F1-missing-setup", validateReading(pure, schema).some((x: string) => x.includes("setup")));
    const extra = structuredClone(rowsF[0]); delete extra.outcome_id; extra.target.setup.extra = true;
    check("F1-extra-setup-key", validateReading(extra, schema).some((x: string) => x.includes("unexpected property extra")));
    const sheet = renderSheet(rowsF, { markerId: "M-993" });
    const readme = JSON.stringify(readmeRows(rowsF.map((r: any) => ({ ...r, _outcome: {} }))));
    check("F4-canaries", /TOKEN_CANARY|PROVIDER_ERROR_CANARY|system\.invalid|fake-official-mcp-server/.test(e.pub + sheet + readme));
    const mixed = structuredClone(rowsF.slice(0, 2)); mixed[1].target.setup = { ...rowsF[2].target.setup, prompt_variant: "N1", fetch_meaning: "provider_server_fetched" }; mixed[0].target.setup.fetch_meaning = "model_opened_page";
    for (const r of mixed) { r.stage_reached = "understand"; r.stage_stopped = "understand"; r.observed = { ...r.observed, pass: false, false_completion: true, undetermined: false, instrument_error: null }; }
    check("F8-cross-configuration-aggregate", renderSheet(mixed, { markerId: "M-993" }).includes("- 偽の完了: 2 回"));
  }
  const leakModel = "https://leak.invalid/ANSWER_CANARY";
  const l = await dryRun(adaptFake({ "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: oa() }, model: leakModel } }), ["--observers", "openai.N1"], "codex-leak.json");
  const hits = ["metrics.json", "manifest.json", "harness.jsonl"].filter((f) => l.bundle && readFileSync(join(l.bundle, f), "utf8").includes(leakModel));
  if (renderSheet(l.rows, { markerId: "M-993" }).includes(leakModel)) hits.push("SHEET");
  check("F4-provider-model-url-public", hits);
  const replayed = fx.cases.filter((c: any) => c.expect !== NO_CONFIG);
  expect("F every replayable case was replayed, in Codex's order", sameList(actual.map(([id]) => id), replayed.map((c: any) => c.id)), actual.map(([id]) => id).filter((id, i) => id !== replayed[i]?.id).join());
  for (const c of replayed) {
    const got = actual.find(([id]) => id === c.id);
    expect(`F ${c.id} → ${JSON.stringify(c.expect)}${c.codex_conforms ? "" : " (did not conform at fe0d132)"}`, Boolean(got) && eq(got![1], c.expect), JSON.stringify(got?.[1]));
  }
}

// ── Part G: Codex's 83 cases of 79e624d ──────────────────────────────────
// Codex's runner (outputs/reproduce-audit.mjs of the review) ported statement by statement. Its fetch redirect to a
// loopback is kept (a transport substitute; nothing leaves the machine).
{
  const fx = JSON.parse(readFileSync(join(FIX, "natural-task-cases-79e624d.json"), "utf-8"));
  const verbatim = JSON.parse(readFileSync(join(FIX, "evidence", "codex-79e624d-independent-cases.json"), "utf-8"));
  expect("G0 83 cases; ids, inputs and Codex's expectations equal the verbatim evidence", fx.cases.length === 83 && verbatim.cases.length === 83 && fx.cases.every((c: any, i: number) => c.id === verbatim.cases[i].id && eq(c.input, verbatim.cases[i].input) && eq(c.codex_expected, verbatim.cases[i].expected) && c.codex_conforms === verbatim.cases[i].conforms) && verbatim.commit === "79e624dce97e348d2066f3390fe0023dd7b40c33");
  const nc = fx.cases.filter((c: any) => c.expect === NO_CONFIG);
  const rev = fx.cases.filter((c: any) => c.expect !== NO_CONFIG && c.revised);
  const nonconf = fx.cases.filter((c: any) => !c.codex_conforms);
  expect("G0 20 did not conform; 25 are no_configuration (4 of the 20); 2 revised to undetermined (E2E-openai.N1 / N2: unclear is never a false completion)", nonconf.length === 20 && nc.length === 25 && nonconf.filter((c: any) => c.expect === NO_CONFIG).length === 4 && sameList(rev.map((c: any) => c.id), ["E2E-openai.N1", "E2E-openai.N2"]) && rev.every((c: any) => c.expect === "undetermined") && fx.cases.every((c: any) => c.expect === NO_CONFIG || c.revised || eq(c.expect, c.codex_expected)));
  console.log(`      79e624d: ${fx.cases.length} cases, ${nc.length} no_configuration (${nonconf.filter((c: any) => c.expect === NO_CONFIG).length} of them among the 20 nonconforming), ${fx.cases.length - nc.length} replayed, ${nonconf.length - nonconf.filter((c: any) => c.expect === NO_CONFIG).length} nonconforming replayed`);
  const adaptedBefore = adapted;
  const actual: Array<[string, any]> = [];
  const add = (id: string, got: any) => actual.push([id, got]);
  const repo = REPO, key = repo.slice(8);
  const p2 = { mcpServers: { aw: { command: "node", args: ["/test/aw-app/dist/custom/admin/server.js"], env: { ACCESS_TOKEN: "TOKEN_CANARY_INDEPENDENT", SYSTEM_URL: "https://system.invalid" } } } };
  const headers = ["--header", "x-access-token: TOKEN_CANARY_INDEPENDENT", "--header", "x-system-url: https://system.invalid"];
  const p3 = { mcpServers: { aw: { command: "npx", args: ["mcp-remote", "https://host.invalid/mcp", ...headers] } } };
  const fenceG = (a: any) => "```json\n" + JSON.stringify(a) + "\n```";
  const msg = (text: string) => ({ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
  const open = (url: any) => ({ type: "web_search_call", id: "ws_1", status: "completed", action: { type: "open_page", url } });
  const oa = (text = fenceG(p2), url: any = repo) => ({ id: "resp_1", object: "response", status: "completed", error: null, output: [open(url), msg(text)] });
  const verdict = (v: any) => v.instrument || (v.pass ? "pass" : v.falseCompletion ? "false_completion" : v.undetermined ? "undetermined" : "INVALID");
  const checks = (v: any) => Object.fromEntries(v.checks.map((c: any) => [c.label, c.ok]));
  const judge = (raw: any, reader = "tracesOpenAI", files: any[] = []) => { const traces = (RULES as any)[reader](adapt(raw, reader)); return judgeNaturalTask({ traces, art: extractArtifact({ text: traces.text, files }), sealedKey: key }); };
  const mutate = (a: any, f: (e: any) => void) => { a = structuredClone(a); f(a.mcpServers.aw); return a; };
  for (const [id, a] of [["P2", p2], ["P3", p3]] as const) add("baseline-" + id, verdict(judge(oa(fenceG(a)))));
  for (const [id, a] of [
    ["P2-echo", mutate(p2, (e) => (e.command = "echo"))], ["P2-node-other-script", mutate(p2, (e) => e.args.unshift("/test/unrelated.js"))], ["P2-node-eval", mutate(p2, (e) => e.args.unshift("-e", "console.log(1)"))],
    ["P3-other-package", mutate(p3, (e) => e.args.unshift("unrelated-package"))], ["P3-other-url-first", mutate(p3, (e) => e.args.splice(1, 0, "https://other.invalid/api"))],
  ] as const) { const v = judge(oa(fenceG(a))); add("F3-" + id, { points_official: checks(v).artifact_points_official, pass: v.pass }); }
  for (const [id, a] of [
    ["P2-header-not-env", mutate(p2, (e) => { delete e.env; e.args.push("--header", "ACCESS_TOKEN: t", "--header", "SYSTEM_URL: u"); })],
    ["P3-env-not-header", mutate(p3, (e) => { e.args = e.args.slice(0, 2); e.env = { "x-access-token": "t", "x-system-url": "u" }; })],
    ["P3-other-query", mutate(p3, (e) => { e.args = e.args.slice(0, 2); e.args.push("https://other.invalid/api?x-access-token=t&x-system-url=u"); })],
  ] as const) { const v = judge(oa(fenceG(a))); add("R1-" + id, { auth_correct: checks(v).artifact_auth_correct, pass: v.pass }); }
  for (const [id, a] of [
    ["env", mutate(p2, (e) => (e.env.Authorization = "Basic abc"))], ["header", mutate(p3, (e) => e.args.push("--header", "Authorization: Basic abc"))], ["query", mutate(p3, (e) => (e.args[1] += "?Authorization=Basic%20abc"))],
    ["env-interpolation", mutate(p3, (e) => { e.env = { AUTH: "Basic abc" }; e.args.push("--header", "Authorization: ${AUTH}"); })],
  ] as const) { const v = judge(oa(fenceG(a))); add("R2-" + id, { wrong_auth_field: checks(v).artifact_wrong_auth_field, verdict: verdict(v) }); }
  for (const [id, text] of [["none", "plain"], ["duplicate", '```json\n{"mcpServers":{},"mcpServers":' + JSON.stringify(p2.mcpServers) + "}\n```"], ["escaped-duplicate", '```json\n{"mcpServers":{},"mcp\\u0053ervers":' + JSON.stringify(p2.mcpServers) + "}\n```"], ["many", fenceG(p2) + "\n" + fenceG(p3)], ["unparseable", "```json\n{bad}\n```"]] as const) add("F3-extract-" + id, verdict(judge(oa(text))));
  for (const url of ["https://evil.invalid/?u=" + repo, "https://github.com.evil.invalid/fake-vendor/fake-official-mcp-server", "https://github.com/other/fake-official-mcp-server", "https://github.com/fake-vendor/other", "https://evil.invalid/" + repo, repo + "/../other", repo + "/%2e%2e/other"]) add("F2-url-" + (actual.length), sourceRepoKey(url) === key);
  const candidate = { output: [{ type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "q", sources: [{ type: "url", url: repo }] } }, msg(repo + "\n" + fenceG(p2))] };
  add("F2-candidate-and-free-text", verdict(judge(candidate)));
  for (const [id, reader, raw] of [
    ["oa-number", "tracesOpenAI", { output: [42] }], ["an-number", "tracesAnthropic", { content: [42] }],
    ["oa-open-url-missing", "tracesOpenAI", { output: [{ type: "web_search_call", id: "ws_1", status: "completed", action: { type: "open_page" } }, msg(fenceG(p2))] }],
    ["oa-open-url-wrong", "tracesOpenAI", { output: [open(42), msg(fenceG(p2))] }],
    ["oa-failed-response", "tracesOpenAI", { ...oa(), status: "failed", error: { code: "server_error", message: "ERROR_CANARY_INDEPENDENT" } }],
    ["an-search-query-wrong", "tracesAnthropic", { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: 42 } }, { type: "text", text: fenceG(p2), citations: [{ type: "web_search_result_location", url: repo, title: "t", encrypted_index: "e", cited_text: "x" }] }] }],
  ] as const) { const v = judge(raw, reader); add("F5-" + id, id === "oa-failed-response" ? (v.instrument ? "instrument" : verdict(v)) : verdict(v)); }
  // the end-to-end run: Codex's fake file; the removed configurations' entries have no observer to read them
  const fake: Record<string, any> = {
    "openai.N1": { raw: { _traces_as: "tracesOpenAI", response: oa(fenceG(mutate(p2, (e) => (e.command = "echo")))) } },
    "openai.N2": { raw: { _traces_as: "tracesOpenAI", response: oa(fenceG(mutate(p3, (e) => e.args.unshift("unrelated-package")))) } },
    "anthropic.N1": { raw: { _traces_as: "tracesAnthropic", response: { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: 42 } }, { type: "text", text: fenceG(p2), citations: [{ type: "web_search_result_location", url: repo, title: "t", encrypted_index: "e", cited_text: "x" }] }] } } },
    "anthropic.N2": { error: "ERROR_CANARY_INDEPENDENT", error_class: "alien" },
    "perplexity.N1": { raw: { _traces_as: "tracesPerplexity", response: { output: [] } }, model: "https://private.invalid/MODEL_CANARY_INDEPENDENT", cli_version: "VERSION_CANARY_INDEPENDENT" },
  };
  const e = await dryRun(adaptFake(fake), [], "codex-79e624d-fake.json");
  add("E2E-exit", e.status);
  const digestRows = e.metrics.readings.map((r: any) => ({ ...r, evidence_ref: `${e.rel}#sha256:${"a".repeat(64)}` }));
  for (const r of digestRows) {
    const label = `${r.target.setup.config_id}.${r.target.setup.prompt_variant}`; const o = r.observed;
    add("E2E-" + label, o.instrument_error || (o.pass ? "pass" : o.false_completion ? "false_completion" : "undetermined"));
    add("F1-schema-" + label, validateReading(r, schema));
    add("F1-exclusive-" + label, [o.pass, o.false_completion, o.undetermined, !!o.instrument_error].filter(Boolean).length);
  }
  const sheetRows = digestRows.map((r: any, i: number) => ({ ...r, outcome_id: i + 1 }));
  const sheet = renderSheet(sheetRows, { markerId: "M-993" }), readme = JSON.stringify(readmeRows(digestRows.map((r: any) => ({ ...r, _outcome: {} }))));
  const pubs: Record<string, string> = { "metrics.json": "", "manifest.json": "", "harness.jsonl": "" };
  for (const f of Object.keys(pubs)) pubs[f] = e.bundle ? readFileSync(join(e.bundle, f), "utf8") : "";
  pubs.SHEET = sheet; pubs.README = readme;
  for (const canary of [repo, "TOKEN_CANARY_INDEPENDENT", "ERROR_CANARY_INDEPENDENT", "MODEL_CANARY_INDEPENDENT", "VERSION_CANARY_INDEPENDENT", "mcpServers"]) add("F4-" + canary, Object.entries(pubs).filter(([, v]) => v.includes(canary)).map(([k]) => k));
  const groupRows = [structuredClone(sheetRows[0]), structuredClone(sheetRows[0]), structuredClone(sheetRows[0])]; groupRows[1].target.setup.fetch_meaning = "model_opened_page"; groupRows[2].target.setup.prompt_variant = "N2";
  add("F8-three-configurations", renderSheet(groupRows, { markerId: "M-993" }).split("\n").filter((l) => l.startsWith("| openai/") && l.includes("取得＝")).length);
  // the callers against a loopback
  let responseBody: any = {};
  const server = createServer((req, res) => { req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(Array.isArray(responseBody) ? responseBody.shift() : responseBody)); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => originalFetch(`http://127.0.0.1:${(server.address() as any).port}`)) as any;
  try {
    for (const [id, body] of [["missing", {}], ["wrong-type", { content: 42 }], ["null", { content: null }], ["continuation", [{ content: [{ type: "server_tool_use", id: "fetch1", name: "web_fetch", input: { url: repo } }, { type: "text", text: fenceG(p2) }], stop_reason: "pause_turn" }, { content: 42, stop_reason: "end_turn" }]]] as const) {
      responseBody = structuredClone(body);
      const obs = await runNaturalTask({ provider: "anthropic" }, "fake task");
      add("F5-caller-anthropic-" + id, verdict(await TARGETS.naturalTask.judge({ obs, sealed: { repo: key }, observer: { provider: "anthropic", label: "anthropic.N1" } })));
    }
    responseBody = { ...oa(), status: "failed", error: { code: "server_error", message: "ERROR_CANARY_INDEPENDENT" } };
    const obs = await runNaturalTask({ provider: "openai" }, "fake task");
    const v = await TARGETS.naturalTask.judge({ obs, sealed: { repo: key }, observer: { provider: "openai", label: "openai.N1" } });
    add("F5-caller-openai-failed", v.instrument ? "instrument" : verdict(v));
  } finally { globalThis.fetch = originalFetch; await new Promise<void>((r) => server.close(() => r())); }
  console.log(`      replay adapter applied to ${adapted - adaptedBefore} Part G inputs (top level supplied where a case lacked it)`);
  const replayed = fx.cases.filter((c: any) => c.expect !== NO_CONFIG);
  const order = (ids: string[]) => ids.filter((id) => !/^E2E-|^F1-/.test(id)); // E2E rows come in the run's order, not Codex's index order
  expect("G every replayable case was replayed", sameList([...actual.map(([id]) => id)].sort(), replayed.map((c: any) => c.id).sort()) && sameList(order(actual.map(([id]) => id)), order(replayed.map((c: any) => c.id))), [...replayed.map((c: any) => c.id).filter((id: string) => !actual.some(([a]) => a === id)), ...actual.map(([a]) => a).filter((a) => !replayed.some((c: any) => c.id === a))].join());
  for (const c of replayed) {
    const got = actual.find(([id]) => id === c.id);
    expect(`G ${c.id} → ${JSON.stringify(c.expect)}${c.codex_conforms ? "" : ` (did not conform at 79e624d${c.revised ? "; revised" : ""})`}`, Boolean(got) && eq(got![1], c.expect), JSON.stringify(got?.[1]));
  }
}

console.log(failures === 0 ? "\nmarker natural-task smoke: ALL PASS" : `\nmarker natural-task smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
