/**
 * mcp_status provenance (2026-10-02).
 *
 * Incident (marker M-002): endpoints whose weekly health probe had recorded
 * 404 / 410 / DNS failure were still shown as `verified` in production. Two
 * causes, both in how the column was written, not in the probe:
 *   1. seedDatabase() runs on every start and its ON CONFLICT overwrote
 *      `mcp_status` with the shipped seed value, erasing the probe's result.
 *   2. The 2026-09-20 freshness migration counted a `deprecated` changelog row
 *      (the probe's own death notice) as "an upstream answered".
 *
 * So the column now carries where its value came from and when:
 *   mcp_status_source      'seed' (the shipped catalogue) | 'probe' (observed)
 *   mcp_status_checked_at  when the probe observed it (ISO; null for seed)
 * Precedence: probe > seed. The seeder never overwrites a probe-sourced status.
 *
 * Display: a liveness claim (`verified`, `official`) is shown only while a
 * probe stands behind it and that probe is at most MCP_STATUS_PROBE_TTL_DAYS
 * old. Otherwise the agent sees `unverified`. The stored value is never
 * changed by display. Categorical statuses (`community`, `api_only`,
 * `third_party`, `unknown`, `none`) are not liveness claims and pass through.
 */

export type McpStatusSource = "seed" | "probe";

/** How long a probe observation may stand behind a liveness claim. */
export const MCP_STATUS_PROBE_TTL_DAYS = 30;

/** Statuses that assert the endpoint is alive — only a fresh probe may show them. */
export const MCP_STATUS_LIVENESS_CLAIMS: ReadonlySet<string> = new Set(["verified", "official"]);

/** Statuses the probe writes when the endpoint is gone (`dead` is the pre-2026-10 spelling). */
export const MCP_STATUS_UNREACHABLE: ReadonlySet<string> = new Set(["unreachable", "dead"]);

export interface McpStatusInput {
  mcp_status: string | null;
  mcp_status_source?: string | null;
  mcp_status_checked_at?: string | null;
  archived?: number | null;
}

export type McpStatusBasis =
  | "probe" // a probe within the TTL stands behind the claim
  | "probe_stale" // a probe stood behind it, but older than the TTL
  | "seed" // the shipped catalogue's value; nobody has observed it
  | "archived" // the row is archived (endpoint gone or upstream archived)
  | "unreachable" // the probe found the endpoint gone
  | "categorical"; // not a liveness claim; shown as stored

export interface McpStatusDisplay {
  /** What the agent sees. `unverified` whenever a liveness claim has no fresh probe behind it. */
  mcp_status: string;
  /** When the probe observed the stored status; null when it never did. */
  mcp_status_checked_at: string | null;
  /** 'seed' | 'probe' — where the STORED value came from (null on rows older than this column). */
  mcp_status_source: string | null;
  /** Why the display says what it says. */
  mcp_status_basis: McpStatusBasis;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Columns every caller of displayMcpStatus must select (services.* covers them). */
export const MCP_STATUS_COLUMNS = "mcp_status, mcp_status_source, mcp_status_checked_at, archived";

export function displayMcpStatus(row: McpStatusInput, now: Date = new Date()): McpStatusDisplay {
  const stored = row.mcp_status ?? "official";
  const source = row.mcp_status_source ?? null;
  const checkedAt = row.mcp_status_checked_at ?? null;
  const base = { mcp_status_checked_at: checkedAt, mcp_status_source: source };

  if ((row.archived ?? 0) === 1) return { ...base, mcp_status: "unverified", mcp_status_basis: "archived" };
  if (MCP_STATUS_UNREACHABLE.has(stored)) return { ...base, mcp_status: "unverified", mcp_status_basis: "unreachable" };
  if (!MCP_STATUS_LIVENESS_CLAIMS.has(stored)) return { ...base, mcp_status: stored, mcp_status_basis: "categorical" };

  // a liveness claim: only a probe within the TTL may show it
  if (source !== "probe" || !checkedAt) return { ...base, mcp_status: "unverified", mcp_status_basis: "seed" };
  const t = new Date(checkedAt).getTime();
  if (Number.isNaN(t)) return { ...base, mcp_status: "unverified", mcp_status_basis: "seed" };
  const ageDays = Math.floor((now.getTime() - t) / DAY_MS);
  if (ageDays > MCP_STATUS_PROBE_TTL_DAYS || ageDays < 0) return { ...base, mcp_status: "unverified", mcp_status_basis: "probe_stale" };
  return { ...base, mcp_status: stored, mcp_status_basis: "probe" };
}

/** Said once per response: what `mcp_status` does and does not vouch for. */
export const MCP_STATUS_LEGEND = {
  verified: "the weekly health probe completed an MCP handshake with mcp_endpoint within the last 30 days",
  official: "the weekly health probe reached mcp_endpoint over HTTP within the last 30 days (it may require auth)",
  unverified:
    "no probe within the last 30 days stands behind a liveness claim — the shipped catalogue value is not shown as if it had been observed; archived or unreachable endpoints are shown this way too",
  checked_at_means: "mcp_status_checked_at is the date of that probe; null means nobody has observed the endpoint",
} as const;
