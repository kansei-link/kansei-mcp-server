import type Database from "better-sqlite3";

export function initializeDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      namespace TEXT,
      description TEXT,
      category TEXT,
      tags TEXT,
      mcp_endpoint TEXT,
      trust_score REAL DEFAULT 0.5,
      usage_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      required_services TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL REFERENCES services(id),
      agent_id_hash TEXT DEFAULT 'anonymous',
      success INTEGER NOT NULL,
      latency_ms INTEGER,
      error_type TEXT,
      context_masked TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_stats (
      service_id TEXT PRIMARY KEY REFERENCES services(id),
      total_calls INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0,
      unique_agents INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_outcomes_service ON outcomes(service_id);
    CREATE INDEX IF NOT EXISTS idx_outcomes_created ON outcomes(created_at);
    CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
  `);

  // FTS5 virtual table for full-text search on services
  // Check if it already exists first (CREATE VIRTUAL TABLE IF NOT EXISTS not supported in all SQLite builds)
  const ftsExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='services_fts'"
    )
    .get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE services_fts USING fts5(
        name, description, tags, category,
        content=services, content_rowid=rowid
      );
    `);

    // Triggers to keep FTS in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS services_ai AFTER INSERT ON services BEGIN
        INSERT INTO services_fts(rowid, name, description, tags, category)
        VALUES (new.rowid, new.name, new.description, new.tags, new.category);
      END;

      CREATE TRIGGER IF NOT EXISTS services_ad AFTER DELETE ON services BEGIN
        INSERT INTO services_fts(services_fts, rowid, name, description, tags, category)
        VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
      END;

      CREATE TRIGGER IF NOT EXISTS services_au AFTER UPDATE ON services BEGIN
        INSERT INTO services_fts(services_fts, rowid, name, description, tags, category)
        VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
        INSERT INTO services_fts(rowid, name, description, tags, category)
        VALUES (new.rowid, new.name, new.description, new.tags, new.category);
      END;
    `);
  }
}
