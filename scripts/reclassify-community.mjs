#!/usr/bin/env node
/**
 * Retroactively re-categorize community-tier services using the same
 * refinement rules that crawler/pipeline/classify.ts now applies going
 * forward. Catches the Alibaba-Cloud-as-AI-LLM / Airbnb-as-Search bugs
 * that exist in the DB from pre-fix crawler runs.
 *
 *   node scripts/reclassify-community.mjs              # apply
 *   node scripts/reclassify-community.mjs --dry-run    # preview
 *
 * Only touches services where the refined category DIFFERS from the
 * current stored category. Non-community (hand-curated BB+) rows are
 * skipped so manual overrides never get trampled.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const DRY_RUN = process.argv.includes("--dry-run");

// Mirror of src/crawler/pipeline/classify.ts REFINE_RULES. Kept in sync
// manually since this script runs from plain Node without needing to
// build the TS pipeline first.
const REFINE_RULES = [
  {
    category: "Developer Tools",
    pattern:
      /\b(aws|amazon[ -]?web[ -]?services|gcp|google[ -]?cloud|azure|microsoft[ -]?azure|aliyun|alibaba[ -]?cloud|tencent[ -]?cloud|oracle[ -]?cloud|digitalocean|linode|vultr|hetzner|cloudflare|vercel|netlify|fly\.io|heroku|render|railway|kubernetes|k8s|docker|helm|terraform|pulumi|ansible|jenkins|circleci|github[ -]?actions|gitlab[ -]?ci|buildkite|argocd|flux|nomad|consul|vault|datadog|new[ -]?relic|sentry|grafana|prometheus|honeycomb|pagerduty|opsgenie|cloudops|devops)\b/i,
  },
  {
    category: "Data & Analytics",
    pattern:
      /\b(mysql|postgres|postgresql|mongodb|redis|sqlite|clickhouse|dynamodb|elasticsearch|opensearch|cassandra|scylla|neo4j|tidb|cockroachdb|influxdb|timescaledb|snowflake|bigquery|databricks|redshift|duckdb|supabase|planetscale|neon|fivetran|airbyte|dbt|\bdms\b|data[ -]?warehouse|data[ -]?lake|etl|airflow|dagster|prefect|kafka|pulsar|rabbitmq|spark|flink|presto|trino)\b/i,
  },
  {
    category: "Location & Travel",
    pattern:
      /\b(airbnb|booking\.com|booking-com|expedia|agoda|trip\.com|tripadvisor|kayak|skyscanner|hopper|vrbo|hostelworld|rakuten[ -]?travel|jalan|jtb|uber|lyft|grab|gojek|didi|ola[ -]?cabs|bird|lime|google[ -]?maps|mapbox|here[ -]?maps|amadeus|sabre|openstreetmap|osm)\b/i,
  },
  {
    category: "Commerce",
    pattern:
      /\b(shopify|amazon[ -]?(seller|sp[- ]?api)|ebay|etsy|mercari|rakuten(?!-travel)|yahoo[ -]?shopping|base-ec|stores\.jp|shopee|lazada|woocommerce|magento|bigcommerce|ec[ -]?cube)\b/i,
  },
  {
    category: "Finance & Accounting",
    pattern:
      /\b(stripe|paypal|square|adyen|checkout\.com|braintree|payoneer|wise|transferwise|plaid|gmo[ -]?pg|gmo[ -]?payment|paypay|line[ -]?pay|rakuten[ -]?pay|freee|money[ -]?forward|yayoi|kaikei|invoice|bookkeeping|ledger)\b/i,
  },
  {
    category: "Media & Content",
    pattern:
      /\b(twitter|^x$|facebook|meta[ -]?platforms|instagram|tiktok|reddit|linkedin|youtube|vimeo|twitch|spotify|soundcloud|pinterest|threads|bluesky|mastodon|note(?![ -]?taking)|zenn|qiita|medium|substack)\b/i,
  },
  {
    category: "Communication",
    pattern:
      /\b(slack|discord|teams|microsoft[ -]?teams|telegram|wechat|whatsapp|signal|line(?![ -]?pay)|line[ -]?works|kakao|messenger|gmail|outlook|proton[ -]?mail|sendgrid|postmark|mailgun|twilio|chatwork|zoom|webex)\b/i,
  },
  {
    category: "Design",
    pattern: /\b(figma|sketch|adobe[ -]?(xd|creative)|canva|framer|miro|whimsical|invision|zeplin|penpot|photoshop|illustrator|figjam)\b/i,
  },
  {
    category: "CRM & Sales",
    pattern:
      /\b(salesforce|hubspot|pipedrive|zoho[ -]?crm|zendesk[ -]?sell|close\.io|active[ -]?campaign|marketo|pardot|salesgo|senses|mazrica|freshsales|kintone(?![ -]?app))\b/i,
  },
  {
    category: "Project Management",
    pattern: /\b(jira|linear|asana|trello|monday\.com|clickup|basecamp|backlog|redmine|shortcut|height|wrike|smartsheet|teamwork|notion(?![ -]?database)|todoist|microsoft[ -]?planner)\b/i,
  },
  {
    category: "HR & Recruiting",
    pattern: /\b(workday|bamboohr|gusto|rippling|greenhouse|lever|ashby|smarthr|kingoftime|freee[ -]?hr|jobcan|smartcamp|recruit(?!-engine)|ats)\b/i,
  },
  {
    category: "Knowledge & Docs",
    pattern: /\b(notion|confluence|coda|obsidian|roam[ -]?research|logseq|remnote|bear[ -]?app|anytype|wiki|gitbook|readme\.com|docusaurus|zenn[ -]?book|scrapbox)\b/i,
  },
  {
    category: "Security",
    pattern:
      /\b(okta|auth0|1password|lastpass|bitwarden|dashlane|cyberark|crowdstrike|wiz|snyk|sonarqube|fortinet|palo[ -]?alto|cloudflare[ -]?waf|burp[ -]?suite|metasploit|vulnerability[ -]?scanner|penetration[ -]?testing)\b/i,
  },
  {
    category: "AI & LLM",
    pattern:
      /\b(openai|anthropic|cohere|hugging[ -]?face|huggingface|replicate|together\.ai|groq|fireworks|perplexity|mistral|llama(?!rpc)|pinecone|weaviate|chroma[ -]?db|qdrant|milvus|langchain|llamaindex|openrouter|elevenlabs|stability[ -]?ai|runway[ -]?ml|midjourney|dall[ -]?e|gemini[ -]?pro|anthropic[ -]?claude)\b/i,
  },
];

function refineCategory(name, description, current) {
  const text = `${name || ""} ${description || ""}`;
  for (const rule of REFINE_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return current;
}

const db = new Database(dbPath);

// Only target community-tier entries — hand-curated services have trusted
// categories that we don't want to overwrite automatically.
const rows = db
  .prepare(
    `SELECT id, name, description, category, mcp_status
     FROM services
     WHERE mcp_status = 'community'`
  )
  .all();

const changes = [];
for (const r of rows) {
  const refined = refineCategory(r.name, r.description, r.category);
  if (refined !== r.category) {
    changes.push({ id: r.id, name: r.name, before: r.category, after: refined });
  }
}

console.log("=== reclassify-community ===");
console.log(`community services scanned: ${rows.length}`);
console.log(`would reclassify:           ${changes.length}`);
console.log(`unchanged:                  ${rows.length - changes.length}`);
console.log();

// Summarize the category migration pattern
const migration = {};
for (const c of changes) {
  const key = `${c.before} → ${c.after}`;
  migration[key] = (migration[key] ?? 0) + 1;
}
console.log("--- migration breakdown ---");
for (const [key, n] of Object.entries(migration).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)}  ${key}`);
}
console.log();

if (changes.length > 0) {
  console.log("--- sample changes (up to 20) ---");
  for (const c of changes.slice(0, 20)) {
    console.log(`  ${c.name.padEnd(40)} ${c.before} → ${c.after}`);
  }
  if (changes.length > 20) console.log(`  ... + ${changes.length - 20} more`);
  console.log();
}

if (DRY_RUN) {
  console.log("[dry-run] no changes written.");
  db.close();
  process.exit(0);
}

const update = db.prepare("UPDATE services SET category = ? WHERE id = ?");
const tx = db.transaction(() => {
  for (const c of changes) update.run(c.after, c.id);
});
tx();

console.log(`[APPLIED] ${changes.length} categories updated.`);
db.close();
