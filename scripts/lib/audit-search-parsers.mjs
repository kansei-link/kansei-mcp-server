/**
 * ai-answer-audit の --search（検索つき）モード用: 各社 API の応答から「本文」と「出典」を取り出す純関数。
 *
 * 分けてある理由: 応答の形は各社で違い、ここを間違えると「引用されていない」と誤って数える。
 * API を呼ばずに固定の応答例で検査できるようにする（scripts/smoke-audit-search-parsers.mjs）。
 *
 * 出典は { url, title, kind } の配列。kind は
 *   - "retrieved": エンジンが検索で取得したページ（Perplexity の search_results と同じ意味）
 *   - "cited":     本文の特定箇所に紐づけて引用されたページ
 * Gemini の grounding は url がリダイレクト用（vertexaisearch…）で、実ドメインは title 側に入る。
 * そのため採点側は url と title の両方を見ること。
 */

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((c) => c.url && !seen.has(`${c.kind}|${c.url}`) && seen.add(`${c.kind}|${c.url}`));
};

// Anthropic Messages API + web_search ツール
export function parseAnthropicSearch(res) {
  const text = [];
  const cites = [];
  for (const b of res?.content ?? []) {
    if (b.type === "text") {
      text.push(b.text ?? "");
      for (const c of b.citations ?? []) if (c.url) cites.push({ url: c.url, title: c.title, kind: "cited" });
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) cites.push({ url: r.url, title: r.title, kind: "retrieved" });
    }
  }
  return { text: text.join(""), citations: dedupe(cites) };
}

// OpenAI Responses API + web_search ツール
export function parseOpenAISearch(data) {
  const text = [];
  const cites = [];
  for (const item of data?.output ?? []) {
    if (item.type === "web_search_call") {
      for (const s of item.action?.sources ?? []) if (s.url) cites.push({ url: s.url, title: s.title, kind: "retrieved" });
    } else if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        text.push(part.text ?? "");
        for (const a of part.annotations ?? []) if (a.type === "url_citation" && a.url) cites.push({ url: a.url, title: a.title, kind: "cited" });
      }
    }
  }
  return { text: text.join("\n"), citations: dedupe(cites) };
}

// Gemini generateContent + google_search（grounding）
export function parseGeminiSearch(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
  const cites = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((ch) => ({ url: ch.web?.uri, title: ch.web?.title, kind: "retrieved" }));
  return { text, citations: dedupe(cites) };
}
