import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { getModelPricing, getKnownModels } from "../utils/model-pricing.js";

/* ── Row types ─────────────────────────────────────────────── */

interface ModelPairRow {
  service_id: string;
  service_name: string;
  category: string;
  current_model: string;
  current_cost: number;
  current_sr: number;
  current_calls: number;
  cheaper_model: string;
  cheaper_cost: number;
  cheaper_sr: number;
  cheaper_calls: number;
}

interface ServiceAltRow {
  current_id: string;
  current_name: string;
  current_sr: number;
  current_calls: number;
  alt_id: string;
  alt_name: string;
  alt_sr: number;
  alt_mcp_status: string | null;
}

interface ArchRow {
  service_id: string;
  name: string;
  key_endpoints: string;
  agent_tips: string | null;
}

interface TipRow {
  tip_id: string;
  category: string;
  title: string;
  from_stack: string;
  to_stack: string;
  savings_pct: number;
  confidence: string;
  conditions: string;
  evidence_url: string;
  evidence_summary: string;
}

interface SpendRow {
  total_spend: number | null;
}

/* ── Registration ──────────────────────────────────────────── */

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "audit_cost",
    {
      title: "Audit Cost",
      description:
        "Analyze your agent's API spending and get optimization recommendations across 4 layers: model selection, service alternatives, architecture improvements, and infrastructure tips.",
      inputSchema: z.object({
        service_id: z
          .string()
          .optional()
          .describe("Audit a specific service, or omit for all services"),
        period_days: z
          .number()
          .int()
          .optional()
          .default(30)
          .describe("Analysis period in days (default: 30)"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ service_id, period_days }) => {
      const result = auditCost(db, service_id, period_days);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}

/* ── Core logic ────────────────────────────────────────────── */

function auditCost(
  db: Database.Database,
  serviceId: string | undefined,
  periodDays: number
): object {
  const today = new Date().toISOString().slice(0, 10);

  // Check if we have any model_service_stats data at all
  const hasData = db
    .prepare("SELECT COUNT(*) as cnt FROM model_service_stats WHERE total_calls > 0")
    .get() as { cnt: number };

  if (hasData.cnt === 0) {
    return {
      period_days: periodDays,
      analysis_date: today,
      message:
        "No model-level cost data yet. Start reporting outcomes with model_name and token counts to unlock cost audit recommendations.",
      how_to_start:
        "report_outcome({ service_id: 'freee', success: true, model_name: 'claude-sonnet-4', input_tokens: 500, output_tokens: 200 })",
      _meta: {
        source: "kansei-link",
        tip: "Report outcomes with model_name and token counts to improve recommendations: report_outcome({model_name: 'claude-sonnet-4', input_tokens: 500, ...})",
      },
    };
  }

  const recommendations: object[] = [];

  // ─── Layer 1: Model Audit ───────────────────────────────
  const modelSql = `
    SELECT mss1.service_id, s.name as service_name, s.category,
           mss1.model_name as current_model, mss1.avg_cost_usd as current_cost,
           mss1.success_rate as current_sr, mss1.total_calls as current_calls,
           mss2.model_name as cheaper_model, mss2.avg_cost_usd as cheaper_cost,
           mss2.success_rate as cheaper_sr, mss2.total_calls as cheaper_calls
    FROM model_service_stats mss1
    JOIN model_service_stats mss2
      ON mss1.service_id = mss2.service_id
      AND mss1.task_type = mss2.task_type
      AND mss1.model_name != mss2.model_name
    JOIN services s ON mss1.service_id = s.id
    WHERE mss2.avg_cost_usd < mss1.avg_cost_usd
      AND mss2.success_rate >= mss1.success_rate - 0.05
      AND mss1.total_calls >= 3 AND mss2.total_calls >= 3
      ${serviceId ? "AND mss1.service_id = ?" : ""}
    ORDER BY (mss1.avg_cost_usd - mss2.avg_cost_usd) * mss1.total_calls DESC
    LIMIT 10
  `;

  const modelParams = serviceId ? [serviceId] : [];
  const modelPairs = db.prepare(modelSql).all(...modelParams) as ModelPairRow[];

  for (const row of modelPairs) {
    const savingsPerCall = row.current_cost - row.cheaper_cost;
    const monthlySavings = savingsPerCall * row.current_calls * (periodDays / periodDays); // per period projection
    const costReduction = row.current_cost > 0
      ? Math.round((savingsPerCall / row.current_cost) * 100)
      : 0;
    const currentSrPct = Math.round(row.current_sr * 100);
    const cheaperSrPct = Math.round(row.cheaper_sr * 100);
    const dataPoints = row.current_calls + row.cheaper_calls;

    recommendations.push({
      layer: "model",
      priority: monthlySavings > 100 ? "high" : monthlySavings > 10 ? "medium" : "low",
      service: row.service_name,
      service_id: row.service_id,
      current: row.current_model,
      recommended: row.cheaper_model,
      reason: `Success rate equivalent (${currentSrPct}% vs ${cheaperSrPct}%), cost ${costReduction}% lower`,
      monthly_savings_usd: Math.round(monthlySavings * 100) / 100,
      confidence: dataPoints >= 50 ? "high" : dataPoints >= 20 ? "medium" : "low",
      data_points: dataPoints,
    });
  }

  // ─── Layer 2: Service Audit ─────────────────────────────
  const serviceSql = `
    SELECT s1.id as current_id, s1.name as current_name,
           ss1.success_rate as current_sr, ss1.total_calls as current_calls,
           s2.id as alt_id, s2.name as alt_name,
           ss2.success_rate as alt_sr,
           s2.mcp_status as alt_mcp_status
    FROM services s1
    JOIN service_stats ss1 ON s1.id = ss1.service_id
    JOIN services s2 ON s1.category = s2.category AND s1.id != s2.id
    JOIN service_stats ss2 ON s2.id = ss2.service_id
    WHERE ss2.success_rate > ss1.success_rate + 0.15
      AND ss1.total_calls >= 5
      AND ss2.total_calls >= 5
      ${serviceId ? "AND s1.id = ?" : ""}
    ORDER BY (ss2.success_rate - ss1.success_rate) DESC
    LIMIT 5
  `;

  const serviceParams = serviceId ? [serviceId] : [];
  const serviceAlts = db.prepare(serviceSql).all(...serviceParams) as ServiceAltRow[];

  for (const row of serviceAlts) {
    const currentSrPct = Math.round(row.current_sr * 100);
    const altSrPct = Math.round(row.alt_sr * 100);
    const retryReduction = Math.round((row.alt_sr - row.current_sr) * 100);
    // Estimate: retry reduction percentage roughly equals token savings percentage
    const estimatedMonthlySavings = Math.round(
      row.current_calls * 0.01 * retryReduction // rough: $0.01 avg cost per call * retry reduction %
    );

    recommendations.push({
      layer: "service",
      priority: retryReduction >= 30 ? "medium" : "low",
      current_service: row.current_name,
      current_service_id: row.current_id,
      recommended_service: row.alt_name,
      recommended_service_id: row.alt_id,
      reason: `Success rate ${currentSrPct}% → ${altSrPct}%. Fewer retries = ~${retryReduction}% token savings`,
      monthly_savings_usd: estimatedMonthlySavings,
      confidence: "medium",
      alt_mcp_status: row.alt_mcp_status,
    });
  }

  // ─── Layer 3: Architecture Audit ────────────────────────
  const archSql = `
    SELECT sag.service_id, s.name, sag.key_endpoints, sag.agent_tips
    FROM service_api_guides sag
    JOIN services s ON sag.service_id = s.id
    WHERE sag.key_endpoints IS NOT NULL
      ${serviceId ? "AND sag.service_id = ?" : ""}
  `;

  const archParams = serviceId ? [serviceId] : [];
  const archRows = db.prepare(archSql).all(...archParams) as ArchRow[];

  for (const row of archRows) {
    let endpoints: Array<{ path?: string; description?: string; method?: string }> = [];
    try {
      endpoints = JSON.parse(row.key_endpoints);
    } catch {
      continue;
    }

    // Find batch/bulk endpoints
    const batchEndpoints = endpoints.filter((ep) => {
      const text = `${ep.path ?? ""} ${ep.description ?? ""}`.toLowerCase();
      return text.includes("batch") || text.includes("bulk") || text.includes("records");
    });

    for (const ep of batchEndpoints) {
      recommendations.push({
        layer: "architecture",
        priority: "low",
        service: row.name,
        service_id: row.service_id,
        issue: "Batch API available but individual calls detected",
        fix: `Use ${ep.method ?? "GET"} ${ep.path ?? "batch endpoint"} for bulk operations`,
        estimated_impact: "Up to 50x fewer API calls",
      });
    }

    // Check agent_tips for efficiency hints
    if (row.agent_tips) {
      const tips = row.agent_tips.toLowerCase();
      if (tips.includes("batch") || tips.includes("bulk") || tips.includes("efficien")) {
        recommendations.push({
          layer: "architecture",
          priority: "low",
          service: row.name,
          service_id: row.service_id,
          issue: "Optimization tips available in agent guide",
          fix: row.agent_tips,
          estimated_impact: "Reduced API calls and token usage",
        });
      }
    }
  }

  // ─── Layer 4: Infrastructure Tips ──────────────────────
  const tipsSql = `
    SELECT tip_id, category, title, from_stack, to_stack,
           savings_pct, confidence, conditions, evidence_url, evidence_summary
    FROM infrastructure_tips
    WHERE confidence IN ('verified', 'conditional')
    ORDER BY savings_pct DESC
  `;
  const tips = db.prepare(tipsSql).all() as TipRow[];

  for (const tip of tips) {
    recommendations.push({
      layer: "infrastructure",
      priority: tip.savings_pct >= 80 ? "high" : tip.savings_pct >= 40 ? "medium" : "low",
      tip_id: tip.tip_id,
      title: tip.title,
      from: tip.from_stack,
      to: tip.to_stack,
      savings_pct: tip.savings_pct,
      confidence: tip.confidence,
      conditions: tip.conditions,
      evidence: tip.evidence_url,
    });
  }

  // ─── Totals ─────────────────────────────────────────────
  // Estimate total spend from model_service_stats
  const spendSql = `
    SELECT SUM(avg_cost_usd * total_calls) as total_spend
    FROM model_service_stats
    ${serviceId ? "WHERE service_id = ?" : ""}
  `;
  const spendParams = serviceId ? [serviceId] : [];
  const spendRow = db.prepare(spendSql).get(...spendParams) as SpendRow;
  const totalSpend = Math.round((spendRow.total_spend ?? 0) * 100) / 100;

  const totalSavings = recommendations.reduce((sum, r: any) => {
    return sum + (r.monthly_savings_usd ?? 0);
  }, 0);
  const savingsPercentage =
    totalSpend > 0 ? Math.round((totalSavings / totalSpend) * 100) : 0;

  // Data coverage stats
  const servicesWithData = db
    .prepare(
      "SELECT COUNT(DISTINCT service_id) as cnt FROM model_service_stats WHERE total_calls > 0"
    )
    .get() as { cnt: number };
  const totalReports = db
    .prepare("SELECT COUNT(*) as cnt FROM outcomes")
    .get() as { cnt: number };
  const modelsTracked = db
    .prepare(
      "SELECT DISTINCT model_name FROM model_service_stats WHERE total_calls > 0"
    )
    .all() as Array<{ model_name: string }>;

  return {
    period_days: periodDays,
    analysis_date: today,
    total_estimated_spend_usd: totalSpend,
    potential_savings_usd: Math.round(totalSavings * 100) / 100,
    savings_percentage: savingsPercentage,
    recommendations,
    data_coverage: {
      services_with_model_data: servicesWithData.cnt,
      total_outcome_reports: totalReports.cnt,
      models_tracked: modelsTracked.map((m) => m.model_name),
    },
    _meta: {
      source: "kansei-link",
      tip: "Report outcomes with model_name and token counts to improve recommendations: report_outcome({model_name: 'claude-sonnet-4', input_tokens: 500, ...})",
    },
  };
}
