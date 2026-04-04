/**
 * Confidence score calculator with pheromone evaporation.
 *
 * Like ant pheromone trails, data signals weaken over time.
 * This prevents stale data from misleading agents (ant death spiral).
 *
 * Three factors:
 * - Agent diversity: more unique agents = harder to game, more trustworthy
 * - Volume: more reports = more statistically reliable
 * - Recency: fresher data = more relevant (pheromone evaporation)
 */
export function calculateConfidence(
  uniqueAgents: number,
  totalCalls: number,
  lastUpdated: string | null
): number {
  if (totalCalls === 0) return 0;

  // Agent diversity factor (0-0.4): more unique agents = more trustworthy
  // Single-agent data is inherently less reliable (could be one bad experience)
  const agentFactor = Math.min(uniqueAgents / 5, 1) * 0.4;

  // Volume factor (0-0.3): more calls = more reliable stats
  const volumeFactor = Math.min(totalCalls / 50, 1) * 0.3;

  // Recency factor (0-0.3): pheromone evaporation
  // Data decays exponentially — 7 days fresh, then rapid decline
  let recencyFactor = 0.05; // very old: almost evaporated
  if (lastUpdated) {
    const daysSince =
      (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 3) recencyFactor = 1.0;       // very fresh
    else if (daysSince < 7) recencyFactor = 0.9;   // fresh
    else if (daysSince < 14) recencyFactor = 0.7;  // warm
    else if (daysSince < 30) recencyFactor = 0.5;  // cooling
    else if (daysSince < 60) recencyFactor = 0.3;  // stale
    else if (daysSince < 90) recencyFactor = 0.15; // very stale
    // else: 0.05 (almost evaporated)
  }
  recencyFactor *= 0.3;

  return Math.min(1.0, agentFactor + volumeFactor + recencyFactor);
}

/**
 * Calculate workaround reliability score.
 *
 * A workaround is only as good as its outcomes.
 * If agents follow a workaround but still fail, it's a false trail.
 */
export function calculateWorkaroundReliability(
  reportCount: number,
  successAfter: number,
  failureAfter: number,
  ageDays: number
): {
  score: number;
  label: "confirmed" | "likely_helpful" | "unverified" | "disputed" | "stale";
} {
  const totalAfter = successAfter + failureAfter;

  // Stale check first
  if (ageDays > 60) {
    return { score: 0.1, label: "stale" };
  }

  // Contradiction: more failures than successes after workaround shared
  if (totalAfter >= 3 && failureAfter > successAfter * 1.5) {
    return { score: 0.2, label: "disputed" };
  }

  // Not enough data
  if (reportCount < 2 || totalAfter < 2) {
    return { score: 0.3, label: "unverified" };
  }

  // Successful pattern
  const successRatio = totalAfter > 0 ? successAfter / totalAfter : 0;
  if (successRatio >= 0.7 && reportCount >= 3) {
    return { score: 0.9, label: "confirmed" };
  }
  if (successRatio >= 0.5) {
    return { score: 0.6, label: "likely_helpful" };
  }

  return { score: 0.3, label: "unverified" };
}
