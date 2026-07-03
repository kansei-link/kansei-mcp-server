/**
 * Auth & entitlement HTTP handlers: magic-link email login, API key
 * self-service, key validation, and gated premium web content.
 *
 * Trust model:
 *   - The per-email access token (HMAC, from stripe.ts accessTokenFor) is the
 *     web session credential. It is obtainable ONLY via Stripe-verified
 *     checkout (/api/access-token) or via magic-link email verification here —
 *     i.e. by proving control of the subscriber's inbox.
 *   - API keys (kl_…) are the machine credential for MCP/HTTP clients,
 *     issued to authenticated subscribers and stored hashed.
 *   - Every "does this email exist" answer is identical for customers and
 *     non-customers (anti-enumeration), matching the /api/portal pattern.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { getDb } from "./db/connection.js";
import { accessTokenFor, tokenMatches, accessResultForEmail } from "./stripe.js";
import {
  TIER_RANK,
  normalizeTier,
  tierForEmail,
  issueApiKey,
  resolveApiKey,
  listApiKeys,
  revokeApiKey,
  type Tier,
} from "./entitlements.js";

const ACCOUNT_PATH = "/subscription/login.html";
const PRICING_URL = "https://kansei-link.com/pricing.html";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function publicBase(): string {
  return (process.env.KANSEI_PUBLIC_URL ?? "https://kansei-link.com").replace(/\/+$/, "");
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function isPlausibleEmail(email: string): boolean {
  return email.length >= 6 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── Magic-link login ──────────────────────────────────────────────

const CODE_TTL_MINUTES = 15;
const MAX_CODES_PER_EMAIL_PER_HOUR = 3;

async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No email provider configured — surface the link in server logs so the
    // operator can deliver it manually (Railway logs are operator-only).
    console.log(`[auth] RESEND_API_KEY not set — magic link for ${email}: ${link}`);
    return;
  }
  const from = process.env.EMAIL_FROM || "KanseiLink <login@kansei-link.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "KanseiLink ログインリンク / Sign-in link",
        html: [
          `<p>KanseiLink へのログインリンクです（有効期限 ${CODE_TTL_MINUTES} 分・1回のみ有効）。</p>`,
          `<p>Your KanseiLink sign-in link (valid for ${CODE_TTL_MINUTES} minutes, single use):</p>`,
          `<p><a href="${link}">${link}</a></p>`,
          `<p style="color:#6b7280;font-size:13px;">このメールに心当たりがない場合は無視してください。/ If you didn't request this, you can safely ignore it.</p>`,
        ].join("\n"),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] magic-link email send failed (${res.status}): ${detail.slice(0, 300)}`);
    }
  } catch (err) {
    console.error("[auth] magic-link email send error:", err instanceof Error ? err.message : err);
  }
}

/**
 * POST /api/auth/request-link  { email }
 *
 * Always answers { ok: true } with identical timing-insensitive shape whether
 * or not the email has a subscription — requesting a link reveals nothing.
 * A link is actually generated + emailed only for active subscribers.
 */
export async function handleAuthRequestLink(req: Request, res: Response) {
  const email = normalizeEmail((req.body ?? {}).email);
  const reply = {
    ok: true,
    message:
      "If this email has an active subscription, a sign-in link is on its way. " +
      "ご登録のメールアドレスであれば、ログインリンクをお送りしました。",
  };

  if (!isPlausibleEmail(email)) {
    res.json(reply);
    return;
  }

  const db = getDb();

  // Housekeeping: drop long-expired codes.
  db.prepare(`DELETE FROM login_codes WHERE expires_at < datetime('now', '-1 day')`).run();

  // Only active subscribers get a code — silently no-op otherwise.
  if (!accessResultForEmail(email).active) {
    res.json(reply);
    return;
  }

  // Token infra must be configured, otherwise the verified link couldn't
  // yield a usable token anyway.
  if (!accessTokenFor(email)) {
    res.status(503).json({ error: "sign-in not configured on server" });
    return;
  }

  // Per-email throttle (in addition to the per-IP express-rate-limit).
  const recent = db
    .prepare(`SELECT COUNT(*) as c FROM login_codes WHERE email = ? AND created_at >= datetime('now', '-1 hour')`)
    .get(email) as { c: number };
  if (recent.c >= MAX_CODES_PER_EMAIL_PER_HOUR) {
    res.json(reply); // silent — don't reveal throttling either
    return;
  }

  const code = randomBytes(24).toString("hex");
  db.prepare(
    `INSERT INTO login_codes (code_hash, email, expires_at)
     VALUES (?, ?, datetime('now', '+${CODE_TTL_MINUTES} minutes'))`
  ).run(sha256(code), email);

  const link = `${publicBase()}${ACCOUNT_PATH}?code=${code}`;
  await sendMagicLinkEmail(email, link);

  // Test/dev hook: echo the link instead of relying on email delivery.
  // NEVER set KANSEI_AUTH_ECHO in production.
  if (process.env.KANSEI_AUTH_ECHO === "1") {
    res.json({ ...reply, debug_link: link });
    return;
  }
  res.json(reply);
}

/**
 * POST /api/auth/verify  { code }
 *
 * Redeems a one-time magic-link code for the per-email access token —
 * the same token /api/access-token issues after Stripe checkout.
 */
export function handleAuthVerify(req: Request, res: Response) {
  const code = typeof (req.body ?? {}).code === "string" ? (req.body.code as string).trim() : "";
  if (!code || code.length < 16 || code.length > 128) {
    res.status(400).json({ error: "invalid or expired code" });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, email FROM login_codes
       WHERE code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`
    )
    .get(sha256(code)) as { id: number; email: string } | undefined;

  if (!row) {
    res.status(400).json({ error: "invalid or expired code" });
    return;
  }

  const token = accessTokenFor(row.email);
  if (!token) {
    res.status(503).json({ error: "sign-in not configured on server" });
    return;
  }

  db.prepare(`UPDATE login_codes SET used_at = datetime('now') WHERE id = ?`).run(row.id);
  res.json({ email: row.email, token, access: accessResultForEmail(row.email) });
}

// ─── API key self-service ──────────────────────────────────────────

const MAX_ACTIVE_KEYS_PER_EMAIL = 5;

/**
 * POST /api/keys  { email, token, action?: "create" | "list" | "revoke", label?, key_prefix? }
 *
 * Token-gated exactly like /api/portal: the caller must present the
 * per-email access token (from checkout or magic-link sign-in).
 */
export function handleApiKeys(req: Request, res: Response) {
  const body = (req.body ?? {}) as {
    email?: string;
    token?: string;
    action?: string;
    label?: string;
    key_prefix?: string;
  };
  const email = normalizeEmail(body.email);
  const token = (req.header("x-access-token") as string) || body.token || "";
  const action = body.action || "create";

  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }
  if (!tokenMatches(token, accessTokenFor(email))) {
    res.status(401).json({ error: "invalid token", signin: `${publicBase()}${ACCOUNT_PATH}` });
    return;
  }

  const db = getDb();

  switch (action) {
    case "create": {
      if (!accessResultForEmail(email).active) {
        res.status(403).json({ error: "active subscription required", pricing: PRICING_URL });
        return;
      }
      const active = listApiKeys(db, email);
      if (active.length >= MAX_ACTIVE_KEYS_PER_EMAIL) {
        res.status(400).json({
          error: `key limit reached (${MAX_ACTIVE_KEYS_PER_EMAIL}) — revoke an old key first`,
          keys: active,
        });
        return;
      }
      const label = typeof body.label === "string" ? body.label.slice(0, 64) : undefined;
      const issued = issueApiKey(db, email, label);
      res.json({
        ok: true,
        key: issued.key,
        key_prefix: issued.key_prefix,
        note: "Store this key now — it is shown only once. Use it as KANSEI_API_KEY (stdio) or x-api-key header (HTTP).",
      });
      return;
    }

    case "list": {
      res.json({ ok: true, keys: listApiKeys(db, email), tier: tierForEmail(db, email) });
      return;
    }

    case "revoke": {
      const prefix = typeof body.key_prefix === "string" ? body.key_prefix.trim() : "";
      if (!prefix) {
        res.status(400).json({ error: "key_prefix required" });
        return;
      }
      res.json({ ok: true, revoked: revokeApiKey(db, email, prefix) });
      return;
    }

    default:
      res.status(400).json({ error: "unknown action (use create | list | revoke)" });
  }
}

/**
 * GET /api/validate-key   (header: x-api-key)
 *
 * Used by stdio servers to resolve their tier. Returns tier only — never the
 * owning email, so a leaked key doesn't also leak the account identity.
 */
export function handleValidateKey(req: Request, res: Response) {
  const rawKey =
    (req.header("x-api-key") as string) ||
    (req.header("authorization")?.startsWith("Bearer kl_")
      ? req.header("authorization")!.slice(7)
      : "");
  const resolved = resolveApiKey(getDb(), rawKey);
  if (!resolved) {
    res.status(401).json({ tier: "free", active: false, error: "invalid or revoked key" });
    return;
  }
  res.json({
    tier: resolved.tier,
    active: resolved.tier !== "free",
    key_prefix: resolved.key_prefix,
  });
}

// ─── Premium web content ───────────────────────────────────────────

/**
 * Resolve the caller's tier from either credential:
 *   - x-api-key header (machine clients), or
 *   - email + access token (web clients; token via x-access-token header or
 *     ?token= query param).
 * Returns null when no valid credential is presented.
 */
function tierFromRequest(req: Request): Tier | null {
  const db = getDb();

  const apiKey =
    (req.header("x-api-key") as string) ||
    (req.header("authorization")?.startsWith("Bearer kl_")
      ? req.header("authorization")!.slice(7)
      : "");
  if (apiKey) {
    const resolved = resolveApiKey(db, apiKey);
    if (resolved) return resolved.tier;
  }

  const email = normalizeEmail(req.query.email ?? (req.body ?? {}).email);
  const token =
    (req.header("x-access-token") as string) ||
    (typeof req.query.token === "string" ? req.query.token : "");
  if (email && token && tokenMatches(token, accessTokenFor(email))) {
    return tierForEmail(db, email);
  }

  return null;
}

const ARTICLE_ID_RE = /^[a-zA-Z0-9/_-]{1,200}$/;

/**
 * GET /api/premium?article=<id>  (+ x-access-token & email, or x-api-key)
 *
 * Serves the premium section HTML for an article. The content exists only in
 * the server DB — it is not present in the static page source.
 */
export function handlePremiumContent(req: Request, res: Response) {
  const articleId = typeof req.query.article === "string" ? req.query.article : "";
  if (!ARTICLE_ID_RE.test(articleId)) {
    res.status(400).json({ error: "valid article id required" });
    return;
  }

  const row = getDb()
    .prepare(`SELECT article_id, tier, lang, html, updated_at FROM premium_content WHERE article_id = ?`)
    .get(articleId) as
    | { article_id: string; tier: string; lang: string; html: string; updated_at: string }
    | undefined;

  if (!row) {
    res.status(404).json({ error: "unknown article" });
    return;
  }

  const required = normalizeTier(row.tier) === "free" ? "pro" : normalizeTier(row.tier);
  const tier = tierFromRequest(req);

  if (tier === null) {
    res.status(401).json({
      error: "sign in required",
      tier_required: required,
      signin: `${publicBase()}${ACCOUNT_PATH}`,
      pricing: PRICING_URL,
    });
    return;
  }
  if (TIER_RANK[tier] < TIER_RANK[required]) {
    res.status(403).json({
      error: "upgrade required",
      tier: tier,
      tier_required: required,
      pricing: PRICING_URL,
    });
    return;
  }

  res.setHeader("Cache-Control", "private, no-store");
  res.json({ article_id: row.article_id, tier_required: required, html: row.html, updated_at: row.updated_at });
}

/**
 * POST /admin/premium-content   { sections: [{ article_id, tier?, lang?, html }] }
 * GET  /admin/premium-content   → inventory (ids + sizes, no HTML)
 *
 * Admin-secret-gated in http-server.ts (same CRAWLER_SECRET pattern as
 * /admin/run-crawler). This is how premium HTML reaches the Railway volume —
 * the public repo never carries it.
 */
export function handlePremiumUpload(req: Request, res: Response) {
  const body = (req.body ?? {}) as { sections?: unknown };
  if (!Array.isArray(body.sections) || body.sections.length === 0 || body.sections.length > 500) {
    res.status(400).json({ error: "sections array (1-500 items) required" });
    return;
  }

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO premium_content (article_id, tier, lang, html, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(article_id) DO UPDATE SET
       tier = excluded.tier, lang = excluded.lang, html = excluded.html, updated_at = datetime('now')`
  );

  let upserted = 0;
  const errors: string[] = [];
  for (const raw of body.sections as Array<Record<string, unknown>>) {
    const articleId = typeof raw?.article_id === "string" ? raw.article_id : "";
    const html = typeof raw?.html === "string" ? raw.html : "";
    const tier = normalizeTier(raw?.tier) === "free" ? "pro" : normalizeTier(raw?.tier);
    const lang = raw?.lang === "en" ? "en" : "ja";
    if (!ARTICLE_ID_RE.test(articleId)) {
      errors.push(`invalid article_id: ${String(articleId).slice(0, 50)}`);
      continue;
    }
    if (!html || html.length > 300_000) {
      errors.push(`invalid html for ${articleId} (empty or >300KB)`);
      continue;
    }
    upsert.run(articleId, tier, lang, html);
    upserted++;
  }

  res.json({ ok: errors.length === 0, upserted, ...(errors.length ? { errors } : {}) });
}

export function handlePremiumInventory(_req: Request, res: Response) {
  const rows = getDb()
    .prepare(
      `SELECT article_id, tier, lang, LENGTH(html) as html_length, updated_at
       FROM premium_content ORDER BY article_id`
    )
    .all();
  res.json({ count: rows.length, sections: rows });
}
