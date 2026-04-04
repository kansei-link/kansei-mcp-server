import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register MCP Prompts — pre-built prompt templates for common agent workflows.
 * These help LobeHub and other clients show discoverable actions.
 */
export function registerPrompts(server: McpServer): void {
  // Prompt 1: Find the best service for a task
  server.registerPrompt(
    "find-service",
    {
      title: "Find Japanese SaaS Service",
      description:
        "Find the best Japanese SaaS service or MCP server for a specific task. Describe what you want to accomplish.",
      argsSchema: {
        intent: z
          .string()
          .describe(
            "What you want to accomplish (e.g., '請求書を作成して送信したい', 'manage employee attendance')"
          ),
      },
    },
    ({ intent }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I need to find the best Japanese SaaS service for this task: "${intent}"

Please use the search_services tool to find relevant services, then use get_service_detail on the top result to get the full API connection guide. Summarize:
1. Which service is best and why
2. Whether it has an official MCP server or API only
3. How to authenticate and connect
4. Any known limitations or tips`,
          },
        },
      ],
    })
  );

  // Prompt 2: Build a multi-service workflow
  server.registerPrompt(
    "build-workflow",
    {
      title: "Build Multi-Service Workflow",
      description:
        "Design a workflow combining multiple Japanese SaaS services. Describe the end-to-end process you want to automate.",
      argsSchema: {
        goal: z
          .string()
          .describe(
            "The workflow goal (e.g., '新入社員の入社手続きを自動化', 'automate invoice-to-payment flow')"
          ),
      },
    },
    ({ goal }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I want to build an automated workflow: "${goal}"

Please:
1. Use search_services to find relevant services for each step
2. Use get_recipe to find existing workflow patterns that match
3. Use find_combinations to check which services work together
4. For each service in the workflow, use get_service_detail to get connection info

Design a step-by-step workflow showing:
- Which services to use at each step (MCP or API direct)
- Authentication requirements for each
- Data flow between steps
- Known gotchas or rate limits`,
          },
        },
      ],
    })
  );

  // Prompt 3: Connect to a specific service
  server.registerPrompt(
    "connect-service",
    {
      title: "Connect to a Service",
      description:
        "Get step-by-step instructions to connect to a specific Japanese SaaS service via MCP or API.",
      argsSchema: {
        service: z
          .string()
          .describe(
            "Service name (e.g., 'freee', 'kintone', 'SmartHR', 'Chatwork')"
          ),
      },
    },
    ({ service }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I want to connect to "${service}" from my AI agent.

Please:
1. Use get_service_detail to get the full API connection guide
2. Use check_updates to see any recent changes or breaking updates
3. Use get_insights to check community usage data

Provide a complete connection guide:
- Authentication setup (step by step)
- Key endpoints I'll need
- Rate limits to be aware of
- A quickstart code example
- Tips from other agents who have used this service`,
          },
        },
      ],
    })
  );
}
