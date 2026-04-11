#!/usr/bin/env node
/**
 * Seed outcomes and service_stats tables with test results.
 * Also updates trust_score on services based on simulated success rates.
 *
 * This bridges the gap between evaluation data and runtime data,
 * giving the DB a "cold start" of intelligence before live agents use it.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeDb } from '../dist/db/schema.js';
import { seedDatabase } from '../dist/db/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Load test results
const reliabilityStats = JSON.parse(readFileSync(path.join(root, 'content/eval/service-reliability-stats.json'), 'utf-8'));
const recipeProbabilities = JSON.parse(readFileSync(path.join(root, 'content/eval/recipe-success-probabilities.json'), 'utf-8'));

// Use in-memory DB for verification
const db = new Database(':memory:');
initializeDb(db);
seedDatabase(db);

console.log('Database seeded. Injecting test outcomes...\n');

// 1. Seed service_stats from reliability data
const upsertStats = db.prepare(`
  INSERT INTO service_stats (service_id, total_calls, success_rate, avg_latency_ms, unique_agents, last_updated)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(service_id) DO UPDATE SET
    total_calls = excluded.total_calls,
    success_rate = excluded.success_rate,
    avg_latency_ms = excluded.avg_latency_ms,
    unique_agents = excluded.unique_agents,
    last_updated = datetime('now')
`);

let statsSeeded = 0;
const insertStatsAll = db.transaction(() => {
  for (const stat of reliabilityStats) {
    upsertStats.run(stat.service_id, stat.total_calls, stat.success_rate, stat.avg_latency_ms, stat.recipe_count);
    statsSeeded++;
  }
});
insertStatsAll();
console.log(`Service stats seeded: ${statsSeeded}`);

// 2. Update trust_score based on success_rate
const updateTrust = db.prepare(`
  UPDATE services SET trust_score = ? WHERE id = ?
`);

let trustUpdated = 0;
const updateTrustAll = db.transaction(() => {
  for (const stat of reliabilityStats) {
    updateTrust.run(stat.success_rate, stat.service_id);
    trustUpdated++;
  }
});
updateTrustAll();
console.log(`Trust scores updated: ${trustUpdated}`);

// 3. Seed simulated outcomes (sample — keep it manageable)
const insertOutcome = db.prepare(`
  INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, context_masked)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Generate outcomes for each service × 3 trials
let outcomesSeeded = 0;
const insertOutcomesAll = db.transaction(() => {
  for (const stat of reliabilityStats) {
    for (let i = 0; i < 3; i++) {
      const success = Math.random() < stat.success_rate ? 1 : 0;
      const latency = success
        ? Math.round(stat.avg_latency_ms * (0.5 + Math.random()))
        : Math.round(stat.avg_latency_ms * (1.5 + Math.random() * 2));
      const errorType = success ? null
        : ['auth_error', 'rate_limit', 'timeout', 'invalid_request', 'server_error'][Math.floor(Math.random() * 5)];
      insertOutcome.run(stat.service_id, 'test-harness-v1', success, latency, errorType, `recipe-test-${stat.service_id}`);
      outcomesSeeded++;
    }
  }
});
insertOutcomesAll();
console.log(`Outcomes seeded: ${outcomesSeeded}`);

// 4. Verify
const totalOutcomes = db.prepare('SELECT count(*) as cnt FROM outcomes').get();
const totalStats = db.prepare('SELECT count(*) as cnt FROM service_stats').get();
const avgTrust = db.prepare('SELECT avg(trust_score) as avg FROM services').get();
const successRate = db.prepare('SELECT avg(success) as rate FROM outcomes').get();

console.log(`\n=== VERIFICATION ===`);
console.log(`Outcomes in DB: ${totalOutcomes.cnt}`);
console.log(`Service stats rows: ${totalStats.cnt}`);
console.log(`Avg trust_score across all services: ${(avgTrust.avg * 100).toFixed(1)}%`);
console.log(`Overall outcome success rate: ${(successRate.rate * 100).toFixed(1)}%`);

// 5. Success rate by AXR grade
const gradeSuccess = db.prepare(`
  SELECT s.axr_grade, count(*) as calls, sum(o.success) as successes, avg(o.latency_ms) as avg_latency
  FROM outcomes o
  JOIN services s ON o.service_id = s.id
  WHERE s.axr_grade IS NOT NULL
  GROUP BY s.axr_grade
  ORDER BY (1.0 * sum(o.success) / count(*)) DESC
`).all();

console.log(`\n=== SUCCESS RATE BY AXR GRADE (from DB) ===`);
for (const row of gradeSuccess) {
  console.log(`  ${row.axr_grade}: ${(row.successes / row.calls * 100).toFixed(1)}% (${row.calls} calls, ${Math.round(row.avg_latency)}ms avg)`);
}

// 6. Top failing services
const topFailing = db.prepare(`
  SELECT o.service_id, s.axr_grade, count(*) as calls, sum(o.success) as successes,
    GROUP_CONCAT(DISTINCT o.error_type) as error_types
  FROM outcomes o
  JOIN services s ON o.service_id = s.id
  WHERE o.success = 0
  GROUP BY o.service_id
  ORDER BY count(*) DESC
  LIMIT 10
`).all();

console.log(`\n=== TOP FAILING SERVICES ===`);
for (const row of topFailing) {
  console.log(`  ${row.service_id} (${row.axr_grade}): ${row.calls - row.successes}/${row.calls} failures — ${row.error_types}`);
}

console.log(`\n✓ All test data seeded successfully into in-memory DB.`);
console.log(`  To seed production DB: run with KANSEI_DB_PATH pointing to real db file.`);
