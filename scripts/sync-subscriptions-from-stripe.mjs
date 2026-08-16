#!/usr/bin/env node
/**
 * Phase C0: subscriptions を Stripe API（正本）から再同期する。
 *
 * Codex指示: 「subscription状態はDB差分ではなくStripe APIを正本として再同期」。
 * DB行コピーはbelievable側で最後にwebhookが処理された時点の状態でしかないため、
 * カットオーバー時は必ずこれを実行して canonical を Stripe の現在値に合わせる。
 *
 * - Stripe list subscriptions (status=all, 100件/頁) を全走査
 * - Price IDはallowlist（PRO_MONTHLY/PRO_ANNUAL/TEAM）のみtier付与。
 *   未知Priceは tier='unknown' で隔離（有料権限なし・unknown_priceとして報告）
 * - ローカルにemailが無い場合は Stripe Customer API から取得。取れなければ
 *   email='' のまま隔離し emails_missing として報告
 * - canonical の subscriptions を stripe_subscription_id でUPSERT
 * - last_stripe_event_created には同期時点のunixtimeを記録
 *   （＝これより古いwebhook遅延再送は適用されない）
 * - Stripe側に存在しないローカルactive行は削除せず報告のみ
 *
 * 実行（canonicalコンテナ内・STRIPE_SECRET_KEY必須）:
 *   NODE_PATH=/app/node_modules node sync-subscriptions-from-stripe.mjs dry|apply [--db=/data/kansei-link.db]
 * テスト時は STRIPE_API_BASE でモックへ向けられる。
 */

import Database from "better-sqlite3";

const MODE = process.argv[2];
if (!["dry", "apply"].includes(MODE)) { console.error("usage: node sync-subscriptions-from-stripe.mjs dry|apply [--db=path]"); process.exit(2); }
const argDb = process.argv.find((a) => a.startsWith("--db="));
const DB_PATH = argDb ? argDb.slice(5) : (process.env.KANSEI_DB_PATH || "/data/kansei-link.db");
const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error("STRIPE_SECRET_KEY not set"); process.exit(2); }
const API = (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");

// 既知Priceのallowlist — webhookハンドラ(src/stripe.ts priceTier)と同一契約。
// 未知Priceは 'unknown' 隔離で有料権限を付与しない。
function priceTier(priceId) {
  if (priceId && priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return "pro";
  if (priceId && priceId === process.env.STRIPE_PRICE_PRO_ANNUAL) return "pro";
  if (priceId && priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  return "unknown";
}

async function stripeGet(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  const j = await res.json();
  if (j.error) throw new Error(`Stripe API ${path}: ${j.error.message}`);
  return j;
}

async function listAllSubscriptions() {
  const subs = [];
  let startingAfter = null;
  for (;;) {
    const params = { status: "all", limit: "100" };
    if (startingAfter) params.starting_after = startingAfter;
    const j = await stripeGet("/v1/subscriptions", params);
    subs.push(...j.data);
    if (!j.has_more) return subs;
    startingAfter = j.data[j.data.length - 1].id;
  }
}

const subs = await listAllSubscriptions();
const now = Math.floor(Date.now() / 1000);
const db = new Database(DB_PATH);
const changes = [], unknownPrice = [], emailsMissing = [];

for (const sub of subs) {
  const item = sub.items?.data?.[0];
  const tier = priceTier(item?.price?.id ?? "");
  if (tier === "unknown") unknownPrice.push({ id: sub.id, price: item?.price?.id ?? "(none)", status: sub.status });
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";

  const existing = db.prepare("SELECT email, status, tier, cancel_at_period_end FROM subscriptions WHERE stripe_subscription_id=?").get(sub.id);
  let email = existing?.email ?? "";
  if (!email && customerId) {
    try {
      const cust = await stripeGet(`/v1/customers/${customerId}`);
      if (!cust.deleted) email = cust.email ?? "";
    } catch { /* fall through to quarantine */ }
    if (!email) emailsMissing.push({ id: sub.id, customer: customerId });
  }

  const before = existing ? `${existing.status}/${existing.tier}/cape=${existing.cancel_at_period_end}` : "(absent)";
  const after = `${sub.status}/${tier}/cape=${sub.cancel_at_period_end ? 1 : 0}`;
  changes.push({ id: sub.id, before, after, changed: before !== after });

  if (MODE === "apply") {
    db.prepare(`
      INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status,
        current_period_start, current_period_end, cancel_at_period_end, last_stripe_event_created)
      VALUES (?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), ?, ?)
      ON CONFLICT(stripe_subscription_id) DO UPDATE SET
        tier=excluded.tier, status=excluded.status,
        email=CASE WHEN subscriptions.email = '' THEN excluded.email ELSE subscriptions.email END,
        current_period_start=excluded.current_period_start,
        current_period_end=excluded.current_period_end,
        cancel_at_period_end=excluded.cancel_at_period_end,
        last_stripe_event_created=excluded.last_stripe_event_created,
        updated_at=datetime('now')
    `).run(
      customerId, sub.id, email, tier, sub.status,
      item?.current_period_start ?? sub.start_date ?? 0,
      item?.current_period_end ?? 0,
      sub.cancel_at_period_end ? 1 : 0,
      now,
    );
  }
}

// Stripe側に存在しないローカルactive行の検出（削除はしない — 報告のみ）
const stripeIds = new Set(subs.map((s) => s.id));
const orphans = db.prepare("SELECT stripe_subscription_id, status FROM subscriptions WHERE status IN ('active','trialing')").all()
  .filter((r) => !stripeIds.has(r.stripe_subscription_id));

console.log(JSON.stringify({ mode: MODE, stripe_total: subs.length,
  changed: changes.filter((c) => c.changed), unchanged: changes.filter((c) => !c.changed).length,
  unknown_price: unknownPrice, emails_missing: emailsMissing,
  local_active_not_in_stripe: orphans }, null, 1));
