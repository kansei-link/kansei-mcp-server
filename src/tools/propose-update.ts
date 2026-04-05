import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";
import { recalculateTrustScores } from "../utils/trust-recalc.js";

/**
 * Stage 1 Autonomy: PR-model Data Updates
 *
 * Agents propose changes to service data (like a GitHub Pull Request).
 * Michie (or an admin agent) reviews and approves/rejects with one click.
 *
 * Flow:
 *   Agent discovers change → propose_update → pending queue
 *   → Michie reviews → approve → auto-apply + changelog + trust recalc
 *                     → reject → record reason, no changes
 *
 * This is the bridge from Phase 1 (human-maintained) to Phase 2 (agent-augmented).
 */

interface PendingRow {
  id: number;
  service_id: string;
  proposer_agent_id: string;
  change_type: string;
  field_changes: string;
  reason: string;
  evidence_url: string | null;
  status: string;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface ServiceRow {
  id: string;
  name: string;
}

// Fields that agents are allowed to propose changes to
const ALLOWED_FIELDS = [
  "description",
  "category",
  "tags",
  "mcp_endpoint",
  "mcp_status",
  "api_url",
  "api_auth_method",
  "namespace",
] as const;

export function register(server: McpServer, db: Database.Database): void {
  // --- propose_update: Agent proposes a service data change ---
  server.registerTool(
    "propose_update",
    {
      title: "Propose Service Update",
      description:
        "Propose a change to a service's data — like a GitHub Pull Request. " +
        "Use this when you discover that a service has new endpoints, changed APIs, " +
        "updated auth methods, or any other data that should be corrected. " +
        "Your proposal goes into a review queue. Once approved, the change is " +
        "automatically applied and trust scores are recalculated.",
      inputSchema: z.object({
        service_id: z
          .string()
          .describe("ID of the service to update (e.g., 'freee', 'smarthr')"),
        changes: z
          .record(z.string(), z.string())
          .describe(
            "Object of field→new_value pairs to change. Allowed fields: " +
            "description, category, tags, mcp_endpoint, mcp_status, api_url, " +
            "api_auth_method, namespace. Example: {\"mcp_endpoint\": \"https://new-url\", \"tags\": \"accounting,invoice,bulk\"}"
          ),
        reason: z
          .string()
          .describe(
            "Why this change is needed. Be specific: what did you discover? " +
            "Example: 'freee API v2 added /invoices/bulk endpoint for batch operations'"
          ),
        evidence_url: z
          .string()
          .optional()
          .describe(
            "URL to the source of this information (API docs, changelog, blog post)"
          ),
        change_type: z
          .enum(["update", "new_feature", "deprecation", "breaking_change", "fix"])
          .default("update")
          .describe("Type of change being proposed"),
        agent_id: z
          .string()
          .optional()
          .describe("Your agent identifier (optional, for attribution)"),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ service_id, changes, reason, evidence_url, change_type, agent_id }) => {
      const result = proposeUpdate(db, {
        service_id,
        changes,
        reason,
        evidence_url,
        change_type,
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

  // --- review_update: Approve or reject a pending proposal ---
  server.registerTool(
    "review_update",
    {
      title: "Review Pending Update",
      description:
        "Approve or reject a pending service update proposal. " +
        "When approved, changes are automatically applied to the service, " +
        "a changelog entry is created, and trust scores are recalculated. " +
        "This is for operators and admin agents only.",
      inputSchema: z.object({
        proposal_id: z
          .number()
          .describe("ID of the pending update to review"),
        action: z
          .enum(["approve", "reject"])
          .describe("Whether to approve or reject this proposal"),
        reviewer: z
          .string()
          .default("michie")
          .describe("Who is reviewing (default: 'michie')"),
        note: z
          .string()
          .optional()
          .describe("Optional review comment"),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async ({ proposal_id, action, reviewer, note }) => {
      const result = reviewUpdate(db, { proposal_id, action, reviewer, note });
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

  // --- list_pending_updates: View the review queue ---
  server.registerTool(
    "list_pending_updates",
    {
      title: "List Pending Updates",
      description:
        "View the queue of proposed service updates awaiting review. " +
        "Shows all pending proposals ordered by creation date. " +
        "Use review_update to approve or reject individual proposals.",
      inputSchema: z.object({
        status: z
          .enum(["pending", "approved", "rejected", "all"])
          .default("pending")
          .describe("Filter by status (default: pending)"),
        service_id: z
          .string()
          .optional()
          .describe("Filter by service ID"),
        limit: z
          .number()
          .default(20)
          .describe("Max results to return"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, service_id, limit }) => {
      const result = listPendingUpdates(db, { status, service_id, limit });
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

// ──────────────────────────────────────────────────
// Core functions
// ──────────────────────────────────────────────────

function proposeUpdate(
  db: Database.Database,
  input: {
    service_id: string;
    changes: Record<string, string>;
    reason: string;
    evidence_url?: string;
    change_type: string;
    agent_id?: string;
  }
): object {
  // Validate service exists
  const service = db
    .prepare("SELECT id, name FROM services WHERE id = ?")
    .get(input.service_id) as ServiceRow | undefined;

  if (!service) {
    return {
      error: "service_not_found",
      message: `No service with ID '${input.service_id}' found.`,
      suggestion: "Use search_services to find the correct service ID.",
    };
  }

  // Validate fields
  const invalidFields = Object.keys(input.changes).filter(
    (f) => !(ALLOWED_FIELDS as readonly string[]).includes(f)
  );
  if (invalidFields.length > 0) {
    return {
      error: "invalid_fields",
      message: `Cannot propose changes to: ${invalidFields.join(", ")}`,
      allowed_fields: [...ALLOWED_FIELDS],
    };
  }

  if (Object.keys(input.changes).length === 0) {
    return {
      error: "no_changes",
      message: "No field changes provided. Include at least one field to update.",
    };
  }

  // Get current values for comparison
  const currentService = db
    .prepare("SELECT * FROM services WHERE id = ?")
    .get(input.service_id) as Record<string, unknown>;

  const diff: Record<string, { current: unknown; proposed: string }> = {};
  for (const [field, newValue] of Object.entries(input.changes)) {
    diff[field] = {
      current: currentService[field] ?? null,
      proposed: newValue,
    };
  }

  // PII mask the reason
  const maskedReason = maskPii(input.reason);
  const safeReason = typeof maskedReason === "string" ? maskedReason : maskedReason.masked;

  // Check for duplicate pending proposals
  const existing = db
    .prepare(
      "SELECT id FROM pending_updates WHERE service_id = ? AND status = 'pending' AND field_changes = ?"
    )
    .get(input.service_id, JSON.stringify(input.changes)) as { id: number } | undefined;

  if (existing) {
    return {
      status: "duplicate",
      existing_proposal_id: existing.id,
      message: "An identical proposal already exists in the queue.",
    };
  }

  // Insert proposal
  const result = db
    .prepare(
      `INSERT INTO pending_updates
       (service_id, proposer_agent_id, change_type, field_changes, reason, evidence_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.service_id,
      input.agent_id ?? "anonymous",
      input.change_type,
      JSON.stringify(input.changes),
      safeReason,
      input.evidence_url ?? null
    );

  // Count queue
  const queueSize = db
    .prepare("SELECT count(*) as c FROM pending_updates WHERE status = 'pending'")
    .get() as { c: number };

  return {
    status: "proposed",
    proposal_id: result.lastInsertRowid,
    service: { id: service.id, name: service.name },
    change_type: input.change_type,
    diff,
    message:
      `Update proposal #${result.lastInsertRowid} created for ${service.name}. ` +
      "It will be reviewed by an operator. Thank you for keeping KanseiLink accurate!",
    queue: {
      total_pending: queueSize.c,
    },
    next_step:
      "The proposal will be reviewed and either approved (auto-applied) or rejected. " +
      "Use list_pending_updates to check the status.",
  };
}

function reviewUpdate(
  db: Database.Database,
  input: {
    proposal_id: number;
    action: "approve" | "reject";
    reviewer: string;
    note?: string;
  }
): object {
  // Get the proposal
  const proposal = db
    .prepare("SELECT * FROM pending_updates WHERE id = ?")
    .get(input.proposal_id) as PendingRow | undefined;

  if (!proposal) {
    return {
      error: "proposal_not_found",
      message: `No proposal with ID ${input.proposal_id} found.`,
    };
  }

  if (proposal.status !== "pending") {
    return {
      error: "already_reviewed",
      message: `Proposal #${input.proposal_id} was already ${proposal.status} by ${proposal.reviewed_by} at ${proposal.reviewed_at}.`,
    };
  }

  const now = new Date().toISOString();

  if (input.action === "reject") {
    // Simple rejection — update status, done
    db.prepare(
      `UPDATE pending_updates
       SET status = 'rejected', reviewed_by = ?, review_note = ?, reviewed_at = ?
       WHERE id = ?`
    ).run(input.reviewer, input.note ?? null, now, input.proposal_id);

    return {
      status: "rejected",
      proposal_id: input.proposal_id,
      service_id: proposal.service_id,
      reviewer: input.reviewer,
      note: input.note ?? null,
      message: `Proposal #${input.proposal_id} rejected.`,
    };
  }

  // === APPROVE: Apply changes in a transaction ===
  const fieldChanges = JSON.parse(proposal.field_changes) as Record<string, string>;

  const applyTransaction = db.transaction(() => {
    // 1. Apply each field change to the service
    for (const [field, value] of Object.entries(fieldChanges)) {
      // Safety: only update allowed fields
      if ((ALLOWED_FIELDS as readonly string[]).includes(field)) {
        db.prepare(`UPDATE services SET ${field} = ? WHERE id = ?`).run(
          value,
          proposal.service_id
        );
      }
    }

    // 2. Create changelog entry
    const changeTypeToClogType: Record<string, string> = {
      update: "update",
      new_feature: "feature",
      deprecation: "deprecation",
      breaking_change: "breaking",
      fix: "fix",
    };

    db.prepare(
      `INSERT INTO service_changelog (service_id, change_date, change_type, summary, details)
       VALUES (?, date('now'), ?, ?, ?)`
    ).run(
      proposal.service_id,
      changeTypeToClogType[proposal.change_type] ?? "update",
      proposal.reason,
      JSON.stringify({
        applied_changes: fieldChanges,
        proposed_by: proposal.proposer_agent_id,
        approved_by: input.reviewer,
        evidence: proposal.evidence_url,
      })
    );

    // 3. Mark proposal as approved
    db.prepare(
      `UPDATE pending_updates
       SET status = 'approved', reviewed_by = ?, review_note = ?, reviewed_at = ?
       WHERE id = ?`
    ).run(input.reviewer, input.note ?? null, now, input.proposal_id);
  });

  applyTransaction();

  // 4. Recalculate trust scores (outside transaction — read-heavy)
  const trustResult = recalculateTrustScores(db);

  // Get updated service
  const updatedService = db
    .prepare("SELECT id, name, trust_score FROM services WHERE id = ?")
    .get(proposal.service_id) as { id: string; name: string; trust_score: number };

  return {
    status: "approved",
    proposal_id: input.proposal_id,
    service: {
      id: updatedService.id,
      name: updatedService.name,
      trust_score: updatedService.trust_score,
    },
    applied_changes: fieldChanges,
    changelog_added: true,
    trust_recalculated: trustResult.updated > 0,
    reviewer: input.reviewer,
    note: input.note ?? null,
    message:
      `Proposal #${input.proposal_id} approved and applied to ${updatedService.name}. ` +
      "Changelog updated. Trust scores recalculated.",
  };
}

function listPendingUpdates(
  db: Database.Database,
  opts: {
    status: string;
    service_id?: string;
    limit: number;
  }
): object {
  let query = `
    SELECT pu.*, s.name as service_name
    FROM pending_updates pu
    LEFT JOIN services s ON s.id = pu.service_id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (opts.status !== "all") {
    query += " AND pu.status = ?";
    params.push(opts.status);
  }
  if (opts.service_id) {
    query += " AND pu.service_id = ?";
    params.push(opts.service_id);
  }

  query += " ORDER BY pu.created_at DESC LIMIT ?";
  params.push(opts.limit);

  const proposals = db.prepare(query).all(...params) as Array<
    PendingRow & { service_name: string }
  >;

  // Parse field_changes JSON for display
  const formatted = proposals.map((p) => ({
    id: p.id,
    service: { id: p.service_id, name: p.service_name },
    change_type: p.change_type,
    changes: JSON.parse(p.field_changes),
    reason: p.reason,
    evidence_url: p.evidence_url,
    proposed_by: p.proposer_agent_id,
    status: p.status,
    reviewed_by: p.reviewed_by,
    review_note: p.review_note,
    created_at: p.created_at,
    reviewed_at: p.reviewed_at,
  }));

  // Summary counts
  const counts = db
    .prepare(
      `SELECT status, count(*) as count FROM pending_updates GROUP BY status`
    )
    .all() as Array<{ status: string; count: number }>;

  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c.status] = c.count;

  return {
    proposals: formatted,
    summary: {
      total: formatted.length,
      queue: {
        pending: countMap["pending"] ?? 0,
        approved: countMap["approved"] ?? 0,
        rejected: countMap["rejected"] ?? 0,
      },
    },
    hint:
      opts.status === "pending"
        ? "Use review_update with proposal ID to approve or reject."
        : "Use list_pending_updates with status='pending' to see the review queue.",
  };
}

export { proposeUpdate, reviewUpdate, listPendingUpdates };
