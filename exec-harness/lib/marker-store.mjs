export function effectiveAgentCount(db, markerId) {
  if (!db || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='marker_readings'").get()) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM marker_readings r
    WHERE r.marker_id = ? AND r.outcome_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM marker_readings s WHERE s.supersedes = r.reading_id)`).get(markerId).n;
}

export function hasReadingCapacity(db, markerId, max, pending = [], replacing = false) {
  const additions = pending.filter((r) => r._outcome && !r.supersedes).length;
  return effectiveAgentCount(db, markerId) + additions + (replacing ? 0 : 1) <= max;
}

/** A correction must target an effective row of the same marker and subject. */
export function validateSupersedes(db, id, { markerId, digest, serviceId, agent }) {
  if (!id) return;
  const row = db.prepare(`SELECT * FROM marker_readings r WHERE reading_id = ?
    AND NOT EXISTS (SELECT 1 FROM marker_readings s WHERE s.supersedes = r.reading_id)`).get(id);
  if (!row || row.marker_id !== markerId || row.expected_digest !== digest ||
      JSON.parse(row.target_json).service_id !== serviceId || (row.outcome_id != null) !== agent) {
    throw new Error('supersedes must name an effective reading of the same marker, digest, service and subject');
  }
}
