#!/usr/bin/env tsx
/**
 * KanseiLINK Operations Cycle — Weekly Full Maintenance
 *
 * Runs the complete operations pipeline in order:
 *   1. Registry Diff — find new servers, detect endpoint changes
 *   2. Health Probe — check all hosted endpoints
 *   3. Watchdog — analyze outcomes, downgrade unhealthy, generate reports
 *
 * Usage:
 *   npx tsx src/crawler/ops-cycle.ts           # full cycle (diff + probe + watch)
 *   npx tsx src/crawler/ops-cycle.ts --quick   # quick cycle (diff + quick probe + watch)
 *   npx tsx src/crawler/ops-cycle.ts --dry     # report only, no fixes
 *
 * Recommended: run weekly via cron or Claude Code session cron
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

function run(label: string, cmd: string): boolean {
  console.error(`\n${"━".repeat(60)}`);
  console.error(`  STEP: ${label}`);
  console.error(`  CMD:  ${cmd}`);
  console.error(`${"━".repeat(60)}\n`);

  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit", timeout: 10 * 60 * 1000 });
    console.error(`\n  ✓ ${label} — OK\n`);
    return true;
  } catch (err: unknown) {
    const code = (err as { status?: number }).status || "?";
    console.error(`\n  ✗ ${label} — exited ${code} (continuing)\n`);
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const quick = args.includes("--quick");
  const dryRun = args.includes("--dry");

  const startTime = Date.now();
  console.error("╔══════════════════════════════════════════════════╗");
  console.error("║     KanseiLINK Operations Cycle                 ║");
  console.error(`║     Mode: ${(quick ? "QUICK" : "FULL").padEnd(39)}║`);
  console.error(`║     Dry:  ${(dryRun ? "YES (report only)" : "NO (will fix)").padEnd(39)}║`);
  console.error("╚══════════════════════════════════════════════════╝");

  const results: Array<{ step: string; ok: boolean }> = [];

  // Step 1: Registry Diff
  results.push({
    step: "Registry Diff",
    ok: run("Registry Diff", "npx tsx src/crawler/registry-diff.ts"),
  });

  // Step 2: Health Probe
  const probeLimit = quick ? 200 : 5000;
  results.push({
    step: "Health Probe",
    ok: run("Health Probe", `npx tsx src/crawler/health-probe.ts --limit ${probeLimit}`),
  });

  // Step 3: Watchdog
  const watchFlags = dryRun ? "--report" : "--report --fix";
  results.push({
    step: "Watchdog",
    ok: run("Watchdog", `npx tsx src/crawler/watchdog.ts ${watchFlags}`),
  });

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.error("\n╔══════════════════════════════════════════════════╗");
  console.error("║     Operations Cycle Complete                   ║");
  console.error("╠══════════════════════════════════════════════════╣");
  for (const r of results) {
    const icon = r.ok ? "✓" : "✗";
    console.error(`║  ${icon} ${r.step.padEnd(46)}║`);
  }
  console.error(`║                                                  ║`);
  console.error(`║  Elapsed: ${elapsed}s${" ".repeat(38 - elapsed.length)}║`);
  console.error("╚══════════════════════════════════════════════════╝");

  const allOk = results.every((r) => r.ok);
  if (!allOk) process.exit(1);
}

main();
