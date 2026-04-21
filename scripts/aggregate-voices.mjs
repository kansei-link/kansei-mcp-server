#!/usr/bin/env node
/**
 * Synthesize an 'agent voice' row per service from the outcomes table.
 *
 * Logic:
 *   For each service with ≥ 3 outcomes in last 90 days, compute:
 *     - success_rate        : wins / total
 *     - median_latency_ms   : 50p
 *     - top_errors          : most frequent error_type, up to 3
 *     - common_workarounds  : most frequent workaround strings, up to 3
 *     - sample_size         : total outcomes window
 *     - confidence          : 'low' (<10), 'medium' (10-30), 'high' (30+)
 *
 *   Write one row to agent_voice_responses with:
 *     agent_type     = 'aggregated'
 *     agent_id       = 'kansei-link-synth'
 *     question_id    = 'auto_voice_summary'
 *     response_text  = human-readable narrative summary
 *     response_choice= grade ('works_well' | 'mostly_works' | 'needs_attention')
 *     confidence     = derived above
 *
 *   Dedupe: one synthesized row per service. If an existing one exists
 *   (same service + agent_type='aggregated' + question_id='auto_voice_summary'),
 *   UPDATE it rather than inserting.
 *
 * Safe to run as often as you like. Run after the crawler so new outcomes
 * immediately roll into aggregated voice.
 *
 *   node scripts/aggregate-voices.mjs
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const db = new Database(dbPath);

const WINDOW_DAYS = 90;
const MIN_OUTCOMES = 3;

// Load services that have at least MIN_OUTCOMES outcomes in the window.
const candidates = db
  .prepare(
    `SELECT o.service_id, s.name, COUNT(*) as total
     FROM outcomes o
     JOIN services s ON s.id = o.service_id
     WHERE o.created_at >= datetime('now', '-' || @days || ' days')
     GROUP BY o.service_id
     HAVING total >= @min
     ORDER BY total DESC`
  )
  .all({ days: WINDOW_DAYS, min: MIN_OUTCOMES });

console.log(`[agg-voices] ${candidates.length} services have ≥ ${MIN_OUTCOMES} outcomes in ${WINDOW_DAYS}d`);

const selectOutcomes = db.prepare(
  `SELECT success, latency_ms, error_type, workaround
   FROM outcomes
   WHERE service_id = @svc
     AND created_at >= datetime('now', '-' || @days || ' days')
   ORDER BY created_at DESC`
);

const selectExisting = db.prepare(
  `SELECT id FROM agent_voice_responses
   WHERE service_id = @svc
     AND agent_type = 'aggregated'
     AND question_id = 'auto_voice_summary'
   LIMIT 1`
);

const insertVoice = db.prepare(
  `INSERT INTO agent_voice_responses
    (service_id, agent_type, agent_id, question_id, response_choice, response_text, confidence, created_at)
   VALUES (@svc, 'aggregated', 'kansei-link-synth', 'auto_voice_summary',
           @grade, @text, @confidence, datetime('now'))`
);

const updateVoice = db.prepare(
  `UPDATE agent_voice_responses
   SET response_choice = @grade,
       response_text = @text,
       confidence = @confidence,
       created_at = datetime('now')
   WHERE id = @id`
);

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function topKFreq(items, k = 3) {
  const counts = new Map();
  for (const x of items) {
    if (!x) continue;
    const key = String(x).trim();
    if (!key || key.length > 200) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([text, count]) => ({ text, count }));
}

function grade(successRate) {
  if (successRate >= 0.85) return "works_well";
  if (successRate >= 0.6) return "mostly_works";
  return "needs_attention";
}

function confidenceOf(n) {
  if (n >= 30) return "high";
  if (n >= 10) return "medium";
  return "low";
}

function renderText(name, stats) {
  const pct = Math.round(stats.successRate * 100);
  const parts = [];
  parts.push(`${name} succeeds on ${pct}% of calls (n=${stats.sample})`);
  if (stats.medianLatency) parts.push(`median latency ${stats.medianLatency}ms`);
  if (stats.topErrors.length > 0) {
    const errStr = stats.topErrors
      .slice(0, 2)
      .map((e) => `${e.text} (${e.count}x)`)
      .join(", ");
    parts.push(`most common errors: ${errStr}`);
  }
  if (stats.topWorkarounds.length > 0) {
    const waStr = stats.topWorkarounds
      .slice(0, 1)
      .map((w) => `"${w.text.slice(0, 120)}"`)
      .join(", ");
    parts.push(`common workaround: ${waStr}`);
  }
  return parts.join(". ") + ".";
}

let inserted = 0;
let updated = 0;

const tx = db.transaction(() => {
  for (const cand of candidates) {
    const rows = selectOutcomes.all({ svc: cand.service_id, days: WINDOW_DAYS });
    const successCount = rows.filter((r) => r.success === 1).length;
    const successRate = rows.length > 0 ? successCount / rows.length : 0;
    const latencies = rows.map((r) => r.latency_ms).filter((l) => l > 0);
    const topErrors = topKFreq(rows.filter((r) => r.success === 0).map((r) => r.error_type));
    const topWorkarounds = topKFreq(rows.map((r) => r.workaround));

    const stats = {
      sample: rows.length,
      successRate,
      medianLatency: median(latencies),
      topErrors,
      topWorkarounds,
    };

    const gradeLabel = grade(successRate);
    const text = renderText(cand.name, stats);
    const confidence = confidenceOf(rows.length);

    const existing = selectExisting.get({ svc: cand.service_id });
    if (existing) {
      updateVoice.run({ id: existing.id, grade: gradeLabel, text, confidence });
      updated++;
    } else {
      insertVoice.run({ svc: cand.service_id, grade: gradeLabel, text, confidence });
      inserted++;
    }
  }
});
tx();

console.log(`[agg-voices] inserted: ${inserted}, updated: ${updated}`);
console.log();

// Show 3 examples for sanity check
const samples = db
  .prepare(
    `SELECT v.service_id, s.name, v.response_choice, v.confidence, substr(v.response_text, 1, 180) as text
     FROM agent_voice_responses v
     JOIN services s ON s.id = v.service_id
     WHERE v.agent_type = 'aggregated' AND v.question_id = 'auto_voice_summary'
     ORDER BY v.created_at DESC
     LIMIT 3`
  )
  .all();

if (samples.length > 0) {
  console.log("=== Sample aggregated voices ===");
  for (const s of samples) {
    console.log(`[${s.response_choice}][${s.confidence}] ${s.name}`);
    console.log(`  ${s.text}`);
    console.log();
  }
}

db.close();
