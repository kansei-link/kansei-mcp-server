#!/usr/bin/env node
// Apply the AAA/AA/A credit-rating system to all 225 evaluations.

import fs from 'node:fs';
import path from 'node:path';

const evals = JSON.parse(
  fs.readFileSync(path.resolve('content/eval/evaluations.json'), 'utf8')
);

const FACADE_PENALTY = 15;
const BAND = { AAA: 92, AA: 90, A: 82, B: 68, C: 35, D: 15 };
const TRUST_GATE = 4;
const CAP_GATE = 5;

function feltScore(dims, facade) {
  const raw = dims.reduce((s, n) => s + n, 0);
  let score = ((raw - 5) / 20) * 100;
  if (facade) score -= FACADE_PENALTY;
  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  const [d1, d2, d3, d4, d5] = dims;
  const trustOK = d5 >= TRUST_GATE;
  const capOK = d2 >= CAP_GATE && d3 >= CAP_GATE;
  let grade;
  if (score >= BAND.AAA && trustOK && capOK) grade = 'AAA';
  else if (score >= BAND.AA) grade = 'AA';
  else if (score >= BAND.A) grade = 'A';
  else if (score >= BAND.B) grade = 'B';
  else if (score >= BAND.C) grade = 'C';
  else if (score >= BAND.D) grade = 'D';
  else grade = 'F';
  return { score, grade, raw };
}

// Map old felt grade to new system for comparison
function feltToNew(g) {
  return g === 'A+' ? 'AAA' : g;
}

const scored = evals.map((e) => {
  const { score, grade, raw } = feltScore(e.dims, e.facade);
  return {
    id: e.id,
    score,
    grade,
    felt_grade: e.grade,
    felt_mapped: feltToNew(e.grade),
    grade_match: grade === feltToNew(e.grade),
    dims: e.dims,
    facade: e.facade,
    raw_sum: raw,
    note: e.note,
  };
});

scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

// Grade distribution
const dist = {};
for (const s of scored) dist[s.grade] = (dist[s.grade] || 0) + 1;

console.log('=== AAA/AA/A CREDIT RATING SYSTEM ===\n');
console.log('Grade distribution:');
const order = ['AAA', 'AA', 'A', 'B', 'C', 'D', 'F'];
for (const g of order) {
  if (!dist[g]) continue;
  const pct = ((dist[g] / scored.length) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(dist[g] / 2));
  console.log(`  ${g.padEnd(4)}: ${String(dist[g]).padStart(3)}  (${pct.padStart(5)}%)  ${bar}`);
}

// Agreement with felt grades (mapping A+ → AAA)
const match = scored.filter((s) => s.grade_match).length;
console.log(`\nAgreement with felt grades: ${match}/${scored.length} = ${((match / scored.length) * 100).toFixed(1)}%`);

// AAA services
const aaa = scored.filter((s) => s.grade === 'AAA');
console.log(`\n=== AAA (${aaa.length}) — MCP自身が罠を警告、エージェント安心感MAX ===`);
for (const s of aaa) {
  const marker = s.felt_grade === 'A+' ? '✓ felt A+' : '★ NEW';
  console.log(`  ${s.id.padEnd(20)} score=${s.score}  [${s.dims.join(',')}]  ${marker}`);
}

// AA services
const aa = scored.filter((s) => s.grade === 'AA');
console.log(`\n=== AA (${aa.length}) — ガイド完備＋trust signal ===`);
for (const s of aa) {
  console.log(`  ${s.id.padEnd(20)} score=${s.score}  [${s.dims.join(',')}]  felt:${s.felt_grade}`);
}

// A services
const a = scored.filter((s) => s.grade === 'A');
console.log(`\n=== A (${a.length}) — ガイドあり、実装可能 ===`);
for (const s of a) {
  console.log(`  ${s.id.padEnd(20)} score=${s.score}  [${s.dims.join(',')}]  felt:${s.felt_grade}`);
}

// Mismatches
const mismatches = scored.filter((s) => !s.grade_match);
console.log(`\n=== Mismatches: ${mismatches.length} ===`);
console.log('id                | felt(mapped) | computed | score | why');
console.log('------------------|-------------|----------|-------|----');
for (const m of mismatches.slice(0, 25)) {
  let why = '';
  if (m.felt_mapped === 'AAA' && m.grade === 'AA') why = 'trust OK but cap gate failed';
  else if (m.felt_mapped === 'A' && m.grade === 'AA') why = 'score≥90, felt was conservative';
  else if (m.felt_mapped === 'A' && m.grade === 'AAA') why = 'formula promotes, felt held back';
  else if (m.felt_mapped === 'A' && m.grade === 'B') why = 'sum=20-21, border zone';
  else if (m.felt_mapped === 'B' && m.grade === 'C') why = 'facade penalty';
  else if (m.felt_mapped === 'C' && m.grade === 'B') why = 'sum=19, border B/C';
  else why = `${m.felt_mapped}→${m.grade}`;
  console.log(
    `${m.id.padEnd(18)}| ${m.felt_mapped.padEnd(11)} | ${m.grade.padEnd(8)} | ${String(m.score).padStart(5)} | ${why}`
  );
}

// Save
fs.writeFileSync(
  path.resolve('content/eval/evaluations-scored-v2.json'),
  JSON.stringify(
    scored.map(({ grade_match, felt_mapped, ...rest }) => ({
      ...rest,
      grade_match,
    })),
    null,
    2
  ) + '\n'
);
console.log('\n-> content/eval/evaluations-scored-v2.json written');
