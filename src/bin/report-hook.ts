#!/usr/bin/env node
// kansei-link-report-hook
//
// Claude Code PostToolUse hook that auto-captures outcome data when an agent
// calls any mcp__<any_kansei_tracked_service>__* tool, so report_outcome
// doesn't have to be invoked manually every time.
//
// Why: today's demo testing revealed that agents skip report_outcome even
// with the skill reminder — the friction of constructing the payload is
// enough to disincentivize it. Most of the data we need (service_id,
// success/failure, latency, error category) is visible to the hook for
// free.
//
// How to install: see README.md Hooks section, or add to ~/.claude/settings.json:
//
//   {
//     "hooks": {
//       "PostToolUse": [
//         {
//           "matcher": "mcp__.*",
//           "hooks": [
//             { "type": "command", "command": "npx -y @kansei-link/mcp-server kansei-link-report-hook" }
//           ]
//         }
//       ]
//     }
//   }
//
// CONTRACT:
//   - Reads PostToolUse payload as JSON on stdin
//   - Exits 0 on success OR failure — NEVER block Claude Code
//   - Logs to ~/.kansei-link/hook.log for debugging

import { mkdirSync, appendFileSync, existsSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

const LOG_DIR = process.env.KANSEI_HOOK_DIR ?? join(homedir(), ".kansei-link");
const LOG_FILE = join(LOG_DIR, "hook.log");
const LOG_MAX_BYTES = 1024 * 1024;

// Default endpoint — the hosted KanseiLink HTTP facade.
// Override with KANSEI_ENDPOINT for local or staging runs.
const DEFAULT_ENDPOINT =
  process.env.KANSEI_ENDPOINT ||
  "https://kansei-link-mcp-production.up.railway.app/api/report-outcome";

// Hook is intentionally opt-in (users add it to settings.json themselves),
// but we additionally gate on KANSEI_REPORT_HOOK env so agents can wire the
// hook broadly and enable/disable without editing settings each time.
const ENABLED = (process.env.KANSEI_REPORT_HOOK ?? "on").toLowerCase() !== "off";

function log(msg: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      try {
        renameSync(LOG_FILE, LOG_FILE + ".1");
      } catch {
        /* ignore */
      }
    }
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* never throw from log */
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    // Give up if nothing arrives in 500 ms — hook is not invoked manually
    setTimeout(() => resolve(data), 500);
  });
}

// Parse "mcp__<server>__<tool>" → { server, tool }. Anything else returns null.
function parseMcpToolName(name: string | undefined): { server: string; tool: string } | null {
  if (!name) return null;
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2] };
}

// Extract a service_id from the tool call arguments when possible.
// Most KanseiLink-tracked MCPs take a service identifier-like field in the
// input — look for the common shapes.
function guessServiceId(input: unknown, serverName: string): string | null {
  if (!input || typeof input !== "object") return serverName;
  const obj = input as Record<string, unknown>;
  const candidates = ["service_id", "service", "serviceId", "id", "name"];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0 && v.length < 64) return v;
  }
  return serverName;
}

// Classify an error from the tool response. Crude, but consistent with the
// error_type enum in outcomes.
function classifyError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const isError = Boolean(obj.is_error);
  const text = JSON.stringify(obj).toLowerCase();
  if (!isError && !text.includes("error") && !text.includes("fail")) return null;

  if (text.includes("auth") || text.includes("401") || text.includes("unauthorized"))
    return "auth_error";
  if (text.includes("expired") || text.includes("refresh")) return "auth_expired";
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("429") || text.includes("rate limit")) return "rate_limit";
  if (text.includes("not found") || text.includes("404")) return "not_found";
  if (text.includes("invalid") || text.includes("400")) return "invalid_input";
  if (isError) return "api_error";
  return null;
}

function postJson(url: string, body: unknown, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const client = u.protocol === "https:" ? https : http;
      const data = JSON.stringify(body);
      const req = client.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
            "User-Agent": "kansei-link-report-hook/1",
          },
          timeout: timeoutMs,
        },
        (res) => {
          res.on("data", () => {
            /* drain */
          });
          res.on("end", () => resolve());
        }
      );
      req.on("error", () => resolve());
      req.on("timeout", () => {
        req.destroy();
        resolve();
      });
      req.write(data);
      req.end();
    } catch {
      resolve();
    }
  });
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  if (!ENABLED) {
    log("disabled via KANSEI_REPORT_HOOK=off");
    process.exit(0);
  }

  let payload: any = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch (e: any) {
    log(`stdin parse error: ${e?.message ?? e}`);
    process.exit(0);
  }

  // PostToolUse payload shape (Claude Code): { tool_name, tool_input, tool_response, ... }
  const toolName: string = payload.tool_name || payload.toolName || "";
  const parsed = parseMcpToolName(toolName);
  if (!parsed) {
    // Not an MCP call — nothing to report
    process.exit(0);
  }

  // Skip reporting on calls into KanseiLink itself — avoid a feedback loop.
  if (parsed.server === "kansei-link" || parsed.server.startsWith("kansei")) {
    log(`skip self-call: ${toolName}`);
    process.exit(0);
  }

  const input = payload.tool_input ?? payload.toolInput;
  const response = payload.tool_response ?? payload.toolResponse;
  const serviceId = guessServiceId(input, parsed.server);
  const errorType = classifyError(response);
  const success = errorType === null;

  const body = {
    service_id: serviceId,
    success,
    task_type: parsed.tool,
    error_type: errorType,
    context: "auto-captured via kansei-link-report-hook",
    agent_type: "claude",
    is_retry: false,
  };

  await postJson(DEFAULT_ENDPOINT, body, 3000);
  log(`reported ${toolName} → service=${serviceId} success=${success} err=${errorType ?? ""} (${Date.now() - startedAt}ms)`);

  process.exit(0);
}

main().catch((e) => {
  log(`unhandled: ${e?.message ?? e}`);
  process.exit(0);
});
