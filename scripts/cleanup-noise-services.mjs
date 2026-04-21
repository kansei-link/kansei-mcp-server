#!/usr/bin/env node
/**
 * Remove or hide crawler-ingested entries that are NOT SaaS integrations.
 *
 * Categories removed:
 *   1. MCP language SDKs (Python/TypeScript/Go/... "MCP SDK")
 *   2. MCP meta-tools (inspector, mcp-server alone, mcpjungle, awesome-mcp-servers)
 *   3. CLI-only dev tools (gemini-cli, chrome-devtools-mcp, nvim-mcp, etc.)
 *   4. Repo paths that don't identify a real SaaS
 *
 * For entries that ARE real SaaS integrations but have ugly repo-path names,
 * cleans the name to a readable form.
 *
 *   node scripts/cleanup-noise-services.mjs
 *   node scripts/cleanup-noise-services.mjs --dry-run   # preview only
 *   node scripts/cleanup-noise-services.mjs --delete    # actually DELETE (default: hide)
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const DRY_RUN = process.argv.includes("--dry-run");
const DELETE_MODE = process.argv.includes("--delete");

const db = new Database(dbPath);

// --- Classification patterns ---
// Match on name OR description. Name match is definitive, description match
// requires additional signal (no clear SaaS brand reference).
const HARD_REJECT_NAME = [
  // Language SDKs
  /^(C#|C\+\+|Python|Java|Kotlin|Swift|Go|Rust|Ruby|PHP|Dart|TypeScript|JavaScript|Node)\s*(MCP\s*SDK|SDK\s*for\s*MCP)$/i,
  /\bMCP\s*SDK$/i,
  /^([a-z-]+)-?mcp-?sdk$/i,

  // Pure MCP tooling / meta
  /^mcp$/i,
  /^mcp-server$/i,
  /^mcp-ts-core$/i,
  /^mcp-use$/i,
  /^mcp-workspace$/i,
  /^mcp-client-for-[\w-]+$/i,
  /^MCPJungle$/i,
  /^inspector$/i,
  /^awesome-mcp-servers$/i,

  // IDE / editor MCPs (not SaaS)
  /^chrome-devtools-mcp$/i,
  /^nvim-mcp$/i,
  /^XcodeBuildMCP$/i,
  /^UnrealMotionGraphicsMCP$/i,
  /^VibeUE$/i,
  /^ue-mcp$/i,

  // CLI-only tools
  /^gemini-cli$/i,

  // Generic / unclassifiable names
  /^agents$/i,
  /^agency-orchestrator$/i,
  /^task-orchestrator$/i,
  /^context-engineering$/i,

  // Meta "awesome lists"
  /^bh-rat\/context-awesome$/i,

  // SDKs / frameworks with clear dev-tool naming
  /^Go MCP SDK$/i,
  /^Python MCP SDK$/i,
  /^TypeScript MCP SDK$/i,
  /^Java MCP SDK$/i,
  /^Kotlin MCP SDK$/i,
  /^Swift MCP SDK$/i,
  /^Rust MCP SDK$/i,
  /^Ruby MCP SDK$/i,
  /^PHP MCP SDK$/i,
  /^C# MCP SDK$/i,
];

const HARD_REJECT_DESC = [
  /\bSDK for building MCP servers\b/i,
  /\bMCP protocol SDK\b/i,
  /^\s*(official\s+)?(Python|TypeScript|Java|Go|Rust|C#|Ruby|PHP|Kotlin|Swift|Dart)\s+(SDK|library|client)\b.*\bMCP\b/i,
];

// Local-only "memory/notes/tool" patterns that aren't SaaS integrations.
// These are similar to linksee-memory — valuable tools but not agent-to-SaaS.
const LOCAL_TOOL_NAME = [
  /^bear-notes-mcp$/i,
  /^apple-books-mcp$/i,
  /^AgentRecall$/i,
  /^memex$/i,
  /^nocturne_memory$/i,
  /^chunkhound$/i,
  /^inspector$/i,
];

function classify(row) {
  // row = { id, name, description, mcp_endpoint, trust_score, axr_score }
  const name = row.name || "";
  const desc = row.description || "";

  for (const p of HARD_REJECT_NAME) {
    if (p.test(name)) return { reject: true, reason: "mcp_infrastructure_name" };
  }
  for (const p of LOCAL_TOOL_NAME) {
    if (p.test(name)) return { reject: true, reason: "local_tool_not_saas" };
  }
  for (const p of HARD_REJECT_DESC) {
    if (p.test(desc)) return { reject: true, reason: "mcp_infrastructure_desc" };
  }

  return { reject: false };
}

// --- Name cleanup ---
// "aliyun/alibaba-cloud-ops-mcp-server" -> "Alibaba Cloud Ops"
// "openbnb-org/mcp-server-airbnb"       -> "Airbnb (Community)"
// "kunallunia/twitter-mcp"              -> "Twitter (Community)"
// Only applies to names that still look like repo paths OR end in mcp/-mcp-server.
function cleanName(originalName, isCommunity) {
  let n = originalName.trim();

  // Drop owner path if present (keep last segment)
  if (n.includes("/")) {
    const parts = n.split("/");
    n = parts[parts.length - 1];
  }

  // Strip common MCP-related suffixes/prefixes
  n = n.replace(/^mcp-server-/i, "");
  n = n.replace(/-mcp-server$/i, "");
  n = n.replace(/-mcp$/i, "");
  n = n.replace(/^mcp-/i, "");

  // If nothing meaningful left, give up and keep original
  if (!n || n.length < 2) return originalName;

  // Title-case words separated by - or _
  const titled = n
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      // Keep all-caps or mixed-case brand-like words (e.g. "AWS", "GraphQL")
      if (/^[A-Z0-9]{2,}$/.test(word) || /[A-Z]/.test(word.slice(1))) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");

  // Suffix (Community) for third-party MCP to make origin clear
  const suffix = isCommunity ? " (Community)" : "";
  return titled + suffix;
}

// --- Run ---
const rows = db
  .prepare(
    `SELECT id, name, description, mcp_endpoint, mcp_status, trust_score, axr_score
     FROM services
     WHERE mcp_status = 'community'
     ORDER BY name ASC`
  )
  .all();

let rejected = [];
let renamed = [];
let unchanged = 0;

for (const row of rows) {
  const { reject, reason } = classify(row);
  if (reject) {
    rejected.push({ id: row.id, name: row.name, reason });
  } else {
    // Real SaaS integration — clean the name if it looks like a repo path
    const original = row.name;
    const isCommunity = row.mcp_status === "community";
    const cleaned = cleanName(original, isCommunity);
    if (cleaned !== original && cleaned.length > 1) {
      renamed.push({ id: row.id, before: original, after: cleaned });
    } else {
      unchanged++;
    }
  }
}

console.log("=== cleanup-noise-services ===");
console.log(`scanned community-tier services: ${rows.length}`);
console.log(`would reject (hide/delete):      ${rejected.length}`);
console.log(`would rename:                     ${renamed.length}`);
console.log(`unchanged:                        ${unchanged}`);
console.log();

if (rejected.length > 0) {
  console.log("--- rejected (sample 20) ---");
  for (const r of rejected.slice(0, 20)) {
    console.log(`  [${r.reason}] ${r.id}  (${r.name})`);
  }
  if (rejected.length > 20) console.log(`  ... + ${rejected.length - 20} more`);
  console.log();
}

if (renamed.length > 0) {
  console.log("--- renamed (sample 15) ---");
  for (const r of renamed.slice(0, 15)) {
    console.log(`  ${r.id}`);
    console.log(`    "${r.before}"  ->  "${r.after}"`);
  }
  if (renamed.length > 15) console.log(`  ... + ${renamed.length - 15} more`);
  console.log();
}

if (DRY_RUN) {
  console.log("[dry-run] no changes written.");
  db.close();
  process.exit(0);
}

// --- Apply changes ---
const tx = db.transaction(() => {
  if (DELETE_MODE) {
    const del = db.prepare("DELETE FROM services WHERE id = ?");
    const delStats = db.prepare("DELETE FROM service_stats WHERE service_id = ?");
    const delChangelog = db.prepare("DELETE FROM service_changelog WHERE service_id = ?");
    const delVoices = db.prepare("DELETE FROM agent_voice_responses WHERE service_id = ?");
    for (const r of rejected) {
      delVoices.run(r.id);
      delChangelog.run(r.id);
      delStats.run(r.id);
      del.run(r.id);
    }
  } else {
    // "Hide" mode: zero out axr_score so they drop out of rankings but the
    // row remains for historical queries.
    const hide = db.prepare(
      `UPDATE services
       SET axr_score = NULL,
           axr_grade = NULL,
           trust_score = 0.0
       WHERE id = ?`
    );
    for (const r of rejected) hide.run(r.id);
  }

  const rename = db.prepare(`UPDATE services SET name = ? WHERE id = ?`);
  for (const r of renamed) rename.run(r.after, r.id);
});
tx();

console.log(
  DELETE_MODE
    ? `[DELETED] ${rejected.length} rows + dependent stats/changelog/voices cascaded.`
    : `[HIDDEN]  ${rejected.length} rows axr_score cleared (rows retained for history).`
);
console.log(`[RENAMED] ${renamed.length} rows.`);

db.close();
