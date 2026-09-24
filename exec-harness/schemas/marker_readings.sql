-- marker_readings: sidecar table for reading predicate v1 (docs/READING-PREDICATE-v1.md)
--
-- Rules
--   * outcomes is NOT modified. This table hangs off it through outcome_id.
--   * Append-only. UPDATE and DELETE are refused by triggers. A correction is a
--     new row whose supersedes column names the row it corrects.
--   * No tenant identifiers, counts, or amounts are stored here. observed_json
--     carries pass/fail, method, fixed-label checks, and flags only.
--   * kind='synthetic' rows never enter publishable_outcomes: the paired
--     outcomes row is written with provenance='synthetic', which every public
--     view and rollup already excludes (P0 #39 quarantine).

CREATE TABLE IF NOT EXISTS marker_readings (
  reading_id      TEXT PRIMARY KEY,
  outcome_id      INTEGER REFERENCES outcomes(id),
  claim           TEXT NOT NULL,
  marker_id       TEXT NOT NULL,
  expected_digest TEXT NOT NULL,
  target_json     TEXT NOT NULL,   -- {service_id, model, harness_version}
  stage_reached   TEXT NOT NULL CHECK (stage_reached IN ('discover','understand','connect','execute','done')),
  stage_stopped   TEXT CHECK (stage_stopped IS NULL OR stage_stopped IN ('discover','understand','connect','execute')),
  observed_json   TEXT NOT NULL,   -- {pass, method, checks[], false_completion, ground_truth_consistent, instrument_error}
  evidence_ref    TEXT NOT NULL,   -- <bundle path>#sha256:<manifest digest>
  observer        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('synthetic','lived')),
  observed_at     TEXT NOT NULL,
  supersedes      TEXT REFERENCES marker_readings(reading_id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_marker_readings_marker_time ON marker_readings(marker_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_marker_readings_outcome ON marker_readings(outcome_id);

CREATE TRIGGER IF NOT EXISTS trg_marker_readings_no_update
BEFORE UPDATE ON marker_readings
BEGIN
  SELECT RAISE(ABORT, 'marker_readings is append-only: write a new row with supersedes instead');
END;

CREATE TRIGGER IF NOT EXISTS trg_marker_readings_no_delete
BEFORE DELETE ON marker_readings
BEGIN
  SELECT RAISE(ABORT, 'marker_readings is append-only: rows are never deleted');
END;
