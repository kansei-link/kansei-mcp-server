import { classifyClient, clientKinds, type ClientKinds } from "./client-kind.js";

/**
 * User-Agent → one enumerated word for the hosted /mcp usage log (SEC-2026-10-24-001 addendum A).
 *
 * Only the result is stored; the raw User-Agent, its version and everything after the product
 * token are dropped here and never reach the database.
 *
 * The product token is the text before the first "/" or space, lowercased
 * ("claude-code/2.1.301 (…)" → "claude-code"). Then, in this order:
 *   1. claude-code                      → claude-code   (Claude Code; confirmed locally in #89)
 *   2. codex-mcp-client                 → codex         (Codex CLI; confirmed locally in #89)
 *   3. a probe by the #89 list          → probe         (src/data/mcp-client-kinds.json: probe names
 *                                                        and patterns, applied to the token)
 *   4. node                             → node          (the bare TypeScript SDK / Node fetch)
 *   5. python-httpx, python-requests,   → python
 *      python-urllib, aiohttp, httpx, python
 *   6. anything else, or no User-Agent  → other
 * The two client names come first, so a real client's token can never be read as a probe pattern.
 */
export const UA_FAMILIES = ["claude-code", "codex", "probe", "node", "python", "other"] as const;
export type UaFamily = (typeof UA_FAMILIES)[number];

const EXACT: Record<string, UaFamily> = {
  "claude-code": "claude-code",
  "codex-mcp-client": "codex",
};
const PYTHON = new Set(["python-httpx", "python-requests", "python-urllib", "aiohttp", "httpx", "python"]);
const TOKEN_MAX = 64;

/** The product token: before the first "/" or whitespace, lowercased; "" when there is none. */
export function productToken(ua: unknown): string {
  if (typeof ua !== "string") return "";
  const t = ua.trim().split(/[\s/]/, 1)[0] ?? "";
  return t.length > TOKEN_MAX ? "" : t.toLowerCase();
}

export function uaFamily(ua: unknown, kinds: ClientKinds = clientKinds()): UaFamily {
  const t = productToken(ua);
  if (!t) return "other";
  const exact = EXACT[t];
  if (exact) return exact;
  if (classifyClient(t, kinds) === "probe") return "probe";
  if (t === "node") return "node";
  if (PYTHON.has(t)) return "python";
  return "other";
}
