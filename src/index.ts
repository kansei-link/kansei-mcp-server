#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { closeDb } from "./db/connection.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  // Clean shutdown
  process.on("SIGINT", () => {
    closeDb();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    closeDb();
    process.exit(0);
  });

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  closeDb();
  process.exit(1);
});
