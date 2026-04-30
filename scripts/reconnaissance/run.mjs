#!/usr/bin/env node
/**
 * Reconnaissance Ant orchestrator.
 *
 * Reads configs/{product}.json files, runs each enabled monitor, and writes
 * a daily Markdown report to data/reconnaissance/reports/{date}.md.
 *
 * Usage:
 *   node scripts/reconnaissance/run.mjs
 *   node scripts/reconnaissance/run.mjs --product=scanavi
 *   node scripts/reconnaissance/run.mjs --dry-run
 *   node scripts/reconnaissance/run.mjs --date=2026-04-30
 */

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runHealthMonitor } from "./monitors/health.mjs";
import { runSnapshotMonitor } from "./monitors/snapshot.mjs";
import { formatReport } from "./reporters/markdown.mjs";
import { recordCriticalFindings } from "./reporters/linksee-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CONFIGS_DIR = path.join(__dirname, "configs");
const REPORTS_DIR = path.join(REPO_ROOT, "data", "reconnaissance", "reports");

function parseArgs(argv) {
  const args = { product: null, dryRun: false, date: null };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--product=")) args.product = arg.slice("--product=".length);
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
  }
  return args;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function loadConfigs(filterProduct) {
  const files = await readdir(CONFIGS_DIR);
  const configs = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    if (filterProduct) {
      const slug = file.replace(/\.json$/, "");
      if (slug !== filterProduct) continue;
    }
    const fullPath = path.join(CONFIGS_DIR, file);
    const raw = await readFile(fullPath, "utf-8");
    const config = JSON.parse(raw);
    configs.push({ file, config });
  }
  return configs.sort((a, b) =>
    (a.config.product || "").localeCompare(b.config.product || "")
  );
}

async function runConfig(config) {
  const monitorsRun = [];
  const healthFindings = [];
  const snapshotFindings = [];

  if (config.monitors?.health?.enabled) {
    monitorsRun.push("health");
    const out = await runHealthMonitor(config);
    healthFindings.push(...out);
  }

  if (config.monitors?.snapshot?.enabled) {
    monitorsRun.push("snapshot");
    try {
      const out = await runSnapshotMonitor(config);
      snapshotFindings.push(...out);
    } catch (error) {
      console.error(
        `[reconnaissance-ant]   snapshot monitor crashed for ${config.product}: ${error.message}`
      );
      snapshotFindings.push({
        url: "(snapshot monitor)",
        screenshot_path: null,
        baseline_path: null,
        diff_pct: null,
        diff_path: null,
        ok: false,
        urgency: "critical",
        reason: `snapshot monitor crashed: ${error.message}`,
        error: error.message,
      });
    }
  }

  // Tier B-γ monitors hook in here:
  //   if (config.monitors?.agent_voice_probe?.enabled) { ... }

  return {
    product: config.product,
    tier: config.tier,
    monitorsRun,
    health: healthFindings,
    snapshot: snapshotFindings,
    findings: [...healthFindings, ...snapshotFindings], // unified for backwards-compat with summary
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const date = args.date || todayUTC();

  console.log(`[reconnaissance-ant] starting run for ${date}${args.dryRun ? " (dry-run)" : ""}`);

  const configs = await loadConfigs(args.product);
  if (configs.length === 0) {
    console.error(`[reconnaissance-ant] no configs found${args.product ? ` for product=${args.product}` : ""}`);
    process.exit(1);
  }
  console.log(`[reconnaissance-ant] running ${configs.length} config(s): ${configs.map((c) => c.config.product).join(", ")}`);

  const results = [];
  for (const { config } of configs) {
    console.log(`[reconnaissance-ant] → ${config.product}`);
    const result = await runConfig(config);
    const counts = result.findings.reduce(
      (acc, f) => {
        acc[f.urgency] = (acc[f.urgency] || 0) + 1;
        return acc;
      },
      {}
    );
    console.log(
      `[reconnaissance-ant]   ${result.findings.length} findings (${
        Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(" ") || "none"
      })`
    );
    results.push(result);
  }

  const report = formatReport(date, results);

  if (args.dryRun) {
    console.log("[reconnaissance-ant] --dry-run, printing report:\n");
    console.log(report);
    return;
  }

  if (!existsSync(REPORTS_DIR)) {
    await mkdir(REPORTS_DIR, { recursive: true });
  }
  const reportPath = path.join(REPORTS_DIR, `${date}.md`);
  await writeFile(reportPath, report, "utf-8");
  console.log(`[reconnaissance-ant] wrote ${reportPath}`);

  // Linksee Memory bridge: record critical findings to JSONL queue for
  // downstream consumption by Claude sessions (朝digest agent — Tier C).
  try {
    const recorded = await recordCriticalFindings(date, results);
    if (recorded > 0) {
      console.log(`[reconnaissance-ant] queued ${recorded} entries for Linksee Memory`);
    }
  } catch (error) {
    console.error(`[reconnaissance-ant] linksee bridge failed (non-fatal): ${error.message}`);
  }

  // Exit code: 1 if any critical findings, 0 otherwise
  const hasCritical = results.some((r) =>
    r.findings.some((f) => f.urgency === "critical")
  );
  if (hasCritical) {
    console.error("[reconnaissance-ant] CRITICAL findings present — exiting with 1");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[reconnaissance-ant] fatal error:", err);
  process.exit(1);
});
