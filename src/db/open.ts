import Database from "better-sqlite3";
import { ensureCliSchema } from "./cli-schema.js";

/**
 * The one way a CLI or script opens the catalog DB (Codex review 5 of dc319cf, A / F8).
 *
 * Opens an existing catalogue (775a797 or newer) and prepares only the three
 * nullable liveness columns and their endpoint-change trigger. In particular,
 * opening a CLI must not reclassify outcomes or run the server's data hygiene.
 *
 * Not for: read-only connections, empty-database bootstrap, the deliberate
 * legacy shapes built by migration tests, or server startup. The crawler and
 * agent-army orchestrators retain their historical full initializeDb startup.
 */
export function openDb(path: string, options?: Database.Options): Database.Database {
  const db = new Database(path, options);
  try {
    ensureCliSchema(db);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}
