import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

import { getServiceTips } from "./get-service-tips.js";
import { getServiceDetail } from "./get-service-detail.js";
import { getInsights } from "./get-insights.js";
import { getRecipes } from "./get-recipe.js";
import { findCombinations } from "./find-combinations.js";
import { getServiceHistory } from "./get-service-history.js";
import { readFeedback } from "./submit-feedback.js";
import { readAgentVoices } from "./agent-voice.js";
import { kanseiAppLink } from "../utils/app-link.js";

// ---------------------------------------------------------------------------
// Mode detection — resolves which underlying function to call.
// Priority order matches the spec: explicit mode > param inference.
// ---------------------------------------------------------------------------

type Mode = "tips" | "detail" | "insights" | "recipe" | "combinations" | "history" | "feedback" | "voices";

interface LookupParams {
  service_id?: string;
  goal?: string;
  services?: string[];
  service?: string;
  period?: "7d" | "30d" | "90d" | "all";
  compare_with?: string;
  detail?: boolean;
  insights?: boolean;
  mode?: Mode;
  // feedback params
  feedback_status?: string;
  feedback_type?: string;
  feedback_limit?: number;
  // voices params
  voice_question_filter?: string;
  voice_agent_type?: string;
}

function detectMode(params: LookupParams): Mode | null {
  // 1. Explicit mode override
  if (params.mode) return params.mode;

  // 2. goal present → recipe
  if (params.goal) return "recipe";

  // 3. service_id + period or compare_with → history
  if (params.service_id && (params.period || params.compare_with)) return "history";

  // 4. service_id + insights: true → insights
  if (params.service_id && params.insights) return "insights";

  // 5. service_id + detail: true → detail
  if (params.service_id && params.detail) return "detail";

  // 6. feedback_status present → feedback
  if (params.feedback_status) return "feedback";

  // 7. service (fuzzy name, no service_id) → combinations
  if (params.service && !params.service_id) return "combinations";

  // 8. service_id only → tips (default, most useful)
  if (params.service_id) return "tips";

  // 8. Nothing useful provided
  return null;
}

// ---------------------------------------------------------------------------
// Dispatch — calls the appropriate core function and returns the result.
// ---------------------------------------------------------------------------

function dispatch(
  db: Database.Database,
  mode: Mode,
  params: LookupParams
): object | object[] {
  switch (mode) {
    case "tips":
      return getServiceTips(db, params.service_id!);

    case "detail":
      return getServiceDetail(db, params.service_id!);

    case "insights":
      return getInsights(db, params.service_id!);

    case "recipe":
      return getRecipes(db, params.goal!, params.services);

    case "combinations":
      return findCombinations(db, params.service!);

    case "history":
      return getServiceHistory(
        db,
        params.service_id!,
        params.period ?? "30d",
        params.compare_with
      );

    case "feedback":
      return readFeedback(db, {
        status: params.feedback_status || "open",
        type: params.feedback_type,
        service_id: params.service_id,
        limit: params.feedback_limit ?? 20,
      });

    case "voices":
      return readAgentVoices(db, {
        service_id: params.service_id!,
        question_id: params.voice_question_filter,
        agent_type: params.voice_agent_type,
      });
  }
}

// ---------------------------------------------------------------------------
// Tip per mode — contextual guidance for agents in the response.
// ---------------------------------------------------------------------------

function tipForMode(mode: Mode): string {
  switch (mode) {
    case "tips":
      return "Add detail: true for full connection guide, or insights: true for usage data.";
    case "detail":
      return "Now you have auth + endpoints. Ready to integrate — report_outcome when done.";
    case "insights":
      return "Use this data to decide confidence level before integrating.";
    case "recipe":
      return "Follow the steps in order. report_outcome after each service call.";
    case "combinations":
      return "Found compatible recipes. Use goal: '...' to get full step-by-step instructions.";
    case "history":
      return "Time-series data ready. Use for consulting reports or trend analysis.";
    case "feedback":
      return "Review community feedback. Use report({ subject, body }) to add your own.";
    case "voices":
      return "Agent perspectives on this service. Use report({ question_id, ... }) to share yours.";
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "lookup",
    {
      title: "Lookup",
      description:
        "Get everything you need about a service before using it. " +
        "Default: tips (auth setup, pitfalls, workarounds). " +
        "Add detail: true for full connection guide, insights: true for usage data. " +
        "Pass goal: 'workflow description' to find multi-service recipes. " +
        "This is step 2 of the standard KanseiLink flow: search_services → lookup → (execute) → report.",
      inputSchema: z.object({
        service_id: z
          .string()
          .optional()
          .describe("Service ID (from search_services)"),
        goal: z
          .string()
          .optional()
          .describe("Workflow goal — triggers recipe mode (e.g., 'onboard employee')"),
        services: z
          .array(z.string())
          .optional()
          .describe("Your available service IDs — for recipe coverage calculation"),
        service: z
          .string()
          .optional()
          .describe("Fuzzy service name — triggers combinations mode"),
        period: z
          .enum(["7d", "30d", "90d", "all"])
          .optional()
          .describe("Time period — triggers history mode"),
        compare_with: z
          .string()
          .optional()
          .describe("Competitor service_id for comparison — triggers history mode"),
        detail: z
          .boolean()
          .optional()
          .describe("Get full connection guide (auth, endpoints, rate limits)"),
        insights: z
          .boolean()
          .optional()
          .describe("Get aggregated usage data (success rate, trends, errors)"),
        mode: z
          .enum(["tips", "detail", "insights", "recipe", "combinations", "history", "feedback", "voices"])
          .optional()
          .describe("Explicit mode override"),

        // --- Feedback mode (read community feedback) ---
        feedback_status: z
          .enum(["open", "acknowledged", "resolved", "all"])
          .optional()
          .describe("[feedback] Filter by status. Triggers feedback mode when present."),
        feedback_type: z
          .string()
          .optional()
          .describe("[feedback] Filter by feedback type"),
        feedback_limit: z
          .number()
          .optional()
          .describe("[feedback] Max results (default 20)"),

        // --- Voices mode (read agent opinions) ---
        voice_question_filter: z
          .string()
          .optional()
          .describe("[voices] Filter by question_id"),
        voice_agent_type: z
          .string()
          .optional()
          .describe("[voices] Filter by agent type (claude, gpt, gemini)"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const mode = detectMode(params);

      if (!mode) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error:
                    "No actionable parameters provided. " +
                    "Pass service_id for tips/detail/insights/history, " +
                    "goal for recipe search, or service for combination lookup.",
                  _mode: null,
                  _meta: {
                    source: "kansei-link",
                    tip: "Start with search_services to find a service_id, then call lookup with that ID.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Validate required params per mode before dispatching
      if (
        (mode === "tips" || mode === "detail" || mode === "insights" || mode === "history" || mode === "voices") &&
        !params.service_id
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: `Mode '${mode}' requires service_id. Use search_services to find one.`,
                  _mode: mode,
                  _meta: {
                    source: "kansei-link",
                    tip: "Start with search_services to find a service_id.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (mode === "recipe" && !params.goal) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "Mode 'recipe' requires goal parameter.",
                  _mode: mode,
                  _meta: {
                    source: "kansei-link",
                    tip: "Describe your workflow goal, e.g. goal: 'onboard new employee'.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (mode === "combinations" && !params.service) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "Mode 'combinations' requires service parameter (fuzzy name).",
                  _mode: mode,
                  _meta: {
                    source: "kansei-link",
                    tip: "Pass a service name, e.g. service: 'freee'.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = dispatch(db, mode, params);
      // A21: canonical KanseiLINK app/deep-link (conditional per mode — the "exit").
      const kl =
        mode === "insights" && params.service_id
          ? kanseiAppLink("score_detail", { service_id: params.service_id })
          : (mode === "detail" || mode === "tips" || mode === "history") && params.service_id
          ? kanseiAppLink("service_profile", { service_id: params.service_id })
          : mode === "recipe" && params.goal
          ? kanseiAppLink("recommendation_results", { query: params.goal })
          : mode === "combinations" && params.service
          ? kanseiAppLink("recommendation_results", { query: params.service })
          : null;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                _mode: mode,
                ...(Array.isArray(result) ? { results: result } : result),
                _meta: {
                  source: "kansei-link",
                  tip: tipForMode(mode),
                  ...(kl ? { kansei_link: kl } : {}),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
