/**
 * Linksee Memory bridge — records critical reconnaissance findings into Linksee Memory.
 *
 * The reconnaissance ant runs in CI without an interactive Claude session, so
 * it cannot call MCP tools directly. Instead, it writes a structured JSONL
 * file that a downstream Claude session (朝ダイジェスト agent — Tier C) can
 * read and feed into Linksee.
 *
 * For Tier B-β, this is a "deferred write" — the JSONL queue accumulates,
 * and the next Claude session that runs `recall("Synapse Arrows")` should
 * also process the queue.
 *
 * Output: data/reconnaissance/linksee-queue.jsonl (append-only)
 *
 * Each line:
 * {
 *   "ts": "2026-04-30T00:00:00.000Z",
 *   "entity_name": "{Product}",
 *   "entity_kind": "project",
 *   "layer": "caveat" | "context",
 *   "importance": 0.85,
 *   "content": "...",
 *   "source": "reconnaissance-ant",
 *   "report_date": "YYYY-MM-DD"
 * }
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const QUEUE_PATH = path.join(REPO_ROOT, "data", "reconnaissance", "linksee-queue.jsonl");

/**
 * Process all product results and write critical findings to the queue.
 * Returns count of entries written.
 */
export async function recordCriticalFindings(date, productResults) {
  const queueDir = path.dirname(QUEUE_PATH);
  await mkdir(queueDir, { recursive: true });

  let writtenCount = 0;

  for (const result of productResults) {
    const entries = buildEntriesForProduct(date, result);
    for (const entry of entries) {
      await appendFile(QUEUE_PATH, JSON.stringify(entry) + "\n", "utf-8");
      writtenCount += 1;
    }
  }

  return writtenCount;
}

function buildEntriesForProduct(date, result) {
  const entries = [];
  const allFindings = result.findings || [];

  // 1. Critical findings → caveat layer (forget-protected)
  const criticalFindings = allFindings.filter((f) => f.urgency === "critical");
  if (criticalFindings.length > 0) {
    entries.push({
      ts: new Date().toISOString(),
      entity_name: normalizeEntityName(result.product),
      entity_kind: "project",
      layer: "caveat",
      importance: 0.88,
      content: formatCaveatContent(date, result.product, criticalFindings),
      source: "reconnaissance-ant",
      report_date: date,
      action: "remember",
    });
  }

  // 2. Snapshot drift > threshold (warning) → context layer
  const snapshotWarnings = (result.snapshot || []).filter(
    (f) => f.urgency === "warning"
  );
  if (snapshotWarnings.length > 0) {
    entries.push({
      ts: new Date().toISOString(),
      entity_name: normalizeEntityName(result.product),
      entity_kind: "project",
      layer: "context",
      importance: 0.7,
      content: formatSnapshotWarning(date, result.product, snapshotWarnings),
      source: "reconnaissance-ant",
      report_date: date,
      action: "remember",
    });
  }

  return entries;
}

function formatCaveatContent(date, product, criticalFindings) {
  const lines = [];
  lines.push(`**Reconnaissance ant detected critical drift — ${date}**`);
  lines.push("");
  for (const f of criticalFindings) {
    const where = f.url || "(monitor)";
    lines.push(`- ${where}: ${f.reason}`);
  }
  lines.push("");
  lines.push(`See data/reconnaissance/reports/${date}.md for full context.`);
  lines.push(
    `If this finding is stable for 3+ days, escalate to a real fix or update HEALTH.json baselines.`
  );
  return lines.join("\n");
}

function formatSnapshotWarning(date, product, snapshotWarnings) {
  const lines = [];
  lines.push(`**UI drift detected (${date})**`);
  lines.push("");
  for (const f of snapshotWarnings) {
    lines.push(
      `- ${f.url}: ${f.reason}${f.diff_path ? ` (see ${f.diff_path})` : ""}`
    );
  }
  lines.push("");
  lines.push(`If intentional, no action needed (baseline is rolling).`);
  lines.push(`If unintentional, this is the kind of "fix breaks UI" drift scope-locks Tier 5 visual regression would catch in CI.`);
  return lines.join("\n");
}

function normalizeEntityName(product) {
  // Linksee entity name normalization — match existing entity patterns
  // Sake Navi (with space), Card Navi, KanseiLink, etc.
  const map = {
    KanseiLink: "KanseiLink",
    ScaNavi: "Sake Navi",
    SakeNavi: "Sake Navi",
    CardWize: "Card Navi",
    "Card Navi": "Card Navi",
  };
  return map[product] || product;
}
