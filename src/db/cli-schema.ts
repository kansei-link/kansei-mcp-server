import type Database from "better-sqlite3";

/**
 * Prepare only the CLI's liveness structure on an existing catalogue (775a797+).
 * These nullable columns do not gate any data migration. No existing row is
 * rewritten on open. Full bootstrap and data hygiene belong to initializeDb.
 */
export function ensureCliSchema(db: Database.Database): void {
  for (const col of ["mcp_liveness", "mcp_liveness_checked_at", "mcp_liveness_endpoint"]) {
    if ((db.prepare("SELECT count(*) as cnt FROM pragma_table_info('services') WHERE name = ?").get(col) as { cnt: number }).cnt === 0) {
      db.exec(`ALTER TABLE services ADD COLUMN ${col} TEXT`);
    }
  }
  // DDL only: the UPDATE is the trigger body, not a statement run on open.
  // It runs later, only when a writer actually changes the endpoint verbatim.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS services_endpoint_clears_liveness
    AFTER UPDATE OF mcp_endpoint ON services
    WHEN OLD.mcp_endpoint IS NOT NEW.mcp_endpoint
    BEGIN
      UPDATE services
         SET mcp_liveness = NULL, mcp_liveness_checked_at = NULL, mcp_liveness_endpoint = NULL
       WHERE id = NEW.id;
    END;
  `);
}
