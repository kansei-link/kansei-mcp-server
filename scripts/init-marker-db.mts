#!/usr/bin/env tsx
/**
 * Initialise a dedicated local DB for sealed-marker runs (HANDOFF Step 1 T3).
 *
 *   KANSEI_DB_PATH=<path> npx tsx scripts/init-marker-db.mts
 *
 * Runs the same initializeDb + seedDatabase the MCP server runs on startup
 * (so `services` has the 'freee' row that outcomes.service_id references and
 * lookup/tips work against this DB in T5), then applies the append-only
 * marker_readings sidecar table. Refuses to run without KANSEI_DB_PATH so it
 * can never touch the default ./kansei-link.db of another checkout.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../src/db/connection.js";
import { initializeDb } from "../src/db/schema.js";
import { seedDatabase } from "../src/db/seed.js";

const dbPath = process.env.KANSEI_DB_PATH;
if (!dbPath) {
  console.error("KANSEI_DB_PATH is required (a dedicated marker DB, not the runtime or production DB).");
  process.exit(2);
}

const db = getDb(dbPath);
initializeDb(db);
seedDatabase(db);
db.exec(readFileSync(resolve(import.meta.dirname, "../exec-harness/schemas/marker_readings.sql"), "utf-8"));

const services = db.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number };
const freee = db.prepare("SELECT id, name FROM services WHERE id = 'freee'").get() as { id: string; name: string } | undefined;
const sidecar = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='marker_readings'").get();
const triggers = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='marker_readings'").get() as { n: number };

console.log(JSON.stringify({
  db: dbPath,
  services_total: services.n,
  freee_row_present: !!freee,
  marker_readings_present: !!sidecar,
  append_only_triggers: triggers.n,
}, null, 2));
db.close();
