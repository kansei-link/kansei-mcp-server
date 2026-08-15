// installation_id — a PSEUDONYMOUS random identifier (never "anonymous" in
// copy: events are linkable for up to 90 days).
//
// Contract (Event Contract v1 §1.2):
//   - random UUID v4, never derived from hardware/email/username/paths
//   - rotation every 90 days, anchored to generated_at (lazy: rotated on the
//     next read after expiry — NOT on last_send, which would let heavy users
//     keep one ID indefinitely)
//   - user reset via `kansei-link-privacy --reset-id`; reset severs future
//     linkage but does NOT delete previously sent data (stated in consent copy)

import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { KANSEI_HOME } from "./paths.js";

const INSTALLATION_FILE = join(KANSEI_HOME, "installation.json");
const ROTATION_MS = 90 * 24 * 60 * 60 * 1000;

export interface InstallationRecord {
  installation_id: string;
  generated_at: string;
}

function freshRecord(): InstallationRecord {
  return { installation_id: randomUUID(), generated_at: new Date().toISOString() };
}

function write(record: InstallationRecord): InstallationRecord {
  mkdirSync(KANSEI_HOME, { recursive: true });
  writeFileSync(INSTALLATION_FILE, JSON.stringify(record, null, 2));
  return record;
}

/** Read the current installation id, lazily rotating if ≥90 days old. */
export function getInstallation(): InstallationRecord {
  try {
    if (existsSync(INSTALLATION_FILE)) {
      const parsed = JSON.parse(readFileSync(INSTALLATION_FILE, "utf8")) as InstallationRecord;
      if (
        typeof parsed?.installation_id === "string" &&
        typeof parsed?.generated_at === "string" &&
        Date.now() - Date.parse(parsed.generated_at) < ROTATION_MS
      ) {
        return parsed;
      }
    }
  } catch {
    /* fall through to rotate */
  }
  return write(freshRecord());
}

/** Immediate reset (user command). Previously sent data is not deleted. */
export function resetInstallation(): InstallationRecord {
  return write(freshRecord());
}
