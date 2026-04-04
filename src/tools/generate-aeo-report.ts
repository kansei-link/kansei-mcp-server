import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * AEO (Agent Engine Optimization) Score Report Generator
 *
 * Like ESG ratings for the Agent Economy.
 * Scores each SaaS service on how "agent-ready" it is.
 *
 * Scoring methodology:
 *   Base score (0-0.5):
 *     - Official MCP server: 0.5
 *     - Third-party MCP:     0.4
 *     - API only:            0.3
 *     - No API:              0.1
 *
 *   Bonus (up to +0.5):
 *     - API docs available:     +0.1
 *     - Auth guide available:   +0.1
 *     - Category specialist:    +0.1 (focused service vs broad platform)
 *     - Agent reports exist:    +0.1
 *     - High success rate:      +0.1 (>80% from agent reports)
 */

interface ServiceRow {
  id: string;
  name: string;
  category: string | null;
  mcp_endpoint: string | null;
  mcp_status: string | null;
  api_url: string | null;
  api_auth_method: string | null;
  trust_score: number;
  tags: string | null;
}

interface GuideRow {
  service_id: string;
}

interface StatsRow {
  service_id: string;
  total_calls: number;
  success_rate: number;
}

interface AeoScore {
  service_id: string;
  service_name: string;
  category: string | null;
  aeo_score: number;
  grade: string;
  breakdown: {
    base_score: number;
    base_reason: string;
    api_docs_bonus: boolean;
    auth_guide_bonus: boolean;
    specialist_bonus: boolean;
    agent_data_bonus: boolean;
    success_rate_bonus: boolean;
  };
  recommendations: string[];
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "generate_aeo_report",
    {
      title: "Generate AEO Report",
      description:
        "Generate an AEO (Agent Engine Optimization) Readiness Report for Japanese SaaS services. " +
        "Scores each service on how agent-ready it is: MCP availability, API docs, auth guides, " +
        "agent success rates. Like ESG ratings for the Agent Economy.",
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe("Filter by category (e.g., 'accounting', 'hr', 'crm'). Omit for all."),
        top_n: z
          .number()
          .default(20)
          .describe("Number of top services to return (default: 20)"),
        include_recommendations: z
          .boolean()
          .default(true)
          .describe("Include improvement recommendations per service"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ category, top_n, include_recommendations }) => {
      const result = generateAeoReport(db, { category, topN: top_n, includeRecommendations: include_recommendations });
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

export function generateAeoReport(
  db: Database.Database,
  opts: { category?: string; topN: number; includeRecommendations: boolean }
): object {
  // Get all services
  let sql = "SELECT id, name, category, mcp_endpoint, mcp_status, api_url, api_auth_method, trust_score, tags FROM services";
  const params: unknown[] = [];
  if (opts.category) {
    sql += " WHERE category = ?";
    params.push(opts.category);
  }
  const services = db.prepare(sql).all(...params) as ServiceRow[];

  // Get which services have API guides
  const guidesSet = new Set(
    (db.prepare("SELECT service_id FROM service_api_guides").all() as GuideRow[])
      .map((g) => g.service_id)
  );

  // Get agent stats
  const statsMap = new Map<string, StatsRow>();
  const stats = db.prepare("SELECT service_id, total_calls, success_rate FROM service_stats").all() as StatsRow[];
  for (const s of stats) statsMap.set(s.service_id, s);

  // Count services per category (for specialist detection)
  const categoryTagCounts = new Map<string, number>();
  for (const s of services) {
    const tags = (s.tags || "").split(",").map((t) => t.trim());
    for (const t of tags) {
      categoryTagCounts.set(t, (categoryTagCounts.get(t) || 0) + 1);
    }
  }

  // Score each service
  const scores: AeoScore[] = services.map((s) => {
    // Base score: MCP availability
    let baseScore: number;
    let baseReason: string;
    if (s.mcp_endpoint && s.mcp_status === "official") {
      baseScore = 0.5;
      baseReason = "Official MCP server available";
    } else if (s.mcp_endpoint) {
      baseScore = 0.4;
      baseReason = "Third-party MCP available";
    } else if (s.api_url) {
      baseScore = 0.3;
      baseReason = "API available (no MCP)";
    } else {
      baseScore = 0.1;
      baseReason = "No API or MCP available";
    }

    // Bonus: API docs
    const hasApiDocs = !!s.api_url;

    // Bonus: Auth guide
    const hasAuthGuide = guidesSet.has(s.id);

    // Bonus: Category specialist
    // A service is a "specialist" if its tags are focused (few tags, all in same domain)
    const tags = (s.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    const isSpecialist = tags.length > 0 && tags.length <= 5;

    // Bonus: Agent data exists
    const agentStats = statsMap.get(s.id);
    const hasAgentData = agentStats && agentStats.total_calls >= 1;

    // Bonus: High success rate
    const highSuccessRate = agentStats && agentStats.total_calls >= 3 && agentStats.success_rate >= 0.8;

    const totalScore = Math.min(
      1.0,
      baseScore +
        (hasApiDocs ? 0.1 : 0) +
        (hasAuthGuide ? 0.1 : 0) +
        (isSpecialist ? 0.1 : 0) +
        (hasAgentData ? 0.1 : 0) +
        (highSuccessRate ? 0.1 : 0)
    );

    // Grade
    let grade: string;
    if (totalScore >= 0.9) grade = "AAA";
    else if (totalScore >= 0.8) grade = "AA";
    else if (totalScore >= 0.7) grade = "A";
    else if (totalScore >= 0.6) grade = "BBB";
    else if (totalScore >= 0.5) grade = "BB";
    else if (totalScore >= 0.4) grade = "B";
    else if (totalScore >= 0.3) grade = "C";
    else grade = "D";

    // Recommendations
    const recommendations: string[] = [];
    if (opts.includeRecommendations) {
      if (!s.mcp_endpoint) {
        recommendations.push(
          "Create an MCP server — this is the #1 way to increase agent accessibility. " +
            "Official MCP adds +0.2 to AEO score."
        );
      }
      if (!hasAuthGuide) {
        recommendations.push(
          "Add an auth setup guide — agents need to know how to authenticate. +0.1 to AEO score."
        );
      }
      if (!hasApiDocs) {
        recommendations.push(
          "Document your API — even a basic endpoint list helps agents integrate. +0.1 to AEO score."
        );
      }
      if (!hasAgentData) {
        recommendations.push(
          "No agent usage data yet. Encourage agent developers to try your service and report outcomes."
        );
      }
      if (agentStats && agentStats.total_calls >= 3 && agentStats.success_rate < 0.5) {
        recommendations.push(
          `Agent success rate is ${Math.round(agentStats.success_rate * 100)}%. ` +
            "Review common errors and improve error messages / documentation."
        );
      }
    }

    return {
      service_id: s.id,
      service_name: s.name,
      category: s.category,
      aeo_score: Math.round(totalScore * 100) / 100,
      grade,
      breakdown: {
        base_score: baseScore,
        base_reason: baseReason,
        api_docs_bonus: hasApiDocs,
        auth_guide_bonus: hasAuthGuide,
        specialist_bonus: isSpecialist,
        agent_data_bonus: !!hasAgentData,
        success_rate_bonus: !!highSuccessRate,
      },
      recommendations,
    };
  });

  // Sort by score descending
  scores.sort((a, b) => b.aeo_score - a.aeo_score);

  // Grade distribution
  const gradeDistribution: Record<string, number> = {};
  for (const s of scores) {
    gradeDistribution[s.grade] = (gradeDistribution[s.grade] || 0) + 1;
  }

  // Category averages
  const categoryScores = new Map<string, number[]>();
  for (const s of scores) {
    const cat = s.category || "uncategorized";
    if (!categoryScores.has(cat)) categoryScores.set(cat, []);
    categoryScores.get(cat)!.push(s.aeo_score);
  }
  const categoryAverages = Object.fromEntries(
    [...categoryScores.entries()]
      .map(([cat, vals]) => [cat, Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100])
      .sort((a, b) => (b[1] as number) - (a[1] as number))
  );

  return {
    report_title: opts.category
      ? `AEO Readiness Report: ${opts.category}`
      : "AEO Readiness Report: Japanese SaaS Services",
    generated_at: new Date().toISOString(),
    methodology: {
      description:
        "Agent Engine Optimization (AEO) Score measures how ready a SaaS service is " +
        "for the AI agent economy. Higher scores = easier for agents to discover and use.",
      scoring: {
        base: "Official MCP (0.5) > Third-party MCP (0.4) > API only (0.3) > No API (0.1)",
        bonuses: "+0.1 each: API docs, auth guide, category specialist, agent usage data, high success rate",
        grades: "AAA (0.9+), AA (0.8+), A (0.7+), BBB (0.6+), BB (0.5+), B (0.4+), C (0.3+), D (<0.3)",
      },
    },
    summary: {
      total_services: scores.length,
      grade_distribution: gradeDistribution,
      category_averages: categoryAverages,
      avg_score: Math.round((scores.reduce((a, b) => a + b.aeo_score, 0) / scores.length) * 100) / 100,
    },
    rankings: scores.slice(0, opts.topN),
  };
}
