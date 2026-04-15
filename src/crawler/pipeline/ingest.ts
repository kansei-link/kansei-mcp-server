/**
 * Ingest scored candidates into the crawl_queue table.
 * Auto-accepted entries are ALSO pushed straight into the services table
 * with mcp_status='community'.
 */
import type Database from "better-sqlite3";
import type { ScoredCandidate } from "../types.js";

function buildServiceId(repoFullName: string): string {
  return repoFullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export interface IngestSummary {
  autoAccepted: number;
  queuedForReview: number;
  rejected: number;
  ingestedServiceIds: string[];
}

export function ingestCandidates(
  db: Database.Database,
  candidates: ScoredCandidate[]
): IngestSummary {
  const insertQueue = db.prepare(`
    INSERT OR IGNORE INTO crawl_queue
      (source, source_url, repo_full_name, candidate_name, description,
       stars, last_commit_at, readme_excerpt,
       proposed_category, proposed_tags, trust_score_initial,
       tier, status, reject_reason, ingested_service_id, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertService = db.prepare(`
    INSERT OR IGNORE INTO services
      (id, name, namespace, description, category, tags, mcp_endpoint, mcp_status, trust_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let autoAccepted = 0;
  let queuedForReview = 0;
  let rejected = 0;
  const ingestedServiceIds: string[] = [];

  const tx = db.transaction((cs: ScoredCandidate[]) => {
    for (const c of cs) {
      let status: string = "pending";
      let serviceId: string | null = null;

      if (c.tier === "auto-accept") {
        serviceId = buildServiceId(c.repo_full_name);
        const info = insertService.run(
          serviceId,
          c.candidate_name,
          c.owner,
          (c.description || "").slice(0, 500),
          c.proposed_category,
          JSON.stringify(c.proposed_tags || []),
          c.source_url,
          "community",
          c.trust_score
        );
        if (info.changes > 0) {
          autoAccepted++;
          ingestedServiceIds.push(serviceId);
          status = "ingested";
        } else {
          // ID collision (already existed) — drop to review
          status = "duplicate";
          serviceId = null;
        }
      } else if (c.tier === "review") {
        queuedForReview++;
      } else {
        rejected++;
        status = "rejected";
      }

      insertQueue.run(
        c.source,
        c.source_url,
        c.repo_full_name,
        c.candidate_name,
        (c.description || "").slice(0, 1000),
        c.stars,
        c.last_commit_at,
        (c.readme_excerpt || "").slice(0, 2000),
        c.proposed_category,
        JSON.stringify(c.proposed_tags || []),
        c.trust_score,
        c.tier,
        status,
        c.reject_reason || null,
        serviceId,
        JSON.stringify({ topics: c.topics, language: c.language, owner: c.owner })
      );
    }
  });

  tx(candidates);

  return { autoAccepted, queuedForReview, rejected, ingestedServiceIds };
}
