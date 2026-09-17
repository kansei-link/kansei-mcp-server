/**
 * agent-answer-audit（条件 B: サブスク認証のエージェント CLI で測る）用: CLI が出す JSONL の記録を読む純関数。
 *
 * 出力の形は ai-answer-audit（条件 A）の 1 回答と揃える → 採点（score-probe.cjs）をそのまま使える:
 *   { text, citations:[{url,kind}], search_meta:{searched,queries,evidence}, usage, model_returned, isolation, contamination:[...] }
 *   - cited     = 最終回答の本文に書かれた URL（エージェント CLI には本文の箇所に紐づく構造化引用が無い）
 *   - retrieved = 開いたページ・検索結果一覧の URL（Codex は検索結果一覧を出さないので「開いたページ」だけ）
 *   - contamination = このセルを無効にすべき理由の一覧（空なら OK）。
 *       測りたいのは「何も知らないエージェントが調べて引くか」。スキル・記憶・MCP・ファイル読みなど Web 以外の経路や、
 *       結果を 1 件も見る前から自社名で検索している場合は、事前知識の混入として無効にする。
 */

const URL_RE = /https?:\/\/[^\s<>"'`)\]}、。」】）]+/g;
// 検索語・ツール呼び出しに出たら事前知識を疑う語（最終回答や検索結果に出るのは正当な発見なので対象外）
export const PRIOR_KNOWLEDGE = /kansei|カンセイ|linksee|synapse\s?arrows|agent[\s-]?wiki|agent[\s-]?stars?/i;

const urlsIn = (s) => [...new Set((String(s ?? "").match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
const dedupe = (list) => { const seen = new Set(); return list.filter((c) => c.url && !seen.has(`${c.kind}|${c.url}`) && seen.add(`${c.kind}|${c.url}`)); };
const parseLines = (jsonl) => String(jsonl ?? "").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: "_unparsed", raw: l.slice(0, 200) }; } });

/** codex exec --json の JSONL */
export function parseCodexJsonl(jsonl) {
  const ev = parseLines(jsonl);
  const items = ev.filter((e) => e.type === "item.completed" && e.item).map((e) => e.item);
  const messages = items.filter((i) => i.type === "agent_message");
  const text = messages.length ? messages[messages.length - 1].text ?? "" : "";
  const searches = items.filter((i) => i.type === "web_search");
  const contamination = [];
  const retrieved = [];
  const queries = [];
  for (const s of searches) {
    const qs = s.action?.queries ?? (s.action?.query ? [s.action.query] : s.query ? [s.query] : []);
    const opened = s.action?.type !== "search" ? urlsIn(s.action?.url ?? s.query) : [];
    for (const u of opened) retrieved.push({ url: u, kind: "retrieved" });
    if (!opened.length) queries.push(...qs);
  }
  if (queries.length && PRIOR_KNOWLEDGE.test(queries[0])) contamination.push(`最初の検索語に自社関連語: ${queries[0].slice(0, 80)}`);
  // Web 検索と回答以外の項目（コマンド実行・ファイル読み・MCP 呼び出し等）は、隔離環境では起きないはず
  for (const i of items) if (!["agent_message", "web_search", "reasoning"].includes(i.type)) contamination.push(`Web 以外の項目: ${i.type}${i.command ? ` ${String(i.command).slice(0, 80)}` : ""}${i.server ? ` mcp=${i.server}` : ""}`);
  const errors = ev.filter((e) => e.type === "error" || e.type === "turn.failed").map((e) => e.message ?? e.error?.message ?? JSON.stringify(e).slice(0, 200));
  const done = ev.find((e) => e.type === "turn.completed");
  return {
    text,
    citations: dedupe([...urlsIn(text).map((url) => ({ url, kind: "cited" })), ...retrieved]),
    search_meta: { searched: searches.length > 0, queries: searches.length, evidence: `web_search items=${searches.length}（検索 ${queries.length}・開いたページ ${retrieved.length}）`, search_queries: queries },
    usage: done?.usage ?? null,
    model_returned: null, // codex exec の JSON にはモデル ID が出ない。-m で指定した値を実行側が記録する
    session_id: ev.find((e) => e.type === "thread.started")?.thread_id ?? null,
    isolation: null,
    contamination,
    error: errors.length ? errors.join(" | ") : !done ? "turn.completed が無い（途中終了）" : null,
  };
}

/** claude -p --output-format stream-json --verbose の JSONL */
export function parseClaudeJsonl(jsonl, { allowedTools = ["WebSearch", "WebFetch"] } = {}) {
  const ev = parseLines(jsonl);
  const init = ev.find((e) => e.type === "system" && e.subtype === "init") ?? null;
  const result = ev.find((e) => e.type === "result") ?? null;
  const contamination = [];
  const retrieved = [];
  const queries = [];
  let toolUses = 0;
  let firstToolSeen = false;
  for (const e of ev) {
    const blocks = Array.isArray(e.message?.content) ? e.message.content : [];
    for (const b of blocks) {
      if (e.type === "assistant" && b.type === "tool_use") {
        toolUses++;
        if (!allowedTools.includes(b.name)) contamination.push(`許可外のツール呼び出し: ${b.name}`);
        const q = b.input?.query ?? b.input?.url ?? "";
        if (b.name === "WebSearch") queries.push(q);
        if (b.name === "WebFetch" && b.input?.url) retrieved.push({ url: b.input.url, kind: "retrieved" });
        if (!firstToolSeen && PRIOR_KNOWLEDGE.test(q)) contamination.push(`最初のツール呼び出しに自社関連語: ${String(q).slice(0, 80)}`);
        firstToolSeen = true;
      } else if (e.type === "user" && b.type === "tool_result") {
        const body = typeof b.content === "string" ? b.content : (b.content ?? []).map((c) => c.text ?? "").join("\n");
        for (const u of urlsIn(body)) retrieved.push({ url: u, kind: "retrieved" });
      }
    }
  }
  const isolation = init ? { tools: init.tools ?? [], mcp_servers: init.mcp_servers ?? [], plugins: init.plugins ?? [], skills: init.skills ?? [], slash_commands: init.slash_commands ?? [], apiKeySource: init.apiKeySource ?? null, version: init.claude_code_version ?? null } : null;
  if (!init) contamination.push("init イベントが無い（隔離を確認できない）");
  else {
    const extraTools = isolation.tools.filter((t) => !allowedTools.includes(t));
    if (extraTools.length) contamination.push(`許可外のツールが有効: ${extraTools.join(",")}`);
    if (isolation.mcp_servers.length) contamination.push(`MCP サーバーが有効: ${isolation.mcp_servers.map((m) => m.name ?? m).join(",")}`);
    if (isolation.plugins.length) contamination.push(`プラグインが有効: ${isolation.plugins.length} 件`);
    if (isolation.skills.length) contamination.push(`スキルが有効: ${isolation.skills.join(",")}`);
    if (isolation.apiKeySource && isolation.apiKeySource !== "none") contamination.push(`API キーで実行されている: ${isolation.apiKeySource}`);
  }
  const text = result?.result ?? "";
  const u = result?.usage ?? null;
  const searched = (u?.server_tool_use?.web_search_requests ?? 0) + (u?.server_tool_use?.web_fetch_requests ?? 0) > 0 || toolUses > 0;
  return {
    text: result?.is_error ? "" : text,
    citations: dedupe([...urlsIn(result?.is_error ? "" : text).map((url) => ({ url, kind: "cited" })), ...retrieved]),
    search_meta: { searched, queries: toolUses, evidence: `tool_use=${toolUses}; usage.web_search_requests=${u?.server_tool_use?.web_search_requests ?? "n/a"}; web_fetch_requests=${u?.server_tool_use?.web_fetch_requests ?? "n/a"}`, search_queries: queries },
    usage: u ? { ...u, duration_ms: result?.duration_ms ?? null, num_turns: result?.num_turns ?? null, total_cost_usd_reference: result?.total_cost_usd ?? null } : null,
    model_returned: init?.model ?? null,
    session_id: init?.session_id ?? null,
    isolation,
    contamination,
    error: !result ? "result イベントが無い（途中終了）" : result.is_error ? String(result.result ?? result.terminal_reason ?? "error").slice(0, 300) : null,
  };
}
