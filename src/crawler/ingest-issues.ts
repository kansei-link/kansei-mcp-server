#!/usr/bin/env tsx
/**
 * Ingest GitHub Issues findings into KanseiLINK DB.
 *
 * Two ingestion paths:
 *   1. outcomes table → feeds Fix ② field_insights pipeline (proven_fixes, known_blockers)
 *   2. agent_feedback table → community_notes
 *
 * Usage:
 *   npx tsx src/crawler/ingest-issues.ts src/data/github-issues-180d.json
 *   npx tsx src/crawler/ingest-issues.ts src/data/github-issues-180d.json --dry-run
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IssueFinding } from "./types.js";

// Production DB is at project root, not src/db/
const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

interface IssuesData {
  meta: { generated_at: string; since_days: number };
  stats: { total: number; mapped: number };
  findings: IssueFinding[];
}

function main() {
  const args = process.argv.slice(2);
  const inputFile = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (!inputFile) {
    console.error("Usage: npx tsx src/crawler/ingest-issues.ts <issues-json-file> [--dry-run]");
    process.exit(1);
  }

  const raw = readFileSync(inputFile, "utf-8");
  const data: IssuesData = JSON.parse(raw);

  console.error(`[ingest-issues] Loaded ${data.findings.length} findings from ${inputFile}`);
  console.error(`[ingest-issues] Generated: ${data.meta.generated_at}`);
  console.error(`[ingest-issues] Dry run: ${dryRun}`);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Check which service_ids actually exist in our DB
  const existingServices = new Set<string>();
  const rows = db.prepare("SELECT id FROM services").all() as Array<{ id: string }>;
  for (const row of rows) existingServices.add(row.id);

  // Filter to findings we can actually map
  const mappable = data.findings.filter((f) => f.service_id && existingServices.has(f.service_id));
  const unmappable = data.findings.filter(
    (f) => f.service_id && !existingServices.has(f.service_id)
  );

  console.error(`\n[ingest-issues] Mappable to existing services: ${mappable.length}`);
  console.error(`[ingest-issues] Service exists but not in DB: ${unmappable.length}`);
  if (unmappable.length > 0) {
    const missing = new Set(unmappable.map((f) => f.service_id));
    console.error(`[ingest-issues] Missing service_ids: ${Array.from(missing).join(", ")}`);
  }
  console.error(`[ingest-issues] No service_id: ${data.findings.filter((f) => !f.service_id).length}`);

  if (dryRun) {
    console.error("\n[ingest-issues] DRY RUN — showing what would be inserted:\n");
    showPreview(mappable);
    db.close();
    return;
  }

  // ── Ingest into outcomes table ──────────────────────────────────
  const insertOutcome = db.prepare(`
    INSERT INTO outcomes (service_id, agent_id_hash, success, error_type, workaround, context_masked, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // ── Ingest high-comment issues into agent_feedback ─────────────
  const insertFeedback = db.prepare(`
    INSERT INTO agent_feedback (agent_id, feedback_type, service_id, subject, body, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ── Dedup: check what's already ingested ────────────────────────
  const existingOutcomes = new Set<string>();
  const outRows = db
    .prepare("SELECT service_id, context_masked FROM outcomes WHERE agent_id_hash = 'github-issues-miner'")
    .all() as Array<{ service_id: string; context_masked: string | null }>;
  for (const r of outRows) {
    if (r.context_masked) existingOutcomes.add(`${r.service_id}::${r.context_masked.slice(0, 100)}`);
  }

  const existingFeedback = new Set<string>();
  const fbRows = db
    .prepare("SELECT service_id, subject FROM agent_feedback WHERE agent_id = 'github-issues-miner'")
    .all() as Array<{ service_id: string; subject: string }>;
  for (const r of fbRows) {
    existingFeedback.add(`${r.service_id}::${r.subject}`);
  }

  let outcomesInserted = 0;
  let outcomesSkipped = 0;
  let feedbackInserted = 0;
  let feedbackSkipped = 0;

  const tx = db.transaction(() => {
    for (const f of mappable) {
      // ── 1. outcomes (every finding with error classification) ──
      const contextKey = `[GH#${f.issue_number}] ${f.title}`.slice(0, 200);
      const dedupKey = `${f.service_id}::${contextKey.slice(0, 100)}`;

      if (existingOutcomes.has(dedupKey)) {
        outcomesSkipped++;
        continue;
      }

      insertOutcome.run(
        f.service_id,
        "github-issues-miner",
        f.resolved ? 1 : 0, // success = resolved with workaround
        f.error_type,
        f.workaround?.slice(0, 500) || null,
        contextKey,
        f.created_at
      );
      outcomesInserted++;

      // ── 2. agent_feedback (high-engagement issues only) ────────
      if (f.comment_count >= 5) {
        const fbSubject = `[${f.repo}#${f.issue_number}] ${f.title}`.slice(0, 200);
        const fbKey = `${f.service_id}::${fbSubject}`;

        if (existingFeedback.has(fbKey)) {
          feedbackSkipped++;
          continue;
        }

        const body = [
          `**Source**: ${f.url}`,
          `**Error type**: ${f.error_type}`,
          `**Severity**: ${f.severity}`,
          `**State**: ${f.state}`,
          `**Comments**: ${f.comment_count}`,
          f.workaround ? `**Workaround**: ${f.workaround.slice(0, 300)}` : null,
          `**Problem**: ${f.problem_summary.slice(0, 300)}`,
        ]
          .filter(Boolean)
          .join("\n");

        const priority = f.severity === "critical" ? "high" : f.severity === "major" ? "medium" : "low";

        insertFeedback.run(
          "github-issues-miner",
          "community_report",
          f.service_id,
          fbSubject,
          body,
          priority,
          "open",
          f.created_at
        );
        feedbackInserted++;
      }
    }
  });

  tx();

  // ── Update service_stats for affected services ──────────────────
  const affectedServices = new Set(mappable.map((f) => f.service_id!));
  const updateStats = db.prepare(`
    INSERT INTO service_stats (service_id, total_calls, success_rate, last_updated)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(service_id) DO UPDATE SET
      total_calls = (SELECT count(*) FROM outcomes WHERE service_id = ?),
      success_rate = (SELECT CAST(sum(success) AS REAL) / count(*) FROM outcomes WHERE service_id = ?),
      last_updated = datetime('now')
  `);

  for (const sid of Array.from(affectedServices)) {
    const count = (
      db.prepare("SELECT count(*) as c FROM outcomes WHERE service_id = ?").get(sid) as { c: number }
    ).c;
    const successRate = (
      db
        .prepare("SELECT CAST(sum(success) AS REAL) / count(*) as r FROM outcomes WHERE service_id = ?")
        .get(sid) as { r: number | null }
    ).r || 0;
    updateStats.run(sid, count, successRate, sid, sid);
  }

  db.close();

  console.error("\n═══════════════════════════════════════");
  console.error("  Issues Ingestion — Results");
  console.error("═══════════════════════════════════════");
  console.error(`  Outcomes inserted:  ${outcomesInserted}`);
  console.error(`  Outcomes skipped:   ${outcomesSkipped} (already existed)`);
  console.error(`  Feedback inserted:  ${feedbackInserted}`);
  console.error(`  Feedback skipped:   ${feedbackSkipped} (already existed)`);
  console.error(`  Services updated:   ${affectedServices.size}`);
  console.error("═══════════════════════════════════════");
}

function showPreview(findings: IssueFinding[]) {
  const byService = new Map<string, IssueFinding[]>();
  for (const f of findings) {
    const arr = byService.get(f.service_id!) || [];
    arr.push(f);
    byService.set(f.service_id!, arr);
  }

  for (const [sid, issues] of byService) {
    const resolved = issues.filter((i) => i.resolved).length;
    const withFix = issues.filter((i) => i.workaround).length;
    console.error(`  ${sid}: ${issues.length} outcomes (${resolved} resolved, ${withFix} with workaround)`);
    // Show top 2 examples
    for (const i of issues.slice(0, 2)) {
      console.error(`    [${i.error_type}/${i.severity}] ${i.title.slice(0, 80)}`);
      if (i.workaround) console.error(`      Fix: ${i.workaround.slice(0, 100)}`);
    }
    if (issues.length > 2) console.error(`    ... and ${issues.length - 2} more`);
    console.error("");
  }
}

main();
