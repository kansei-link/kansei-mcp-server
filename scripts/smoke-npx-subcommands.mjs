#!/usr/bin/env node
/**
 * smoke-npx-subcommands.mjs — regression test for the npx subcommand bug.
 *
 * Background (known bug):
 *   `npx -y @kansei-link/mcp-server kansei-link-wrapped` does NOT run the
 *   wrapped CLI. npm's bin resolution picks the bin whose name matches the
 *   unscoped package name ("mcp-server" -> dist/index.js) and passes
 *   "kansei-link-wrapped" to it as an ignored argument — the MCP stdio
 *   server starts instead. The correct form is:
 *   `npx -y -p @kansei-link/mcp-server kansei-link-wrapped`.
 *
 * What this script verifies (no network required — npx equivalence is
 * checked via npm's documented bin-resolution rules + local `node dist/...`
 * launches):
 *   1. Every package.json bin entry points to an existing built file.
 *   2. npx resolution model: the package has multiple bins AND a bin named
 *      after the unscoped package name, therefore the `-p`-less form can
 *      never dispatch a subcommand (the precondition of the bug is pinned).
 *   3. Each CLI bin actually starts locally (`node dist/bin/x.js <safe-flag>`).
 *      Mutating bins (install-hooks / install-skill) and the HTTP server are
 *      only syntax-checked (`node --check`) so the smoke test stays side-effect
 *      free.
 *   4. Docs (README.md, CLAUDE.md by default; or files passed as argv):
 *      a. every `kansei-link-*` command mentioned exists in package.json bin;
 *      b. no occurrence of the broken form
 *         `npx ... @kansei-link/mcp-server <subcommand>` without `-p`/--package.
 *
 * Usage:
 *   node scripts/smoke-npx-subcommands.mjs             # check repo README.md + CLAUDE.md
 *   node scripts/smoke-npx-subcommands.mjs A.md B.md   # check given doc files instead
 *
 * Exit code 0 = all green, 1 = at least one failure.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bins = pkg.bin ?? {};
const unscopedName = pkg.name.includes("/") ? pkg.name.split("/")[1] : pkg.name;

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const info = (msg) => console.log(`  info  ${msg}`);

/* ---- 1. bin targets exist ------------------------------------------------ */
console.log("[1] package.json bin targets exist");
for (const [name, target] of Object.entries(bins)) {
  const abs = join(root, target);
  existsSync(abs) ? ok(`${name} -> ${target}`) : bad(`${name} -> ${target} (missing — run npm run build)`);
}

/* ---- 2. npx bin-resolution equivalence ---------------------------------- */
console.log("[2] npx bin-resolution model (why the -p-less form is broken)");
const binNames = Object.keys(bins);
if (binNames.length > 1 && binNames.includes(unscopedName)) {
  ok(`multiple bins (${binNames.length}) + bin "${unscopedName}" matches unscoped package name`);
  info(`=> \`npx -y ${pkg.name} <subcommand>\` always runs ${bins[unscopedName]} (MCP server), never the subcommand`);
  info(`=> documented commands MUST use \`npx -y -p ${pkg.name} <subcommand>\``);
} else if (binNames.length === 1) {
  info("single bin — npx would run it regardless; subcommand dispatch not applicable");
} else {
  bad(`no bin named "${unscopedName}" but multiple bins — \`npx ${pkg.name}\` would error; docs must use -p form`);
}
// every documented-style subcommand must be resolvable by `-p` form:
for (const name of binNames.filter((n) => n.startsWith("kansei-link-"))) {
  ok(`\`npx -y -p ${pkg.name} ${name}\` resolves to ${bins[name]}`);
}

/* ---- 3. each bin entry starts locally ------------------------------------ */
console.log("[3] local launch equivalence (node <bin target>)");
const launchPlan = {
  // safe read-only CLIs: must exit 0 and print something
  "kansei-link-wrapped":      { args: ["--lang", "en"], mode: "run" },
  "kansei-link-privacy":      { args: ["--status"],     mode: "run" },
  "kansei-link-live-updates": { args: ["--status"],     mode: "run" },
  // stdin-driven hooks: must start and exit on empty stdin without module errors
  "kansei-link-report-hook":  { args: [], mode: "run-empty-stdin" },
  "kansei-link-usage-hook":   { args: [], mode: "run-empty-stdin" },
  // stdio MCP server: exits on stdin EOF
  "mcp-server":               { args: [], mode: "run-empty-stdin" },
  "kansei-link-mcp":          { args: [], mode: "skip-alias-of:mcp-server" },
  // side-effectful or port-binding: syntax check only
  "kansei-link-install-hooks": { mode: "check" },
  "kansei-link-install-skill": { mode: "check" },
  "kansei-link-mcp-http":      { mode: "check" },
};
for (const [name, target] of Object.entries(bins)) {
  const plan = launchPlan[name] ?? { mode: "check" };
  const abs = join(root, target);
  if (!existsSync(abs)) continue; // already failed in [1]
  if (plan.mode.startsWith("skip-alias")) { ok(`${name}: same target as ${plan.mode.split(":")[1]} — skipped`); continue; }
  if (plan.mode === "check") {
    const r = spawnSync(process.execPath, ["--check", abs], { encoding: "utf8", timeout: 30000 });
    r.status === 0 ? ok(`${name}: syntax OK (--check; not executed to avoid side effects)`)
                   : bad(`${name}: node --check failed: ${(r.stderr || "").slice(0, 200)}`);
    continue;
  }
  const r = spawnSync(process.execPath, [abs, ...(plan.args ?? [])], {
    encoding: "utf8", timeout: 120000, input: "",
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const moduleError = /ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/.test(out);
  if (plan.mode === "run") {
    r.status === 0 && !moduleError && out.trim().length > 0
      ? ok(`${name}: started, exit 0 (${out.trim().split(/\r?\n/)[0].slice(0, 60)}...)`)
      : bad(`${name}: exit=${r.status} moduleError=${moduleError} out=${out.slice(0, 200)}`);
  } else { // run-empty-stdin
    r.signal == null && !moduleError
      ? ok(`${name}: started and exited on empty stdin (exit=${r.status})`)
      : bad(`${name}: signal=${r.signal} moduleError=${moduleError} out=${out.slice(0, 200)}`);
  }
}

/* ---- 4. docs vs bin consistency ------------------------------------------ */
console.log("[4] docs: command names exist in bin + no broken npx form");
const docFiles = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => resolve(p))
  : [join(root, "README.md"), join(root, "CLAUDE.md")];
const escapedPkg = pkg.name.replace(/[/@]/g, "\\$&");
for (const file of docFiles) {
  if (!existsSync(file)) { bad(`doc not found: ${file}`); continue; }
  const text = readFileSync(file, "utf8");
  // 4a. every mentioned kansei-link-* command is a real bin
  const mentioned = [...new Set(text.match(/kansei-link-[a-z][a-z-]*[a-z]/g) ?? [])];
  for (const cmd of mentioned) {
    binNames.includes(cmd) ? ok(`${file.split(/[\\/]/).pop()}: "${cmd}" is a real bin`)
                           : bad(`${file.split(/[\\/]/).pop()}: "${cmd}" mentioned but NOT in package.json bin`);
  }
  // 4b. broken form: npx [flags] @kansei-link/mcp-server <subcommand> without -p/--package
  const re = new RegExp(`npx\\s+((?:-{1,2}[\\w=-]+\\s+)*)${escapedPkg}\\s+(kansei-link-[a-z-]+)`, "g");
  let m, broken = 0;
  while ((m = re.exec(text)) !== null) {
    const flags = m[1] ?? "";
    if (!/(^|\s)(-p|--package)(\s|=|$)/.test(flags)) {
      broken++;
      bad(`${file.split(/[\\/]/).pop()}: broken npx form -> \`npx ${flags}${pkg.name} ${m[2]}\` (needs -p)`);
    }
  }
  if (broken === 0) ok(`${file.split(/[\\/]/).pop()}: no broken \`npx ... ${pkg.name} <subcommand>\` form`);
}

/* ---- summary ------------------------------------------------------------- */
console.log(failures === 0 ? "\nSMOKE OK — all checks passed" : `\nSMOKE FAILED — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
