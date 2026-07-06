#!/usr/bin/env tsx
/**
 * MCP Endpoint Health Probe — Angle ③ (lightweight)
 *
 * Sends HTTP requests to hosted MCP endpoints to check:
 *   1. Is the endpoint reachable? (HTTP status)
 *   2. Does it respond to MCP handshake? (JSON-RPC initialize)
 *
 * Usage:
 *   npx tsx src/crawler/health-probe.ts                # top 50 by trust
 *   npx tsx src/crawler/health-probe.ts --limit 200    # top 200
 *   npx tsx src/crawler/health-probe.ts --dry-run      # show targets only
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

export interface ProbeSummary {
  probed: number;
  alive: number;
  handshake: number;
  auth_required: number;
  dead: number;
  archived_new: number;
}

interface ProbeResult {
  service_id: string;
  endpoint: string;
  http_status: number | null;
  http_ok: boolean;
  mcp_handshake: boolean;
  mcp_server_info: string | null;
  response_time_ms: number;
  error: string | null;
}

async function probeEndpoint(serviceId: string, endpoint: string): Promise<ProbeResult> {
  const result: ProbeResult = {
    service_id: serviceId,
    endpoint,
    http_status: null,
    http_ok: false,
    mcp_handshake: false,
    mcp_server_info: null,
    response_time_ms: 0,
    error: null,
  };

  // Skip endpoints with placeholders
  if (endpoint.includes("{") || endpoint.includes("}")) {
    result.error = "template_url";
    return result;
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // Step 1: HTTP HEAD/GET to check reachability
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "kansei-link-probe", version: "0.1.0" },
        },
      }),
      signal: controller.signal,
    });

    result.http_status = res.status;
    result.response_time_ms = Date.now() - start;

    if (res.ok || res.status === 401 || res.status === 403) {
      // 401/403 means endpoint exists but needs auth
      result.http_ok = true;

      if (res.ok) {
        try {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("json")) {
            const body = await res.json();
            if (body.result?.serverInfo) {
              result.mcp_handshake = true;
              result.mcp_server_info = JSON.stringify(body.result.serverInfo);
            } else if (body.error) {
              // Got a JSON-RPC error — still means the server is speaking MCP
              result.mcp_handshake = true;
              result.mcp_server_info = `error: ${body.error.message || body.error.code}`;
            }
          } else if (contentType.includes("event-stream")) {
            // SSE response — server is alive
            result.mcp_handshake = true;
            result.mcp_server_info = "SSE stream";
          }
        } catch {
          // Response body parsing failed — endpoint exists but not MCP
        }
      }
    }
  } catch (err: unknown) {
    result.response_time_ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      result.error = "timeout";
    } else if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
      result.error = "dns_fail";
    } else if (msg.includes("ECONNREFUSED")) {
      result.error = "connection_refused";
    } else if (msg.includes("certificate") || msg.includes("SSL")) {
      result.error = "ssl_error";
    } else {
      result.error = msg.slice(0, 100);
    }
  } finally {
    clearTimeout(timeout);
  }

  return result;
}

export async function runHealthProbe(
  db: Database.Database,
  opts: { limit?: number; dryRun?: boolean } = {}
): Promise<ProbeSummary> {
  const limit = opts.limit ?? 50;
  const dryRun = opts.dryRun ?? false;

  // Get hosted endpoints to probe (highest trust first).
  // Archived rows are excluded — endpoint death is already recorded there;
  // resurrection checks are a manual re-sweep concern, not the weekly probe's.
  const targets = db
    .prepare(
      `SELECT id, name, mcp_endpoint, trust_score FROM services
       WHERE mcp_endpoint LIKE 'http%'
         AND mcp_endpoint NOT LIKE '%github.com%'
         AND mcp_endpoint NOT LIKE '%github.io%'
         AND mcp_endpoint NOT LIKE '%{%'
         AND COALESCE(archived, 0) = 0
       ORDER BY trust_score DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ id: string; name: string; mcp_endpoint: string; trust_score: number }>;

  console.error(`[health-probe] Targets: ${targets.length} endpoints`);

  if (dryRun) {
    targets.forEach((t) =>
      console.error(`  [${t.trust_score.toFixed(2)}] ${t.id} => ${t.mcp_endpoint.slice(0, 60)}`)
    );
    return { probed: 0, alive: 0, handshake: 0, auth_required: 0, dead: 0, archived_new: 0 };
  }

  // Probe concurrently (max 20 at a time)
  const CONCURRENCY = 20;
  const results: ProbeResult[] = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((t) => probeEndpoint(t.id, t.mcp_endpoint))
    );
    results.push(...batchResults);

    const done = Math.min(i + CONCURRENCY, targets.length);
    const alive = results.filter((r) => r.http_ok).length;
    console.error(`[health-probe] ${done}/${targets.length} probed (${alive} alive)`);
  }

  // ── Summarize ───────────────────────────────────────────────────
  const alive = results.filter((r) => r.http_ok);
  const handshake = results.filter((r) => r.mcp_handshake);
  const dead = results.filter((r) => !r.http_ok && !r.error?.includes("template"));
  const authRequired = results.filter((r) => r.http_status === 401 || r.http_status === 403);

  console.error("\n═══════════════════════════════════════");
  console.error("  MCP Health Probe — Results");
  console.error("═══════════════════════════════════════");
  console.error(`  Total probed:       ${results.length}`);
  console.error(`  HTTP reachable:     ${alive.length} (${((alive.length / results.length) * 100).toFixed(0)}%)`);
  console.error(`  MCP handshake OK:   ${handshake.length}`);
  console.error(`  Auth required:      ${authRequired.length}`);
  console.error(`  Dead/unreachable:   ${dead.length}`);
  console.error("");

  // Error breakdown
  const errors: Record<string, number> = {};
  for (const r of results) {
    if (r.error) errors[r.error] = (errors[r.error] || 0) + 1;
  }
  if (Object.keys(errors).length > 0) {
    console.error("  Errors:");
    for (const [err, count] of Object.entries(errors).sort((a, b) => b[1] - a[1])) {
      console.error(`    ${err}: ${count}`);
    }
  }

  // ── Show MCP handshake successes ────────────────────────────────
  if (handshake.length > 0) {
    console.error("\n  MCP handshake confirmed:");
    for (const r of handshake) {
      console.error(
        `    ${r.service_id} (${r.response_time_ms}ms) ${r.mcp_server_info?.slice(0, 80) || ""}`
      );
    }
  }

  // ── Update DB ───────────────────────────────────────────────────
  const updateMcpStatus = db.prepare(
    "UPDATE services SET mcp_status = ? WHERE id = ?"
  );
  const insertOutcome = db.prepare(
    `INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, context_masked, created_at)
     VALUES (?, 'health-probe', ?, ?, ?, ?, datetime('now'))`
  );

  const updateTrust = db.prepare(
    "UPDATE services SET trust_score = MAX(trust_score, ?) WHERE id = ? AND trust_score < ?"
  );
  const downgradeTrust = db.prepare(
    "UPDATE services SET trust_score = MIN(trust_score, ?) WHERE id = ?"
  );

  // POST 404/410 on the registered endpoint = endpoint gone. Same archive
  // semantics as the 2026-07-06 full sweep: hide from rankings, keep the row,
  // record before-values in the changelog so it's reversible.
  const getBeforeValues = db.prepare(
    "SELECT trust_score, axr_score, axr_grade FROM services WHERE id = ?"
  );
  const archiveService = db.prepare(
    `UPDATE services
     SET archived = 1, trust_score = 0.0, axr_score = NULL, axr_grade = NULL
     WHERE id = ?`
  );
  const insertDeprecation = db.prepare(
    `INSERT INTO service_changelog (service_id, change_date, change_type, summary, details)
     VALUES (?, date('now'), 'deprecated', ?, ?)`
  );

  let statusUpdated = 0;
  let trustBoosted = 0;
  let trustDowngraded = 0;
  let archivedNew = 0;
  const tx = db.transaction(() => {
    for (const r of results) {
      // Update mcp_status
      if (r.mcp_handshake) {
        updateMcpStatus.run("verified", r.service_id);
        statusUpdated++;
        // Verified via handshake → boost to 0.6
        const b = updateTrust.run(0.6, r.service_id, 0.6);
        if (b.changes > 0) trustBoosted++;
      } else if (r.http_ok) {
        updateMcpStatus.run("official", r.service_id);
        statusUpdated++;
        // Reachable (may need auth) → boost to 0.45
        const b = updateTrust.run(0.45, r.service_id, 0.45);
        if (b.changes > 0) trustBoosted++;
      } else if (r.http_status === 404 || r.http_status === 410) {
        const before = getBeforeValues.get(r.service_id) as
          | { trust_score: number; axr_score: number | null; axr_grade: string | null }
          | undefined;
        archiveService.run(r.service_id);
        insertDeprecation.run(
          r.service_id,
          `Endpoint gone (POST initialize ${r.http_status}) — archived by weekly health probe`,
          JSON.stringify({ endpoint: r.endpoint, http_status: r.http_status, before })
        );
        archivedNew++;
        statusUpdated++;
      } else if (r.error === "dns_fail" || r.error === "connection_refused") {
        updateMcpStatus.run("dead", r.service_id);
        statusUpdated++;
        // Dead endpoint → downgrade to 0.1
        const d = downgradeTrust.run(0.1, r.service_id);
        if (d.changes > 0) trustDowngraded++;
      }

      // Record as outcome (confirmed data!)
      const errorType = r.mcp_handshake ? null
        : r.http_status === 401 || r.http_status === 403 ? "auth"
        : r.error === "timeout" ? "connection"
        : r.error === "dns_fail" ? "connection"
        : r.error ? "config"
        : "other";

      insertOutcome.run(
        r.service_id,
        r.http_ok ? 1 : 0,
        r.response_time_ms || null,
        errorType,
        `[health-probe] HTTP ${r.http_status || "N/A"} | ${r.error || "OK"} | ${r.mcp_server_info?.slice(0, 100) || "no-handshake"}`,
      );
    }
  });
  tx();

  console.error(`\n  DB updated: ${statusUpdated} mcp_status changes, ${trustBoosted} trust boosted, ${trustDowngraded} trust downgraded, ${archivedNew} archived (endpoint gone)`);
  console.error("═══════════════════════════════════════");

  return {
    probed: results.length,
    alive: alive.length,
    handshake: handshake.length,
    auth_required: authRequired.length,
    dead: dead.length,
    archived_new: archivedNew,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 50;

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  try {
    await runHealthProbe(db, { limit, dryRun });
  } finally {
    db.close();
  }
}

// Only run the CLI when executed directly (this module is also imported
// by the daily crawler's weekly probe stage).
const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error("[health-probe] Fatal:", err);
    process.exit(1);
  });
}
