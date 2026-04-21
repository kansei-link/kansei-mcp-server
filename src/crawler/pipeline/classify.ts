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

// --- Deterministic refinement layer (runs AFTER LLM classification) -------
// The LLM often lazily buckets anything MCP-adjacent into "AI & LLM" even
// when the service itself is unrelated to AI (e.g. cloud platforms, hotel
// booking sites). These brand/keyword rules override common mistake patterns.
// Rules fire only when the name/description clearly identifies the category.
const REFINE_RULES: Array<{ category: string; pattern: RegExp }> = [
  // Cloud providers & DevOps infra → Developer Tools (NOT AI & LLM)
  {
    category: "Developer Tools",
    pattern:
      /\b(aws|amazon[ -]?web[ -]?services|gcp|google[ -]?cloud|azure|microsoft[ -]?azure|aliyun|alibaba[ -]?cloud|tencent[ -]?cloud|oracle[ -]?cloud|digitalocean|linode|vultr|hetzner|cloudflare|vercel|netlify|fly\.io|heroku|render|railway|kubernetes|k8s|docker|helm|terraform|pulumi|ansible|jenkins|circleci|github[ -]?actions|gitlab[ -]?ci|buildkite|argocd|flux|nomad|consul|vault|datadog|new[ -]?relic|sentry|grafana|prometheus|honeycomb|pagerduty|opsgenie|cloudops|devops)\b/i,
  },
  // Databases & data stores → Data & Analytics
  {
    category: "Data & Analytics",
    pattern:
      /\b(mysql|postgres|postgresql|mongodb|redis|sqlite|clickhouse|dynamodb|elasticsearch|opensearch|cassandra|scylla|neo4j|tidb|cockroachdb|influxdb|timescaledb|snowflake|bigquery|databricks|redshift|duckdb|supabase|planetscale|neon|fivetran|airbyte|dbt|\bdms\b|data[ -]?warehouse|data[ -]?lake|etl|airflow|dagster|prefect|kafka|pulsar|rabbitmq|spark|flink|presto|trino)\b/i,
  },
  // Travel / location / booking → Location & Travel
  {
    category: "Location & Travel",
    pattern:
      /\b(airbnb|booking\.com|booking-com|expedia|agoda|trip\.com|tripadvisor|kayak|skyscanner|hopper|vrbo|hostelworld|rakuten[ -]?travel|jalan|jtb|uber|lyft|grab|gojek|didi|ola[ -]?cabs|bird|lime|google[ -]?maps|mapbox|here[ -]?maps|amadeus|sabre|openstreetmap|osm)\b/i,
  },
  // Commerce & EC → Commerce
  {
    category: "Commerce",
    pattern:
      /\b(shopify|amazon[ -]?(seller|sp[- ]?api)|ebay|etsy|mercari|rakuten(?!-travel)|yahoo[ -]?shopping|base-ec|stores\.jp|shopee|lazada|woocommerce|magento|bigcommerce|ec[ -]?cube)\b/i,
  },
  // Payments → Finance & Accounting
  {
    category: "Finance & Accounting",
    pattern:
      /\b(stripe|paypal|square|adyen|checkout\.com|braintree|payoneer|wise|transferwise|plaid|gmo[ -]?pg|gmo[ -]?payment|paypay|line[ -]?pay|rakuten[ -]?pay|freee|money[ -]?forward|yayoi|kaikei|invoice|bookkeeping|ledger)\b/i,
  },
  // Social / content platforms → Media & Content
  {
    category: "Media & Content",
    pattern:
      /\b(twitter|^x$|facebook|meta[ -]?platforms|instagram|tiktok|reddit|linkedin|youtube|vimeo|twitch|spotify|soundcloud|pinterest|threads|bluesky|mastodon|note(?![ -]?taking)|zenn|qiita|medium|substack)\b/i,
  },
  // Communication / messaging → Communication
  {
    category: "Communication",
    pattern:
      /\b(slack|discord|teams|microsoft[ -]?teams|telegram|wechat|whatsapp|signal|line(?![ -]?pay)|line[ -]?works|kakao|messenger|gmail|outlook|proton[ -]?mail|sendgrid|postmark|mailgun|twilio|chatwork|zoom|webex)\b/i,
  },
  // Design → Design
  {
    category: "Design",
    pattern: /\b(figma|sketch|adobe[ -]?(xd|creative)|canva|framer|miro|whimsical|invision|zeplin|penpot|photoshop|illustrator|figjam)\b/i,
  },
  // CRM / Sales → CRM & Sales
  {
    category: "CRM & Sales",
    pattern:
      /\b(salesforce|hubspot|pipedrive|zoho[ -]?crm|zendesk[ -]?sell|close\.io|active[ -]?campaign|marketo|pardot|salesgo|senses|mazrica|freshsales|kintone(?![ -]?app))\b/i,
  },
  // Project mgmt → Project Management
  {
    category: "Project Management",
    pattern: /\b(jira|linear|asana|trello|monday\.com|clickup|basecamp|backlog|redmine|shortcut|height|wrike|smartsheet|teamwork|notion(?![ -]?database)|todoist|microsoft[ -]?planner)\b/i,
  },
  // HR → HR & Recruiting
  {
    category: "HR & Recruiting",
    pattern: /\b(workday|bamboohr|gusto|rippling|greenhouse|lever|ashby|smarthr|kingoftime|freee[ -]?hr|jobcan|smartcamp|recruit(?!-engine)|ats)\b/i,
  },
  // Knowledge / docs → Knowledge & Docs
  {
    category: "Knowledge & Docs",
    pattern: /\b(notion|confluence|coda|obsidian|roam[ -]?research|logseq|remnote|bear[ -]?app|anytype|wiki|gitbook|readme\.com|docusaurus|zenn[ -]?book|scrapbox)\b/i,
  },
  // Security → Security
  {
    category: "Security",
    pattern:
      /\b(okta|auth0|1password|lastpass|bitwarden|dashlane|cyberark|crowdstrike|wiz|snyk|sonarqube|fortinet|palo[ -]?alto|cloudflare[ -]?waf|burp[ -]?suite|metasploit|vulnerability[ -]?scanner|penetration[ -]?testing)\b/i,
  },
  // Actually-AI / ML infrastructure → AI & LLM (narrow definition)
  // Only fires for dedicated AI/ML *platforms*, not "anything that happens
  // to be an MCP server". Stays LAST so earlier domain rules win.
  {
    category: "AI & LLM",
    pattern:
      /\b(openai|anthropic|cohere|hugging[ -]?face|huggingface|replicate|together\.ai|groq|fireworks|perplexity|mistral|llama(?!rpc)|pinecone|weaviate|chroma[ -]?db|qdrant|milvus|langchain|llamaindex|openrouter|elevenlabs|stability[ -]?ai|runway[ -]?ml|midjourney|dall[ -]?e|gemini[ -]?pro|anthropic[ -]?claude)\b/i,
  },
];

/** Apply deterministic overrides on top of LLM/heuristic output. */
export function refineCategory(
  name: string,
  description: string,
  llmCategory: string
): string {
  const text = `${name} ${description}`;
  for (const rule of REFINE_RULES) {
    if (rule.pattern.test(text)) {
      return rule.category;
    }
  }
  return llmCategory;
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

  const prompt = `You classify MCP (Model Context Protocol) servers into categories for the KanseiLink directory — a registry of SaaS-integration MCP servers.

Available categories (choose ONE, exactly as written):
${categoriesText}

CRITICAL DISAMBIGUATION RULES — read carefully:
- "AI & LLM" is ONLY for dedicated AI/ML platforms: OpenAI, Anthropic, Hugging Face, Replicate, vector DBs (Pinecone/Weaviate), LLM routers, embedding services. DO NOT use "AI & LLM" just because something is an MCP server — MCP is merely the protocol.
- Cloud providers (AWS, GCP, Azure, Alibaba Cloud, Aliyun, Tencent Cloud, Oracle Cloud, Cloudflare, Vercel) → "Developer Tools"
- Databases (MySQL, PostgreSQL, MongoDB, Redis, ClickHouse, DMS, data warehouses) → "Data & Analytics"
- Travel / booking / ride-share (Airbnb, Booking.com, Expedia, Uber, Google Maps) → "Location & Travel"
- E-commerce platforms (Shopify, Amazon Seller, eBay, Etsy, Rakuten) → "Commerce"
- Payment processors (Stripe, PayPal, Square) → "Finance & Accounting"
- Messaging (Slack, Discord, Telegram, LINE, Teams) → "Communication"
- Social / content platforms (Twitter/X, Reddit, YouTube, Instagram) → "Media & Content"

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
      const refined = refineCategory(c.candidate_name, c.description || "", h.category);
      return { ...c, proposed_category: refined, proposed_tags: h.tags };
    });
  }

  const client = new Anthropic({ apiKey });
  const results: ClassifiedCandidate[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    try {
      const batchResult = await classifyBatchWithLLM(batch, client);
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        const llmPick = batchResult[String(j)];
        if (llmPick && CATEGORIES.includes(llmPick.category)) {
          // Deterministic override layer — catches cases where the LLM
          // bucketed cloud/travel/commerce into "AI & LLM" or "Other".
          const refined = refineCategory(
            c.candidate_name,
            c.description || "",
            llmPick.category
          );
          results.push({
            ...c,
            proposed_category: refined,
            proposed_tags: llmPick.tags || [],
            llm_notes: llmPick.notes,
          });
        } else {
          // fallback per-item
          const h = heuristicClassify(c);
          const refined = refineCategory(c.candidate_name, c.description || "", h.category);
          results.push({ ...c, proposed_category: refined, proposed_tags: h.tags });
        }
      }
    } catch (err) {
      console.error(`[classify] LLM batch failed, falling back to heuristic:`, err);
      for (const c of batch) {
        const h = heuristicClassify(c);
        const refined = refineCategory(c.candidate_name, c.description || "", h.category);
        results.push({ ...c, proposed_category: refined, proposed_tags: h.tags });
      }
    }
  }

  return results;
}
