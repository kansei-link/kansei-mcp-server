/**
 * Agent Army Orchestrator — CLI entry point.
 *
 * Usage:
 *   pnpm tsx src/agent-army/run.ts                    # Run all levels
 *   pnpm tsx src/agent-army/run.ts --level=L1         # L1 only (no API keys needed)
 *   pnpm tsx src/agent-army/run.ts --level=L2 --max=50
 *   pnpm tsx src/agent-army/run.ts --dry-run          # Show what would be tested
 *
 * Environment:
 *   ANTHROPIC_API_KEY   — for L2/L3 with Haiku
 *   OPENAI_API_KEY      — for L2 with GPT-4o-mini
 *   GOOGLE_AI_API_KEY   — for L2 with Gemini Flash
 *   DB_PATH             — SQLite path (default: kansei-link.db)
 */
import Database from "better-sqlite3";
import { initializeDb } from "../db/schema.js";
import { estimateCost } from "../utils/model-pricing.js";
import { createAdapter } from "./adapters.js";
import { runL1, runL2, runL3 } from "./tests.js";
import type {
  TestTask,
  TestResult,
  ArmySummary,
  ModelId,
  TestLevel,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const LEVEL_MODEL_MAP: Record<TestLevel, ModelId> = {
  L1: "gemini-2.0-flash", // No LLM actually used, just attribution
  L2: "gpt-4o-mini",
  L3: "claude-haiku-3.5",
};

const CONCURRENCY = 5;
const DEFAULT_MAX = 600;

// ---------------------------------------------------------------------------
// Task generation
// ---------------------------------------------------------------------------
interface ServiceRow {
  id: string;
  name: string;
  api_url: string | null;
  mcp_endpoint: string | null;
  mcp_status: string | null;
  category: string | null;
  description: string | null;
  api_auth_method: string | null;
  trust_score: number;
  total_calls: number | null;
}

interface GuideRow {
  service_id: string;
  base_url: string;
  auth_overview: string;
  key_endpoints: string;
  quickstart_example: string;
  agent_tips: string | null;
  docs_url: string | null;
}

interface RecipeRow {
  id: string;
  goal: string;
  description: string | null;
  required_services: string;
  steps: string;
  gotchas: string | null;
}

function buildTasks(
  db: Database.Database,
  levels: TestLevel[],
  maxPerLevel: number
): TestTask[] {
  const tasks: TestTask[] = [];

  // Get untested or under-tested services (total_calls < 3)
  const services = db
    .prepare(
      `SELECT s.id, s.name, s.api_url, s.mcp_endpoint, s.mcp_status,
              s.category, s.description, s.api_auth_method, s.trust_score,
              COALESCE(ss.total_calls, 0) as total_calls
       FROM services s
       LEFT JOIN service_stats ss ON s.id = ss.service_id
       ORDER BY COALESCE(ss.total_calls, 0) ASC, s.trust_score DESC`
    )
    .all() as ServiceRow[];

  // Prioritize: never-tested first, then under-tested
  const untested = services.filter((s) => (s.total_calls ?? 0) < 3);

  console.log(
    `[army] ${services.length} total services, ${untested.length} under-tested (< 3 calls)`
  );

  // L1: Endpoint validation for all untested services with URLs
  if (levels.includes("L1")) {
    const l1Candidates = untested
      .filter((s) => s.api_url || s.mcp_endpoint)
      .slice(0, maxPerLevel);

    for (const s of l1Candidates) {
      // Get docs_url from guide if available
      const guide = db
        .prepare("SELECT docs_url FROM service_api_guides WHERE service_id = ?")
        .get(s.id) as { docs_url: string | null } | undefined;

      tasks.push({
        service_id: s.id,
        service_name: s.name,
        level: "L1",
        model: LEVEL_MODEL_MAP.L1,
        task_type: "endpoint_validation",
        payload: {
          api_url: s.api_url,
          mcp_endpoint: s.mcp_endpoint,
          docs_url: guide?.docs_url,
        },
      });
    }
    console.log(`[army] L1 tasks: ${l1Candidates.length}`);
  }

  // L2: Guide comprehension for services WITH guides
  if (levels.includes("L2")) {
    const guidedServices = untested.filter((s) => {
      const guide = db
        .prepare("SELECT 1 FROM service_api_guides WHERE service_id = ?")
        .get(s.id);
      return !!guide;
    }).slice(0, maxPerLevel);

    for (const s of guidedServices) {
      const guide = db
        .prepare("SELECT * FROM service_api_guides WHERE service_id = ?")
        .get(s.id) as GuideRow | undefined;
      if (!guide) continue;

      tasks.push({
        service_id: s.id,
        service_name: s.name,
        level: "L2",
        model: LEVEL_MODEL_MAP.L2,
        task_type: "guide_comprehension",
        payload: {
          base_url: guide.base_url,
          auth_overview: guide.auth_overview,
          auth_method: s.api_auth_method,
          key_endpoints: guide.key_endpoints,
          quickstart_example: guide.quickstart_example,
          agent_tips: guide.agent_tips,
          docs_url: guide.docs_url,
        },
      });
    }
    console.log(`[army] L2 tasks: ${guidedServices.length}`);
  }

  // L3: Recipe simulation for services that appear in recipes
  if (levels.includes("L3")) {
    const recipes = db
      .prepare(
        `SELECT id, goal, description, required_services, steps, gotchas
         FROM recipes
         LIMIT ?`
      )
      .all(maxPerLevel) as RecipeRow[];

    for (const recipe of recipes) {
      // Use the first service in the recipe as the service_id for attribution
      let serviceIds: string[] = [];
      try {
        serviceIds = JSON.parse(recipe.required_services);
      } catch {
        continue;
      }
      if (serviceIds.length === 0) continue;

      tasks.push({
        service_id: serviceIds[0],
        service_name: recipe.goal,
        level: "L3",
        model: LEVEL_MODEL_MAP.L3,
        task_type: "recipe_simulation",
        payload: {
          goal: recipe.goal,
          description: recipe.description,
          required_services: recipe.required_services,
          steps: recipe.steps,
          gotchas: recipe.gotchas,
        },
      });
    }
    console.log(`[army] L3 tasks: ${recipes.length}`);
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Result recording
// ---------------------------------------------------------------------------
function recordResult(db: Database.Database, result: TestResult): void {
  const cost =
    result.cost_usd ??
    estimateCost(
      result.model,
      result.input_tokens ?? 0,
      result.output_tokens ?? 0
    );

  // Insert outcome
  db.prepare(
    `INSERT INTO outcomes
       (service_id, agent_id_hash, success, latency_ms, error_type,
        context_masked, model_name, agent_type, task_type,
        input_tokens, output_tokens, cost_usd)
     VALUES (?, 'agent-army', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    result.service_id,
    result.success ? 1 : 0,
    result.latency_ms,
    result.error_type ?? null,
    result.context ?? null,
    result.model,
    result.model.startsWith("claude")
      ? "claude"
      : result.model.startsWith("gpt")
        ? "gpt"
        : "gemini",
    result.task_type,
    result.input_tokens ?? null,
    result.output_tokens ?? null,
    cost ?? null
  );

  // Update service_stats
  db.prepare(
    `INSERT INTO service_stats (service_id, total_calls, success_rate, avg_latency_ms, unique_agents)
     VALUES (?, 1, ?, ?, 1)
     ON CONFLICT(service_id) DO UPDATE SET
       total_calls = total_calls + 1,
       success_rate = (success_rate * total_calls + ?) / (total_calls + 1),
       avg_latency_ms = (avg_latency_ms * total_calls + ?) / (total_calls + 1),
       last_updated = datetime('now')`
  ).run(
    result.service_id,
    result.success ? 1.0 : 0.0,
    result.latency_ms,
    result.success ? 1.0 : 0.0,
    result.latency_ms
  );

  // Update model_service_stats
  db.prepare(
    `INSERT INTO model_service_stats
       (service_id, model_name, task_type, total_calls, success_count,
        success_rate, avg_latency_ms, avg_cost_usd, avg_input_tokens, avg_output_tokens)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(service_id, model_name, task_type) DO UPDATE SET
       total_calls = total_calls + 1,
       success_count = success_count + ?,
       success_rate = CAST(success_count + ? AS REAL) / (total_calls + 1),
       avg_latency_ms = (avg_latency_ms * total_calls + ?) / (total_calls + 1),
       avg_cost_usd = (avg_cost_usd * total_calls + ?) / (total_calls + 1),
       avg_input_tokens = (avg_input_tokens * total_calls + ?) / (total_calls + 1),
       avg_output_tokens = (avg_output_tokens * total_calls + ?) / (total_calls + 1),
       last_updated = datetime('now')`
  ).run(
    result.service_id,
    result.model,
    result.task_type,
    result.success ? 1 : 0,
    result.success ? 1.0 : 0.0,
    result.latency_ms,
    cost ?? 0,
    result.input_tokens ?? 0,
    result.output_tokens ?? 0,
    // ON CONFLICT params:
    result.success ? 1 : 0,
    result.success ? 1 : 0,
    result.latency_ms,
    cost ?? 0,
    result.input_tokens ?? 0,
    result.output_tokens ?? 0
  );
}

// ---------------------------------------------------------------------------
// Execution engine
// ---------------------------------------------------------------------------
async function executeTask(
  task: TestTask,
  adapters: Map<ModelId, ReturnType<typeof createAdapter>>
): Promise<TestResult> {
  if (task.level === "L1") {
    return runL1(task);
  }

  // Try primary model, fall back to any available adapter
  let adapter = adapters.get(task.model);
  if (!adapter) {
    // Fallback: use any available adapter
    const fallback = adapters.values().next().value;
    if (!fallback) {
      return {
        service_id: task.service_id,
        model: task.model,
        level: task.level,
        task_type: task.task_type,
        success: false,
        latency_ms: 0,
        error_type: "no_adapter",
        context: `No API key configured for ${task.model} (or any model)`,
      };
    }
    adapter = fallback;
    // Record with actual model used, not the planned one
    task = { ...task, model: adapter.modelId };
  }

  if (task.level === "L2") {
    return runL2(task, adapter);
  }
  if (task.level === "L3") {
    return runL3(task, adapter);
  }

  throw new Error(`Unknown level: ${task.level}`);
}

async function runBatch(
  tasks: TestTask[],
  adapters: Map<ModelId, ReturnType<typeof createAdapter>>,
  db: Database.Database,
  summary: ArmySummary
): Promise<void> {
  // Process in batches with concurrency limit
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((task) => executeTask(task, adapters))
    );

    for (const result of results) {
      summary.completed++;
      if (result.status === "fulfilled") {
        const r = result.value;
        try {
          recordResult(db, r);
        } catch (dbErr) {
          console.error(`[army] DB write error for ${r.service_id}:`, dbErr);
        }

        if (r.success) summary.successes++;
        else summary.failures++;

        const cost = r.cost_usd ?? estimateCost(r.model, r.input_tokens ?? 0, r.output_tokens ?? 0) ?? 0;
        summary.cost_usd += cost;

        // Track by model
        const modelStats = summary.by_model[r.model] ??= { calls: 0, successes: 0, cost: 0 };
        modelStats.calls++;
        if (r.success) modelStats.successes++;
        modelStats.cost += cost;

        // Track by level
        const levelStats = summary.by_level[r.level] ??= { calls: 0, successes: 0 };
        levelStats.calls++;
        if (r.success) levelStats.successes++;
      } else {
        summary.errors++;
        console.error(`[army] Task error:`, result.reason);
      }
    }

    // Progress report every 50 tasks
    if (summary.completed % 50 === 0 || summary.completed === tasks.length) {
      console.log(
        `[army] progress: ${summary.completed}/${tasks.length} ` +
        `(✓${summary.successes} ✗${summary.failures} err:${summary.errors}) ` +
        `$${summary.cost_usd.toFixed(4)}`
      );
    }

    // Rate limit pause between batches
    if (i + CONCURRENCY < tasks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv);
  const dryRun = Boolean(flags["dry-run"]);
  const maxPerLevel = flags["max"] ? Number(flags["max"]) : DEFAULT_MAX;

  // Parse levels
  let levels: TestLevel[] = ["L1", "L2", "L3"];
  if (flags["level"]) {
    levels = (flags["level"] as string).split(",") as TestLevel[];
  }

  console.log(`[army] Agent Army starting | levels=${levels.join(",")} max=${maxPerLevel} dryRun=${dryRun}`);

  // Initialize DB
  const dbPath = process.env.DB_PATH || "kansei-link.db";
  const db = new Database(dbPath);
  initializeDb(db);

  // Build task queue
  const tasks = buildTasks(db, levels, maxPerLevel);
  console.log(`[army] Total tasks: ${tasks.length}`);

  if (dryRun) {
    console.log(`[army] Dry run — showing first 20 tasks:`);
    for (const t of tasks.slice(0, 20)) {
      console.log(`  ${t.level} | ${t.service_id} (${t.service_name}) | model=${t.model}`);
    }
    const breakdown = tasks.reduce(
      (acc, t) => {
        acc[t.level] = (acc[t.level] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    console.log(`[army] Level breakdown:`, breakdown);
    db.close();
    return;
  }

  // Initialize model adapters — try all known models for fallback support
  const ALL_MODELS: ModelId[] = ["gemini-2.0-flash", "gpt-4o-mini", "claude-haiku-3.5", "claude-sonnet-4"];
  const adapters = new Map<ModelId, ReturnType<typeof createAdapter>>();
  for (const modelId of ALL_MODELS) {
    if (modelId === "gemini-2.0-flash" && levels.every((l) => l === "L1")) {
      continue;
    }
    try {
      adapters.set(modelId, createAdapter(modelId));
      console.log(`[army] ✓ ${modelId} adapter ready`);
    } catch (err) {
      console.warn(`[army] ✗ ${modelId}: ${(err as Error).message}`);
    }
  }

  // Run
  const summary: ArmySummary = {
    total_tasks: tasks.length,
    completed: 0,
    successes: 0,
    failures: 0,
    errors: 0,
    cost_usd: 0,
    by_model: {},
    by_level: {},
    duration_ms: 0,
  };

  const startTime = Date.now();
  await runBatch(tasks, adapters, db, summary);
  summary.duration_ms = Date.now() - startTime;

  // Final report
  console.log(`
============================================
[army] AGENT ARMY REPORT
  Tasks:      ${summary.total_tasks}
  Completed:  ${summary.completed}
  Successes:  ${summary.successes} (${(summary.successes / Math.max(summary.completed, 1) * 100).toFixed(1)}%)
  Failures:   ${summary.failures}
  Errors:     ${summary.errors}
  Cost:       $${summary.cost_usd.toFixed(4)}
  Duration:   ${(summary.duration_ms / 1000).toFixed(1)}s

  By Model:
${Object.entries(summary.by_model)
  .map(([m, s]) => `    ${m}: ${s.calls} calls, ${s.successes} success, $${s.cost.toFixed(4)}`)
  .join("\n")}

  By Level:
${Object.entries(summary.by_level)
  .map(([l, s]) => `    ${l}: ${s.calls} calls, ${s.successes} success (${(s.successes / Math.max(s.calls, 1) * 100).toFixed(1)}%)`)
  .join("\n")}
============================================
`);

  db.close();
}

// Run as CLI
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/") ?? "");
if (isDirectRun) {
  main().catch((err) => {
    console.error("[army] fatal:", err);
    process.exit(1);
  });
}

export { buildTasks, runBatch, recordResult };
