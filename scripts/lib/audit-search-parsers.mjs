/**
 * ai-answer-audit の --search（検索つき）モード用: 各社 API の応答から「本文」「出典」「検索した証拠」「使用量」を取り出す純関数。
 *
 * 分けてある理由: 応答の形は各社で違い、ここを間違えると「引用されていない」と誤って数える。
 * API を呼ばずに固定の応答例で検査できるようにする（scripts/smoke-audit-search-parsers.mjs）。
 *
 * 出典は { url, title, kind } の配列。kind は
 *   - "retrieved": エンジンが検索で取得したページ（Perplexity の search_results と同じ意味）
 *   - "cited":     本文の特定箇所に紐づけて引用されたページ
 * Gemini の grounding は url がリダイレクト用（vertexaisearch…）で、実ドメインは title 側に入る。
 * そのため採点側は url と title の両方を見ること。
 *
 * search_meta = { searched, queries, evidence }
 *   「検索つきで聞いた」ことと「そのセルで実際に検索が走った」ことは別。モデルは検索せずに答えることがある。
 *   出典が 0 件のとき、検索して何も引かなかったのか、検索自体が走らなかったのかを区別するために、
 *   出典の文字列ではなく応答のメタデータ（ツール呼び出しの記録・使用量の検索回数）で判定する。
 * usage = 各社の使用量をそのまま（費用の実績計算用）
 */

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((c) => c.url && !seen.has(`${c.kind}|${c.url}`) && seen.add(`${c.kind}|${c.url}`));
};

// Anthropic Messages API + web_search ツール
export function parseAnthropicSearch(res) {
  const text = [];
  const cites = [];
  let toolUses = 0;
  let toolErrors = 0;
  for (const b of res?.content ?? []) {
    if (b.type === "text") {
      text.push(b.text ?? "");
      for (const c of b.citations ?? []) if (c.url) cites.push({ url: c.url, title: c.title, kind: "cited" });
    } else if (b.type === "server_tool_use" && b.name === "web_search") {
      toolUses++;
    } else if (b.type === "web_search_tool_result") {
      if (Array.isArray(b.content)) { for (const r of b.content) if (r.url) cites.push({ url: r.url, title: r.title, kind: "retrieved" }); } else toolErrors++;
    }
  }
  const billed = res?.usage?.server_tool_use?.web_search_requests ?? null;
  const queries = billed ?? toolUses;
  return {
    text: text.join(""),
    citations: dedupe(cites),
    search_meta: { searched: queries > 0 && toolErrors < Math.max(toolUses, 1), queries, evidence: `usage.server_tool_use.web_search_requests=${billed ?? "n/a"}; server_tool_use blocks=${toolUses}; result errors=${toolErrors}` },
    usage: res?.usage ?? null,
    model_returned: res?.model ?? null,
  };
}

// OpenAI Responses API + web_search ツール
export function parseOpenAISearch(data) {
  const text = [];
  const cites = [];
  let calls = 0;
  let completed = 0;
  for (const item of data?.output ?? []) {
    if (item.type === "web_search_call") {
      calls++;
      if (item.status === "completed") completed++;
      for (const s of item.action?.sources ?? []) if (s.url) cites.push({ url: s.url, title: s.title, kind: "retrieved" });
    } else if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        text.push(part.text ?? "");
        for (const a of part.annotations ?? []) if (a.type === "url_citation" && a.url) cites.push({ url: a.url, title: a.title, kind: "cited" });
      }
    }
  }
  return {
    text: text.join("\n"),
    citations: dedupe(cites),
    search_meta: { searched: completed > 0, queries: calls, evidence: `web_search_call items=${calls}; completed=${completed}` },
    usage: data?.usage ?? null,
    model_returned: data?.model ?? null,
  };
}

// Gemini generateContent + google_search（grounding）
export function parseGeminiSearch(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
  const gm = cand?.groundingMetadata;
  // groundingSupports が本文の箇所に紐づけた chunk は「引用」、それ以外の chunk は「取得」
  const citedIdx = new Set((gm?.groundingSupports ?? []).flatMap((sp) => sp.groundingChunkIndices ?? []));
  const cites = (gm?.groundingChunks ?? []).map((ch, i) => ({ url: ch.web?.uri, title: ch.web?.title, kind: citedIdx.has(i) ? "cited" : "retrieved" }));
  const q = gm?.webSearchQueries ?? [];
  return {
    text,
    citations: dedupe(cites),
    search_meta: { searched: q.length > 0, queries: q.length, evidence: `groundingMetadata.webSearchQueries=${q.length}; groundingChunks=${(gm?.groundingChunks ?? []).length}` },
    usage: data?.usageMetadata ?? null,
    model_returned: data?.modelVersion ?? null,
  };
}

// Perplexity: 本文の [n] は search_results の n 番目（1 始まり）を指す。指された出典は「引用」、残りは「取得」
export function perplexityCitationKinds(text, list) {
  const idx = new Set([...(text ?? "").matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]) - 1));
  return (list ?? []).map((c, i) => ({ ...c, kind: idx.has(i) ? "cited" : "retrieved" }));
}

// Perplexity chat/completions（常に検索つき）。出典の正規化は呼び出し側の normCitations を使うので、ここはメタデータだけ。
export function perplexitySearchMeta(data) {
  const n = data?.usage?.num_search_queries ?? null;
  const results = (data?.search_results ?? data?.citations ?? []).length;
  return {
    search_meta: { searched: (n ?? 0) > 0 || (data?.usage?.cost?.request_cost ?? 0) > 0 || results > 0, queries: n, evidence: `usage.num_search_queries=${n ?? "n/a"}; usage.cost.request_cost=${data?.usage?.cost?.request_cost ?? "n/a"}; search_results=${results}; usage.search_context_size=${data?.usage?.search_context_size ?? "n/a"}` },
    usage: data?.usage ?? null,
    model_returned: data?.model ?? null,
  };
}
