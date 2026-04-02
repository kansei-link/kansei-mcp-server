import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "./db/connection.js";
import { initializeDb } from "./db/schema.js";
import { register as registerSearchServices } from "./tools/search-services.js";
import { register as registerGetRecipe } from "./tools/get-recipe.js";
import { register as registerReportOutcome } from "./tools/report-outcome.js";
import { register as registerGetInsights } from "./tools/get-insights.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "kansei-link",
    version: "0.1.0",
  });

  // Initialize database
  const db = getDb();
  initializeDb(db);

  // Register all tools
  registerSearchServices(server, db);
  registerGetRecipe(server, db);
  registerReportOutcome(server, db);
  registerGetInsights(server, db);

  return server;
}
