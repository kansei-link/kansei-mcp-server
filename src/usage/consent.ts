// Consent Contract v1 (rev1) — the single decision point for ALL central
// transmission (MCP telemetry AND report-hook).
//
// Priority chain (Codex-approved, applies to every transmission path):
//   DO_NOT_TRACK=1 / explicit OFF  >  explicit ON (env)  >  consent.json  >  default OFF
//
// "Local Mode = zero transmission" must hold across every code path, which is
// why hooks and the MCP server both call transmissionAllowed() and nothing
// else decides.

import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { KANSEI_HOME } from "./paths.js";

export const CONSENT_CONTRACT_VERSION = "1.0";
const CONSENT_FILE = join(KANSEI_HOME, "consent.json");

export interface ConsentRecord {
  enabled: boolean;
  contract_version: string;
  consented_at: string;
}

export function readConsent(): ConsentRecord | null {
  try {
    if (!existsSync(CONSENT_FILE)) return null;
    const parsed = JSON.parse(readFileSync(CONSENT_FILE, "utf8"));
    if (typeof parsed?.enabled !== "boolean") return null;
    return parsed as ConsentRecord;
  } catch {
    return null;
  }
}

export function writeConsent(enabled: boolean): ConsentRecord {
  mkdirSync(KANSEI_HOME, { recursive: true });
  const record: ConsentRecord = {
    enabled,
    contract_version: CONSENT_CONTRACT_VERSION,
    consented_at: new Date().toISOString(),
  };
  writeFileSync(CONSENT_FILE, JSON.stringify(record, null, 2));
  return record;
}

export interface TransmissionDecision {
  allowed: boolean;
  reason:
    | "do_not_track"
    | "explicit_env_off"
    | "explicit_env_on"
    | "consent_enabled"
    | "consent_disabled"
    | "consent_version_mismatch"
    | "no_consent_default_off";
}

/**
 * The single gate. `explicitEnv` is the value of the path-specific env var
 * (e.g. KANSEI_LIVE_UPDATES for MCP telemetry, KANSEI_REPORT_HOOK for the
 * hook) — only literal "on"/"off" count as explicit; anything else falls
 * through to consent.json.
 */
export function transmissionAllowed(explicitEnv?: string): TransmissionDecision {
  if (process.env.DO_NOT_TRACK === "1") return { allowed: false, reason: "do_not_track" };
  const env = (explicitEnv ?? "").toLowerCase();
  if (env === "off" || env === "0" || env === "false") return { allowed: false, reason: "explicit_env_off" };
  if (env === "on" || env === "1" || env === "true") return { allowed: true, reason: "explicit_env_on" };

  const consent = readConsent();
  if (!consent) return { allowed: false, reason: "no_consent_default_off" };
  if (!consent.enabled) return { allowed: false, reason: "consent_disabled" };
  // Major-version mismatch downgrades to Local Mode until re-consent.
  const major = (v: string) => String(v).split(".")[0];
  if (major(consent.contract_version) !== major(CONSENT_CONTRACT_VERSION)) {
    return { allowed: false, reason: "consent_version_mismatch" };
  }
  return { allowed: true, reason: "consent_enabled" };
}
