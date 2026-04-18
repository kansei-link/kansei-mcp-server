// AXR (Agent Experience Rating) dynamic recompute.
//
// Integrated into the daily crawler run as step 10. Replaces the hardcoded
// axr_score / axr_grade values from services-seed.json with values derived
// from live data: mcp_status, api_url, api_auth_method, trust_score,
// service_stats.total_calls, service_stats.success_rate.
//
// Fixes the bug where services with 0 usage carried AAA from seed
// (feedback_id 11 in agent_feedback). The formula aligns with the
// generate_aeo_report methodology and enforces an EVIDENCE FLOOR:
// AAA requires at least 3 real agent calls.
//
// Pure JS, pure SQL — no LLM calls, safe to run every day.

import type Database from "better-sqlite3";

export interface AxrRecomputeSummary {
  services_evaluated: number;
  changed: number;
  unchanged: number;
  grade_distribution: Record<string, number>;
  aaa_services: string[];
}

interface ServiceRow {
  id: string;
  mcp_status: string | null;
  api_url: string | null;
  api_auth_method: string | null;
  trust_score: number | null;
  old_score: number | null;
  old_grade: string | null;
  success_rate: number;
  total_calls: number;
}

function computeScore(svc: ServiceRow): number {
  let score = 0;
  if (svc.mcp_status === "official") score += 0.5;
  else if (svc.mcp_status === "third_party") score += 0.4;
  else if (svc.api_url) score += 0.3;
  else score += 0.1;

  if (svc.api_url) score += 0.1;
  if (svc.api_auth_method) score += 0.1;

  const hasEvidence = (svc.total_calls ?? 0) >= 3;
  if (hasEvidence) score += 0.1;
  if (hasEvidence && (svc.success_rate ?? 0) >= 0.8) score += 0.1;

  if ((svc.trust_score ?? 0) >= 0.8) score += 0.1;

  return Math.min(1, Math.max(0, score));
}

function gradeFromScore(score: number, hasEvidence: boolean): string {
  // AAA requires the evidence floor — score alone is not enough
  if (score >= 0.9 && hasEvidence) return "AAA";
  if (score >= 0.9 && !hasEvidence) return "AA";
  if (score >= 0.8) return "AA";
  if (score >= 0.7) return "A";
  if (score >= 0.6) return "BBB";
  if (score >= 0.5) return "BB";
  if (score >= 0.4) return "B";
  if (score >= 0.3) return "C";
  return "D";
}

export function recomputeAxrGrades(db: Database.Database): AxrRecomputeSummary {
  const services = db
    .prepare(
      `
      SELECT s.id, s.mcp_status, s.api_url, s.api_auth_method,
             s.trust_score, s.axr_score as old_score, s.axr_grade as old_grade,
             COALESCE(ss.success_rate, 0) as success_rate,
             COALESCE(ss.total_calls, 0) as total_calls
      FROM services s
      LEFT JOIN service_stats ss ON ss.service_id = s.id
    `
    )
    .all() as ServiceRow[];

  const update = db.prepare(
    "UPDATE services SET axr_score = ?, axr_grade = ? WHERE id = ?"
  );

  const distribution: Record<string, number> = {};
  const aaaServices: string[] = [];
  let changed = 0;
  let unchanged = 0;

  const tx = db.transaction(() => {
    for (const svc of services) {
      const score = computeScore(svc);
      const scoreInt = Math.round(score * 100);
      const hasEvidence = (svc.total_calls ?? 0) >= 3;
      const newGrade = gradeFromScore(score, hasEvidence);

      distribution[newGrade] = (distribution[newGrade] ?? 0) + 1;
      if (newGrade === "AAA") aaaServices.push(svc.id);

      if (svc.old_grade !== newGrade || svc.old_score !== scoreInt) {
        update.run(scoreInt, newGrade, svc.id);
        changed++;
      } else {
        unchanged++;
      }
    }
  });
  tx();

  return {
    services_evaluated: services.length,
    changed,
    unchanged,
    grade_distribution: distribution,
    aaa_services: aaaServices.sort(),
  };
}
