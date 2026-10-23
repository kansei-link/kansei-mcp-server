import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// agent_id_hash for outcomes — "the same caller" without keeping who the caller is.
//
// agent_id_hash = first 32 hex chars of sha256(AGENT_HASH_SALT + ":" + material).
// The material is never stored; only the hash is. Material, by caller:
//   - HTTP MCP:            the Mcp-Session-Id of the request (Streamable HTTP session); the hosted
//                          /mcp is stateless and sends none, so the `report` tool's optional
//                          session_id (UUID, same value for one task) is the next material
//   - /api/report-outcome: an optional session_id (UUID) in the body
//   - stdio (local npm):   one random id created once per installation, kept in
//                          the local DB (agent_install_identity)
// IP addresses and user agents are never used as material.
// No salt, or no material → 'anonymous' (not counted, exactly as before).

export const ANONYMOUS_AGENT = "anonymous";
const HASH_LEN = 32;
const MATERIAL_MAX = 200;

let warned = false;

export function agentHashSalt(): string | null {
  const salt = process.env.AGENT_HASH_SALT;
  return salt && salt.length >= 16 ? salt : null;
}

/** Log once (stderr) when the salt is missing, so every report stays 'anonymous'. */
export function warnIfNoAgentSalt(): void {
  if (warned || agentHashSalt()) return;
  warned = true;
  console.error("[agent-id] AGENT_HASH_SALT is not set (or shorter than 16 chars): outcome reports are stored as 'anonymous' and unique_agents is not counted.");
}

/** Hash a caller material, or 'anonymous' when there is no salt or no material. */
export function agentIdHash(material: string | null | undefined): string {
  const salt = agentHashSalt();
  const m = typeof material === "string" ? material.trim().slice(0, MATERIAL_MAX) : "";
  if (!salt || !m) return ANONYMOUS_AGENT;
  return createHash("sha256").update(`${salt}:${m}`).digest("hex").slice(0, HASH_LEN);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_RE = /^[\x21-\x7e]{8,200}$/; // Mcp-Session-Id: visible ASCII per the MCP spec

/** A body session_id accepted as material only when it is a UUID. */
export function uuidMaterial(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** An Mcp-Session-Id accepted as material only when it is visible ASCII of sane length. */
export function sessionMaterial(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && SESSION_RE.test(v) ? v : null;
}

/**
 * The material for an outcome reported through the `report` tool, in this order (first one wins):
 *   1. Mcp-Session-Id (transport session, or the request header)
 *   2. the tool's optional `session_id` argument — a UUID the agent keeps for one task
 *      (the hosted /mcp is stateless and issues no Mcp-Session-Id, so this is what counts there)
 *   3. the stdio per-installation id
 *   → none of them: null, and the report is stored as 'anonymous'
 */
export function outcomeAgentMaterial(src: {
  transportSessionId?: unknown;
  sessionHeader?: unknown;
  argSessionId?: unknown;
  installMaterial?: string | null;
}): string | null {
  return sessionMaterial(src.transportSessionId)
    ?? sessionMaterial(src.sessionHeader)
    ?? uuidMaterial(src.argSessionId)
    ?? (src.installMaterial || null);
}

/** The per-installation random id for stdio, created once and kept in the local DB. */
export function installMaterial(db: Database.Database): string {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_install_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    install_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  const row = db.prepare(`SELECT install_id FROM agent_install_identity WHERE id = 1`).get() as { install_id: string } | undefined;
  if (row) return row.install_id;
  db.prepare(`INSERT OR IGNORE INTO agent_install_identity (id, install_id) VALUES (1, ?)`).run(randomUUID());
  return (db.prepare(`SELECT install_id FROM agent_install_identity WHERE id = 1`).get() as { install_id: string }).install_id;
}

/** For tests only. */
export function resetAgentSaltWarningForTests(): void {
  warned = false;
}
