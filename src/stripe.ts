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
import { getDb } from "./db/connection.js";

// Stripe client — initialized lazily to avoid crashes when STRIPE_SECRET_KEY is not set
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    _stripe = new Stripe(key);
  }
  return _stripe;
}

// Map Stripe price IDs to tiers (configured via env vars)
function priceTier(priceId: string): string {
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return "pro";
  if (priceId === process.env.STRIPE_PRICE_PRO_ANNUAL) return "pro";
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  return "pro"; // default fallback
}

// ─── Webhook Handler ───────────────────────────────────────────────

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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription && session.customer) {
        const sub = await getStripe().subscriptions.retrieve(session.subscription as string);
        const item = sub.items.data[0];
        const priceId = item?.price.id ?? "";
        const tier = priceTier(priceId);
        const email = session.customer_details?.email ?? session.customer_email ?? "";

        db.prepare(`
          INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status, current_period_start, current_period_end)
          VALUES (?, ?, ?, ?, 'active', datetime(?, 'unixepoch'), datetime(?, 'unixepoch'))
          ON CONFLICT(stripe_subscription_id) DO UPDATE SET
            email = excluded.email, tier = excluded.tier, status = 'active',
            current_period_start = excluded.current_period_start,
            current_period_end = excluded.current_period_end,
            updated_at = datetime('now')
        `).run(
          session.customer as string,
          session.subscription as string,
          email,
          tier,
          item?.current_period_start ?? 0,
          item?.current_period_end ?? 0,
        );
        console.log(`[Stripe] Subscription created: ${email} → ${tier}`);
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const item = sub.items.data[0];
      const priceId = item?.price.id ?? "";
      const tier = priceTier(priceId);

      db.prepare(`
        UPDATE subscriptions SET
          tier = ?, status = ?, cancel_at_period_end = ?,
          current_period_start = datetime(?, 'unixepoch'),
          current_period_end = datetime(?, 'unixepoch'),
          updated_at = datetime('now')
        WHERE stripe_subscription_id = ?
      `).run(
        tier,
        sub.status === "active" ? "active" : sub.status,
        sub.cancel_at_period_end ? 1 : 0,
        item?.current_period_start ?? 0,
        item?.current_period_end ?? 0,
        sub.id,
      );
      console.log(`[Stripe] Subscription updated: ${sub.id} → ${tier} (${sub.status})`);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      db.prepare(`
        UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now')
        WHERE stripe_subscription_id = ?
      `).run(sub.id);
      console.log(`[Stripe] Subscription canceled: ${sub.id}`);
      break;
    }

    default:
      // Unhandled event types — silently acknowledge
      break;
  }

  res.json({ received: true });
}

// ─── Access Check API ──────────────────────────────────────────────

interface AccessResult {
  tier: string;
  active: boolean;
  services?: string[];
  expires?: string;
}

export function handleAccessCheck(req: Request, res: Response) {
  const email = req.query.email as string;
  if (!email) {
    res.status(400).json({ error: "email parameter required" });
    return;
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT tier, status, service_ids, current_period_end, cancel_at_period_end
    FROM subscriptions
    WHERE email = ? AND status IN ('active', 'trialing')
    ORDER BY
      CASE tier WHEN 'enterprise' THEN 4 WHEN 'team' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
    LIMIT 1
  `).get(email) as { tier: string; status: string; service_ids: string; current_period_end: string; cancel_at_period_end: number } | undefined;

  if (!row) {
    res.json({ tier: "free", active: false } as AccessResult);
    return;
  }

  const result: AccessResult = {
    tier: row.tier,
    active: true,
    expires: row.current_period_end,
  };

  if (row.tier === "team") {
    try {
      result.services = JSON.parse(row.service_ids);
    } catch {
      result.services = [];
    }
  }

  res.json(result);
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
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    "SELECT stripe_customer_id FROM subscriptions WHERE email = ? LIMIT 1"
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
