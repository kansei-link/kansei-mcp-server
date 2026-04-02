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
  trust_score: number;
}

interface RecipeSeed {
  id: string;
  goal: string;
  description: string;
  steps: unknown[];
  required_services: string[];
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
  ];

  const insertService = db.prepare(`
    INSERT OR IGNORE INTO services (id, name, namespace, description, category, tags, mcp_endpoint, trust_score)
    VALUES (@id, @name, @namespace, @description, @category, @tags, @mcp_endpoint, @trust_score)
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

  const seedAll = db.transaction(() => {
    for (const service of services) {
      insertService.run(service);
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
  });

  seedAll();

  // Rebuild FTS index
  db.exec("INSERT INTO services_fts(services_fts) VALUES ('rebuild')");

  const serviceCount = db
    .prepare("SELECT count(*) as count FROM services")
    .get() as { count: number };
  const recipeCount = db
    .prepare("SELECT count(*) as count FROM recipes")
    .get() as { count: number };

  console.log(
    `Seeded ${serviceCount.count} services and ${recipeCount.count} recipes.`
  );
}

// Run directly
const db = getDb();
initializeDb(db);
seedDatabase(db);
db.close();
