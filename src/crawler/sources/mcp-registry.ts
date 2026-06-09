/**
 * Official MCP Registry Crawler — Angle ①
 *
 * Pulls structured server data from registry.modelcontextprotocol.io
 * and enriches KanseiLINK's service database.
 *
 * Data: name, description, remote endpoints, repo URL, version, status
 * Quality: claimed (registry metadata, not tested)
 */

export interface RegistryServer {
  /** Registry name (e.g., "ac.inference.sh/mcp") */
  name: string;
  /** Display name */
  title: string | null;
  /** Description */
  description: string;
  /** Version string */
  version: string;
  /** Remote connection endpoints */
  remotes: Array<{ type: string; url: string }>;
  /** GitHub repository URL */
  repo_url: string | null;
  /** Active or inactive */
  status: "active" | "inactive" | "unknown";
  /** Publication date */
  published_at: string | null;
  /** Last updated */
  updated_at: string | null;
}

interface RegistryApiResponse {
  servers: Array<{
    server: {
      name: string;
      title?: string;
      description?: string;
      version?: string;
      remotes?: Array<{ type: string; url: string }>;
      repository?: { url: string; source?: string };
      websiteUrl?: string;
    };
    _meta?: {
      "io.modelcontextprotocol.registry/official"?: {
        status?: string;
        publishedAt?: string;
        updatedAt?: string;
        isLatest?: boolean;
      };
    };
  }>;
  metadata?: {
    nextCursor?: string;
    count?: number;
  };
}

export async function crawlMcpRegistry(options: {
  /** Max servers to fetch (default: 10000) */
  maxResults?: number;
  /** Only include isLatest versions */
  latestOnly?: boolean;
  /** Progress callback */
  onProgress?: (fetched: number, cursor: string | null) => void;
} = {}): Promise<RegistryServer[]> {
  const { maxResults = 10000, latestOnly = true, onProgress } = options;
  const results: RegistryServer[] = [];
  const seen = new Set<string>(); // dedup by name (keep latest version)

  let cursor: string | null = null;
  const PAGE_SIZE = 100;

  while (results.length < maxResults) {
    const url = new URL("https://registry.modelcontextprotocol.io/v0/servers");
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);

    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        console.error(`[mcp-registry] HTTP ${res.status}: ${await res.text()}`);
        break;
      }

      const data = (await res.json()) as RegistryApiResponse;
      if (!data.servers || data.servers.length === 0) break;

      for (const entry of data.servers) {
        const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];
        const isLatest = meta?.isLatest ?? true;

        // Skip non-latest if requested
        if (latestOnly && !isLatest) continue;

        const name = entry.server.name;
        if (seen.has(name)) continue;
        seen.add(name);

        results.push({
          name,
          title: entry.server.title || null,
          description: entry.server.description || "",
          version: entry.server.version || "unknown",
          remotes: entry.server.remotes || [],
          repo_url: entry.server.repository?.url || null,
          status: (meta?.status as "active" | "inactive") || "unknown",
          published_at: meta?.publishedAt || null,
          updated_at: meta?.updatedAt || null,
        });

        if (results.length >= maxResults) break;
      }

      cursor = data.metadata?.nextCursor || null;
      if (onProgress) onProgress(results.length, cursor);

      if (!cursor) break; // No more pages
    } catch (err) {
      console.error(`[mcp-registry] Fetch error at cursor=${cursor}:`, err);
      break;
    }
  }

  return results;
}

// ── Derive a KanseiLINK-compatible service_id from registry name ──
export function registryNameToServiceId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Map registry transport type to MCP status ─────────────────────
export function inferMcpStatus(
  remotes: Array<{ type: string; url: string }>,
  repoUrl: string | null
): "official" | "community" | "unknown" {
  // If it has a streamable-http remote, it's a hosted server
  if (remotes.some((r) => r.type === "streamable-http" || r.type === "sse")) {
    return "official";
  }
  // If it has a repo but no remote, likely needs local setup
  if (repoUrl) return "community";
  return "unknown";
}

// ── Categorize by description keywords ────────────────────────────
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(slack|discord|teams|chat|messaging|email)\b/i, category: "communication" },
  { pattern: /\b(notion|confluence|wiki|docs?|knowledge)\b/i, category: "groupware" },
  { pattern: /\b(jira|linear|asana|project|task|issue|backlog)\b/i, category: "project_management" },
  { pattern: /\b(github|gitlab|bitbucket|git|ci\/cd|deploy)\b/i, category: "developer_tools" },
  { pattern: /\b(postgres|mysql|sqlite|mongo|redis|supabase|database|sql)\b/i, category: "database" },
  { pattern: /\b(stripe|payment|billing|invoice)\b/i, category: "payment" },
  { pattern: /\b(salesforce|hubspot|crm|lead|customer)\b/i, category: "crm" },
  { pattern: /\b(aws|azure|gcp|cloud|s3|lambda)\b/i, category: "devops" },
  { pattern: /\b(shopify|e-?commerce|store|product|cart)\b/i, category: "ecommerce" },
  { pattern: /\b(accounting|freee|money\s*forward|tax|bookkeep)\b/i, category: "accounting" },
  { pattern: /\b(hr|employee|payroll|recruit|smarthr)\b/i, category: "hr" },
  { pattern: /\b(search|scrape|crawl|fetch|browse)\b/i, category: "data_integration" },
  { pattern: /\b(image|design|figma|canvas|art)\b/i, category: "design" },
  { pattern: /\b(security|auth|identity|sso|oauth)\b/i, category: "security" },
  { pattern: /\b(analytic|dashboard|bi|report|metric)\b/i, category: "bi_analytics" },
  { pattern: /\b(storage|file|drive|s3|upload|blob)\b/i, category: "storage" },
  { pattern: /\b(ai|llm|model|ml|gen\s*ai|openai|anthropic)\b/i, category: "ai_ml" },
];

export function inferCategory(description: string, name: string): string {
  const text = `${name} ${description}`;
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return "developer_tools"; // default
}

// ── Summary stats ─────────────────────────────────────────────────
export function summarizeRegistry(servers: RegistryServer[]): {
  total: number;
  active: number;
  inactive: number;
  withRemote: number;
  withRepo: number;
  transportTypes: Record<string, number>;
} {
  const transportTypes: Record<string, number> = {};
  let active = 0;
  let inactive = 0;
  let withRemote = 0;
  let withRepo = 0;

  for (const s of servers) {
    if (s.status === "active") active++;
    else if (s.status === "inactive") inactive++;
    if (s.remotes.length > 0) withRemote++;
    if (s.repo_url) withRepo++;
    for (const r of s.remotes) {
      transportTypes[r.type] = (transportTypes[r.type] || 0) + 1;
    }
  }

  return { total: servers.length, active, inactive, withRemote, withRepo, transportTypes };
}
