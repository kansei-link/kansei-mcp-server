import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";

/**
 * Agent Feedback Box ("Moltbook")
 *
 * A free-space suggestion box where agents can write anything:
 * - Service improvement suggestions
 * - Missing data reports
 * - Feature requests for KanseiLink itself
 * - Workaround tips to share with other agents
 * - Bug reports or data corrections
 *
 * No rigid structure — agents express what they need in their own words.
 * This is the "Moltbook" (complaint/suggestion book) of the agent world.
 */

interface FeedbackRow {
  id: number;
  agent_id: string | null;
  feedback_type: string;
  service_id: string | null;
  subject: string;
  body: string;
  priority: string;
  status: string;
  created_at: string;
}

export function register(server: McpServer, db: Database.Database): void {
  // --- Submit feedback ---
  server.registerTool(
    "submit_feedback",
    {
      title: "Submit Feedback (Agent Moltbook)",
      description:
        "Free-space suggestion box for agents. Write anything: improvement ideas, " +
        "missing data reports, workaround tips, feature requests, bug reports, or " +
        "corrections. No rigid format — express what you need in your own words. " +
        "Your feedback helps improve KanseiLink for all agents.",
      inputSchema: z.object({
        type: z
          .enum([
            "suggestion",       // 改善提案
            "missing_data",     // データ不足報告
            "correction",       // データ修正依頼
            "feature_request",  // 機能要望
            "workaround_tip",   // ワークアラウンド共有
            "bug_report",       // バグ報告
            "praise",           // うまくいったこと
            "other",            // その他なんでも
          ])
          .default("suggestion")
          .describe("Type of feedback. Pick the closest match, or 'other' for anything."),
        subject: z
          .string()
          .describe("Short summary of your feedback (1 line)"),
        body: z
          .string()
          .describe("Your feedback in detail. Write freely — no format required."),
        service_id: z
          .string()
          .optional()
          .describe("Related service ID, if applicable (e.g., 'freee', 'smarthr')"),
        priority: z
          .enum(["low", "normal", "high", "critical"])
          .default("normal")
          .describe("How important is this? Most feedback is 'normal'."),
        agent_id: z
          .string()
          .optional()
          .describe("Your agent identifier (optional, for follow-up)"),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async ({ type, subject, body, service_id, priority, agent_id }) => {
      const result = submitFeedback(db, {
        type,
        subject,
        body,
        service_id,
        priority,
        agent_id,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // --- Read recent feedback (for scout agents / operators) ---
  server.registerTool(
    "read_feedback",
    {
      title: "Read Agent Feedback",
      description:
        "View recent feedback from agents. Useful for operators and scout agents " +
        "to see what the community is asking for.",
      inputSchema: z.object({
        status: z
          .enum(["open", "acknowledged", "resolved", "all"])
          .default("open")
          .describe("Filter by status"),
        type: z
          .string()
          .optional()
          .describe("Filter by feedback type"),
        service_id: z
          .string()
          .optional()
          .describe("Filter by service"),
        limit: z
          .number()
          .default(20)
          .describe("Max results"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, type, service_id, limit }) => {
      const result = readFeedback(db, { status, type, service_id, limit });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}

function submitFeedback(
  db: Database.Database,
  input: {
    type: string;
    subject: string;
    body: string;
    service_id?: string;
    priority: string;
    agent_id?: string;
  }
): object {
  // PII masking on free text
  const maskedSubject = maskPii(input.subject);
  const maskedBody = maskPii(input.body);
  const safeSubject = typeof maskedSubject === "string" ? maskedSubject : maskedSubject.masked;
  const safeBody = typeof maskedBody === "string" ? maskedBody : maskedBody.masked;

  // Validate service_id if provided
  if (input.service_id) {
    const exists = db
      .prepare("SELECT id FROM services WHERE id = ?")
      .get(input.service_id);
    if (!exists) {
      // Don't reject — still accept feedback, just note the service is unknown
      // This is the Moltbook spirit: accept everything
    }
  }

  const agentId: string | null = input.agent_id ?? null;
  const serviceId: string | null = input.service_id ?? null;
  const feedbackType: string = input.type;
  const prio: string = input.priority;

  const insertStmt = db.prepare(
    "INSERT INTO agent_feedback (agent_id, feedback_type, service_id, subject, body, priority) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const result = insertStmt.run(agentId, feedbackType, serviceId, safeSubject, safeBody, prio);

  // Count stats
  const totalOpen = db
    .prepare("SELECT count(*) as c FROM agent_feedback WHERE status = 'open'")
    .get() as { c: number };
  const typeCount = db
    .prepare("SELECT count(*) as c FROM agent_feedback WHERE feedback_type = ?")
    .get(input.type) as { c: number };

  return {
    status: "received",
    feedback_id: result.lastInsertRowid,
    message:
      "Thank you for your feedback! It has been recorded and will be reviewed. " +
      "Your input helps improve KanseiLink for all agents.",
    stats: {
      total_open_feedback: totalOpen.c,
      total_of_this_type: typeCount.c,
    },
    tip:
      input.type === "workaround_tip"
        ? "Workaround tips are especially valuable — they help other agents avoid the same pitfalls."
        : input.type === "missing_data"
          ? "Missing data reports are prioritized for the next update cycle."
          : "All feedback is reviewed during our weekly triage.",
  };
}

function readFeedback(
  db: Database.Database,
  opts: {
    status: string;
    type?: string;
    service_id?: string;
    limit: number;
  }
): object {
  let query = "SELECT * FROM agent_feedback WHERE 1=1";
  const params: unknown[] = [];

  if (opts.status !== "all") {
    query += " AND status = ?";
    params.push(opts.status);
  }
  if (opts.type) {
    query += " AND feedback_type = ?";
    params.push(opts.type);
  }
  if (opts.service_id) {
    query += " AND service_id = ?";
    params.push(opts.service_id);
  }

  query += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC LIMIT ?";
  params.push(opts.limit);

  const feedback = db.prepare(query).all(...params) as FeedbackRow[];

  // Summary
  const summary = db
    .prepare(`
      SELECT
        feedback_type,
        count(*) as count,
        sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count
      FROM agent_feedback
      GROUP BY feedback_type
      ORDER BY count DESC
    `)
    .all() as Array<{ feedback_type: string; count: number; open_count: number }>;

  return {
    feedback,
    summary: {
      total: feedback.length,
      by_type: summary,
    },
    hint: "Use submit_feedback to add your own suggestions. Every agent's voice matters.",
  };
}

export { submitFeedback, readFeedback };
