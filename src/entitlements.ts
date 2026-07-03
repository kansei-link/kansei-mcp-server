/**
 * Tier entitlements for KanseiLink paid plans.
 *
 * Three concerns live here:
 *   1. Tier resolution — subscription email → tier, API key → tier (live join
 *      against `subscriptions`, so cancellations downgrade automatically).
 *   2. API key lifecycle — issue / resolve / list / revoke. Keys are stored
 *      hashed (SHA-256); plaintext is shown exactly once at issue time.
 *   3. Response shaping — `shapeLookupResult` strips premium fields from
 *      lookup tool responses for insufficient tiers, mirroring the pricing
 *      page promises:
 *        free : everything except the fields below (概要 stays free)
 *        pro  : + Agent Voice response texts, recipe gotchas, error workarounds
 *        team : + per-service history reports (time-series, incidents,
 *               competitive comparison), Agent Voice raw rows
 */

import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export type Tier = "free" | "pro" | "team" | "enterprise";

export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
};

const PRICING_URL = "https://kansei-link.com/pricing.html";
const ACCOUNT_URL = "https://kansei-link.com/subscription/login.html";

export function normalizeTier(t: unknown): Tier {
  return t === "pro" || t === "team" || t === "enterprise" ? t : "free";
}

// ─── Tier resolution ───────────────────────────────────────────────

export function tierForEmail(db: Database.Database, email: string): Tier {
  const row = db
    .prepare(
      `SELECT tier FROM subscriptions
       WHERE LOWER(email) = ? AND status IN ('active', 'trialing')
       ORDER BY CASE tier WHEN 'enterprise' THEN 4 WHEN 'team' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
       LIMIT 1`
    )
    .get(email.trim().toLowerCase()) as { tier: string } | undefined;
  return normalizeTier(row?.tier);
}

// ─── API keys ──────────────────────────────────────────────────────

const KEY_PREFIX_LEN = 11; // "kl_" + 8 hex chars — enough to identify, useless to guess

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface IssuedKey {
  key: string; // full plaintext — returned exactly once
  key_prefix: string;
}

export function issueApiKey(
  db: Database.Database,
  email: string,
  label?: string
): IssuedKey {
  const key = "kl_" + randomBytes(20).toString("hex");
  db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, label) VALUES (?, ?, ?, ?)`
  ).run(sha256(key), key.slice(0, KEY_PREFIX_LEN), email.trim().toLowerCase(), label ?? null);
  return { key, key_prefix: key.slice(0, KEY_PREFIX_LEN) };
}

export interface ResolvedKey {
  email: string;
  tier: Tier;
  key_prefix: string;
}

/** Validate a raw API key. Returns null for unknown/revoked/malformed keys. */
export function resolveApiKey(
  db: Database.Database,
  rawKey: string | undefined | null
): ResolvedKey | null {
  if (!rawKey || !rawKey.startsWith("kl_") || rawKey.length < 20 || rawKey.length > 80) {
    return null;
  }
  const hash = sha256(rawKey);
  const row = db
    .prepare(`SELECT email, key_prefix, revoked FROM api_keys WHERE key_hash = ?`)
    .get(hash) as { email: string; key_prefix: string; revoked: number } | undefined;
  if (!row || row.revoked) return null;
  db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE key_hash = ?`).run(hash);
  return { email: row.email, tier: tierForEmail(db, row.email), key_prefix: row.key_prefix };
}

export function listApiKeys(
  db: Database.Database,
  email: string
): Array<{ key_prefix: string; label: string | null; created_at: string; last_used_at: string | null }> {
  return db
    .prepare(
      `SELECT key_prefix, label, created_at, last_used_at
       FROM api_keys WHERE email = ? AND revoked = 0 ORDER BY created_at DESC`
    )
    .all(email.trim().toLowerCase()) as Array<{
    key_prefix: string;
    label: string | null;
    created_at: string;
    last_used_at: string | null;
  }>;
}

export function revokeApiKey(
  db: Database.Database,
  email: string,
  keyPrefix: string
): boolean {
  const res = db
    .prepare(`UPDATE api_keys SET revoked = 1 WHERE email = ? AND key_prefix = ? AND revoked = 0`)
    .run(email.trim().toLowerCase(), keyPrefix);
  return res.changes > 0;
}

// ─── Tier resolvers (how each transport learns the caller's tier) ──

export type TierResolver = () => Promise<Tier>;

export function fixedTierResolver(tier: Tier): TierResolver {
  return () => Promise.resolve(tier);
}

const DEFAULT_API_BASE = "https://kansei-link-mcp-production-b054.up.railway.app";
const VALIDATE_TTL_MS = 10 * 60 * 1000;

let stdioTierCache: { tier: Tier; at: number } | null = null;

/**
 * Tier resolver for the stdio server (npx @kansei-link/mcp-server on the
 * user's machine). Reads KANSEI_API_KEY and validates it against the hosted
 * API. Results are cached for 10 minutes. Network failures keep the last
 * known tier (a paying customer briefly offline stays unlocked) but a
 * definitive 401/403 downgrades to free.
 */
export function makeStdioTierResolver(): TierResolver {
  return async () => {
    const key = process.env.KANSEI_API_KEY;
    if (!key) return "free";
    if (stdioTierCache && Date.now() - stdioTierCache.at < VALIDATE_TTL_MS) {
      return stdioTierCache.tier;
    }
    const base = (process.env.KANSEI_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/api/validate-key`, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = (await res.json()) as { tier?: string };
        stdioTierCache = { tier: normalizeTier(data?.tier), at: Date.now() };
        return stdioTierCache.tier;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        stdioTierCache = { tier: "free", at: Date.now() };
        return "free";
      }
      return stdioTierCache?.tier ?? "free";
    } catch {
      return stdioTierCache?.tier ?? "free";
    }
  };
}

/** Test hook — clears the stdio validation cache. */
export function _resetStdioTierCache(): void {
  stdioTierCache = null;
}

// ─── Response shaping ──────────────────────────────────────────────

export interface UpgradeNote {
  locked: string[];
  required_plan: "pro" | "team";
  pricing: string;
  how_to_unlock: string;
}

function upgradeNote(locked: string[], plan: "pro" | "team"): UpgradeNote {
  return {
    locked,
    required_plan: plan,
    pricing: PRICING_URL,
    how_to_unlock:
      `Subscribe at ${PRICING_URL}, issue an API key at ${ACCOUNT_URL}, ` +
      "then set the KANSEI_API_KEY env var (stdio) or send an x-api-key header (HTTP).",
  };
}

export interface ShapedResult {
  result: object | object[];
  upgrade: UpgradeNote | null;
}

function isErrorObject(r: unknown): boolean {
  return !!r && typeof r === "object" && !Array.isArray(r) && "error" in (r as object);
}

/**
 * Apply tier gating to a `lookup` dispatch result.
 *
 * Free-tier policy (HN/AEO acquisition): summaries, stats, auth tips, full
 * connection guides and search all stay free. Only 詳細/生データ fields are
 * stripped — and every strip is advertised via the returned UpgradeNote so
 * agents know exactly what a subscription adds.
 */
export function shapeLookupResult(
  mode: string,
  result: object | object[],
  tier: Tier
): ShapedResult {
  const rank = TIER_RANK[tier];
  if (isErrorObject(result)) return { result, upgrade: null };

  switch (mode) {
    case "insights": {
      if (rank >= TIER_RANK.pro) return { result, upgrade: null };
      const r = result as Record<string, unknown>;
      const errors = r.common_errors;
      if (!Array.isArray(errors) || errors.length === 0) return { result, upgrade: null };
      let stripped = 0;
      const shapedErrors = errors.map((e: Record<string, unknown>) => {
        if (e && typeof e === "object" && e.known_workarounds) {
          stripped++;
          const { known_workarounds: _hidden, ...rest } = e;
          return { ...rest, workarounds_available: Array.isArray(e.known_workarounds) ? e.known_workarounds.length : 1 };
        }
        return e;
      });
      if (stripped === 0) return { result, upgrade: null };
      return {
        result: { ...r, common_errors: shapedErrors },
        upgrade: upgradeNote(
          ["verified error workarounds (fix text + verification status)"],
          "pro"
        ),
      };
    }

    case "recipe": {
      if (rank >= TIER_RANK.pro) return { result, upgrade: null };
      if (!Array.isArray(result)) return { result, upgrade: null };
      let lockedCount = 0;
      const shaped = result.map((item) => {
        const r = item as Record<string, unknown>;
        const gotchas = r.gotchas;
        if (Array.isArray(gotchas) && gotchas.length > 0) {
          lockedCount += gotchas.length;
          const { gotchas: _hidden, ...rest } = r;
          return { ...rest, gotchas_locked: { count: gotchas.length, required_plan: "pro" } };
        }
        return item;
      });
      if (lockedCount === 0) return { result, upgrade: null };
      return {
        result: shaped,
        upgrade: upgradeNote(
          [`recipe gotchas — ${lockedCount} integration warning(s) for these recipes`],
          "pro"
        ),
      };
    }

    case "voices": {
      const r = result as Record<string, unknown>;
      if (rank >= TIER_RANK.team) return { result, upgrade: null };
      const responses = Array.isArray(r.responses) ? (r.responses as Array<Record<string, unknown>>) : [];
      if (rank >= TIER_RANK.pro) {
        // Pro: full response texts, but raw rows (incl. agent_id) stay Team.
        const proResponses = responses.map(({ agent_id: _hidden, ...rest }) => rest);
        return {
          result: { ...r, responses: proResponses },
          upgrade: upgradeNote(["raw Agent Voice rows (including reporter agent_id)"], "team"),
        };
      }
      // Free: aggregated distributions + short excerpts only.
      const samples = responses.slice(0, 3).map((resp) => ({
        agent_type: resp.agent_type,
        question_id: resp.question_id,
        response_choice: resp.response_choice ?? null,
        excerpt:
          typeof resp.response_text === "string"
            ? resp.response_text.slice(0, 140) + (resp.response_text.length > 140 ? "…" : "")
            : null,
        created_at: resp.created_at,
      }));
      const shaped = {
        service_id: r.service_id,
        service_name: r.service_name,
        total_responses: r.total_responses,
        choice_distribution: r.choice_distribution,
        sample_responses: samples,
        insight: r.insight,
      };
      return {
        result: shaped,
        upgrade: upgradeNote(
          ["full Agent Voice response texts (50 most recent)", "multi-agent (Claude/GPT/Gemini) detail comparison"],
          "pro"
        ),
      };
    }

    case "history": {
      if (rank >= TIER_RANK.team) return { result, upgrade: null };
      const r = result as Record<string, unknown>;
      const trends = (r.trends ?? {}) as Record<string, Record<string, unknown>>;
      const shaped = {
        service: r.service,
        period: r.period,
        snapshot_count: r.snapshot_count,
        trend_summary: {
          success_rate: trends.success_rate?.direction ?? (trends as Record<string, unknown>).status ?? null,
          latency: trends.latency?.direction ?? null,
          agent_adoption: trends.agent_adoption?.direction ?? null,
        },
      };
      return {
        result: shaped,
        upgrade: upgradeNote(
          [
            "full snapshot time-series + adoption curve",
            "incident analysis + event correlations",
            "competitive comparison (compare_with)",
            "top workarounds & complaints",
            "consulting highlights",
          ],
          "team"
        ),
      };
    }

    // tips / detail / combinations / feedback — fully free (acquisition surface)
    default:
      return { result, upgrade: null };
  }
}
