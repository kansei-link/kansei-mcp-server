import { getDb } from "./connection.js";
import { initializeDb } from "./schema.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ChangelogSeed {
  service_id: string;
  change_date: string;
  change_type: string;
  summary: string;
  details?: string;
}

interface ServiceSeed {
  id: string;
  name: string;
  namespace: string;
  description: string;
  category: string;
  tags: string;
  mcp_endpoint: string;
  mcp_status: string;
  api_url?: string;
  api_auth_method?: string;
  trust_score: number;
}

interface RecipeSeed {
  id: string;
  goal: string;
  description: string;
  steps: unknown[];
  required_services: string[];
}

interface ApiGuideSeed {
  service_id: string;
  base_url: string;
  api_version: string | null;
  auth_overview: string;
  auth_token_url: string | null;
  auth_scopes: string | null;
  auth_setup_hint: string | null;
  sandbox_url: string | null;
  key_endpoints: unknown[];
  request_content_type: string;
  pagination_style: string | null;
  rate_limit: string | null;
  error_format: string | null;
  quickstart_example: string;
  agent_tips: string[];
  docs_url: string | null;
}

function loadJson<T>(filename: string): T {
  // Look in src/data first (dev), then dist/data (built)
  const srcPath = path.join(__dirname, "..", "..", "src", "data", filename);
  const distPath = path.join(__dirname, "..", "data", filename);
  const filePath = existsSync(srcPath) ? srcPath : distPath;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

export function seedDatabase(db: ReturnType<typeof getDb>): void {
  const services = loadJson<ServiceSeed[]>("services-seed.json");
  const recipes = loadJson<RecipeSeed[]>("recipes-seed.json");
  const apiGuides = loadJson<ApiGuideSeed[]>("api-guides-seed.json");

  const changelogEntries: ChangelogSeed[] = [
    // freee
    { service_id: "freee", change_date: "2026-03-27", change_type: "feature", summary: "Remote MCP server version added", details: "freee now offers a hosted MCP endpoint in addition to the local npx runner, reducing setup friction for cloud-native agents." },
    { service_id: "freee", change_date: "2026-03-15", change_type: "feature", summary: "Invoice API v2 endpoint supported", details: "Added support for the new freee Invoice API v2 with line-item tax rounding options and PDF attachment." },
    { service_id: "freee", change_date: "2026-02-28", change_type: "fix", summary: "Bank sync retry logic improved", details: "Fixed intermittent 429 errors during bank account synchronization by adding exponential back-off." },

    // smarthr
    { service_id: "smarthr", change_date: "2026-03-20", change_type: "feature", summary: "Employee bulk import tool added", details: "New bulk_import_employees tool accepts CSV payload and creates multiple employee records in a single call." },
    { service_id: "smarthr", change_date: "2026-03-05", change_type: "fix", summary: "Social insurance PDF generation fix", details: "Resolved issue where generated social insurance documents had incorrect fiscal year headers." },
    { service_id: "smarthr", change_date: "2026-02-18", change_type: "deprecation", summary: "Legacy employee list endpoint deprecated", details: "The v1 list_employees endpoint will be removed on 2026-06-01. Use list_employees_v2 instead." },

    // chatwork
    { service_id: "chatwork", change_date: "2026-03-10", change_type: "feature", summary: "Thread reply support added", details: "Agents can now reply to specific messages in a thread using the new reply_to_message tool." },
    { service_id: "chatwork", change_date: "2026-02-20", change_type: "feature", summary: "File upload size limit increased to 50 MB" },
    { service_id: "chatwork", change_date: "2026-02-05", change_type: "fix", summary: "Room member list pagination corrected" },

    // sansan
    { service_id: "sansan", change_date: "2026-03-22", change_type: "feature", summary: "Business card OCR accuracy improved to 98%", details: "Upgraded OCR model for Japanese vertical text and double-byte characters." },
    { service_id: "sansan", change_date: "2026-03-01", change_type: "breaking", summary: "Authentication switched to OAuth 2.0", details: "API key auth removed. All agents must use OAuth 2.0 client credentials flow. See migration guide." },

    // moneyforward
    { service_id: "moneyforward", change_date: "2026-03-18", change_type: "feature", summary: "AI expense categorization tool added", details: "New auto_categorize_expenses tool uses ML to classify transactions into accounts." },
    { service_id: "moneyforward", change_date: "2026-03-02", change_type: "fix", summary: "Payroll calculation rounding error fixed" },
    { service_id: "moneyforward", change_date: "2026-02-10", change_type: "feature", summary: "Multi-currency journal entry support" },

    // backlog
    { service_id: "backlog", change_date: "2026-03-25", change_type: "feature", summary: "Bulk issue update tool added", details: "Update status, assignee, or priority for multiple issues in a single API call." },
    { service_id: "backlog", change_date: "2026-03-08", change_type: "fix", summary: "Wiki markdown rendering fix for tables" },

    // lineworks
    { service_id: "lineworks", change_date: "2026-03-12", change_type: "feature", summary: "Calendar event creation tool added", details: "Agents can now create, update, and delete LINE WORKS calendar events." },
    { service_id: "lineworks", change_date: "2026-02-25", change_type: "breaking", summary: "Bot API v1 removed", details: "Bot API v1 endpoints no longer respond. Migrate to Bot API v2." },

    // kingoftime
    { service_id: "kingoftime", change_date: "2026-03-15", change_type: "feature", summary: "Overtime alert notification tool added" },
    { service_id: "kingoftime", change_date: "2026-02-28", change_type: "fix", summary: "Shift swap approval workflow fix", details: "Fixed edge case where overlapping shift swaps could both be approved." },

    // base-ec
    { service_id: "base-ec", change_date: "2026-03-20", change_type: "feature", summary: "Inventory webhook support added" },
    { service_id: "base-ec", change_date: "2026-03-05", change_type: "fix", summary: "Order status filter returning stale data fixed" },

    // stores-jp
    { service_id: "stores-jp", change_date: "2026-03-18", change_type: "feature", summary: "POS transaction sync tool added" },
    { service_id: "stores-jp", change_date: "2026-02-22", change_type: "feature", summary: "Reservation slot management tool added" },

    // hubspot-jp
    { service_id: "hubspot-jp", change_date: "2026-03-28", change_type: "feature", summary: "Deal pipeline stage automation tool added" },
    { service_id: "hubspot-jp", change_date: "2026-03-10", change_type: "fix", summary: "Contact merge duplicate detection improved" },

    // jooto
    { service_id: "jooto", change_date: "2026-03-14", change_type: "feature", summary: "Board template cloning tool added" },
    { service_id: "jooto", change_date: "2026-02-15", change_type: "fix", summary: "Label color sync issue resolved" },

    // kintone
    { service_id: "kintone", change_date: "2026-03-30", change_type: "feature", summary: "Process management API support added", details: "Agents can now advance workflow status and retrieve process history via MCP." },
    { service_id: "kintone", change_date: "2026-03-10", change_type: "feature", summary: "Desktop Extension available", details: "kintone MCP can now be installed as a Desktop Extension in addition to npm/Docker." },

    // garoon
    { service_id: "garoon", change_date: "2026-03-20", change_type: "feature", summary: "Schedule search and conflict detection added" },

    // shopify-jp
    { service_id: "shopify-jp", change_date: "2026-03-25", change_type: "feature", summary: "Storefront MCP endpoint built into every store", details: "Every Shopify store now exposes /api/mcp endpoint by default." },
    { service_id: "shopify-jp", change_date: "2026-03-15", change_type: "feature", summary: "Checkout Extensions MCP server added" },

    // cloudsign
    { service_id: "cloudsign", change_date: "2026-03-28", change_type: "feature", summary: "Bulk contract sending API added", details: "Send up to 50 contracts in a single API call." },
    { service_id: "cloudsign", change_date: "2026-03-05", change_type: "feature", summary: "Webhook support for contract status changes" },

    // slack
    { service_id: "slack", change_date: "2026-03-30", change_type: "feature", summary: "Native MCP server released", details: "Official Slack MCP server respects existing workspace permissions and channel access." },

    // notion
    { service_id: "notion", change_date: "2026-03-22", change_type: "feature", summary: "Database query filtering via MCP", details: "Agents can now filter and sort Notion database queries through MCP tools." },

    // line-messaging
    { service_id: "line-messaging", change_date: "2026-03-18", change_type: "feature", summary: "Flex Message v2 support added", details: "Rich interactive message templates now supported via MCP." },

    // salesgo
    { service_id: "salesgo", change_date: "2026-03-25", change_type: "feature", summary: "GoZeeta AI agent integration announced", details: "SALES GO's AI agent will use MCP for autonomous sales activity management." },

    // treasure-data
    { service_id: "treasure-data", change_date: "2026-03-28", change_type: "feature", summary: "Natural language SQL query support", details: "Agents can write SQL queries by describing what they want in natural language." },

    // freee-hr
    { service_id: "freee-hr", change_date: "2026-03-20", change_type: "feature", summary: "Year-end adjustment (年末調整) workflow support", details: "28 API files covering the full year-end adjustment process for Japanese employers." },
  ];

  const insertService = db.prepare(`
    INSERT INTO services (id, name, namespace, description, category, tags, mcp_endpoint, mcp_status, api_url, api_auth_method, trust_score)
    VALUES (@id, @name, @namespace, @description, @category, @tags, @mcp_endpoint, @mcp_status, @api_url, @api_auth_method, @trust_score)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      namespace = excluded.namespace,
      description = excluded.description,
      category = excluded.category,
      tags = excluded.tags,
      mcp_endpoint = excluded.mcp_endpoint,
      mcp_status = excluded.mcp_status,
      api_url = excluded.api_url,
      api_auth_method = excluded.api_auth_method,
      trust_score = excluded.trust_score
  `);

  const insertStats = db.prepare(`
    INSERT OR IGNORE INTO service_stats (service_id) VALUES (@service_id)
  `);

  const insertRecipe = db.prepare(`
    INSERT OR IGNORE INTO recipes (id, goal, description, steps, required_services)
    VALUES (@id, @goal, @description, @steps, @required_services)
  `);

  const insertChangelog = db.prepare(`
    INSERT OR IGNORE INTO service_changelog (service_id, change_date, change_type, summary, details)
    VALUES (@service_id, @change_date, @change_type, @summary, @details)
  `);

  const insertApiGuide = db.prepare(`
    INSERT OR IGNORE INTO service_api_guides (service_id, base_url, api_version, auth_overview, auth_token_url, auth_scopes, auth_setup_hint, sandbox_url, key_endpoints, request_content_type, pagination_style, rate_limit, error_format, quickstart_example, agent_tips, docs_url)
    VALUES (@service_id, @base_url, @api_version, @auth_overview, @auth_token_url, @auth_scopes, @auth_setup_hint, @sandbox_url, @key_endpoints, @request_content_type, @pagination_style, @rate_limit, @error_format, @quickstart_example, @agent_tips, @docs_url)
  `);

  const seedAll = db.transaction(() => {
    for (const service of services) {
      insertService.run({
        ...service,
        api_url: service.api_url ?? null,
        api_auth_method: service.api_auth_method ?? null,
      });
      insertStats.run({ service_id: service.id });
    }

    for (const recipe of recipes) {
      insertRecipe.run({
        ...recipe,
        steps: JSON.stringify(recipe.steps),
        required_services: JSON.stringify(recipe.required_services),
      });
    }

    for (const entry of changelogEntries) {
      insertChangelog.run({
        service_id: entry.service_id,
        change_date: entry.change_date,
        change_type: entry.change_type,
        summary: entry.summary,
        details: entry.details ?? null,
      });
    }

    for (const guide of apiGuides) {
      insertApiGuide.run({
        ...guide,
        api_version: guide.api_version ?? null,
        auth_token_url: guide.auth_token_url ?? null,
        auth_scopes: guide.auth_scopes ?? null,
        auth_setup_hint: guide.auth_setup_hint ?? null,
        sandbox_url: guide.sandbox_url ?? null,
        key_endpoints: JSON.stringify(guide.key_endpoints),
        pagination_style: guide.pagination_style ?? null,
        rate_limit: guide.rate_limit ?? null,
        error_format: guide.error_format ?? null,
        agent_tips: JSON.stringify(guide.agent_tips),
        docs_url: guide.docs_url ?? null,
      });
    }
  });

  seedAll();

  // Rebuild FTS indexes
  db.exec("INSERT INTO services_fts(services_fts) VALUES ('rebuild')");
  db.exec("INSERT INTO services_fts_trigram(services_fts_trigram) VALUES ('rebuild')");

  const serviceCount = db
    .prepare("SELECT count(*) as count FROM services")
    .get() as { count: number };
  const recipeCount = db
    .prepare("SELECT count(*) as count FROM recipes")
    .get() as { count: number };

  const guideCount = db
    .prepare("SELECT count(*) as count FROM service_api_guides")
    .get() as { count: number };

  console.log(
    `Seeded ${serviceCount.count} services, ${recipeCount.count} recipes, and ${guideCount.count} API guides.`
  );
}

// Run directly when invoked as a script (npm run seed)
const isDirectRun = process.argv[1]?.includes("seed");
if (isDirectRun) {
  const db = getDb();
  initializeDb(db);
  seedDatabase(db);
  db.close();
}
