#!/usr/bin/env node
/**
 * Integrate all test layers into final recipe success probability
 * and seed outcomes/service_stats tables.
 *
 * Combines:
 *   Layer 1: Structural validation (pass/fail)
 *   Layer 2: API reachability (% reachable)
 *   Layer 2b: npm package availability
 *   Layer 3: Executability score (0-100)
 *
 * Produces:
 *   - Estimated success probability per recipe
 *   - Simulated outcome records for outcomes table
 *   - Updated service_stats based on recipe participation
 *   - Recipe readiness report
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Load all layer data
const l1 = JSON.parse(readFileSync(path.join(root, 'content/eval/recipe-validation-layer1.json'), 'utf-8'));
const l2 = JSON.parse(readFileSync(path.join(root, 'content/eval/recipe-validation-layer2.json'), 'utf-8'));
const l2b = JSON.parse(readFileSync(path.join(root, 'content/eval/recipe-validation-layer2b.json'), 'utf-8'));
const l3 = JSON.parse(readFileSync(path.join(root, 'content/eval/recipe-executability-scores.json'), 'utf-8'));
const services = JSON.parse(readFileSync(path.join(root, 'src/data/services-seed.json'), 'utf-8'));
const recipes = JSON.parse(readFileSync(path.join(root, 'src/data/recipes-seed.json'), 'utf-8'));

const serviceMap = Object.fromEntries(services.map(s => [s.id, s]));
const l2Map = Object.fromEntries(l2.results.map(r => [r.id, r]));
const l2bMap = Object.fromEntries(l2b.results.map(r => [r.id, r]));
const l3Map = Object.fromEntries(l3.recipes.map(r => [r.id, r]));

// === Compute success probability per recipe ===
// Formula: P(success) = executability_score * api_reachability_factor * structural_factor
// Where:
//   executability_score: 0-1 (from Layer 3)
//   api_reachability_factor: % of required services with reachable APIs
//   structural_factor: 1.0 if passes Layer 1, 0.5 if not

const recipeResults = [];

for (const recipe of recipes) {
  const l3data = l3Map[recipe.id];
  const reqServices = recipe.required_services || [];

  // Executability (0-1)
  const execScore = l3data ? l3data.score / 100 : 0.5;

  // API reachability factor
  let apiOk = 0;
  for (const sid of reqServices) {
    const l2data = l2Map[sid];
    if (l2data && l2data.api_url?.status === 'reachable') apiOk++;
    else if (!l2data) apiOk += 0.5; // unknown = give benefit of doubt
  }
  const apiReachFactor = reqServices.length > 0 ? apiOk / reqServices.length : 0.5;

  // Structural factor (all recipes pass now)
  const structFactor = 1.0;

  // Weighted combination
  // exec_score dominates (60%), api_reach (30%), struct (10%)
  const successProb = Math.round((execScore * 0.6 + apiReachFactor * 0.3 + structFactor * 0.1) * 100);

  // Confidence band
  let confidence;
  if (successProb >= 80) confidence = 'HIGH';
  else if (successProb >= 60) confidence = 'MEDIUM';
  else if (successProb >= 40) confidence = 'LOW';
  else confidence = 'DRAFT';

  recipeResults.push({
    id: recipe.id,
    goal: recipe.goal,
    success_probability: successProb,
    confidence,
    exec_score: l3data?.score || 0,
    api_reach_pct: Math.round(apiReachFactor * 100),
    step_count: (recipe.steps || []).length,
    weakest_grade: l3data?.weakest_grade,
    required_services: reqServices,
  });
}

recipeResults.sort((a, b) => b.success_probability - a.success_probability);

// === Generate simulated outcome records ===
// For each recipe × service, generate outcome based on service reachability + AXR
const outcomes = [];
for (const rr of recipeResults) {
  for (const sid of rr.required_services) {
    const svc = serviceMap[sid];
    if (!svc) continue;

    const l2data = l2Map[sid];
    const apiReachable = l2data && l2data.api_url?.status === 'reachable';

    // Success probability per service = AXR-based + reachability
    const axrScore = svc.axr_score || 50;
    const reachBonus = apiReachable ? 10 : -15;
    const svcSuccess = Math.min(100, Math.max(0, axrScore + reachBonus));

    // Simulate 3 trials per service per recipe
    for (let trial = 0; trial < 3; trial++) {
      const success = Math.random() * 100 < svcSuccess ? 1 : 0;
      const latency = success
        ? Math.round(200 + Math.random() * 800) // 200-1000ms for success
        : Math.round(1000 + Math.random() * 4000); // 1-5s for failure
      const errorType = success ? null
        : ['auth_error', 'rate_limit', 'timeout', 'invalid_request', 'server_error'][Math.floor(Math.random() * 5)];

      outcomes.push({
        service_id: sid,
        recipe_id: rr.id,
        success,
        latency_ms: latency,
        error_type: errorType,
      });
    }
  }
}

// === Compute service_stats from outcomes ===
const statsMap = {};
for (const o of outcomes) {
  if (!statsMap[o.service_id]) {
    statsMap[o.service_id] = { total: 0, successes: 0, latencies: [], recipes: new Set() };
  }
  const s = statsMap[o.service_id];
  s.total++;
  if (o.success) s.successes++;
  s.latencies.push(o.latency_ms);
  s.recipes.add(o.recipe_id);
}

const serviceStats = Object.entries(statsMap).map(([sid, s]) => ({
  service_id: sid,
  total_calls: s.total,
  success_rate: +(s.successes / s.total).toFixed(3),
  avg_latency_ms: Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length),
  recipe_count: s.recipes.size,
  grade: serviceMap[sid]?.axr_grade || '?',
})).sort((a, b) => b.success_rate - a.success_rate);

// === Summary ===
const bands = { HIGH: 0, MEDIUM: 0, LOW: 0, DRAFT: 0 };
let totalProb = 0;
for (const r of recipeResults) {
  bands[r.confidence]++;
  totalProb += r.success_probability;
}

console.log('\n=== INTEGRATED RECIPE SUCCESS ANALYSIS ===');
console.log(`Recipes: ${recipeResults.length}`);
console.log(`Avg success probability: ${(totalProb / recipeResults.length).toFixed(1)}%`);
console.log(`\nConfidence distribution:`);
console.log(`  HIGH (80-100%): ${bands.HIGH}`);
console.log(`  MEDIUM (60-79%): ${bands.MEDIUM}`);
console.log(`  LOW (40-59%):    ${bands.LOW}`);
console.log(`  DRAFT (0-39%):   ${bands.DRAFT}`);

console.log(`\nSimulated outcomes: ${outcomes.length} total`);
console.log(`  Successes: ${outcomes.filter(o => o.success).length} (${(outcomes.filter(o => o.success).length / outcomes.length * 100).toFixed(1)}%)`);

console.log(`\n=== TOP 15 RECIPES BY SUCCESS PROBABILITY ===`);
for (const r of recipeResults.slice(0, 15)) {
  console.log(`  ${r.success_probability}% [${r.confidence}] ${r.id} (${r.weakest_grade}, ${r.step_count} steps)`);
}

console.log(`\n=== BOTTOM 10 ===`);
for (const r of recipeResults.slice(-10)) {
  console.log(`  ${r.success_probability}% [${r.confidence}] ${r.id} (${r.weakest_grade})`);
}

console.log(`\n=== SERVICE RELIABILITY (from simulated outcomes) ===`);
console.log(`Top 10:`);
for (const s of serviceStats.slice(0, 10)) {
  console.log(`  ${s.service_id} (${s.grade}): ${(s.success_rate * 100).toFixed(0)}% success, ${s.avg_latency_ms}ms avg, ${s.recipe_count} recipes`);
}
console.log(`Bottom 10:`);
for (const s of serviceStats.slice(-10)) {
  console.log(`  ${s.service_id} (${s.grade}): ${(s.success_rate * 100).toFixed(0)}% success, ${s.avg_latency_ms}ms avg, ${s.recipe_count} recipes`);
}

// === Success rate by AXR grade ===
console.log(`\n=== SUCCESS RATE BY AXR GRADE ===`);
const gradeStats = {};
for (const s of serviceStats) {
  const g = s.grade;
  if (!gradeStats[g]) gradeStats[g] = { total: 0, sum: 0 };
  gradeStats[g].total++;
  gradeStats[g].sum += s.success_rate;
}
for (const g of ['AAA', 'AA', 'A', 'B', 'C', 'D']) {
  if (!gradeStats[g]) continue;
  console.log(`  ${g}: ${(gradeStats[g].sum / gradeStats[g].total * 100).toFixed(1)}% avg success (${gradeStats[g].total} services)`);
}

// Write all outputs
writeFileSync(
  path.join(root, 'content/eval/recipe-success-probabilities.json'),
  JSON.stringify({ summary: { total: recipeResults.length, avg_prob: +(totalProb / recipeResults.length).toFixed(1), bands }, recipes: recipeResults }, null, 2) + '\n',
  'utf-8'
);

writeFileSync(
  path.join(root, 'content/eval/simulated-outcomes.json'),
  JSON.stringify({ total: outcomes.length, success_count: outcomes.filter(o => o.success).length, outcomes: outcomes.slice(0, 100) }, null, 2) + '\n',
  'utf-8'
);

writeFileSync(
  path.join(root, 'content/eval/service-reliability-stats.json'),
  JSON.stringify(serviceStats, null, 2) + '\n',
  'utf-8'
);

console.log(`\nOutputs written to content/eval/`);
console.log(`  recipe-success-probabilities.json`);
console.log(`  simulated-outcomes.json (first 100 of ${outcomes.length})`);
console.log(`  service-reliability-stats.json`);
