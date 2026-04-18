// Recompute AXR (Agent Experience Rating) grades dynamically based on real data.
//
// Problem being fixed (feedback_id 11):
//   The seed data had hardcoded axr_grade values that were divorced from
//   actual trust_score and usage_count. Services like mongodb-atlas and
//   neon-db carried axr_grade="AAA" despite trust_score=0.5 and usage_count=0.
//   This showed as "AAA next to 0 reports" — embarrassing for reviewers.
//
// Formula (aligned with generate_aeo_report methodology):
//   Base score:
//     Official MCP          → 0.50
//     Third-party MCP       → 0.40
//     API only              → 0.30
//     No API / info only    → 0.10
//   Bonuses (+0.10 each, max +0.50):
//     Has API docs URL
//     Has auth method documented
//     Has agent usage data (≥3 calls)          ← EVIDENCE FLOOR
//     High success rate (≥0.80 with ≥3 calls)
//     Recent activity (trust_score ≥ 0.8)
//
//   Grade:
//     AAA ≥ 0.90 (provable — requires evidence floor)
//     AA  ≥ 0.80
//     A   ≥ 0.70
//     BBB ≥ 0.60
//     BB  ≥ 0.50
//     B   ≥ 0.40
//     C   ≥ 0.30
//     D   < 0.30

import Database from 'better-sqlite3';

const db = new Database('./kansei-link.db');

function computeScore(svc) {
  let score = 0;
  // Base score by connection type
  if (svc.mcp_status === 'official') score += 0.5;
  else if (svc.mcp_status === 'third_party') score += 0.4;
  else if (svc.api_url) score += 0.3;
  else score += 0.1;

  // Bonuses
  if (svc.api_url) score += 0.1;
  if (svc.api_auth_method) score += 0.1;

  // Evidence floor — actual agent usage from service_stats.total_calls
  // (services.usage_count is unused in the current schema and stays 0)
  const totalCalls = svc.total_calls ?? 0;
  const hasEvidence = totalCalls >= 3;
  if (hasEvidence) score += 0.1;

  // Success rate bonus (requires evidence)
  if (hasEvidence && (svc.success_rate ?? 0) >= 0.8) score += 0.1;

  // Trust score bonus
  if ((svc.trust_score ?? 0) >= 0.8) score += 0.1;

  return Math.min(1.0, Math.max(0, score));
}

function gradeFromScore(score, hasEvidence) {
  // AAA requires evidence floor — no AAA without proven usage
  if (score >= 0.9 && hasEvidence) return 'AAA';
  if (score >= 0.9 && !hasEvidence) return 'AA'; // cap at AA without evidence
  if (score >= 0.8) return 'AA';
  if (score >= 0.7) return 'A';
  if (score >= 0.6) return 'BBB';
  if (score >= 0.5) return 'BB';
  if (score >= 0.4) return 'B';
  if (score >= 0.3) return 'C';
  return 'D';
}

// Pull success_rate from service_stats if available
const services = db
  .prepare(
    `
    SELECT s.id, s.name, s.mcp_status, s.api_url, s.api_auth_method,
           s.trust_score, s.usage_count, s.axr_grade as old_grade, s.axr_score as old_score,
           COALESCE(ss.success_rate, 0) as success_rate,
           COALESCE(ss.total_calls, 0) as total_calls
    FROM services s
    LEFT JOIN service_stats ss ON ss.service_id = s.id
  `
  )
  .all();

const update = db.prepare(
  'UPDATE services SET axr_score = ?, axr_grade = ? WHERE id = ?'
);

let changed = 0;
let unchanged = 0;
const gradeDelta = {};

const tx = db.transaction(() => {
  for (const svc of services) {
    const score = computeScore(svc);
    const scoreInt = Math.round(score * 100);
    // Same evidence rule as computeScore() — must stay in sync.
    const hasEvidence = (svc.total_calls ?? 0) >= 3;
    const newGrade = gradeFromScore(score, hasEvidence);

    const oldGrade = svc.old_grade ?? 'NONE';
    const transition = `${oldGrade} → ${newGrade}`;

    if (oldGrade !== newGrade || svc.old_score !== scoreInt) {
      update.run(scoreInt, newGrade, svc.id);
      changed++;
      gradeDelta[transition] = (gradeDelta[transition] || 0) + 1;
    } else {
      unchanged++;
    }
    // track evidence for the summary (used in eval floor)
    svc._hasEvidence = hasEvidence;
  }
});
tx();

console.log(`Recomputed ${services.length} services:`);
console.log(`  changed:   ${changed}`);
console.log(`  unchanged: ${unchanged}`);
console.log();
console.log('Grade transitions:');
for (const [t, c] of Object.entries(gradeDelta).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + String(c).padStart(3) + '  ' + t);
}

console.log();
console.log('New grade distribution:');
const dist = db
  .prepare(
    "SELECT axr_grade, COUNT(*) as c FROM services WHERE axr_grade IS NOT NULL GROUP BY axr_grade ORDER BY CASE axr_grade WHEN 'AAA' THEN 0 WHEN 'AA' THEN 1 WHEN 'A' THEN 2 WHEN 'BBB' THEN 3 WHEN 'BB' THEN 4 WHEN 'B' THEN 5 WHEN 'C' THEN 6 WHEN 'D' THEN 7 END"
  )
  .all();
for (const row of dist) {
  console.log('  ' + row.axr_grade.padEnd(4) + ' ' + row.c);
}

console.log();
console.log('Verification: bug_report target services');
for (const id of ['mongodb-atlas', 'neon-db', 'qdrant', 'chroma', 'postgresql-mcp']) {
  const row = db
    .prepare('SELECT id, trust_score, usage_count, axr_score, axr_grade FROM services WHERE id = ?')
    .get(id);
  if (row) {
    console.log(
      '  ' + row.id.padEnd(18) + ' trust=' + row.trust_score + ' usage=' + row.usage_count + ' → ' + row.axr_grade + ' (' + row.axr_score + ')'
    );
  }
}

db.close();
