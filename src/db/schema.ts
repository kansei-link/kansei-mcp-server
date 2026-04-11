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
      -- AXR (Agent Experience Rating) — felt-first credit-rating system
      -- Derived from 225 hand-evaluated services. See content/eval/
      axr_score INTEGER,        -- 0-100 continuous score
      axr_grade TEXT,            -- AAA/AA/A/B/C/D/F
      axr_dims TEXT,             -- JSON [D1,D2,D3,D4,D5] (1-5 each)
      axr_facade INTEGER DEFAULT 0, -- 1 if みせかけMCP detected
      usage_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      required_services TEXT,
      -- gotchas[]: accumulated warnings surfaced by agent feedback. This is
      -- the Tier-B (KanseiLink integration knowledge) moat: advice about
      -- cross-service wiring, auth handoff, rate-limit interactions, etc.
      -- Stored as JSON array of strings. DOES NOT reflect on individual
      -- vendor ratings.
      gotchas TEXT DEFAULT '[]',
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_changelog_unique
      ON service_changelog(service_id, change_date, change_type, summary);

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

    CREATE TABLE IF NOT EXISTS agent_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      feedback_type TEXT NOT NULL DEFAULT 'suggestion',
      service_id TEXT REFERENCES services(id),
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_status ON agent_feedback(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_type ON agent_feedback(feedback_type);

    -- Pending updates: PR-model proposals from agents for service data changes
    CREATE TABLE IF NOT EXISTS pending_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL REFERENCES services(id),
      proposer_agent_id TEXT DEFAULT 'anonymous',
      change_type TEXT NOT NULL DEFAULT 'update',
      field_changes TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      review_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_updates(status);
    CREATE INDEX IF NOT EXISTS idx_pending_service ON pending_updates(service_id);
    CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_updates(created_at);

    -- Daily snapshots: time-series intelligence for consulting reports
    CREATE TABLE IF NOT EXISTS service_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL REFERENCES services(id),
      snapshot_date TEXT NOT NULL,
      -- Reliability metrics
      total_reports INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0,
      p95_latency_ms REAL DEFAULT 0,
      unique_agents INTEGER DEFAULT 0,
      -- Error breakdown (JSON: {"timeout": 3, "auth_error": 1, ...})
      error_distribution TEXT DEFAULT '{}',
      -- Workaround count (agents finding their own fixes = API friction signal)
      workaround_count INTEGER DEFAULT 0,
      -- Agent sentiment: complaints vs praise ratio from feedback
      complaint_count INTEGER DEFAULT 0,
      praise_count INTEGER DEFAULT 0,
      -- Usage patterns
      recipe_usage_count INTEGER DEFAULT 0,
      solo_usage_count INTEGER DEFAULT 0,
      -- Search & discovery: how often this service appears in search results vs gets chosen
      search_appearances INTEGER DEFAULT 0,
      search_selections INTEGER DEFAULT 0,
      -- Competitive position: rank within category on this day
      category_rank INTEGER,
      category_total INTEGER,
      -- Business impact proxy: unique agent adoption (new agents using for first time)
      new_agents_count INTEGER DEFAULT 0,
      -- Raw trust_score on this day
      trust_score REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(service_id, snapshot_date)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_service ON service_snapshots(service_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_date ON service_snapshots(snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_snapshots_service_date ON service_snapshots(service_id, snapshot_date);

    -- Event markers: external events that may impact metrics (API changes, law changes, etc.)
    CREATE TABLE IF NOT EXISTS service_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT REFERENCES services(id),
      event_date TEXT NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      impact_expected TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_service ON service_events(service_id);
    CREATE INDEX IF NOT EXISTS idx_events_date ON service_events(event_date);

    -- Design evaluation: API quality assessment for consulting reports
    CREATE TABLE IF NOT EXISTS service_design_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL REFERENCES services(id),
      evaluated_date TEXT NOT NULL,
      api_quality_score REAL DEFAULT 0,
      doc_completeness_score REAL DEFAULT 0,
      auth_stability_score REAL DEFAULT 0,
      error_clarity_score REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(service_id, evaluated_date)
    );

    CREATE INDEX IF NOT EXISTS idx_design_scores_service ON service_design_scores(service_id);

    -- Stripe subscriptions for content access control
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_customer_id TEXT NOT NULL,
      stripe_subscription_id TEXT UNIQUE,
      email TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'free',  -- free, pro, team, enterprise
      status TEXT NOT NULL DEFAULT 'active', -- active, canceled, past_due, trialing
      -- For team tier: which services are included
      service_ids TEXT DEFAULT '[]', -- JSON array of service IDs
      current_period_start TEXT,
      current_period_end TEXT,
      cancel_at_period_end INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_subs_email ON subscriptions(email);
    CREATE INDEX IF NOT EXISTS idx_subs_stripe_customer ON subscriptions(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);

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

  // Migration: add AXR columns to existing services table
  const hasAxrScore = db
    .prepare("SELECT count(*) as cnt FROM pragma_table_info('services') WHERE name = 'axr_score'")
    .get() as { cnt: number };
  if (hasAxrScore.cnt === 0) {
    db.exec("ALTER TABLE services ADD COLUMN axr_score INTEGER");
    db.exec("ALTER TABLE services ADD COLUMN axr_grade TEXT");
    db.exec("ALTER TABLE services ADD COLUMN axr_dims TEXT");
    db.exec("ALTER TABLE services ADD COLUMN axr_facade INTEGER DEFAULT 0");
  }

  // Migration: add workaround column if it doesn't exist (for existing databases)
  const hasWorkaround = db
    .prepare("SELECT count(*) as cnt FROM pragma_table_info('outcomes') WHERE name = 'workaround'")
    .get() as { cnt: number };
  if (hasWorkaround.cnt === 0) {
    db.exec("ALTER TABLE outcomes ADD COLUMN workaround TEXT");
  }

  // Migration: add is_retry and estimated_users columns to outcomes
  const hasIsRetry = db
    .prepare("SELECT count(*) as cnt FROM pragma_table_info('outcomes') WHERE name = 'is_retry'")
    .get() as { cnt: number };
  if (hasIsRetry.cnt === 0) {
    db.exec("ALTER TABLE outcomes ADD COLUMN is_retry INTEGER DEFAULT 0");
    db.exec("ALTER TABLE outcomes ADD COLUMN estimated_users INTEGER");
  }

  // Migration: add gotchas column to recipes (Tier-B KanseiLink moat)
  const hasGotchas = db
    .prepare("SELECT count(*) as cnt FROM pragma_table_info('recipes') WHERE name = 'gotchas'")
    .get() as { cnt: number };
  if (hasGotchas.cnt === 0) {
    db.exec("ALTER TABLE recipes ADD COLUMN gotchas TEXT DEFAULT '[]'");
  }

  // Migration: add calls_per_agent_per_day and estimated_total_users to snapshots
  const snapshotsExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='service_snapshots'")
    .get();
  if (snapshotsExists) {
    const hasCallsPerAgent = db
      .prepare("SELECT count(*) as cnt FROM pragma_table_info('service_snapshots') WHERE name = 'calls_per_agent_per_day'")
      .get() as { cnt: number };
    if (hasCallsPerAgent.cnt === 0) {
      db.exec("ALTER TABLE service_snapshots ADD COLUMN calls_per_agent_per_day REAL DEFAULT 0");
      db.exec("ALTER TABLE service_snapshots ADD COLUMN estimated_total_users INTEGER DEFAULT 0");
    }
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
