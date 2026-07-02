#!/usr/bin/env node
/**
 * HTTP integration smoke: boots the compiled http-server on a temp DB/port
 * and exercises the full tier-enforcement surface over real HTTP —
 * admin premium upload (large body), magic-link sign-in, /api/premium gating.
 *
 *   npm run build && node scripts/smoke-http-server.mjs
 */

import { spawn } from "child_process";
import { rmSync, existsSync, readFileSync } from "fs";
import { createHmac } from "crypto";
import Database from "better-sqlite3";

const PORT = 3611;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP_DB = "./smoke-http.db";
const SECRET = "smoke-access-secret";
const ADMIN = "smoke-admin-secret";

for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) if (existsSync(f)) rmSync(f);

const child = spawn(process.execPath, ["dist/http-server.js"], {
  env: {
    ...process.env,
    KANSEI_DB_PATH: TMP_DB,
    PORT: String(PORT),
    KANSEI_HOST: "127.0.0.1",
    ACCESS_TOKEN_SECRET: SECRET,
    CRAWLER_SECRET: ADMIN,
    KANSEI_AUTH_ECHO: "1",
    RESEND_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
}

function accessTokenFor(email) {
  return createHmac("sha256", SECRET).update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

async function waitForHealth(timeoutMs = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

try {
  console.log("── boot ──");
  ok(await waitForHealth(), "server up on temp DB (schema + seed applied)");

  // Subscriber fixture (separate connection; WAL allows it)
  const db = new Database(TMP_DB);
  db.prepare(`
    INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status, current_period_end)
    VALUES ('cus_s', 'sub_s', 'pro@smoke.dev', 'pro', 'active', datetime('now','+30 days'))
  `).run();
  db.close();

  // ── Admin premium upload (real extracted payload, >100KB body) ──
  console.log("── admin upload ──");
  const payload = JSON.parse(readFileSync("premium-sections.local.json", "utf-8"));
  const noAuthUp = await fetch(`${BASE}/admin/premium-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections: payload.sections }),
  });
  ok(noAuthUp.status === 401 || noAuthUp.status === 503, `upload without secret rejected (${noAuthUp.status})`);

  const up = await fetch(`${BASE}/admin/premium-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify({ sections: payload.sections }),
  });
  const upBody = await up.json();
  ok(up.status === 200 && upBody.ok && upBody.upserted === payload.sections.length,
     `upload ${payload.sections.length} sections (~${Math.round(JSON.stringify(payload).length / 1024)}KB body) → upserted`);

  const inv = await fetch(`${BASE}/admin/premium-content`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  const invBody = await inv.json();
  ok(invBody.count === payload.sections.length, `inventory count = ${invBody.count}`);

  // ── Magic-link over HTTP ──
  console.log("── magic-link ──");
  const reqLink = await fetch(`${BASE}/api/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "pro@smoke.dev" }),
  });
  const reqBody = await reqLink.json();
  ok(reqLink.status === 200 && reqBody.debug_link, "request-link → echo link (KANSEI_AUTH_ECHO)");
  const code = new URL(reqBody.debug_link).searchParams.get("code");
  const verify = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const verifyBody = await verify.json();
  ok(verify.status === 200 && verifyBody.token === accessTokenFor("pro@smoke.dev"), "verify → canonical token over HTTP");

  // ── Premium gating over HTTP ──
  console.log("── /api/premium ──");
  const art = "insights/accounting-saas-aeo-2026";
  const anon = await fetch(`${BASE}/api/premium?article=${encodeURIComponent(art)}`);
  ok(anon.status === 401, "anonymous → 401");

  const wrongTok = await fetch(`${BASE}/api/premium?article=${encodeURIComponent(art)}&email=pro@smoke.dev&token=deadbeef`);
  ok(wrongTok.status === 401, "wrong token → 401");

  const good = await fetch(
    `${BASE}/api/premium?article=${encodeURIComponent(art)}&email=pro@smoke.dev&token=${verifyBody.token}`
  );
  const goodBody = await good.json();
  ok(good.status === 200 && typeof goodBody.html === "string" && goodBody.html.includes("AXR"),
     "pro subscriber → 200 + premium HTML");

  const freeTok = accessTokenFor("stranger@smoke.dev"); // valid HMAC, but no subscription
  const freeRes = await fetch(
    `${BASE}/api/premium?article=${encodeURIComponent(art)}&email=stranger@smoke.dev&token=${freeTok}`
  );
  ok(freeRes.status === 403, "valid token, no subscription → 403");

  // ── API key issued over HTTP unlocks /api/premium and /api/validate-key ──
  console.log("── API keys over HTTP ──");
  const keyRes = await fetch(`${BASE}/api/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "pro@smoke.dev", token: verifyBody.token, action: "create" }),
  });
  const keyBody = await keyRes.json();
  ok(keyRes.status === 200 && keyBody.key?.startsWith("kl_"), "POST /api/keys create → key");

  const val = await fetch(`${BASE}/api/validate-key`, { headers: { "x-api-key": keyBody.key } });
  const valBody = await val.json();
  ok(val.status === 200 && valBody.tier === "pro" && !("email" in valBody), "validate-key → pro, no email");

  const premViaKey = await fetch(`${BASE}/api/premium?article=${encodeURIComponent(art)}`, {
    headers: { "x-api-key": keyBody.key },
  });
  ok(premViaKey.status === 200, "premium via x-api-key header → 200");
} catch (err) {
  fail++;
  console.error("  ❌ unexpected error:", err);
  console.error("server log tail:\n" + serverLog.slice(-2000));
} finally {
  child.kill();
  await new Promise((res) => setTimeout(res, 500));
  for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) {
    try { if (existsSync(f)) rmSync(f); } catch { /* file may be briefly locked on Windows */ }
  }
}

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
if (fail > 0) console.error("server log tail:\n" + serverLog.slice(-3000));
process.exit(fail === 0 ? 0 : 1);
