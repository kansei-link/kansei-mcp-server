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
import { runCrawler } from "./crawler/run.js";

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

// ─── Dashboard Data API ───────────────────────────────────────────
app.get("/api/dashboard/stats", apiLimiter, (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Service counts & averages
    const serviceStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        ROUND(AVG(CASE WHEN axr_score IS NOT NULL THEN axr_score / 100.0 END), 2) as avg_aeo,
        SUM(CASE WHEN mcp_status = 'official' OR mcp_endpoint IS NOT NULL THEN 1 ELSE 0 END) as mcp_count
      FROM services
    `).get() as any;

    const recipeCount = (db.prepare(`SELECT COUNT(*) as c FROM recipes`).get() as any).c;

    // Grade distribution
    const grades = db.prepare(`
      SELECT axr_grade as grade, COUNT(*) as count
      FROM services WHERE axr_grade IS NOT NULL
      GROUP BY axr_grade ORDER BY count DESC
    `).all();

    // Category success rates (from service_stats)
    const categories = db.prepare(`
      SELECT s.category, ROUND(AVG(ss.success_rate) * 100) as avg_success,
             COUNT(*) as service_count
      FROM services s
      LEFT JOIN service_stats ss ON s.id = ss.service_id
      WHERE s.category IS NOT NULL
      GROUP BY s.category
      ORDER BY avg_success DESC NULLS LAST
      LIMIT 10
    `).all();

    // MCP adoption rate
    const mcpRate = serviceStats.total > 0
      ? Math.round((serviceStats.mcp_count / serviceStats.total) * 100)
      : 0;

    res.json({
      services: { total: serviceStats.total, avgAeo: serviceStats.avg_aeo || 0, mcpCount: serviceStats.mcp_count, mcpRate },
      recipes: { total: recipeCount },
      grades,
      categories,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dashboard/rankings", apiLimiter, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 225);
    const offset = parseInt(req.query.offset as string) || 0;

    const services = db.prepare(`
      SELECT s.id, s.name, s.category, s.axr_grade, s.axr_score,
             s.mcp_status, s.mcp_endpoint,
             COALESCE(ss.success_rate, 0) as success_rate,
             COALESCE(ss.avg_latency_ms, 0) as avg_latency_ms
      FROM services s
      LEFT JOIN service_stats ss ON s.id = ss.service_id
      WHERE s.axr_score IS NOT NULL
      ORDER BY s.axr_score DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = (db.prepare(`SELECT COUNT(*) as c FROM services WHERE axr_score IS NOT NULL`).get() as any).c;

    res.json({ services, total });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dashboard/voices", apiLimiter, (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // Check if agent_voice_responses table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='agent_voice_responses'
    `).get();

    if (!tableExists) {
      res.json({ voices: [] });
      return;
    }

    const voices = db.prepare(`
      SELECT v.service_id, s.name as service_name, s.axr_grade,
             v.agent_type, v.question_id, v.response_choice, v.response_text,
             v.confidence, v.created_at
      FROM agent_voice_responses v
      JOIN services s ON v.service_id = s.id
      ORDER BY v.created_at DESC
      LIMIT 20
    `).all();

    res.json({ voices });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dashboard/recipes", apiLimiter, (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const recipes = db.prepare(`
      SELECT id, goal, description, required_services, gotchas
      FROM recipes
      ORDER BY id
      LIMIT 50
    `).all();

    res.json({ recipes, total: (db.prepare(`SELECT COUNT(*) as c FROM recipes`).get() as any).c });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Cost Auditor API ─────────────────────────────────────────────
app.get("/api/dashboard/costs", apiLimiter, (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Model-level spending summary
    const modelSpend = db.prepare(`
      SELECT model_name,
             SUM(total_calls) as total_calls,
             ROUND(SUM(avg_cost_usd * total_calls), 2) as total_spend,
             ROUND(AVG(avg_cost_usd), 4) as avg_cost_per_call,
             ROUND(AVG(success_rate) * 100) as avg_success_rate
      FROM model_service_stats
      WHERE total_calls > 0
      GROUP BY model_name
      ORDER BY total_spend DESC
    `).all();

    // Service-level spending summary
    const serviceSpend = db.prepare(`
      SELECT mss.service_id, s.name as service_name, s.category,
             SUM(mss.total_calls) as total_calls,
             ROUND(SUM(mss.avg_cost_usd * mss.total_calls), 2) as total_spend,
             GROUP_CONCAT(DISTINCT mss.model_name) as models_used
      FROM model_service_stats mss
      JOIN services s ON mss.service_id = s.id
      WHERE mss.total_calls > 0
      GROUP BY mss.service_id
      ORDER BY total_spend DESC
      LIMIT 20
    `).all();

    // Model-service cost comparison (for optimization recommendations)
    const modelPairs = db.prepare(`
      SELECT mss1.service_id, s.name as service_name,
             mss1.model_name as current_model, mss1.avg_cost_usd as current_cost,
             ROUND(mss1.success_rate * 100) as current_sr,
             mss1.total_calls as current_calls,
             mss2.model_name as cheaper_model, mss2.avg_cost_usd as cheaper_cost,
             ROUND(mss2.success_rate * 100) as cheaper_sr,
             ROUND((mss1.avg_cost_usd - mss2.avg_cost_usd) * mss1.total_calls, 2) as potential_savings
      FROM model_service_stats mss1
      JOIN model_service_stats mss2
        ON mss1.service_id = mss2.service_id
        AND mss1.task_type = mss2.task_type
        AND mss1.model_name != mss2.model_name
      JOIN services s ON mss1.service_id = s.id
      WHERE mss2.avg_cost_usd < mss1.avg_cost_usd
        AND mss2.success_rate >= mss1.success_rate - 0.05
        AND mss1.total_calls >= 3 AND mss2.total_calls >= 3
      ORDER BY potential_savings DESC
      LIMIT 10
    `).all();

    // Infrastructure tips
    const tips = db.prepare(`
      SELECT tip_id, category, title, from_stack, to_stack,
             savings_pct, confidence, conditions, evidence_url, evidence_summary
      FROM infrastructure_tips
      WHERE confidence IN ('verified', 'conditional')
      ORDER BY savings_pct DESC
    `).all();

    // Totals
    const totalSpend = db.prepare(`
      SELECT ROUND(SUM(avg_cost_usd * total_calls), 2) as total
      FROM model_service_stats
    `).get() as any;

    const totalOutcomes = db.prepare(`
      SELECT COUNT(*) as cnt FROM outcomes
    `).get() as any;

    res.json({
      summary: {
        total_spend_usd: totalSpend?.total ?? 0,
        total_outcome_reports: totalOutcomes?.cnt ?? 0,
        models_tracked: modelSpend.length,
        services_with_data: serviceSpend.length,
      },
      model_spend: modelSpend,
      service_spend: serviceSpend,
      optimization_opportunities: modelPairs,
      infrastructure_tips: tips,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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

// ─── Admin endpoints (secret-token-protected) ─────────────────────
// Tracks whether a crawler run is currently in flight so repeated cron
// pings don't launch overlapping runs.
let crawlerRunning = false;

function requireAdminSecret(req: Request, res: Response): boolean {
  const expected = process.env.CRAWLER_SECRET;
  if (!expected) {
    res.status(503).json({ error: "CRAWLER_SECRET not configured on server" });
    return false;
  }
  const authHeader = req.header("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const provided = bearer || req.header("x-crawler-secret");
  if (provided !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

/**
 * POST /admin/run-crawler
 *   Headers:  Authorization: Bearer <CRAWLER_SECRET>
 *   Body:     { dry_run?: boolean, since_days?: number, max?: number }
 *
 * Returns 202 Accepted immediately; the crawler runs async in-process.
 * Poll /admin/last-crawl-run or query crawl_runs directly for status.
 */
app.post("/admin/run-crawler", async (req: Request, res: Response) => {
  if (!requireAdminSecret(req, res)) return;

  if (crawlerRunning) {
    return res.status(409).json({ error: "crawler_already_running" });
  }

  const body = (req.body || {}) as {
    dry_run?: boolean;
    since_days?: number;
    max?: number;
  };
  const options = {
    dryRun: Boolean(body.dry_run),
    sinceDays: typeof body.since_days === "number" ? body.since_days : undefined,
    maxResults: typeof body.max === "number" ? body.max : undefined,
  };

  crawlerRunning = true;
  res.status(202).json({
    status: "started",
    options,
    poll: "/admin/last-crawl-run",
  });

  // Fire and forget — shared DB connection, no new process needed
  runCrawler(getDb(), options)
    .then((summary) => {
      console.log(
        `[admin] crawler finished: status=${summary.status}, run_id=${summary.run_id}, ingested=${summary.auto_accepted}`
      );
    })
    .catch((err) => {
      console.error("[admin] crawler crashed:", err);
    })
    .finally(() => {
      crawlerRunning = false;
    });
});

/**
 * GET /admin/last-crawl-run
 *   Headers:  Authorization: Bearer <CRAWLER_SECRET>
 *
 * Returns the most recent row from crawl_runs.
 */
app.get("/admin/last-crawl-run", (req: Request, res: Response) => {
  if (!requireAdminSecret(req, res)) return;

  const row = getDb()
    .prepare(
      `SELECT id, started_at, finished_at, status,
              discovered_count, auto_accepted_count, review_queue_count,
              rejected_count, duplicates_count, errors
       FROM crawl_runs
       ORDER BY id DESC
       LIMIT 1`
    )
    .get();

  res.json({ running: crawlerRunning, last_run: row || null });
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
