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
