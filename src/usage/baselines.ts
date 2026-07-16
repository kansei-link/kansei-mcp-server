// ESTIMATED baselines: what an agent typically burns learning a service's
// API *without* KanseiLink (web_search + web_fetch + trial-and-error).
//
// These are the same 2026-04-16 benchmark numbers the analyze_token_savings
// tool uses (freee / kintone / smarthr measured; everything else is a
// category-level extrapolation). They are ESTIMATES and every surface that
// shows them must label them as such — never mix them into "measured".
//
// Application rule (conservative): one avoided research flow per DISTINCT
// service per session, regardless of how many lookup calls the agent made
// for it. Repeat lookups for the same service in one session don't multiply
// the avoided cost.

export const BASELINE_BENCHMARK_DATE = "2026-04-16";

/** Per-service measured baselines from the benchmark run. */
const MEASURED_SERVICE_BASELINES: Record<string, number> = {
  freee: 14900,
  kintone: 25000,
  smarthr: 11400,
};

/** Category-average fallback used for services we haven't benchmarked. */
export const DEFAULT_BASELINE_TOKENS = 12000;

export interface BaselineResult {
  tokens: number;
  /** "measured_benchmark" for the 3 benchmarked services, else "category_estimate" */
  basis: "measured_benchmark" | "category_estimate";
}

export function baselineForService(serviceId: string): BaselineResult {
  const key = serviceId.toLowerCase();
  if (key in MEASURED_SERVICE_BASELINES) {
    return { tokens: MEASURED_SERVICE_BASELINES[key], basis: "measured_benchmark" };
  }
  return { tokens: DEFAULT_BASELINE_TOKENS, basis: "category_estimate" };
}

export const METHODOLOGY_NOTES_JA: string[] = [
  "「総トークン」「KanseiLink応答トークン」はあなたのセッション記録からの実測値です。",
  `「回避できた調査コスト」は${BASELINE_BENCHMARK_DATE}のベンチマーク（freee/kintone/smarthr実測、他はカテゴリ平均）に基づく推定値です。`,
  "同一セッション内で同じサービスを複数回参照しても、回避コストは1回分しか計上しません（保守的見積り）。",
  "コンテキスト肥大によるキャッシュ再読み込みの複利効果は含めていないため、実際の節約はこの数字より大きい可能性があります。",
  "「ハマりで溶けたトークン」はエラー出力＋リトライ中のモデル出力の実測合計ですが、『ハマり』への帰属判定（同一ツール2連続失敗〜解消まで）はヒューリスティックです。",
];

export const METHODOLOGY_NOTES_EN: string[] = [
  '"Total tokens" and "KanseiLink response tokens" are measured from your own session records.',
  `"Avoided research cost" is an estimate based on the ${BASELINE_BENCHMARK_DATE} benchmark (freee/kintone/smarthr measured; others use a category average).`,
  "Repeat lookups for the same service within one session count the avoided cost only once (conservative).",
  "Compounding cache re-read effects from context bloat are NOT included, so real savings are likely higher.",
  '"Tokens burned while stuck" sums measured error outputs + model output during retries, but attributing them to "being stuck" (2+ consecutive same-tool failures until resolution) is a heuristic.',
];
