// Client-side event emitter — Event Contract v1 (rev1).
//
// Fire-and-forget: never blocks a tool response, never throws, silent when
// offline. Emits ONLY when transmissionAllowed() says so (Local Mode default
// = zero transmission). Payloads are restricted to the closed field sets in
// the contract; anything else is a bug that scripts/smoke-telemetry-e2e.mjs
// should catch.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { transmissionAllowed } from "./consent.js";
import { getInstallation } from "./installation.js";

const ENDPOINT_BASE =
  process.env.KANSEI_ENDPOINT_BASE || "https://kansei-link-mcp-production.up.railway.app";
export const EVENT_CONTRACT_VERSION = "1.0";

// catalog_version = the npm package version whose bundled seed this
// installation is running against (central and local catalogs diverge).
let catalogVersion = "unknown";
try {
  const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")
  );
  if (typeof pkg?.version === "string") catalogVersion = pkg.version;
} catch {
  /* keep "unknown" */
}

type EventType = "mcp_search" | "recipe_lookup" | "outcome_reported" | "revalidation_reported";

// Closed per-type field allowlists (mirror of the server-side zod schemas).
const FIELD_ALLOWLIST: Record<EventType, string[]> = {
  mcp_search: ["result_count", "category_id", "latency_ms"],
  recipe_lookup: ["service_id", "recipe_id", "recipe_version", "local_attempt_id"],
  outcome_reported: [
    "service_id", "success", "tool_name", "error_class", "latency_ms",
    "model_family", "is_retry", "local_attempt_id", "recipe_id", "recipe_version", "failed_step",
  ],
  revalidation_reported: ["service_id", "recipe_id", "recipe_version", "success"],
};

export function toModelFamily(modelName?: string | null): string | undefined {
  if (!modelName) return undefined;
  const m = modelName.toLowerCase();
  if (m.includes("claude")) return "claude";
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "gpt";
  if (m.includes("gemini")) return "gemini";
  return "other";
}

const ERROR_CLASSES = new Set([
  "auth_error", "auth_expired", "permission_scope", "rate_limit", "timeout",
  "not_found", "invalid_input", "schema_mismatch", "api_error", "network", "other",
]);
export function toErrorClass(errorType?: string | null): string | undefined {
  if (!errorType) return undefined;
  return ERROR_CLASSES.has(errorType) ? errorType : "other";
}

/**
 * Emit a single event (batch of one). Call as `void emitEvent(...)` — the
 * returned promise never rejects.
 */
export async function emitEvent(type: EventType, fields: Record<string, unknown>): Promise<void> {
  try {
    if (!transmissionAllowed(process.env.KANSEI_LIVE_UPDATES).allowed) return;

    const allow = new Set(FIELD_ALLOWLIST[type]);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (allow.has(k) && v !== undefined && v !== null) clean[k] = v;
    }

    const envelope = {
      contract_version: EVENT_CONTRACT_VERSION,
      installation_id: getInstallation().installation_id,
      catalog_version: catalogVersion,
      sent_at: new Date().toISOString(),
      events: [{ event_id: randomUUID(), type, occurred_at: new Date().toISOString(), ...clean }],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(`${ENDPOINT_BASE}/api/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    }).catch(() => undefined);
    clearTimeout(timer);
  } catch {
    /* telemetry must never affect product behavior */
  }
}
