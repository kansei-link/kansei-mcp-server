/**
 * JP Watchlist source — manually curated list of Japanese SaaS MCP
 * repos spotted via X / PR TIMES / direct vendor announcement.
 *
 * Reads src/data/jp-watchlist.txt (or dist/data/jp-watchlist.txt in
 * production) and converts each `owner/repo` line into a RawCandidate
 * that flows through the same dedupe → enrich → classify → score
 * pipeline as the other sources.
 *
 * The actual stars / description / last-commit / topics are populated
 * later by enrich.ts (GitHub API). We only provide the repo handle here.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawCandidate } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function locateWatchlist(): string | null {
  // dev: src/data/jp-watchlist.txt ; prod: dist/data/jp-watchlist.txt
  const candidates = [
    path.join(__dirname, "..", "..", "..", "src", "data", "jp-watchlist.txt"),
    path.join(__dirname, "..", "..", "data", "jp-watchlist.txt"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Parse `owner/repo # optional comment` line, returning normalized repo. */
function parseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  // Strip inline comment if present
  const hashIdx = trimmed.indexOf("#");
  const repoPart = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx).trim();
  // Accept `owner/repo` — reject anything else (URLs, free text, etc.)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoPart)) return null;
  return repoPart;
}

export async function crawlJpWatchlist(): Promise<RawCandidate[]> {
  const watchlistPath = locateWatchlist();
  if (!watchlistPath) {
    console.log("[jp-watchlist] no jp-watchlist.txt found, skipping");
    return [];
  }

  const raw = readFileSync(watchlistPath, "utf-8");
  const repos = raw
    .split(/\r?\n/)
    .map(parseLine)
    .filter((x): x is string => x !== null);

  if (repos.length === 0) {
    console.log("[jp-watchlist] watchlist is empty");
    return [];
  }

  console.log(`[jp-watchlist] loaded ${repos.length} hand-curated candidates`);

  // Emit minimal RawCandidate entries — enrich.ts fills in stars,
  // description, last_commit, topics, language, readme via GitHub API.
  return repos.map<RawCandidate>((repo) => {
    const [owner, name] = repo.split("/");
    return {
      source: "jp-watchlist",
      source_url: `https://github.com/${repo}`,
      repo_full_name: repo,
      candidate_name: name,
      description: "",
      stars: 0,
      last_commit_at: null,
      topics: [],
      language: null,
      owner,
      // Signal to the classifier that this was hand-picked as Japanese SaaS —
      // biases the triage toward "review" rather than auto-reject on low
      // stars (a brand-new JP vendor release often has <25 stars on day 1).
      source_category_hint: "jp-saas-watchlist",
      raw: { source: "jp-watchlist", repo },
    };
  });
}
