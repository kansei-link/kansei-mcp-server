/**
 * Trust Score + Tier triage.
 *
 * Trust score (0-1) is a weighted blend of:
 *   - stars (log scale, capped)
 *   - recency of last commit
 *   - README quality
 *   - license presence
 *   - topic/category specificity
 *
 * Tier rules:
 *   - auto-accept: score >= 0.70 AND stars >= 25 AND recent (< 90d)
 *   - review:     score >= 0.35 (catch-all middle tier → human review)
 *   - reject:     score <  0.35 OR very low stars OR stale
 */
import type { ClassifiedCandidate, ScoredCandidate } from "../types.js";

function starsSignal(stars: number): number {
  // log(1+stars) normalized so that 1000 stars ≈ 1.0
  return Math.min(1, Math.log10(1 + stars) / 3);
}

function recencySignal(lastCommitAt: string | null): number {
  if (!lastCommitAt) return 0.3;
  const days = (Date.now() - new Date(lastCommitAt).getTime()) / 86400_000;
  if (days < 14) return 1.0;
  if (days < 45) return 0.85;
  if (days < 90) return 0.65;
  if (days < 180) return 0.4;
  if (days < 365) return 0.2;
  return 0.05;
}

function readmeSignal(c: ClassifiedCandidate): number {
  const excerpt = c.readme_excerpt || "";
  const len = excerpt.length;
  if (len < 100) return 0.1;
  if (len < 500) return 0.4;
  if (len < 1200) return 0.7;
  return 0.95;
}

function categorySignal(c: ClassifiedCandidate): number {
  // "Other" signals we weren't confident → lower score
  return c.proposed_category === "Other" ? 0.3 : 0.8;
}

function licenseSignal(c: ClassifiedCandidate): number {
  return c.has_license ? 1 : 0.4;
}

export function scoreCandidate(c: ClassifiedCandidate): ScoredCandidate {
  const signals = {
    stars: starsSignal(c.stars),
    recency: recencySignal(c.last_commit_at),
    readme: readmeSignal(c),
    category: categorySignal(c),
    license: licenseSignal(c),
  };

  // Weighted blend
  const trust_score =
    signals.stars * 0.35 +
    signals.recency * 0.25 +
    signals.readme * 0.2 +
    signals.category * 0.12 +
    signals.license * 0.08;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const score = round2(trust_score);

  let tier: "auto-accept" | "review" | "reject";
  let reject_reason: string | undefined;

  const daysOld = c.last_commit_at
    ? (Date.now() - new Date(c.last_commit_at).getTime()) / 86400_000
    : Infinity;

  if (c.stars < 2 && daysOld > 365) {
    tier = "reject";
    reject_reason = "abandoned: low stars + no commits in a year";
  } else if (!c.has_readme) {
    tier = "reject";
    reject_reason = "no usable README (< 100 chars)";
  } else if (score >= 0.7 && c.stars >= 25 && daysOld < 90) {
    tier = "auto-accept";
  } else if (score < 0.35) {
    tier = "reject";
    reject_reason = `low trust score (${score})`;
  } else {
    tier = "review";
  }

  return {
    ...c,
    trust_score: score,
    tier,
    reject_reason,
  };
}

export function scoreAll(candidates: ClassifiedCandidate[]): ScoredCandidate[] {
  return candidates.map(scoreCandidate);
}
