/**
 * mcp_status and mcp_liveness — two meanings, two columns (2026-10-02).
 *
 * Incident (marker M-002): endpoints whose weekly health probe had recorded
 * 404 / 410 / DNS failure were still shown as `verified` in production.
 *
 * The root cause was one column carrying two meanings:
 *   - WHO made the MCP server — `official` / `third_party` / `community` /
 *     `api_only` / ... This is the provider's claim. The seed, the registry
 *     sync, vendor submissions and approved proposals write it.
 *   - WHETHER it is alive — `verified` (handshake) / `dead`. Only an
 *     observation may say this.
 * With both in one column the writers broke each other: the seed erased the
 * probe's death notice on every start, the probe overwrote the provider's
 * classification with `official` whenever it got an HTTP answer, and vendor /
 * propose writes inherited whatever the probe had left.
 *
 * So liveness now lives in its own columns, written ONLY by the health probe
 * and the watchdog:
 *   mcp_liveness             'handshake' | 'reachable' | 'unreachable'
 *   mcp_liveness_checked_at  ISO UTC 'YYYY-MM-DDTHH:MM:SSZ'
 *   mcp_liveness_endpoint    the mcp_endpoint string that was probed, verbatim
 * and mcp_status is the provider's claim alone.
 *
 * Every path that shows mcp_status to anyone outside goes through
 * displayMcpStatus(). Rules:
 *   - `verified` (a liveness claim) is shown only when mcp_liveness =
 *     'handshake', checked within MCP_LIVENESS_TTL_DAYS, and probed against the
 *     CURRENT mcp_endpoint character for character. A stored `verified`
 *     without that (a value baked into the seed or the DB) → `unverified`.
 *   - stored `dead` / `unreachable`, an archived row, or mcp_liveness =
 *     'unreachable' on the same endpoint → `unverified`.
 *   - everything else (`official`, `third_party`, `community`, `api_only`,
 *     `unknown`, `none`) is the provider's classification and is shown as
 *     stored — it does not say the endpoint is alive.
 *   - mcp_liveness is always shown beside it.
 * Stored values are never changed by display.
 */

export type McpLivenessState = "handshake" | "reachable" | "unreachable";

/** How long a handshake may stand behind a `verified`. */
export const MCP_LIVENESS_TTL_DAYS = 30;

/** Stored statuses that are liveness verdicts, not provider claims (`dead` is the pre-2026-10 probe spelling). */
const STORED_DEATH: ReadonlySet<string> = new Set(["dead", "unreachable"]);

/** Columns every caller of displayMcpStatus must select (services.* covers them). */
export const MCP_STATUS_COLUMNS =
  "mcp_status, mcp_endpoint, archived, mcp_liveness, mcp_liveness_checked_at, mcp_liveness_endpoint";

export interface McpStatusInput {
  mcp_status: string | null;
  mcp_endpoint?: string | null;
  archived?: number | null;
  mcp_liveness?: string | null;
  mcp_liveness_checked_at?: string | null;
  mcp_liveness_endpoint?: string | null;
}

export type McpStatusBasis =
  | "handshake" // `verified`: a fresh handshake with the current endpoint stands behind it
  | "no_fresh_handshake" // stored `verified`, but no handshake within the TTL on this endpoint
  | "archived" // the row is archived (endpoint gone or upstream archived)
  | "unreachable" // stored dead / unreachable, or the probe found this endpoint gone
  | "provider_claim"; // the provider's classification, shown as stored; not a liveness claim

export interface McpLivenessDisplay {
  /** What the probe last observed; 'unknown' when it never probed this row. */
  state: McpLivenessState | "unknown";
  /** When (UTC, as stored); null when never probed. */
  checked_at: string | null;
  /** Whether that observation was of the CURRENT mcp_endpoint (exact string). */
  endpoint_matches: boolean;
}

export interface McpStatusDisplay {
  /** The provider's classification, or `verified` / `unverified` per the rules above. */
  mcp_status: string;
  mcp_status_basis: McpStatusBasis;
  mcp_liveness: McpLivenessDisplay;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM[:SS[.f]]' (no zone) or
 * 'YYYY-MM-DDTHH:MM[:SS[.f]][Z|±HH[:]MM]'.
 */
const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:([ T])(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Read a stored timestamp as UTC. SQLite's datetime('now') gives
 * 'YYYY-MM-DD HH:MM:SS' with no zone — JavaScript would read that as LOCAL
 * time, so the 'T' and 'Z' are supplied. A zone-less ISO string is read as UTC
 * too. Anything else → NaN.
 *
 * The VALUE must exist, not just the shape (Codex review 5, 2026-10-02):
 * `new Date('2026-09-31T00:00:00Z')` silently rolls over to 10-01 and a
 * non-existent date read as a fresh handshake. So the fields are turned into a
 * time with Date.UTC, written back as 'YYYY-MM-DDTHH:MM:SS', and the result
 * must equal the fields as written — 09-31, 02-29 in a common year, month 13,
 * day 00, 24:00, 23:59:60, hour 25 … all come back different and are rejected.
 */
export function parseUtc(s: string | null | undefined): number {
  if (!s) return NaN;
  const m = STAMP.exec(s.trim());
  if (!m) return NaN;
  const [, ys, mos, ds, sep, hs = "00", mis = "00", ss = "00", frac, zone] = m;
  if (sep === " " && zone) return NaN; // the space form is SQLite's, which never carries a zone
  const [y, mo, d, h, mi, sec] = [ys, mos, ds, hs, mis, ss].map(Number);
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d); // setUTCFullYear, not Date.UTC: Date.UTC maps years 0–99 to 1900–1999
  t.setUTCHours(h, mi, sec, 0);
  const written = `${pad(y, 4)}-${mos}-${ds}T${hs}:${mis}:${ss}`;
  const back = `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
  if (back !== written) return NaN;
  let ms = t.getTime() + (frac ? Number(frac.slice(1, 4).padEnd(3, "0")) : 0);
  if (zone && zone !== "Z") {
    const zh = Number(zone.slice(1, 3));
    const zm = Number(zone.slice(-2));
    if (zh > 23 || zm > 59) return NaN;
    ms -= (zone[0] === "-" ? -1 : 1) * (zh * 60 + zm) * 60000;
  }
  return ms;
}

/** ISO UTC 'YYYY-MM-DDTHH:MM:SSZ' — the format the liveness writers store. */
export const SQL_UTC_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

function livenessOf(row: McpStatusInput): McpLivenessDisplay {
  const raw = row.mcp_liveness ?? null;
  const state: McpLivenessDisplay["state"] =
    raw === "handshake" || raw === "reachable" || raw === "unreachable" ? raw : "unknown";
  const endpoint = row.mcp_endpoint ?? null;
  const probed = row.mcp_liveness_endpoint ?? null;
  return {
    state,
    checked_at: state === "unknown" ? null : row.mcp_liveness_checked_at ?? null,
    endpoint_matches: state !== "unknown" && !!endpoint && probed === endpoint,
  };
}

/** True only for a handshake on the current endpoint, dated within the TTL and not in the future. */
export function hasFreshHandshake(row: McpStatusInput, now: Date = new Date()): boolean {
  const l = livenessOf(row);
  if (l.state !== "handshake" || !l.endpoint_matches) return false;
  const t = parseUtc(l.checked_at);
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= MCP_LIVENESS_TTL_DAYS * DAY_MS;
}

export function displayMcpStatus(row: McpStatusInput, now: Date = new Date()): McpStatusDisplay {
  // NULL is the column default ('official') — a provider claim, as before.
  const stored = row.mcp_status ?? "official";
  const mcp_liveness = livenessOf(row);

  if ((row.archived ?? 0) === 1) return { mcp_status: "unverified", mcp_status_basis: "archived", mcp_liveness };
  if (STORED_DEATH.has(stored)) return { mcp_status: "unverified", mcp_status_basis: "unreachable", mcp_liveness };
  if (mcp_liveness.state === "unreachable" && mcp_liveness.endpoint_matches)
    return { mcp_status: "unverified", mcp_status_basis: "unreachable", mcp_liveness };
  if (stored === "verified") {
    return hasFreshHandshake(row, now)
      ? { mcp_status: "verified", mcp_status_basis: "handshake", mcp_liveness }
      : { mcp_status: "unverified", mcp_status_basis: "no_fresh_handshake", mcp_liveness };
  }
  return { mcp_status: stored, mcp_status_basis: "provider_claim", mcp_liveness };
}

/**
 * After a write that may have changed mcp_endpoint: an observation of another
 * endpoint says nothing about the new one, so the three liveness columns go
 * back to NULL. A write that kept the same endpoint keeps them.
 * The rule of record is the DB trigger services_endpoint_clears_liveness
 * (schema.ts), which fires on every writer; this statement is a harmless second
 * pass kept in vendor / propose.
 */
export const CLEAR_STALE_LIVENESS_SQL = `
  UPDATE services
  SET mcp_liveness = NULL, mcp_liveness_checked_at = NULL, mcp_liveness_endpoint = NULL
  WHERE id = ? AND mcp_liveness_endpoint IS NOT NULL AND mcp_liveness_endpoint IS NOT mcp_endpoint`;

/** Said once per response: what `mcp_status` and `mcp_liveness` do and do not vouch for. */
export const MCP_STATUS_LEGEND = {
  mcp_status:
    "who provides the MCP server, as the provider / catalogue claims it (official, third_party, community, api_only, ...). It is NOT a liveness check — liveness is mcp_liveness",
  verified:
    "the weekly health probe completed an MCP handshake with this exact mcp_endpoint within the last 30 days",
  unverified:
    "a liveness claim with no fresh handshake on the current endpoint behind it, or an endpoint that is archived or was found unreachable",
  mcp_liveness:
    "what the health probe last observed: handshake (MCP initialize answered), reachable (HTTP answered, may need auth), unreachable (404 / 410 / DNS / refused), unknown (never probed). checked_at is UTC; endpoint_matches=false means the observation was of a different endpoint than the current one and says nothing about it",
} as const;
