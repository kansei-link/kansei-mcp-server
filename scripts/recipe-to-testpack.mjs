import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dbPath = resolve(arg("--db") || "kansei-link.db");
let db;
const openDb = () => {
  db ||= new Database(dbPath, { readonly: true });
  return db;
};

const showRecipe = arg("--show-recipe");
if (showRecipe) {
  const row = openDb().prepare("SELECT * FROM recipes WHERE id = ?").get(showRecipe);
  if (!row) throw new Error(`Recipe not found: ${showRecipe}`);
  console.log(JSON.stringify({ ...row, steps: JSON.parse(row.steps) }, null, 2));
  db.close();
  process.exit(0);
}

const listService = arg("--list-service");
if (listService) {
  const rows = openDb().prepare(`
    SELECT id, goal, required_services FROM recipes
     WHERE required_services LIKE ? OR id LIKE ?
     ORDER BY id
  `).all(`%\"${listService}\"%`, `%${listService}%`);
  console.log(JSON.stringify(rows, null, 2));
  db.close();
  process.exit(0);
}

const recipeId = arg("--recipe");
const recipeFile = arg("--recipe-file");
const bindingsPath = arg("--bindings");
const outputPath = arg("--out");
if ((!recipeId && !recipeFile) || !bindingsPath || !outputPath) {
  console.error("Usage: node scripts/recipe-to-testpack.mjs (--recipe ID | --recipe-file FILE) --bindings FILE --out FILE");
  console.error("       node scripts/recipe-to-testpack.mjs --list-service freee");
  process.exit(2);
}

const recipe = recipeFile
  ? JSON.parse(readFileSync(resolve(recipeFile), "utf8"))
  : openDb().prepare(`
      SELECT id, goal, description, steps, required_services, version
        FROM recipes WHERE id = ?
    `).get(recipeId);
db?.close();
if (!recipe) throw new Error(`Recipe not found: ${recipeId || recipeFile}`);

const bindings = JSON.parse(readFileSync(resolve(bindingsPath), "utf8"));
const recipeSteps = typeof recipe.steps === "string" ? JSON.parse(recipe.steps) : recipe.steps;
if (!Array.isArray(recipeSteps) || recipeSteps.length === 0) {
  throw new Error(`Recipe ${recipeId} has no structured steps`);
}
const boundByOrder = new Map((bindings.step_bindings || []).map((b) => [b.order, b]));
const unbound = recipeSteps.filter((s) => !boundByOrder.has(s.order));
if (unbound.length > 0) {
  throw new Error(`Unbound recipe step(s): ${unbound.map((s) => s.order).join(", ")}`);
}

const sourceCanonical = JSON.stringify({
  id: recipe.id, version: recipe.version, steps: recipeSteps,
});
const testPack = {
  schema_version: "1.0",
  id: bindings.id,
  version: bindings.version || 1,
  service_id: bindings.service_id,
  category: bindings.category,
  task_type: bindings.task_type,
  evidence_tier_target: bindings.evidence_tier_target || "E2",
  risk: bindings.risk,
  source_recipe: {
    id: recipe.id,
    version: recipe.version,
    sha256: createHash("sha256").update(sourceCanonical).digest("hex"),
  },
  goal_prompt: bindings.goal_prompt,
  preflight: bindings.preflight || [],
  preconditions: bindings.preconditions || [],
  scripted_steps: recipeSteps.map((step) => {
    const bound = boundByOrder.get(step.order);
    return {
      order: step.order,
      source_action: step.action,
      tool: bound.tool,
      arguments: bound.arguments,
      capture: bound.capture || {},
      assertions: bound.assertions || [],
    };
  }),
  agentic: bindings.agentic,
  cleanup: bindings.cleanup || { required: false, steps: [] },
  budgets: bindings.budgets || { max_steps: 12, max_tokens: 20000, timeout_s: 180 },
  publication: {
    minimum_runs: 5,
    requires_assertion_verified: true,
    allow_success_rate_before_threshold: false,
  },
};

for (const required of ["id", "service_id", "category", "task_type", "risk", "goal_prompt", "agentic"]) {
  if (!testPack[required]) throw new Error(`Missing required binding: ${required}`);
}
if (!/^R[0-3]$/.test(testPack.risk)) throw new Error(`Invalid risk: ${testPack.risk}`);

const target = resolve(outputPath);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(testPack, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ written: target, id: testPack.id, steps: testPack.scripted_steps.length }, null, 2));
