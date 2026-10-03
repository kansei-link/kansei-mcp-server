import type Database from "better-sqlite3";
import { hasFreshHandshake, type McpStatusInput } from "../utils/mcp-status.js";

export interface DeepAuditTarget {
  id: string;
  name: string;
  mcp_endpoint: string;
  trust_score: number;
}

/**
 * The services deep-audit inspects: the same condition under which the display
 * function would show `verified` liveness — a handshake on the CURRENT endpoint,
 * dated within MCP_LIVENESS_TTL_DAYS, not in the future, a real calendar date —
 * and not archived (Codex review 5 of dc319cf, finding on deep-audit.ts:276).
 * The SQL only narrows the candidates; the decision is hasFreshHandshake().
 */
export function selectDeepAuditTargets(db: Database.Database, limit: number, now: Date = new Date()): DeepAuditTarget[] {
  const rows = db
    .prepare(
      `SELECT id, name, mcp_endpoint, trust_score, archived, mcp_status,
              mcp_liveness, mcp_liveness_checked_at, mcp_liveness_endpoint
       FROM services
       WHERE mcp_liveness = 'handshake'
         AND mcp_liveness_endpoint = mcp_endpoint
         AND mcp_endpoint IS NOT NULL
         AND COALESCE(archived, 0) = 0
       ORDER BY trust_score DESC`
    )
    .all() as Array<DeepAuditTarget & McpStatusInput>;
  return rows
    .filter((r) => hasFreshHandshake(r, now))
    .slice(0, Math.max(0, limit))
    .map(({ id, name, mcp_endpoint, trust_score }) => ({ id, name, mcp_endpoint, trust_score }));
}
