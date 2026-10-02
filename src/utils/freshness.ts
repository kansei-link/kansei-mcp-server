/**
 * Data freshness — what we tell an agent about how current a service record is.
 *
 * Two separate honesty problems live here.
 *
 * **An attempt is not a check.** Until 2026-09-20, `refreshExistingServices()`
 * stamped `services.last_refreshed_at` on every row it visited — the UPDATE sits
 * outside the branch that tests whether GitHub or npm answered — so a failed
 * fetch still produced a recent-looking date. 8,050 of 11,528 rows advertised a
 * refresh no successful read stood behind.
 *
 * **A check is not a check of everything.** The refresh pass reads GitHub and
 * npm. What answers proves the repository or package is reachable, and carries
 * stars, latest version and the archived flag. It says nothing about whether the
 * *description* is still true — a repo blurb is not where a vendor states
 * product facts — and nothing whatsoever about the API connection guide, which
 * lives in another table and is written by another process. Reporting one
 * undifferentiated "freshness" invited exactly that misreading: ENTIA's record
 * was checked on 2026-07-26 and its description was wrong for 74 days.
 *
 * So freshness is scoped. It answers "when did an upstream source last answer
 * for this service, and which one", and it names what that does not cover.
 */

/** `unverified` is a first-class answer, not a degraded `low`. */
export type FreshnessConfidence = "high" | "medium" | "low" | "unverified";

/**
 * What a check covers. Deliberately narrow, and deliberately not the name of
 * the record as a whole. New scopes get their own value rather than widening
 * the meaning of this one.
 */
export type FreshnessScope = "upstream_metadata";

/**
 * Which upstream answered. `changelog_backfill` is historical only: rows whose
 * service_changelog proves some source answered on a date, without a record of
 * which. No new write may use it.
 */
export type VerificationSource =
  | "github"
  | "npm"
  | "changelog_backfill";

export interface FreshnessInput {
  upstream_checked_at: string | null;
  upstream_check_source: string | null;
  last_refresh_attempt_at: string | null;
  last_refresh_status: string | null;
}

export interface FreshnessMeta {
  /** What this date covers. Never widen — add a scope instead. */
  scope: FreshnessScope;
  /** Days since an upstream last answered; null when none ever has. */
  data_age_days: number | null;
  /** When an upstream last answered; null when none ever has. */
  last_checked: string | null;
  /** Which upstream answered; null when none ever has. */
  checked_source: string | null;
  confidence: FreshnessConfidence;
  /** When we last *tried*. Diagnostic only — not evidence of anything. */
  last_attempt: string | null;
  /** Outcome of that attempt (`ok` / `unreachable`). */
  last_attempt_status: string | null;
  /**
   * @deprecated Present so consumers of the pre-2026-09 shape keep parsing.
   * Mirrors `last_checked`, so it is null rather than misleading when nothing
   * has been checked. Its old name overstates what it means; read
   * `last_checked` with `scope`. Removed in the next major.
   */
  last_refreshed: string | null;
}

/**
 * Emitted once per response, not per row. Says in words what `scope` means, so
 * an agent cannot read a reachability check as confirmation of the prose next
 * to it.
 */
export const FRESHNESS_LEGEND = {
  upstream_metadata: {
    covers: [
      "the GitHub repository or npm package still resolves",
      "stars, latest published version, and the upstream archived flag",
    ],
    does_not_cover: [
      "whether the description text is still accurate",
      "anything in connection_guide — that content has its own, separate date",
      "whether mcp_endpoint is reachable (that is the health probe, reported as mcp_status)",
    ],
    unverified_means:
      "no upstream has answered for this service since records began — not that it is stale, that it is unchecked",
  },
} as const;

const DAY_MS = 1000 * 60 * 60 * 24;

function unchecked(row: FreshnessInput): FreshnessMeta {
  return {
    scope: "upstream_metadata",
    data_age_days: null,
    last_checked: null,
    checked_source: null,
    confidence: "unverified",
    last_attempt: row.last_refresh_attempt_at ?? null,
    last_attempt_status: row.last_refresh_status ?? null,
    last_refreshed: null,
  };
}

export function computeFreshness(
  row: FreshnessInput,
  now: Date = new Date()
): FreshnessMeta {
  if (!row.upstream_checked_at) return unchecked(row);

  const checkedAt = new Date(row.upstream_checked_at);
  // A malformed stored date is not evidence of anything.
  if (Number.isNaN(checkedAt.getTime())) return unchecked(row);

  const ageDays = Math.floor((now.getTime() - checkedAt.getTime()) / DAY_MS);

  let confidence: FreshnessConfidence;
  if (ageDays <= 7) confidence = "high";
  else if (ageDays <= 30) confidence = "medium";
  else confidence = "low";

  return {
    scope: "upstream_metadata",
    data_age_days: ageDays,
    last_checked: row.upstream_checked_at,
    checked_source: row.upstream_check_source ?? null,
    confidence,
    last_attempt: row.last_refresh_attempt_at ?? null,
    last_attempt_status: row.last_refresh_status ?? null,
    last_refreshed: row.upstream_checked_at,
  };
}

/** Columns every caller of computeFreshness must select. */
export const FRESHNESS_COLUMNS =
  "upstream_checked_at, upstream_check_source, last_refresh_attempt_at, last_refresh_status";
