import Database from "better-sqlite3";
import { initializeDb } from "../dist/db/schema.js";
import { reportOutcome } from "../dist/tools/report-outcome.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Simulate the minimum legacy tables so initializeDb must migrate, not merely
// create, the two central tables.
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT);
  CREATE TABLE recipes (
    id TEXT PRIMARY KEY, goal TEXT NOT NULL, steps TEXT NOT NULL,
    required_services TEXT, created_at TEXT
  );
  CREATE TABLE outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT NOT NULL,
    agent_id_hash TEXT DEFAULT 'anonymous', success INTEGER NOT NULL,
    latency_ms INTEGER, error_type TEXT, context_masked TEXT, created_at TEXT
  );
  INSERT INTO services(id, name) VALUES ('freee', 'freee');
  INSERT INTO outcomes(service_id, agent_id_hash, success) VALUES
    ('freee', 'test-harness-v1', 1),
    ('freee', 'anonymous', 1);
`);

initializeDb(db);

const outcomeColumns = new Set(
  db.prepare("SELECT name FROM pragma_table_info('outcomes')").all().map((r) => r.name)
);
for (const name of ["provenance", "verification_status", "attempt_id", "recipe_id", "recipe_version", "failed_step"]) {
  assert(outcomeColumns.has(name), `missing outcomes.${name}`);
}

const migrated = db.prepare("SELECT agent_id_hash, provenance FROM outcomes ORDER BY id").all();
assert(migrated[0].provenance === "synthetic", "known seed must become synthetic");
assert(migrated[1].provenance === "legacy_unknown", "ambiguous anonymous row must stay legacy_unknown");

db.prepare(`INSERT INTO recipes
  (id, goal, steps, required_services, known_failures, recovery_steps)
  VALUES (?, ?, '[]', ?, ?, ?)`
).run(
  "freee-auth-recovery",
  "recover freee authentication",
  JSON.stringify(["freee"]),
  JSON.stringify([{ error_class: "auth_error" }]),
  JSON.stringify(["Refresh the OAuth token", "Retry with the same idempotency key"])
);

const attemptId = "73ca7e20-a950-4dce-ae6a-1ee9a9dccf44";
const result = reportOutcome(db, {
  service_id: "freee",
  success: false,
  error_type: "auth_error",
  attempt_id: attemptId,
  recipe_id: "freee-auth-recovery",
  recipe_version: 1,
  failed_step: "oauth_refresh",
});

assert(result.recorded === true, "report must be recorded");
assert(result.attempt?.attempt_id === attemptId, "attempt must correlate");
assert(result.recovery_recipe?.steps?.length === 2, "failure must return recovery steps");

const stored = db.prepare("SELECT provenance, verification_status, failed_step FROM outcomes ORDER BY id DESC LIMIT 1").get();
assert(stored.provenance === "user_reported", "new report provenance must be user_reported");
assert(stored.verification_status === "unverified", "reported data must not become verified");
assert(stored.failed_step === "oauth_refresh", "failed step must persist");

const publishable = db.prepare("SELECT SUM(total_calls) AS n FROM publishable_service_stats WHERE service_id = 'freee'").get();
assert(publishable.n === 1, "public view must exclude synthetic and legacy_unknown rows");

console.log("data-architecture smoke: PASS");
