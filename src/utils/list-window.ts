/**
 * List window for the public dashboard listings (/api/dashboard/rankings, /api/dashboard/changelog).
 *
 * 2026-10-23 security hardening v1 (founder-ops/research/Disclosure_2026-10): a page is at most
 * DASHBOARD_MAX_LIMIT rows (default 50) and only the first DASHBOARD_MAX_OFFSET + limit rows are
 * reachable (default 450 → the top 500, which is what the dashboard showed before). The full list is
 * not a public bulk export.
 *
 * Both values are clamped to ≥ 0: before this, `?limit=-1` became SQLite "LIMIT -1" (= no limit) and
 * returned every row in one call. Operators may raise the caps per deployment via the env vars
 * (local smoke tests do); the defaults are what the public server uses.
 */
export function listCaps(env: NodeJS.ProcessEnv = process.env): { maxLimit: number; maxOffset: number } {
  // A missing, non-numeric or non-positive value falls back to the default (never "no cap").
  const pos = (v: string | undefined, d: number): number => {
    const x = Math.floor(Number(v));
    return Number.isFinite(x) && x > 0 ? x : d;
  };
  return { maxLimit: pos(env.DASHBOARD_MAX_LIMIT, 50), maxOffset: pos(env.DASHBOARD_MAX_OFFSET, 450) };
}

export function listWindow(
  rawLimit: unknown,
  rawOffset: unknown,
  defaultLimit: number,
  caps: { maxLimit: number; maxOffset: number } = listCaps(),
): { limit: number; offset: number } {
  const n = (v: unknown): number => {
    const x = parseInt(String(v ?? ""), 10);
    return Number.isFinite(x) ? x : NaN;
  };
  const l = n(rawLimit);
  const o = n(rawOffset);
  const limit = Math.min(Math.max(Number.isNaN(l) || l <= 0 ? defaultLimit : l, 1), caps.maxLimit);
  const offset = Math.min(Math.max(Number.isNaN(o) ? 0 : o, 0), caps.maxOffset);
  return { limit, offset };
}
