/**
 * Awesome MCP Servers List Crawler
 * Parses README.md files from the top curated MCP lists.
 *
 * Mainstream filter: we only return repos that are either
 *   (a) in the official modelcontextprotocol/servers list, OR
 *   (b) mentioned in ≥ MIN_LIST_MENTIONS separate awesome lists.
 *
 * This keeps the candidate pool focused on community-validated servers
 * instead of every random fork/experiment, cutting GitHub API cost by ~10x.
 */
import type { RawCandidate } from "../types.js";

// Format: `- [owner/repo](https://github.com/owner/repo): description`
// Also handles: `- [name](URL) 🏷️ tags: description`
const ENTRY_RE = /^-\s+\[([^\]]+)\]\(([^)]+)\)(?:[^:]*:)?\s*(.*)$/;
const GITHUB_RE = /^https?:\/\/github\.com\/([^/]+\/[^/#?]+)/i;

// "Mainstream" threshold: a repo must appear in this many awesome lists
// (not counting the official servers list) to be considered.
const MIN_LIST_MENTIONS = 2;

const SOURCES = [
  {
    id: "awesome-punkpeye",
    url: "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md",
    isOfficial: false,
  },
  {
    id: "awesome-wong2",
    url: "https://raw.githubusercontent.com/wong2/awesome-mcp-servers/main/README.md",
    isOfficial: false,
  },
  {
    id: "awesome-tensorblock",
    url: "https://raw.githubusercontent.com/TensorBlock/awesome-mcp-servers/main/README.md",
    isOfficial: false,
  },
  {
    id: "mcp-official-servers",
    url: "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md",
    isOfficial: true,
  },
];

interface RawEntry {
  sourceId: string;
  isOfficial: boolean;
  repoFullName: string;
  label: string;
  description: string;
  categoryHint: string;
  rawLine: string;
}

async function fetchSourceEntries(
  src: (typeof SOURCES)[number]
): Promise<RawEntry[]> {
  const out: RawEntry[] = [];
  try {
    const res = await fetch(src.url, {
      headers: { "User-Agent": "KanseiLink-Crawler/1.0" },
    });
    if (!res.ok) {
      console.error(`[awesome-lists] ${src.id} HTTP ${res.status}`);
      return out;
    }
    const md = await res.text();
    const lines = md.split("\n");

    let currentCategory = "";
    const seenInSource = new Set<string>();
    for (const line of lines) {
      const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
      if (headingMatch) {
        currentCategory = headingMatch[1].replace(/[^\w\s&,/-]/g, "").trim();
        continue;
      }

      const match = line.match(ENTRY_RE);
      if (!match) continue;

      const [, labelRaw, urlRaw, descRaw] = match;
      const url = urlRaw.trim();
      const ghMatch = url.match(GITHUB_RE);
      if (!ghMatch) continue;

      const repoFullName = ghMatch[1].replace(/\.git$/, "").toLowerCase();
      if (seenInSource.has(repoFullName)) continue;
      seenInSource.add(repoFullName);

      out.push({
        sourceId: src.id,
        isOfficial: src.isOfficial,
        repoFullName,
        label: labelRaw.trim(),
        description: descRaw.trim(),
        categoryHint: currentCategory,
        rawLine: line,
      });
    }
  } catch (err) {
    console.error(`[awesome-lists] error for ${src.id}:`, err);
  }
  return out;
}

export async function crawlAwesomeLists(): Promise<RawCandidate[]> {
  // Pull every source in parallel
  const allBuckets = await Promise.all(SOURCES.map(fetchSourceEntries));
  const allEntries = allBuckets.flat();

  // Aggregate per repo: how many lists it appears in, whether official, etc.
  interface Agg {
    repoFullName: string;
    firstEntry: RawEntry;
    listMentions: Set<string>;
    inOfficial: boolean;
  }
  const byRepo = new Map<string, Agg>();
  for (const e of allEntries) {
    const cur = byRepo.get(e.repoFullName);
    if (cur) {
      cur.listMentions.add(e.sourceId);
      if (e.isOfficial) cur.inOfficial = true;
    } else {
      byRepo.set(e.repoFullName, {
        repoFullName: e.repoFullName,
        firstEntry: e,
        listMentions: new Set([e.sourceId]),
        inOfficial: e.isOfficial,
      });
    }
  }

  // Mainstream filter
  const kept: Agg[] = [];
  for (const agg of byRepo.values()) {
    const nonOfficialMentions = [...agg.listMentions].filter(
      (s) => s !== "mcp-official-servers"
    ).length;
    if (agg.inOfficial || nonOfficialMentions >= MIN_LIST_MENTIONS) {
      kept.push(agg);
    }
  }

  console.log(
    `[awesome-lists] total entries: ${allEntries.length}, unique repos: ${byRepo.size}, mainstream-filtered: ${kept.length}`
  );

  return kept.map((agg) => {
    const e = agg.firstEntry;
    // Prefer the official-list entry if present (better categorization)
    return {
      source: agg.inOfficial ? "mcp-official-servers" : e.sourceId,
      source_url: `https://github.com/${agg.repoFullName}`,
      repo_full_name: agg.repoFullName,
      candidate_name: e.label,
      description: e.description,
      stars: 0, // enriched later
      last_commit_at: null,
      topics: [],
      language: null,
      owner: agg.repoFullName.split("/")[0],
      source_category_hint: e.categoryHint,
      raw: {
        line: e.rawLine,
        category: e.categoryHint,
        label: e.label,
        list_mentions: [...agg.listMentions],
        in_official: agg.inOfficial,
      },
    };
  });
}
