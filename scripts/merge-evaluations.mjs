#!/usr/bin/env node
// Merge all evaluations-batch-*.json into a single evaluations.json
// Also produces a summary distribution.

import fs from 'node:fs';
import path from 'node:path';

const evalDir = path.resolve('content/eval');
const batchFiles = fs
  .readdirSync(evalDir)
  .filter((f) => /^evaluations-batch-\d+\.json$/.test(f))
  .sort();

const all = [];
const seen = new Set();
const dupes = [];

for (const f of batchFiles) {
  const items = JSON.parse(fs.readFileSync(path.join(evalDir, f), 'utf8'));
  for (const item of items) {
    if (seen.has(item.id)) {
      dupes.push({ id: item.id, file: f });
      continue;
    }
    seen.add(item.id);
    all.push({ ...item, _batch: f });
  }
}

// Write merged
fs.writeFileSync(
  path.join(evalDir, 'evaluations.json'),
  JSON.stringify(
    all.map(({ _batch, ...rest }) => rest),
    null,
    2
  ) + '\n'
);

// Load eval-input.json to cross-check coverage
const evalInput = JSON.parse(
  fs.readFileSync(path.join(evalDir, 'eval-input.json'), 'utf8')
);
const inputIds = new Set(evalInput.map((s) => s.id));
const evaluatedIds = new Set(all.map((s) => s.id));
const missing = [...inputIds].filter((id) => !evaluatedIds.has(id));
const extra = [...evaluatedIds].filter((id) => !inputIds.has(id));

// Distribution
const gradeCount = {};
const facadeCount = { true: 0, false: 0 };
const dimSums = [0, 0, 0, 0, 0];
const dimCounts = [0, 0, 0, 0, 0];
const gradeServices = {};

for (const e of all) {
  gradeCount[e.grade] = (gradeCount[e.grade] || 0) + 1;
  facadeCount[e.facade ? 'true' : 'false']++;
  gradeServices[e.grade] = gradeServices[e.grade] || [];
  gradeServices[e.grade].push(e.id);
  if (Array.isArray(e.dims)) {
    for (let i = 0; i < 5; i++) {
      if (typeof e.dims[i] === 'number') {
        dimSums[i] += e.dims[i];
        dimCounts[i]++;
      }
    }
  }
}

const dimAvg = dimSums.map((s, i) =>
  dimCounts[i] ? (s / dimCounts[i]).toFixed(2) : 'N/A'
);

// Facade services list
const facadeServices = all
  .filter((e) => e.facade === true)
  .map((e) => ({ id: e.id, grade: e.grade, reason: e.facade_reason || e.note }));

const gradeOrder = ['A+', 'A', 'B', 'C', 'D', 'F'];
const summary = {
  total: all.length,
  expected: inputIds.size,
  missing,
  extra,
  duplicates: dupes,
  grade_distribution: Object.fromEntries(
    gradeOrder.filter((g) => gradeCount[g]).map((g) => [g, gradeCount[g]])
  ),
  grade_percentage: Object.fromEntries(
    gradeOrder
      .filter((g) => gradeCount[g])
      .map((g) => [g, ((gradeCount[g] / all.length) * 100).toFixed(1) + '%'])
  ),
  facade_distribution: facadeCount,
  facade_services: facadeServices,
  dimension_averages: {
    d1_discoverability: dimAvg[0],
    d2_onboarding: dimAvg[1],
    d3_auth_clarity: dimAvg[2],
    d4_capability_signal: dimAvg[3],
    d5_trust_signal: dimAvg[4],
  },
};

fs.writeFileSync(
  path.join(evalDir, 'evaluations-summary.json'),
  JSON.stringify(summary, null, 2) + '\n'
);

// Also write grade-grouped service list for quick inspection
fs.writeFileSync(
  path.join(evalDir, 'evaluations-by-grade.json'),
  JSON.stringify(
    Object.fromEntries(
      gradeOrder
        .filter((g) => gradeServices[g])
        .map((g) => [g, gradeServices[g].sort()])
    ),
    null,
    2
  ) + '\n'
);

console.log('=== MERGE COMPLETE ===');
console.log(`Total evaluated: ${all.length} / ${inputIds.size} expected`);
console.log(`Missing: ${missing.length}`, missing.slice(0, 10));
console.log(`Extra:   ${extra.length}`, extra.slice(0, 10));
console.log(`Dupes:   ${dupes.length}`);
console.log('');
console.log('Grade distribution:');
for (const g of gradeOrder) {
  if (gradeCount[g]) {
    const pct = ((gradeCount[g] / all.length) * 100).toFixed(1);
    console.log(`  ${g.padEnd(3)}: ${String(gradeCount[g]).padStart(3)}  (${pct}%)`);
  }
}
console.log('');
console.log(`Facade: ${facadeCount.true} true / ${facadeCount.false} false`);
console.log('');
console.log('Dimension averages:');
console.log(`  D1 Discoverability : ${dimAvg[0]}`);
console.log(`  D2 Onboarding      : ${dimAvg[1]}`);
console.log(`  D3 Auth Clarity    : ${dimAvg[2]}`);
console.log(`  D4 Capability      : ${dimAvg[3]}`);
console.log(`  D5 Trust Signal    : ${dimAvg[4]}`);
console.log('');
console.log('Output files:');
console.log('  content/eval/evaluations.json           (all 225 evals)');
console.log('  content/eval/evaluations-summary.json   (distribution)');
console.log('  content/eval/evaluations-by-grade.json  (grouped by grade)');
