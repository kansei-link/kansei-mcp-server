#!/usr/bin/env node
// Inject AXR scores from evaluations-scored-v2.json into services-seed.json.
// This adds axr_score, axr_grade, axr_dims, axr_facade to each service.

import fs from 'node:fs';
import path from 'node:path';

const servicesPath = path.resolve('src/data/services-seed.json');
const evalsPath = path.resolve('content/eval/evaluations-scored-v2.json');

const services = JSON.parse(fs.readFileSync(servicesPath, 'utf8'));
const evals = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));

// Build lookup from evaluations
const evalMap = new Map();
for (const e of evals) {
  evalMap.set(e.id, e);
}

let matched = 0;
let unmatched = 0;
const unmatchedIds = [];

for (const svc of services) {
  const ev = evalMap.get(svc.id);
  if (ev) {
    svc.axr_score = ev.score;
    svc.axr_grade = ev.grade;
    svc.axr_dims = ev.dims;
    svc.axr_facade = ev.facade ? 1 : 0;
    matched++;
  } else {
    // Service exists in seed but wasn't evaluated (shouldn't happen for 225/225)
    unmatched++;
    unmatchedIds.push(svc.id);
  }
}

// Also check for services in eval but not in seed
const serviceIds = new Set(services.map((s) => s.id));
const evalOnlyIds = evals.filter((e) => !serviceIds.has(e.id)).map((e) => e.id);

fs.writeFileSync(servicesPath, JSON.stringify(services, null, 2) + '\n');

console.log(`Matched: ${matched}/${services.length} services updated with AXR`);
console.log(`Unmatched in seed: ${unmatched}`, unmatchedIds.slice(0, 10));
console.log(`In eval but not seed: ${evalOnlyIds.length}`, evalOnlyIds.slice(0, 10));

// Print grade distribution in seed
const dist = {};
for (const s of services) {
  if (s.axr_grade) dist[s.axr_grade] = (dist[s.axr_grade] || 0) + 1;
}
console.log('\nGrade distribution in services-seed.json:');
for (const g of ['AAA', 'AA', 'A', 'B', 'C', 'D', 'F']) {
  if (dist[g]) console.log(`  ${g.padEnd(4)}: ${dist[g]}`);
}
