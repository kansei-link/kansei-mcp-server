#!/usr/bin/env node
/**
 * One-off triage of the 17 pending_updates (2026-07-06 sweep session).
 * Uses the production reviewUpdate() (approve = auto-apply + changelog +
 * trust recalc). Evidence for every decision is in the note.
 *
 *   node scripts/_review-proposals-20260706.mjs
 */
import { getDb } from "../dist/db/connection.js";
import { reviewUpdate } from "../dist/tools/propose-update.js";

const REVIEWER = "michie+claude-session-2026-07-06";

const DECISIONS = [
  { id: 1, action: "reject", note: "Package @freee-ag/freee-accounting-mcp does not exist on npm (404, checked 2026-07-06). Endpoint already corrected to official 'npx freee-mcp' (maintainer freee_developers) by the 2026-07-06 sweep." },
  { id: 2, action: "reject", note: "Same as #1 — @freee-ag/freee-accounting-mcp is 404 on npm. Current endpoint 'npx freee-mcp' is registry-verified official." },
  { id: 3, action: "approve", note: "Low-risk description clarification from bootstrap agent." },
  { id: 4, action: "approve", note: "Official GitHub MCP verified alive today (api.githubcopilot.com/mcp 401=auth-gated)." },
  { id: 5, action: "approve", note: "Both Stripe MCP modes verified: npm @stripe/mcp registry 200, mcp.stripe.com POST 401=alive." },
  { id: 6, action: "reject", note: "Pipe-separated multi-endpoint string is not a valid mcp_endpoint format. Endpoint already set to https://api.githubcopilot.com/mcp/ (verified) by the 2026-07-06 sweep." },
  { id: 7, action: "approve", note: "mcp.atlassian.com/v1/sse verified alive today (401=OAuth-gated)." },
  { id: 8, action: "approve", note: "mcp.sentry.dev/mcp verified alive today (401)." },
  { id: 9, action: "approve", note: "mcp.notion.com/mcp verified alive today (401)." },
  { id: 10, action: "approve", note: "npm @supabase/mcp-server-supabase registry-verified official (v0.8.2)." },
  { id: 11, action: "approve", note: "mcp.neon.tech/mcp verified alive today (401)." },
  { id: 12, action: "approve", note: "mcp.datadoghq.com MCP endpoint verified alive today (401)." },
  { id: 13, action: "approve", note: "docs.mcp.cloudflare.com/mcp verified alive today (200, full initialize handshake)." },
  { id: 14, action: "approve", note: "mcp.asana.com/sse verified alive today (401=OAuth-gated)." },
  { id: 15, action: "approve", note: "mcp.linear.app/mcp verified alive today (401). /sse is retired (404)." },
  { id: 16, action: "approve", note: "mcp.hubspot.com verified alive today (401)." },
  { id: 17, action: "approve", note: "Salesforce Hosted MCP Servers GA confirmed via developer.salesforce.com blog (2026-04)." },
];

const db = getDb();
for (const d of DECISIONS) {
  const res = reviewUpdate(db, {
    proposal_id: d.id,
    action: d.action,
    reviewer: REVIEWER,
    note: d.note,
  });
  console.log(`#${d.id} ${d.action}:`, res.status ?? res.error, res.message ? "— " + String(res.message).slice(0, 80) : "");
}
