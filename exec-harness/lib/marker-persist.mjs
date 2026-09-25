/**
 * Append-only persistence shared by every marker kind: outcomes row (quarantined
 * with provenance='synthetic') + marker_readings sidecar row, then the README
 * table rows (founder-ops, outside the repo). Extracted from run-marker 0.3.1
 * without behavioural change for M-001.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { effectiveAgentCount, validateSupersedes } from './marker-store.mjs';
import { sqliteUtc } from './reading.mjs';

/** db: a read-only handle opened by openDb (closed and reopened writable here). */
export function persistReadings({ db, readings, MK, PACK, sealedDigest, maxReadings, schemasDir }) {
  const dbPath = db.name; db.close(); const w = new Database(dbPath);
  w.pragma('foreign_keys = ON');
  w.exec(readFileSync(join(schemasDir, 'marker_readings.sql'), 'utf8'));
  const insOutcome = w.prepare(`INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, context_masked, provenance, verification_status, model_name, agent_type, task_type, failed_step, created_at)
    VALUES (?, 'kansei-marker-harness', ?, ?, ?, ?, 'synthetic', ?, ?, 'harness', ?, ?, ?)`);
  const insReading = w.prepare(`INSERT INTO marker_readings (reading_id, outcome_id, claim, marker_id, expected_digest, target_json, stage_reached, stage_stopped, observed_json, evidence_ref, observer, kind, observed_at, supersedes)
    VALUES (@reading_id, @outcome_id, @claim, @marker_id, @expected_digest, @target_json, @stage_reached, @stage_stopped, @observed_json, @evidence_ref, @observer, @kind, @observed_at, @supersedes)`);
  w.transaction(() => {
    const additions = readings.filter((r) => r._outcome && !r.supersedes).length;
    if (effectiveAgentCount(w, MK.marker_id) + additions > maxReadings) throw new Error('max-readings changed concurrently; nothing appended');
    for (const r of readings) {
      validateSupersedes(w, r.supersedes, { markerId: MK.marker_id, digest: sealedDigest, serviceId: PACK.service_id, agent: Boolean(r._outcome) });
      let outcomeId = null;
      if (r._outcome) {
        const o = r._outcome;
        outcomeId = insOutcome.run(PACK.service_id, o.success, o.latency_ms, o.error_type, o.context_masked, o.verification_status, o.model_name, `marker:${MK.marker_id}`, o.failed_step, sqliteUtc(new Date(r.observed_at))).lastInsertRowid;
      }
      insReading.run({ reading_id: r.reading_id, outcome_id: outcomeId, claim: r.claim, marker_id: r.marker_id, expected_digest: r.expected_digest, target_json: JSON.stringify(r.target), stage_reached: r.stage_reached, stage_stopped: r.stage_stopped, observed_json: JSON.stringify(r.observed), evidence_ref: r.evidence_ref, observer: r.observer, kind: r.kind, observed_at: r.observed_at, supersedes: r.supersedes });
    }
  }).immediate();
  const leak = w.prepare('SELECT COUNT(*) AS n FROM publishable_outcomes WHERE task_type = ?').get(`marker:${MK.marker_id}`);
  console.log(`db: ${readings.length} reading(s) appended; publishable_outcomes rows for this marker = ${leak.n} (must be 0)`);
  if (leak.n !== 0) { console.error('QUARANTINE BREACH: synthetic marker rows visible in publishable_outcomes'); process.exit(1); }
  w.close();
}

/** Table row text for the founder-ops README (no tenant values; ids/digests only). */
export function readmeRows(readings) {
  const agentRows = readings.filter((r) => r._outcome).map((r) => `| ${r.observed_at.slice(0, 10)} | ${r.reading_id}${r.supersedes ? `（訂正:${r.supersedes}）` : ''} | ${r.stage_reached} | ${r.stage_stopped ?? '—'} | ${r.observed.instrument_error ? `計器:${r.observed.instrument_error}` : r.observed.pass ? 'pass' : 'fail'}${r.observed.false_completion ? '（自称成功）' : ''} | ${r.evidence_ref} |\n`).join('');
  const gtRows = readings.filter((r) => !r._outcome).map((r) => `| ${r.observed_at.slice(0, 10)} | ${r.reading_id}${r.supersedes ? `（訂正:${r.supersedes}）` : ''} | ${r.observed.pass ? '一致' : '不一致'} | ${r.evidence_ref} |\n`).join('');
  return { agentRows, gtRows };
}

export function appendReadme({ readmePath, readings }) {
  if (!existsSync(readmePath)) { console.warn(`[warn] README not found at ${readmePath}; rows not appended`); return false; }
  let md = readFileSync(readmePath, 'utf8');
  const append = (marker, rowsText) => { const i = md.indexOf(marker); if (i < 0) return false; md = md.slice(0, i) + rowsText + md.slice(i); return true; };
  const { agentRows, gtRows } = readmeRows(readings);
  const ok1 = agentRows ? append('<!-- seven-rows:end -->', agentRows) : true;
  const ok2 = gtRows ? append('<!-- gt-rows:end -->', gtRows) : true;
  if (ok1 && ok2) { writeFileSync(readmePath, md); console.log(`readme: appended ${readings.length} row(s) to ${readmePath}`); return true; }
  console.warn('[warn] README table markers not found; rows not appended');
  return false;
}
