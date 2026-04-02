import { getDb } from "./connection.js";
import { initializeDb } from "./schema.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
