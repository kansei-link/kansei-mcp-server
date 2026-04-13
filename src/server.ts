import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "./db/connection.js";
import { initializeDb } from "./db/schema.js";
import { seedDatabase } from "./db/seed.js";
import { register as registerSearchServices } from "./tools/search-services.js";
import { register as registerGetRecipe } from "./tools/get-recipe.js";
import { register as registerReportOutcome } from "./tools/report-outcome.js";
import { register as registerGetInsights } from "./tools/get-insights.js";
import { register as registerFindCombinations } from "./tools/find-combinations.js";
import { register as registerCheckUpdates } from "./tools/check-updates.js";
import { register as registerGetServiceDetail } from "./tools/get-service-detail.js";
import { register as registerGetServiceTips } from "./tools/get-service-tips.js";
import { register as registerGetInspectionQueue } from "./tools/get-inspection-queue.js";
import { register as registerSubmitInspection } from "./tools/submit-inspection.js";
import { register as registerGenerateAeoReport } from "./tools/generate-aeo-report.js";
import { register as registerGenerateAeoArticle } from "./tools/generate-aeo-article.js";
import { register as registerFeedback } from "./tools/submit-feedback.js";
import { register as registerProposeUpdate } from "./tools/propose-update.js";
import { register as registerTakeSnapshot } from "./tools/take-snapshot.js";
import { register as registerGetServiceHistory } from "./tools/get-service-history.js";
import { register as registerRecordEvent } from "./tools/record-event.js";
import { register as registerEvaluateDesign } from "./tools/evaluate-design.js";
import { register as registerAgentVoice } from "./tools/agent-voice.js";
import { register as registerAuditCost } from "./tools/audit-cost.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { recalculateTrustScores } from "./utils/trust-recalc.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "kansei-link",
    version: "0.16.0",
  });

  // Initialize database, seed data, and recalculate trust scores
  const db = getDb();
  initializeDb(db);
  seedDatabase(db);
  recalculateTrustScores(db);

  // Register all tools
  registerSearchServices(server, db);
  registerGetRecipe(server, db);
  registerGetServiceDetail(server, db);
  registerReportOutcome(server, db);
  registerGetInsights(server, db);
  registerFindCombinations(server, db);
  registerCheckUpdates(server, db);
  registerGetServiceTips(server, db);
  registerGetInspectionQueue(server, db);
  registerSubmitInspection(server, db);
  registerGenerateAeoReport(server, db);
  registerGenerateAeoArticle(server, db);
  registerFeedback(server, db);
  registerProposeUpdate(server, db);
  registerTakeSnapshot(server, db);
  registerGetServiceHistory(server, db);
  registerRecordEvent(server, db);
  registerEvaluateDesign(server, db);
  registerAgentVoice(server, db);
  registerAuditCost(server, db);

  // Register prompts (LobeHub Grade A)
  registerPrompts(server);

  // Register resources (LobeHub Grade A)
  registerResources(server, db);

  return server;
}
