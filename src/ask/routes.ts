import { type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { clientIp } from "../utils/client-ip.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { classifyUserAgent, requestIdOf } from "../ard.js";
import { ask, askStats, askCandidates, ensureAskSchema, AskError, ASK_GET_MAX, ASK_POST_MAX } from "./engine.js";

// RFC 9457 problem details, same shape as /ard/*.
function sendProblem(res: Response, status: number, slug: string, title: string, detail: string): void {
  res.status(status).type("application/problem+json").send(JSON.stringify({
    type: `https://kansei-link.com/problems/${slug}`,
    title, status, detail,
    instance: `urn:kansei:request:${requestIdOf(res)}`,
  }));
}

const TITLES: Record<string, string> = {
  too_long: "Error text too long",
  service_not_found: "Service not found",
  daily_limit: "Daily capacity reached",
};

export function createAskHandlers(db: Database.Database) {
  ensureAskSchema(db);
  // 30/min/IP on the ask endpoints; the global 5,000/day cap lives in the engine (shared with MCP).
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)), // the visitor, not the Cloudflare edge
    message: { error: "rate_limited" } });

  function run(req: Request, res: Response, raw: unknown, maxErrorLength: number): void {
    res.setHeader("Cache-Control", "no-store");
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { uaClass } = classifyUserAgent(req.header("user-agent") ?? "");
      res.json(ask(db, raw, { uaClass, requestId, maxErrorLength }));
    } catch (e) {
      if (e instanceof z.ZodError) { sendProblem(res, 400, "bad-request", "Bad request", "service (id) and error (text) are required; runtime is optional"); return; }
      if (e instanceof AskError) { sendProblem(res, e.status, e.code.replace(/_/g, "-"), TITLES[e.code] ?? "Request refused", e.message); return; }
      sendProblem(res, 500, "ask-unavailable", "ask unavailable", "temporary failure; the request was not recorded");
    }
  }

  return {
    limiter,
    get: (req: Request, res: Response) => run(req, res, {
      service: req.query.service, error: req.query.error, runtime: req.query.runtime,
    }, ASK_GET_MAX),
    post: (req: Request, res: Response) => run(req, res, req.body, ASK_POST_MAX),
    stats: (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(askStats(db));
    },
    // Caller must already have passed the /admin/* secret check (http-server.ts).
    candidates: (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(askCandidates(db));
    },
  };
}
