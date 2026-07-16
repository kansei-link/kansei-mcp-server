#!/usr/bin/env node
// kansei-link-install-hooks
//
// One-command installer for the KanseiLink measurement hooks in
// ~/.claude/settings.json:
//
//   Stop / SessionEnd → kansei-link-usage-hook   (local token measurement)
//   PostToolUse       → kansei-link-report-hook  (auto outcome reports)
//
// Design constraints:
//   - Idempotent: running twice adds nothing twice.
//   - Non-destructive: existing hooks and settings are preserved; a
//     timestamped backup is written before any change.
//   - --dry-run shows the diff without writing.
//   - --remove uninstalls exactly the entries we added.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const SETTINGS_DIR = join(homedir(), ".claude");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

// --local: run the hooks from THIS build instead of the published npm
// package. For dogfooding before a release (npx would fetch a package
// version that may not have these binaries yet).
const useLocal = process.argv.includes("--local");
const binDir = dirname(fileURLToPath(import.meta.url));
const q = (p: string) => (p.includes(" ") ? `"${p}"` : p);

const USAGE_HOOK_CMD = useLocal
  ? `node ${q(join(binDir, "usage-hook.js"))}`
  : "npx -y @kansei-link/mcp-server kansei-link-usage-hook";
const REPORT_HOOK_CMD = useLocal
  ? `node ${q(join(binDir, "report-hook.js"))}`
  : "npx -y @kansei-link/mcp-server kansei-link-report-hook";

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

const WANTED: Array<{ event: string; matcher?: string; command: string }> = [
  { event: "Stop", command: USAGE_HOOK_CMD },
  { event: "SessionEnd", command: USAGE_HOOK_CMD },
  { event: "PostToolUse", matcher: "mcp__.*", command: REPORT_HOOK_CMD },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const remove = args.includes("--remove");
const showHelp = args.includes("--help") || args.includes("-h");

if (showHelp) {
  console.log(`kansei-link-install-hooks

Installs the KanseiLink measurement hooks into ~/.claude/settings.json:
  Stop / SessionEnd → usage hook  (measures your session token usage LOCALLY)
  PostToolUse       → report hook (auto-reports SaaS call outcomes, PII-masked)

Options:
  --dry-run   Show what would change without writing
  --local     Point hooks at this local build instead of the npm package
              (for dogfooding before a release)
  --remove    Uninstall the KanseiLink hook entries
  --help      This message

Privacy:
  The usage hook writes ONLY to ~/.kansei-link/usage/ on this machine.
  Nothing is uploaded unless you explicitly run: kansei-link-wrapped --share`);
  process.exit(0);
}

function hasCommand(entries: HookEntry[] | undefined, command: string): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some(
    (e) => Array.isArray(e?.hooks) && e.hooks.some((h) => h?.command === command)
  );
}

let settings: any = {};
if (existsSync(SETTINGS_FILE)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  } catch (e: any) {
    console.error(`[error] ~/.claude/settings.json is not valid JSON: ${e?.message ?? e}`);
    console.error("Fix the file manually, then re-run this installer.");
    process.exit(1);
  }
}
if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
  console.error("[error] ~/.claude/settings.json is not a JSON object. Aborting.");
  process.exit(1);
}

settings.hooks = settings.hooks ?? {};
const changes: string[] = [];

if (!remove) {
  for (const w of WANTED) {
    const entries: HookEntry[] = (settings.hooks[w.event] = settings.hooks[w.event] ?? []);
    if (hasCommand(entries, w.command)) continue;
    const entry: HookEntry = { hooks: [{ type: "command", command: w.command }] };
    if (w.matcher) entry.matcher = w.matcher;
    entries.push(entry);
    changes.push(`+ ${w.event}${w.matcher ? ` (matcher: ${w.matcher})` : ""} → ${w.command}`);
  }
} else {
  // Match both install forms (npx package and --local absolute path).
  const OURS = /kansei-link-(usage|report)-hook|[\\/](usage|report)-hook\.js/;
  for (const event of Object.keys(settings.hooks)) {
    const entries: HookEntry[] | undefined = settings.hooks[event];
    if (!Array.isArray(entries)) continue;
    const before = entries.length;
    settings.hooks[event] = entries.filter(
      (e) => !(Array.isArray(e?.hooks) && e.hooks.some((h) => OURS.test(h?.command ?? "")))
    );
    if (settings.hooks[event].length !== before) {
      changes.push(`- ${event}: removed ${before - settings.hooks[event].length} KanseiLink hook entr${before - settings.hooks[event].length === 1 ? "y" : "ies"}`);
    }
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
}

if (changes.length === 0) {
  console.log(
    remove
      ? "[ok] No KanseiLink hook entries found — nothing to remove."
      : "[ok] KanseiLink hooks already installed — nothing to do."
  );
  process.exit(0);
}

console.log(dryRun ? "[dry-run] Would apply:" : "Applying:");
for (const c of changes) console.log(`  ${c}`);

if (dryRun) process.exit(0);

mkdirSync(SETTINGS_DIR, { recursive: true });
if (existsSync(SETTINGS_FILE)) {
  const backup = SETTINGS_FILE + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(SETTINGS_FILE, backup);
  console.log(`  (backup: ${backup})`);
}
writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf8");
console.log(`[ok] Updated ${SETTINGS_FILE}`);

if (!remove) {
  console.log(`
Next steps:
  1. Restart Claude Code (hooks load at session start).
  2. Work normally — sessions are measured locally and automatically.
  3. At month's end, see your report:
       npx -y @kansei-link/mcp-server kansei-link-wrapped
     Add --share to see how you rank against other measured users.`);
}
