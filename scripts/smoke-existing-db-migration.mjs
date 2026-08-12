import Database from "better-sqlite3";
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { initializeDb } from "../dist/db/schema.js";

const source = resolve(process.argv[2] || "kansei-link.db");
const target = resolve("tmp-existing-db-migration-smoke.db");
copyFileSync(source, target);

try {
  const db = new Database(target);
  initializeDb(db);
  const healthPublic = db.prepare(
    "SELECT COUNT(*) AS n FROM publishable_outcomes WHERE agent_id_hash = 'health-probe'"
  ).get();
  const legacyUnknown = db.prepare(
    "SELECT COUNT(*) AS n FROM outcomes WHERE provenance = 'legacy_unknown'"
  ).get();
  const probe = db.prepare(
    "SELECT COUNT(*) AS n FROM outcomes WHERE provenance = 'kansei_probe' AND task_type = 'reachability_probe'"
  ).get();
  const publicGroups = db.prepare(
    "SELECT COUNT(*) AS n FROM publishable_service_stats"
  ).get();
  db.close();

  if (healthPublic.n !== 0) throw new Error("health probe leaked into publishable outcomes");
  if (probe.n === 0) throw new Error("health probe was not classified as reachability data");
  console.log(JSON.stringify({
    result: "PASS",
    legacy_unknown: legacyUnknown.n,
    reachability_probe: probe.n,
    publishable_groups: publicGroups.n,
  }));
} finally {
  rmSync(target, { force: true });
}
