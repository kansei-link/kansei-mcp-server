#!/usr/bin/env node

/**
 * KanseiLink MCP Server — Streamable HTTP Transport
 *
 * Stateless mode: each request creates a fresh server + transport pair.
 * The SQLite database is shared across requests (read-heavy, WAL mode).
 *
 * Usage:
 *   node dist/http-server.js                  # default port 3000
 *   PORT=8080 node dist/http-server.js        # custom port
 *   KANSEI_HOST=0.0.0.0 node dist/http-server.js  # bind to all interfaces
 */

import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createServer } from "./server.js";
import { closeDb } from "./db/connection.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.KANSEI_HOST ?? "0.0.0.0";

// For cloud deployment: no allowedHosts restriction when binding to 0.0.0.0
// DNS rebinding protection is auto-enabled only for localhost bindings
const app = createMcpExpressApp({ host: HOST });

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "kansei-link",
    version: "0.18.3",
    transport: "streamable-http",
  });
});

// MCP endpoint — stateless: each request gets a fresh server
app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// Reject GET/DELETE on /mcp (stateless mode)
app.get("/mcp", (_req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    })
  );
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    })
  );
});

// Start
app.listen(PORT, () => {
  console.log(
    `KanseiLink MCP Server (Streamable HTTP) listening on http://${HOST}:${PORT}/mcp`
  );
  console.log(`Health check: http://${HOST}:${PORT}/health`);
}).on("error", (error: Error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

// Clean shutdown
process.on("SIGINT", () => {
  console.log("Shutting down...");
  closeDb();
  process.exit(0);
});
process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});
