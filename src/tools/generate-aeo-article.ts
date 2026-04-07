import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

/**
 * AEO Readiness Ranking Article Generator
 *
 * Produces a publishable article in the style of ESG rating agency reports
 * (MSCI, Sustainalytics, CDP). Designed to establish KanseiLink as the
 * definitive AEO (Agent Engine Optimization) rating authority for Japanese SaaS.
 *
 * Output formats: markdown (for blog/press), json (for API/embed)
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

interface StatsRow {
  service_id: string;
  total_calls: number;
  success_rate: number;
  avg_latency_ms: number;
}

interface GuideRow {
  service_id: string;
}

interface RecipeRow {
  id: string;
  steps: string;
  required_services: string;
}

interface RankedService {
  rank: number;
  service_id: string;
  name: string;
  category: string | null;
  aeo_score: number;
  grade: string;
  agent_ready: "verified" | "connectable" | "info_only";
  recipe_count: number;
  mcp_type: string;
  success_rate: number | null;
  total_agent_calls: number;
  change_indicator: string; // "new", "up", "down", "stable"
}

interface CategorySummary {
  category: string;
  avg_score: number;
  top_service: string;
  top_grade: string;
  service_count: number;
  verified_count: number;
}

function computeGrade(score: number): string {
  if (score >= 0.9) return "AAA";
  if (score >= 0.8) return "AA";
  if (score >= 0.7) return "A";
  if (score >= 0.6) return "BBB";
  if (score >= 0.5) return "BB";
  if (score >= 0.4) return "B";
  if (score >= 0.3) return "C";
  return "D";
}

function gradeEmoji(grade: string): string {
  if (grade === "AAA") return "🏆";
  if (grade === "AA") return "🥇";
  if (grade === "A") return "🥈";
  if (grade === "BBB") return "🥉";
  return "▫️";
}

function agentReadyLabel(status: "verified" | "connectable" | "info_only"): string {
  if (status === "verified") return "🟢 Verified";
  if (status === "connectable") return "🟡 Connectable";
  return "⚪ Info Only";
}

function categoryName(cat: string): string {
  const map: Record<string, string> = {
    accounting: "Accounting / 会計・経理",
    hr: "HR / 人事・労務",
    crm: "CRM / 営業",
    communication: "Communication / コミュニケーション",
    project_management: "Project Management / プロジェクト管理",
    ecommerce: "E-commerce / EC・コマース",
    legal: "Legal / 法務・契約",
    payment: "Payment / 決済",
    marketing: "Marketing / マーケティング",
    groupware: "Groupware / グループウェア",
    support: "Customer Support / カスタマーサポート",
    storage: "Storage / ストレージ",
    security: "Security / セキュリティ",
    bi_analytics: "BI & Analytics / 分析",
    data_integration: "Data Integration / データ連携",
    logistics: "Logistics / 物流・配送",
    reservation: "Reservation / 予約",
    productivity: "Productivity / 生産性ツール",
    dev_platform: "Dev Platform / 開発プラットフォーム",
    ai_ml: "AI & ML / AI・機械学習",
    database: "Database / データベース",
    monitoring: "Monitoring / 監視",
    design: "Design / デザイン",
  };
  return map[cat] || cat;
}

function generateArticle(
  db: Database.Database,
  opts: {
    quarter: string;
    format: "markdown" | "json";
    topN: number;
    categories?: string[];
  }
): string | object {
  // --- Data collection ---
  const services = db
    .prepare("SELECT id, name, category, mcp_endpoint, mcp_status, api_url, api_auth_method, trust_score, tags FROM services")
    .all() as ServiceRow[];

  const guidesSet = new Set(
    (db.prepare("SELECT service_id FROM service_api_guides").all() as GuideRow[]).map(g => g.service_id)
  );

  const statsMap = new Map<string, StatsRow>();
  for (const s of db.prepare("SELECT service_id, total_calls, success_rate, avg_latency_ms FROM service_stats").all() as StatsRow[]) {
    statsMap.set(s.service_id, s);
  }

  // Recipe count per service
  const recipes = db.prepare("SELECT id, steps, required_services FROM recipes").all() as RecipeRow[];
  const recipeCountMap = new Map<string, number>();
  for (const recipe of recipes) {
    const reqServices = JSON.parse(recipe.required_services) as string[];
    const steps = JSON.parse(recipe.steps) as Array<{ service_id: string }>;
    const allIds = new Set([...reqServices, ...steps.map(s => s.service_id)]);
    for (const sid of allIds) {
      recipeCountMap.set(sid, (recipeCountMap.get(sid) || 0) + 1);
    }
  }

  // --- Score each service ---
  const ranked: RankedService[] = services.map(s => {
    let baseScore: number;
    let mcpType: string;
    if (s.mcp_endpoint && s.mcp_status === "official") {
      baseScore = 0.5; mcpType = "Official MCP";
    } else if (s.mcp_endpoint) {
      baseScore = 0.4; mcpType = "Third-party MCP";
    } else if (s.api_url) {
      baseScore = 0.3; mcpType = "API Only";
    } else {
      baseScore = 0.1; mcpType = "No API";
    }

    const hasApiDocs = !!s.api_url;
    const hasAuthGuide = guidesSet.has(s.id);
    const tags = (s.tags || "").split(",").map(t => t.trim()).filter(Boolean);
    const isSpecialist = tags.length > 0 && tags.length <= 5;
    const stats = statsMap.get(s.id);
    const hasAgentData = stats && stats.total_calls >= 1;
    const highSuccess = stats && stats.total_calls >= 3 && stats.success_rate >= 0.8;

    const score = Math.min(1.0,
      baseScore +
      (hasApiDocs ? 0.1 : 0) +
      (hasAuthGuide ? 0.1 : 0) +
      (isSpecialist ? 0.1 : 0) +
      (hasAgentData ? 0.1 : 0) +
      (highSuccess ? 0.1 : 0)
    );

    const aeoScore = Math.round(score * 100) / 100;

    let agentReady: "verified" | "connectable" | "info_only";
    if ((s.mcp_endpoint || s.api_url) && stats && stats.total_calls >= 3 && stats.success_rate >= 0.8) {
      agentReady = "verified";
    } else if (s.mcp_endpoint || s.api_url) {
      agentReady = "connectable";
    } else {
      agentReady = "info_only";
    }

    return {
      rank: 0,
      service_id: s.id,
      name: s.name,
      category: s.category,
      aeo_score: aeoScore,
      grade: computeGrade(aeoScore),
      agent_ready: agentReady,
      recipe_count: recipeCountMap.get(s.id) || 0,
      mcp_type: mcpType,
      success_rate: stats ? Math.round(stats.success_rate * 100) : null,
      total_agent_calls: stats?.total_calls || 0,
      change_indicator: "new", // First edition
    };
  });

  ranked.sort((a, b) => b.aeo_score - a.aeo_score || b.recipe_count - a.recipe_count);
  ranked.forEach((r, i) => r.rank = i + 1);

  // --- Category summaries ---
  const catMap = new Map<string, RankedService[]>();
  for (const r of ranked) {
    const cat = r.category || "other";
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(r);
  }

  const categorySummaries: CategorySummary[] = [...catMap.entries()]
    .map(([cat, items]) => ({
      category: cat,
      avg_score: Math.round((items.reduce((a, b) => a + b.aeo_score, 0) / items.length) * 100) / 100,
      top_service: items[0].name,
      top_grade: items[0].grade,
      service_count: items.length,
      verified_count: items.filter(i => i.agent_ready === "verified").length,
    }))
    .sort((a, b) => b.avg_score - a.avg_score);

  // Grade distribution
  const gradeDist: Record<string, number> = {};
  for (const r of ranked) gradeDist[r.grade] = (gradeDist[r.grade] || 0) + 1;

  const totalVerified = ranked.filter(r => r.agent_ready === "verified").length;
  const totalConnectable = ranked.filter(r => r.agent_ready === "connectable").length;
  const totalInfoOnly = ranked.filter(r => r.agent_ready === "info_only").length;
  const avgScore = Math.round((ranked.reduce((a, b) => a + b.aeo_score, 0) / ranked.length) * 100) / 100;

  // --- JSON format ---
  if (opts.format === "json") {
    return {
      meta: {
        title: `AEO Readiness Ranking ${opts.quarter}`,
        subtitle: "SaaS/API AEO Readiness Ranking — AIエージェント対応力格付け",
        publisher: "KanseiLink by Synapse Arrows PTE. LTD.",
        methodology_version: "1.0",
        generated_at: new Date().toISOString(),
        total_services_evaluated: ranked.length,
        data_sources: "Agent usage telemetry, API documentation audit, MCP registry scan",
      },
      summary: {
        avg_aeo_score: avgScore,
        grade_distribution: gradeDist,
        agent_readiness: { verified: totalVerified, connectable: totalConnectable, info_only: totalInfoOnly },
      },
      overall_top: ranked.slice(0, opts.topN),
      category_rankings: Object.fromEntries(
        categorySummaries
          .filter(c => !opts.categories || opts.categories.includes(c.category))
          .map(c => [c.category, {
            summary: c,
            rankings: (catMap.get(c.category) || []).slice(0, 5),
          }])
      ),
      methodology: {
        scoring: "Base (MCP type: 0.1-0.5) + Bonuses (API docs, auth guide, specialist, agent data, success rate: +0.1 each)",
        grades: { AAA: "0.9+", AA: "0.8+", A: "0.7+", BBB: "0.6+", BB: "0.5+", B: "0.4+", C: "0.3+", D: "<0.3" },
        agent_ready: {
          verified: "MCP/API exists + 3+ agent calls + ≥80% success rate",
          connectable: "MCP/API exists but unproven or low success",
          info_only: "No API or MCP available",
        },
      },
    };
  }

  // --- Markdown article format ---
  const focusCategories = opts.categories || ["dev_platform", "ai_ml", "communication", "project_management", "database", "accounting", "hr", "crm", "ecommerce", "payment", "marketing", "monitoring"];

  let md = "";

  // Header
  md += `# AEO Readiness Ranking ${opts.quarter}\n`;
  md += `## SaaS/API AEO Readiness Ranking — AIエージェント対応力格付け\n\n`;
  md += `**Published by:** KanseiLink (Synapse Arrows PTE. LTD.)  \n`;
  md += `**Date:** ${new Date().toISOString().split("T")[0]}  \n`;
  md += `**Evaluated:** ${ranked.length} services  \n`;
  md += `**Methodology:** AEO Score v1.0\n\n`;
  md += `---\n\n`;

  // Executive Summary
  md += `## Executive Summary\n\n`;
  md += `${opts.quarter}における${ranked.length}のSaaS/APIサービス（グローバル＋日本市場）のAIエージェント対応力（AEO: Agent Engine Optimization）を評価しました。\n\n`;
  md += `| 指標 | 値 |\n|------|----|\n`;
  md += `| 平均AEOスコア | **${avgScore}** / 1.00 |\n`;
  md += `| 🟢 Verified（実証済み） | **${totalVerified}** サービス |\n`;
  md += `| 🟡 Connectable（接続可能） | **${totalConnectable}** サービス |\n`;
  md += `| ⚪ Info Only（情報のみ） | **${totalInfoOnly}** サービス |\n\n`;

  // Grade distribution
  md += `### グレード分布\n\n`;
  md += `| Grade | 数 | 割合 |\n|-------|-----|------|\n`;
  for (const g of ["AAA", "AA", "A", "BBB", "BB", "B", "C", "D"]) {
    const count = gradeDist[g] || 0;
    const pct = Math.round((count / ranked.length) * 100);
    const bar = "█".repeat(Math.round(pct / 3));
    md += `| ${gradeEmoji(g)} ${g} | ${count} | ${bar} ${pct}% |\n`;
  }
  md += `\n`;

  // Overall Top N
  md += `---\n\n## 総合ランキング TOP ${opts.topN}\n\n`;
  md += `| Rank | Grade | Score | Service | Agent Ready | MCP | Recipes | Agent Calls | Success |\n`;
  md += `|------|-------|-------|---------|------------|-----|---------|-------------|--------|\n`;
  for (const r of ranked.slice(0, opts.topN)) {
    const sr = r.success_rate !== null ? `${r.success_rate}%` : "-";
    md += `| ${r.rank} | ${gradeEmoji(r.grade)} ${r.grade} | ${r.aeo_score.toFixed(2)} | **${r.name}** | ${agentReadyLabel(r.agent_ready)} | ${r.mcp_type} | ${r.recipe_count} | ${r.total_agent_calls} | ${sr} |\n`;
  }
  md += `\n`;

  // Category Deep Dives
  md += `---\n\n## カテゴリ別ランキング\n\n`;

  // Category overview table
  md += `| カテゴリ | 平均スコア | トップ | Verified数 |\n`;
  md += `|----------|----------|--------|----------|\n`;
  for (const c of categorySummaries.filter(c => focusCategories.includes(c.category))) {
    md += `| ${categoryName(c.category)} | ${c.avg_score} | ${c.top_service} (${c.top_grade}) | ${c.verified_count}/${c.service_count} |\n`;
  }
  md += `\n`;

  for (const catName of focusCategories) {
    const items = catMap.get(catName);
    if (!items || items.length === 0) continue;

    const catSummary = categorySummaries.find(c => c.category === catName);
    md += `### ${categoryName(catName)}\n\n`;

    md += `| Rank | Grade | Score | Service | Agent Ready | Recipes |\n`;
    md += `|------|-------|-------|---------|------------|--------|\n`;
    for (const [i, r] of items.slice(0, 5).entries()) {
      md += `| ${i + 1} | ${gradeEmoji(r.grade)} ${r.grade} | ${r.aeo_score.toFixed(2)} | **${r.name}** | ${agentReadyLabel(r.agent_ready)} | ${r.recipe_count} |\n`;
    }

    // Analysis paragraph
    const top = items[0];
    const verifiedInCat = items.filter(i => i.agent_ready === "verified").length;
    md += `\n> **分析:** ${categoryName(catName)}カテゴリの平均AEOスコアは**${catSummary?.avg_score}**。`;
    if (verifiedInCat > 0) {
      md += ` ${verifiedInCat}サービスが実証済み（Verified）ステータスを獲得。`;
    }
    md += ` **${top.name}**が${top.grade}グレードでカテゴリトップ。`;
    if (top.recipe_count > 0) {
      md += ` ${top.recipe_count}件のワークフローレシピで他サービスとの連携パターンが確認済み。`;
    }
    md += `\n\n`;
  }

  // Methodology
  md += `---\n\n## 評価方法（Methodology）\n\n`;
  md += `### AEO Score（0.00 - 1.00）\n\n`;
  md += `AEO（Agent Engine Optimization）スコアは、SaaSサービスがAIエージェントにとってどれだけ「使いやすいか」を定量評価する指標です。\n\n`;
  md += `**Base Score（接続基盤）:**\n`;
  md += `| 接続方式 | Base Score |\n|----------|----------|\n`;
  md += `| Official MCP Server | 0.50 |\n`;
  md += `| Third-party MCP | 0.40 |\n`;
  md += `| API Only | 0.30 |\n`;
  md += `| No API | 0.10 |\n\n`;
  md += `**Bonus（各 +0.10、最大 +0.50）:**\n`;
  md += `- API ドキュメント公開\n`;
  md += `- 認証セットアップガイド\n`;
  md += `- カテゴリ特化型サービス\n`;
  md += `- エージェント利用実績あり\n`;
  md += `- エージェント成功率 80%以上\n\n`;

  md += `### Agent Ready ステータス\n\n`;
  md += `| ステータス | 条件 |\n|-----------|------|\n`;
  md += `| 🟢 Verified | MCP/API + エージェント3回以上利用 + 成功率80%以上 |\n`;
  md += `| 🟡 Connectable | MCP/APIあり、未検証または成功率低 |\n`;
  md += `| ⚪ Info Only | API・MCPなし |\n\n`;

  md += `### グレード\n\n`;
  md += `| Grade | Score Range | 意味 |\n|-------|------------|------|\n`;
  md += `| 🏆 AAA | 0.90+ | エージェント経済のリーダー |\n`;
  md += `| 🥇 AA | 0.80+ | エージェント対応優良 |\n`;
  md += `| 🥈 A | 0.70+ | エージェント対応良好 |\n`;
  md += `| 🥉 BBB | 0.60+ | 基本対応済み |\n`;
  md += `| ▫️ BB | 0.50+ | 改善余地あり |\n`;
  md += `| ▫️ B | 0.40+ | 対応不十分 |\n`;
  md += `| ▫️ C | 0.30+ | 要改善 |\n`;
  md += `| ▫️ D | <0.30 | 未対応 |\n\n`;

  md += `---\n\n`;
  md += `### データソース\n\n`;
  md += `- **エージェント利用データ:** KanseiLink MCP Intelligence Layer経由のリアルタイム利用統計\n`;
  md += `- **API監査:** 公式ドキュメント、認証フロー、エンドポイント可用性の手動検証\n`;
  md += `- **MCPレジストリ:** modelcontextprotocol.io 公式レジストリのスキャン\n`;
  md += `- **レシピ検証:** ${recipes.length}件のクロスサービス連携パターンの動作確認\n\n`;

  md += `---\n\n`;
  md += `*本レポートはKanseiLink AEO評価エンジンにより自動生成されています。*  \n`;
  md += `*評価結果に関するお問い合わせ・AEOスコア改善コンサルティング: contact@synapsearrows.com*\n`;

  return md;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "generate_aeo_article",
    {
      title: "Generate AEO Ranking Article",
      description:
        "Generate a publishable AEO (Agent Engine Optimization) Readiness Ranking article. " +
        "Like ESG rating reports — ranks SaaS/API services (global + Japanese) by agent-readiness with grades, " +
        "category breakdowns, and methodology. Output in markdown (blog/press) or JSON (API/embed).",
      inputSchema: z.object({
        quarter: z
          .string()
          .default("Q2 2026")
          .describe("Report period label (e.g., 'Q2 2026', '2026年上半期')"),
        format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe("Output format: 'markdown' for blog/press, 'json' for API/embed"),
        top_n: z
          .number()
          .default(20)
          .describe("Number of services in the overall ranking table (default: 20)"),
        categories: z
          .array(z.string())
          .optional()
          .describe("Focus categories for deep-dive sections. Omit for default set."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ quarter, format, top_n, categories }) => {
      const result = generateArticle(db, { quarter, format, topN: top_n, categories });
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}

export { generateArticle };
