/**
 * Data freshness — what we tell an agent about how current a service record is.
 *
 * The distinction this module exists to enforce: **an attempt to refresh is not
 * a verification.** Until 2026-09-20, `refreshExistingServices()` stamped
 * `services.last_refreshed_at` unconditionally — the UPDATE sat outside the
 * branch that checked whether GitHub/npm had actually answered — so a row whose
 * upstream fetch failed still advertised a recent "refreshed" date. 8,657 rows
 * carried such a date while nothing had been re-read. The ENTIA record is the
 * worked example: stamped 2026-07-26, description untouched since ingest on
 * 2026-06-08, and wrong about the vendor's own free tier for 74 days.
 *
 * So freshness is derived from `last_verified_at` alone, which is written only
 * when a source returned data. `last_refresh_attempt_at` is carried alongside
 * it for diagnostics and is never presented as freshness.
 */

/** `unverified` is a first-class answer, not a degraded `low`. */
export type FreshnessConfidence = "high" | "medium" | "low" | "unverified";

/**
 * What answered. `changelog_backfill` is historical only: rows whose
 * service_changelog proves an upstream source answered on some date, without a
 * record of which one. No new writes should use it.
 */
export type VerificationSource =
  | "github"
  | "npm"
  | "mcp_probe"
  | "registry"
  | "operator"
  | "changelog_backfill";

export interface FreshnessInput {
  last_verified_at: string | null;
  last_verified_source: string | null;
  last_refresh_attempt_at: string | null;
  last_refresh_status: string | null;
}

export interface FreshnessMeta {
  /** Days since the last *successful* verification; null when never verified. */
  data_age_days: number | null;
  /** When a source last answered; null when never verified. */
  last_verified: string | null;
  /** Which source answered; null when never verified. */
  verified_source: string | null;
  confidence: FreshnessConfidence;
  /** When we last *tried*. Diagnostic only — not evidence of freshness. */
  last_attempt: string | null;
  /** Outcome of that attempt (`ok` / `unreachable` / `no_data`). */
  last_attempt_status: string | null;
  /**
   * @deprecated Kept so existing consumers keep parsing. Mirrors
   * `last_verified`, so it is null rather than misleading when unverified.
   * Read `last_verified` instead; this field goes away in the next major.
   */
  last_refreshed: string | null;
}

const DAY_MS = 1000 * 60 * 60 * 24;

function unverified(row: FreshnessInput): FreshnessMeta {
  return {
    data_age_days: null,
    last_verified: null,
    verified_source: null,
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
  if (!row.last_verified_at) return unverified(row);

  const verifiedAt = new Date(row.last_verified_at);
  // A malformed stored date is not evidence of anything.
  if (Number.isNaN(verifiedAt.getTime())) return unverified(row);

  const ageDays = Math.floor((now.getTime() - verifiedAt.getTime()) / DAY_MS);

  let confidence: FreshnessConfidence;
  if (ageDays <= 7) confidence = "high";
  else if (ageDays <= 30) confidence = "medium";
  else confidence = "low";

  return {
    data_age_days: ageDays,
    last_verified: row.last_verified_at,
    verified_source: row.last_verified_source ?? null,
    confidence,
    last_attempt: row.last_refresh_attempt_at ?? null,
    last_attempt_status: row.last_refresh_status ?? null,
    last_refreshed: row.last_verified_at,
  };
}

/** Columns every caller of computeFreshness must select. */
export const FRESHNESS_COLUMNS =
  "last_verified_at, last_verified_source, last_refresh_attempt_at, last_refresh_status";
