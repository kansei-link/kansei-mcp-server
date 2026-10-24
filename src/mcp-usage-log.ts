import type Database from "better-sqlite3";
import { agentIdHash, ANONYMOUS_AGENT, sessionMaterial } from "./agent-id.js";
import { detectMode as detectLookupMode } from "./tools/lookup.js";
import { detectMode as detectReportMode } from "./tools/report-unified.js";
import { classifyClient, clientKinds, type ClientKind } from "./utils/client-kind.js";

/**
 * Usage log for the hosted /mcp (disclosure stage 2a, 2026-10-24).
 *
 * One row per JSON-RPC request that reaches /mcp and is an `initialize` or a `tools/call`.
 * What a row holds — and nothing else:
 *   called_at        UTC, rounded down to the minute
 *   kind             initialize | tools_call
 *   tool             the tool name when it is one of ours, else 'other'
 *   service_id       only when the argument matches ^[a-z0-9][a-z0-9-]{0,63}$ AND the id exists in
 *                    `services`; otherwise NULL and service_unknown = 1 (the unknown id itself is not kept)
 *   mode             the lookup / report mode as the tool itself derives it (an enumerated value)
 *   outcome          ok | tool_error | invalid_params | unknown_tool | internal_error | error | no_response
 *   client_name/version  clientInfo from `initialize` (letters, digits, `.-_ ` up to 64 chars; else 'other').
 *                    The hosted /mcp is stateless, so a tools/call request carries no clientInfo: those
 *                    rows keep NULL here and the client is counted from the initialize rows.
 *   ua_class         ai_crawler | mcp_client | browser | unknown (same classifier as ask_log; the raw UA is not kept)
 *   server_version   package.json version
 *   agent_hash       salted sha256 of the Mcp-Session-Id (src/agent-id.ts); NULL when there is none
 * Never stored: tool arguments (intent, goal, q, error, note bodies…), IPs, raw user agents, responses.
 * Retention: USAGE_LOG_RETENTION_DAYS (same as ask_log), applied when the schema is ensured.
 * Switch: USAGE_LOG_ENABLED (default on; "0" / "false" → nothing is written).
 * A failure to write never fails the tool call (every write is wrapped).
 * Canonical: founder-ops/SEC-REVIEW-2026-10-24-001_UsageLog.md
 */

export const USAGE_LOG_RETENTION_DAYS = 180;
const SERVICE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CLIENT_RE = /^[A-Za-z0-9.\-_ ]{1,64}$/;
export const USAGE_TOOLS = ["search_services", "lookup", "report", "inspect", "analyze"] as const;
const LOOKUP_MODES = new Set(["tips", "detail", "insights", "recipe", "combinations", "history", "feedback", "voices", "notes", "ask"]);
const REPORT_MODES = new Set(["outcome", "feedback", "event", "voice", "note", "note_result"]);
export const USAGE_OUTCOMES = ["ok", "tool_error", "invalid_params", "unknown_tool", "internal_error", "error", "no_response"] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];
export type UsageKind = "initialize" | "tools_call";

export interface PendingUsage {
  /** JSON-RPC id of the request, used to pair the response. */
  rpcId: string | number;
  kind: UsageKind;
  tool: string | null;
  service_id: string | null;
  service_unknown: 0 | 1;
  mode: string | null;
  client_name: string | null;
  client_version: string | null;
}

export interface UsageContext {
  uaClass: string;
  serverVersion: string;
  /** The Mcp-Session-Id header (or transport session id), if any. */
  sessionId?: unknown;
}

export function usageLogEnabled(): boolean {
  const v = (process.env.USAGE_LOG_ENABLED ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0");
}

export function ensureUsageLogSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      called_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      tool TEXT,
      service_id TEXT,
      service_unknown INTEGER NOT NULL DEFAULT 0,
      mode TEXT,
      outcome TEXT NOT NULL,
      client_name TEXT,
      client_version TEXT,
      ua_class TEXT NOT NULL,
      server_version TEXT NOT NULL,
      agent_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_usage_log_called_at ON mcp_usage_log(called_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_usage_log_tool_time ON mcp_usage_log(tool, called_at);
  `);
  db.prepare(`DELETE FROM mcp_usage_log WHERE called_at < datetime('now', ?)`).run(`-${USAGE_LOG_RETENTION_DAYS} days`);
}

/** UTC 'YYYY-MM-DD HH:MM:00' — the same text form SQLite's datetime('now') uses, minus the seconds. */
export function minuteOf(d: Date = new Date()): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")}:00`;
}

function clientField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return CLIENT_RE.test(s) ? s : "other";
}

function knownService(db: Database.Database, v: unknown): { service_id: string | null; service_unknown: 0 | 1 } {
  if (typeof v !== "string" || v.length === 0) return { service_id: null, service_unknown: 0 };
  if (!SERVICE_ID_RE.test(v)) return { service_id: null, service_unknown: 1 };
  const row = db.prepare(`SELECT 1 AS one FROM services WHERE id = ?`).get(v);
  return row ? { service_id: v, service_unknown: 0 } : { service_id: null, service_unknown: 1 };
}

function modeOf(tool: string, args: Record<string, unknown>): string | null {
  try {
    if (tool === "lookup") {
      const m = detectLookupMode(args as never);
      return m && LOOKUP_MODES.has(m) ? m : null;
    }
    if (tool === "report") {
      const m = detectReportMode(args as never);
      return m && REPORT_MODES.has(m) ? m : null;
    }
  } catch {
    /* a malformed argument shape is the tool's problem, not the log's */
  }
  return null;
}

/**
 * Read the JSON-RPC body of one POST /mcp (a single message or a batch) and describe the requests
 * worth a row. Nothing from the arguments is copied except the validated service id and the mode.
 */
export function describeUsage(db: Database.Database, body: unknown): PendingUsage[] {
  const msgs = Array.isArray(body) ? body : [body];
  const out: PendingUsage[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const { id, method, params } = m as { id?: unknown; method?: unknown; params?: unknown };
    if (typeof id !== "string" && typeof id !== "number") continue; // notifications have no response to pair
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    if (method === "initialize") {
      const ci = (p.clientInfo && typeof p.clientInfo === "object" ? p.clientInfo : {}) as Record<string, unknown>;
      out.push({ rpcId: id, kind: "initialize", tool: null, service_id: null, service_unknown: 0, mode: null,
        client_name: clientField(ci.name), client_version: clientField(ci.version) });
    } else if (method === "tools/call") {
      const name = typeof p.name === "string" ? p.name : "";
      const tool = (USAGE_TOOLS as readonly string[]).includes(name) ? name : "other";
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Record<string, unknown>;
      const svc = knownService(db, args.service_id);
      out.push({ rpcId: id, kind: "tools_call", tool, ...svc, mode: tool === "other" ? null : modeOf(tool, args),
        client_name: null, client_version: null });
    }
  }
  return out;
}

/** Classify a JSON-RPC response message into an enumerated outcome. The message content is not kept. */
export function outcomeOf(msg: unknown): UsageOutcome {
  const r = (msg && typeof msg === "object" ? msg : {}) as { result?: unknown; error?: { code?: unknown; message?: unknown } };
  if (r.error && typeof r.error === "object") {
    const code = r.error.code;
    const text = typeof r.error.message === "string" ? r.error.message.toLowerCase() : "";
    if (code === -32602) return /not found|unknown tool/.test(text) ? "unknown_tool" : "invalid_params";
    if (code === -32603) return "internal_error";
    return "error";
  }
  const res = (r.result && typeof r.result === "object" ? r.result : {}) as { isError?: unknown };
  return res.isError === true ? "tool_error" : "ok";
}

/** Write one row. Never throws. Returns false when nothing was written (switch off, or a failure). */
export function recordUsage(db: Database.Database, pending: PendingUsage, outcome: UsageOutcome, ctx: UsageContext): boolean {
  if (!usageLogEnabled()) return false;
  try {
    const hash = agentIdHash(sessionMaterial(ctx.sessionId));
    db.prepare(`INSERT INTO mcp_usage_log (called_at, kind, tool, service_id, service_unknown, mode, outcome,
        client_name, client_version, ua_class, server_version, agent_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(minuteOf(), pending.kind, pending.tool, pending.service_id, pending.service_unknown, pending.mode, outcome,
        pending.client_name, pending.client_version, ctx.uaClass, ctx.serverVersion, hash === ANONYMOUS_AGENT ? null : hash);
    return true;
  } catch (e) {
    console.error("[usage-log] write failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * Pair the responses one /mcp request sends with the pending rows, and write a row per answered
 * request; anything still unanswered when the response closes is written as 'no_response'.
 */
export function usageRecorder(db: Database.Database, pending: PendingUsage[], ctx: UsageContext) {
  const open = new Map<string, PendingUsage>(pending.map((p) => [String(p.rpcId), p]));
  const take = (rpcId: unknown): PendingUsage | undefined => {
    if (typeof rpcId !== "string" && typeof rpcId !== "number") return undefined;
    const k = String(rpcId);
    const p = open.get(k);
    if (p) open.delete(k);
    return p;
  };
  return {
    /** Call with every outgoing JSON-RPC message. */
    onSend(msg: unknown): void {
      try {
        const msgs = Array.isArray(msg) ? msg : [msg];
        for (const m of msgs) {
          const id = (m && typeof m === "object" ? (m as { id?: unknown }).id : undefined);
          const p = take(id);
          if (p) recordUsage(db, p, outcomeOf(m), ctx);
        }
      } catch { /* never let the log break the response */ }
    },
    /** Call once when the HTTP response is closed. */
    onClose(): void {
      try {
        for (const p of open.values()) recordUsage(db, p, "no_response", ctx);
        open.clear();
      } catch { /* same */ }
    },
  };
}

// ─── summary for GET /admin/activity ───────────────────────────────

const TOP = 20;

/**
 * initialize rows split by client kind (probe = directories, quality/ranking probes and crawlers;
 * agent = confirmed real clients; unknown = the rest). Computed over every client name in the window,
 * not only the top 20 shown in by_client. Reads client_name only; nothing new is collected.
 */
export function clientKindSummary(db: Database.Database, since: string) {
  const kinds = clientKinds();
  const all = db.prepare(`SELECT client_name, client_version, count(*) AS n FROM mcp_usage_log
    WHERE kind = 'initialize' AND called_at >= ${since} GROUP BY client_name, client_version`).all() as Array<{
      client_name: string | null; client_version: string | null; n: number }>;
  const byKind: Record<ClientKind, { initializes: number; clients: number }> = {
    probe: { initializes: 0, clients: 0 }, agent: { initializes: 0, clients: 0 }, unknown: { initializes: 0, clients: 0 },
  };
  const seen: Record<ClientKind, Set<string>> = { probe: new Set(), agent: new Set(), unknown: new Set() };
  const nonProbe: Array<{ client_name: string | null; client_version: string | null; kind: ClientKind; n: number }> = [];
  for (const r of all) {
    const k = classifyClient(r.client_name, kinds);
    byKind[k].initializes += r.n;
    seen[k].add(r.client_name ?? "");
    if (k !== "probe") nonProbe.push({ ...r, kind: k });
  }
  for (const k of Object.keys(byKind) as ClientKind[]) byKind[k].clients = seen[k].size;
  nonProbe.sort((a, b) => b.n - a.n || String(a.client_name).localeCompare(String(b.client_name)) || String(a.client_version).localeCompare(String(b.client_version)));
  return {
    by_client_kind: byKind,
    initializes_excluding_probes: byKind.agent.initializes + byKind.unknown.initializes,
    clients_excluding_probes: nonProbe.slice(0, TOP),
  };
}

export function usageSummary(db: Database.Database, days = 7) {
  const since = `datetime('now', '-${Math.max(1, Math.floor(days))} days')`;
  const rows = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  type N = { n: number };
  const calls = one(`SELECT count(*) AS n FROM mcp_usage_log WHERE kind = 'tools_call' AND called_at >= ${since}`);
  const initializes = one(`SELECT count(*) AS n FROM mcp_usage_log WHERE kind = 'initialize' AND called_at >= ${since}`);
  return {
    log_enabled: usageLogEnabled(),
    window_days: days,
    calls,
    initializes,
    by_tool: rows<{ tool: string } & N>(`SELECT tool, count(*) AS n FROM mcp_usage_log
      WHERE kind = 'tools_call' AND called_at >= ${since} GROUP BY tool ORDER BY n DESC, tool`),
    by_tool_mode: rows<{ tool: string; mode: string | null } & N>(`SELECT tool, mode, count(*) AS n FROM mcp_usage_log
      WHERE kind = 'tools_call' AND called_at >= ${since} GROUP BY tool, mode ORDER BY n DESC, tool, mode`),
    top_services: rows<{ service_id: string } & N>(`SELECT service_id, count(*) AS n FROM mcp_usage_log
      WHERE kind = 'tools_call' AND service_id IS NOT NULL AND called_at >= ${since}
      GROUP BY service_id ORDER BY n DESC, service_id LIMIT ${TOP}`),
    unknown_service_ids: one(`SELECT count(*) AS n FROM mcp_usage_log WHERE service_unknown = 1 AND called_at >= ${since}`),
    by_outcome: rows<{ outcome: string } & N>(`SELECT outcome, count(*) AS n FROM mcp_usage_log
      WHERE kind = 'tools_call' AND called_at >= ${since} GROUP BY outcome ORDER BY n DESC, outcome`),
    by_client: rows<{ client_name: string | null; client_version: string | null } & N>(`SELECT client_name, client_version, count(*) AS n
      FROM mcp_usage_log WHERE kind = 'initialize' AND called_at >= ${since}
      GROUP BY client_name, client_version ORDER BY n DESC, client_name, client_version LIMIT ${TOP}`),
    by_ua_class: rows<{ ua_class: string } & N>(`SELECT ua_class, count(*) AS n FROM mcp_usage_log
      WHERE kind = 'tools_call' AND called_at >= ${since} GROUP BY ua_class ORDER BY n DESC, ua_class`),
    by_server_version: rows<{ server_version: string } & N>(`SELECT server_version, count(*) AS n FROM mcp_usage_log
      WHERE called_at >= ${since} GROUP BY server_version ORDER BY n DESC, server_version`),
    distinct_agent_hashes: one(`SELECT count(DISTINCT agent_hash) AS n FROM mcp_usage_log
      WHERE agent_hash IS NOT NULL AND called_at >= ${since}`),
    calls_without_agent_hash: one(`SELECT count(*) AS n FROM mcp_usage_log
      WHERE kind = 'tools_call' AND agent_hash IS NULL AND called_at >= ${since}`),
    ...clientKindSummary(db, since),
    note: "hosted /mcp is stateless: clientInfo only arrives with initialize, and Mcp-Session-Id is rarely sent, so most tools_call rows have no client and no agent hash",
  };
}
