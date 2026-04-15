/**
 * Dedupe candidates against:
 *   (a) existing services in the DB
 *   (b) candidates already in crawl_queue
 *   (c) each other (multi-source duplicates)
 *
 * Strategy: normalize repo_full_name to lowercase + strip trailing `/mcp-server` suffix,
 * then look up against a canonical name index.
 */
import type Database from "better-sqlite3";
import type { RawCandidate } from "../types.js";

export interface DedupeResult {
  fresh: RawCandidate[];
  duplicates: RawCandidate[];
  alreadyQueued: RawCandidate[];
}

function normalizeRepo(name: string): string {
  return name.toLowerCase().trim();
}

function buildIdFromRepo(repoFullName: string): string {
  // Services already use IDs like "owner-repo" in some cases; we use the same pattern
  // but keep slashes too for flexibility.
  return repoFullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function dedupeAgainstDb(
  db: Database.Database,
  candidates: RawCandidate[]
): DedupeResult {
  // Load all existing service identifiers
  const existingServices = db
    .prepare("SELECT id, name, namespace, mcp_endpoint, api_url FROM services")
    .all() as Array<{
      id: string;
      name: string;
      namespace: string | null;
      mcp_endpoint: string | null;
      api_url: string | null;
    }>;

  const serviceKeys = new Set<string>();
  for (const s of existingServices) {
    serviceKeys.add(normalizeRepo(s.id));
    if (s.namespace) serviceKeys.add(normalizeRepo(s.namespace));
    if (s.name) serviceKeys.add(normalizeRepo(s.name));
    // Try to extract owner/repo from URLs
    for (const url of [s.mcp_endpoint, s.api_url].filter(Boolean) as string[]) {
      const m = url.match(/github\.com\/([^/]+\/[^/#?]+)/i);
      if (m) serviceKeys.add(normalizeRepo(m[1]));
    }
  }

  // Load already-queued candidates (any status)
  const queued = db
    .prepare("SELECT repo_full_name, source, source_url FROM crawl_queue")
    .all() as Array<{ repo_full_name: string | null; source: string; source_url: string }>;

  const queuedKeys = new Set<string>();
  const queuedUrlKeys = new Set<string>();
  for (const q of queued) {
    if (q.repo_full_name) queuedKeys.add(normalizeRepo(q.repo_full_name));
    queuedUrlKeys.add(`${q.source}::${q.source_url}`);
  }

  // Dedupe intra-batch (multi-source overlap)
  const seenBatch = new Set<string>();
  const fresh: RawCandidate[] = [];
  const duplicates: RawCandidate[] = [];
  const alreadyQueued: RawCandidate[] = [];

  for (const c of candidates) {
    const repoKey = normalizeRepo(c.repo_full_name);
    const urlKey = `${c.source}::${c.source_url}`;

    if (serviceKeys.has(repoKey) || serviceKeys.has(buildIdFromRepo(c.repo_full_name))) {
      duplicates.push(c);
      continue;
    }
    if (queuedKeys.has(repoKey) || queuedUrlKeys.has(urlKey)) {
      alreadyQueued.push(c);
      continue;
    }
    if (seenBatch.has(repoKey)) {
      alreadyQueued.push(c);
      continue;
    }
    seenBatch.add(repoKey);
    fresh.push(c);
  }

  return { fresh, duplicates, alreadyQueued };
}
