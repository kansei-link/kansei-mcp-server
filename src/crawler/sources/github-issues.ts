/**
 * GitHub Issues Miner — Angle ②
 *
 * Pulls bug/error issues from major MCP server repos and converts them
 * into structured IssueFinding objects for KanseiLINK ingestion.
 *
 * Data quality: semi-confirmed (real user reports, not our own testing)
 */
import type { IssueFinding } from "../types.js";

// ── Target repos and their KanseiLINK service_id mapping ──────────
interface RepoTarget {
  repo: string;
  /** Direct mapping to a KanseiLINK service_id, or null if the repo covers multiple services (monorepo) */
  service_id: string | null;
  /** For monorepos: map issue title/label patterns → service_id */
  service_patterns?: Array<{ pattern: RegExp; service_id: string }>;
}

const TARGETS: RepoTarget[] = [
  {
    repo: "modelcontextprotocol/servers",
    service_id: null, // monorepo — each issue maps to a different server
    service_patterns: [
      { pattern: /\bslack\b/i, service_id: "slack" },
      { pattern: /\bgithub[\s_-]?(?:mcp|server|api)\b/i, service_id: "github-github-mcp-server" },
      { pattern: /\bgoogle[\s-]?drive\b/i, service_id: "google-drive" },
      { pattern: /\bgoogle[\s-]?maps\b/i, service_id: "google-maps" },
      { pattern: /\bpostgres/i, service_id: "postgresql-mcp" },
      { pattern: /\bsqlite\b/i, service_id: "sqlite" },
      { pattern: /\bmemory\b/i, service_id: "mcp-memory" },
      { pattern: /\bfetch\b/i, service_id: "mcp-fetch" },
      { pattern: /\bfilesystem\b/i, service_id: "mcp-filesystem" },
      { pattern: /\bpuppeteer\b/i, service_id: "mcp-puppeteer" },
      { pattern: /\bbrave[\s-]?search\b/i, service_id: "brave-search" },
      { pattern: /\beverything\b/i, service_id: "mcp-everything" },
      { pattern: /\bgit\b(?!hub)/i, service_id: "mcp-git" },
      { pattern: /\bsentry\b/i, service_id: "sentry" },
      { pattern: /\bredis\b/i, service_id: "redis" },
    ],
  },
  { repo: "github/github-mcp-server", service_id: "github-github-mcp-server" },
  { repo: "makenotion/notion-mcp-server", service_id: "notion" },
  { repo: "atlassian/atlassian-mcp-server", service_id: "atlassian-atlassian-mcp-server" },
  { repo: "korotovsky/slack-mcp-server", service_id: "slack" },
  { repo: "jerhadf/linear-mcp-server", service_id: "linear" },
];

// ── Error type classification ─────────────────────────────────────
const ERROR_TYPE_PATTERNS: Array<{ pattern: RegExp; type: IssueFinding["error_type"] }> = [
  { pattern: /\bauth(entication|orization)?\b|\bOAuth\b|\b401\b|\b403\b|\btoken\b|\bcredential/i, type: "auth" },
  { pattern: /\bschema\b|\bvalidat(ion|e)\b|\bjson[\s-]?rpc\b|\b-32\d{3}\b|\btype[\s-]?error/i, type: "schema" },
  { pattern: /\bconnect(ion)?\b|\btimeout\b|\bENOENT\b|\bspawn\b|\bhandshake\b|\bECONN/i, type: "connection" },
  { pattern: /\bcrash\b|\bsegfault\b|\bpanic\b|\bunhandled\b|\brace[\s-]?cond/i, type: "runtime" },
  { pattern: /\bconfig(uration)?\b|\benv(ironment)?\b|\bsetup\b|\binstall\b|\bpath\b/i, type: "config" },
  { pattern: /\bslow\b|\bperformance\b|\brate[\s-]?limit\b|\b429\b|\bmemory[\s-]?leak/i, type: "performance" },
  { pattern: /\bbreaking\b|\bdeprecated?\b|\bmigrat(e|ion)\b|\bupgrade\b|\bremoved?\b/i, type: "breaking_change" },
];

function classifyErrorType(title: string, body: string): IssueFinding["error_type"] {
  const text = `${title} ${body}`.slice(0, 3000);
  for (const { pattern, type } of ERROR_TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "other";
}

// ── Severity estimation ───────────────────────────────────────────
function estimateSeverity(
  labels: string[],
  commentCount: number,
  title: string,
  body: string
): IssueFinding["severity"] {
  const text = `${title} ${body}`.toLowerCase();
  const labelStr = labels.join(" ").toLowerCase();
  if (
    labelStr.includes("critical") || labelStr.includes("p0") ||
    text.includes("data loss") || text.includes("security") ||
    text.includes("crash") || commentCount >= 20
  ) return "critical";
  if (
    labelStr.includes("bug") || labelStr.includes("p1") ||
    commentCount >= 5 || text.includes("broken") || text.includes("fail")
  ) return "major";
  return "minor";
}

// ── Workaround extraction ─────────────────────────────────────────
const WORKAROUND_SIGNALS = [
  /workaround[:\s]/i,
  /(?:fix|solution|resolve)[:\s].*(?:by|using|with)/i,
  /(?:I|we)\s+(?:fixed|solved|resolved)\s+(?:this|it)\s+by/i,
  /(?:try|use|switch(?:ing)?)\s+(?:to|using)/i,
  /(?:downgrad|upgrad|pin(?:ning)?)\s+(?:to|the)/i,
  /fixed\s+(?:in|via|by)\s+(?:#\d+|v?\d+\.\d+|commit|pr\b|pull)/i,
  /(?:this|the)\s+(?:issue|bug|problem)\s+(?:is|was)\s+(?:fixed|resolved|addressed)/i,
  /set\s+(?:the\s+)?(?:env|environment|variable|config)/i,
];

function extractWorkaround(body: string, comments: string[]): string | null {
  const allText = [body, ...comments];
  for (const text of allText) {
    for (const signal of WORKAROUND_SIGNALS) {
      const match = text.match(signal);
      if (match && match.index != null) {
        // Extract ~200 chars around the workaround signal
        const start = Math.max(0, match.index - 20);
        const end = Math.min(text.length, match.index + 200);
        return text.slice(start, end).replace(/\n/g, " ").trim();
      }
    }
  }
  return null;
}

// ── Service ID resolution for monorepo issues ─────────────────────
function resolveServiceId(target: RepoTarget, title: string, body: string, labels: string[]): string | null {
  if (target.service_id) return target.service_id;
  if (!target.service_patterns) return null;

  const text = `${title} ${body} ${labels.join(" ")}`;
  for (const { pattern, service_id } of target.service_patterns) {
    if (pattern.test(text)) return service_id;
  }
  return null;
}

// ── GitHub API types ──────────────────────────────────────────────
interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  pull_request?: unknown; // present if it's a PR, not an issue
}

interface GitHubComment {
  body: string;
}

// ── Main crawler ──────────────────────────────────────────────────
export async function crawlGitHubIssues(options: {
  token?: string;
  /** Only fetch issues updated since this many days ago */
  sinceDays?: number;
  /** Max issues per repo */
  perRepo?: number;
  /** Which repos to target (defaults to TARGETS) */
  repos?: RepoTarget[];
  /** Fetch comment bodies (slower but gets workarounds) */
  fetchComments?: boolean;
} = {}): Promise<IssueFinding[]> {
  const {
    token = process.env.GITHUB_TOKEN,
    sinceDays = 180,
    perRepo = 100,
    repos = TARGETS,
    fetchComments = true,
  } = options;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const sinceDate = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const findings: IssueFinding[] = [];
  const seen = new Set<string>(); // dedup by "repo#issue_number"

  for (const target of repos) {
    console.error(`[github-issues] Fetching issues from ${target.repo}...`);

    let page = 1;
    let fetched = 0;

    while (fetched < perRepo) {
      const url = new URL(`https://api.github.com/repos/${target.repo}/issues`);
      url.searchParams.set("state", "all");
      url.searchParams.set("since", sinceDate);
      url.searchParams.set("per_page", String(Math.min(100, perRepo - fetched)));
      url.searchParams.set("page", String(page));
      url.searchParams.set("sort", "updated");
      url.searchParams.set("direction", "desc");

      try {
        const res = await fetch(url.toString(), { headers });
        if (!res.ok) {
          console.error(`[github-issues] HTTP ${res.status} for ${target.repo}: ${await res.text()}`);
          break;
        }

        const issues = (await res.json()) as GitHubIssue[];
        if (issues.length === 0) break;

        for (const issue of issues) {
          // Skip pull requests (GitHub Issues API returns both)
          if (issue.pull_request) continue;

          // Dedup: same issue can appear across pagination
          const key = `${target.repo}#${issue.number}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const labels = issue.labels.map((l) => l.name);
          const body = issue.body || "";

          // Fetch top comments if enabled (for workaround extraction)
          let commentBodies: string[] = [];
          if (fetchComments && issue.comments > 0 && issue.comments <= 30) {
            try {
              const cRes = await fetch(
                `https://api.github.com/repos/${target.repo}/issues/${issue.number}/comments?per_page=10`,
                { headers }
              );
              if (cRes.ok) {
                const comments = (await cRes.json()) as GitHubComment[];
                commentBodies = comments.map((c) => c.body || "");
              }
            } catch {
              // Non-fatal: skip comments
            }
          }

          const serviceId = resolveServiceId(target, issue.title, body, labels);
          const errorType = classifyErrorType(issue.title, body);
          const severity = estimateSeverity(labels, issue.comments, issue.title, body);
          const workaround = extractWorkaround(body, commentBodies);

          // Build problem summary: title + first line of body that seems relevant
          const bodyFirstLine = body.split("\n").find((l) => l.trim().length > 20)?.trim() || "";
          const problemSummary = bodyFirstLine.length > 10
            ? `${issue.title} — ${bodyFirstLine.slice(0, 150)}`
            : issue.title;

          // Confidence: high if service_id is direct (single-service repo),
          // medium if pattern-matched, low if unmappable
          const confidence: IssueFinding["confidence"] =
            target.service_id ? "high"
            : serviceId ? "medium"
            : "low";

          findings.push({
            issue_number: issue.number,
            repo: target.repo,
            title: issue.title,
            service_id: serviceId,
            error_type: errorType,
            severity,
            problem_summary: problemSummary.slice(0, 500),
            workaround,
            resolved: issue.state === "closed",
            labels,
            state: issue.state,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            comment_count: issue.comments,
            url: issue.html_url,
            confidence,
          });

          fetched++;
        }

        page++;
      } catch (err) {
        console.error(`[github-issues] Error fetching ${target.repo} page ${page}:`, err);
        break;
      }
    }

    console.error(`[github-issues] ${target.repo}: ${fetched} issues processed`);
  }

  return findings;
}

// ── Stats helper ──────────────────────────────────────────────────
export function summarizeFindings(findings: IssueFinding[]): {
  total: number;
  byRepo: Record<string, number>;
  byErrorType: Record<string, number>;
  bySeverity: Record<string, number>;
  mapped: number;
  unmapped: number;
  withWorkaround: number;
} {
  const byRepo: Record<string, number> = {};
  const byErrorType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let mapped = 0;
  let unmapped = 0;
  let withWorkaround = 0;

  for (const f of findings) {
    byRepo[f.repo] = (byRepo[f.repo] || 0) + 1;
    byErrorType[f.error_type] = (byErrorType[f.error_type] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    if (f.service_id) mapped++; else unmapped++;
    if (f.workaround) withWorkaround++;
  }

  return { total: findings.length, byRepo, byErrorType, bySeverity, mapped, unmapped, withWorkaround };
}
