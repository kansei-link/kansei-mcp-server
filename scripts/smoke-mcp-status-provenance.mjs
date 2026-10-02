/**
 * Regression guard for the 2026-10-02 mcp_status incident (marker M-002).
 *
 * What went wrong: one column, mcp_status, carried two meanings — WHO provides
 * the MCP server (official / third_party / community: the provider's claim,
 * written by the seed / registry / operators) and WHETHER it is alive
 * (verified = handshake, dead = gone: only an observation may say this). The
 * writers broke each other: the seed erased the probe's death notice on every
 * start, the probe overwrote the provider's classification with `official`,
 * and vendor / propose writes inherited the probe's value. Separately, the
 * 2026-09-20 freshness backfill counted the probe's own death notice
 * ('deprecated') as "an upstream answered".
 *
 * The fix: liveness lives in mcp_liveness / mcp_liveness_checked_at /
 * mcp_liveness_endpoint, written only by the probe and the watchdog; every
 * outward path goes through utils/mcp-status.ts displayMcpStatus().
 *
 * What this asserts (FAKE ids for inserted rows; seed rows are picked by shape,
 * never a sealed marker's id):
 *   (a) after the probe writes unreachable, running the seed never brings
 *       `verified` back (probe on the same endpoint, and the real probe)
 *   (b) the seed's `official` stays `official`; its liveness is `unknown`
 *   (c) after a handshake, the seed changing mcp_endpoint → `unverified`
 *   (d) a vendor / proposal that changes the endpoint NULLs the liveness columns
 *   (e) lookup default (tips), compact search, resources and the services
 *       listing over HTTP (/api/dashboard/rankings) never show a dead endpoint
 *       as `verified`; neither does audit_cost's alt_mcp_status
 *   (f) TZ = UTC / Asia/Tokyo / America/Los_Angeles: a probe just now →
 *       `verified`; 31 days ago → `unverified` (and the 30-day edge either side)
 *   (g) an official row like agile-works stays `official` on every path
 *   plus: the probe writes only the three liveness columns; the death-notice
 *   backfill correction (upstream_backfill_death_notices_v1) still holds.
 *
 * Usage: npm run build && node scripts/smoke-mcp-status-provenance.mjs
 */
import Database from "better-sqlite3";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const DAY = 86400000;

// A local MCP endpoint: /ok answers initialize, /gone is 404.
async function startMock() {
  const srv = createHttpServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "smoke", version: "0" } } }));
      } else if (req.url === "/gone") { res.writeHead(404); res.end(); }
      else { res.writeHead(500); res.end(); }
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// (f) child mode: run under a given TZ, print the verdicts as JSON
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv.includes("--tz-child")) {
  const { initializeDb } = await import("../dist/db/schema.js");
  const { displayMcpStatus } = await import("../dist/utils/mcp-status.js");
  const { runHealthProbe } = await import("../dist/crawler/health-probe.js");
  const { srv, base } = await startMock();
  const db = new Database(":memory:");
  initializeDb(db);
  const ep = `${base}/ok`;
  db.prepare("INSERT INTO services (id, name, mcp_endpoint, mcp_status, trust_score) VALUES ('fake-tz-one', 'Fake TZ One', ?, 'verified', 1000)").run(ep);
  const row = () => db.prepare("SELECT * FROM services WHERE id = 'fake-tz-one'").get();
  const show = () => displayMcpStatus(row()).mcp_status;
  const out = { offset_min: new Date(2026, 0, 15).getTimezoneOffset() };
  const origErr = console.error; console.error = () => {};
  await runHealthProbe(db, { limit: 1 });
  console.error = origErr;
  out.probe_now = show();
  out.probe_now_stored_at = row().mcp_liveness_checked_at;
  const setAt = (sql) => db.prepare(`UPDATE services SET mcp_liveness_checked_at = ${sql} WHERE id = 'fake-tz-one'`).run();
  setAt("strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-31 days')"); out.iso_31d = show();
  setAt("datetime('now')"); out.sqlite_now = show();
  setAt("datetime('now', '-29 days', '-22 hours')"); out.sqlite_29d22h = show();
  setAt("datetime('now', '-30 days', '-2 hours')"); out.sqlite_30d2h = show();
  setAt("datetime('now', '-31 days')"); out.sqlite_31d = show();
  db.prepare("UPDATE services SET mcp_liveness_checked_at = ? WHERE id = 'fake-tz-one'").run(new Date(Date.now() - 31 * DAY).toISOString()); out.js_31d = show();
  srv.close();
  console.log(JSON.stringify(out));
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
let failures = 0;
const expect = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures++;
};
const DIR = mkdtempSync(join(tmpdir(), "kansei-smoke-mcp-status-"));
const open = [];
let mock = null;
let http = null;
let client = null;

try {
  // ── the death-notice backfill correction (kept from f4ec402) ──
  const { initializeDb } = await import("../dist/db/schema.js");
  {
    const legacy = new Database(join(DIR, "legacy.db")); open.push(legacy);
    legacy.exec(`
      CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT NOT NULL, namespace TEXT, description TEXT, category TEXT, tags TEXT, mcp_endpoint TEXT, mcp_status TEXT DEFAULT 'official', api_url TEXT, api_auth_method TEXT, trust_score REAL DEFAULT 0.5, axr_score INTEGER, axr_grade TEXT, axr_dims TEXT, axr_facade INTEGER DEFAULT 0, usage_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE service_changelog (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT NOT NULL REFERENCES services(id), change_date TEXT NOT NULL, change_type TEXT NOT NULL, summary TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT (datetime('now')));
      INSERT INTO services (id, name, mcp_endpoint, mcp_status) VALUES
        ('fake-dead-one', 'Fake Dead One', 'https://fake-dead-one.invalid/mcp', 'verified'),
        ('fake-alive-two', 'Fake Alive Two', 'https://fake-alive-two.invalid/mcp', 'official'),
        ('fake-mixed-three', 'Fake Mixed Three', 'https://fake-mixed-three.invalid/mcp', 'official'),
        ('fake-silent-four', 'Fake Silent Four', 'https://fake-silent-four.invalid/mcp', 'official');
      INSERT INTO service_changelog (service_id, change_date, change_type, summary) VALUES
        ('fake-dead-one', '2026-09-01', 'deprecated', 'Endpoint gone (POST initialize 404) — archived by weekly health probe'),
        ('fake-alive-two', '2026-09-05', 'feature', 'upstream shipped a feature'),
        ('fake-mixed-three', '2026-09-03', 'deprecated', 'Repository archived on GitHub'),
        ('fake-mixed-three', '2026-08-20', 'api_change', 'upstream changed an endpoint');
    `);
    initializeDb(legacy);
    const up = (id) => legacy.prepare("SELECT upstream_checked_at AS a, upstream_check_source AS s FROM services WHERE id = ?").get(id);
    expect("(backfill) a row whose only changelog is a death notice has no upstream check date", up("fake-dead-one").a === null && up("fake-dead-one").s === null, JSON.stringify(up("fake-dead-one")));
    expect("(backfill) a row with a real upstream change keeps its backfilled date", up("fake-alive-two").a === "2026-09-05" && up("fake-alive-two").s === "changelog_backfill");
    expect("(backfill) death notice + real change → the real change's date only", up("fake-mixed-three").a === "2026-08-20");
    expect("(backfill) no changelog → unchecked", up("fake-silent-four").a === null);
    const audit = legacy.prepare("SELECT metric, value FROM migration_audit WHERE migration_id = 'upstream_backfill_death_notices_v1'").all();
    expect("(backfill) versioned and audited", audit.some((r) => r.metric === "reverted_to_unverified"), JSON.stringify(audit));
    initializeDb(legacy);
    expect("(backfill) a second start is a no-op", up("fake-dead-one").a === null && legacy.prepare("SELECT COUNT(*) c FROM migration_audit WHERE migration_id = 'upstream_backfill_death_notices_v1'").get().c === audit.length);
    const cols = legacy.prepare("SELECT name FROM pragma_table_info('services') WHERE name LIKE 'mcp_liveness%' OR name LIKE 'mcp_status_%'").all().map((r) => r.name).sort();
    expect("(schema) an old DB gains exactly mcp_liveness / _checked_at / _endpoint (no mcp_status_source)", JSON.stringify(cols) === JSON.stringify(["mcp_liveness", "mcp_liveness_checked_at", "mcp_liveness_endpoint"]), JSON.stringify(cols));

    const wrong = new Database(join(DIR, "wrong.db")); open.push(wrong);
    wrong.exec(`
      CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT NOT NULL, namespace TEXT, description TEXT, category TEXT, tags TEXT, mcp_endpoint TEXT, mcp_status TEXT DEFAULT 'official', api_url TEXT, api_auth_method TEXT, trust_score REAL DEFAULT 0.5, axr_score INTEGER, axr_grade TEXT, axr_dims TEXT, axr_facade INTEGER DEFAULT 0, usage_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), archived INTEGER DEFAULT 0, github_stars INTEGER, github_pushed_at TEXT, npm_version TEXT, last_refreshed_at TEXT, upstream_checked_at TEXT, upstream_check_source TEXT, last_refresh_attempt_at TEXT, last_refresh_status TEXT);
      CREATE TABLE service_changelog (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT NOT NULL REFERENCES services(id), change_date TEXT NOT NULL, change_type TEXT NOT NULL, summary TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT (datetime('now')));
      INSERT INTO services (id, name, mcp_status, upstream_checked_at, upstream_check_source, last_refreshed_at) VALUES
        ('fake-dead-one', 'Fake Dead One', 'verified', '2026-09-01', 'changelog_backfill', '2026-09-01'),
        ('fake-github-five', 'Fake GitHub Five', 'official', '2026-09-10', 'github', '2026-09-10'),
        ('fake-alive-two', 'Fake Alive Two', 'official', '2026-09-05', 'changelog_backfill', '2026-09-05');
      INSERT INTO service_changelog (service_id, change_date, change_type, summary) VALUES
        ('fake-dead-one', '2026-09-01', 'deprecated', 'Endpoint gone'),
        ('fake-github-five', '2026-09-01', 'deprecated', 'Repository archived on GitHub'),
        ('fake-alive-two', '2026-09-05', 'feature', 'x');
    `);
    initializeDb(wrong);
    const upw = (id) => wrong.prepare("SELECT upstream_checked_at AS a, upstream_check_source AS s, last_refreshed_at AS l FROM services WHERE id = ?").get(id);
    expect("(backfill) production shape: wrongly backfilled death notice → unverified (legacy column too)", upw("fake-dead-one").a === null && upw("fake-dead-one").l === null);
    expect("(backfill) production shape: a check github recorded itself is untouched", upw("fake-github-five").a === "2026-09-10" && upw("fake-github-five").s === "github");
    expect("(backfill) production shape: a backfill backed by a real change stays", upw("fake-alive-two").a === "2026-09-05");
  }

  // ── pure display rules ──
  const { displayMcpStatus, hasFreshHandshake, parseUtc, MCP_STATUS_LEGEND } = await import("../dist/utils/mcp-status.js");
  {
    const E = "https://fake-display.invalid/mcp";
    const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 19) + "Z";
    const row = (status, liveness, daysAgo, extra = {}) => ({ mcp_status: status, mcp_endpoint: E, archived: 0, mcp_liveness: liveness, mcp_liveness_checked_at: liveness ? at(daysAgo) : null, mcp_liveness_endpoint: liveness ? E : null, ...extra });
    const d = (r) => displayMcpStatus(r);
    expect("(rule) stored verified + handshake 1 day ago on this endpoint → verified", d(row("verified", "handshake", 1)).mcp_status === "verified");
    expect("(rule) stored verified + handshake 31 days ago → unverified", d(row("verified", "handshake", 31)).mcp_status === "unverified");
    expect("(rule) stored verified + handshake on ANOTHER endpoint → unverified (endpoint_matches false)", d(row("verified", "handshake", 1, { mcp_liveness_endpoint: E + "/old" })).mcp_status === "unverified" && d(row("verified", "handshake", 1, { mcp_liveness_endpoint: E + "/old" })).mcp_liveness.endpoint_matches === false);
    expect("(rule) endpoint match is exact (trailing slash differs → no match)", d(row("verified", "handshake", 1, { mcp_liveness_endpoint: E + "/" })).mcp_status === "unverified");
    expect("(rule) stored verified + reachable (no handshake) → unverified", d(row("verified", "reachable", 1)).mcp_status === "unverified");
    expect("(rule) stored verified, never probed (baked into the seed) → unverified", d(row("verified", null, 0)).mcp_status === "unverified" && d(row("verified", null, 0)).mcp_status_basis === "no_fresh_handshake");
    expect("(rule) handshake dated in the future → unverified", d(row("verified", "handshake", -2)).mcp_status === "unverified");
    expect("(rule) malformed checked_at → unverified", d({ ...row("verified", "handshake", 1), mcp_liveness_checked_at: "yesterday" }).mcp_status === "unverified");
    for (const s of ["dead", "unreachable"]) expect(`(rule) stored '${s}' → unverified even with a fresh handshake`, d(row(s, "handshake", 1)).mcp_status === "unverified");
    expect("(rule) archived → unverified", d(row("official", "handshake", 1, { archived: 1 })).mcp_status === "unverified" && d(row("official", null, 0, { archived: 1 })).mcp_status_basis === "archived");
    expect("(rule) official + unreachable on the same endpoint → unverified", d(row("official", "unreachable", 1)).mcp_status === "unverified" && d(row("official", "unreachable", 1)).mcp_status_basis === "unreachable");
    expect("(rule) official + unreachable on ANOTHER endpoint → official (that observation says nothing about this one)", d(row("official", "unreachable", 1, { mcp_liveness_endpoint: E + "/old" })).mcp_status === "official");
    for (const s of ["official", "third_party", "community", "api_only", "unknown", "none"]) {
      const r = d(row(s, null, 0));
      expect(`(rule) provider claim '${s}' is shown as stored, liveness unknown / null`, r.mcp_status === s && r.mcp_status_basis === "provider_claim" && r.mcp_liveness.state === "unknown" && r.mcp_liveness.checked_at === null && r.mcp_liveness.endpoint_matches === false);
    }
    expect("(rule) official + a stale probe stays official (a provider claim does not age)", d(row("official", "reachable", 400)).mcp_status === "official");
    expect("(rule) NULL status = column default official", d({ mcp_status: null, mcp_endpoint: E }).mcp_status === "official");
    const lv = d(row("official", "handshake", 1)).mcp_liveness;
    expect("(rule) mcp_liveness is {state, checked_at, endpoint_matches}", JSON.stringify(Object.keys(lv).sort()) === JSON.stringify(["checked_at", "endpoint_matches", "state"]) && lv.state === "handshake" && lv.endpoint_matches === true);
    expect("(rule) 'YYYY-MM-DD HH:MM:SS' is read as UTC", parseUtc("2026-10-02 00:00:00") === Date.UTC(2026, 9, 2) && parseUtc("2026-10-02T00:00:00") === Date.UTC(2026, 9, 2) && parseUtc("2026-10-02T00:00:00Z") === Date.UTC(2026, 9, 2));
    expect("(rule) hasFreshHandshake mirrors the verified rule", hasFreshHandshake(row("verified", "handshake", 1)) && !hasFreshHandshake(row("verified", "handshake", 31)));
    expect("(legend) official is the provider's claim; liveness is mcp_liveness", /provider/.test(MCP_STATUS_LEGEND.mcp_status) && /mcp_liveness/.test(MCP_STATUS_LEGEND.mcp_status) && /endpoint_matches/.test(MCP_STATUS_LEGEND.mcp_liveness));
  }

  // ── the real server, the real seed, the real probe ──
  process.env.KANSEI_DB_PATH = join(DIR, "main.db");
  const { createServer } = await import("../dist/server.js");
  const { getDb } = await import("../dist/db/connection.js");
  const { seedDatabase } = await import("../dist/db/seed.js");
  const { runHealthProbe } = await import("../dist/crawler/health-probe.js");
  const { vendorClaimWriter } = await import("../dist/crawler/sources/vendor-submissions-step.js");
  const { proposeUpdate, reviewUpdate } = await import("../dist/tools/propose-update.js");
  const { getServiceDetail } = await import("../dist/tools/get-service-detail.js");
  const { auditCost } = await import("../dist/tools/audit-cost.js");
  const { serviceResourceData, mcpStatusSummaryData } = await import("../dist/resources.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

  const quiet = async (fn) => { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };
  const server = await quiet(() => createServer({ exposeAdminTools: false }));
  const db = getDb();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: "smoke-mcp-status", version: "0" });
  await client.connect(ct);
  const parse = (res) => { const t = res.content[0].text; return JSON.parse(t.slice(t.indexOf("{"))); };
  const findKey = (o, k) => { if (!o || typeof o !== "object") return undefined; if (k in o) return o[k]; for (const v of Object.values(o)) { const f = findKey(v, k); if (f !== undefined) return f; } return undefined; };
  const tips = async (id) => findKey(parse(await client.callTool({ name: "lookup", arguments: { service_id: id } })), "connection");
  const compact = async (intent) => findKey(parse(await client.callTool({ name: "search_services", arguments: { intent, compact: true, limit: 10 } })), "r");
  const resource = async (uri) => JSON.parse((await client.readResource({ uri })).contents[0].text);
  const svc = (id) => db.prepare("SELECT * FROM services WHERE id = ?").get(id);

  // seed rows picked by shape: stored 'verified' with an http endpoint, high grade
  const verifiedHttp = db.prepare(`
    SELECT id, name, mcp_endpoint FROM services
     WHERE mcp_status = 'verified' AND mcp_endpoint LIKE 'http%' AND mcp_endpoint NOT LIKE '%{%'
       AND COALESCE(archived, 0) = 0 AND axr_score IS NOT NULL
     ORDER BY axr_score DESC, id LIMIT 3`).all();
  const officialHttp = db.prepare(`
    SELECT id, name, mcp_endpoint FROM services
     WHERE mcp_status = 'official' AND mcp_endpoint LIKE 'http%' AND mcp_endpoint NOT LIKE '%{%'
       AND COALESCE(archived, 0) = 0 AND id <> 'agile-works'
     ORDER BY axr_score DESC, id LIMIT 1`).get();
  expect("(setup) the seed has stored-verified http rows and an official http row to play with", verifiedHttp.length === 3 && !!officialHttp);
  const [DEAD, PROBED_DEAD, HS] = verifiedHttp;
  const AW = svc("agile-works");
  expect("(setup) agile-works is in the seed as official", AW && AW.mcp_status === "official", JSON.stringify(AW && AW.mcp_status));

  // ── (b) / (g) the seed's official stays official, liveness unknown ──
  {
    const t = await tips("agile-works");
    expect("(b)(g) lookup default (tips): agile-works is official, liveness unknown, checked_at null", t.mcp_status === "official" && t.mcp_liveness.state === "unknown" && t.mcp_liveness.checked_at === null, JSON.stringify(t));
    const det = getServiceDetail(db, "agile-works");
    expect("(g) get_service_detail: agile-works is official", det.mcp_status === "official" && det.mcp_liveness.state === "unknown");
    const c = (await compact("AgileWorks")).find((r) => r.id === "agile-works");
    expect("(g) compact search: agile-works is official, live shown beside it", c && c.mcp === "official" && c.live && c.live.state === "unknown", JSON.stringify(c));
    const res = await resource("kansei://service/agile-works");
    expect("(g) resource kansei://service/agile-works: official", res.mcp_status === "official" && res.mcp_liveness.state === "unknown");
    const sum = await resource("kansei://mcp-status");
    expect("(g) resource kansei://mcp-status lists agile-works among official servers", sum.official_mcp_servers.some((s) => s.id === "agile-works"));
    // across the whole freshly seeded catalogue: every stored official / third_party / community ... is shown as stored
    const all = db.prepare("SELECT * FROM services").all();
    let changed = 0, verifiedShown = 0;
    for (const r of all) {
      const shown = displayMcpStatus(r).mcp_status;
      if (shown === "verified") verifiedShown++;
      if (!r.archived && !["verified", "dead", "unreachable"].includes(r.mcp_status ?? "official") && shown !== (r.mcp_status ?? "official")) changed++;
    }
    expect(`(b) fresh seed: every non-archived provider claim is shown unchanged (${all.length} rows), and nothing is shown verified before any probe`, changed === 0 && verifiedShown === 0, `changed=${changed} verifiedShown=${verifiedShown}`);
  }

  // ── (a) the probe's unreachable survives the seed ──
  {
    const before = svc(DEAD.id);
    // the probe's observation of the row's OWN endpoint (the statement the probe uses)
    db.prepare("UPDATE services SET mcp_liveness = 'unreachable', mcp_liveness_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), mcp_liveness_endpoint = mcp_endpoint WHERE id = ?").run(DEAD.id);
    await quiet(() => seedDatabase(db));
    const after = svc(DEAD.id);
    expect("(a) the seed writes its provider value back to mcp_status (stored 'verified') but leaves the liveness columns alone", after.mcp_status === before.mcp_status && after.mcp_liveness === "unreachable" && after.mcp_liveness_endpoint === after.mcp_endpoint);
    expect("(a) …and the display is NOT verified (unverified, basis unreachable)", displayMcpStatus(after).mcp_status === "unverified" && displayMcpStatus(after).mcp_status_basis === "unreachable");
  }

  // ── the real probe against local endpoints: writes only the three columns ──
  mock = await startMock();
  const deadUrl = "http://kansei-smoke-dead.invalid/mcp";
  const okUrl = `${mock.base}/ok`;
  const goneUrl = `${mock.base}/gone`;
  {
    db.prepare("UPDATE services SET trust_score = 1000, mcp_endpoint = ? WHERE id = ?").run(deadUrl, PROBED_DEAD.id);
    db.prepare("UPDATE services SET trust_score = 1000, mcp_endpoint = ? WHERE id = ?").run(okUrl, HS.id);
    db.prepare("UPDATE services SET trust_score = 1000, mcp_endpoint = ? WHERE id = ?").run(goneUrl, officialHttp.id);
    const statusBefore = Object.fromEntries([PROBED_DEAD.id, HS.id, officialHttp.id].map((id) => [id, svc(id).mcp_status]));
    await quiet(() => runHealthProbe(db, { limit: 3 }));
    const pd = svc(PROBED_DEAD.id), hs = svc(HS.id), gone = svc(officialHttp.id);
    expect("(probe) DNS failure → mcp_liveness 'unreachable' on that endpoint (err.cause is read)", pd.mcp_liveness === "unreachable" && pd.mcp_liveness_endpoint === deadUrl, JSON.stringify({ l: pd.mcp_liveness, e: pd.mcp_liveness_endpoint }));
    expect("(probe) handshake → mcp_liveness 'handshake', endpoint recorded verbatim, ISO UTC timestamp", hs.mcp_liveness === "handshake" && hs.mcp_liveness_endpoint === okUrl && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(hs.mcp_liveness_checked_at), JSON.stringify({ l: hs.mcp_liveness, at: hs.mcp_liveness_checked_at }));
    expect("(probe) 404 → archived + 'unreachable'", gone.archived === 1 && gone.mcp_liveness === "unreachable");
    expect("(probe) the probe never touches mcp_status (the provider's claim)", pd.mcp_status === statusBefore[PROBED_DEAD.id] && hs.mcp_status === statusBefore[HS.id] && gone.mcp_status === statusBefore[officialHttp.id] && gone.mcp_status === "official");
    expect("(probe) display: handshake on this endpoint → verified; DNS-dead → unverified; 404 official → unverified (archived)", displayMcpStatus(hs).mcp_status === "verified" && displayMcpStatus(pd).mcp_status === "unverified" && displayMcpStatus(gone).mcp_status === "unverified");
    expect("(c) lookup default (tips) shows the fresh handshake as verified", (await tips(HS.id)).mcp_status === "verified");

    await quiet(() => seedDatabase(db)); // the next start: the seed puts its own endpoints back
    const pd2 = svc(PROBED_DEAD.id), hs2 = svc(HS.id);
    expect("(a) real probe: after the seed restores the endpoint, the dead row is still not verified", pd2.mcp_endpoint !== deadUrl && displayMcpStatus(pd2).mcp_status === "unverified", JSON.stringify(displayMcpStatus(pd2)));
    expect("(c) after a handshake, the seed changing mcp_endpoint → unverified, endpoint_matches false", hs2.mcp_endpoint !== okUrl && hs2.mcp_liveness === "handshake" && displayMcpStatus(hs2).mcp_status === "unverified" && displayMcpStatus(hs2).mcp_liveness.endpoint_matches === false, JSON.stringify(displayMcpStatus(hs2)));
    expect("(c) …through lookup default (tips) as well", (await tips(HS.id)).mcp_status === "unverified");
    expect("(probe) the 404 row stays archived across the seed (MAX rule) and stays official in mcp_status", svc(officialHttp.id).archived === 1 && svc(officialHttp.id).mcp_status === "official");
  }

  // ── (d) other writers: vendor / propose ──
  {
    const liveCols = (id) => { const r = svc(id); return [r.mcp_liveness, r.mcp_liveness_checked_at, r.mcp_liveness_endpoint]; };
    // give HS a fresh handshake on its own (restored) endpoint, as the probe would
    db.prepare("UPDATE services SET mcp_liveness = 'handshake', mcp_liveness_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), mcp_liveness_endpoint = mcp_endpoint WHERE id = ?").run(HS.id);
    const ep = svc(HS.id).mcp_endpoint;
    const writer = vendorClaimWriter(db);
    writer.run("official", ep, HS.id);
    expect("(d) vendor: same endpoint → mcp_status written (official), liveness kept", svc(HS.id).mcp_status === "official" && liveCols(HS.id)[0] === "handshake");
    writer.run("official", "https://fake-vendor-new.invalid/mcp", HS.id);
    expect("(d) vendor: endpoint changed → the three liveness columns are NULL", liveCols(HS.id).every((v) => v === null), JSON.stringify(liveCols(HS.id)));
    const t = await tips(HS.id);
    expect("(d) …and the display says official with liveness unknown", t.mcp_status === "official" && t.mcp_liveness.state === "unknown");

    db.prepare("UPDATE services SET mcp_liveness = 'handshake', mcp_liveness_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), mcp_liveness_endpoint = mcp_endpoint WHERE id = ?").run(HS.id);
    const p1 = proposeUpdate(db, { service_id: HS.id, changes: { mcp_status: "third_party" }, reason: "smoke: provider says third party", change_type: "correction" });
    await quiet(() => reviewUpdate(db, { proposal_id: p1.proposal_id, action: "approve", reviewer: "smoke" }));
    expect("(d) propose: mcp_status only → the provider's claim changes, liveness kept", svc(HS.id).mcp_status === "third_party" && liveCols(HS.id)[0] === "handshake", JSON.stringify({ p1, s: svc(HS.id).mcp_status }));
    const p2 = proposeUpdate(db, { service_id: HS.id, changes: { mcp_endpoint: "https://fake-propose-new.invalid/mcp" }, reason: "smoke: endpoint moved", change_type: "correction" });
    await quiet(() => reviewUpdate(db, { proposal_id: p2.proposal_id, action: "approve", reviewer: "smoke" }));
    expect("(d) propose: endpoint changed → the three liveness columns are NULL", svc(HS.id).mcp_endpoint === "https://fake-propose-new.invalid/mcp" && liveCols(HS.id).every((v) => v === null), JSON.stringify(liveCols(HS.id)));
  }

  // ── (e) four outward paths (+ audit_cost) never show a dead endpoint as verified ──
  {
    const deadRow = svc(DEAD.id);
    expect("(e) setup: the dead row is stored 'verified' with 'unreachable' on its own endpoint", deadRow.mcp_status === "verified" && deadRow.mcp_liveness === "unreachable" && deadRow.mcp_liveness_endpoint === deadRow.mcp_endpoint);
    const t = await tips(DEAD.id);
    expect("(e) lookup default (tips): not verified, liveness unreachable beside it", t.mcp_status === "unverified" && t.mcp_liveness.state === "unreachable" && t.mcp_liveness.endpoint_matches === true, JSON.stringify(t));
    const cr = await compact(DEAD.name);
    const c = cr.find((r) => r.id === DEAD.id);
    expect("(e) compact search: the dead row is found and not verified", c && c.mcp === "unverified" && c.live.state === "unreachable", JSON.stringify(c ?? cr.map((r) => r.id)));
    expect("(e) compact search: no row shows verified without a fresh handshake on its endpoint", cr.every((r) => r.mcp !== "verified" || (r.live.state === "handshake" && r.live.endpoint_matches)));
    const full = parse(await client.callTool({ name: "search_services", arguments: { intent: DEAD.name, limit: 10 } }));
    expect("(e) full search: not verified, legend attached", full.results.find((r) => r.service_id === DEAD.id)?.mcp_status === "unverified" && !!full._meta.mcp_status_legend);
    const r1 = await resource(`kansei://service/${DEAD.id}`);
    expect("(e) resource kansei://service/{id}: not verified", r1.mcp_status === "unverified" && r1.mcp_liveness.state === "unreachable");
    const sum = await resource("kansei://mcp-status");
    const shownVerified = db.prepare("SELECT * FROM services").all().filter((r) => displayMcpStatus(r).mcp_status === "verified").length;
    const sumVerified = sum.summary.find((s) => s.status === "verified")?.count ?? 0;
    expect("(e) resource kansei://mcp-status counts by the DISPLAYED status (stored verified ≠ counted verified)", sumVerified === shownVerified && sum.summary.some((s) => s.status === "unverified"), JSON.stringify(sum.summary));
    expect("(e) resource kansei://mcp-status: the 404 official endpoint is not listed as an official server", !sum.official_mcp_servers.some((s) => s.id === officialHttp.id));
    expect("(e) serviceResourceData / mcpStatusSummaryData agree with the resource handlers", serviceResourceData(db, DEAD.id).mcp_status === "unverified" && JSON.stringify(mcpStatusSummaryData(db).summary) === JSON.stringify(sum.summary));

    // audit_cost: alt_mcp_status goes through the function too
    const cat = deadRow.category;
    db.prepare("INSERT INTO services (id, name, category, trust_score) VALUES ('fake-audit-current', 'Fake Audit Current', ?, 0.5)").run(cat);
    const ins = db.prepare("INSERT INTO outcomes (service_id, agent_id_hash, success, provenance, verification_status, task_type, model_name, created_at) VALUES (?, 'smoke', ?, 'kansei_measured', 'audited', 'smoke_task', 'smoke-model', datetime('now'))");
    for (let i = 0; i < 6; i++) { ins.run("fake-audit-current", 0); ins.run(DEAD.id, 1); }
    const audit = auditCost(db, "fake-audit-current", 30);
    const rec = (audit.recommendations ?? []).find((r) => r.recommended_service_id === DEAD.id);
    expect("(e) audit_cost: alt_mcp_status of the dead alternative is not verified (liveness beside it)", rec && rec.alt_mcp_status === "unverified" && rec.alt_mcp_liveness?.state === "unreachable", JSON.stringify(rec ?? audit).slice(0, 300));

    // /api/dashboard/rankings — the HTTP services listing (there is no /api/services route)
    const PORT = 3627;
    http = spawn(process.execPath, ["dist/http-server.js"], {
      env: { ...process.env, KANSEI_DB_PATH: join(DIR, "main.db"), PORT: String(PORT), KANSEI_HOST: "127.0.0.1", RESEND_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = ""; http.stdout.on("data", (d) => (log += d)); http.stderr.on("data", (d) => (log += d));
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { /* not yet */ } if (!up) await new Promise((r) => setTimeout(r, 500)); }
    expect("(e) http-server came up on the smoke DB", up, log.slice(-500));
    if (up) {
      const rows = [];
      let total = Infinity;
      for (let off = 0; off < total && off < 20000; off += 1000) {
        const j = await (await fetch(`http://127.0.0.1:${PORT}/api/dashboard/rankings?limit=1000&offset=${off}`)).json();
        if (!Array.isArray(j.services)) { expect("(e) rankings answered", false, JSON.stringify(j).slice(0, 200)); break; }
        total = j.total; rows.push(...j.services);
        if (off === 0) expect("(e) rankings carries the mcp_status legend", !!j.mcp_status_legend);
      }
      const d = rows.find((r) => r.id === DEAD.id);
      expect(`(e) /api/dashboard/rankings: the dead row is listed and not verified (${rows.length} rows)`, d && d.mcp_status === "unverified" && d.mcp_liveness.state === "unreachable", JSON.stringify(d));
      expect("(e) /api/dashboard/rankings: no row shows verified without a fresh handshake on its endpoint", rows.every((r) => r.mcp_status !== "verified" || (r.mcp_liveness.state === "handshake" && r.mcp_liveness.endpoint_matches)));
      expect("(e) /api/dashboard/rankings: raw liveness / archived columns never leave; every row has mcp_liveness", rows.every((r) => !("mcp_liveness_endpoint" in r) && !("mcp_liveness_checked_at" in r) && !("archived" in r) && typeof r.mcp_liveness === "object"));
      const aw = rows.find((r) => r.id === "agile-works");
      expect("(g) /api/dashboard/rankings: agile-works is official", aw && aw.mcp_status === "official", JSON.stringify(aw));
    }
  }

  // ── (f) time zones ──
  for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
    const r = spawnSync(process.execPath, [SELF, "--tz-child"], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
    let o = null; try { o = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* reported below */ }
    if (!o) { expect(`(f) TZ=${tz}: child ran`, false, (r.stderr || r.stdout).slice(-400)); continue; }
    const wantOffset = { UTC: 0, "Asia/Tokyo": -540, "America/Los_Angeles": 480 }[tz];
    expect(`(f) TZ=${tz}: the time zone is in effect (offset ${o.offset_min})`, o.offset_min === wantOffset);
    expect(`(f) TZ=${tz}: a probe just now → verified (stored ${o.probe_now_stored_at})`, o.probe_now === "verified");
    expect(`(f) TZ=${tz}: 31 days ago → unverified (ISO, SQLite datetime, JS toISOString)`, o.iso_31d === "unverified" && o.sqlite_31d === "unverified" && o.js_31d === "unverified");
    expect(`(f) TZ=${tz}: SQLite 'YYYY-MM-DD HH:MM:SS' read as UTC — now → verified, 29d22h → verified, 30d2h → unverified`, o.sqlite_now === "verified" && o.sqlite_29d22h === "verified" && o.sqlite_30d2h === "unverified", JSON.stringify(o));
  }
} catch (e) {
  failures++; console.error("ERROR ", (e && e.stack) || e);
} finally {
  try { await client?.close(); } catch { /* closed */ }
  if (http) { http.kill(); await new Promise((r) => setTimeout(r, 500)); }
  mock?.srv.close();
  for (const h of open) { try { h.close(); } catch { /* closed */ } }
  try { (await import("../dist/db/connection.js")).closeDb?.(); } catch { /* not opened */ }
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* windows may hold a handle briefly */ }
}

console.log(failures === 0 ? "\nmcp-status provenance smoke: ALL PASS" : `\nmcp-status provenance smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
