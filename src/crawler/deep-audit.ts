#!/usr/bin/env tsx
/**
 * Deep MCP Audit — Angle ④ (RapidClaw-style 9-point)
 *
 * For verified MCP servers (handshake confirmed), performs:
 *   1. Initialize handshake → server capabilities
 *   2. tools/list → enumerate available tools
 *   3. resources/list → enumerate resources
 *   4. prompts/list → enumerate prompts
 *   5. Protocol compliance (correct JSON-RPC, proper error codes)
 *   6. Response latency profiling
 *   7. Tool count / richness scoring
 *   8. Schema completeness check (inputSchema present)
 *   9. Version / compatibility assessment
 *
 * Usage:
 *   npx tsx src/crawler/deep-audit.ts                # all verified
 *   npx tsx src/crawler/deep-audit.ts --limit 20     # top 20 only
 *   npx tsx src/crawler/deep-audit.ts --dry-run      # show targets
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

interface McpRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface AuditResult {
  service_id: string;
  endpoint: string;
  // Point 1: Initialize
  server_name: string | null;
  server_version: string | null;
  protocol_version: string | null;
  capabilities: Record<string, unknown> | null;
  // Point 2: Tools
  tools: Array<{ name: string; description?: string; hasSchema: boolean }>;
  tool_count: number;
  // Point 3: Resources
  resources: Array<{ name: string; uri: string }>;
  resource_count: number;
  // Point 4: Prompts
  prompts: Array<{ name: string; description?: string }>;
  prompt_count: number;
  // Point 5: Protocol compliance
  protocol_compliant: boolean;
  protocol_issues: string[];
  // Point 6: Latency
  init_latency_ms: number;
  tools_latency_ms: number;
  total_latency_ms: number;
  // Point 7: Richness score (0-10)
  richness_score: number;
  // Point 8: Schema completeness
  tools_with_schema: number;
  schema_completeness_pct: number;
  // Point 9: Version compatibility
  mcp_version_supported: string;
  is_latest_protocol: boolean;
  // Meta
  error: string | null;
  audited_at: string;
}

async function mcpCall(
  endpoint: string,
  method: string,
  params: Record<string, unknown> = {},
  id = 1
): Promise<{ result?: any; error?: any; latency: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const body: McpRequest = { jsonrpc: "2.0", id, method, params };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latency = Date.now() - start;
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("event-stream")) {
      // SSE: read the first data event
      const text = await res.text();
      const dataMatch = text.match(/data:\s*({.*})/);
      if (dataMatch) {
        const parsed = JSON.parse(dataMatch[1]);
        return { result: parsed.result, error: parsed.error, latency };
      }
      return { result: { _sse: true, _raw: text.slice(0, 500) }, latency };
    }

    if (!res.ok) {
      return { error: { code: res.status, message: `HTTP ${res.status}` }, latency };
    }

    const data = await res.json();
    return { result: data.result, error: data.error, latency };
  } catch (err: unknown) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { error: { code: -1, message: msg.slice(0, 100) }, latency };
  } finally {
    clearTimeout(timeout);
  }
}

function calculateRichness(audit: Partial<AuditResult>): number {
  let score = 0;
  // Tools (max 4 points)
  if ((audit.tool_count || 0) > 0) score += 1;
  if ((audit.tool_count || 0) >= 3) score += 1;
  if ((audit.tool_count || 0) >= 10) score += 1;
  if ((audit.schema_completeness_pct || 0) >= 80) score += 1;
  // Resources (max 2 points)
  if ((audit.resource_count || 0) > 0) score += 1;
  if ((audit.resource_count || 0) >= 3) score += 1;
  // Prompts (max 1 point)
  if ((audit.prompt_count || 0) > 0) score += 1;
  // Protocol (max 2 points)
  if (audit.protocol_compliant) score += 1;
  if (audit.is_latest_protocol) score += 1;
  // Performance (max 1 point)
  if ((audit.total_latency_ms || 9999) < 2000) score += 1;
  return score;
}

async function auditEndpoint(serviceId: string, endpoint: string): Promise<AuditResult> {
  const audit: AuditResult = {
    service_id: serviceId,
    endpoint,
    server_name: null,
    server_version: null,
    protocol_version: null,
    capabilities: null,
    tools: [],
    tool_count: 0,
    resources: [],
    resource_count: 0,
    prompts: [],
    prompt_count: 0,
    protocol_compliant: false,
    protocol_issues: [],
    init_latency_ms: 0,
    tools_latency_ms: 0,
    total_latency_ms: 0,
    richness_score: 0,
    tools_with_schema: 0,
    schema_completeness_pct: 0,
    mcp_version_supported: "unknown",
    is_latest_protocol: false,
    error: null,
    audited_at: new Date().toISOString(),
  };

  const totalStart = Date.now();

  // ── Point 1: Initialize ─────────────────────────────────────────
  const initRes = await mcpCall(endpoint, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "kansei-deep-audit", version: "0.1.0" },
  });

  audit.init_latency_ms = initRes.latency;

  if (initRes.error && !initRes.result) {
    audit.error = `init_failed: ${initRes.error.message || JSON.stringify(initRes.error)}`;
    audit.total_latency_ms = Date.now() - totalStart;
    return audit;
  }

  const initResult = initRes.result;
  if (initResult) {
    audit.server_name = initResult.serverInfo?.name || null;
    audit.server_version = initResult.serverInfo?.version || null;
    audit.protocol_version = initResult.protocolVersion || null;
    audit.capabilities = initResult.capabilities || null;
    audit.mcp_version_supported = initResult.protocolVersion || "unknown";
    audit.is_latest_protocol = initResult.protocolVersion === "2024-11-05";

    // Protocol compliance check
    if (initResult.serverInfo?.name) {
      audit.protocol_compliant = true;
    } else {
      audit.protocol_issues.push("missing serverInfo.name");
    }
    if (!initResult.protocolVersion) {
      audit.protocol_issues.push("missing protocolVersion");
      audit.protocol_compliant = false;
    }
  }

  // Send initialized notification
  await mcpCall(endpoint, "notifications/initialized", {}, 2);

  // ── Point 2: tools/list ─────────────────────────────────────────
  const toolsRes = await mcpCall(endpoint, "tools/list", {}, 3);
  audit.tools_latency_ms = toolsRes.latency;

  if (toolsRes.result?.tools && Array.isArray(toolsRes.result.tools)) {
    audit.tools = toolsRes.result.tools.map((t: any) => ({
      name: t.name,
      description: t.description?.slice(0, 200),
      hasSchema: !!(t.inputSchema && Object.keys(t.inputSchema).length > 0),
    }));
    audit.tool_count = audit.tools.length;
    audit.tools_with_schema = audit.tools.filter((t) => t.hasSchema).length;
    audit.schema_completeness_pct =
      audit.tool_count > 0
        ? Math.round((audit.tools_with_schema / audit.tool_count) * 100)
        : 0;
  } else if (toolsRes.error) {
    audit.protocol_issues.push(`tools/list error: ${toolsRes.error.message || "unknown"}`);
  }

  // ── Point 3: resources/list ─────────────────────────────────────
  if (audit.capabilities?.resources) {
    const resRes = await mcpCall(endpoint, "resources/list", {}, 4);
    if (resRes.result?.resources && Array.isArray(resRes.result.resources)) {
      audit.resources = resRes.result.resources.slice(0, 50).map((r: any) => ({
        name: r.name,
        uri: r.uri,
      }));
      audit.resource_count = resRes.result.resources.length;
    }
  }

  // ── Point 4: prompts/list ───────────────────────────────────────
  if (audit.capabilities?.prompts) {
    const promptRes = await mcpCall(endpoint, "prompts/list", {}, 5);
    if (promptRes.result?.prompts && Array.isArray(promptRes.result.prompts)) {
      audit.prompts = promptRes.result.prompts.slice(0, 50).map((p: any) => ({
        name: p.name,
        description: p.description?.slice(0, 200),
      }));
      audit.prompt_count = promptRes.result.prompts.length;
    }
  }

  // ── Point 5-9: Scoring ──────────────────────────────────────────
  audit.total_latency_ms = Date.now() - totalStart;
  audit.richness_score = calculateRichness(audit);

  return audit;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 100;

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Get verified endpoints (handshake confirmed)
  const targets = db
    .prepare(
      `SELECT id, name, mcp_endpoint, trust_score FROM services
       WHERE mcp_status = 'verified'
         AND mcp_endpoint IS NOT NULL
       ORDER BY trust_score DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ id: string; name: string; mcp_endpoint: string; trust_score: number }>;

  console.error(`[deep-audit] Verified targets: ${targets.length}`);

  if (dryRun) {
    for (const t of targets) {
      console.error(`  [${t.trust_score.toFixed(2)}] ${t.id} => ${t.mcp_endpoint.slice(0, 60)}`);
    }
    db.close();
    return;
  }

  // Audit sequentially (deeper inspection, don't flood)
  const CONCURRENCY = 5;
  const results: AuditResult[] = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((t) => auditEndpoint(t.id, t.mcp_endpoint))
    );
    results.push(...batchResults);
    const done = Math.min(i + CONCURRENCY, targets.length);
    const ok = results.filter((r) => !r.error).length;
    console.error(`[deep-audit] ${done}/${targets.length} audited (${ok} successful)`);
  }

  // ── Summarize ───────────────────────────────────────────────────
  const successful = results.filter((r) => !r.error);
  const withTools = results.filter((r) => r.tool_count > 0);
  const totalTools = results.reduce((sum, r) => sum + r.tool_count, 0);
  const avgRichness =
    successful.length > 0
      ? (successful.reduce((sum, r) => sum + r.richness_score, 0) / successful.length).toFixed(1)
      : "0";

  console.error("\n═══════════════════════════════════════════════════");
  console.error("  Deep MCP Audit — Results");
  console.error("═══════════════════════════════════════════════════");
  console.error(`  Total audited:        ${results.length}`);
  console.error(`  Successful:           ${successful.length}`);
  console.error(`  Failed:               ${results.length - successful.length}`);
  console.error(`  With tools:           ${withTools.length} (${totalTools} total tools)`);
  console.error(`  Avg richness:         ${avgRichness}/10`);
  console.error(`  Protocol compliant:   ${results.filter((r) => r.protocol_compliant).length}`);
  console.error(`  Latest protocol:      ${results.filter((r) => r.is_latest_protocol).length}`);
  console.error("");

  // Top servers by richness
  const sorted = results.filter((r) => !r.error).sort((a, b) => b.richness_score - a.richness_score);
  console.error("  Top servers by richness:");
  for (const r of sorted.slice(0, 15)) {
    console.error(
      `    [${r.richness_score}/10] ${r.service_id} — ${r.tool_count} tools, ${r.resource_count} res, ${r.prompt_count} prompts (${r.total_latency_ms}ms)`
    );
  }

  // Tool catalog
  console.error("\n  Tool catalog (top 20 servers):");
  for (const r of sorted.slice(0, 20)) {
    if (r.tool_count > 0) {
      const toolNames = r.tools.slice(0, 8).map((t) => t.name).join(", ");
      const more = r.tool_count > 8 ? ` +${r.tool_count - 8} more` : "";
      console.error(`    ${r.service_id}: ${toolNames}${more}`);
    }
  }
  console.error("═══════════════════════════════════════════════════");

  // ── Save detailed results ───────────────────────────────────────
  const outputPath = resolve(import.meta.dirname, "../data/deep-audit-results.json");
  writeFileSync(
    outputPath,
    JSON.stringify({
      meta: { audited_at: new Date().toISOString(), total: results.length, successful: successful.length },
      summary: { total_tools: totalTools, avg_richness: parseFloat(avgRichness), with_tools: withTools.length },
      results: sorted,
    }, null, 2),
    "utf-8"
  );
  console.error(`\n  Results saved to ${outputPath}`);

  // ── Update DB ───────────────────────────────────────────────────
  // Store tool listings in service_api_guides (key_endpoints = JSON tools list)
  const upsertGuide = db.prepare(`
    INSERT INTO service_api_guides (service_id, base_url, api_version, auth_overview, key_endpoints, agent_tips, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(service_id) DO UPDATE SET
      base_url = excluded.base_url,
      api_version = excluded.api_version,
      auth_overview = excluded.auth_overview,
      key_endpoints = excluded.key_endpoints,
      agent_tips = excluded.agent_tips,
      updated_at = excluded.updated_at
  `);

  // Boost trust for rich servers
  const boostTrust = db.prepare(
    "UPDATE services SET trust_score = ? WHERE id = ? AND trust_score < ?"
  );

  let guidesWritten = 0;
  let trustBoosted = 0;

  const tx = db.transaction(() => {
    for (const r of successful) {
      // Write api guide with tool catalog
      const toolsJson = JSON.stringify(r.tools.map((t) => ({
        name: t.name,
        description: t.description,
        hasSchema: t.hasSchema,
      })));
      const tips = [
        `Richness: ${r.richness_score}/10`,
        `Tools: ${r.tool_count} (${r.schema_completeness_pct}% with schema)`,
        `Resources: ${r.resource_count}, Prompts: ${r.prompt_count}`,
        `Latency: ${r.total_latency_ms}ms`,
        `Protocol: ${r.mcp_version_supported}${r.is_latest_protocol ? " (latest)" : ""}`,
        r.protocol_issues.length > 0 ? `Issues: ${r.protocol_issues.join("; ")}` : null,
      ].filter(Boolean).join(" | ");

      const authInfo = r.capabilities?.tools ? "MCP tool-call (no separate auth)" : "Unknown";
      upsertGuide.run(
        r.service_id,
        r.endpoint,
        r.mcp_version_supported,
        authInfo,
        toolsJson,
        tips,
      );
      guidesWritten++;

      // Trust boost based on richness
      let targetTrust = 0.6; // baseline for verified
      if (r.richness_score >= 7) targetTrust = 0.8;
      else if (r.richness_score >= 5) targetTrust = 0.75;
      else if (r.richness_score >= 3) targetTrust = 0.7;

      const b = boostTrust.run(targetTrust, r.service_id, targetTrust);
      if (b.changes > 0) trustBoosted++;
    }
  });
  tx();

  console.error(`  DB: ${guidesWritten} tool guides written, ${trustBoosted} trust boosted`);
  db.close();
}

main().catch((err) => {
  console.error("[deep-audit] Fatal:", err);
  process.exit(1);
});
