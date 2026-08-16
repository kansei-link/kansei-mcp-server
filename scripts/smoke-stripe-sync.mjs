#!/usr/bin/env node
/**
 * Phase A0: sync-subscriptions-from-stripe.mjs のモック検証（ローカル・本番非接触）。
 *
 * Codex追加テスト:
 *   - Stripe同期で未知・別商品のSubscriptionは tier=unknown 隔離（有料tierを付けない）
 *   - ローカル未登録顧客のemailをCustomer APIから取得できる／取れなければ隔離報告
 *   - Stripe側に無いローカルactive行は削除せず報告のみ
 *   - 既存行のemailは上書きしない・状態はStripe正本でUPSERT
 */

import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PORT = 5950 + Math.floor(Math.random() * 40);
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

const subs = [
  { id: "sub_pro", object: "subscription", status: "active", cancel_at_period_end: false, customer: "cus_pro",
    items: { data: [{ price: { id: "price_test_pro" }, current_period_start: 1000, current_period_end: 2000 }] } },
  { id: "sub_other_product", object: "subscription", status: "active", cancel_at_period_end: false, customer: "cus_other",
    items: { data: [{ price: { id: "price_some_other_saas" }, current_period_start: 1000, current_period_end: 2000 }] } },
  { id: "sub_no_email", object: "subscription", status: "past_due", cancel_at_period_end: true, customer: "cus_ghost",
    items: { data: [{ price: { id: "price_test_pro" }, current_period_start: 1000, current_period_end: 2000 }] } },
];
const customers = {
  cus_pro: { id: "cus_pro", email: "pro@example.com" },
  cus_other: { id: "cus_other", email: "other@example.com" },
  // cus_ghost: 存在しない → email取得不可 → 隔離報告
};
const mock = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith("/v1/subscriptions")) return send(200, { object: "list", data: subs, has_more: false });
  const m = req.url.match(/^\/v1\/customers\/([^/?]+)/);
  if (m) return customers[m[1]] ? send(200, customers[m[1]]) : send(404, { error: { code: "resource_missing", message: "no such customer" } });
  send(404, { error: { message: `unhandled ${req.url}` } });
});

await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
const workDir = mkdtempSync(join(tmpdir(), "kansei-sync-smoke-"));
const dbPath = join(workDir, "sync.db");
const db = new Database(dbPath);
db.exec(`CREATE TABLE subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_customer_id TEXT, stripe_subscription_id TEXT UNIQUE,
  email TEXT NOT NULL DEFAULT '', tier TEXT, status TEXT, service_ids TEXT DEFAULT '[]', current_period_start TEXT, current_period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0, last_stripe_event_created INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
// 既存行（emailあり・状態が古い）と、Stripeに存在しないローカルactive行（孤児）
db.prepare("INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status) VALUES ('cus_pro','sub_pro','existing@example.com','pro','past_due')").run();
db.prepare("INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status) VALUES ('cus_orphan','sub_orphan','orphan@example.com','pro','active')").run();
db.close();

// 注意: execFileSyncは親のイベントループを塞ぎ、親プロセス内のモックHTTPサーバーが
// 子からのリクエストに応答できずデッドロックする。必ず非同期で起動する。
const run = (mode) => new Promise((resolve, reject) => {
  execFile(process.execPath,
    [join(ROOT, "scripts", "sync-subscriptions-from-stripe.mjs"), mode, `--db=${dbPath}`],
    { encoding: "utf8", timeout: 60000,
      env: { ...process.env, STRIPE_SECRET_KEY: "sk_test_mock", STRIPE_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, STRIPE_PRICE_PRO_MONTHLY: "price_test_pro" } },
    (err, stdout, stderr) => err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(JSON.parse(stdout)));
});

const dry = await run("dry");
check("1. dry: 変更検出（sub_pro状態差分+新規2件）・書き込みなし", dry.mode === "dry" && dry.changed.length === 3);

const ap = await run("apply");
const dbr = new Database(dbPath, { readonly: true });
const g = (id) => dbr.prepare("SELECT email,tier,status,cancel_at_period_end FROM subscriptions WHERE stripe_subscription_id=?").get(id);
check("2. 既存行: 状態はStripe正本(active)・emailは上書きされない", g("sub_pro").status === "active" && g("sub_pro").email === "existing@example.com");
check("3. 未知Price→tier=unknown隔離+unknown_price報告", g("sub_other_product").tier === "unknown" && ap.unknown_price.length === 1 && ap.unknown_price[0].id === "sub_other_product");
check("4. 未登録顧客: email=Customer API取得", g("sub_other_product").email === "other@example.com");
check("5. email取得不可→''のままemails_missing報告", g("sub_no_email").email === "" && ap.emails_missing.length === 1 && ap.emails_missing[0].id === "sub_no_email");
check("6. Stripeに無いローカルactive行→削除せず報告のみ", Boolean(g("sub_orphan")) && ap.local_active_not_in_stripe.some((o) => o.stripe_subscription_id === "sub_orphan"));
dbr.close();

mock.close();
rmSync(workDir, { recursive: true, force: true });
const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-stripe-sync: ALL PASS" : "\n❌ smoke-stripe-sync: FAILURES");
process.exit(all ? 0 : 1);
