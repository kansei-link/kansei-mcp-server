#!/usr/bin/env node
/**
 * S2a E2E スモーク — 同意チェーン・仮名ID・イベント取り込み・WAS=1
 *
 * 検証（TELEMETRY-CONTRACTS rev1 / Codex必須条件）:
 *   1. 同意優先順位: DNT/明示OFF > 明示ON > consent.json > デフォルトOFF
 *   2. installation_id: UUID・generated_at起点・reset動作
 *   3. デフォルト（Local Mode）でemitEventが送信しない
 *   4. サーバー取り込み: 正常受理・未知フィールド拒否・重複dedup・窓外拒否・
 *      未知サービス破棄・failed_step自由記述拒否
 *   5. 検索+outcomeの同一installationで WAS=1
 *
 * ローカル完結（一時DB・一時KANSEI_HOME・ランダムポート）。本番へは何も送らない。
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const tmpHome = mkdtempSync(join(tmpdir(), "kansei-e2e-home-"));
const tmpDb = join(mkdtempSync(join(tmpdir(), "kansei-e2e-db-")), "test.db");
process.env.KANSEI_HOOK_DIR = tmpHome; // consent/installation live under this

// ---- 1. consent priority chain ----
const consent = await import("../dist/usage/consent.js");
const { transmissionAllowed, writeConsent } = consent;
delete process.env.DO_NOT_TRACK;
assert.equal(transmissionAllowed(undefined).allowed, false, "default must be OFF");
writeConsent(true);
assert.equal(transmissionAllowed(undefined).allowed, true, "consent.json enables");
assert.equal(transmissionAllowed("off").allowed, false, "explicit off beats consent");
writeConsent(false);
assert.equal(transmissionAllowed("on").allowed, true, "explicit on beats disabled consent");
process.env.DO_NOT_TRACK = "1";
assert.equal(transmissionAllowed("on").allowed, false, "DNT beats everything");
delete process.env.DO_NOT_TRACK;
console.log("  [PASS] 1. consent priority chain (DNT > env off > env on > consent.json > default OFF)");

// ---- 2. installation id ----
const inst = await import("../dist/usage/installation.js");
const a = inst.getInstallation();
assert.match(a.installation_id, /^[0-9a-f-]{36}$/);
assert.equal(inst.getInstallation().installation_id, a.installation_id, "stable across reads");
const b = inst.resetInstallation();
assert.notEqual(b.installation_id, a.installation_id, "reset generates new id");
console.log("  [PASS] 2. installation id: uuid, stable, resettable");

// ---- 3. Local Mode = zero transmission ----
writeConsent(false);
const telemetry = await import("../dist/usage/telemetry.js");
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => { fetchCalls++; return realFetch(...args); };
await telemetry.emitEvent("mcp_search", { result_count: 3, latency_ms: 5 });
assert.equal(fetchCalls, 0, "Local Mode must not transmit");
globalThis.fetch = realFetch;
console.log("  [PASS] 3. Local Mode: emitEvent sends nothing");

// ---- 4+5. server ingestion + WAS ----
const PORT = 4700 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ["dist/http-server.js"], {
  env: { ...process.env, KANSEI_DB_PATH: tmpDb, PORT: String(PORT), CRAWLER_SECRET: "e2e-secret", KANSEI_HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverErr = "";
server.stderr.on("data", (d) => { serverErr += d; });
const base = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`${base}/health`); if (r.ok) { up = true; break; } } catch { /* boot */ }
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(up, `server did not boot: ${serverErr.slice(0, 300)}`);

const installId = randomUUID();
const post = (events) => fetch(`${base}/api/v1/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ contract_version: "1.0", installation_id: installId, catalog_version: "e2e", sent_at: new Date().toISOString(), events }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const now = () => new Date().toISOString();
const searchEvt = { event_id: randomUUID(), type: "mcp_search", occurred_at: now(), result_count: 5, latency_ms: 42 };
const outcomeEvt = { event_id: randomUUID(), type: "outcome_reported", occurred_at: now(), service_id: "freee", success: true, tool_name: "create_invoice", model_family: "claude", is_retry: false };

let r = await post([searchEvt, outcomeEvt]);
assert.equal(r.status, 200);
assert.equal(r.body.accepted, 2, `accept both: ${JSON.stringify(r.body)}`);

r = await post([searchEvt]); // duplicate event_id
assert.equal(r.body.duplicates, 1, "dedup by event_id");

r = await post([{ ...searchEvt, event_id: randomUUID(), evil_field: "x" }]);
assert.equal(r.body.rejected, 1, "unknown field rejected (strict schema)");

r = await post([{ event_id: randomUUID(), type: "outcome_reported", occurred_at: now(), service_id: "totally-unknown-svc-xyz", success: true }]);
assert.equal(r.body.unknown_service, 1, "unknown service dropped");

r = await post([{ ...searchEvt, event_id: randomUUID(), occurred_at: "2020-01-01T00:00:00Z" }]);
assert.equal(r.body.rejected, 1, "outside ±48h window rejected");

r = await post([{ event_id: randomUUID(), type: "outcome_reported", occurred_at: now(), service_id: "freee", success: false, failed_step: "the auth broke here" }]);
assert.equal(r.body.rejected, 1, "free-text failed_step rejected");

console.log("  [PASS] 4. ingestion defenses: strict schema / dedup / window / service allowlist / failed_step");

const was = await fetch(`${base}/api/v1/metrics/was`, { headers: { authorization: "Bearer e2e-secret" } }).then((r) => r.json());
assert.equal(was.weekly_active_sensors, 1, `WAS must be 1: ${JSON.stringify(was)}`);
console.log("  [PASS] 5. Weekly Active Sensors = 1 (search + outcome, same installation)");

const noauth = await fetch(`${base}/api/v1/metrics/was`);
assert.notEqual(noauth.status, 200, "WAS endpoint requires admin secret");
console.log("  [PASS] 6. WAS endpoint is admin-gated");

server.kill();
rmSync(tmpHome, { recursive: true, force: true });
console.log("\nS2a telemetry E2E: ALL PASS");
process.exit(0);
