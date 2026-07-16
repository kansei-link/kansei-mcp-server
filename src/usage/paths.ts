// Shared filesystem locations for the local usage-measurement store.
//
// Everything lives under ~/.kansei-link/ (same root as the report-hook log)
// and NEVER leaves the machine unless the user explicitly runs
// `kansei-link-wrapped --share`.

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const KANSEI_HOME = process.env.KANSEI_HOOK_DIR ?? join(homedir(), ".kansei-link");
export const USAGE_DIR = join(KANSEI_HOME, "usage");
export const SESSIONS_DIR = join(USAGE_DIR, "sessions");
export const WRAPPED_DIR = join(KANSEI_HOME, "wrapped");
export const ANON_ID_FILE = join(KANSEI_HOME, "anon-id");

export function ensureDirs(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  mkdirSync(WRAPPED_DIR, { recursive: true });
}

/**
 * Stable anonymous id for opt-in percentile submission. Generated locally
 * on first use; matches the server-side format gate [A-Za-z0-9_-]{8,64}.
 */
export function getAnonId(): string {
  try {
    if (existsSync(ANON_ID_FILE)) {
      const id = readFileSync(ANON_ID_FILE, "utf8").trim();
      if (/^[A-Za-z0-9_-]{8,64}$/.test(id)) return id;
    }
  } catch {
    /* fall through to regenerate */
  }
  const id = randomUUID().replace(/-/g, "");
  try {
    mkdirSync(KANSEI_HOME, { recursive: true });
    writeFileSync(ANON_ID_FILE, id + "\n", "utf8");
  } catch {
    /* still return the id; percentile just won't be stable across runs */
  }
  return id;
}
