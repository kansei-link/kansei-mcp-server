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

  // Migration: add cost optimization columns to outcomes
  const hasModelName = db
    .prepare("SELECT count(*) as cnt FROM pragma_table_info('outcomes') WHERE name = 'model_name'")
    .get() as { cnt: number };
  if (hasModelName.cnt === 0) {
    db.exec("ALTER TABLE outcomes ADD COLUMN model_name TEXT");
    db.exec("ALTER TABLE outcomes ADD COLUMN agent_type TEXT");
    db.exec("ALTER TABLE outcomes ADD COLUMN task_type TEXT");
    db.exec("ALTER TABLE outcomes ADD COLUMN input_tokens INTEGER");
    db.exec("ALTER TABLE outcomes ADD COLUMN output_tokens INTEGER");
    db.exec("ALTER TABLE outcomes ADD COLUMN cost_usd REAL");
  }

  // Migration: add MCP tool inventory columns to services (for analyze_mcp_config)
  // mcp_tool_count: how many tools this MCP server exposes
  // avg_tool_def_tokens: estimated tokens per tool definition (default 500)
  const hasMcpToolCount = db
    .prepare("SELECT count(*) as cnt FROM pragma_table_info('services') WHERE name = 'mcp_tool_count'")
    .get() as { cnt: number };
  if (hasMcpToolCount.cnt === 0) {
    db.exec("ALTER TABLE services ADD COLUMN mcp_tool_count INTEGER");
    db.exec("ALTER TABLE services ADD COLUMN avg_tool_def_tokens INTEGER DEFAULT 500");
  }

  // Model-level performance stats per service (for audit_cost routing)
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_service_stats (
      service_id TEXT NOT NULL REFERENCES services(id),
      model_name TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'general',
      total_calls INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0,
      avg_cost_usd REAL DEFAULT 0,
      avg_input_tokens REAL DEFAULT 0,
      avg_output_tokens REAL DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now')),
      UNIQUE(service_id, model_name, task_type)
    );
    CREATE INDEX IF NOT EXISTS idx_mss_service ON model_service_stats(service_id);
    CREATE INDEX IF NOT EXISTS idx_mss_model ON model_service_stats(model_name);
    CREATE INDEX IF NOT EXISTS idx_mss_composite ON model_service_stats(service_id, task_type);
  `);

  // Routing request audit log (for tracking audit_cost usage)
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id_hash TEXT DEFAULT 'anonymous',
      service_id TEXT,
      task_type TEXT,
      current_model TEXT,
      recommended_model TEXT,
      estimated_savings_pct REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_routing_created ON routing_requests(created_at);
  `);

  // Infrastructure cost optimization tips (verified from X buzz + research)
  db.exec(`
    CREATE TABLE IF NOT EXISTS infrastructure_tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tip_id TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      from_stack TEXT NOT NULL,
      to_stack TEXT NOT NULL,
      savings_pct REAL,
      confidence TEXT NOT NULL DEFAULT 'verified',
      conditions TEXT,
      evidence_url TEXT,
      evidence_summary TEXT,
      related_services TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tips_category ON infrastructure_tips(category);
    CREATE INDEX IF NOT EXISTS idx_tips_confidence ON infrastructure_tips(confidence);
  `);

  // Crawl queue: newly discovered MCP candidates awaiting review or auto-ingestion
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,                  -- github-topics, awesome-punkpeye, awesome-wong2, awesome-tensorblock, mcp-registry
      source_url TEXT NOT NULL,              -- original URL of the entry
      repo_full_name TEXT,                   -- e.g. "owner/repo"
      candidate_name TEXT NOT NULL,
      description TEXT,
      stars INTEGER DEFAULT 0,
      last_commit_at TEXT,
      readme_excerpt TEXT,
      proposed_category TEXT,
      proposed_tags TEXT DEFAULT '[]',
      trust_score_initial REAL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'review',   -- auto-accept, review, reject
      status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, rejected, ingested, duplicate
      reject_reason TEXT,
      ingested_service_id TEXT,               -- populated after ingestion
      raw_data TEXT,                          -- JSON dump of full source row
      discovered_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by TEXT,
      UNIQUE(source, source_url)
    );
    CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON crawl_queue(status);
    CREATE INDEX IF NOT EXISTS idx_crawl_queue_tier ON crawl_queue(tier);
    CREATE INDEX IF NOT EXISTS idx_crawl_queue_source ON crawl_queue(source);
    CREATE INDEX IF NOT EXISTS idx_crawl_queue_repo ON crawl_queue(repo_full_name);
  `);

  // Crawl runs: log of each daily crawl execution
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running', -- running, success, failed
      sources_crawled TEXT DEFAULT '[]',      -- JSON array
      discovered_count INTEGER DEFAULT 0,
      auto_accepted_count INTEGER DEFAULT 0,
      review_queue_count INTEGER DEFAULT 0,
      rejected_count INTEGER DEFAULT 0,
      duplicates_count INTEGER DEFAULT 0,
      errors TEXT DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_crawl_runs_started ON crawl_runs(started_at DESC);
  `);

  // Linksee-memory opt-in telemetry (privacy-preserving)
  //   - anonymous UUID from user (generated on first opt-in)
  //   - only aggregated / hashed signals, NEVER conversation content
  //   - protected by the Level 1 payload contract documented in linksee-memory README
  db.exec(`
    CREATE TABLE IF NOT EXISTS linksee_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anon_id TEXT NOT NULL,                  -- anonymous UUID generated on user's machine
      linksee_version TEXT,                   -- e.g. "0.0.3"
      session_turn_count INTEGER,             -- scalar only
      session_duration_sec INTEGER,
      file_ops_edit INTEGER DEFAULT 0,
      file_ops_write INTEGER DEFAULT 0,
      file_ops_read INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      -- Aggregated / distributional data (all JSON, all anonymized)
      mcp_servers TEXT,                       -- JSON: ["kansei-link","freee","slack"] — names only
      file_extensions TEXT,                   -- JSON: {".ts":45,".py":20,".md":15} — percent distribution
      read_smart_savings_pct REAL,            -- avg token savings when read_smart was used
      read_smart_calls INTEGER DEFAULT 0,
      recall_calls INTEGER DEFAULT 0,
      recall_file_calls INTEGER DEFAULT 0,
      -- Receipt metadata
      received_at TEXT DEFAULT (datetime('now')),
      ip_hash TEXT,                           -- hashed IP for abuse detection only, NEVER raw
      UNIQUE(anon_id, session_turn_count, received_at)  -- dedupe exact same submission
    );
    CREATE INDEX IF NOT EXISTS idx_linksee_tel_anon ON linksee_telemetry(anon_id);
    CREATE INDEX IF NOT EXISTS idx_linksee_tel_received ON linksee_telemetry(received_at DESC);
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
