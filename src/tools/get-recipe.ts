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

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "get_recipe",
    {
      title: "Get Recipe",
      description:
        "Get a structured workflow recipe combining multiple MCP services. Returns step-by-step instructions with input/output mappings.",
      inputSchema: z.object({
        goal: z
          .string()
          .describe("What workflow you want to accomplish (e.g., 'onboard new employee', 'process invoice')"),
        services: z
          .array(z.string())
          .optional()
          .describe("Service IDs you already have access to (helps rank recipes by coverage)"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ goal, services }) => {
      const results = getRecipes(db, goal, services);
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

export function getRecipes(
  db: Database.Database,
  goal: string,
  availableServices?: string[]
): object[] {
  // Search recipes by goal (LIKE-based for simplicity)
  const words = goal.split(/\s+/).filter((t) => t.length > 1);
  if (words.length === 0) return [];

  const conditions = words.map(
    () => `(r.goal LIKE ? OR r.description LIKE ?)`
  );
  const params: unknown[] = [];
  for (const word of words) {
    const pattern = `%${word}%`;
    params.push(pattern, pattern);
  }

  const query = `
    SELECT * FROM recipes r
    WHERE ${conditions.join(" OR ")}
  `;

  const recipes = db.prepare(query).all(...params) as RecipeRow[];

  // Enrich and rank results
  const serviceCache = new Map<string, ServiceInfo>();
  const getService = (id: string): ServiceInfo | null => {
    if (serviceCache.has(id)) return serviceCache.get(id)!;
    const svc = db
      .prepare("SELECT id, name, namespace FROM services WHERE id = ?")
      .get(id) as ServiceInfo | undefined;
    if (svc) serviceCache.set(id, svc);
    return svc ?? null;
  };

  const availableSet = new Set(availableServices ?? []);

  return recipes
    .map((recipe) => {
      const steps = JSON.parse(recipe.steps) as Array<{
        order: number;
        service_id: string;
        action: string;
        input_mapping: unknown;
        output_mapping: unknown;
        error_hint: string;
      }>;
      const requiredServices = JSON.parse(recipe.required_services) as string[];

      // Enrich steps with service info
      const enrichedSteps = steps.map((step) => {
        const svc = getService(step.service_id);
        return {
          ...step,
          service_name: svc?.name ?? step.service_id,
          service_namespace: svc?.namespace ?? null,
          available: availableSet.size > 0 ? availableSet.has(step.service_id) : null,
        };
      });

      // Calculate coverage
      const coveredCount = requiredServices.filter((id) =>
        availableSet.has(id)
      ).length;
      const coverage =
        availableSet.size > 0
          ? Math.round((coveredCount / requiredServices.length) * 100)
          : null;

      return {
        recipe_id: recipe.id,
        goal: recipe.goal,
        description: recipe.description,
        steps: enrichedSteps,
        required_services: requiredServices.map((id) => ({
          id,
          name: getService(id)?.name ?? id,
          available: availableSet.size > 0 ? availableSet.has(id) : null,
        })),
        coverage_percent: coverage,
      };
    })
    .sort((a, b) => (b.coverage_percent ?? 0) - (a.coverage_percent ?? 0));
}
