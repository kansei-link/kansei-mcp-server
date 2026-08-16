#!/usr/bin/env node
/**
 * Phase A0 E2E (rev2 — Codex修正4点反映): Stripe webhook idempotency + ordering
 * + truth-fetch + unknown-price quarantine + access-token gate.
 *
 * 内蔵のStripe APIモック（STRIPE_API_BASEで注入）に対して実サーバー
 * (dist/http-server.js) を駆動し、本物の署名スキーム（t=..,v1=HMAC）でPOSTする。
 *
 * カバレッジ（Codex A0条件+追加テスト指定）:
 *   - 署名検証が最初（不正署名→400・記録なし）
 *   - event.id台帳とmutationが同一tx／成功済み重複のみ200／失敗→非2xxで再送可能
 *   - updated/deleted = Stripe API真実取得UPSERT（イベントpayloadは信用しない）
 *   - updatedがcheckoutより先に届いても行が作られ、emailはCustomer APIから解決
 *   - updatedとdeletedが同一秒でも復活しない（tie-guard・モックが古いactiveを
 *     返す最悪ケースで検証）
 *   - 未知Priceは tier=unknown 隔離・/api/accessで有料権限が付かない
 *   - 存在しないSubscriptionへのupdated→隔離（状態変更なし・ACK・監査ログ）
 *   - v2 kidトークン + portalゲート
 *
 * Usage: node scripts/smoke-stripe-webhook.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WHSEC = "whsec_test_smoke_secret";
const ACCESS_SECRET = "test-access-secret-a0";
const PORT = 5700 + Math.floor(Math.random() * 200);
const MOCK_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

// ── Stripe APIモック ────────────────────────────────────────────
// subscriptions.retrieve / customers.retrieve / billing_portal.sessions.create
const mockSubs = {
  sub_smoke_1: { id: "sub_smoke_1", object: "subscription", status: "active", cancel_at_period_end: true, customer: "cus_smoke",
    items: { data: [{ price: { id: "price_test_pro" }, current_period_start: 2000, current_period_end: 2592000 }] } },
  sub_smoke_2: { id: "sub_smoke_2", object: "subscription", status: "active", cancel_at_period_end: false, customer: "cus_smoke2",
    items: { data: [{ price: { id: "price_test_pro" }, current_period_start: 3500, current_period_end: 2600000 }] } },
  sub_new_1: { id: "sub_new_1", object: "subscription", status: "active", cancel_at_period_end: false, customer: "cus_new_1",
    items: { data: [{ price: { id: "price_test_pro" }, current_period_start: 2100, current_period_end: 2600000 }] } },
  sub_unknown: { id: "sub_unknown", object: "subscription", status: "active", cancel_at_period_end: false, customer: "cus_unk",
    items: { data: [{ price: { id: "price_other_product" }, current_period_start: 4000, current_period_end: 2600000 }] } },
};
const mockCustomers = {
  cus_new_1: { id: "cus_new_1", object: "customer", email: "new@example.com" },
  cus_unk: { id: "cus_unk", object: "customer", email: "unk@example.com" },
  cus_smoke2: { id: "cus_smoke2", object: "customer", email: "smoke2@example.com" },
};
const mock = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const mSub = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
  const mCus = req.url.match(/^\/v1\/customers\/([^/?]+)/);
  if (mSub) {
    const id = mSub[1];
    if (id === "sub_boom") return send(500, { error: { type: "api_error", message: "mock transient failure" } });
    if (!mockSubs[id]) return send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such subscription" } });
    return send(200, mockSubs[id]);
  }
  if (mCus) {
    const c = mockCustomers[mCus[1]];
    return c ? send(200, c) : send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such customer" } });
  }
  if (req.url.startsWith("/v1/billing_portal/sessions")) return send(400, { error: { type: "invalid_request_error", message: "mock: portal not configured" } });
  if (req.url.startsWith("/v1/checkout/sessions")) return send(400, { error: { type: "invalid_request_error", message: "mock: not needed" } });
  send(404, { error: { type: "invalid_request_error", message: `mock: unhandled ${req.url}` } });
});

function sign(payload) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WHSEC).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function post(body, sigHeader) {
  const payload = JSON.stringify(body);
  const res = await fetch(`${BASE}/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sigHeader ?? sign(payload) },
    body: payload,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

// イベントpayloadは「信用されない」側 — 真実はモックが返す
const subEvent = (evtId, type, created, subId) => ({
  id: evtId, type, created,
  data: { object: { id: subId, object: "subscription", status: "active", cancel_at_period_end: false, customer: "cus_evt_stale",
    items: { data: [{ price: { id: "price_from_event_should_be_ignored" }, current_period_start: created, current_period_end: created + 1000 }] } } },
});

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  const workDir = mkdtempSync(join(tmpdir(), "kansei-stripe-smoke-"));
  const dbPath = join(workDir, "smoke.db");

  const server = spawn(process.execPath, [join(ROOT, "dist", "http-server.js")], {
    env: { ...process.env, KANSEI_DB_PATH: dbPath, PORT: String(PORT), KANSEI_HOST: "127.0.0.1",
      CRAWLER_SECRET: "smoke", STRIPE_WEBHOOK_SECRET: WHSEC, ACCESS_TOKEN_SECRET: ACCESS_SECRET,
      STRIPE_SECRET_KEY: "sk_test_mock", STRIPE_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
      STRIPE_PRICE_PRO_MONTHLY: "price_test_pro" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!up) { console.error("server did not boot:\n" + serverLog.slice(-800)); server.kill(); process.exit(1); }

  const { default: Database } = await import("better-sqlite3");
  const dbw = new Database(dbPath);
  dbw.prepare(`INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status, last_stripe_event_created)
               VALUES ('cus_smoke', 'sub_smoke_1', 'smoke@example.com', 'pro', 'active', 1000)`).run();
  dbw.close();
  const db = new Database(dbPath, { readonly: true });
  const row = (id = "sub_smoke_1") => db.prepare("SELECT email, status, tier, cancel_at_period_end, last_stripe_event_created FROM subscriptions WHERE stripe_subscription_id=?").get(id);
  const ledger = (id) => db.prepare("SELECT 1 FROM stripe_webhook_events WHERE event_id=?").get(id);

  // 1. 不正署名 → 400・記録なし
  let r = await post(subEvent("evt_bad_sig", "customer.subscription.updated", 2000, "sub_smoke_1"), "t=1,v1=deadbeef");
  check("1. 不正署名→400・台帳未記録", r.status === 400 && !ledger("evt_bad_sig"));

  // 2. updated → モックの真実（cape=true）が適用される。イベントpayloadのcape=falseは無視
  r = await post(subEvent("evt_upd_1", "customer.subscription.updated", 2000, "sub_smoke_1"));
  check("2. updated=API真実取得で適用（payloadでなくモックのcape=1）+台帳記録", r.status === 200 && row().cancel_at_period_end === 1 && row().last_stripe_event_created === 2000 && Boolean(ledger("evt_upd_1")));

  // 3. 同一event.id再送 → 200 duplicate・副作用ゼロ
  r = await post(subEvent("evt_upd_1", "customer.subscription.updated", 2000, "sub_smoke_1"));
  check("3. 同一event.id再送→200 duplicate", r.status === 200 && r.json?.duplicate === true);

  // 4. 古いcreatedのupdated → ガードでskip・ACK
  r = await post(subEvent("evt_upd_stale", "customer.subscription.updated", 500, "sub_smoke_1"));
  check("4. 古いcreated→適用スキップ・ACK", r.status === 200 && row().last_stripe_event_created === 2000 && Boolean(ledger("evt_upd_stale")));

  // 5. checkoutより先に届いたupdated → 行が作成され、emailはCustomer APIから解決
  r = await post(subEvent("evt_new_first", "customer.subscription.updated", 2100, "sub_new_1"));
  check("5. updated先着→行作成+email=Customer API解決", r.status === 200 && row("sub_new_1")?.status === "active" && row("sub_new_1")?.tier === "pro" && row("sub_new_1")?.email === "new@example.com");

  // 6. deleted → canceled（モックの真実も更新して整合）
  mockSubs.sub_smoke_1.status = "canceled";
  r = await post(subEvent("evt_del_1", "customer.subscription.deleted", 3000, "sub_smoke_1"));
  check("6. deleted→canceled", r.status === 200 && row().status === "canceled" && row().last_stripe_event_created === 3000);

  // 7. 同一秒のupdated + モックが古いactiveを返す最悪ケース → tie-guardで復活しない
  mockSubs.sub_smoke_1.status = "active"; // Stripe読み取りが古い値を返すレースを再現
  r = await post(subEvent("evt_upd_tie", "customer.subscription.updated", 3000, "sub_smoke_1"));
  mockSubs.sub_smoke_1.status = "canceled";
  check("7. 同一秒updated（真実さえ古い）→deleted優先・復活しない", r.status === 200 && row().status === "canceled");

  // 8. checkout.session.completed 正常系
  const checkout = { id: "evt_checkout_ok", type: "checkout.session.completed", created: 3500,
    data: { object: { id: "cs_ok", object: "checkout.session", mode: "subscription", subscription: "sub_smoke_2", customer: "cus_smoke2",
      customer_details: { email: "smoke2@example.com" } } } };
  r = await post(checkout);
  check("8. checkout正常→行作成(pro/active)", r.status === 200 && row("sub_smoke_2")?.tier === "pro" && row("sub_smoke_2")?.status === "active" && Boolean(ledger("evt_checkout_ok")));

  // 9. 処理失敗（モック500）→ 非2xx・台帳未記録＝再送で再処理可能
  const boom = subEvent("evt_boom", "customer.subscription.updated", 4000, "sub_boom");
  r = await post(boom);
  const firstFail = r.status >= 500 && !ledger("evt_boom");
  r = await post(boom);
  check("9. 処理失敗→500・台帳未記録=再送可能", firstFail && r.status >= 500 && !ledger("evt_boom"));

  // 10. 未知Price → tier=unknown隔離・/api/accessで有料権限なし
  r = await post(subEvent("evt_unknown", "customer.subscription.updated", 4100, "sub_unknown"));
  const access = await (await fetch(`${BASE}/api/access?email=unk@example.com`)).json();
  check("10. 未知Price→tier=unknown隔離・accessはfree", r.status === 200 && row("sub_unknown")?.tier === "unknown" && access.tier === "free" && access.active === false);

  // 11. 存在しないSubscriptionへのupdated → 隔離（行なし・ACK・台帳記録）
  r = await post(subEvent("evt_missing", "customer.subscription.updated", 4200, "sub_ghost"));
  check("11. missing subscriptionのupdated→隔離・ACK・台帳記録", r.status === 200 && !row("sub_ghost") && Boolean(ledger("evt_missing")));

  // 12. 未対応イベント型 → ACK+台帳記録（再送停止）
  r = await post({ id: "evt_other", type: "invoice.paid", created: 5000, data: { object: {} } });
  check("12. 未対応イベント→ACK+台帳記録", r.status === 200 && Boolean(ledger("evt_other")));

  // 14. checkout到着時にAPI真実がすでにcanceled → activeを付与しない
  mockSubs.sub_smoke_3 = { id: "sub_smoke_3", object: "subscription", status: "canceled", cancel_at_period_end: true, customer: "cus_smoke2",
    items: { data: [{ price: { id: "price_test_pro" }, current_period_start: 5100, current_period_end: 2600000 }] } };
  r = await post({ id: "evt_checkout_canceled", type: "checkout.session.completed", created: 5100,
    data: { object: { id: "cs_c", object: "checkout.session", mode: "subscription", subscription: "sub_smoke_3", customer: "cus_smoke2",
      customer_details: { email: "smoke3@example.com" } } } });
  check("14. checkout時にAPI真実=canceled→canceledのまま保存（active固定なし）", r.status === 200 && row("sub_smoke_3")?.status === "canceled" && row("sub_smoke_3")?.cancel_at_period_end === 1);

  // 15. deleted→同一秒の遅延checkout（真実取得さえ古いactiveを返す最悪ケース）→復活しない
  mockSubs.sub_smoke_2.status = "canceled";
  r = await post(subEvent("evt_del_2", "customer.subscription.deleted", 6000, "sub_smoke_2"));
  const canceledOk = r.status === 200 && row("sub_smoke_2")?.status === "canceled";
  mockSubs.sub_smoke_2.status = "active"; // レース: checkoutの真実取得が古いactiveを見る
  r = await post({ id: "evt_checkout_late", type: "checkout.session.completed", created: 6000,
    data: { object: { id: "cs_late", object: "checkout.session", mode: "subscription", subscription: "sub_smoke_2", customer: "cus_smoke2",
      customer_details: { email: "smoke2@example.com" } } } });
  mockSubs.sub_smoke_2.status = "canceled";
  check("15. deleted→同一秒checkout（真実さえ古い）→キャンセル復活しない", canceledOk && r.status === 200 && row("sub_smoke_2")?.status === "canceled");

  // 13. v2 kidトークン + portalゲート
  const mac = createHmac("sha256", ACCESS_SECRET).update("smoke@example.com").digest("hex").slice(0, 32);
  const bad = await fetch(`${BASE}/api/portal`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "smoke@example.com", token: "v2.wrongwrongwrongwrongwrongwrong12" }) });
  const good = await fetch(`${BASE}/api/portal`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "smoke@example.com", token: `v2.${mac}` }) });
  check("13. portalゲート: 不正token=404 / 正token(v2)=通過(→モック段で500)", bad.status === 404 && good.status === 500);

  db.close();
  server.kill();
  mock.close();
  await new Promise((r2) => setTimeout(r2, 500));
  rmSync(workDir, { recursive: true, force: true });

  const all = results.every(Boolean);
  console.log(all ? "\n✅ smoke-stripe-webhook: ALL PASS" : "\n❌ smoke-stripe-webhook: FAILURES");
  process.exit(all ? 0 : 1);
}

main().catch((e) => { console.error("SMOKE ERROR:", e); process.exit(1); });
