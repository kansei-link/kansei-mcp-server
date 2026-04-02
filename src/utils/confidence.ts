export function calculateConfidence(
  uniqueAgents: number,
  totalCalls: number,
  lastUpdated: string | null
): number {
  if (totalCalls === 0) return 0;

  // Agent diversity factor (0-0.4): more unique agents = more trustworthy
  const agentFactor = Math.min(uniqueAgents / 5, 1) * 0.4;

  // Volume factor (0-0.3): more calls = more reliable stats
  const volumeFactor = Math.min(totalCalls / 50, 1) * 0.3;

  // Recency factor (0-0.3): fresher data = more relevant
  let recencyFactor = 0.1; // default: very old
  if (lastUpdated) {
    const daysSince =
      (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) recencyFactor = 1.0;
    else if (daysSince < 30) recencyFactor = 0.7;
    else if (daysSince < 90) recencyFactor = 0.4;
  }
  recencyFactor *= 0.3;

  return Math.min(1.0, agentFactor + volumeFactor + recencyFactor);
}
