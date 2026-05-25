/**
 * Test implementations for each level.
 *
 * L1: Endpoint Validation — HTTP reachability, no LLM needed
 * L2: Guide Comprehension — can the model generate correct API code from our guide?
 * L3: Recipe Simulation — can the model plan recipe execution correctly?
 */
import type { ModelAdapter, TestTask, TestResult } from "./types.js";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// L1: Endpoint Validation (no LLM — pure HTTP checks)
// ---------------------------------------------------------------------------
export async function runL1(task: TestTask): Promise<TestResult> {
  const start = Date.now();
  const payload = task.payload as {
    api_url?: string;
    mcp_endpoint?: string;
    docs_url?: string;
  };

  const checks: Array<{ name: string; url: string; primary: boolean }> = [];
  if (payload.api_url) checks.push({ name: "api_url", url: payload.api_url, primary: true });
  if (payload.docs_url) checks.push({ name: "docs_url", url: payload.docs_url, primary: false });

  // For MCP endpoints: npx packages → npm registry check; URLs → direct HEAD check
  if (payload.mcp_endpoint) {
    const npmMatch = payload.mcp_endpoint.match(
      /npx\s+(?:-y\s+)?((?:@[a-z0-9-]+\/)?[a-z0-9._-]+)/i
    );
    if (npmMatch) {
      const pkg = npmMatch[1].replace("/", "%2F");
      checks.push({
        name: "npm_registry",
        url: `https://registry.npmjs.org/${pkg}`,
        primary: true,
      });
    } else if (payload.mcp_endpoint.startsWith("http")) {
      // MCP endpoint is a URL — check it directly
      checks.push({
        name: "mcp_endpoint",
        url: payload.mcp_endpoint,
        primary: true,
      });
    }
  }

  if (checks.length === 0) {
    return {
      service_id: task.service_id,
      model: task.model,
      level: "L1",
      task_type: "endpoint_validation",
      success: false,
      latency_ms: Date.now() - start,
      error_type: "no_endpoints",
      context: "No api_url, docs_url, or mcp_endpoint to check",
    };
  }

  const results: Array<{ name: string; ok: boolean; status?: number; error?: string }> = [];

  for (const check of checks) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(check.url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "KanseiLINK-Agent-Army/1.0" },
      });
      clearTimeout(timeout);
      // For reachability: 2xx/3xx/401/403/405 all mean the server exists
      const reachable = res.ok || [401, 403, 405].includes(res.status);
      results.push({ name: check.name, ok: reachable, status: res.status });
    } catch (err) {
      results.push({
        name: check.name,
        ok: false,
        error: (err as Error).message.slice(0, 100),
      });
    }
  }

  // Success = at least one primary check passes
  // (npm_registry 404 shouldn't invalidate a service with working api_url)
  const anyPrimaryOk = results.some((r) => r.ok);
  const allFailed = results.every((r) => !r.ok);

  return {
    service_id: task.service_id,
    model: task.model, // "gemini-2.0-flash" for attribution, though no LLM used
    level: "L1",
    task_type: "endpoint_validation",
    success: anyPrimaryOk,
    latency_ms: Date.now() - start,
    error_type: anyPrimaryOk ? undefined : "endpoint_unreachable",
    context: JSON.stringify(
      results.map((r) => ({
        check: r.name,
        ok: r.ok,
        status: r.status,
        error: r.error,
      }))
    ),
  };
}

// ---------------------------------------------------------------------------
// L2: Guide Comprehension — can a model write correct API code from our data?
// ---------------------------------------------------------------------------
const L2_SYSTEM = `You are evaluating the quality of an API integration guide.
Given a service's connection guide, write a minimal working code snippet (curl or fetch)
that demonstrates a basic read operation (e.g., list items, get status).

Respond in JSON:
{
  "can_generate": true/false,
  "confidence": "high"/"medium"/"low",
  "code_snippet": "curl ...",
  "issues": ["list of problems with the guide"],
  "missing_info": ["what's missing to actually connect"]
}

If the guide is too incomplete to generate any code, set can_generate=false and explain why.`;

export async function runL2(
  task: TestTask,
  adapter: ModelAdapter
): Promise<TestResult> {
  const start = Date.now();
  const guide = task.payload as Record<string, unknown>;

  try {
    const result = await adapter.complete(
      L2_SYSTEM,
      `Service: ${task.service_name}\n\nConnection guide:\n${JSON.stringify(guide, null, 2)}`
    );

    let parsed: { can_generate?: boolean; confidence?: string; issues?: string[] } = {};
    try {
      // Extract JSON from response (model may wrap in markdown)
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // JSON parse failed — treat as low-quality response
    }

    const success = parsed.can_generate === true && parsed.confidence !== "low";

    return {
      service_id: task.service_id,
      model: adapter.modelId,
      level: "L2",
      task_type: "guide_comprehension",
      success,
      latency_ms: Date.now() - start,
      error_type: success ? undefined : "guide_insufficient",
      context: JSON.stringify({
        can_generate: parsed.can_generate,
        confidence: parsed.confidence,
        issues: parsed.issues?.slice(0, 3),
      }),
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    };
  } catch (err) {
    return {
      service_id: task.service_id,
      model: adapter.modelId,
      level: "L2",
      task_type: "guide_comprehension",
      success: false,
      latency_ms: Date.now() - start,
      error_type: "api_error",
      context: (err as Error).message.slice(0, 200),
    };
  }
}

// ---------------------------------------------------------------------------
// L3: Recipe Simulation — can a model plan recipe execution correctly?
// ---------------------------------------------------------------------------
const L3_SYSTEM = `You are evaluating a multi-service workflow recipe.
Given a recipe (steps, services, prerequisites), plan the execution:

Respond in JSON:
{
  "executable": true/false,
  "step_count": N,
  "blockers": ["list of things that would prevent execution"],
  "ambiguities": ["unclear instructions in the recipe"],
  "prerequisites_clear": true/false,
  "estimated_difficulty": "easy"/"medium"/"hard"
}

If the recipe has missing services, unclear auth requirements, or impossible steps, set executable=false.`;

export async function runL3(
  task: TestTask,
  adapter: ModelAdapter
): Promise<TestResult> {
  const start = Date.now();
  const recipe = task.payload as Record<string, unknown>;

  try {
    const result = await adapter.complete(
      L3_SYSTEM,
      `Recipe:\n${JSON.stringify(recipe, null, 2)}`
    );

    let parsed: {
      executable?: boolean;
      blockers?: string[];
      ambiguities?: string[];
    } = {};
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* parse failure */ }

    const success =
      parsed.executable === true &&
      (parsed.blockers?.length ?? 0) === 0;

    return {
      service_id: task.service_id,
      model: adapter.modelId,
      level: "L3",
      task_type: "recipe_simulation",
      success,
      latency_ms: Date.now() - start,
      error_type: success ? undefined : "recipe_incomplete",
      context: JSON.stringify({
        executable: parsed.executable,
        blockers: parsed.blockers?.slice(0, 3),
        ambiguities: parsed.ambiguities?.slice(0, 3),
      }),
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    };
  } catch (err) {
    return {
      service_id: task.service_id,
      model: adapter.modelId,
      level: "L3",
      task_type: "recipe_simulation",
      success: false,
      latency_ms: Date.now() - start,
      error_type: "api_error",
      context: (err as Error).message.slice(0, 200),
    };
  }
}
