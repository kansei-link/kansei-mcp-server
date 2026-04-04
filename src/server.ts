import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "./db/connection.js";
import { initializeDb } from "./db/schema.js";
import { register as registerSearchServices } from "./tools/search-services.js";
import { register as registerGetRecipe } from "./tools/get-recipe.js";
import { register as registerReportOutcome } from "./tools/report-outcome.js";
import { register as registerGetInsights } from "./tools/get-insights.js";
import { register as registerFindCombinations } from "./tools/find-combinations.js";
import { register as registerCheckUpdates } from "./tools/check-updates.js";
import { register as registerGetServiceDetail } from "./tools/get-service-detail.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "kansei-link",
    version: "0.7.0",
  });

  // Initialize database
  const db = getDb();
  initializeDb(db);

  // Register all tools
  registerSearchServices(server, db);
  registerGetRecipe(server, db);
  registerGetServiceDetail(server, db);
  registerReportOutcome(server, db);
  registerGetInsights(server, db);
  registerFindCombinations(server, db);
  registerCheckUpdates(server, db);

  // Register prompts (LobeHub Grade A)
  registerPrompts(server);

  // Register resources (LobeHub Grade A)
  registerResources(server, db);

  return server;
}
