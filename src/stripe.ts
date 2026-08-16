/**
 * Stripe integration for KanseiLink subscription billing.
 *
 * Tiers:
 *   - free:       Public AEO articles, grade distributions, top 5
 *   - pro:        Agent Voice details, recipe success rates, gotchas, multi-agent comparison ($19/mo or $149/yr)
 *   - team:       Per-service detailed reports, competitive analysis, AXR trends ($149/mo per service)
 *   - enterprise: Custom reports, consulting ($2,990+ one-time)
 */

import Stripe from "stripe";
import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "./db/connection.js";

// ─── Access token (proves caller owns the email — closes /api/access enumeration) ──
// Deterministic HMAC so no new column/storage is needed. The secret is a DEDICATED
// env (ACCESS_TOKEN_SECRET) — never the Stripe webhook secret or CRAWLER_SECRET:
// those rotate on their own schedules (a webhook endpoint re-creation must not
// invalidate customer sessions, and a token secret leak must not compromise
// webhook authenticity). If unset the gate fails CLOSED (every query looks like
// "free" — never leaks existence).
// Tokens carry a key id ("kid") prefix so the secret can rotate later: verifiers
// accept only kids they know, and a future ACCESS_TOKEN_SECRET_V3 can be checked
// alongside V2 during a rotation window.
const ACCESS_TOKEN_KID = "v2";

function accessSecret(): string | null {
  return process.env.ACCESS_TOKEN_SECRET || null;
}

export function accessTokenFor(email: string): string | null {
  const secret = accessSecret();
  if (!secret) return null;
  const mac = createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `${ACCESS_TOKEN_KID}.${mac}`;
}

export function tokenMatches(provided: string, expected: string | null): boolean {
  if (!expected || !provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Stripe client — initialized lazily to avoid crashes when STRIPE_SECRET_KEY is not set.
// STRIPE_API_BASE (e.g. "http://127.0.0.1:5799") redirects API calls to a local mock
// for E2E tests; unset in production.
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    const base = process.env.STRIPE_API_BASE;
    if (base) {
      const u = new URL(base);
      _stripe = new Stripe(key, {
        host: u.hostname,
        port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
        protocol: u.protocol.replace(":", "") as "http" | "https",
      });
    } else {
      _stripe = new Stripe(key);
    }
  }
  return _stripe;
}

// Map Stripe price IDs to tiers — STRICT allowlist of the three prices we sell.
// An unknown price (another product on the account, a future plan, a test price)
// must NEVER grant paid entitlements: it maps to "unknown", which is stored for
// audit but excluded from every entitlement check (see accessResultForEmail).
function priceTier(priceId: string): string {
  if (priceId && priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return "pro";
  if (priceId && priceId === process.env.STRIPE_PRICE_PRO_ANNUAL) return "pro";
  if (priceId && priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  console.error(`[Stripe][AUDIT] unknown price id ${priceId || "(none)"} — quarantined as tier=unknown (no paid entitlement)`);
  return "unknown";
}

// ─── Webhook Handler ───────────────────────────────────────────────
//
// Idempotency + ordering contract (Phase A0, 2026-08-16):
//   1. Signature is verified BEFORE anything else touches the payload.
//   2. Each event mutates the DB inside ONE transaction that also records
//      event.id in stripe_webhook_events. Crash mid-way → no ledger row →
//      Stripe's retry is processed as if new. (An insert-first/OR IGNORE
//      design would mark crashed events as done forever — rejected.)
//   3. A replay of a SUCCESSFULLY processed event.id is acknowledged with 200
//      and zero side effects.
//   4. Any processing failure returns non-2xx so Stripe retries.
//   5. subscriptions.last_stripe_event_created is a per-row monotonic clock:
//      an event older than what the row has already seen is skipped (stale),
//      so delayed retries can neither roll state back nor revive a
//      subscription that a newer `deleted` event canceled.
//   6. Handlers have NO side effects besides these DB writes and console.log
//      (no email, no token issuance, no external calls) — verified 2026-08-16;
//      keep it that way or dual-endpoint operation during cutover breaks.

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !endpointSecret) {
    res.status(400).json({ error: "Missing signature or webhook secret" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    res.status(400).json({ error: `Webhook Error: ${message}` });
    return;
  }

  const db = getDb();

  // Fast path: already fully processed → ACK, no side effects, no API calls.
  const seen = db.prepare("SELECT 1 FROM stripe_webhook_events WHERE event_id = ?").get(event.id);
  if (seen) {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    // Async work (Stripe API reads) happens BEFORE the transaction —
    // better-sqlite3 transactions are synchronous by design.
    let mutate: (() => void) | null = null;

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription && session.customer) {
          // Same truth-fetch contract as updated/deleted: we already retrieve the
          // subscription, so store its CURRENT status — never a hardcoded
          // 'active'. A delayed checkout event must not resurrect a
          // subscription that was canceled in the meantime (API truth ordering
          // + the same same-second canceled-wins tie-guard).
          const sub = await getStripe().subscriptions.retrieve(session.subscription as string);
          const item = sub.items.data[0];
          const tier = priceTier(item?.price.id ?? "");
          const status = sub.status;
          const email = session.customer_details?.email ?? session.customer_email ?? "";
          mutate = () => {
            const r = db.prepare(`
              INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status,
                current_period_start, current_period_end, cancel_at_period_end, last_stripe_event_created)
              VALUES (?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), ?, ?)
              ON CONFLICT(stripe_subscription_id) DO UPDATE SET
                email = excluded.email, tier = excluded.tier, status = excluded.status,
                current_period_start = excluded.current_period_start,
                current_period_end = excluded.current_period_end,
                cancel_at_period_end = excluded.cancel_at_period_end,
                last_stripe_event_created = excluded.last_stripe_event_created,
                updated_at = datetime('now')
              WHERE COALESCE(subscriptions.last_stripe_event_created, 0) <= excluded.last_stripe_event_created
                AND NOT (subscriptions.status = 'canceled'
                         AND COALESCE(subscriptions.last_stripe_event_created, 0) = excluded.last_stripe_event_created
                         AND excluded.status != 'canceled')
            `).run(
              session.customer as string,
              session.subscription as string,
              email,
              tier,
              status,
              item?.current_period_start ?? 0,
              item?.current_period_end ?? 0,
              sub.cancel_at_period_end ? 1 : 0,
              event.created,
            );
            console.log(`[Stripe] Checkout completed: ${email} → ${tier} (${status})${r.changes === 0 ? " [stale — skipped]" : ""}`);
          };
        }
        break;
      }

      // updated/deleted: Stripe does NOT guarantee delivery order, so the event
      // payload is only a hint. We fetch the subscription's CURRENT state from
      // the Stripe API (source of truth) and upsert that — an out-of-order or
      // delayed event can then never resurrect canceled state or roll back a
      // newer change, and an `updated` arriving before `checkout.completed`
      // still creates the row (email resolved via the Customer API).
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const evSub = event.data.object as Stripe.Subscription;
        let truth: Stripe.Subscription | null = null;
        try {
          truth = await getStripe().subscriptions.retrieve(evSub.id);
        } catch (err: unknown) {
          const code = (err as { code?: string; statusCode?: number });
          if (code?.code === "resource_missing" || code?.statusCode === 404) {
            if (event.type === "customer.subscription.deleted") {
              truth = null; // terminal: apply cancel from the event itself below
            } else {
              // updated for a subscription Stripe no longer knows: quarantine.
              console.error(`[Stripe][AUDIT] updated event for missing subscription ${evSub.id} — no state change, event recorded`);
              mutate = null;
              break;
            }
          } else {
            throw err; // transient failure → 500 → Stripe retries
          }
        }

        const sub = truth ?? evSub;
        const item = sub.items?.data?.[0];
        const tier = priceTier(item?.price?.id ?? "");
        const status = truth ? sub.status : "canceled";
        const localRow = db.prepare("SELECT email FROM subscriptions WHERE stripe_subscription_id = ?").get(sub.id) as { email: string } | undefined;
        let email = localRow?.email ?? "";
        if (!localRow && sub.customer) {
          // Row doesn't exist locally (updated-before-checkout): resolve the
          // customer email from Stripe so the row is usable for entitlements.
          try {
            const cust = await getStripe().customers.retrieve(
              typeof sub.customer === "string" ? sub.customer : sub.customer.id
            );
            if (!("deleted" in cust) || !cust.deleted) email = (cust as Stripe.Customer).email ?? "";
          } catch {
            email = ""; // quarantined: row exists but is not entitlement-addressable
          }
          if (!email) console.error(`[Stripe][AUDIT] no email resolvable for ${sub.id} — row stored without email`);
        }

        mutate = () => {
          const r = db.prepare(`
            INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status,
              current_period_start, current_period_end, cancel_at_period_end, last_stripe_event_created)
            VALUES (?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), ?, ?)
            ON CONFLICT(stripe_subscription_id) DO UPDATE SET
              tier = excluded.tier, status = excluded.status,
              email = CASE WHEN subscriptions.email = '' THEN excluded.email ELSE subscriptions.email END,
              current_period_start = excluded.current_period_start,
              current_period_end = excluded.current_period_end,
              cancel_at_period_end = excluded.cancel_at_period_end,
              last_stripe_event_created = excluded.last_stripe_event_created,
              updated_at = datetime('now')
            WHERE COALESCE(subscriptions.last_stripe_event_created, 0) <= excluded.last_stripe_event_created
              -- same-second tie: a deleted-canceled row wins over a same-created update
              AND NOT (subscriptions.status = 'canceled'
                       AND COALESCE(subscriptions.last_stripe_event_created, 0) = excluded.last_stripe_event_created
                       AND excluded.status != 'canceled')
          `).run(
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "",
            sub.id,
            email,
            tier,
            status,
            item?.current_period_start ?? 0,
            item?.current_period_end ?? 0,
            sub.cancel_at_period_end ? 1 : 0,
            event.created,
          );
          console.log(`[Stripe] ${event.type}: ${sub.id} → ${tier} (${status})${r.changes === 0 ? " [stale — skipped]" : ""}`);
        };
        break;
      }

      default:
        // Unhandled event types — record + acknowledge so retries stop.
        break;
    }

    db.transaction(() => {
      if (mutate) mutate();
      db.prepare(
        "INSERT INTO stripe_webhook_events (event_id, event_type, event_created) VALUES (?, ?, ?)"
      ).run(event.id, event.type, event.created);
    })();

    res.json({ received: true });
  } catch (err: unknown) {
    // No ledger row was committed (single transaction) → Stripe will retry.
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Stripe] Webhook processing failed for ${event.id} (${event.type}):`, message);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

// ─── Access Check API ──────────────────────────────────────────────

interface AccessResult {
  tier: string;
  active: boolean;
  services?: string[];
  expires?: string;
}

// Look up a subscription by (already-authorized) email and shape the public result.
// `active:false / tier:"free"` is the SAME response for "no subscription" and "not authorized",
// so an unauthorized caller cannot tell whether an email is a customer.
export function accessResultForEmail(email: string): AccessResult {
  // tier allowlist: rows quarantined as tier='unknown' (unrecognized Stripe price)
  // never grant access — they exist for audit only.
  const row = getDb().prepare(`
    SELECT tier, status, service_ids, current_period_end, cancel_at_period_end
    FROM subscriptions
    WHERE LOWER(email) = ? AND status IN ('active', 'trialing')
      AND tier IN ('pro', 'team', 'enterprise')
    ORDER BY
      CASE tier WHEN 'enterprise' THEN 4 WHEN 'team' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
    LIMIT 1
  `).get(email.trim().toLowerCase()) as { tier: string; status: string; service_ids: string; current_period_end: string; cancel_at_period_end: number } | undefined;

  if (!row) return { tier: "free", active: false };
  const result: AccessResult = { tier: row.tier, active: true, expires: row.current_period_end };
  if (row.tier === "team") {
    try { result.services = JSON.parse(row.service_ids); } catch { result.services = []; }
  }
  return result;
}

// GET /api/access?email=   — read-only content gating (returns tier + expiry only, no payment data).
// LAUNCH POSTURE: keyed by email. This is intentionally NOT token-gated — the residual risk is a
// low-stakes "is this email a customer + tier" read, and gating it would lock out existing
// subscribers who predate the token flow. The DANGEROUS endpoints stay locked: /api/portal
// (manage/cancel billing → token-gated) and /api/checkout (price-whitelisted). The proper upgrade
// that closes this read-enumeration is magic-link email login — planned post-launch (see SECURITY.md).
export function handleAccessCheck(req: Request, res: Response) {
  const email = ((req.query.email as string) || "").trim().toLowerCase();
  if (!email) {
    res.json({ tier: "free", active: false } as AccessResult);
    return;
  }
  res.json(accessResultForEmail(email));
}

// GET /api/access-token?session_id=cs_...
// Post-checkout bridge: the success page has the Stripe Checkout session_id (unforgeable). We verify
// it WITH Stripe, then hand back the email + reusable access token so the frontend can call
// /api/access afterwards. This is the only way to obtain a token — closing the enumeration hole.
export async function handleAccessTokenIssue(req: Request, res: Response) {
  const sessionId = ((req.query.session_id as string) || "").trim();
  if (!sessionId.startsWith("cs_")) {
    res.status(400).json({ error: "valid session_id required" });
    return;
  }
  if (!accessSecret()) {
    res.status(503).json({ error: "access tokens not configured on server" });
    return;
  }
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const email = (session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
    if (!email || (session.payment_status !== "paid" && session.status !== "complete")) {
      res.status(402).json({ error: "session not completed" });
      return;
    }
    res.json({ email, token: accessTokenFor(email), access: accessResultForEmail(email) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

// ─── Checkout Session Creator ──────────────────────────────────────

export async function handleCreateCheckout(req: Request, res: Response) {
  const { priceId, email, serviceId } = req.body as {
    priceId?: string;
    email?: string;
    serviceId?: string;
  };

  if (!priceId) {
    res.status(400).json({ error: "priceId required" });
    return;
  }

  // Defense-in-depth: only allow price IDs we actually sell. Stripe rejects unknown IDs, but this
  // also blocks a client swapping in a *different valid* price (e.g. a cheaper/test plan). Enforced
  // only when prices are configured, so unconfigured/dev environments still work.
  const validPriceIds = new Set(
    [
      process.env.STRIPE_PRICE_PRO_MONTHLY,
      process.env.STRIPE_PRICE_PRO_ANNUAL,
      process.env.STRIPE_PRICE_TEAM,
    ].filter((p): p is string => Boolean(p))
  );
  if (validPriceIds.size > 0 && !validPriceIds.has(priceId)) {
    res.status(400).json({ error: "Invalid price ID" });
    return;
  }

  try {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.KANSEI_PUBLIC_URL ?? "https://kansei-link.com"}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.KANSEI_PUBLIC_URL ?? "https://kansei-link.com"}/subscription/cancel`,
      allow_promotion_codes: true,
    };

    if (email) {
      params.customer_email = email;
    }

    if (serviceId) {
      params.metadata = { service_id: serviceId };
    }

    const session = await getStripe().checkout.sessions.create(params);
    res.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Stripe] Checkout creation failed:", message);
    res.status(500).json({ error: message });
  }
}

// ─── Customer Portal ───────────────────────────────────────────────

export async function handleCustomerPortal(req: Request, res: Response) {
  const body = (req.body ?? {}) as { email?: string; token?: string };
  const email = (body.email || "").trim().toLowerCase();
  const token = (req.header("x-access-token") as string) || body.token || "";

  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }

  // A portal session can VIEW billing and CANCEL/modify the subscription, so this must prove
  // ownership — same per-email token as /api/access. Without it, respond exactly as "no subscription"
  // so an attacker cannot (a) take over billing or (b) enumerate customers via this endpoint.
  if (!tokenMatches(token, accessTokenFor(email))) {
    res.status(404).json({ error: "No subscription found for this email" });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    "SELECT stripe_customer_id FROM subscriptions WHERE LOWER(email) = ? LIMIT 1"
  ).get(email) as { stripe_customer_id: string } | undefined;

  if (!row) {
    res.status(404).json({ error: "No subscription found for this email" });
    return;
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${process.env.KANSEI_PUBLIC_URL ?? "https://kansei-link.com"}/insights/`,
    });
    res.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Stripe] Portal creation failed:", message);
    res.status(500).json({ error: message });
  }
}
