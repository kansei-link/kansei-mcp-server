/**
 * GitHub Topics Crawler
 * Searches GitHub for repos tagged with MCP-related topics.
 */
import type { RawCandidate } from "../types.js";

const TOPICS = ["mcp-server", "model-context-protocol", "mcp"];
// Mainstream focus: only repos with real community traction.
// Brings API cost down and cuts noise (thousands of one-person experiments).
const MIN_STARS = 25;
const PER_PAGE = 100;

interface GithubSearchItem {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
  topics: string[];
  owner: { login: string };
  language: string | null;
  archived: boolean;
  fork: boolean;
}

export async function crawlGitHubTopics(options: {
  token?: string;
  sinceDays?: number;
  maxResults?: number;
} = {}): Promise<RawCandidate[]> {
  const { token = process.env.GITHUB_TOKEN, sinceDays = 90, maxResults = 300 } = options;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const sinceDate = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
  const results: RawCandidate[] = [];
  const seen = new Set<string>();

  for (const topic of TOPICS) {
    // `pushed:>=` ensures we only pick up repos that have activity in the window
    const query = `topic:${topic} pushed:>=${sinceDate} stars:>=${MIN_STARS}`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${PER_PAGE}`;

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error(`[github-topics] HTTP ${res.status} for topic=${topic}: ${await res.text()}`);
        continue;
      }
      const data = (await res.json()) as { items: GithubSearchItem[] };

      for (const item of data.items) {
        if (item.archived || item.fork) continue;
        if (seen.has(item.full_name)) continue;
        seen.add(item.full_name);

        results.push({
          source: "github-topics",
          source_url: item.html_url,
          repo_full_name: item.full_name,
          candidate_name: item.name,
          description: item.description || "",
          stars: item.stargazers_count,
          last_commit_at: item.pushed_at,
          topics: item.topics,
          language: item.language,
          owner: item.owner.login,
          raw: item,
        });

        if (results.length >= maxResults) return results;
      }
    } catch (err) {
      console.error(`[github-topics] error for topic=${topic}:`, err);
    }
  }

  return results;
}
