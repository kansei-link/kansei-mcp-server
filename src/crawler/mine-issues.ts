#!/usr/bin/env tsx
/**
 * CLI runner for GitHub Issues mining (Angle ②).
 *
 * Usage:
 *   npx tsx src/crawler/mine-issues.ts                  # default: 180 days, all repos
 *   npx tsx src/crawler/mine-issues.ts --days 30        # last 30 days only
 *   npx tsx src/crawler/mine-issues.ts --no-comments    # faster: skip comment fetching
 *   npx tsx src/crawler/mine-issues.ts --output issues.json  # write to file
 *
 * Requires GITHUB_TOKEN env var or gh CLI auth.
 */
import { crawlGitHubIssues, summarizeFindings } from "./sources/github-issues.js";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI args
  const daysIdx = args.indexOf("--days");
  const sinceDays = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 180;

  const fetchComments = !args.includes("--no-comments");

  const outIdx = args.indexOf("--output");
  const outputFile = outIdx >= 0 ? args[outIdx + 1] : null;

  // Try to get GitHub token from gh CLI if not in env
  let token = process.env.GITHUB_TOKEN;
  if (!token) {
    try {
      token = execSync("gh auth token", { encoding: "utf-8" }).trim();
      console.error("[mine-issues] Using token from gh CLI auth");
    } catch {
      console.error("[mine-issues] Warning: no GITHUB_TOKEN and gh CLI not authenticated");
      console.error("[mine-issues] API rate limit will be very low (60 req/hr)");
    }
  }

  console.error(`[mine-issues] Starting GitHub Issues mining...`);
  console.error(`[mine-issues] Period: last ${sinceDays} days`);
  console.error(`[mine-issues] Comments: ${fetchComments ? "enabled" : "disabled"}`);
  console.error("");

  const findings = await crawlGitHubIssues({
    token: token || undefined,
    sinceDays,
    fetchComments,
  });

  // Print summary to stderr
  const stats = summarizeFindings(findings);
  console.error("\n═══════════════════════════════════════");
  console.error("  GitHub Issues Mining — Summary");
  console.error("═══════════════════════════════════════");
  console.error(`  Total findings:    ${stats.total}`);
  console.error(`  Mapped to service: ${stats.mapped}`);
  console.error(`  Unmapped:          ${stats.unmapped}`);
  console.error(`  With workaround:   ${stats.withWorkaround}`);
  console.error("");
  console.error("  By repo:");
  for (const [repo, count] of Object.entries(stats.byRepo)) {
    console.error(`    ${repo}: ${count}`);
  }
  console.error("");
  console.error("  By error type:");
  for (const [type, count] of Object.entries(stats.byErrorType)) {
    console.error(`    ${type}: ${count}`);
  }
  console.error("");
  console.error("  By severity:");
  for (const [sev, count] of Object.entries(stats.bySeverity)) {
    console.error(`    ${sev}: ${count}`);
  }
  console.error("═══════════════════════════════════════");

  // Output JSON
  const output = JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      since_days: sinceDays,
      repos_scanned: Array.from(new Set(findings.map(f => f.repo))),
      comments_fetched: fetchComments,
    },
    stats,
    findings,
  }, null, 2);

  if (outputFile) {
    writeFileSync(outputFile, output, "utf-8");
    console.error(`\n[mine-issues] Output written to ${outputFile}`);
  } else {
    // Write JSON to stdout (so it can be piped)
    process.stdout.write(output);
  }

  // Also generate a KanseiLINK-ready tips summary
  const tipsMap = generateTipsMap(findings);
  const tipsFile = outputFile
    ? outputFile.replace(/\.json$/, "-tips.json")
    : null;

  if (tipsFile) {
    writeFileSync(tipsFile, JSON.stringify(tipsMap, null, 2), "utf-8");
    console.error(`[mine-issues] Tips map written to ${tipsFile}`);
  } else {
    console.error("\n[mine-issues] Tips map (pass --output to save):");
    for (const [serviceId, tips] of Object.entries(tipsMap)) {
      console.error(`  ${serviceId}: ${tips.known_blockers.length} blockers, ${tips.proven_fixes.length} fixes`);
    }
  }
}

// ── Generate per-service tips from findings ───────────────────────
interface ServiceTips {
  known_blockers: Array<{
    error_type: string;
    summary: string;
    severity: string;
    issue_url: string;
    last_seen: string;
  }>;
  proven_fixes: Array<{
    error_type: string;
    problem: string;
    workaround: string;
    confidence: string;
    issue_url: string;
  }>;
  community_notes: string[];
  issue_count: number;
  data_source: "github-issues-mining";
  data_quality: "semi-confirmed";
}

function generateTipsMap(
  findings: Awaited<ReturnType<typeof crawlGitHubIssues>>
): Record<string, ServiceTips> {
  const map: Record<string, ServiceTips> = {};

  for (const f of findings) {
    if (!f.service_id) continue;

    if (!map[f.service_id]) {
      map[f.service_id] = {
        known_blockers: [],
        proven_fixes: [],
        community_notes: [],
        issue_count: 0,
        data_source: "github-issues-mining",
        data_quality: "semi-confirmed",
      };
    }

    const tips = map[f.service_id];
    tips.issue_count++;

    // Unresolved issues → known_blockers
    if (!f.resolved && f.severity !== "minor") {
      tips.known_blockers.push({
        error_type: f.error_type,
        summary: f.problem_summary.slice(0, 200),
        severity: f.severity,
        issue_url: f.url,
        last_seen: f.updated_at,
      });
    }

    // Issues with workarounds → proven_fixes
    if (f.workaround) {
      tips.proven_fixes.push({
        error_type: f.error_type,
        problem: f.title.slice(0, 150),
        workaround: f.workaround.slice(0, 300),
        confidence: f.confidence,
        issue_url: f.url,
      });
    }

    // High-comment issues → community_notes
    if (f.comment_count >= 5) {
      tips.community_notes.push(
        `[${f.comment_count} comments] ${f.title.slice(0, 100)} (${f.url})`
      );
    }
  }

  // Sort: most blockers first, limit per service
  for (const tips of Object.values(map)) {
    tips.known_blockers.sort((a, b) =>
      a.severity === "critical" ? -1 : b.severity === "critical" ? 1 : 0
    ).splice(10);
    tips.proven_fixes.splice(10);
    tips.community_notes.splice(5);
  }

  return map;
}

main().catch((err) => {
  console.error("[mine-issues] Fatal error:", err);
  process.exit(1);
});
