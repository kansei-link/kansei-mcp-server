#!/usr/bin/env node
/**
 * Triage pending crawl_queue items — bulk accept / reject.
 * Run: node scripts/triage-pending.mjs
 *
 * Updates:
 * - services table: inserts accepted row with mcp_status='community'
 * - crawl_queue: sets status='ingested' (+ ingested_service_id) or 'rejected' (+ reject_reason)
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const db = new Database(dbPath);

// Accept list — 15 items (Tier 1 + Tier 2)
const ACCEPT_IDS = [80, 56, 54, 52, 68, 51, 83, 78, 37, 70, 76, 72, 65, 57, 86];

// Reject list — 10 items (Tier 3)
const REJECT = {
  82: "Low stars + no traction",
  75: "Niche crypto",
  73: "Niche crypto risk analysis",
  17: "Enterprise SAP ABAP — too niche",
  59: "Yandex-specific — geo-limited",
  71: "Industrial OPC UA — too niche",
  69: "Industrial Modbus — too niche",
  87: "US baseball — too niche",
  66: "Unofficial DoorDash — brand risk",
  60: "iOS Simulator (Mac dev only)",
};

function buildServiceId(repoFullName) {
  return repoFullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const selectById = db.prepare(`SELECT * FROM crawl_queue WHERE id=?`);
const insertService = db.prepare(`
  INSERT OR IGNORE INTO services
    (id, name, namespace, description, category, tags, mcp_endpoint, mcp_status, trust_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateQueueAccepted = db.prepare(`
  UPDATE crawl_queue
  SET status='ingested',
      ingested_service_id=?,
      reviewed_at=datetime('now'),
      reviewed_by='michie-triage-20260420'
  WHERE id=?
`);
const updateQueueRejected = db.prepare(`
  UPDATE crawl_queue
  SET status='rejected',
      reject_reason=?,
      reviewed_at=datetime('now'),
      reviewed_by='michie-triage-20260420'
  WHERE id=?
`);

const summary = { accepted: [], rejected: [], skipped: [] };

const tx = db.transaction(() => {
  // Accept path
  for (const qid of ACCEPT_IDS) {
    const row = selectById.get(qid);
    if (!row) {
      summary.skipped.push({ id: qid, reason: "not found" });
      continue;
    }
    if (row.status !== "pending") {
      summary.skipped.push({ id: qid, reason: `status=${row.status}` });
      continue;
    }
    const serviceId = buildServiceId(row.repo_full_name);
    const owner = row.repo_full_name.split("/")[0] ?? "unknown";
    const info = insertService.run(
      serviceId,
      row.candidate_name,
      owner,
      (row.description || "").slice(0, 500),
      row.proposed_category || "Other",
      row.proposed_tags || "[]",
      row.source_url,
      "community",
      row.trust_score_initial
    );
    if (info.changes === 0) {
      summary.skipped.push({ id: qid, reason: "service_id collision" });
      continue;
    }
    updateQueueAccepted.run(serviceId, qid);
    summary.accepted.push({ id: qid, service_id: serviceId, name: row.candidate_name });
  }

  // Reject path
  for (const [qid, reason] of Object.entries(REJECT)) {
    const row = selectById.get(Number(qid));
    if (!row) {
      summary.skipped.push({ id: qid, reason: "not found" });
      continue;
    }
    if (row.status !== "pending") {
      summary.skipped.push({ id: qid, reason: `status=${row.status}` });
      continue;
    }
    updateQueueRejected.run(reason, Number(qid));
    summary.rejected.push({ id: qid, name: row.candidate_name, reason });
  }
});

tx();

console.log("=== Triage summary ===");
console.log(`Accepted: ${summary.accepted.length}`);
for (const a of summary.accepted) console.log(`  #${a.id}  ${a.service_id}  ${a.name}`);
console.log();
console.log(`Rejected: ${summary.rejected.length}`);
for (const r of summary.rejected) console.log(`  #${r.id}  ${r.name}  (${r.reason})`);
console.log();
if (summary.skipped.length > 0) {
  console.log(`Skipped: ${summary.skipped.length}`);
  for (const s of summary.skipped) console.log(`  #${s.id}  (${s.reason})`);
}

// Final count check
const { total } = db.prepare(`SELECT COUNT(*) AS total FROM services`).get();
const { pending } = db.prepare(`SELECT COUNT(*) AS pending FROM crawl_queue WHERE status='pending'`).get();
console.log();
console.log(`services total:        ${total}`);
console.log(`crawl_queue pending:   ${pending}`);

db.close();
