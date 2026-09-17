#!/usr/bin/env node
/**
 * ai-answer-audit --search の応答解析の回帰テスト（API は呼ばない・固定の応答例だけ）
 *
 * 守るもの: 各社の応答から出典を取りこぼすと「引用されていない」と誤って数える。
 *   - Anthropic: 本文ブロックの citations（cited）と web_search_tool_result（retrieved）
 *   - OpenAI Responses: message の url_citation（cited）と web_search_call.action.sources（retrieved）
 *   - Gemini: groundingChunks。url はリダイレクト用で、実ドメインは title に入る
 *   - 検索がエラー／結果なしでも落ちない
 */
import { parseAnthropicSearch, parseOpenAISearch, parseGeminiSearch } from "./lib/audit-search-parsers.mjs";

const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

const a = parseAnthropicSearch({ content: [
  { type: "text", text: "調べます。" },
  { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
  { type: "web_search_tool_result", tool_use_id: "s1", content: [
    { type: "web_search_result", url: "https://example.com/a", title: "A" },
    { type: "web_search_result", url: "https://kansei-link.com/agent-wiki/services/x.html", title: "X" } ] },
  { type: "text", text: "認証は OAuth2 です。", citations: [{ type: "web_search_result_location", url: "https://example.com/a", title: "A", cited_text: "…" }] },
] });
check("anthropic: 本文を連結", a.text === "調べます。認証は OAuth2 です。");
check("anthropic: retrieved 2 件＋cited 1 件", a.citations.filter((c) => c.kind === "retrieved").length === 2 && a.citations.filter((c) => c.kind === "cited").length === 1);
const aErr = parseAnthropicSearch({ content: [{ type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }, { type: "text", text: "不明です" }] });
check("anthropic: 検索エラーの応答でも落ちない", aErr.text === "不明です" && aErr.citations.length === 0);

const o = parseOpenAISearch({ output: [
  { type: "reasoning", summary: [] },
  { type: "web_search_call", status: "completed", action: { type: "search", query: "x", sources: [{ type: "url", url: "https://example.com/b" }] } },
  { type: "message", content: [{ type: "output_text", text: "公式 MCP があります。", annotations: [{ type: "url_citation", url: "https://kansei-link.com/agent-wiki/services/x.html", title: "X", start_index: 0, end_index: 3 }, { type: "file_citation", file_id: "f" }] }] },
] });
check("openai: 本文と url_citation（cited）と sources（retrieved）", o.text === "公式 MCP があります。" && o.citations.length === 2 && o.citations.some((c) => c.kind === "cited" && c.url.includes("kansei-link.com")) && o.citations.some((c) => c.kind === "retrieved"));
check("openai: output が無い応答でも落ちない", parseOpenAISearch({}).text === "" && parseOpenAISearch({}).citations.length === 0);

const g = parseGeminiSearch({ candidates: [{ content: { parts: [{ text: "回答" }] }, groundingMetadata: { groundingChunks: [
  { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "kansei-link.com" } },
  { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "kansei-link.com" } },
  { retrievedContext: { uri: "gs://x" } } ] } }] });
check("gemini: title に実ドメインを保持・重複と url なしを除く", g.text === "回答" && g.citations.length === 1 && g.citations[0].title === "kansei-link.com");
check("gemini: grounding なしでも落ちない", parseGeminiSearch({ candidates: [{ content: { parts: [{ text: "x" }] } }] }).citations.length === 0);

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-audit-search-parsers: ALL PASS" : "\n❌ smoke-audit-search-parsers: FAILURES");
process.exit(all ? 0 : 1);
