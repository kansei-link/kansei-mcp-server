/**
 * KanseiLink Felt Score — Agent Experience Rating (AXR)
 *
 * Credit-rating style grading for MCP/API services, derived from 225
 * hand-evaluated services. Measures "how safe does an AI agent FEEL
 * when trying to use this service?"
 *
 * ═══════════════════════════════════════════════════════════════════
 *  Grade  │ Meaning                         │ Agent 安心感
 * ────────┼─────────────────────────────────┼──────────────────────
 *  AAA    │ MCP 自身が罠を先回り警告        │ 最高。安心して任せられる
 *  AA     │ ガイド完備＋trust signal あり    │ 高い。ほぼ迷わない
 *  A      │ ガイドあり、実装可能             │ 普通に使える
 *  B      │ ガイドはあるが限定的/setup 重め  │ やや不安
 *  C      │ api_url は正規だがガイドなし     │ 外部検索必須
 *  D      │ api_url が会社 TOP/情報ゼロ      │ 実質使えない
 *  F      │ 存在自体が疑わしい               │ 危険
 * ═══════════════════════════════════════════════════════════════════
 *
 * AAA の定義:
 *   - MCP 本家が CRITICAL な gotcha (auth の罠、non-standard header、
 *     HTTP 200 + error body など) をドキュメント先頭で警告している
 *   - エージェントが「読んだ後に安心できる」レベルの tips 密度
 *   - 数値条件: score >= 92 AND D5 >= 4 AND D2 >= 5 AND D3 >= 5
 *     (全 capability carrier が完璧 + trust signal あり)
 *
 * AA vs A の差:
 *   - AA: score >= 90 (sum >= 23, ガイド完備で情報密度が高い)
 *   - A:  score >= 82 (sum >= 21-22, ガイドあるが一部薄い or trust 低め)
 *
 * 5 dimensions (felt by an agent trying to use the service):
 *   D1 Discoverability  — can the agent decide IF the service fits?
 *   D2 Onboarding       — how many steps to first successful call?
 *   D3 Auth Clarity     — can the agent execute auth with only our info?
 *   D4 Capability Signal — does the agent know WHAT it can do?
 *   D5 Trust Signal     — evidence this works reliably long-term
 *
 * Correlation with grade rank (from 225-service ground truth):
 *   D1=0.542, D2=0.940, D3=0.953, D4=0.933, D5=0.560, SUM=0.958
 */

export type Dims = readonly [number, number, number, number, number];
export type Grade = 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D' | 'F';

export const DIM_NAMES = [
  'discoverability',
  'onboarding',
  'auth_clarity',
  'capability_signal',
  'trust_signal',
] as const;

export interface FeltScoreInput {
  dims: Dims;
  facade?: boolean;
}

export interface FeltScoreResult {
  /** 0-100 continuous score */
  score: number;
  /** Credit-rating style grade */
  grade: Grade;
  /** Raw dimension sum (5-25) before facade penalty */
  raw_sum: number;
  /** Whether facade penalty was applied */
  facade_applied: boolean;
  /** AAA requires: D5 >= 4 (agent 安心感) */
  trust_gate_passed: boolean;
  /** AAA requires: D2 >= 5 AND D3 >= 5 (完璧な onboarding + auth) */
  capability_gate_passed: boolean;
  /** Per-dimension breakdown */
  dim_breakdown: Record<(typeof DIM_NAMES)[number], number>;
}

/** Facade penalty in score points (~1 grade band) */
export const FACADE_PENALTY = 15;

/**
 * Band thresholds calibrated empirically to 225-service ground truth.
 *
 * Grid search result: 85.3% exact match with old A+/A system.
 * New AAA/AA/A split resolves the previous A+/A boundary ambiguity
 * by adding a "capability gate" (D2=5 AND D3=5) that captures the
 * "CRITICAL gotcha documentation" quality.
 */
const BAND = {
  AAA: 92, // requires BOTH trust gate AND capability gate
  AA: 90, // high score, complete guide + some trust
  A: 82, // solid guide
  B: 68,
  C: 35,
  D: 15,
};

/** AAA requires D5 (trust signal) >= this */
const TRUST_GATE_MIN = 4;

/**
 * AAA requires D2 (onboarding) AND D3 (auth clarity) >= this.
 * Rationale: if the MCP proactively documents gotchas, both
 * onboarding and auth instructions will be at maximum clarity.
 */
const CAPABILITY_GATE_MIN = 5;

/**
 * Compute the felt score, grade, and breakdown for a service.
 *
 * Formula:
 *   raw_sum  = sum(D1..D5)                          # 5-25
 *   score    = (raw_sum - 5) / 20 * 100             # 0-100
 *   if facade: score -= 15
 *
 * Grade logic:
 *   AAA if score >= 92 AND D5 >= 4 AND D2 >= 5 AND D3 >= 5
 *   AA  if score >= 90
 *   A   if score >= 82
 *   B   if score >= 68
 *   C   if score >= 35
 *   D   if score >= 15
 *   F   otherwise
 */
export function computeFeltScore({
  dims,
  facade = false,
}: FeltScoreInput): FeltScoreResult {
  if (dims.length !== 5) {
    throw new Error(`dims must have exactly 5 entries, got ${dims.length}`);
  }
  for (const d of dims) {
    if (!Number.isFinite(d) || d < 1 || d > 5) {
      throw new Error(`each dim must be 1-5, got ${d}`);
    }
  }

  const raw_sum = dims.reduce((s, n) => s + n, 0);
  let score = ((raw_sum - 5) / 20) * 100;
  if (facade) score -= FACADE_PENALTY;

  // Clamp
  score = Math.max(0, Math.min(100, score));
  score = Math.round(score * 10) / 10;

  const [d1, d2, d3, d4, d5] = dims;
  const trust_gate_passed = d5 >= TRUST_GATE_MIN;
  const capability_gate_passed = d2 >= CAPABILITY_GATE_MIN && d3 >= CAPABILITY_GATE_MIN;

  const grade: Grade =
    score >= BAND.AAA && trust_gate_passed && capability_gate_passed
      ? 'AAA'
      : score >= BAND.AA
        ? 'AA'
        : score >= BAND.A
          ? 'A'
          : score >= BAND.B
            ? 'B'
            : score >= BAND.C
              ? 'C'
              : score >= BAND.D
                ? 'D'
                : 'F';

  return {
    score,
    grade,
    raw_sum,
    facade_applied: facade,
    trust_gate_passed,
    capability_gate_passed,
    dim_breakdown: {
      discoverability: d1,
      onboarding: d2,
      auth_clarity: d3,
      capability_signal: d4,
      trust_signal: d5,
    },
  };
}

/**
 * Convert grade to numeric rank (higher = better). Useful for sorting.
 */
export function gradeRank(grade: Grade): number {
  return { AAA: 7, AA: 6, A: 5, B: 4, C: 3, D: 2, F: 1 }[grade];
}

/**
 * Human-readable label for each grade.
 */
export function gradeLabel(grade: Grade): string {
  return {
    AAA: '最高品質 — MCP自身が罠を警告、エージェント安心感MAX',
    AA: '高品質 — ガイド完備、trust signal あり',
    A: '良好 — ガイドあり、実装可能',
    B: '限定的 — ガイドはあるが setup 重め',
    C: 'ガイドなし — 外部検索必須',
    D: '情報不足 — 実質使えない',
    F: '危険 — 存在自体が疑わしい',
  }[grade];
}

/**
 * Compute "improvement headroom": how much score would improve if each
 * dimension were maxed. Used in consulting reports to show clients
 * where to invest effort.
 */
export function improvementHeadroom(
  dims: Dims,
  facade = false
): Record<(typeof DIM_NAMES)[number], number> {
  const current = computeFeltScore({ dims, facade }).score;
  const result = {} as Record<(typeof DIM_NAMES)[number], number>;
  for (let i = 0; i < 5; i++) {
    if (dims[i] >= 5) {
      result[DIM_NAMES[i]] = 0;
      continue;
    }
    const hypothetical = [...dims] as number[];
    hypothetical[i] = 5;
    const next = computeFeltScore({
      dims: hypothetical as unknown as Dims,
      facade,
    }).score;
    result[DIM_NAMES[i]] = Math.round((next - current) * 10) / 10;
  }
  return result;
}
