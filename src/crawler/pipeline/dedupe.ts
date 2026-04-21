/**
 * Dedupe candidates against:
 *   (a) existing services in the DB (exact + fuzzy/same-SaaS match)
 *   (b) candidates already in crawl_queue
 *   (c) each other (multi-source duplicates)
 *
 * Strategy has two layers:
 *   1. EXACT: normalized repo_full_name against existing service
 *      id/name/namespace/mcp_endpoint URL.
 *   2. FUZZY (same-SaaS detection): strip common MCP suffixes
 *      (-mcp, -mcp-server) from the repo name, then check whether
 *      either the owner OR the stripped name matches an existing
 *      service. Catches patterns like:
 *        - freee/freee-mcp               -> existing service "freee"
 *        - chatwork/chatwork-mcp-server  -> existing "chatwork"
 *        - nulab/backlog-mcp-server      -> existing "backlog"
 *        - openbnb-org/mcp-server-airbnb -> existing "airbnb-community"
 *      Without fuzzy, each of these would register as a duplicate
 *      entry, polluting the registry with 2-3 rows per SaaS.
 */
import type Database from "better-sqlite3";
import type { RawCandidate } from "../types.js";

export interface DedupeResult {
  fresh: RawCandidate[];
  duplicates: RawCandidate[];
  alreadyQueued: RawCandidate[];
  /**
   * Per-duplicate explanation so crawler summary can report WHY each
   * candidate was dropped. Keyed by repo_full_name.
   */
  duplicateReasons: Map<string, string>;
}

function normalizeRepo(name: string): string {
  return name.toLowerCase().trim();
}

function buildIdFromRepo(repoFullName: string): string {
  // Services already use IDs like "owner-repo" in some cases; we use the same pattern
  // but keep slashes too for flexibility.
  return repoFullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Strip common MCP-related prefixes/suffixes so "freee-mcp-server" and
 * "freee" compare equal. Intentionally conservative — only removes the
 * MCP-specific noise, not arbitrary words like "-api" or "-server".
 */
function stripMcpAffix(nameLower: string): string {
  let n = nameLower;
  n = n.replace(/[-_ ]?mcp[-_ ]?server$/i, "");
  n = n.replace(/[-_ ]?mcp[-_ ]?srv$/i, "");
  n = n.replace(/[-_ ]?mcp$/i, "");
  n = n.replace(/^mcp[-_ ]?server[-_ ]?/i, "");
  n = n.replace(/^mcp[-_ ]?/i, "");
  return n.trim();
}

/** Alternate forms of a single SaaS name ("money-forward" vs "moneyforward"). */
function nameVariants(nameLower: string): string[] {
  const base = nameLower.trim();
  if (!base) return [];
  const variants = new Set<string>([base]);
  // dash/underscore/space are all equivalent identifiers in practice
  variants.add(base.replace(/[-_ ]/g, ""));
  variants.add(base.replace(/[-_ ]/g, "-"));
  return Array.from(variants).filter((v) => v.length >= 2);
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

  // Exact-match key set (unchanged — these trigger the original duplicate path).
  const serviceKeys = new Set<string>();
  // Fuzzy/same-SaaS lookup: maps a variant back to the canonical service id
  // so the duplicate reason can point at the specific row that collided.
  const fuzzyMap = new Map<string, string>();

  const addFuzzy = (variant: string, canonicalId: string) => {
    if (!variant || variant.length < 2) return;
    if (!fuzzyMap.has(variant)) fuzzyMap.set(variant, canonicalId);
  };

  for (const s of existingServices) {
    const idLower = normalizeRepo(s.id);
    const nameLower = s.name ? normalizeRepo(s.name) : "";
    const nsLower = s.namespace ? normalizeRepo(s.namespace) : "";

    serviceKeys.add(idLower);
    if (nameLower) serviceKeys.add(nameLower);
    if (nsLower) serviceKeys.add(nsLower);

    // Build fuzzy variants from id / name / namespace. Strip trailing
    // "(community)" that the cleanup script adds to display names.
    const displayName = nameLower.replace(/\s*\(community\)\s*$/, "").trim();

    for (const v of nameVariants(idLower)) addFuzzy(v, s.id);
    for (const v of nameVariants(displayName)) addFuzzy(v, s.id);
    for (const v of nameVariants(nsLower)) addFuzzy(v, s.id);

    // Try to extract owner/repo from URLs
    for (const url of [s.mcp_endpoint, s.api_url].filter(Boolean) as string[]) {
      const m = url.match(/github\.com\/([^/]+\/[^/#?]+)/i);
      if (m) {
        const repo = normalizeRepo(m[1]);
        serviceKeys.add(repo);
        const [owner, repoName] = repo.split("/");
        if (owner) for (const v of nameVariants(owner)) addFuzzy(v, s.id);
        if (repoName) for (const v of nameVariants(stripMcpAffix(repoName))) addFuzzy(v, s.id);
      }
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
  const duplicateReasons = new Map<string, string>();

  for (const c of candidates) {
    const repoKey = normalizeRepo(c.repo_full_name);
    const urlKey = `${c.source}::${c.source_url}`;

    // (1) exact match against existing services
    if (serviceKeys.has(repoKey) || serviceKeys.has(buildIdFromRepo(c.repo_full_name))) {
      duplicates.push(c);
      duplicateReasons.set(c.repo_full_name, "exact match against existing service");
      continue;
    }

    // (2) fuzzy / same-SaaS match — owner OR stripped-repo-name lines up
    //     with a service we already track. This is where derivatives
    //     ("freee/freee-mcp") get caught.
    const [ownerRaw, repoRaw] = c.repo_full_name.split("/");
    const owner = (ownerRaw || "").toLowerCase();
    const repoName = (repoRaw || "").toLowerCase();
    const stripped = stripMcpAffix(repoName);

    let fuzzyHit: string | null = null;
    let fuzzyReason = "";
    // Prefer owner match — highest signal (e.g. freee/* is definitely freee).
    for (const v of nameVariants(owner)) {
      if (fuzzyMap.has(v)) {
        fuzzyHit = fuzzyMap.get(v)!;
        fuzzyReason = `owner '${owner}' matches existing service '${fuzzyHit}'`;
        break;
      }
    }
    // Then stripped repo name. Only accept hits of length >= 3 to avoid
    // false positives on short tokens like "ai" or "bo".
    if (!fuzzyHit && stripped.length >= 3) {
      for (const v of nameVariants(stripped)) {
        if (v.length < 3) continue;
        if (fuzzyMap.has(v)) {
          fuzzyHit = fuzzyMap.get(v)!;
          fuzzyReason = `stripped name '${stripped}' matches existing service '${fuzzyHit}'`;
          break;
        }
      }
    }

    if (fuzzyHit) {
      duplicates.push(c);
      duplicateReasons.set(c.repo_full_name, fuzzyReason);
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

  return { fresh, duplicates, alreadyQueued, duplicateReasons };
}
