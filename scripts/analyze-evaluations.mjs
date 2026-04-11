#!/usr/bin/env node
// Stage A: Descriptive analysis of felt evaluations.
// Goal: Understand how the felt grades map to dimension space, so we can
// retrofit a numerical formula that reproduces the felt judgment.

import fs from 'node:fs';
import path from 'node:path';

const evalPath = path.resolve('content/eval/evaluations.json');
const evals = JSON.parse(fs.readFileSync(evalPath, 'utf8'));

// Grade rank (higher = better)
const GRADE_RANK = { 'A+': 6, A: 5, B: 4, C: 3, D: 2, F: 1 };
const RANK_GRADE = Object.fromEntries(
  Object.entries(GRADE_RANK).map(([k, v]) => [v, k])
);

// ---------- 1. Per-grade sum statistics ----------
function stats(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((s, n) => s + n, 0);
  return {
    n: nums.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: +(sum / nums.length).toFixed(2),
    median: sorted[Math.floor(sorted.length / 2)],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
  };
}

const byGrade = {};
for (const e of evals) {
  byGrade[e.grade] = byGrade[e.grade] || [];
  byGrade[e.grade].push(e);
}

console.log('=== STAGE A: DESCRIPTIVE STATISTICS ===\n');

console.log('--- 1. Simple sum(dims) per grade ---');
console.log('grade | n   | min | p25 | med | p75 | max | mean');
console.log('------|-----|-----|-----|-----|-----|-----|------');
for (const g of ['A+', 'A', 'B', 'C', 'D', 'F']) {
  const items = byGrade[g] || [];
  if (!items.length) continue;
  const sums = items.map((e) => e.dims.reduce((s, n) => s + n, 0));
  const s = stats(sums);
  console.log(
    `${g.padEnd(5)} | ${String(s.n).padStart(3)} | ${String(s.min).padStart(3)} | ${String(s.p25).padStart(3)} | ${String(s.median).padStart(3)} | ${String(s.p75).padStart(3)} | ${String(s.max).padStart(3)} | ${String(s.mean).padStart(5)}`
  );
}

// ---------- 2. Per-grade per-dimension means ----------
console.log('\n--- 2. Per-grade per-dim MEAN (expose what carries the grade) ---');
console.log('grade | n   |  D1  |  D2  |  D3  |  D4  |  D5  | SUM');
console.log('------|-----|------|------|------|------|------|------');
for (const g of ['A+', 'A', 'B', 'C', 'D', 'F']) {
  const items = byGrade[g] || [];
  if (!items.length) continue;
  const means = [0, 0, 0, 0, 0];
  for (const e of items) {
    for (let i = 0; i < 5; i++) means[i] += e.dims[i];
  }
  for (let i = 0; i < 5; i++) means[i] = +(means[i] / items.length).toFixed(2);
  const sum = +means.reduce((a, b) => a + b, 0).toFixed(2);
  console.log(
    `${g.padEnd(5)} | ${String(items.length).padStart(3)} | ${means
      .map((m) => m.toFixed(2).padStart(4))
      .join(' | ')} | ${sum.toFixed(2)}`
  );
}

// ---------- 3. Dimension correlation with grade rank ----------
function corr(x, y) {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

console.log(
  '\n--- 3. Correlation of each dim with grade rank (A+=6, A=5, ..., D=2) ---'
);
const ranks = evals.map((e) => GRADE_RANK[e.grade]);
for (let i = 0; i < 5; i++) {
  const col = evals.map((e) => e.dims[i]);
  console.log(`  D${i + 1}: r = ${corr(col, ranks).toFixed(3)}`);
}
const sums = evals.map((e) => e.dims.reduce((s, n) => s + n, 0));
console.log(`  SUM: r = ${corr(sums, ranks).toFixed(3)}`);

// ---------- 4. Facade analysis ----------
console.log('\n--- 4. Facade services: dims look high but grade was pulled down ---');
console.log('id                | grade | dims          | sum | dim-implied-grade-band');
console.log('------------------|-------|---------------|-----|----------------------');
const facades = evals.filter((e) => e.facade === true);
function sumToBand(s) {
  if (s >= 23) return 'A+ (23-25)';
  if (s >= 20) return 'A  (20-22)';
  if (s >= 16) return 'B  (16-19)';
  if (s >= 12) return 'C  (12-15)';
  if (s >= 8) return 'D  (8-11)';
  return 'F  (5-7)';
}
for (const e of facades) {
  const s = e.dims.reduce((a, b) => a + b, 0);
  console.log(
    `${e.id.padEnd(18)}| ${e.grade.padEnd(5)} | [${e.dims.join(',')}] | ${String(s).padStart(3)} | ${sumToBand(s)}`
  );
}

// ---------- 5. Agreement matrix: naive sum-band vs felt grade ----------
console.log('\n--- 5. Naive sum-band vs felt grade (AGREEMENT MATRIX) ---');
console.log(
  'rows = felt grade, cols = naive band from sum(dims) using 23/20/16/12/8 cutoffs\n'
);
const matrix = {};
for (const g of ['A+', 'A', 'B', 'C', 'D', 'F']) matrix[g] = {};
for (const e of evals) {
  const s = e.dims.reduce((a, b) => a + b, 0);
  const band = sumToBand(s).slice(0, 2).trim();
  matrix[e.grade][band] = (matrix[e.grade][band] || 0) + 1;
}
const bands = ['A+', 'A', 'B', 'C', 'D', 'F'];
console.log('felt\\band | ' + bands.map((b) => b.padStart(4)).join(' ') + '  | total');
console.log('----------|' + bands.map(() => '-----').join('') + '--|------');
for (const g of bands) {
  if (!byGrade[g]) continue;
  const row = bands.map((b) => matrix[g][b] || 0);
  const total = row.reduce((a, b) => a + b, 0);
  console.log(
    `${g.padEnd(9)} | ${row.map((n) => String(n).padStart(4)).join(' ')}  | ${total}`
  );
}

// How many match exactly?
let agree = 0;
let within1 = 0;
let mismatches = [];
for (const e of evals) {
  const s = e.dims.reduce((a, b) => a + b, 0);
  const naiveBand = sumToBand(s).slice(0, 2).trim();
  if (naiveBand === e.grade) agree++;
  const diff = Math.abs(GRADE_RANK[naiveBand] - GRADE_RANK[e.grade]);
  if (diff <= 1) within1++;
  if (naiveBand !== e.grade) {
    mismatches.push({ id: e.id, felt: e.grade, naive: naiveBand, sum: s, facade: e.facade });
  }
}
console.log(
  `\nExact agreement: ${agree}/${evals.length} = ${((agree / evals.length) * 100).toFixed(1)}%`
);
console.log(
  `Within 1 grade:  ${within1}/${evals.length} = ${((within1 / evals.length) * 100).toFixed(1)}%`
);

// Show first 15 mismatches
console.log('\n--- 6. Top mismatches (felt vs naive sum band) ---');
mismatches.sort((a, b) => {
  const da = Math.abs(GRADE_RANK[a.naive] - GRADE_RANK[a.felt]);
  const db = Math.abs(GRADE_RANK[b.naive] - GRADE_RANK[b.felt]);
  return db - da;
});
console.log('id                | felt | naive | sum | facade');
console.log('------------------|------|-------|-----|-------');
for (const m of mismatches.slice(0, 20)) {
  console.log(
    `${m.id.padEnd(18)}| ${m.felt.padEnd(4)} | ${m.naive.padEnd(5)} | ${String(m.sum).padStart(3)} | ${m.facade}`
  );
}

// ---------- 6. What distinguishes A+ from A? ----------
console.log('\n--- 7. A+ vs A: per-dim distinction ---');
const aplus = byGrade['A+'] || [];
const a = byGrade['A'] || [];
console.log('dim | A+ mean | A mean | delta');
for (let i = 0; i < 5; i++) {
  const mp = aplus.reduce((s, e) => s + e.dims[i], 0) / aplus.length;
  const ma = a.reduce((s, e) => s + e.dims[i], 0) / a.length;
  console.log(`D${i + 1}  | ${mp.toFixed(2)}    | ${ma.toFixed(2)}   | ${(mp - ma).toFixed(2)}`);
}

// Save mismatch report
fs.writeFileSync(
  path.resolve('content/eval/analysis-stage-a.json'),
  JSON.stringify(
    {
      total: evals.length,
      per_grade: Object.fromEntries(
        Object.entries(byGrade).map(([g, items]) => [
          g,
          {
            n: items.length,
            sum_stats: stats(items.map((e) => e.dims.reduce((a, b) => a + b, 0))),
            dim_means: [0, 1, 2, 3, 4].map(
              (i) => +(items.reduce((s, e) => s + e.dims[i], 0) / items.length).toFixed(2)
            ),
          },
        ])
      ),
      naive_agreement: {
        exact: agree,
        within_1: within1,
        total: evals.length,
        exact_pct: +((agree / evals.length) * 100).toFixed(1),
        within_1_pct: +((within1 / evals.length) * 100).toFixed(1),
      },
      mismatches: mismatches.slice(0, 30),
      dim_correlations_with_grade_rank: [0, 1, 2, 3, 4].map((i) => ({
        dim: `D${i + 1}`,
        r: +corr(
          evals.map((e) => e.dims[i]),
          ranks
        ).toFixed(3),
      })),
    },
    null,
    2
  ) + '\n'
);
console.log('\n-> content/eval/analysis-stage-a.json written');
