import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

interface RecipeRow {
  id: string;
  goal: string;
  description: string | null;
  steps: string;
  required_services: string;
}

interface ServiceInfo {
  id: string;
  name: string;
  namespace: string | null;
}

interface Step {
  order: number;
  service_id: string;
  action: string;
  input_mapping: unknown;
  output_mapping: unknown;
  error_hint: string;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "find_combinations",
    {
      title: "Find Combinations",
      description:
        "Reverse recipe lookup — given a service or MCP name, find all recipes that include it and show what other services it can be combined with.",
      inputSchema: z.object({
        service: z
          .string()
          .describe(
            "The service name or ID to look up (e.g., 'freee', 'freee-mcp', 'chatwork')"
          ),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ service }) => {
      const results = findCombinations(db, service);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );
}

export function findCombinations(
  db: Database.Database,
  service: string
): object[] {
  const pattern = `%${service}%`;

  // Find all recipes where the service appears in steps or required_services
  const recipes = db
    .prepare(
      `SELECT * FROM recipes
       WHERE steps LIKE ? OR required_services LIKE ?`
    )
    .all(pattern, pattern) as RecipeRow[];

  if (recipes.length === 0) {
    return [];
  }

  // Also try to resolve the service against the services table for richer matching
  const matchedServices = db
    .prepare(
      `SELECT id, name, namespace FROM services
       WHERE id LIKE ? OR name LIKE ?`
    )
    .all(pattern, pattern) as ServiceInfo[];

  const matchedIds = new Set(matchedServices.map((s) => s.id));

  // Cache for service lookups
  const serviceCache = new Map<string, ServiceInfo>();
  const getService = (id: string): ServiceInfo | null => {
    if (serviceCache.has(id)) return serviceCache.get(id)!;
    const svc = db
      .prepare("SELECT id, name, namespace FROM services WHERE id = ?")
      .get(id) as ServiceInfo | undefined;
    if (svc) serviceCache.set(id, svc);
    return svc ?? null;
  };

  // Pre-populate cache with matched services
  for (const svc of matchedServices) {
    serviceCache.set(svc.id, svc);
  }

  const results: object[] = [];

  for (const recipe of recipes) {
    const steps = JSON.parse(recipe.steps) as Step[];
    const requiredServices = JSON.parse(recipe.required_services) as string[];

    // Find which steps involve the queried service (by ID match or text match)
    const matchingSteps = steps.filter((step) => {
      if (matchedIds.has(step.service_id)) return true;
      if (step.service_id.toLowerCase().includes(service.toLowerCase()))
        return true;
      return false;
    });

    // If no steps match, skip (the LIKE matched on something unrelated)
    if (matchingSteps.length === 0) continue;

    // Build the role description for the matched service
    const roles = matchingSteps.map((step) => ({
      step_order: step.order,
      action: step.action,
      service_id: step.service_id,
      service_name: getService(step.service_id)?.name ?? step.service_id,
    }));

    // Find the other services in this recipe (the combinations)
    const matchingServiceIds = new Set(matchingSteps.map((s) => s.service_id));
    const otherServices = requiredServices
      .filter((id) => !matchingServiceIds.has(id))
      .map((id) => {
        const svc = getService(id);
        return {
          id,
          name: svc?.name ?? id,
          namespace: svc?.namespace ?? null,
        };
      });

    results.push({
      recipe_id: recipe.id,
      recipe_name: recipe.goal,
      description: recipe.description,
      role_in_recipe: roles,
      combines_with: otherServices,
      total_services_needed: requiredServices.length,
      coverage_hint: `You have 1 of ${requiredServices.length} services needed`,
    });
  }

  return results;
}
