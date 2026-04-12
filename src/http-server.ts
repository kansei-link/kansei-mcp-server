#!/usr/bin/env node

/**
 * KanseiLink MCP Server — Streamable HTTP Transport + Stripe Billing API
 *
 * Stateless mode: each request creates a fresh server + transport pair.
 * The SQLite database is shared across requests (read-heavy, WAL mode).
 *
 * Usage:
 *   node dist/http-server.js                  # default port 3000
 *   PORT=8080 node dist/http-server.js        # custom port
 *   KANSEI_HOST=0.0.0.0 node dist/http-server.js  # bind to all interfaces
 */

import express from "express";
import type { Request, Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { getDb, closeDb } from "./db/connection.js";
import { initializeDb } from "./db/schema.js";
import {
  handleStripeWebhook,
  handleAccessCheck,
  handleCreateCheckout,
  handleCustomerPortal,
} from "./stripe.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.KANSEI_HOST ?? "0.0.0.0";

const app = express();

// ─── Database Initialization ─────────────────────────────────────
// Ensure all tables (including subscriptions) exist before handling requests
initializeDb(getDb());

// ─── Security Hardening ───────────────────────────────────────────
// Helmet: sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet());

// Rate limiting — general (100 req/min per IP)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(generalLimiter);

// Strict rate limit for sensitive API endpoints (20 req/min per IP)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many API requests, please try again later." },
});

// Stripe webhook needs raw body for signature verification — must be before express.json()
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

// JSON body parser for all other routes
app.use(express.json());

// CORS for frontend API access
app.use("/api", (_req: Request, res: Response, next) => {
  const origin = process.env.KANSEI_PUBLIC_URL ?? "https://kansei-link.com";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// ─── Stripe Billing API ────────────────────────────────────────────
// Public config: exposes price IDs for client-side checkout buttons (no secrets)
app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    prices: {
      proMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "",
      proAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL ?? "",
      team: process.env.STRIPE_PRICE_TEAM ?? "",
    },
  });
});
app.get("/api/access", apiLimiter, handleAccessCheck);
app.post("/api/checkout", apiLimiter, handleCreateCheckout);
app.post("/api/portal", apiLimiter, handleCustomerPortal);

// ─── MCP + Health ──────────────────────────────────────────────────
// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "kansei-link",
    version: "0.20.1",
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
