import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Reliability provenance — separating MEASURED telemetry from ESTIMATES.
//
// KanseiLink's `service_stats.success_rate` (and the per-outcome rows it is
// derived from) is a BLEND of two very different things:
//
//   1. Genuine field reports from real agents (report_outcome → 'anonymous').
//   2. Internally-generated outcomes that were never produced by a real agent
//      hitting a real SaaS API:
//        - 'test-harness-v1' : cold-start seed simulated from eval-derived
//          success probabilities (scripts/seed-test-outcomes.mjs).
//        - 'agent-army'      : internal multi-model eval harness that grades
//          *our own* guides/recipes, not the live API (src/agent-army/run.ts).
//        - 'scout_agent'     : scout inspection workaround checks
//          (src/tools/submit-inspection.ts).
//
// When the blended number is surfaced as plain `success_rate`, an estimate
// like "github 17%" masquerades as measured reality. This helper lets the
// tool surfaces label the basis honestly and expose the measured (live-only)
// rate separately from the estimate.
//
// Design choice: we BLACKLIST the known synthetic hashes rather than
// whitelist 'anonymous'. Real reports are 'anonymous' today, but workstream D
// will add distinct anonymized per-agent identifiers — those must count as
// live automatically, which the blacklist achieves for free.
//
// ⚠️ The blacklist MUST stay exhaustive. Every internal writer (probe, miner,
// seed, eval, self-test, fixtures) belongs in SYNTHETIC_AGENT_HASHES — otherwise
// its rows leak into the "measured live" success_rate and inflate the public
// per-vendor numbers (this was the 2026-06-16 audit finding). Known residual:
// cold-start rows written under 'anonymous' on 2026-04-04 are seed, not field
// reports, and cannot be separated by hash alone — surface rates conservatively
// until distinct per-agent hashes land.
// ---------------------------------------------------------------------------

/**
 * `agent_id_hash` values written by KanseiLink's OWN internal processes.
 * Any outcome with one of these hashes is an estimate/simulation, NOT a
 * genuine field report. Everything else is treated as live.
 */
export const SYNTHETIC_AGENT_HASHES = [
  "test-harness-v1",
  "agent-army",
  "scout_agent",
  // Added 2026-06-16 (audit): these internal writers were leaking through the
  // old 3-hash blacklist and being counted as "live measured" success.
  "health-probe", // HTTP / JSON-RPC reachability probe — not real agent usage
  "github-issues-miner", // scraped GitHub issue state — not real agent usage
  "self-test-fleet", // internal self-tests
  "agent1",
  "agent2",
  "agent3",
  "agent4",
  "agent5",
  "agent6",
  "test-agent", // hand fixtures
] as const;

export type ReliabilityBasis = "live" | "mixed" | "estimated" | "none";

export interface ReliabilitySource {
  /** Where the reliability numbers come from. */
  basis: ReliabilityBasis;
  /** True only when at least one genuine field report exists (basis live|mixed). */
  measured: boolean;
  /** Count of genuine field reports (non-synthetic agent_id_hash). */
  live_reports: number;
  /** Count of internally-generated (seed/eval/scout) outcomes. */
  estimated_reports: number;
  /** Success rate over LIVE reports only — null when there is no live data. */
  live_success_rate: number | null;
  /** Distinct genuine field agents (non-synthetic hashes). */
  live_agents: number;
  /** Short human-readable provenance note for tool consumers. */
  note: string;
}

/**
 * Classify a service's outcome history into live vs. estimated buckets.
 *
 * Single grouped query over `outcomes`; cheap enough to call per-result in
 * search (a handful of services) and once per detailed lookup.
 */
export function classifyReliabilitySource(
  db: Database.Database,
  serviceId: string
): ReliabilitySource {
  const rows = db
    .prepare(
      `SELECT agent_id_hash AS hash, COUNT(*) AS n, SUM(success) AS s
       FROM outcomes
       WHERE service_id = ?
       GROUP BY agent_id_hash`
    )
    .all(serviceId) as { hash: string | null; n: number; s: number | null }[];

  const synthetic = new Set<string>(SYNTHETIC_AGENT_HASHES);

  let live_reports = 0;
  let live_success_sum = 0;
  let estimated_reports = 0;
  let live_agents = 0;

  for (const r of rows) {
    // A null hash should never occur (column defaults to 'anonymous'), but if
    // it did we err on the side of NOT counting it as a trustworthy live agent.
    if (r.hash == null || synthetic.has(r.hash)) {
      estimated_reports += r.n;
    } else {
      live_reports += r.n;
      live_success_sum += r.s ?? 0;
      live_agents += 1; // one distinct non-synthetic hash
    }
  }

  const live_success_rate =
    live_reports > 0 ? live_success_sum / live_reports : null;

  let basis: ReliabilityBasis;
  if (live_reports === 0 && estimated_reports === 0) basis = "none";
  else if (live_reports > 0 && estimated_reports === 0) basis = "live";
  else if (live_reports === 0 && estimated_reports > 0) basis = "estimated";
  else basis = "mixed";

  let note: string;
  switch (basis) {
    case "none":
      note = "No outcome data yet — neither live reports nor internal estimates.";
      break;
    case "live":
      note = `Measured from ${live_reports} live agent report(s).`;
      break;
    case "mixed":
      note = `Measured from ${live_reports} live report(s); ${estimated_reports} internal estimate(s) are excluded from success_rate.`;
      break;
    case "estimated":
      note =
        "ESTIMATED from KanseiLink's internal eval/seed harness — NOT yet confirmed by live agents. Treat as a prior, not measured reality.";
      break;
  }

  return {
    basis,
    measured: live_reports > 0,
    live_reports,
    estimated_reports,
    live_success_rate,
    live_agents,
    note,
  };
}

/** Map a success rate (0..1) to KanseiLink's reliability label tiers. */
export function gradeLabel(rate: number): "excellent" | "good" | "fair" | "poor" {
  if (rate >= 0.95) return "excellent";
  if (rate >= 0.8) return "good";
  if (rate >= 0.6) return "fair";
  return "poor";
}
