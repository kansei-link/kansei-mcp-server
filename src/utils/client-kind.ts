import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * clientInfo.name → probe | agent | unknown, for the hosted /mcp usage summary (2026-10-24).
 * The list is src/data/mcp-client-kinds.json (edited by hand). Nothing new is collected: this only
 * reads the client_name already kept on initialize rows (SEC-2026-10-24-001).
 *
 * Order: agent.names (exact) → probe.names (exact) → probe.patterns (regex) → unknown.
 * Exact names win over patterns, so a real client whose name happens to contain "bot" can be
 * pinned to agent. Matching is case-insensitive. 'other' (a clientInfo that failed the 64-char
 * plain-text check) and a missing name are 'unknown'.
 */
export type ClientKind = "probe" | "agent" | "unknown";

interface KindsFile {
  agent?: { names?: Array<{ name?: unknown }> };
  probe?: { names?: Array<{ name?: unknown }>; patterns?: unknown[] };
}

export interface ClientKinds {
  agentNames: Set<string>;
  probeNames: Set<string>;
  probeRe: RegExp | null;
}

const names = (list: Array<{ name?: unknown }> | undefined): Set<string> =>
  new Set((list ?? []).map((x) => (typeof x?.name === "string" ? x.name.trim().toLowerCase() : "")).filter(Boolean));

export function compileClientKinds(file: KindsFile): ClientKinds {
  const pats = (file.probe?.patterns ?? []).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  let probeRe: RegExp | null = null;
  if (pats.length) {
    try {
      probeRe = new RegExp(pats.map((p) => `(?:${p})`).join("|"), "i");
    } catch {
      probeRe = null; // a broken pattern disables patterns rather than misclassifying
    }
  }
  return { agentNames: names(file.agent?.names), probeNames: names(file.probe?.names), probeRe };
}

let cached: ClientKinds | null = null;

/** The list from src/data/mcp-client-kinds.json; an unreadable file means "everything is unknown". */
export function clientKinds(): ClientKinds {
  if (cached) return cached;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = JSON.parse(readFileSync(join(here, "..", "..", "src", "data", "mcp-client-kinds.json"), "utf8")) as KindsFile;
    cached = compileClientKinds(file);
  } catch (e) {
    console.error("[client-kind] mcp-client-kinds.json unreadable:", e instanceof Error ? e.message : String(e));
    cached = compileClientKinds({});
  }
  return cached;
}

export function classifyClient(name: string | null | undefined, kinds: ClientKinds = clientKinds()): ClientKind {
  if (typeof name !== "string") return "unknown";
  const n = name.trim().toLowerCase();
  if (!n || n === "other") return "unknown";
  if (kinds.agentNames.has(n)) return "agent";
  if (kinds.probeNames.has(n)) return "probe";
  if (kinds.probeRe?.test(n)) return "probe";
  return "unknown";
}
