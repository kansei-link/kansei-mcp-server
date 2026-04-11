#!/usr/bin/env node
// Stage C: Apply the proposed formula back to the 225 evaluations and
// measure agreement with the felt grade. Also explore alternative band
// cutoffs and report the best-fit configuration.

import fs from 'node:fs';
import path from 'node:path';

const evals = JSON.parse(
  fs.readFileSync(path.resolve('content/eval/evaluations.json'), 'utf8')
);

const GRADE_RANK = { 'A+': 6, A: 5, B: 4, C: 3, D: 2, F: 1 };

// Replicated formula (JS version of src/utils/felt-score.ts)
function feltScore({ dims, facade = false }, bands = null) {
  const B = bands || { A_PLUS: 92, A: 82, B: 65, C: 40, D: 20 };
  const TRUST_GATE = 4;
  const raw = dims.reduce((s, n) => s + n, 0);
  let score = ((raw - 5) / 20) * 100;
  if (facade) score -= 15;
  score = Math.max(0, Math.min(100, score));
  score = Math.round(score * 10) / 10;
  const trust = dims[4];
  const gate = trust >= TRUST_GATE;
  let grade;
  if (score >= B.A_PLUS && gate) grade = 'A+';
  else if (score >= B.A) grade = 'A';
  else if (score >= B.B) grade = 'B';
  else if (score >= B.C) grade = 'C';
  else if (score >= B.D) grade = 'D';
  else grade = 'F';
  return { score, grade, raw };
}

function measure(evals, bands) {
  let exact = 0;
  let within1 = 0;
  const confusion = {};
  const mismatches = [];
  for (const e of evals) {
    const r = feltScore({ dims: e.dims, facade: e.facade }, bands);
    const felt = e.grade;
    const pred = r.grade;
    if (pred === felt) exact++;
    if (Math.abs(GRADE_RANK[pred] - GRADE_RANK[felt]) <= 1) within1++;
    confusion[felt] = confusion[felt] || {};
    confusion[felt][pred] = (confusion[felt][pred] || 0) + 1;
    if (pred !== felt) {
      mismatches.push({
        id: e.id,
        felt,
        pred,
        score: r.score,
        raw: r.raw,
        facade: e.facade,
        dims: e.dims,
      });
    }
  }
  return { exact, within1, total: evals.length, confusion, mismatches };
}

// ----- 1. Default formula -----
console.log('=== STAGE C: FORMULA VALIDATION ===\n');
console.log('--- 1. Default formula (bands: 92/82/65/40/20) ---');
const result = measure(evals);
console.log(
  `Exact agreement: ${result.exact}/${result.total} = ${((result.exact / result.total) * 100).toFixed(1)}%`
);
console.log(
  `Within 1 grade:  ${result.within1}/${result.total} = ${((result.within1 / result.total) * 100).toFixed(1)}%`
);

console.log('\nConfusion matrix (row=felt, col=predicted):');
const gr = ['A+', 'A', 'B', 'C', 'D', 'F'];
console.log('felt\\pred | ' + gr.map((g) => g.padStart(4)).join(' '));
console.log('----------|' + gr.map(() => '-----').join(''));
for (const g of gr) {
  if (!result.confusion[g]) continue;
  const row = gr.map((p) => result.confusion[g]?.[p] || 0);
  console.log(`${g.padEnd(9)} | ${row.map((n) => String(n).padStart(4)).join(' ')}`);
}

// ----- 2. Grid search over bands -----
console.log('\n--- 2. Grid search: best band cutoffs ---');
let best = { exact: 0, bands: null };
// Coarse grid — fine enough given small sample
for (const aPlus of [90, 92, 94, 95]) {
  for (const a of [78, 80, 82, 84, 86]) {
    if (a >= aPlus) continue;
    for (const b of [60, 62, 65, 68, 70]) {
      if (b >= a) continue;
      for (const c of [35, 40, 42, 45]) {
        if (c >= b) continue;
        for (const d of [15, 20, 25]) {
          if (d >= c) continue;
          const bands = { A_PLUS: aPlus, A: a, B: b, C: c, D: d };
          const r = measure(evals, bands);
          if (r.exact > best.exact) {
            best = { exact: r.exact, bands, within1: r.within1 };
          }
        }
      }
    }
  }
}
console.log(
  `Best exact: ${best.exact}/${evals.length} = ${((best.exact / evals.length) * 100).toFixed(1)}%`
);
console.log(`Best bands: ${JSON.stringify(best.bands)}`);
console.log(
  `Within 1 at best: ${best.within1}/${evals.length} = ${((best.within1 / evals.length) * 100).toFixed(1)}%`
);

// ----- 3. Use best bands for final validation -----
console.log('\n--- 3. Final formula with best bands ---');
const final = measure(evals, best.bands);
console.log('Confusion matrix (row=felt, col=predicted):');
console.log('felt\\pred | ' + gr.map((g) => g.padStart(4)).join(' '));
console.log('----------|' + gr.map(() => '-----').join(''));
for (const g of gr) {
  if (!final.confusion[g]) continue;
  const row = gr.map((p) => final.confusion[g]?.[p] || 0);
  console.log(`${g.padEnd(9)} | ${row.map((n) => String(n).padStart(4)).join(' ')}`);
}

// ----- 4. List mismatches -----
console.log(`\n--- 4. All ${final.mismatches.length} boundary mismatches ---`);
console.log('id                | felt | pred | score | raw | facade | dims');
console.log('------------------|------|------|-------|-----|--------|-----');
final.mismatches.sort((a, b) => a.felt.localeCompare(b.felt) || a.id.localeCompare(b.id));
for (const m of final.mismatches) {
  console.log(
    `${m.id.padEnd(18)}| ${m.felt.padEnd(4)} | ${m.pred.padEnd(4)} | ${String(m.score).padStart(5)} | ${String(m.raw).padStart(3)} | ${String(m.facade).padEnd(6)} | [${m.dims.join(',')}]`
  );
}

// ----- 5. Score distribution for each felt grade -----
console.log('\n--- 5. Score distribution by felt grade (using best bands) ---');
const perGrade = {};
for (const e of evals) {
  const r = feltScore({ dims: e.dims, facade: e.facade }, best.bands);
  perGrade[e.grade] = perGrade[e.grade] || [];
  perGrade[e.grade].push(r.score);
}
for (const g of gr) {
  if (!perGrade[g]) continue;
  const s = perGrade[g].sort((a, b) => a - b);
  const min = s[0];
  const max = s[s.length - 1];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  console.log(
    `${g.padEnd(5)}: n=${String(s.length).padStart(3)}  min=${min.toFixed(1).padStart(5)}  mean=${mean.toFixed(1).padStart(5)}  max=${max.toFixed(1).padStart(5)}`
  );
}

// ----- Save report -----
fs.writeFileSync(
  path.resolve('content/eval/analysis-stage-c.json'),
  JSON.stringify(
    {
      default_bands: { A_PLUS: 92, A: 82, B: 65, C: 40, D: 20 },
      best_bands: best.bands,
      default_result: {
        exact: result.exact,
        within1: result.within1,
        total: result.total,
        confusion: result.confusion,
      },
      best_result: {
        exact: final.exact,
        within1: final.within1,
        total: final.total,
        confusion: final.confusion,
      },
      mismatches: final.mismatches,
      per_grade_score_distribution: Object.fromEntries(
        Object.entries(perGrade).map(([g, scores]) => {
          const s = scores.sort((a, b) => a - b);
          return [
            g,
            {
              n: s.length,
              min: s[0],
              max: s[s.length - 1],
              mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
              median: s[Math.floor(s.length / 2)],
            },
          ];
        })
      ),
    },
    null,
    2
  ) + '\n'
);
console.log('\n-> content/eval/analysis-stage-c.json written');
