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
import { parseAnthropicSearch, parseOpenAISearch, parseGeminiSearch, perplexitySearchMeta, perplexityCitationKinds } from "./lib/audit-search-parsers.mjs";

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

// ── 検索した証拠はメタデータで見る（出典が 0 件でも「検索した／していない」を区別する）
check("meta anthropic: server_tool_use があれば searched", a.search_meta.searched === true && a.search_meta.queries === 1);
const aUsage = parseAnthropicSearch({ content: [{ type: "text", text: "x" }], usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 2 } } });
check("meta anthropic: usage の検索回数を優先し、usage を保持", aUsage.search_meta.queries === 2 && aUsage.usage.output_tokens === 5);
const aNo = parseAnthropicSearch({ content: [{ type: "text", text: "知っている範囲で答えます" }], usage: { server_tool_use: { web_search_requests: 0 } } });
check("meta anthropic: 検索せずに答えた応答は searched=false", aNo.search_meta.searched === false);
check("meta anthropic: 検索がエラーだけなら searched=false", parseAnthropicSearch({ content: [{ type: "server_tool_use", name: "web_search" }, { type: "web_search_tool_result", content: { type: "web_search_tool_result_error" } }, { type: "text", text: "x" }] }).search_meta.searched === false);
check("meta openai: completed の web_search_call で searched", o.search_meta.searched === true && parseOpenAISearch({ output: [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [] }] }] }).search_meta.searched === false);
check("meta gemini: webSearchQueries で判定（chunks が 0 でも検索は検索）", parseGeminiSearch({ candidates: [{ content: { parts: [{ text: "x" }] }, groundingMetadata: { webSearchQueries: ["q1", "q2"] } }] }).search_meta.searched === true && g.search_meta.searched === false);
check("meta perplexity: num_search_queries を読む", perplexitySearchMeta({ usage: { num_search_queries: 1 }, search_results: [] }).search_meta.searched === true && perplexitySearchMeta({ usage: {} }).search_meta.searched === false);
const g2 = parseGeminiSearch({ candidates: [{ content: { parts: [{ text: "x" }] }, groundingMetadata: { webSearchQueries: ["q"], groundingChunks: [{ web: { uri: "https://r/1", title: "a.com" } }, { web: { uri: "https://r/2", title: "kansei-link.com" } }], groundingSupports: [{ segment: {}, groundingChunkIndices: [1] }] } }] });
check("gemini: groundingSupports が指す chunk だけ cited、残りは retrieved", g2.citations[0].kind === "retrieved" && g2.citations[1].kind === "cited");
const pk = perplexityCitationKinds("認証は OAuth です[2]。", [{ url: "https://a" }, { url: "https://b" }, { url: "https://c" }]);
check("perplexity: 本文の [n] が指す出典だけ cited", pk.map((c) => c.kind).join(",") === "retrieved,cited,retrieved");

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-audit-search-parsers: ALL PASS" : "\n❌ smoke-audit-search-parsers: FAILURES");
process.exit(all ? 0 : 1);
