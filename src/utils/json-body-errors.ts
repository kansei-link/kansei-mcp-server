import type { NextFunction, Request, Response } from "express";

// ---------------------------------------------------------------------------
// Error handler for express.json() (Codex review 2026-10-21, P1).
//
// Without it, a malformed JSON body falls through to Express's default error
// handler, which prints the SyntaxError to stderr — and Node's message quotes
// the raw body ("Unexpected token 'v', \"[violetkey]\" is not valid JSON").
// Whatever a caller pasted (tokens, error text) would land in the server log.
//
// Register right after app.use(express.json()). For parse / size errors it
// answers 400 / 413 with a fixed body and logs only the error type, the path
// and the request id. Every other error goes on to next(err) unchanged.
// Applies to every JSON route (ask, notes, events, ...), not only ask.
// ---------------------------------------------------------------------------

const HANDLED: Record<string, { status: number; error: string }> = {
  "entity.parse.failed": { status: 400, error: "invalid_json" },
  "entity.too.large": { status: 413, error: "payload_too_large" },
};

export function jsonBodyErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const type = (err as { type?: unknown } | null)?.type;
  const handled = typeof type === "string" ? HANDLED[type] : undefined;
  if (!handled) { next(err); return; }
  const rid = (res.locals?.requestId as string | undefined) ?? "-";
  console.warn(`[json] ${type} path=${req.path} rid=${rid}`);
  res.status(handled.status).setHeader("Cache-Control", "no-store");
  res.json({ error: handled.error });
}
