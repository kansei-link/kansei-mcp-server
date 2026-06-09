#!/usr/bin/env tsx
/**
 * Sync MCP Registry → KanseiLINK DB (Angle ①)
 *
 * Fetches all servers from the official MCP Registry and:
 *  1. Adds NEW services not yet in KanseiLINK
 *  2. Enriches EXISTING services with endpoint URLs, repo URLs, version info
 *  3. Outputs a report of changes
 *
 * Usage:
 *   npx tsx src/crawler/sync-registry.ts                     # full sync
 *   npx tsx src/crawler/sync-registry.ts --dry-run            # preview only
 *   npx tsx src/crawler/sync-registry.ts --max 500            # limit to 500
 *   npx tsx src/crawler/sync-registry.ts --output registry.json  # save raw data
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  crawlMcpRegistry,
  registryNameToServiceId,
  inferMcpStatus,
  inferCategory,
  summarizeRegistry,
  type RegistryServer,
} from "./sources/mcp-registry.js";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const maxIdx = args.indexOf("--max");
  const maxResults = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : 10000;
  const outIdx = args.indexOf("--output");
  const outputFile = outIdx >= 0 ? args[outIdx + 1] : null;

  console.error(`[sync-registry] Starting MCP Registry sync...`);
  console.error(`[sync-registry] Max: ${maxResults}, Dry run: ${dryRun}`);
  console.error("");

  // ── 1. Fetch from registry ──────────────────────────────────────
  const servers = await crawlMcpRegistry({
    maxResults,
    latestOnly: true,
    onProgress: (fetched, cursor) => {
      if (fetched % 500 === 0 || !cursor) {
        console.error(`[sync-registry] Fetched ${fetched} servers...`);
      }
    },
  });

  const stats = summarizeRegistry(servers);
  console.error(`\n[sync-registry] Registry scan complete:`);
  console.error(`  Total unique servers: ${stats.total}`);
  console.error(`  Active: ${stats.active}, Inactive: ${stats.inactive}`);
  console.error(`  With remote endpoint: ${stats.withRemote}`);
  console.error(`  With repo URL: ${stats.withRepo}`);
  console.error(`  Transport types: ${JSON.stringify(stats.transportTypes)}`);

  // ── Save raw data if requested ──────────────────────────────────
  if (outputFile) {
    writeFileSync(
      outputFile,
      JSON.stringify({ meta: { fetched_at: new Date().toISOString(), count: servers.length }, stats, servers }, null, 2),
      "utf-8"
    );
    console.error(`[sync-registry] Raw data saved to ${outputFile}`);
  }

  // ── 2. Open DB and cross-reference ──────────────────────────────
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const existingServices = new Map<string, { name: string; mcp_endpoint: string | null; api_url: string | null }>();
  const rows = db.prepare("SELECT id, name, mcp_endpoint, api_url FROM services").all() as Array<{
    id: string; name: string; mcp_endpoint: string | null; api_url: string | null;
  }>;
  for (const r of rows) existingServices.set(r.id, { name: r.name, mcp_endpoint: r.mcp_endpoint, api_url: r.api_url });

  console.error(`\n[sync-registry] Existing KanseiLINK services: ${existingServices.size}`);

  // ── 3. Classify each registry server ────────────────────────────
  interface SyncAction {
    server: RegistryServer;
    service_id: string;
    action: "add" | "enrich" | "skip";
    category: string;
    mcp_status: string;
    endpoint: string | null;
    repo: string | null;
    reason?: string;
  }

  const actions: SyncAction[] = [];

  for (const s of servers) {
    const serviceId = registryNameToServiceId(s.name);
    const category = inferCategory(s.description, s.name);
    const mcpStatus = inferMcpStatus(s.remotes, s.repo_url);
    const endpoint = s.remotes.length > 0 ? s.remotes[0].url : s.repo_url;

    if (existingServices.has(serviceId)) {
      const existing = existingServices.get(serviceId)!;
      // Check if we can enrich (add endpoint or repo that's missing)
      const canEnrich =
        (!existing.mcp_endpoint && endpoint) ||
        (!existing.api_url && s.repo_url);

      if (canEnrich) {
        actions.push({
          server: s, service_id: serviceId, action: "enrich",
          category, mcp_status: mcpStatus, endpoint: endpoint || null, repo: s.repo_url,
        });
      } else {
        actions.push({
          server: s, service_id: serviceId, action: "skip",
          category, mcp_status: mcpStatus, endpoint: endpoint || null, repo: s.repo_url,
          reason: "already complete",
        });
      }
    } else {
      // Skip inactive or empty-description servers
      if (s.status === "inactive") {
        actions.push({
          server: s, service_id: serviceId, action: "skip",
          category, mcp_status: mcpStatus, endpoint: endpoint || null, repo: s.repo_url,
          reason: "inactive",
        });
        continue;
      }
      if (!s.description || s.description.length < 10) {
        actions.push({
          server: s, service_id: serviceId, action: "skip",
          category, mcp_status: mcpStatus, endpoint: endpoint || null, repo: s.repo_url,
          reason: "no description",
        });
        continue;
      }

      actions.push({
        server: s, service_id: serviceId, action: "add",
        category, mcp_status: mcpStatus, endpoint: endpoint || null, repo: s.repo_url,
      });
    }
  }

  const toAdd = actions.filter((a) => a.action === "add");
  const toEnrich = actions.filter((a) => a.action === "enrich");
  const toSkip = actions.filter((a) => a.action === "skip");

  console.error(`\n[sync-registry] Sync plan:`);
  console.error(`  New services to ADD:    ${toAdd.length}`);
  console.error(`  Existing to ENRICH:     ${toEnrich.length}`);
  console.error(`  Skipped:                ${toSkip.length}`);

  // Show skip reasons
  const skipReasons: Record<string, number> = {};
  for (const a of toSkip) {
    const reason = a.reason || "unknown";
    skipReasons[reason] = (skipReasons[reason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(skipReasons)) {
    console.error(`    └ ${reason}: ${count}`);
  }

  // Show category breakdown of new adds
  const addByCategory: Record<string, number> = {};
  for (const a of toAdd) {
    addByCategory[a.category] = (addByCategory[a.category] || 0) + 1;
  }
  console.error(`\n  New services by category:`);
  for (const [cat, count] of Object.entries(addByCategory).sort((a, b) => b[1] - a[1])) {
    console.error(`    ${cat}: ${count}`);
  }

  if (dryRun) {
    console.error("\n[sync-registry] DRY RUN — no changes made.");
    console.error("\n  Sample new services (first 10):");
    for (const a of toAdd.slice(0, 10)) {
      console.error(`    ${a.service_id}: ${a.server.description.slice(0, 80)} [${a.category}]`);
    }
    db.close();
    return;
  }

  // ── 4. Execute sync ─────────────────────────────────────────────
  const insertService = db.prepare(`
    INSERT OR IGNORE INTO services
      (id, name, namespace, description, category, tags, mcp_endpoint, mcp_status, api_url, trust_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateEndpoint = db.prepare(`
    UPDATE services SET mcp_endpoint = ? WHERE id = ? AND (mcp_endpoint IS NULL OR mcp_endpoint = '')
  `);

  const updateApiUrl = db.prepare(`
    UPDATE services SET api_url = ? WHERE id = ? AND (api_url IS NULL OR api_url = '')
  `);

  let added = 0;
  let enriched = 0;

  const tx = db.transaction(() => {
    // Add new services
    for (const a of toAdd) {
      const displayName = a.server.title || a.server.name.split("/").pop() || a.server.name;
      const namespace = a.server.name.split("/")[0] || "";
      const tags = JSON.stringify([]);

      const r = insertService.run(
        a.service_id,
        displayName,
        namespace,
        a.server.description.slice(0, 500),
        a.category,
        tags,
        a.endpoint,
        a.mcp_status,
        a.repo || null,
        0.3 // initial trust_score for registry-only data
      );
      if (r.changes > 0) added++;
    }

    // Enrich existing services
    for (const a of toEnrich) {
      let changed = false;
      if (a.endpoint) {
        const r = updateEndpoint.run(a.endpoint, a.service_id);
        if (r.changes > 0) changed = true;
      }
      if (a.repo) {
        const r = updateApiUrl.run(a.repo, a.service_id);
        if (r.changes > 0) changed = true;
      }
      if (changed) enriched++;
    }
  });

  tx();
  db.close();

  console.error("\n═══════════════════════════════════════");
  console.error("  MCP Registry Sync — Results");
  console.error("═══════════════════════════════════════");
  console.error(`  New services added:     ${added}`);
  console.error(`  Existing enriched:      ${enriched}`);
  console.error(`  Total in DB now:        ${existingServices.size + added}`);
  console.error("═══════════════════════════════════════");
}

main().catch((err) => {
  console.error("[sync-registry] Fatal:", err);
  process.exit(1);
});
