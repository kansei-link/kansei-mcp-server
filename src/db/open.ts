import Database from "better-sqlite3";
import { initializeDb } from "./schema.js";

/**
 * The one way a CLI or script opens the catalog DB (Codex review 5 of dc319cf, A / F8).
 *
 * Every connection made here has gone through initializeDb before any statement
 * runs, so a DB written by an older release gets the columns the code reads
 * (e.g. mcp_liveness) before a probe, a watchdog pass or a script touches it.
 * initializeDb is idempotent: on an up-to-date DB it changes nothing.
 *
 * Not for: read-only connections (initializeDb writes), the deliberate legacy
 * shapes built by the migration smoke tests, and getDb (src/db/connection.ts),
 * whose caller (the server) runs initializeDb itself.
 */
export function openDb(path: string, options?: Database.Options): Database.Database {
  const db = new Database(path, options);
  try {
    initializeDb(db);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}
