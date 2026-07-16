#!/usr/bin/env node
// kansei-link-usage-hook
//
// Claude Code Stop / SessionEnd hook that measures, from the session
// transcript, (a) total token usage — the DENOMINATOR the Wrapped report
// needs to say "what % of your overall spend KanseiLink touched" — and
// (b) actual KanseiLink call activity and response sizes.
//
// Everything is written LOCALLY to ~/.kansei-link/usage/sessions/<id>.json
// (overwritten on each firing, so re-runs are idempotent). Nothing is sent
// anywhere. Sharing for the percentile comparison only happens when the
// user explicitly runs `kansei-link-wrapped --share`.
//
// Install (adds Stop + SessionEnd entries to ~/.claude/settings.json):
//   npx -y @kansei-link/mcp-server kansei-link-install-hooks
//
// Or manually in ~/.claude/settings.json:
//   {
//     "hooks": {
//       "Stop": [
//         { "hooks": [ { "type": "command", "command": "npx -y @kansei-link/mcp-server kansei-link-usage-hook" } ] }
//       ],
//       "SessionEnd": [
//         { "hooks": [ { "type": "command", "command": "npx -y @kansei-link/mcp-server kansei-link-usage-hook" } ] }
//       ]
//     }
//   }
//
// CONTRACT (same as report-hook):
//   - Reads the hook payload as JSON on stdin
//   - Exits 0 on success OR failure — NEVER block Claude Code
//   - Logs to ~/.kansei-link/usage-hook.log

import { mkdirSync, appendFileSync, existsSync, statSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KANSEI_HOME, SESSIONS_DIR, ensureDirs } from "../usage/paths.js";
import { parseTranscript } from "../usage/transcript.js";

const LOG_FILE = join(KANSEI_HOME, "usage-hook.log");
const LOG_MAX_BYTES = 1024 * 1024;

const ENABLED = (process.env.KANSEI_USAGE_HOOK ?? "on").toLowerCase() !== "off";

function log(msg: string): void {
  try {
    mkdirSync(KANSEI_HOME, { recursive: true });
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
    setTimeout(() => resolve(data), 500);
  });
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  if (!ENABLED) {
    log("disabled via KANSEI_USAGE_HOOK=off");
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

  const transcriptPath: string | undefined =
    payload.transcript_path || payload.transcriptPath;
  const sessionId: string =
    payload.session_id || payload.sessionId || "unknown-session";

  if (!transcriptPath || !existsSync(transcriptPath)) {
    log(`no transcript (session=${sessionId}, path=${transcriptPath ?? "missing"})`);
    process.exit(0);
  }

  try {
    const record = await parseTranscript(transcriptPath, sessionId);
    ensureDirs();
    // File name from session id, sanitized — one file per session, latest wins.
    const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
    writeFileSync(
      join(SESSIONS_DIR, `${safeId}.json`),
      JSON.stringify(record, null, 2),
      "utf8"
    );
    log(
      `recorded session=${safeId} total=${record.total_tokens} fresh=${record.fresh_tokens} ` +
        `kansei_calls=${record.kansei.calls} kansei_resp=${record.kansei.response_tokens} ` +
        `(${Date.now() - startedAt}ms)`
    );
  } catch (e: any) {
    log(`parse/write error: ${e?.message ?? e}`);
  }

  process.exit(0);
}

main().catch((e) => {
  log(`unhandled: ${e?.message ?? e}`);
  process.exit(0);
});
