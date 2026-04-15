/**
 * Enrichment: fetch README excerpt + verify stars/license/activity from GitHub.
 * For awesome-list candidates (where we don't yet have stars), this is where we
 * pick up GitHub metadata.
 */
import type { RawCandidate, EnrichedCandidate } from "../types.js";

const README_MAX_CHARS = 2000;

interface GithubRepoMeta {
  stargazers_count: number;
  pushed_at: string;
  topics: string[];
  language: string | null;
  archived: boolean;
  license: { spdx_id: string } | null;
  description: string | null;
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

async function fetchReadmeExcerpt(
  repoFullName: string,
  token?: string
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${repoFullName}/readme`, { headers });
  if (!res.ok) return "";
  const text = await res.text();
  // Strip HTML/markdown images and links noise, keep first N chars
  const cleaned = text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/<[^>]+>/g, "") // html tags
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.slice(0, README_MAX_CHARS);
}

export async function enrichCandidates(
  candidates: RawCandidate[],
  options: { token?: string; concurrency?: number } = {}
): Promise<EnrichedCandidate[]> {
  const { token = process.env.GITHUB_TOKEN, concurrency = 4 } = options;
  const results: EnrichedCandidate[] = [];

  // Simple concurrency-limited loop
  const queue = [...candidates];
  const workers: Promise<void>[] = [];

  async function worker() {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) break;
      try {
        // If stars already known (github-topics source), only fetch README
        const needsMeta = !c.stars || c.stars === 0 || !c.last_commit_at;
        const [meta, readme] = await Promise.all([
          needsMeta ? fetchRepoMeta(c.repo_full_name, token) : Promise.resolve(null),
          fetchReadmeExcerpt(c.repo_full_name, token),
        ]);

        const enriched: EnrichedCandidate = {
          ...c,
          stars: meta?.stargazers_count ?? c.stars,
          last_commit_at: meta?.pushed_at ?? c.last_commit_at,
          topics: meta?.topics ?? c.topics ?? [],
          language: meta?.language ?? c.language ?? null,
          description: c.description || meta?.description || "",
          readme_excerpt: readme,
          has_readme: readme.length > 100,
          has_license: Boolean(meta?.license?.spdx_id),
        };

        // Skip archived repos
        if (meta?.archived) {
          continue;
        }

        results.push(enriched);
      } catch (err) {
        console.error(`[enrich] failed for ${c.repo_full_name}:`, err);
      }

      // Gentle rate limiting — GitHub allows 5000 req/hour with token, 60/hour without
      await new Promise((r) => setTimeout(r, token ? 80 : 1100));
    }
  }

  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  return results;
}
