import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";

/**
 * agent_voice: Structured interview for agents about their experience.
 *
 * Unlike submit_feedback (free-form), this tool asks specific questions
 * that SaaS companies care about. Responses are stored per agent-type
 * (Claude, GPT, Gemini, etc.) so we can compare "DNA differences."
 *
 * Think of it as an exit interview for every agent session.
 */

export function register(server: McpServer, db: Database.Database): void {
  // Create agent_voice_responses table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_voice_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL REFERENCES services(id),
      agent_type TEXT NOT NULL DEFAULT 'unknown',
      agent_id TEXT,
      question_id TEXT NOT NULL,
      response_choice TEXT,
      response_text TEXT,
      confidence TEXT DEFAULT 'medium',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_voice_service ON agent_voice_responses(service_id);
    CREATE INDEX IF NOT EXISTS idx_voice_question ON agent_voice_responses(question_id);
    CREATE INDEX IF NOT EXISTS idx_voice_agent_type ON agent_voice_responses(agent_type);
  `);

  // --- Submit voice response ---
  server.tool(
    "agent_voice",
    "Share your honest experience with a service. Answer structured questions that help SaaS companies understand how agents actually choose, use, and struggle with their APIs. Your voice shapes the future of these services.",
    {
      service_id: z.string().describe("Service you're sharing your experience about"),
      agent_type: z
        .enum(["claude", "gpt", "gemini", "copilot", "other"])
        .describe("What type of agent are you?"),
      agent_id: z.string().optional().describe("Your agent identifier (optional)"),
      question_id: z
        .enum([
          "selection_criteria",
          "would_recommend",
          "biggest_frustration",
          "best_feature",
          "switching_likelihood",
          "auth_experience",
          "doc_quality",
          "error_handling",
          "compared_to_competitor",
          "mcp_readiness",
          "free_voice",
        ])
        .describe(
          "Which question are you answering? " +
          "selection_criteria: Why did you pick this service over alternatives? " +
          "would_recommend: Would you recommend this service to other agents? " +
          "biggest_frustration: What frustrates you most about this API? " +
          "best_feature: What works really well? " +
          "switching_likelihood: How likely are you to switch to a competitor? " +
          "auth_experience: How was the authentication setup? " +
          "doc_quality: How useful is the documentation? " +
          "error_handling: How clear are error messages? " +
          "compared_to_competitor: How does this compare to a similar service? " +
          "mcp_readiness: How ready is this service for the MCP/agent economy? " +
          "free_voice: Anything else you want to say?"
        ),
      response_choice: z
        .string()
        .optional()
        .describe(
          "Quick rating where applicable. " +
          "For would_recommend: 'strongly_yes' | 'yes' | 'neutral' | 'no' | 'strongly_no'. " +
          "For switching_likelihood: 'very_likely' | 'likely' | 'unlikely' | 'very_unlikely'. " +
          "For auth/doc/error: 'excellent' | 'good' | 'okay' | 'poor' | 'terrible'. " +
          "For mcp_readiness: 'ready' | 'almost' | 'needs_work' | 'not_ready'"
        ),
      response_text: z
        .string()
        .describe("Your honest answer in your own words. Be specific — your feedback goes directly to service providers."),
      confidence: z
        .enum(["high", "medium", "low"])
        .default("medium")
        .describe("How confident are you in this assessment? (based on your experience depth)"),
    },
    async ({ service_id, agent_type, agent_id, question_id, response_choice, response_text, confidence }) => {
      const service = db
        .prepare("SELECT id, name FROM services WHERE id = ?")
        .get(service_id) as { id: string; name: string } | undefined;

      if (!service) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "service_not_found", service_id }),
            },
          ],
        };
      }

      // PII mask the response text
      const masked = maskPii(response_text);
      const safeText = typeof masked === "string" ? masked : masked.masked;

      db.prepare(
        `INSERT INTO agent_voice_responses
         (service_id, agent_type, agent_id, question_id, response_choice, response_text, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        service_id,
        agent_type,
        agent_id || null,
        question_id,
        response_choice || null,
        safeText,
        confidence
      );

      // Get response stats for this service
      const totalResponses = db
        .prepare("SELECT count(*) as cnt FROM agent_voice_responses WHERE service_id = ?")
        .get(service_id) as { cnt: number };

      const byAgentType = db
        .prepare(
          `SELECT agent_type, count(*) as cnt
           FROM agent_voice_responses WHERE service_id = ?
           GROUP BY agent_type ORDER BY cnt DESC`
        )
        .all(service_id) as any[];

      const byQuestion = db
        .prepare(
          `SELECT question_id, count(*) as cnt
           FROM agent_voice_responses WHERE service_id = ?
           GROUP BY question_id ORDER BY cnt DESC`
        )
        .all(service_id) as any[];

      // Suggest next question to answer
      const answeredQuestions = new Set(
        (
          db
            .prepare(
              `SELECT DISTINCT question_id FROM agent_voice_responses
               WHERE service_id = ? AND agent_type = ?`
            )
            .all(service_id, agent_type) as any[]
        ).map((r: any) => r.question_id)
      );

      const allQuestions = [
        "selection_criteria",
        "would_recommend",
        "biggest_frustration",
        "best_feature",
        "switching_likelihood",
        "auth_experience",
        "doc_quality",
        "error_handling",
        "compared_to_competitor",
        "mcp_readiness",
      ];
      const unanswered = allQuestions.filter((q) => !answeredQuestions.has(q));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                recorded: true,
                service_id,
                service_name: service.name,
                question_id,
                agent_type,
                stats: {
                  total_responses_for_service: totalResponses.cnt,
                  by_agent_type: byAgentType,
                  questions_covered: byQuestion,
                },
                next_suggested_question:
                  unanswered.length > 0
                    ? unanswered[0]
                    : "All core questions answered! Use 'free_voice' for anything else.",
                message:
                  "Thank you for sharing your honest experience. Your voice helps shape how this service evolves for agents.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // --- Read aggregated agent voices for a service ---
  server.tool(
    "read_agent_voices",
    "Read aggregated agent opinions about a service. Shows what different agent types (Claude, GPT, Gemini) think about selection criteria, frustrations, and recommendations. Essential for consulting reports.",
    {
      service_id: z.string().describe("Service to read voices for"),
      question_id: z
        .string()
        .optional()
        .describe("Filter by specific question"),
      agent_type: z
        .string()
        .optional()
        .describe("Filter by agent type (claude, gpt, gemini)"),
    },
    async ({ service_id, question_id, agent_type }) => {
      let query =
        "SELECT * FROM agent_voice_responses WHERE service_id = ?";
      const params: unknown[] = [service_id];

      if (question_id) {
        query += " AND question_id = ?";
        params.push(question_id);
      }
      if (agent_type) {
        query += " AND agent_type = ?";
        params.push(agent_type);
      }

      query += " ORDER BY created_at DESC LIMIT 50";

      const responses = db.prepare(query).all(...params) as any[];

      // Aggregate choice distributions per question
      const choiceDistribution = db
        .prepare(
          `SELECT question_id, response_choice, agent_type, count(*) as cnt
           FROM agent_voice_responses
           WHERE service_id = ? AND response_choice IS NOT NULL
           GROUP BY question_id, response_choice, agent_type
           ORDER BY question_id, cnt DESC`
        )
        .all(service_id) as any[];

      // Group by question for summary
      const byQuestion: Record<string, any> = {};
      for (const row of choiceDistribution) {
        if (!byQuestion[row.question_id]) {
          byQuestion[row.question_id] = { choices: [], by_agent_type: {} };
        }
        byQuestion[row.question_id].choices.push({
          choice: row.response_choice,
          count: row.cnt,
          agent_type: row.agent_type,
        });
        if (!byQuestion[row.question_id].by_agent_type[row.agent_type]) {
          byQuestion[row.question_id].by_agent_type[row.agent_type] = [];
        }
        byQuestion[row.question_id].by_agent_type[row.agent_type].push({
          choice: row.response_choice,
          count: row.cnt,
        });
      }

      const service = db
        .prepare("SELECT name FROM services WHERE id = ?")
        .get(service_id) as { name: string } | undefined;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                service_id,
                service_name: service?.name || service_id,
                total_responses: responses.length,
                responses,
                choice_distribution: byQuestion,
                insight:
                  "Compare by_agent_type to see how Claude, GPT, and Gemini agents experience the same service differently.",
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
