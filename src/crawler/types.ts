/**
 * Shared types for the MCP crawler.
 */

export interface RawCandidate {
  source: string;
  source_url: string;
  repo_full_name: string;
  candidate_name: string;
  description: string;
  stars: number;
  last_commit_at: string | null;
  topics: string[];
  language: string | null;
  owner: string;
  source_category_hint?: string;
  readme_excerpt?: string;
  raw: unknown;
}

export interface EnrichedCandidate extends RawCandidate {
  readme_excerpt: string;
  has_readme: boolean;
  has_license: boolean;
}

export interface ClassifiedCandidate extends EnrichedCandidate {
  proposed_category: string;
  proposed_tags: string[];
  llm_notes?: string;
}

export interface ScoredCandidate extends ClassifiedCandidate {
  trust_score: number;
  tier: "auto-accept" | "review" | "reject";
  reject_reason?: string;
}

export type Tier = "auto-accept" | "review" | "reject";

// ── Issue Mining (angle ②) ────────────────────────────────────
// Structured finding from a GitHub Issue on an MCP server repo.
// Feeds into agent_tips (known_blockers / proven_fixes).

export interface IssueFinding {
  /** GitHub issue number */
  issue_number: number;
  /** Source repo (e.g. "modelcontextprotocol/servers") */
  repo: string;
  /** Issue title */
  title: string;
  /** Mapped KanseiLINK service_id (null if unmappable) */
  service_id: string | null;
  /** Categorised error type */
  error_type: "auth" | "schema" | "connection" | "runtime" | "config" | "performance" | "breaking_change" | "other";
  /** Severity estimate */
  severity: "critical" | "major" | "minor";
  /** One-line summary of the problem */
  problem_summary: string;
  /** Workaround if found in issue body or comments */
  workaround: string | null;
  /** Whether the issue is resolved */
  resolved: boolean;
  /** Labels from GitHub */
  labels: string[];
  /** Issue state (open/closed) */
  state: "open" | "closed";
  /** When created */
  created_at: string;
  /** When last updated */
  updated_at: string;
  /** Number of comments (proxy for severity/interest) */
  comment_count: number;
  /** Direct link */
  url: string;
  /** Confidence of the mapping (auto-classification accuracy) */
  confidence: "high" | "medium" | "low";
}
