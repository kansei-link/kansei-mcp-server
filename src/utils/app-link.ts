// Canonical KanseiLINK app/deep-link builder (A21 — the "exit" / data-circulation entry point).
//
// A21 is NOT a cosmetic link: it is the return path that lets agent activity flow back into
// KanseiLINK (compare / save / inspect) so behaviour data accumulates and Agent Insights /
// scoring / recommendations improve. MCP responses that surface a recommendation, profile, or
// score should embed this object under `_meta.kansei_link` — conditionally, never spammy.
//
// Config-driven so the canonical URL structure can change in ONE place (env/config) without
// editing every tool. Defaults are placeholders until the official app URL design is finalized.
const APP_BASE = (process.env.KANSEI_APP_BASE_URL ?? "https://kansei-link.com/app").replace(/\/+$/, "");
const SCHEME = process.env.KANSEI_DEEP_LINK_SCHEME ?? "kanseilink";

export type KanseiLinkIntent = "recommendation_results" | "service_profile" | "score_detail";

export interface KanseiAppLink {
  app_url: string;
  deep_link: string;
  reason: string;
  intent: KanseiLinkIntent;
}

interface LinkOpts {
  service_id?: string;
  query?: string;
}

/**
 * Build the canonical KanseiLINK app/deep-link object for a response (A21).
 * Returns `null` when there is nothing meaningful to link, so callers stay conditional
 * (never inject a noisy link). Place the result under `_meta.kansei_link`.
 */
export function kanseiAppLink(intent: KanseiLinkIntent, opts: LinkOpts = {}): KanseiAppLink | null {
  switch (intent) {
    case "service_profile": {
      if (!opts.service_id) return null;
      const id = encodeURIComponent(opts.service_id);
      return {
        app_url: `${APP_BASE}/services/${id}`,
        deep_link: `${SCHEME}://services/${id}`,
        reason: "Open this service in KanseiLINK to compare, save, or continue analysis.",
        intent,
      };
    }
    case "score_detail": {
      if (!opts.service_id) return null;
      const id = encodeURIComponent(opts.service_id);
      return {
        app_url: `${APP_BASE}/insights/${id}`,
        deep_link: `${SCHEME}://insights/${id}`,
        reason: "Open this score in KanseiLINK to inspect evidence and next actions.",
        intent,
      };
    }
    case "recommendation_results": {
      const q = encodeURIComponent(opts.query ?? "");
      return {
        app_url: `${APP_BASE}/search?q=${q}`,
        deep_link: `${SCHEME}://search?q=${q}`,
        reason: "Open these recommendations in KanseiLINK to compare and save candidates.",
        intent,
      };
    }
    default:
      return null;
  }
}
