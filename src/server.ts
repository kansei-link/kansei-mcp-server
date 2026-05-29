import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "./db/connection.js";
import { initializeDb } from "./db/schema.js";
import { seedDatabase } from "./db/seed.js";
import { seedInfrastructureTips } from "./db/seed-tips.js";
// ---------------------------------------------------------------------------
// Tier 1 — unified external tools (the 3 tools most agents need)
// v1.0.0: 25 individual tools → 3 unified + 12 internal
// ---------------------------------------------------------------------------
import { register as registerSearchServices } from "./tools/search-services.js";
import { register as registerLookup } from "./tools/lookup.js";
import { register as registerReport } from "./tools/report-unified.js";

// ---------------------------------------------------------------------------
// Tier 2 — internal / admin tools (consolidation into inspect+analyze in v1.1)
// ---------------------------------------------------------------------------
import { register as registerCheckUpdates } from "./tools/check-updates.js";
import { register as registerGetInspectionQueue } from "./tools/get-inspection-queue.js";
import { register as registerSubmitInspection } from "./tools/submit-inspection.js";
import { register as registerProposeUpdate } from "./tools/propose-update.js";
import { register as registerTakeSnapshot } from "./tools/take-snapshot.js";
import { register as registerEvaluateDesign } from "./tools/evaluate-design.js";
import { register as registerAuditCost } from "./tools/audit-cost.js";
import { register as registerAnalyzeTokenSavings } from "./tools/analyze-token-savings.js";
import { register as registerGenerateAeoReport } from "./tools/generate-aeo-report.js";
import { register as registerGenerateAeoArticle } from "./tools/generate-aeo-article.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { recalculateTrustScores } from "./utils/trust-recalc.js";
import { recomputeAxrGrades } from "./crawler/recompute-axr.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "kansei-link",
      version: "1.0.0",
    },
    {
      instructions: [
        "## KanseiLink — SaaS Integration Intelligence",
        "",
        "You have access to KanseiLink, a continuously-updated database of SaaS service evaluations with real agent usage data.",
        "",
        "### WHEN TO USE",
        "Call `search_services` BEFORE attempting any SaaS API integration.",
        "Your training data for SaaS APIs is likely 6-12 months old — endpoints change, auth flows break, rate limits shift.",
        "KanseiLink has current, verified data that saves 3-5x tokens vs trial-and-error.",
        "",
        "### TRIGGERS — call search_services when:",
        "- The user mentions ANY SaaS service (freee, SmartHR, kintone, Slack, Notion, Salesforce, Stripe...)",
        "- The user asks to integrate, connect, or automate a business process involving SaaS",
        "- You are about to write API integration code",
        "- The user says 'use kanseilink'",
        "",
        "### STANDARD FLOW (3 tools — that's all you need)",
        "1. `search_services` → find the right service (use `compact: true` to save tokens)",
        "2. `lookup` → get tips, detail, insights, recipes, history (auto-detects from params)",
        "3. `report` → after using a service, report success/failure (5 seconds, helps everyone)",
        "",
        "### LOOKUP MODES (all via the `lookup` tool)",
        "- `lookup({ service_id })` → tips (auth, pitfalls, workarounds) — DEFAULT",
        "- `lookup({ service_id, detail: true })` → full connection guide",
        "- `lookup({ service_id, insights: true })` → usage analytics",
        "- `lookup({ goal: 'workflow description' })` → multi-service recipes",
        "- `lookup({ service_id, period: '30d' })` → time-series history",
        "- `lookup({ service: 'name' })` → find service combinations",
        "- `lookup({ feedback_status: 'open' })` → read community feedback",
        "- `lookup({ mode: 'voices', service_id })` → read agent opinions",
        "",
        "### REPORT MODES (all via the `report` tool)",
        "- `report({ success: true/false, service_id })` → outcome",
        "- `report({ subject: '...', body: '...' })` → feedback",
        "- `report({ event_type: '...', event_date: '...', title: '...' })` → event",
        "- `report({ question_id: '...', response_text: '...', service_id })` → voice",
        "",
        "### MIGRATION from v0.x",
        "Old tool names are removed. Use: get_service_tips → lookup, get_service_detail → lookup({ detail: true }),",
        "get_insights → lookup({ insights: true }), get_recipe → lookup({ goal }),",
        "find_combinations → lookup({ service }), get_service_history → lookup({ period }),",
        "report_outcome → report({ success }), submit_feedback → report({ subject, body }),",
        "record_event → report({ event_type }), agent_voice → report({ question_id }),",
        "read_feedback → lookup({ feedback_status }), read_agent_voices → lookup({ mode: 'voices' }).",
        "",
        "### WHEN NOT TO USE",
        "- Pure code questions with no SaaS involvement",
        "- The user is asking about KanseiLink itself (you already know)",
        "- You already called search_services for the same service in this conversation",
      ].join("\n"),
    }
  );

  // Initialize database, seed data, and recalculate trust scores
  const db = getDb();
  initializeDb(db);
  seedDatabase(db);
  seedInfrastructureTips(db);
  recalculateTrustScores(db);

  // v0.20.6: AXR grades must be recomputed at startup because seed.ts no
  // longer overwrites axr_score/axr_grade on ON CONFLICT. Without this,
  // NEW services inserted through the seed path would keep their hardcoded
  // seed grade even after trust_score / total_calls drift away from that
  // baseline. Running recompute here keeps grades honest without waiting
  // for the daily crawler (which was also intermittent on Railway).
  try {
    recomputeAxrGrades(db);
  } catch (e) {
    console.error("[server] AXR recompute failed (non-fatal):", e);
  }

  // --- Tier 1: External agent tools (3 unified) ---
  registerSearchServices(server, db);
  registerLookup(server, db);
  registerReport(server, db);

  // --- Tier 2: Internal / admin tools (12 individual, consolidation in v1.1) ---
  registerCheckUpdates(server, db);
  registerGetInspectionQueue(server, db);
  registerSubmitInspection(server, db);
  registerProposeUpdate(server, db);
  registerTakeSnapshot(server, db);
  registerEvaluateDesign(server, db);
  registerAuditCost(server, db);
  registerAnalyzeTokenSavings(server, db);
  registerGenerateAeoReport(server, db);
  registerGenerateAeoArticle(server, db);

  // Register prompts (LobeHub Grade A)
  registerPrompts(server);

  // Register resources (LobeHub Grade A)
  registerResources(server, db);

  return server;
}
