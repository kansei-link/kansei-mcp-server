/**
 * Regression guard for the 2026-10-02 mcp_status provenance incident (marker M-002).
 *
 * What went wrong: endpoints the weekly health probe had recorded as gone
 * (404 / 410 / DNS failure) were shown as `verified` in production, because
 *   (1) seedDatabase() overwrote mcp_status with the shipped seed value on every
 *       start, erasing the probe's result, and
 *   (2) the 2026-09-20 freshness migration counted a `deprecated` changelog row
 *       (the probe's own death notice) as "an upstream answered".
 *
 * What this asserts, on a fresh temporary DB with FAKE service ids only (never
 * the ids of a sealed marker):
 *   (a) a probe-sourced `unreachable` survives seedDatabase(); a seed-sourced
 *       row still takes the seed's value; a fresh insert is source 'seed'
 *   (b) a row whose only changelog is a death notice is unverified after the
 *       migration (and stays so on a second run); a row with a real upstream
 *       change keeps its date; the correction is recorded in migration_audit
 *   (c) display: a probe 31 days old → unverified; 29 days → verified;
 *       archived → unverified; unreachable → unverified; seed-sourced verified
 *       → unverified; categorical statuses pass through; checked_at is shown
 *   (d) the display legend disclaims the seed value
 *
 * Usage: node scripts/smoke-mcp-status-provenance.mjs   (after build)
 */
import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { initializeDb } from "../dist/db/schema.js";
import { seedDatabase } from "../dist/db/seed.js";
import { displayMcpStatus, MCP_STATUS_LEGEND, MCP_STATUS_PROBE_TTL_DAYS } from "../dist/utils/mcp-status.js";
import { getServiceDetail } from "../dist/tools/get-service-detail.js";
import { searchServices } from "../dist/tools/search-services.js";

const target = resolve("tmp-mcp-status-provenance-smoke.db");
for (const f of [target, resolve("tmp-mcp-status-legacy-smoke.db"), resolve("tmp-mcp-status-wrong-smoke.db")]) for (const suffix of ["", "-wal", "-shm"]) rmSync(f + suffix, { force: true });
let failures = 0;
const expect = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };
const open = [];
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

try {
  const db = new Database(target); open.push(db);
  initializeDb(db);

  // ── (b) the backfill correction, on rows that exist BEFORE the migration ──
  // Simulate a pre-2026-09-20 database: drop the provenance columns the way an
  // older deploy would lack them, then let initializeDb add + backfill them.
  const legacy = new Database(resolve("tmp-mcp-status-legacy-smoke.db")); open.push(legacy);
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
  initializeDb(legacy); // adds the provenance columns and runs both migrations
  const up = (id) => legacy.prepare("SELECT upstream_checked_at AS a, upstream_check_source AS s FROM services WHERE id = ?").get(id);
  expect("(b) a row whose only changelog is a death notice has no upstream check date after the migration", up("fake-dead-one").a === null && up("fake-dead-one").s === null, JSON.stringify(up("fake-dead-one")));
  expect("(b) a row with a real upstream change keeps its backfilled date", up("fake-alive-two").a === "2026-09-05" && up("fake-alive-two").s === "changelog_backfill", JSON.stringify(up("fake-alive-two")));
  expect("(b) a row with a death notice AND a real change keeps the date of the real change only", up("fake-mixed-three").a === "2026-08-20" && up("fake-mixed-three").s === "changelog_backfill", JSON.stringify(up("fake-mixed-three")));
  expect("(b) a row with no changelog stays unchecked", up("fake-silent-four").a === null);
  const audit = legacy.prepare("SELECT metric, value FROM migration_audit WHERE migration_id = 'upstream_backfill_death_notices_v1' ORDER BY metric").all();
  expect("(b) the correction is versioned and audited (rows reverted recorded)", legacy.prepare("SELECT 1 x FROM schema_migrations WHERE migration_id = 'upstream_backfill_death_notices_v1'").get() !== undefined && audit.some((r) => r.metric === "reverted_to_unverified"), JSON.stringify(audit));
  initializeDb(legacy); // idempotent: a second start changes nothing
  expect("(b) a second start is a no-op (idempotent)", up("fake-dead-one").a === null && up("fake-alive-two").a === "2026-09-05" && legacy.prepare("SELECT COUNT(*) c FROM migration_audit WHERE migration_id = 'upstream_backfill_death_notices_v1'").get().c === audit.length);
  // the same DB after an upgrade that already backfilled wrongly (the shape production is in today)
  const wrong = new Database(resolve("tmp-mcp-status-wrong-smoke.db")); open.push(wrong);
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
  expect("(b) production shape: the wrongly backfilled death notice is reverted to unverified (and the legacy column with it)", upw("fake-dead-one").a === null && upw("fake-dead-one").s === null && upw("fake-dead-one").l === null, JSON.stringify(upw("fake-dead-one")));
  expect("(b) production shape: a check recorded by github itself is NOT touched even though a death notice exists", upw("fake-github-five").a === "2026-09-10" && upw("fake-github-five").s === "github");
  expect("(b) production shape: a backfill backed by a real change stays", upw("fake-alive-two").a === "2026-09-05");

  // ── (a) the seeder never overwrites a probe-sourced status ──
  // the first seed service plays the probed row (any catalogue row works; no marker's sealed id is used)
  const seedRow = db.prepare("SELECT 1 x FROM services LIMIT 1").get();
  expect("(a) fresh DB has no services before the seed", seedRow === undefined);
  seedDatabase(db);
  const probeTarget = db.prepare("SELECT id, mcp_status FROM services WHERE mcp_status IN ('official','verified') ORDER BY id LIMIT 1").get();
  expect("(a) a freshly seeded row is source 'seed' with no checked_at", db.prepare("SELECT mcp_status_source s, mcp_status_checked_at c FROM services WHERE id = ?").get(probeTarget.id).s === "seed" && db.prepare("SELECT mcp_status_checked_at c FROM services WHERE id = ?").get(probeTarget.id).c === null);
  // the probe observes the endpoint gone
  db.prepare("UPDATE services SET mcp_status = 'unreachable', mcp_status_source = 'probe', mcp_status_checked_at = ? WHERE id = ?").run(iso(1), probeTarget.id);
  seedDatabase(db); // the next start
  const after = db.prepare("SELECT mcp_status s, mcp_status_source src, mcp_status_checked_at c FROM services WHERE id = ?").get(probeTarget.id);
  expect("(a) after seedDatabase() the probe's 'unreachable' is still there (source probe, checked_at kept)", after.s === "unreachable" && after.src === "probe" && after.c !== null, JSON.stringify(after));
  const other = db.prepare("SELECT id, mcp_status FROM services WHERE mcp_status_source = 'seed' AND id <> ? ORDER BY id LIMIT 1").get(probeTarget.id);
  db.prepare("UPDATE services SET mcp_status = 'tampered' WHERE id = ?").run(other.id);
  seedDatabase(db);
  expect("(a) a seed-sourced row still takes the seed's value on the next start (the seed stays authoritative where nothing was observed)", db.prepare("SELECT mcp_status s FROM services WHERE id = ?").get(other.id).s === other.mcp_status);
  db.prepare("UPDATE services SET mcp_status = 'verified', mcp_status_source = 'probe', mcp_status_checked_at = ? WHERE id = ?").run(iso(2), other.id);
  seedDatabase(db);
  expect("(a) a probe-sourced 'verified' survives the seed as well (probe > seed, whatever the value)", db.prepare("SELECT mcp_status s, mcp_status_source src FROM services WHERE id = ?").get(other.id).s === "verified");

  // ── (c) display ──
  const d = (row, now = new Date()) => displayMcpStatus(row, now);
  const probed = (status, daysAgo, extra = {}) => ({ mcp_status: status, mcp_status_source: "probe", mcp_status_checked_at: iso(daysAgo), archived: 0, ...extra });
  expect("(c) probe 29 days old → verified shown, basis probe, checked_at shown", d(probed("verified", 29)).mcp_status === "verified" && d(probed("verified", 29)).mcp_status_basis === "probe" && d(probed("verified", 29)).mcp_status_checked_at !== null);
  expect("(c) probe 31 days old → unverified (probe_stale)", d(probed("verified", 31)).mcp_status === "unverified" && d(probed("verified", 31)).mcp_status_basis === "probe_stale");
  expect(`(c) the TTL is ${MCP_STATUS_PROBE_TTL_DAYS} days: exactly 30 → shown, 30 days + 1 ms → unverified`, d(probed("official", 30)).mcp_status === "official" && d({ ...probed("official", 0), mcp_status_checked_at: new Date(Date.now() - (30 * 86400000 + 1)).toISOString() }, new Date(Date.now() + 86400000)).mcp_status === "unverified");
  expect("(c) archived → unverified even with a fresh probe", d(probed("verified", 1, { archived: 1 })).mcp_status === "unverified" && d(probed("verified", 1, { archived: 1 })).mcp_status_basis === "archived");
  expect("(c) unreachable / dead → unverified", d(probed("unreachable", 1)).mcp_status === "unverified" && d(probed("dead", 1)).mcp_status_basis === "unreachable");
  expect("(c) seed-sourced verified / official → unverified (basis seed); no source at all → unverified", d({ mcp_status: "verified", mcp_status_source: "seed", mcp_status_checked_at: null, archived: 0 }).mcp_status === "unverified" && d({ mcp_status: "official", mcp_status_source: null, mcp_status_checked_at: null, archived: 0 }).mcp_status_basis === "seed");
  expect("(c) a probe-sourced claim without a date, or with a malformed date, → unverified", d({ mcp_status: "verified", mcp_status_source: "probe", mcp_status_checked_at: null, archived: 0 }).mcp_status === "unverified" && d({ mcp_status: "verified", mcp_status_source: "probe", mcp_status_checked_at: "yesterday", archived: 0 }).mcp_status === "unverified");
  expect("(c) a probe date in the future → unverified (never trusted)", d(probed("verified", -3)).mcp_status === "unverified");
  for (const s of ["community", "api_only", "third_party", "unknown", "none"]) expect(`(c) categorical status '${s}' passes through unchanged`, d({ mcp_status: s, mcp_status_source: "seed", mcp_status_checked_at: null, archived: 0 }).mcp_status === s && d({ mcp_status: s, mcp_status_source: "seed", mcp_status_checked_at: null, archived: 0 }).mcp_status_basis === "categorical");
  expect("(c) null status → treated as the column default 'official' → unverified without a probe", d({ mcp_status: null, mcp_status_source: null, mcp_status_checked_at: null, archived: 0 }).mcp_status === "unverified");
  // through the tools, on the seeded DB: the stored value is NOT changed, the display is
  db.prepare("UPDATE services SET mcp_status = 'verified', mcp_status_source = 'probe', mcp_status_checked_at = ? WHERE id = ?").run(iso(31), probeTarget.id);
  const detailStale = getServiceDetail(db, probeTarget.id);
  expect("(c) get_service_detail: stored 'verified' with a 31-day probe is shown as unverified, with the probe date beside it", detailStale.mcp_status === "unverified" && detailStale.mcp_status_checked_at === db.prepare("SELECT mcp_status_checked_at c FROM services WHERE id = ?").get(probeTarget.id).c && detailStale.mcp_status_basis === "probe_stale", JSON.stringify({ s: detailStale.mcp_status, c: detailStale.mcp_status_checked_at }));
  expect("(c) get_service_detail does not change the stored value", db.prepare("SELECT mcp_status s FROM services WHERE id = ?").get(probeTarget.id).s === "verified");
  db.prepare("UPDATE services SET mcp_status_checked_at = ? WHERE id = ?").run(iso(29), probeTarget.id);
  expect("(c) get_service_detail: the same row with a 29-day probe is shown as verified", getServiceDetail(db, probeTarget.id).mcp_status === "verified");
  db.prepare("UPDATE services SET mcp_status = 'unreachable' WHERE id = ?").run(probeTarget.id);
  expect("(c) get_service_detail: unreachable → unverified", getServiceDetail(db, probeTarget.id).mcp_status === "unverified" && getServiceDetail(db, probeTarget.id).mcp_status_basis === "unreachable");
  // search: a stored 'verified' without a probe is never shown as verified
  const results = searchServices(db, "mcp", undefined, 50);
  expect("(c) search_services: no result shows verified / official without a probe within the TTL", results.every((r) => (r.mcp_status !== "verified" && r.mcp_status !== "official") || (r.mcp_status_source === "probe" && r.mcp_status_checked_at !== null)) && results.length > 0, String(results.length));
  expect("(c) search_services: every result carries mcp_status_checked_at (null when never probed) and a basis", results.every((r) => "mcp_status_checked_at" in r && typeof r.mcp_status_basis === "string"));

  // ── (d) the legend ──
  expect("(d) the legend says what unverified means and that checked_at is the probe's date", /seed|catalogue/.test(MCP_STATUS_LEGEND.unverified) && /probe/.test(MCP_STATUS_LEGEND.checked_at_means) && typeof detailStale.mcp_status_legend === "object");
} catch (e) {
  failures++; console.error("ERROR ", e && e.stack || e);
} finally {
  for (const h of open) { try { h.close(); } catch { /* already closed */ } }
  for (const f of [target, resolve("tmp-mcp-status-legacy-smoke.db"), resolve("tmp-mcp-status-wrong-smoke.db")]) for (const suffix of ["", "-wal", "-shm"]) rmSync(`${f}${suffix}`, { force: true });
}

console.log(failures === 0 ? "\nmcp-status provenance smoke: ALL PASS" : `\nmcp-status provenance smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
