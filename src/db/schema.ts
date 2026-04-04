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
      mcp_status TEXT DEFAULT 'official',
      api_url TEXT,
      api_auth_method TEXT,
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
      workaround TEXT,
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

    CREATE TABLE IF NOT EXISTS service_changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL REFERENCES services(id),
      change_date TEXT NOT NULL,
      change_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_outcomes_service ON outcomes(service_id);
    CREATE INDEX IF NOT EXISTS idx_outcomes_created ON outcomes(created_at);
    CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
    CREATE INDEX IF NOT EXISTS idx_changelog_service ON service_changelog(service_id);
    CREATE INDEX IF NOT EXISTS idx_changelog_date ON service_changelog(change_date);

    -- Inspection queue: anomalies flagged for verification by scout agents
    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL REFERENCES services(id),
      anomaly_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      description TEXT NOT NULL,
      evidence TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      resolved_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
    CREATE INDEX IF NOT EXISTS idx_inspections_service ON inspections(service_id);
    CREATE INDEX IF NOT EXISTS idx_inspections_severity ON inspections(severity);

    CREATE TABLE IF NOT EXISTS service_api_guides (
      service_id TEXT PRIMARY KEY REFERENCES services(id),
      base_url TEXT NOT NULL,
      api_version TEXT,
      auth_overview TEXT NOT NULL,
      auth_token_url TEXT,
      auth_scopes TEXT,
      auth_setup_hint TEXT,
      sandbox_url TEXT,
      key_endpoints TEXT NOT NULL,
      request_content_type TEXT DEFAULT 'application/json',
      pagination_style TEXT,
      rate_limit TEXT,
      error_format TEXT,
      quickstart_example TEXT NOT NULL,
      agent_tips TEXT,
      docs_url TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: add workaround column if it doesn't exist (for existing databases)
  const hasWorkaround = db
    .prepare("SELECT count(*) as cnt FROM pragma_table_info('outcomes') WHERE name = 'workaround'")
    .get() as { cnt: number };
  if (hasWorkaround.cnt === 0) {
    db.exec("ALTER TABLE outcomes ADD COLUMN workaround TEXT");
  }

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

  // Trigram FTS table for CJK (Japanese) substring search
  const trigramExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='services_fts_trigram'"
    )
    .get();

  if (!trigramExists) {
    db.exec(`
      CREATE VIRTUAL TABLE services_fts_trigram USING fts5(
        name, description, tags, category,
        content=services, content_rowid=rowid,
        tokenize='trigram'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS services_ai_tri AFTER INSERT ON services BEGIN
        INSERT INTO services_fts_trigram(rowid, name, description, tags, category)
        VALUES (new.rowid, new.name, new.description, new.tags, new.category);
      END;

      CREATE TRIGGER IF NOT EXISTS services_ad_tri AFTER DELETE ON services BEGIN
        INSERT INTO services_fts_trigram(services_fts_trigram, rowid, name, description, tags, category)
        VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
      END;

      CREATE TRIGGER IF NOT EXISTS services_au_tri AFTER UPDATE ON services BEGIN
        INSERT INTO services_fts_trigram(services_fts_trigram, rowid, name, description, tags, category)
        VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
        INSERT INTO services_fts_trigram(rowid, name, description, tags, category)
        VALUES (new.rowid, new.name, new.description, new.tags, new.category);
      END;
    `);
  }
}
