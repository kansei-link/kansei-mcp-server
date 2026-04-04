import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";

interface InspectionRow {
  id: number;
  service_id: string;
  service_name: string;
  anomaly_type: string;
  severity: string;
  description: string;
  evidence: string | null;
  status: string;
  created_at: string;
}

export function register(server: McpServer, db: Database.Database): void {
  server.registerTool(
    "get_inspection_queue",
    {
      title: "Get Inspection Queue",
      description:
        "View anomalies that need verification by scout agents. " +
        "Like Google's quality raters — when KanseiLink detects suspicious patterns " +
        "(success rate crashes, contradicted workarounds, error spikes), " +
        "they appear here for agents to investigate and verify. " +
        "Pick one and use submit_inspection to report your findings.",
      inputSchema: z.object({
        status: z
          .enum(["open", "in_progress", "resolved", "all"])
          .default("open")
          .describe("Filter by status (default: open)"),
        severity: z
          .enum(["low", "medium", "high", "critical", "all"])
          .default("all")
          .describe("Filter by severity (default: all)"),
        service_id: z
          .string()
          .optional()
          .describe("Filter by specific service ID"),
        limit: z
          .number()
          .default(10)
          .describe("Max results (default: 10)"),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, severity, service_id, limit }) => {
      const result = getInspectionQueue(db, { status, severity, service_id, limit });
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

function getInspectionQueue(
  db: Database.Database,
  opts: {
    status: string;
    severity: string;
    service_id?: string;
    limit: number;
  }
): object {
  let sql = `
    SELECT i.id, i.service_id, s.name as service_name,
           i.anomaly_type, i.severity, i.description, i.evidence,
           i.status, i.created_at
    FROM inspections i
    JOIN services s ON s.id = i.service_id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (opts.status !== "all") {
    sql += " AND i.status = ?";
    params.push(opts.status);
  }
  if (opts.severity !== "all") {
    sql += " AND i.severity = ?";
    params.push(opts.severity);
  }
  if (opts.service_id) {
    sql += " AND i.service_id = ?";
    params.push(opts.service_id);
  }

  // Priority order: critical first, then high, then recent
  sql += ` ORDER BY
    CASE i.severity
      WHEN 'critical' THEN 0
      WHEN 'high' THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 3
    END,
    i.created_at DESC
    LIMIT ?`;
  params.push(opts.limit);

  const rows = db.prepare(sql).all(...params) as InspectionRow[];

  // Summary stats
  const stats = db
    .prepare(
      `SELECT
         sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
         sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
         sum(CASE WHEN severity = 'critical' AND status = 'open' THEN 1 ELSE 0 END) as critical_open,
         sum(CASE WHEN severity = 'high' AND status = 'open' THEN 1 ELSE 0 END) as high_open
       FROM inspections`
    )
    .get() as {
    open_count: number | null;
    in_progress: number | null;
    critical_open: number | null;
    high_open: number | null;
  };

  return {
    queue: rows.map((r) => ({
      inspection_id: r.id,
      service_id: r.service_id,
      service_name: r.service_name,
      anomaly_type: r.anomaly_type,
      severity: r.severity,
      description: r.description,
      evidence: r.evidence ? JSON.parse(r.evidence) : null,
      status: r.status,
      created_at: r.created_at,
    })),
    summary: {
      total_open: stats.open_count ?? 0,
      in_progress: stats.in_progress ?? 0,
      critical_open: stats.critical_open ?? 0,
      high_open: stats.high_open ?? 0,
    },
    instructions:
      rows.length > 0
        ? "Pick an inspection, verify the issue by testing the service, then submit_inspection with your findings."
        : "No anomalies detected. The colony is healthy!",
  };
}
