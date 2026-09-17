/**
 * ai-answer-audit の費用計算と予算停止（--budget-usd）。純関数・API は呼ばない。
 *
 * 単価は公式の料金ページで確認した値だけを載せる（確認日つき）。表に無いモデルで --budget-usd を指定したら
 * 実行前に止める（知らない単価で「予算内」と言わない）。単価が変わったらここを直し、確認日を更新すること。
 *
 * 予算停止の考え方:
 *   1 問ごとに全エンジンへ同時に投げるので、投げた後は止められない。そこで「次の 1 問を投げる前」に、
 *   これまでの実費 ＋ 次に同時に走る呼び出し分の見込み（reserve）が上限を超えないかを見る。超えるなら投げない。
 *   reserve はエンジンごとに max(初期の安全側見積もり, これまでの 1 呼び出し最大実費 × 1.5)。
 *   使用量が返らなかった成功呼び出しは reserve 額を実費として計上する（安く見積もらない）。
 */

// USD。in/out は 100 万 token あたり、search は 1,000 回あたり、request は 1,000 リクエストあたり。
export const PRICES = [
  { engine: "anthropic", match: /^claude-opus-(4-[5-8]|5)/, in: 5, out: 25, search: 10, source: "platform.claude.com/docs/en/about-claude/pricing", checked: "2026-09-17" },
  { engine: "anthropic", match: /^claude-sonnet-5/, in: 2, out: 10, search: 10, source: "platform.claude.com/docs/en/about-claude/pricing", checked: "2026-09-17" },
  { engine: "openai", match: /^gpt-5\.4(-\d{4}-\d{2}-\d{2})?$/, in: 2.5, cached_in: 0.25, out: 15, search: 10, source: "developers.openai.com/api/docs/pricing（<272K context・検索で取得した内容はモデル単価で課金）", checked: "2026-09-17" },
  // Gemini は別名（gemini-flash-latest）の指す先が料金ページに無い。応答の modelVersion で引く。検索は 3.x=14・2.5=35 USD/1,000（無料枠は数えない）
  { engine: "gemini", match: /^gemini-3\.\d+-flash/, in: 0.75, out: 3.75, search: 14, source: "ai.google.dev/gemini-api/docs/pricing（3.8 Flash の単価を 3.x Flash 全体の上限として適用）", checked: "2026-09-17" },
  { engine: "gemini", match: /^gemini-2\.5-flash/, in: 0.3, out: 2.5, search: 35, source: "ai.google.dev/gemini-api/docs/pricing", checked: "2026-09-17" },
  // Perplexity sonar: リクエスト料は検索コンテキスト low=5 / medium=8 / high=12。指定していないので既定の low だが、安全側に high で計上
  { engine: "perplexity", match: /^sonar$/, in: 1, out: 1, request: 12, source: "docs.perplexity.ai/getting-started/pricing", checked: "2026-09-17" },
];

// 1 呼び出しの安全側の初期見積もり（USD）。実績が出るまでの reserve に使う
export const INITIAL_RESERVE = { anthropic: 1.0, openai: 0.3, gemini: 0.1, perplexity: 0.05 };

export const priceFor = (engine, model) => PRICES.find((p) => p.engine === engine && p.match.test(model ?? "")) ?? null;

/** usage（各社の形のまま）と検索回数から 1 呼び出しの費用を出す。単価が無ければ null */
export function costOf(engine, model, usage, searchQueries) {
  const p = priceFor(engine, model);
  if (!p || !usage) return null;
  const M = 1e6;
  let inTok = 0, cachedTok = 0, outTok = 0;
  if (engine === "anthropic") {
    // cache_* は今回使っていないが、返ってきたら通常入力として数える（安く見積もらない）
    inTok = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    outTok = usage.output_tokens ?? 0;
  } else if (engine === "openai") {
    cachedTok = usage.input_tokens_details?.cached_tokens ?? 0;
    inTok = (usage.input_tokens ?? 0) - cachedTok;
    outTok = usage.output_tokens ?? 0; // reasoning tokens は output_tokens に含まれる
  } else if (engine === "gemini") {
    inTok = (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0);
    outTok = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  } else if (engine === "perplexity") {
    // Perplexity は応答に請求額そのもの（usage.cost.total_cost）を返す。あればそれを使う
    if (typeof usage.cost?.total_cost === "number") return usage.cost.total_cost;
    inTok = usage.prompt_tokens ?? 0;
    outTok = usage.completion_tokens ?? 0;
  }
  const searches = engine === "gemini" ? (searchQueries > 0 ? 1 : 0) /* grounded prompt 単位 */ : searchQueries ?? 0;
  return (inTok * p.in) / M + (cachedTok * (p.cached_in ?? p.in)) / M + (outTok * p.out) / M + (searches * (p.search ?? 0)) / 1000 + (p.request ?? 0) / 1000;
}

export class Budget {
  constructor(limitUsd) { this.limit = limitUsd; this.spent = 0; this.maxSeen = {}; this.calls = {}; this.byEngine = {}; this.unpriced = 0; }
  reserve(engine) { return Math.max(INITIAL_RESERVE[engine] ?? 1, (this.maxSeen[engine] ?? 0) * 1.5); }
  /** 次に同時に走る呼び出し（engines）を投げてよいか */
  canStart(engines) { const need = engines.reduce((s, e) => s + this.reserve(e), 0); return { ok: this.spent + need <= this.limit, need, spent: this.spent, limit: this.limit }; }
  /** 成功した呼び出しの計上。cost=null（使用量なし）は reserve 額で計上 */
  record(engine, cost) {
    const c = cost ?? this.reserve(engine);
    if (cost == null) this.unpriced++;
    this.spent += c; this.calls[engine] = (this.calls[engine] ?? 0) + 1; this.byEngine[engine] = (this.byEngine[engine] ?? 0) + c;
    this.maxSeen[engine] = Math.max(this.maxSeen[engine] ?? 0, c);
    return c;
  }
  summary() { return { limit_usd: this.limit, spent_usd: Number(this.spent.toFixed(4)), by_engine_usd: Object.fromEntries(Object.entries(this.byEngine).map(([k, v]) => [k, Number(v.toFixed(4))])), calls: this.calls, max_call_usd: this.maxSeen, calls_without_usage: this.unpriced }; }
}
