/**
 * LLM-based classification: assign a category + tags to each candidate.
 *
 * Uses Claude Sonnet via the Anthropic SDK. Batches up to 10 candidates per
 * request to reduce cost (one LLM call → many classifications back).
 *
 * Falls back to a heuristic (topic-matching) if ANTHROPIC_API_KEY isn't set,
 * or if the LLM call fails.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { EnrichedCandidate, ClassifiedCandidate } from "../types.js";

// Canonical categories aligned with the existing KanseiLink category taxonomy.
// Keep in sync with services-seed.json.
const CATEGORIES = [
  "AI & LLM",
  "DeFi & Web3",
  "Developer Tools",
  "Productivity",
  "Communication",
  "Data & Analytics",
  "File Storage",
  "Search & Discovery",
  "Design",
  "Finance & Accounting",
  "CRM & Sales",
  "Marketing",
  "HR & Recruiting",
  "Project Management",
  "Knowledge & Docs",
  "Media & Content",
  "Commerce",
  "Location & Travel",
  "IoT & Hardware",
  "Security",
  "Other",
];

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
const BATCH_SIZE = 8;

interface LLMBatchResult {
  [key: string]: {
    category: string;
    tags: string[];
    notes?: string;
  };
}

function heuristicClassify(c: EnrichedCandidate): { category: string; tags: string[] } {
  const text = `${c.candidate_name} ${c.description} ${c.topics.join(" ")} ${c.source_category_hint || ""}`.toLowerCase();

  const rules: Array<[string, RegExp]> = [
    ["DeFi & Web3", /\b(defi|web3|crypto|blockchain|ethereum|solana|wallet|nft|dao|uniswap|aave|chain|token)\b/],
    ["AI & LLM", /\b(llm|gpt|claude|openai|anthropic|embedding|rag|vector|prompt)\b/],
    ["Developer Tools", /\b(git|github|gitlab|ci|cd|docker|kubernetes|terraform|deploy|lint|debug|dev)\b/],
    ["Communication", /\b(slack|discord|teams|email|gmail|mail|chat|messaging)\b/],
    ["File Storage", /\b(drive|s3|dropbox|storage|files?|bucket|blob)\b/],
    ["Search & Discovery", /\b(search|discover|index|retriev|elastic|solr|find)\b/],
    ["Design", /\b(figma|sketch|design|canvas|ui|ux)\b/],
    ["Data & Analytics", /\b(analytics|bigquery|snowflake|dashboard|metrics|warehouse|etl|sql)\b/],
    ["Finance & Accounting", /\b(accounting|invoice|stripe|paypal|tax|bookkeeping|freee|moneyforward)\b/],
    ["CRM & Sales", /\b(crm|salesforce|hubspot|pipedrive|leads|sales)\b/],
    ["Project Management", /\b(jira|linear|asana|trello|monday|task|project)\b/],
    ["Knowledge & Docs", /\b(notion|confluence|docs|wiki|notebook|obsidian)\b/],
    ["Media & Content", /\b(youtube|video|podcast|image|photo|media|content)\b/],
    ["Commerce", /\b(shopify|amazon|ecommerce|cart|checkout|commerce)\b/],
    ["Location & Travel", /\b(map|location|travel|booking|flight|hotel)\b/],
    ["IoT & Hardware", /\b(iot|sensor|hardware|arduino|raspberry|device)\b/],
    ["Security", /\b(security|vuln|scan|penetration|audit|firewall)\b/],
    ["Marketing", /\b(marketing|campaign|newsletter|mailchimp|sendgrid)\b/],
    ["HR & Recruiting", /\b(hr|recruit|hiring|ats|payroll)\b/],
  ];

  for (const [cat, re] of rules) {
    if (re.test(text)) {
      // Extract up to 5 topic-like tags
      const tags = Array.from(
        new Set([
          ...(c.topics || []),
          ...(c.language ? [c.language.toLowerCase()] : []),
        ])
      ).slice(0, 5);
      return { category: cat, tags };
    }
  }
  return { category: "Other", tags: (c.topics || []).slice(0, 5) };
}

async function classifyBatchWithLLM(
  batch: EnrichedCandidate[],
  client: Anthropic
): Promise<LLMBatchResult> {
  const inputSummary = batch
    .map((c, i) => {
      const hints: string[] = [];
      if (c.source_category_hint) hints.push(`source category: ${c.source_category_hint}`);
      if (c.topics?.length) hints.push(`topics: ${c.topics.join(", ")}`);
      if (c.language) hints.push(`language: ${c.language}`);
      return [
        `[${i}] ${c.candidate_name} (${c.repo_full_name})`,
        `Description: ${c.description || "(none)"}`,
        hints.length ? `Hints: ${hints.join(" | ")}` : "",
        c.readme_excerpt ? `README excerpt: ${c.readme_excerpt.slice(0, 600)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  const categoriesText = CATEGORIES.map((c) => `  - ${c}`).join("\n");

  const prompt = `You classify MCP (Model Context Protocol) servers into categories for the KanseiLink directory.

Available categories (choose ONE, exactly as written):
${categoriesText}

For each candidate below, return a JSON object mapping its index to { category, tags, notes? }.
- category: one of the above (default "Other" if genuinely ambiguous)
- tags: 3-5 short lowercase tags describing specific capabilities (e.g. ["github", "issues", "pr-management"])
- notes: optional one-sentence justification if the classification is non-obvious

Candidates:
${inputSummary}

Respond with ONLY a JSON object, no prose. Example:
{"0": {"category": "Developer Tools", "tags": ["github", "issues"]}, "1": {...}}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in LLM response");
  }

  // Extract JSON from response (may be wrapped in ```json ... ```)
  let jsonStr = textBlock.text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  return JSON.parse(jsonStr) as LLMBatchResult;
}

export async function classifyCandidates(
  candidates: EnrichedCandidate[]
): Promise<ClassifiedCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const useLLM = Boolean(apiKey) && candidates.length > 0;

  if (!useLLM) {
    console.warn("[classify] ANTHROPIC_API_KEY not set, using heuristic classifier");
    return candidates.map((c) => {
      const h = heuristicClassify(c);
      return { ...c, proposed_category: h.category, proposed_tags: h.tags };
    });
  }

  const client = new Anthropic({ apiKey });
  const results: ClassifiedCandidate[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    try {
      const batchResult = await classifyBatchWithLLM(batch, client);
      for (let j = 0; j < batch.length; j++) {
        const llmPick = batchResult[String(j)];
        if (llmPick && CATEGORIES.includes(llmPick.category)) {
          results.push({
            ...batch[j],
            proposed_category: llmPick.category,
            proposed_tags: llmPick.tags || [],
            llm_notes: llmPick.notes,
          });
        } else {
          // fallback per-item
          const h = heuristicClassify(batch[j]);
          results.push({ ...batch[j], proposed_category: h.category, proposed_tags: h.tags });
        }
      }
    } catch (err) {
      console.error(`[classify] LLM batch failed, falling back to heuristic:`, err);
      for (const c of batch) {
        const h = heuristicClassify(c);
        results.push({ ...c, proposed_category: h.category, proposed_tags: h.tags });
      }
    }
  }

  return results;
}
