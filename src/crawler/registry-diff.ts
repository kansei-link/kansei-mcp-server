#!/usr/bin/env tsx
/**
 * KanseiLINK Registry Diff Detector
 *
 * Compares current DB state against the MCP registry API and surfaces:
 *   - NEW servers not yet in our DB
 *   - REMOVED servers (in DB but no longer in registry)
 *   - UPDATED servers (endpoint changed)
 *
 * Reuses the existing crawlMcpRegistry() for correct paginated API access.
 *
 * Usage:
 *   npx tsx src/crawler/registry-diff.ts               # scan + report
 *   npx tsx src/crawler/registry-diff.ts --ingest      # auto-queue new entries
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { crawlMcpRegistry, registryNameToServiceId, type RegistryServer } from "./sources/mcp-registry.js";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

interface DiffResult {
  new_servers: Array<{ id: string; name?: string; description?: string; endpoint?: string }>;
  removed_from_registry: string[];
  endpoint_changed: Array<{ id: string; old_endpoint: string; new_endpoint: string }>;
}

async function main() {
  const args = process.argv.slice(2);
  const autoIngest = args.includes("--ingest");

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Get all service IDs + endpoints currently in DB
  const dbServices = db.prepare(
    "SELECT id, mcp_endpoint FROM services"
  ).all() as Array<{ id: string; mcp_endpoint: string | null }>;

  const dbIds = new Set(dbServices.map((s) => s.id));
  const dbEndpoints = new Map(dbServices.map((s) => [s.id, s.mcp_endpoint]));

  console.error(`[registry-diff] DB has ${dbIds.size} services`);

  // Fetch full registry using existing crawler
  const registryEntries = await crawlMcpRegistry({
    maxResults: 15000,
    latestOnly: true,
    onProgress: (fetched, _cursor) => {
      if (fetched % 500 === 0) console.error(`  ... fetched ${fetched}`);
    },
  });

  console.error(`[registry-diff] Registry returned ${registryEntries.length} servers`);

  // ── Diff ────────────────────────────────────────────────────────
  const diff: DiffResult = { new_servers: [], removed_from_registry: [], endpoint_changed: [] };
  const registryIds = new Set<string>();

  for (const entry of registryEntries) {
    const rawName = entry.name;  // e.g. "ac.inference.sh/mcp"
    const id = registryNameToServiceId(rawName);  // → "ac-inference-sh-mcp"
    registryIds.add(id);

    const primaryEndpoint = entry.remotes?.[0]?.url || null;

    if (!dbIds.has(id)) {
      diff.new_servers.push({
        id,
        name: entry.title || rawName,
        description: entry.description?.slice(0, 200),
        endpoint: primaryEndpoint || undefined,
      });
    } else if (primaryEndpoint) {
      const oldEndpoint = dbEndpoints.get(id);
      if (oldEndpoint && primaryEndpoint !== oldEndpoint) {
        diff.endpoint_changed.push({ id, old_endpoint: oldEndpoint, new_endpoint: primaryEndpoint });
      }
    }
  }

  // Check for DB services that are no longer in registry
  // (only registry-sourced services — don't flag manually-added ones)
  const registrySourceCount = db.prepare(
    "SELECT count(*) as n FROM services WHERE namespace LIKE '%registry%' OR namespace LIKE '%mcp%'"
  ).get() as { n: number };

  // If registry sourced > 1000, do removal check (avoid false positives on small sync)
  if (registrySourceCount.n > 1000) {
    for (const s of dbServices) {
      if (!registryIds.has(s.id) && s.id.includes("/")) {
        // Only flag qualified-name style IDs (likely from registry)
        diff.removed_from_registry.push(s.id);
      }
    }
  }

  // ── Report ─────────────────────────────────────────────────────
  console.error("\n═══════════════════════════════════════════════════");
  console.error("  KanseiLINK Registry Diff");
  console.error("═══════════════════════════════════════════════════");
  console.error(`  Registry total:     ${registryIds.size}`);
  console.error(`  DB total:           ${dbIds.size}`);
  console.error(`  ➕ New servers:      ${diff.new_servers.length}`);
  console.error(`  ➖ Removed:          ${diff.removed_from_registry.length}`);
  console.error(`  🔄 Endpoint changed: ${diff.endpoint_changed.length}`);

  if (diff.new_servers.length > 0) {
    console.error(`\n  ➕ NEW (showing first 20):`);
    for (const s of diff.new_servers.slice(0, 20)) {
      console.error(`    ${s.id} — ${(s.description || "no description").slice(0, 60)}`);
    }
    if (diff.new_servers.length > 20) {
      console.error(`    ... +${diff.new_servers.length - 20} more`);
    }
  }

  if (diff.endpoint_changed.length > 0) {
    console.error(`\n  🔄 ENDPOINT CHANGED:`);
    for (const s of diff.endpoint_changed.slice(0, 10)) {
      console.error(`    ${s.id}`);
      console.error(`      old: ${s.old_endpoint.slice(0, 70)}`);
      console.error(`      new: ${s.new_endpoint.slice(0, 70)}`);
    }
  }

  if (diff.removed_from_registry.length > 0) {
    console.error(`\n  ➖ REMOVED from registry (${diff.removed_from_registry.length}, showing 10):`);
    for (const id of diff.removed_from_registry.slice(0, 10)) {
      console.error(`    ${id}`);
    }
  }

  // ── Auto-ingest new entries ────────────────────────────────────
  if (autoIngest && diff.new_servers.length > 0) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO crawl_queue (source, source_url, candidate_name, description, status, tier)
      VALUES ('registry-diff', ?, ?, ?, 'pending', 'review')
    `);

    let ingested = 0;
    const tx = db.transaction(() => {
      for (const s of diff.new_servers) {
        const result = insert.run(
          s.endpoint || `https://registry.modelcontextprotocol.io/v0/servers/${encodeURIComponent(s.id)}`,
          s.id,
          s.description || s.name || "New registry entry",
        );
        if (result.changes > 0) ingested++;
      }
    });
    tx();
    console.error(`\n  → ${ingested} new servers queued for review`);
  }

  // Save diff report
  const reportPath = resolve(import.meta.dirname, "../data/registry-diff.json");
  writeFileSync(reportPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    registry_count: registryIds.size,
    db_count: dbIds.size,
    ...diff,
  }, null, 2), "utf-8");
  console.error(`\n  Diff saved to ${reportPath}`);
  console.error("═══════════════════════════════════════════════════");

  db.close();
}

main().catch((err) => {
  console.error("[registry-diff] Fatal:", err.message);
  process.exit(1);
});
