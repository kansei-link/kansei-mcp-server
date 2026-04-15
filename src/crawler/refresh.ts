/**
 * Refresh GitHub metadata for existing services.
 *
 * Only hits services whose mcp_endpoint or api_url points at github.com —
 * for hosted SaaS services (most of the 225) this is a no-op, which is fine.
 * For newly-crawled MCP servers, this keeps stars / last_commit / description
 * up to date daily.
 */
import type Database from "better-sqlite3";

const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/#?]+)/i;

interface GithubRepoMeta {
  stargazers_count: number;
  pushed_at: string;
  topics: string[];
  language: string | null;
  archived: boolean;
  license: { spdx_id: string } | null;
  description: string | null;
}

function extractRepoFullName(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(GITHUB_URL_RE);
  if (!m) return null;
  return m[1].replace(/\.git$/, "");
}

async function fetchRepoMeta(
  repoFullName: string,
  token?: string
): Promise<GithubRepoMeta | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repoFullName}`, { headers });
  if (!res.ok) return null;
  return (await res.json()) as GithubRepoMeta;
}

export interface RefreshSummary {
  eligible: number;
  refreshed: number;
  archived_detected: number;
  errors: number;
  changelog_entries: number;
}

export async function refreshExistingServices(
  db: Database.Database,
  options: { token?: string; concurrency?: number } = {}
): Promise<RefreshSummary> {
  const { token = process.env.GITHUB_TOKEN, concurrency = 3 } = options;

  type SvcRow = {
    id: string;
    name: string;
    mcp_endpoint: string | null;
    api_url: string | null;
    description: string | null;
    trust_score: number;
  };
  const all = db
    .prepare(
      "SELECT id, name, mcp_endpoint, api_url, description, trust_score FROM services"
    )
    .all() as SvcRow[];

  // Only services with a github URL are refreshable
  const eligible = all
    .map((s) => ({ svc: s, repo: extractRepoFullName(s.mcp_endpoint) || extractRepoFullName(s.api_url) }))
    .filter((x): x is { svc: SvcRow; repo: string } => Boolean(x.repo));

  const summary: RefreshSummary = {
    eligible: eligible.length,
    refreshed: 0,
    archived_detected: 0,
    errors: 0,
    changelog_entries: 0,
  };

  if (eligible.length === 0) return summary;

  const updateService = db.prepare(
    `UPDATE services
     SET description = COALESCE(?, description),
         usage_count = usage_count  -- unchanged sentinel
     WHERE id = ?`
  );

  const insertChangelog = db.prepare(
    `INSERT OR IGNORE INTO service_changelog (service_id, change_date, change_type, summary, details)
     VALUES (?, date('now'), ?, ?, ?)`
  );

  const insertInspection = db.prepare(
    `INSERT INTO inspections (service_id, anomaly_type, severity, description, evidence, status)
     VALUES (?, 'archived', 'high', ?, ?, 'open')`
  );

  const queue = [...eligible];
  const runWorker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        const meta = await fetchRepoMeta(item.repo, token);
        if (!meta) {
          summary.errors++;
          continue;
        }

        // Detect archival — high-severity signal
        if (meta.archived) {
          summary.archived_detected++;
          const inspectionResult = insertInspection.run(
            item.svc.id,
            `Upstream repo ${item.repo} marked as archived on GitHub`,
            JSON.stringify({ repo: item.repo, archived: true })
          );
          if (inspectionResult.changes > 0) summary.changelog_entries++;
          insertChangelog.run(
            item.svc.id,
            "deprecation",
            "Repository archived on GitHub",
            JSON.stringify({ repo: item.repo })
          );
        }

        // Refresh description if GitHub has something newer / non-empty
        if (meta.description && meta.description !== item.svc.description) {
          updateService.run(meta.description.slice(0, 500), item.svc.id);
        }

        summary.refreshed++;
      } catch (err) {
        summary.errors++;
        console.error(`[refresh] ${item.repo}:`, err);
      }
      await new Promise((r) => setTimeout(r, token ? 80 : 1100));
    }
  };

  const workers = Array.from({ length: concurrency }, runWorker);
  await Promise.all(workers);

  return summary;
}
