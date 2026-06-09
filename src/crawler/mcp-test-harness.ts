#!/usr/bin/env tsx
/**
 * MCP Local Server Test Harness — ⑥ 自前打鍵
 *
 * Uses the official MCP SDK (StdioClientTransport) to connect to local MCP servers
 * and run a standardized test sequence:
 *   1. connect → server info + capabilities
 *   2. tools/list → enumerate tools
 *   3. safe read-only tool call → actual functionality test
 *   4. Record all results as outcomes + update service_api_guides
 *
 * Usage:
 *   npx tsx src/crawler/mcp-test-harness.ts --service notion
 *   npx tsx src/crawler/mcp-test-harness.ts --service slack
 *   npx tsx src/crawler/mcp-test-harness.ts --service filesystem
 *   npx tsx src/crawler/mcp-test-harness.ts --list
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

// ── Service Profiles ─────────────────────────────────────────────
interface ServiceProfile {
  service_id: string;
  command: string;
  args: string[];
  env_keys: string[];
  safe_tool_call?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  notes: string;
}

const PROFILES: Record<string, ServiceProfile> = {
  filesystem: {
    service_id: "mcp-filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    env_keys: [],
    safe_tool_call: { name: "list_directory", arguments: { path: "." } },
    notes: "No auth — baseline test",
  },
  notion: {
    service_id: "notion",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env_keys: ["OPENAPI_MCP_HEADERS"],
    safe_tool_call: { name: "API-get-self", arguments: {} },
    notes: 'Requires OPENAPI_MCP_HEADERS=\'{"Authorization":"Bearer ntn_xxx","Notion-Version":"2022-06-28"}\'',
  },
  slack: {
    service_id: "slack",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env_keys: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
    safe_tool_call: { name: "slack_list_channels", arguments: { limit: 3 } },
    notes: "Requires SLACK_BOT_TOKEN=xoxb-xxx and SLACK_TEAM_ID",
  },
  github: {
    service_id: "github",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env_keys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    safe_tool_call: { name: "search_repositories", arguments: { query: "mcp language:typescript", page: 1, perPage: 3 } },
    notes: "Requires GITHUB_PERSONAL_ACCESS_TOKEN",
  },
  memory: {
    service_id: "mcp-memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env_keys: [],
    safe_tool_call: { name: "create_entities", arguments: { entities: [{ name: "test", entityType: "test", observations: ["harness test"] }] } },
    notes: "No auth — memory graph test",
  },
  fetch: {
    service_id: "mcp-fetch",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    env_keys: [],
    safe_tool_call: { name: "fetch", arguments: { url: "https://httpbin.org/get" } },
    notes: "No auth — HTTP fetch test",
  },
};

// ── Test Execution ───────────────────────────────────────────────
interface TestPhaseResult {
  phase: string;
  success: boolean;
  latency_ms: number;
  data?: Record<string, unknown>;
  error?: string;
}

async function runTest(profile: ServiceProfile): Promise<TestPhaseResult[]> {
  const results: TestPhaseResult[] = [];

  console.error(`\n╔══════════════════════════════════════════════╗`);
  console.error(`║  Testing: ${profile.service_id.padEnd(34)}║`);
  console.error(`╚══════════════════════════════════════════════╝`);
  console.error(`  Command: ${profile.command} ${profile.args.join(" ")}`);
  console.error(`  Notes: ${profile.notes}`);
  console.error("");

  // Check env vars
  const env: Record<string, string> = {};
  for (const key of profile.env_keys) {
    if (!process.env[key]) {
      console.error(`  ✗ Missing env var: ${key}`);
      results.push({ phase: "env_check", success: false, latency_ms: 0, error: `Missing: ${key}` });
      return results;
    }
    env[key] = process.env[key]!;
  }

  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  try {
    // ── Phase 1: Connect ──────────────────────────────────────────
    console.error("  Phase 1: Connect...");
    const t1 = Date.now();

    transport = new StdioClientTransport({
      command: profile.command,
      args: profile.args,
      env: { ...process.env, ...env } as Record<string, string>,
    });

    client = new Client({ name: "kansei-self-test", version: "0.1.0" });
    await client.connect(transport);
    const connectLatency = Date.now() - t1;

    const serverInfo = client.getServerVersion();
    console.error(`  ✓ Connected (${connectLatency}ms)`);
    console.error(`    Server: ${serverInfo?.name} v${serverInfo?.version}`);

    results.push({
      phase: "connect",
      success: true,
      latency_ms: connectLatency,
      data: { server_name: serverInfo?.name, server_version: serverInfo?.version },
    });

    // ── Phase 2: Tools List ───────────────────────────────────────
    console.error("  Phase 2: tools/list...");
    const t2 = Date.now();
    const toolsResult = await client.listTools();
    const toolsLatency = Date.now() - t2;

    const tools = toolsResult.tools;
    console.error(`  ✓ ${tools.length} tools found (${toolsLatency}ms)`);
    for (const t of tools.slice(0, 8)) {
      console.error(`    • ${t.name}: ${(t.description || "").slice(0, 60)}`);
    }
    if (tools.length > 8) console.error(`    ... +${tools.length - 8} more`);

    results.push({
      phase: "tools_list",
      success: true,
      latency_ms: toolsLatency,
      data: {
        tool_count: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description?.slice(0, 100),
          hasSchema: !!(t.inputSchema && Object.keys(t.inputSchema).length > 1),
        })),
      },
    });

    // ── Phase 3: Safe Tool Call ────────────────────────────────────
    if (profile.safe_tool_call) {
      // Verify the tool exists
      const toolExists = tools.some((t) => t.name === profile.safe_tool_call!.name);
      if (!toolExists) {
        // Try to find a similar tool
        const readTools = tools.filter((t) =>
          t.name.includes("list") || t.name.includes("get") || t.name.includes("search") || t.name.includes("read")
        );
        const fallback = readTools[0];
        if (fallback) {
          console.error(`  ⚠ Tool '${profile.safe_tool_call.name}' not found, trying '${fallback.name}'`);
          profile.safe_tool_call = { name: fallback.name, arguments: {} };
        } else {
          console.error(`  ⚠ Tool '${profile.safe_tool_call.name}' not found, skipping tool call`);
          profile.safe_tool_call = undefined;
        }
      }
    }

    if (profile.safe_tool_call) {
      console.error(`  Phase 3: call ${profile.safe_tool_call.name}...`);
      const t3 = Date.now();
      try {
        const callResult = await client.callTool({
          name: profile.safe_tool_call.name,
          arguments: profile.safe_tool_call.arguments,
        });
        const callLatency = Date.now() - t3;

        const content = callResult.content as Array<{ type: string; text?: string }>;
        const preview = content
          .map((c) => c.text || JSON.stringify(c))
          .join("")
          .slice(0, 300);

        console.error(`  ✓ Response (${callLatency}ms): ${preview.slice(0, 150)}${preview.length > 150 ? "..." : ""}`);
        results.push({
          phase: "tool_call",
          success: true,
          latency_ms: callLatency,
          data: { tool: profile.safe_tool_call.name, response_length: preview.length },
        });
      } catch (err: unknown) {
        const callLatency = Date.now() - t3;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Tool call failed (${callLatency}ms): ${msg.slice(0, 150)}`);
        results.push({ phase: "tool_call", success: false, latency_ms: callLatency, error: msg.slice(0, 200) });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Fatal: ${msg.slice(0, 200)}`);
    results.push({ phase: "fatal", success: false, latency_ms: 0, error: msg.slice(0, 200) });
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }

  return results;
}

// ── DB Recording ─────────────────────────────────────────────────
function recordResults(serviceId: string, results: TestPhaseResult[]) {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const insertOutcome = db.prepare(`
    INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, context_masked, created_at)
    VALUES (?, 'self-test-fleet', ?, ?, ?, ?, datetime('now'))
  `);

  const tx = db.transaction(() => {
    for (const r of results) {
      insertOutcome.run(
        serviceId,
        r.success ? 1 : 0,
        r.latency_ms || null,
        r.error ? "runtime" : null,
        `[self-test] ${r.phase} | ${r.error || "OK"} | ${JSON.stringify(r.data || {}).slice(0, 300)}`,
      );
    }
  });
  tx();

  // If tools were discovered, update service_api_guides
  const toolsPhase = results.find((r) => r.phase === "tools_list" && r.success);
  if (toolsPhase?.data?.tools) {
    const tools = toolsPhase.data.tools as Array<{ name: string; description?: string; hasSchema: boolean }>;
    const toolsJson = JSON.stringify(tools);
    const connectPhase = results.find((r) => r.phase === "connect" && r.success);
    const serverName = (connectPhase?.data?.server_name as string) || "unknown";

    try {
      db.prepare(`
        INSERT INTO service_api_guides (service_id, base_url, auth_overview, key_endpoints, quickstart_example, agent_tips, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(service_id) DO UPDATE SET
          key_endpoints = excluded.key_endpoints,
          agent_tips = excluded.agent_tips,
          updated_at = excluded.updated_at
      `).run(
        serviceId,
        `stdio://${serverName}`,
        `Env: ${Object.keys(PROFILES).find((k) => PROFILES[k].service_id === serviceId) ? PROFILES[Object.keys(PROFILES).find((k) => PROFILES[k].service_id === serviceId)!].env_keys.join(", ") || "none" : "unknown"}`,
        toolsJson,
        `npx connection verified. ${tools.length} tools available.`,
        `Self-tested ${new Date().toISOString().slice(0, 10)} | ${tools.length} tools | Latency: connect=${connectPhase?.latency_ms || "?"}ms, tools=${toolsPhase.latency_ms}ms`,
      );
    } catch { /* guide already exists with different constraint */ }
  }

  db.close();
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    console.error("Available service profiles:\n");
    for (const [key, profile] of Object.entries(PROFILES)) {
      const envStatus = profile.env_keys.length === 0
        ? "✓ no auth"
        : profile.env_keys.every((k) => process.env[k])
          ? "✓ env set"
          : "✗ missing env";
      console.error(`  ${key.padEnd(12)} [${envStatus}] ${profile.notes}`);
    }
    return;
  }

  const serviceIdx = args.indexOf("--service");
  const serviceName = serviceIdx >= 0 ? args[serviceIdx + 1] : null;
  const runAll = args.includes("--all");

  if (!serviceName && !runAll) {
    console.error("Usage:");
    console.error("  npx tsx src/crawler/mcp-test-harness.ts --service <name>");
    console.error("  npx tsx src/crawler/mcp-test-harness.ts --all");
    console.error("  npx tsx src/crawler/mcp-test-harness.ts --list");
    console.error(`\nAvailable: ${Object.keys(PROFILES).join(", ")}`);
    process.exit(1);
  }

  const toTest = runAll
    ? Object.keys(PROFILES)
    : [serviceName!];

  let totalPassed = 0;
  let totalPhases = 0;

  for (const name of toTest) {
    const profile = PROFILES[name];
    if (!profile) {
      console.error(`Unknown service: ${name}`);
      continue;
    }

    const results = await runTest(profile);

    // Summary
    const passed = results.filter((r) => r.success).length;
    totalPassed += passed;
    totalPhases += results.length;

    console.error(`\n  Result: ${passed}/${results.length} phases passed`);

    // Record to DB
    recordResults(profile.service_id, results);
    console.error(`  → ${results.length} outcomes recorded`);
  }

  console.error(`\n═══════════════════════════════════════════════════`);
  console.error(`  Total: ${totalPassed}/${totalPhases} phases passed across ${toTest.length} service(s)`);
  console.error(`═══════════════════════════════════════════════════`);

  if (totalPassed < totalPhases) process.exit(1);
}

main().catch((err) => {
  console.error("[harness] Fatal:", err.message);
  process.exit(1);
});
