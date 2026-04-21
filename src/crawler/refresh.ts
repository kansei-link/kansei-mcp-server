/**
 * Refresh upstream metadata for existing services + generate changelog entries
 * when anything material has moved.
 *
 * Sources:
 *   1. GitHub API — stars, pushed_at, archived, description (for services whose
 *      mcp_endpoint / api_url points at github.com)
 *   2. npm registry — latest published version (for `mcp_endpoint` strings that
 *      look like `npx PACKAGE` or `npx -y @scope/PACKAGE`)
 *
 * Writes diffs as service_changelog entries with classified change_type:
 *   - mcp_released       → npm version bumped
 *   - api_change         → GitHub description or last_push_at changed materially
 *   - feature            → significant stars jump (> +20%)
 *   - deprecated         → GitHub repo archived
 *   - other              → misc upstream shifts
 */
import type Database from "better-sqlite3";

const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/#?]+)/i;
const NPM_PACKAGE_RE = /npx\s+(?:-y\s+)?((?:@[a-z0-9-]+\/)?[a-z0-9._-]+)/i;

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

function extractNpmPackage(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null;
  const m = endpoint.match(NPM_PACKAGE_RE);
  if (!m) return null;
  const pkg = m[1];
  // Skip generic helpers that aren't MCP servers
  if (pkg === "tsx" || pkg === "ts-node" || pkg === "npm") return null;
  return pkg;
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

async function fetchNpmLatest(pkg: string): Promise<string | null> {
  try {
    // URL-encode scope `/` for npm registry
    const encoded = pkg.replace("/", "%2F");
    const res = await fetch(`https://registry.npmjs.org/${encoded}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { "dist-tags"?: { latest?: string } };
    return data["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  }
}

export interface RefreshSummary {
  eligible: number;
  refreshed: number;
  errors: number;
  archived_detected: number;
  changelog_entries: number;
  by_type: Record<string, number>;
}

/**
 * Diff a numeric delta — returns true if change is significant enough to log.
 * Small stars movements are noise.
 */
function significantStarsJump(before: number | null, after: number): boolean {
  if (!before || before < 10) return after >= 50; // stars crossed meaningful threshold
  const delta = after - before;
  const pct = delta / before;
  return delta >= 25 && pct >= 0.2;
}

export async function refreshExistingServices(
  db: Database.Database,
  options: { token?: string; concurrency?: number; checkNpm?: boolean } = {}
): Promise<RefreshSummary> {
  const {
    token = process.env.GITHUB_TOKEN,
    concurrency = 3,
    checkNpm = true,
  } = options;

  type SvcRow = {
    id: string;
    name: string;
    mcp_endpoint: string | null;
    api_url: string | null;
    description: string | null;
    trust_score: number;
    archived: number | null;
    github_stars: number | null;
    github_pushed_at: string | null;
    npm_version: string | null;
  };
  const all = db
    .prepare(
      `SELECT id, name, mcp_endpoint, api_url, description, trust_score,
              archived, github_stars, github_pushed_at, npm_version
       FROM services`
    )
    .all() as SvcRow[];

  const eligible = all
    .map((s) => ({
      svc: s,
      repo: extractRepoFullName(s.mcp_endpoint) || extractRepoFullName(s.api_url),
      npmPkg: checkNpm ? extractNpmPackage(s.mcp_endpoint) : null,
    }))
    .filter((x) => x.repo || x.npmPkg);

  const summary: RefreshSummary = {
    eligible: eligible.length,
    refreshed: 0,
    errors: 0,
    archived_detected: 0,
    changelog_entries: 0,
    by_type: {},
  };

  if (eligible.length === 0) return summary;

  const updateUpstream = db.prepare(
    `UPDATE services
     SET description = COALESCE(?, description),
         archived = COALESCE(?, archived),
         github_stars = COALESCE(?, github_stars),
         github_pushed_at = COALESCE(?, github_pushed_at),
         npm_version = COALESCE(?, npm_version),
         last_refreshed_at = datetime('now')
     WHERE id = ?`
  );

  // INSERT OR IGNORE on (service_id, change_date, change_type, summary) would be
  // ideal but there's no unique constraint in the schema. Instead we dedupe by
  // checking for same-day same-type entry before inserting.
  const changelogExists = db.prepare(
    `SELECT 1 FROM service_changelog
     WHERE service_id = ? AND change_date = date('now') AND change_type = ? AND summary = ?
     LIMIT 1`
  );
  const insertChangelog = db.prepare(
    `INSERT INTO service_changelog (service_id, change_date, change_type, summary, details)
     VALUES (?, date('now'), ?, ?, ?)`
  );
  const insertInspection = db.prepare(
    `INSERT INTO inspections (service_id, anomaly_type, severity, description, evidence, status)
     VALUES (?, 'archived', 'high', ?, ?, 'open')`
  );

  function recordChange(
    serviceId: string,
    type: string,
    summaryText: string,
    details: unknown
  ) {
    const existing = changelogExists.get(serviceId, type, summaryText);
    if (existing) return;
    insertChangelog.run(serviceId, type, summaryText, JSON.stringify(details));
    summary.changelog_entries++;
    summary.by_type[type] = (summary.by_type[type] ?? 0) + 1;
  }

  const queue = [...eligible];
  const runWorker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        let newDescription: string | null | undefined = undefined;
        let newArchived: number | undefined;
        let newStars: number | undefined;
        let newPushed: string | undefined;
        let newNpmVersion: string | null | undefined = undefined;

        // ── GitHub side ──
        if (item.repo) {
          const meta = await fetchRepoMeta(item.repo, token);
          if (meta) {
            const wasArchived = item.svc.archived === 1;
            const isArchived = Boolean(meta.archived);
            if (isArchived && !wasArchived) {
              summary.archived_detected++;
              try {
                insertInspection.run(
                  item.svc.id,
                  `Upstream repo ${item.repo} marked as archived on GitHub`,
                  JSON.stringify({ repo: item.repo, archived: true })
                );
              } catch { /* inspections table may not exist in older deploys */ }
              recordChange(
                item.svc.id,
                "deprecated",
                "Repository archived on GitHub",
                { repo: item.repo }
              );
            }
            newArchived = isArchived ? 1 : 0;

            if (meta.description && meta.description !== item.svc.description) {
              const before = item.svc.description?.slice(0, 120) ?? "";
              const after = meta.description.slice(0, 120);
              recordChange(
                item.svc.id,
                "api_change",
                "Description updated upstream",
                { before, after, repo: item.repo }
              );
              newDescription = meta.description.slice(0, 500);
            }

            if (
              typeof meta.stargazers_count === "number" &&
              significantStarsJump(item.svc.github_stars, meta.stargazers_count)
            ) {
              recordChange(
                item.svc.id,
                "feature",
                `Star count jumped to ${meta.stargazers_count}`,
                {
                  before: item.svc.github_stars,
                  after: meta.stargazers_count,
                  repo: item.repo,
                }
              );
            }
            newStars = meta.stargazers_count ?? undefined;

            if (meta.pushed_at && meta.pushed_at !== item.svc.github_pushed_at) {
              // Only record a changelog entry if there's a real "no commits in a
              // long time → new commits" signal. Otherwise every refresh would
              // spam one entry. Threshold: previous pushed_at was >= 30 days ago.
              if (item.svc.github_pushed_at) {
                const prev = new Date(item.svc.github_pushed_at).getTime();
                const now = new Date(meta.pushed_at).getTime();
                const daysSincePrev = (now - prev) / (1000 * 60 * 60 * 24);
                if (daysSincePrev >= 30) {
                  recordChange(
                    item.svc.id,
                    "feature",
                    `Resumed activity — new commits after ${Math.floor(daysSincePrev)} days`,
                    { before: item.svc.github_pushed_at, after: meta.pushed_at, repo: item.repo }
                  );
                }
              }
              newPushed = meta.pushed_at;
            }

            summary.refreshed++;
          } else {
            summary.errors++;
          }
        }

        // ── npm side ──
        if (item.npmPkg && checkNpm) {
          const latest = await fetchNpmLatest(item.npmPkg);
          if (latest && latest !== item.svc.npm_version) {
            if (item.svc.npm_version) {
              recordChange(
                item.svc.id,
                "mcp_released",
                `New version ${latest} published to npm`,
                { package: item.npmPkg, before: item.svc.npm_version, after: latest }
              );
            }
            newNpmVersion = latest;
          }
        }

        updateUpstream.run(
          newDescription ?? null,
          newArchived ?? null,
          newStars ?? null,
          newPushed ?? null,
          newNpmVersion ?? null,
          item.svc.id
        );
      } catch (err) {
        summary.errors++;
        console.error(`[refresh] ${item.svc.id}:`, err);
      }
      // Rate-limit pause — unauthenticated GitHub = 60/hr, with PAT = 5000/hr
      await new Promise((r) => setTimeout(r, token ? 80 : 1100));
    }
  };

  const workers = Array.from({ length: concurrency }, runWorker);
  await Promise.all(workers);

  return summary;
}
