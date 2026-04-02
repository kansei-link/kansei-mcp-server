import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath =
    dbPath ??
    process.env.KANSEI_DB_PATH ??
    path.join(__dirname, "..", "..", "kansei-link.db");

  db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

export function getMemoryDb(): Database.Database {
  const memDb = new Database(":memory:");
  memDb.pragma("foreign_keys = ON");
  return memDb;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
