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
import { statusProvenance } from "./sources/publisher-match.js";

export interface AxrRecomputeSummary {
  services_evaluated: number;
  changed: number;
  unchanged: number;
  grade_distribution: Record<string, number>;
  aaa_services: string[];
}

interface ServiceRow {
  id: string;
  /** 出所の判定に要る。誰が公開したかはこれでしか分からない */
  namespace: string | null;
  mcp_status: string | null;
  api_url: string | null;
  api_auth_method: string | null;
  trust_score: number | null;
  old_score: number | null;
  old_grade: string | null;
  success_rate: number;
  total_calls: number;
}

function computeScore(svc: ServiceRow, adjudicated?: ReadonlySet<string>): number {
  let score = 0;

  // レジストリは「HTTP/SSEでホストされているか」だけで official を付けており、
  // 誰が公開したかを見ていない（founder-ops/RCA-MCP-Ingestion_2026-09-04.md ③）。
  // 発行元を確認できていない値に等級の0.5点を渡すと、個人のラッパーが
  // ベンダー公式と同じ重みを持つ。等級では credit しない。
  // 値そのものは残す——発見性の信号としては引き続き有用なので。
  const provenance = statusProvenance(svc, adjudicated);
  const statusIsCredited = provenance !== "registry_inferred";

  if (statusIsCredited && svc.mcp_status === "official") score += 0.5;
  else if (statusIsCredited && svc.mcp_status === "third_party") score += 0.4;
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

export function recomputeAxrGrades(
  db: Database.Database,
  /** 人が一次資料で確認済みのサービスid。渡されたものは出所 verdict として credit する */
  adjudicated?: ReadonlySet<string>
): AxrRecomputeSummary {
  const services = db
    .prepare(
      `
      SELECT s.id, s.namespace, s.mcp_status, s.api_url, s.api_auth_method,
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
      const score = computeScore(svc, adjudicated);
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
