/**
 * GitHub JP Orgs source — monitor known Japanese SaaS vendor GitHub
 * orgs for any repo whose name or description contains MCP-related
 * keywords.
 *
 * Why: vendors like freee, Cybozu, SmartHR rarely tag their repos
 * with `mcp-server` topic even when the repo IS an MCP server. Direct
 * org search using GitHub's code-scoped API catches these without
 * relying on topic metadata.
 *
 * Uses GitHub Search API: `org:<org>+mcp` on repos endpoint.
 * If GITHUB_TOKEN is set, quota is 30 req/min (5000/hour) — plenty.
 * Without a token we'd hit 10 req/min which is still enough for
 * the small org list below.
 *
 * NOTE: this doubles as a "watchlist of companies Michie cares about".
 * Add to JP_ORGS as new relevant vendors appear.
 */
import type { RawCandidate } from "../types.js";

// Japanese SaaS vendor GitHub orgs to monitor. Keep this list short
// and well-curated — every org adds 1 API call per daily crawl.
// Ordered by perceived likelihood of shipping MCPs.
const JP_ORGS = [
  "freee",
  "cybozu", // kintone, Garoon
  "smarthr",
  "moneyforward",
  "Sansan-inc",
  "chatwork",
  "nulab", // Backlog, Cacoo
  "pixiv",
  "mercari",
  "line", // LINE Corp — also watch line-developer-community
  "rakuten",
  "rakuten-tech",
  "yahoojapan",
  "dena",
  "gmo-pg", // GMO Payment Gateway
  "kddi",
  "DifyJapan",
  "treasure-data",
  "LayerXcom",
  "ZOZO-Technologies",
];

interface GitHubSearchItem {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  language: string | null;
  topics?: string[];
  html_url: string;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchItem[];
}

async function searchOrg(org: string, headers: Record<string, string>): Promise<GitHubSearchItem[]> {
  // Query: in the given org, repos whose name/description match `mcp`.
  // `in:name,description` ensures we're not just keyword-matching README.
  const q = `org:${org} mcp in:name,description`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=20`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status !== 422) {
        // 422 = org doesn't exist / no matches, silently skip
        console.warn(`[github-jp-orgs] ${org}: ${res.status} ${res.statusText}`);
      }
      return [];
    }
    const json = (await res.json()) as GitHubSearchResponse;
    return json.items ?? [];
  } catch (err: any) {
    console.warn(`[github-jp-orgs] ${org} fetch failed: ${err.message}`);
    return [];
  }
}

export async function crawlGitHubJpOrgs(): Promise<RawCandidate[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "kansei-link-crawler/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Sequential with a tiny gap to respect secondary rate limits.
  // GitHub Search API has a burst limit even with auth.
  const results: RawCandidate[] = [];
  for (const org of JP_ORGS) {
    const items = await searchOrg(org, headers);
    for (const it of items) {
      results.push({
        source: "github-jp-orgs",
        source_url: it.html_url,
        repo_full_name: it.full_name,
        candidate_name: it.name,
        description: it.description ?? "",
        stars: it.stargazers_count,
        last_commit_at: it.pushed_at,
        topics: it.topics ?? [],
        language: it.language,
        owner: it.owner.login,
        source_category_hint: "jp-saas-org",
        raw: { source: "github-jp-orgs", org, item: it },
      });
    }
    // 300ms between orgs — 20 orgs × 300ms = ~6s total, well under any limit.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(
    `[github-jp-orgs] scanned ${JP_ORGS.length} JP vendor orgs, found ${results.length} MCP-looking repos`
  );
  return results;
}
