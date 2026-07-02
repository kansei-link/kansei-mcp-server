#!/usr/bin/env node
/**
 * Smoke test: tier enforcement (entitlements + auth + premium content).
 *
 * Pattern: loads the COMPILED dist/ modules against a temp KANSEI_DB_PATH
 * (same approach as test-bug-fixes.mjs) — run `npm run build` first.
 *
 *   node scripts/smoke-tier-enforcement.mjs
 */

import { rmSync, existsSync } from "fs";

// ─── Env must be set BEFORE importing dist modules ───
const TMP_DB = "./smoke-tier.db";
for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) {
  if (existsSync(f)) rmSync(f);
}
process.env.KANSEI_DB_PATH = TMP_DB;
process.env.ACCESS_TOKEN_SECRET = "smoke-secret";
process.env.KANSEI_AUTH_ECHO = "1";
delete process.env.RESEND_API_KEY;
delete process.env.KANSEI_API_KEY;

const { getDb, closeDb } = await import("../dist/db/connection.js");
const { initializeDb } = await import("../dist/db/schema.js");
const ent = await import("../dist/entitlements.js");
const auth = await import("../dist/auth.js");
const { accessTokenFor } = await import("../dist/stripe.js");

const db = getDb();
initializeDb(db);

// Minimal subscription fixtures
const insertSub = db.prepare(`
  INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status, current_period_end)
  VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))
`);
insertSub.run("cus_pro", "sub_pro", "pro@test.dev", "pro", "active");
insertSub.run("cus_team", "sub_team", "team@test.dev", "team", "active");
insertSub.run("cus_old", "sub_old", "old@test.dev", "pro", "canceled");

// ─── Tiny assertion harness ───
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
}
function makeReq({ body = {}, query = {}, headers = {} } = {}) {
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return { body, query, header: (name) => lower[String(name).toLowerCase()] };
}
function makeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

// ─── A. Tier resolution ───
console.log("\n── A. tierForEmail ──");
ok(ent.tierForEmail(db, "pro@test.dev") === "pro", "active pro → pro");
ok(ent.tierForEmail(db, "TEAM@test.dev ") === "team", "active team (case/space-insensitive) → team");
ok(ent.tierForEmail(db, "old@test.dev") === "free", "canceled sub → free");
ok(ent.tierForEmail(db, "nobody@test.dev") === "free", "unknown → free");

// ─── B. API keys ───
console.log("\n── B. API keys ──");
const issued = ent.issueApiKey(db, "pro@test.dev", "smoke");
ok(issued.key.startsWith("kl_") && issued.key.length === 43, `issued key format (${issued.key_prefix}…)`);
const resolved = ent.resolveApiKey(db, issued.key);
ok(resolved?.tier === "pro" && resolved?.email === "pro@test.dev", "resolve → pro tier");
ok(ent.resolveApiKey(db, "kl_" + "0".repeat(40)) === null, "bogus key → null");
ok(ent.resolveApiKey(db, "not-a-key") === null, "malformed key → null");
const teamKey = ent.issueApiKey(db, "team@test.dev");
ok(ent.resolveApiKey(db, teamKey.key)?.tier === "team", "team key → team tier");
const oldKey = ent.issueApiKey(db, "old@test.dev");
ok(ent.resolveApiKey(db, oldKey.key)?.tier === "free", "key of canceled sub → free (live downgrade)");
ok(ent.revokeApiKey(db, "pro@test.dev", issued.key_prefix) === true, "revoke by prefix");
ok(ent.resolveApiKey(db, issued.key) === null, "revoked key → null");

// ─── C. Lookup shaping ───
console.log("\n── C. shapeLookupResult ──");
const insightsFixture = {
  service_id: "svc", success_rate: 0.9,
  common_errors: [
    { type: "auth_error", count: 5, known_workarounds: [{ fix: "rotate token", reported_count: 3, verification: "verified" }] },
    { type: "timeout", count: 2 },
  ],
};
{
  const { result, upgrade } = ent.shapeLookupResult("insights", insightsFixture, "free");
  ok(!JSON.stringify(result).includes("rotate token"), "insights/free: workaround text stripped");
  ok(result.common_errors[0].workarounds_available === 1, "insights/free: workarounds_available count kept");
  ok(result.common_errors[0].count === 5 && result.success_rate === 0.9, "insights/free: stats stay free");
  ok(upgrade?.required_plan === "pro", "insights/free: upgrade note → pro");
  const proShape = ent.shapeLookupResult("insights", insightsFixture, "pro");
  ok(JSON.stringify(proShape.result).includes("rotate token") && proShape.upgrade === null, "insights/pro: untouched");
}
const recipeFixture = [
  { recipe_id: "r1", goal: "g", steps: [], gotchas: ["watch the rate limit", "auth expires"] },
  { recipe_id: "r2", goal: "g2", steps: [], gotchas: [] },
];
{
  const { result, upgrade } = ent.shapeLookupResult("recipe", recipeFixture, "free");
  ok(!JSON.stringify(result).includes("rate limit"), "recipe/free: gotchas stripped");
  ok(result[0].gotchas_locked?.count === 2, "recipe/free: gotchas_locked count");
  ok(Array.isArray(result[1].gotchas), "recipe/free: empty gotchas untouched");
  ok(upgrade?.required_plan === "pro", "recipe/free: upgrade note → pro");
  ok(ent.shapeLookupResult("recipe", recipeFixture, "team").upgrade === null, "recipe/team: untouched");
}
const voicesFixture = {
  service_id: "svc", service_name: "Svc", total_responses: 2,
  responses: [
    { agent_type: "claude", agent_id: "agent-123", question_id: "q", response_choice: "yes", response_text: "x".repeat(200), created_at: "2026-01-01" },
    { agent_type: "gpt", agent_id: "agent-456", question_id: "q2", response_text: "short", created_at: "2026-01-02" },
  ],
  choice_distribution: { q: { choices: [] } },
  insight: "i",
};
{
  const free = ent.shapeLookupResult("voices", voicesFixture, "free");
  ok(free.result.responses === undefined, "voices/free: raw responses removed");
  ok(free.result.sample_responses.length === 2 && free.result.sample_responses[0].excerpt.length === 141, "voices/free: truncated excerpts");
  ok(free.result.choice_distribution, "voices/free: aggregates kept");
  ok(free.upgrade?.required_plan === "pro", "voices/free: upgrade note → pro");
  const pro = ent.shapeLookupResult("voices", voicesFixture, "pro");
  ok(pro.result.responses.length === 2 && pro.result.responses[0].agent_id === undefined, "voices/pro: texts yes, agent_id no");
  ok(pro.result.responses[0].response_text.length === 200, "voices/pro: full text");
  ok(pro.upgrade?.required_plan === "team", "voices/pro: raw-data upsell → team");
  const team = ent.shapeLookupResult("voices", voicesFixture, "team");
  ok(team.result.responses[0].agent_id === "agent-123" && team.upgrade === null, "voices/team: raw rows");
}
const historyFixture = {
  service: { id: "svc" }, period: "30d", snapshot_count: 12,
  trends: { success_rate: { direction: "improving" }, latency: { direction: "stable" }, agent_adoption: { direction: "growing" } },
  incidents: [{ date: "2026-01-01" }], adoption_curve: [{}], top_workarounds: [{ workaround: "secret fix" }],
  competitive_comparison: { x: 1 }, consulting_highlights: ["h"],
};
{
  const pro = ent.shapeLookupResult("history", historyFixture, "pro");
  ok(!JSON.stringify(pro.result).includes("secret fix"), "history/pro: series+workarounds stripped");
  ok(pro.result.trend_summary.success_rate === "improving" && pro.result.snapshot_count === 12, "history/pro: summary kept");
  ok(pro.upgrade?.required_plan === "team", "history/pro: upgrade note → team");
  const team = ent.shapeLookupResult("history", historyFixture, "team");
  ok(team.result.incidents && team.upgrade === null, "history/team: full report");
}
{
  const err = { error: "service_not_found" };
  const shaped = ent.shapeLookupResult("history", err, "free");
  ok(shaped.result === err && shaped.upgrade === null, "error objects pass through unshaped");
  const tips = ent.shapeLookupResult("tips", { auth: "everything" }, "free");
  ok(tips.upgrade === null, "tips stay fully free");
}

// ─── D. Magic-link flow ───
console.log("\n── D. magic-link ──");
let debugLink;
{
  const res = makeRes();
  await auth.handleAuthRequestLink(makeReq({ body: { email: "pro@test.dev" } }), res);
  debugLink = res.body?.debug_link;
  ok(res.body?.ok === true && typeof debugLink === "string", "request-link (subscriber) → ok + echo link");
}
{
  const res = makeRes();
  await auth.handleAuthRequestLink(makeReq({ body: { email: "nobody@test.dev" } }), res);
  ok(res.body?.ok === true && res.body?.debug_link === undefined, "request-link (non-customer) → identical ok, no link");
}
{
  const code = new URL(debugLink).searchParams.get("code");
  const res = makeRes();
  auth.handleAuthVerify(makeReq({ body: { code } }), res);
  ok(res.statusCode === 200 && res.body?.email === "pro@test.dev", "verify → email");
  ok(res.body?.token === accessTokenFor("pro@test.dev"), "verify → canonical access token");
  ok(res.body?.access?.tier === "pro", "verify → access payload");
  const replay = makeRes();
  auth.handleAuthVerify(makeReq({ body: { code } }), replay);
  ok(replay.statusCode === 400, "verify replay → 400 (single-use)");
  const bogus = makeRes();
  auth.handleAuthVerify(makeReq({ body: { code: "f".repeat(48) } }), bogus);
  ok(bogus.statusCode === 400, "verify bogus code → 400");
}

// ─── E. /api/keys handler ───
console.log("\n── E. /api/keys handler ──");
const proToken = accessTokenFor("pro@test.dev");
let handlerKey;
{
  const res = makeRes();
  auth.handleApiKeys(makeReq({ body: { email: "pro@test.dev", token: "wrong", action: "create" } }), res);
  ok(res.statusCode === 401, "create with bad token → 401");
}
{
  const res = makeRes();
  auth.handleApiKeys(makeReq({ body: { email: "pro@test.dev", token: proToken, action: "create", label: "smoke2" } }), res);
  handlerKey = res.body?.key;
  ok(res.statusCode === 200 && handlerKey?.startsWith("kl_"), "create → plaintext key once");
}
{
  const res = makeRes();
  auth.handleApiKeys(makeReq({ body: { email: "old@test.dev", token: accessTokenFor("old@test.dev"), action: "create" } }), res);
  ok(res.statusCode === 403, "create without active sub → 403");
}
{
  const res = makeRes();
  auth.handleApiKeys(makeReq({ body: { email: "pro@test.dev", token: proToken, action: "list" } }), res);
  ok(res.statusCode === 200 && res.body.keys.length >= 1 && res.body.tier === "pro", "list → keys + tier");
}

// ─── F. validate-key ───
console.log("\n── F. /api/validate-key ──");
{
  const res = makeRes();
  auth.handleValidateKey(makeReq({ headers: { "x-api-key": handlerKey } }), res);
  ok(res.statusCode === 200 && res.body.tier === "pro" && res.body.active === true, "valid key → tier, no email leak");
  ok(res.body.email === undefined, "response carries no email");
  const bad = makeRes();
  auth.handleValidateKey(makeReq({ headers: { "x-api-key": "kl_" + "1".repeat(40) } }), bad);
  ok(bad.statusCode === 401 && bad.body.tier === "free", "invalid key → 401/free");
}

// ─── G. Premium content ───
console.log("\n── G. /api/premium ──");
{
  const up = makeRes();
  auth.handlePremiumUpload(
    makeReq({ body: { sections: [{ article_id: "insights/test-article", tier: "pro", lang: "ja", html: "<p>SECRET-PREMIUM</p>" }] } }),
    up
  );
  ok(up.body?.ok === true && up.body.upserted === 1, "admin upload → upserted");

  const noAuth = makeRes();
  auth.handlePremiumContent(makeReq({ query: { article: "insights/test-article" } }), noAuth);
  ok(noAuth.statusCode === 401, "no credentials → 401");

  const freeUser = makeRes();
  auth.handlePremiumContent(
    makeReq({ query: { article: "insights/test-article", email: "old@test.dev", token: accessTokenFor("old@test.dev") } }),
    freeUser
  );
  ok(freeUser.statusCode === 403, "valid token but free tier → 403");

  const proUser = makeRes();
  auth.handlePremiumContent(
    makeReq({ query: { article: "insights/test-article", email: "pro@test.dev", token: proToken } }),
    proUser
  );
  ok(proUser.statusCode === 200 && proUser.body.html.includes("SECRET-PREMIUM"), "pro email+token → 200 html");

  const viaKey = makeRes();
  auth.handlePremiumContent(
    makeReq({ query: { article: "insights/test-article" }, headers: { "x-api-key": teamKey.key } }),
    viaKey
  );
  ok(viaKey.statusCode === 200, "team API key → 200");

  const unknown = makeRes();
  auth.handlePremiumContent(makeReq({ query: { article: "insights/does-not-exist" }, headers: { "x-api-key": teamKey.key } }), unknown);
  ok(unknown.statusCode === 404, "unknown article → 404");

  const badId = makeRes();
  auth.handlePremiumContent(makeReq({ query: { article: "../../etc/passwd " } }), badId);
  ok(badId.statusCode === 400, "malformed article id → 400");
}

// ─── H. stdio tier resolver (offline behavior) ───
console.log("\n── H. stdio tier resolver ──");
{
  ent._resetStdioTierCache();
  const r1 = ent.makeStdioTierResolver();
  ok((await r1()) === "free", "no KANSEI_API_KEY → free");
  process.env.KANSEI_API_KEY = "kl_" + "2".repeat(40);
  process.env.KANSEI_API_BASE = "http://127.0.0.1:9"; // unreachable
  ent._resetStdioTierCache();
  const r2 = ent.makeStdioTierResolver();
  ok((await r2()) === "free", "key set but endpoint unreachable, no cache → free (fail closed)");
  delete process.env.KANSEI_API_KEY;
  delete process.env.KANSEI_API_BASE;
}

// ─── Done ───
closeDb();
for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) {
  if (existsSync(f)) rmSync(f);
}
console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
process.exit(fail === 0 ? 0 : 1);
