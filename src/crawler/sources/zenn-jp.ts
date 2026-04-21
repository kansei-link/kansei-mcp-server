/**
 * Zenn JP source — poll Zenn's public article API for recent posts
 * tagged with `mcp` (or related JP tags), extract any GitHub repo
 * links from the article body, and emit them as RawCandidates.
 *
 * Why: Japanese SaaS vendors (Dify Japan, freee, SmartHR, etc.) often
 * announce MCP support on Zenn before — or instead of — registering in
 * the global MCP Registry. Polling Zenn closes the JP discovery gap.
 *
 * Zenn API endpoint used:
 *   https://zenn.dev/api/articles?topicname=<tag>&order=latest
 * This is a public, unauthenticated JSON API. Rate limit is generous
 * (no documented limit, but we keep it conservative).
 *
 * Failure mode: if Zenn API or any individual article fetch fails, the
 * caller keeps whatever candidates we successfully extracted. Never
 * throws — falls back to empty array + console warning.
 */
import type { RawCandidate } from "../types.js";

interface ZennArticle {
  id: number;
  slug: string;
  title: string;
  path: string; // e.g. "/michie/articles/linksee-memory"
  published_at: string;
  body_updated_at?: string;
  user?: { username?: string };
  topics?: Array<{ name: string; display_name?: string }>;
}

// Tags polled on every run. Each polls independently; dedupe happens
// in the caller via dedupe.ts against candidates already in the DB.
const TAGS = ["mcp", "modelcontextprotocol", "claude"];

// How many pages to pull per tag. Zenn returns ~20 articles per page.
// 2 pages × 3 tags = 120 articles max per run — plenty of headroom.
const PAGES_PER_TAG = 2;

// Conservative cutoff — ignore articles older than this to keep the
// source focused on fresh JP MCP announcements. The daily crawl plus
// dedupe handles anything we missed the first time.
const MAX_AGE_DAYS = 90;

// Match bare GitHub URLs in article bodies. Intentionally loose —
// we normalize and validate downstream. Excludes blob/tree/issues URLs
// so we only pick up repo roots.
const GITHUB_REPO_RE =
  /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?=[\s)"'`<]|\/tree|\/blob|\/issues|\/pull|$)/g;

// Filter obviously-irrelevant repos — MCP SDK docs, Anthropic examples,
// etc. These would all get dropped by score.ts later, but skipping them
// here avoids burning GitHub API quota on enrich.
const SKIP_OWNERS = new Set([
  "modelcontextprotocol",
  "anthropics",
  "anthropic",
]);

async function fetchArticlesForTag(tag: string, page: number): Promise<ZennArticle[]> {
  const url = `https://zenn.dev/api/articles?topicname=${encodeURIComponent(tag)}&order=latest&page=${page}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "kansei-link-crawler/1.0 (+https://kansei-link.com)" },
    });
    if (!res.ok) {
      console.warn(`[zenn-jp] ${url} returned ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { articles?: ZennArticle[] };
    return json.articles ?? [];
  } catch (err: any) {
    console.warn(`[zenn-jp] fetch failed for tag="${tag}" page=${page}: ${err.message}`);
    return [];
  }
}

async function fetchArticleBody(articlePath: string): Promise<string> {
  // Zenn doesn't expose body via the index endpoint — fetch the article
  // HTML and grep for github.com links. The rendered HTML contains all
  // body content as regular text, so simple regex works.
  const url = `https://zenn.dev${articlePath}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "kansei-link-crawler/1.0 (+https://kansei-link.com)" },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function extractReposFromText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(GITHUB_REPO_RE)) {
    const owner = match[1];
    const name = (match[2] || "").replace(/\.git$/, "");
    if (!owner || !name) continue;
    if (SKIP_OWNERS.has(owner.toLowerCase())) continue;
    // Reject obvious non-repo paths (shouldn't match the regex anyway,
    // but belt and braces).
    if (["blog", "marketplace", "sponsors", "about"].includes(owner.toLowerCase())) continue;
    found.add(`${owner}/${name}`);
  }
  return Array.from(found);
}

export async function crawlZennJp(): Promise<RawCandidate[]> {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400_000;

  // Step 1: collect recent articles for each tag.
  const articleJobs: Array<Promise<ZennArticle[]>> = [];
  for (const tag of TAGS) {
    for (let page = 1; page <= PAGES_PER_TAG; page++) {
      articleJobs.push(fetchArticlesForTag(tag, page));
    }
  }
  const articleBatches = await Promise.all(articleJobs);
  const allArticles = articleBatches.flat();

  // Dedupe by article path (the same article can appear under multiple tags).
  const seenPaths = new Set<string>();
  const freshArticles = allArticles.filter((a) => {
    if (seenPaths.has(a.path)) return false;
    seenPaths.add(a.path);
    const published = Date.parse(a.published_at);
    return Number.isFinite(published) && published >= cutoff;
  });

  console.log(
    `[zenn-jp] found ${freshArticles.length} recent articles across ${TAGS.length} tags`
  );

  // Step 2: fetch each article body and extract GitHub repo links.
  // Parallel-but-capped to 5 to stay polite to Zenn.
  const results = new Map<string, RawCandidate>();
  const CONCURRENCY = 5;
  for (let i = 0; i < freshArticles.length; i += CONCURRENCY) {
    const batch = freshArticles.slice(i, i + CONCURRENCY);
    const bodies = await Promise.all(
      batch.map((a) => fetchArticleBody(a.path).then((body) => ({ article: a, body })))
    );
    for (const { article, body } of bodies) {
      const repos = extractReposFromText(body);
      for (const repo of repos) {
        if (results.has(repo)) continue;
        const [owner, name] = repo.split("/");
        results.set(repo, {
          source: "zenn-jp",
          source_url: `https://zenn.dev${article.path}`,
          repo_full_name: repo,
          candidate_name: name,
          description: "",
          stars: 0,
          last_commit_at: null,
          topics: [],
          language: null,
          owner,
          // Give the scorer a hint that this is JP-context — biases
          // triage so a brand-new low-star JP vendor drop still makes
          // it into the review queue.
          source_category_hint: "zenn-jp",
          raw: {
            source: "zenn-jp",
            article_path: article.path,
            article_title: article.title,
          },
        });
      }
    }
  }

  console.log(`[zenn-jp] extracted ${results.size} unique candidate repos`);
  return Array.from(results.values());
}
