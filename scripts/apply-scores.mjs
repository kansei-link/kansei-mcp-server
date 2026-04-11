#!/usr/bin/env node
// Apply the final felt-score formula to all 225 evaluations and produce
// evaluations-scored.json with continuous score + computed grade.

import fs from 'node:fs';
import path from 'node:path';

const evals = JSON.parse(
  fs.readFileSync(path.resolve('content/eval/evaluations.json'), 'utf8')
);

const FACADE_PENALTY = 15;
const BAND = { A_PLUS: 92, A: 82, B: 68, C: 35, D: 15 };
const TRUST_GATE = 4;

function feltScore(dims, facade) {
  const raw = dims.reduce((s, n) => s + n, 0);
  let score = ((raw - 5) / 20) * 100;
  if (facade) score -= FACADE_PENALTY;
  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  const trust = dims[4];
  const gate = trust >= TRUST_GATE;
  let computed_grade;
  if (score >= BAND.A_PLUS && gate) computed_grade = 'A+';
  else if (score >= BAND.A) computed_grade = 'A';
  else if (score >= BAND.B) computed_grade = 'B';
  else if (score >= BAND.C) computed_grade = 'C';
  else if (score >= BAND.D) computed_grade = 'D';
  else computed_grade = 'F';
  return { score, computed_grade, raw };
}

const scored = evals.map((e) => {
  const { score, computed_grade, raw } = feltScore(e.dims, e.facade);
  return {
    id: e.id,
    score,
    felt_grade: e.grade,
    computed_grade,
    grade_match: e.grade === computed_grade,
    dims: e.dims,
    facade: e.facade,
    raw_sum: raw,
    note: e.note,
    ...(e.facade_reason ? { facade_reason: e.facade_reason } : {}),
  };
});

// Sort by score descending
scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

fs.writeFileSync(
  path.resolve('content/eval/evaluations-scored.json'),
  JSON.stringify(scored, null, 2) + '\n'
);

// Print summary table
const match = scored.filter((s) => s.grade_match).length;
console.log(`Total: ${scored.length}`);
console.log(`Grade match: ${match}/${scored.length} = ${((match / scored.length) * 100).toFixed(1)}%`);
console.log('');
console.log('Top 20 (by score):');
console.log('rank | id                | score | felt | comp | match');
console.log('-----|-------------------|-------|------|------|------');
for (let i = 0; i < 20; i++) {
  const s = scored[i];
  console.log(
    `${String(i + 1).padStart(4)} | ${s.id.padEnd(17)} | ${String(s.score).padStart(5)} | ${s.felt_grade.padEnd(4)} | ${s.computed_grade.padEnd(4)} | ${s.grade_match ? '✓' : '✗'}`
  );
}
console.log('');
console.log('Bottom 10:');
for (let i = scored.length - 10; i < scored.length; i++) {
  const s = scored[i];
  console.log(
    `${String(i + 1).padStart(4)} | ${s.id.padEnd(17)} | ${String(s.score).padStart(5)} | ${s.felt_grade.padEnd(4)} | ${s.computed_grade.padEnd(4)} | ${s.grade_match ? '✓' : '✗'}`
  );
}

console.log('\n-> content/eval/evaluations-scored.json written');
