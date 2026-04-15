/**
 * Crawler entry point. Run daily via cron.
 *
 * Usage:
 *   pnpm tsx src/crawler/run.ts
 *   pnpm tsx src/crawler/run.ts --dry-run
 *   pnpm tsx src/crawler/run.ts --since-days=30 --max=200
 */
import Database from "better-sqlite3";
import { initializeDb } from "../db/schema.js";
import { crawlGitHubTopics } from "./sources/github-topics.js";
import { crawlAwesomeLists } from "./sources/awesome-lists.js";
import { dedupeAgainstDb } from "./pipeline/dedupe.js";
import { enrichCandidates } from "./pipeline/enrich.js";
import { classifyCandidates } from "./pipeline/classify.js";
import { scoreAll } from "./pipeline/score.js";
import { ingestCandidates } from "./pipeline/ingest.js";
import { refreshExistingServices } from "./refresh.js";
import { snapshotAllServices } from "./snapshot.js";
import { detectRecipeDrift } from "./drift.js";

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv);
  const dryRun = Boolean(flags["dry-run"]);
  const sinceDays = flags["since-days"] ? Number(flags["since-days"]) : 90;
  const maxResults = flags["max"] ? Number(flags["max"]) : 300;

  const dbPath = process.env.DB_PATH || "kansei-link.db";
  const db = new Database(dbPath);
  initializeDb(db);

  console.log(`[crawler] start | db=${dbPath} dryRun=${dryRun} sinceDays=${sinceDays} max=${maxResults}`);
  const runInsert = db.prepare(`
    INSERT INTO crawl_runs (status, sources_crawled)
    VALUES ('running', ?)
  `);
  const runInfo = runInsert.run(
    JSON.stringify(["github-topics", "awesome-lists", "refresh", "snapshot", "drift"])
  );
  const runId = runInfo.lastInsertRowid as number;

  const errors: string[] = [];

  try {
    // 1. Discovery
    console.log("[crawler] step 1/6: discovering from GitHub topics + awesome lists");
    const [githubResults, awesomeResults] = await Promise.all([
      crawlGitHubTopics({ sinceDays, maxResults }).catch((e) => {
        errors.push(`github-topics: ${e.message}`);
        return [];
      }),
      crawlAwesomeLists().catch((e) => {
        errors.push(`awesome-lists: ${e.message}`);
        return [];
      }),
    ]);
    const allCandidates = [...githubResults, ...awesomeResults];
    console.log(`[crawler]   github-topics: ${githubResults.length}, awesome-lists: ${awesomeResults.length}, total: ${allCandidates.length}`);

    // 2. Dedupe
    console.log("[crawler] step 2/6: deduping against existing services + queue");
    const dedupe = dedupeAgainstDb(db, allCandidates);
    console.log(`[crawler]   fresh: ${dedupe.fresh.length}, duplicates: ${dedupe.duplicates.length}, already-queued: ${dedupe.alreadyQueued.length}`);

    // 3. Enrich (fetch README, star counts for awesome-list entries)
    console.log("[crawler] step 3/6: enriching via GitHub API");
    const enriched = await enrichCandidates(dedupe.fresh);
    console.log(`[crawler]   enriched: ${enriched.length}`);

    // 3b. Post-enrichment mainstream filter: drop low-traction repos before
    //     paying for LLM classification. Keeps the daily cron cost bounded.
    const MIN_STARS_POST = 15;
    const MAX_STALE_DAYS = 365;
    const now = Date.now();
    const mainstream = enriched.filter((c) => {
      if (c.stars < MIN_STARS_POST) return false;
      if (!c.has_readme) return false;
      if (c.last_commit_at) {
        const ageDays = (now - new Date(c.last_commit_at).getTime()) / 86400_000;
        if (ageDays > MAX_STALE_DAYS) return false;
      }
      return true;
    });
    console.log(`[crawler]   mainstream-filtered: ${mainstream.length} (dropped ${enriched.length - mainstream.length} low-traction)`);

    // 4. Classify
    console.log("[crawler] step 4/6: LLM classification");
    const classified = await classifyCandidates(mainstream);
    console.log(`[crawler]   classified: ${classified.length}`);

    // 5. Score + triage
    console.log("[crawler] step 5/6: scoring + tier triage");
    const scored = scoreAll(classified);
    const byTier = scored.reduce(
      (acc, c) => {
        acc[c.tier] = (acc[c.tier] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    console.log(`[crawler]   tier distribution:`, byTier);

    // 6. Ingest
    let summary = { autoAccepted: 0, queuedForReview: 0, rejected: 0, ingestedServiceIds: [] as string[] };
    if (!dryRun) {
      console.log("[crawler] step 6/9: ingesting into DB");
      summary = ingestCandidates(db, scored);
    } else {
      console.log("[crawler] step 6/9: dry-run — skipping DB writes");
    }

    // 7. Refresh existing services (GitHub-hosted only)
    let refreshSummary = { eligible: 0, refreshed: 0, archived_detected: 0, errors: 0, changelog_entries: 0 };
    if (!dryRun) {
      console.log("[crawler] step 7/9: refreshing existing service metadata");
      try {
        refreshSummary = await refreshExistingServices(db);
        console.log(
          `[crawler]   eligible: ${refreshSummary.eligible}, refreshed: ${refreshSummary.refreshed}, archived-flagged: ${refreshSummary.archived_detected}, errors: ${refreshSummary.errors}`
        );
      } catch (e) {
        const msg = `refresh: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`[crawler]   ${msg}`);
      }
    } else {
      console.log("[crawler] step 7/9: dry-run — skipping refresh");
    }

    // 8. Daily snapshots
    let snapshotSummary = { snapshot_date: "", services_snapshotted: 0, active_services: 0, total_reports: 0, total_unique_agents: 0 };
    if (!dryRun) {
      console.log("[crawler] step 8/9: writing daily snapshots");
      try {
        const snap = snapshotAllServices(db);
        snapshotSummary = snap.summary;
        console.log(
          `[crawler]   snapshotted: ${snapshotSummary.services_snapshotted}, active: ${snapshotSummary.active_services}, reports: ${snapshotSummary.total_reports}, agents: ${snapshotSummary.total_unique_agents}`
        );
      } catch (e) {
        const msg = `snapshot: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`[crawler]   ${msg}`);
      }
    } else {
      console.log("[crawler] step 8/9: dry-run — skipping snapshot");
    }

    // 9. Recipe drift detection
    let driftSummary = { recipes_scanned: 0, gotchas_appended: 0, services_flagged: 0 };
    if (!dryRun) {
      console.log("[crawler] step 9/9: recipe drift detection");
      try {
        driftSummary = detectRecipeDrift(db);
        console.log(
          `[crawler]   recipes: ${driftSummary.recipes_scanned}, gotchas appended: ${driftSummary.gotchas_appended}, services flagged: ${driftSummary.services_flagged}`
        );
      } catch (e) {
        const msg = `drift: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`[crawler]   ${msg}`);
      }
    } else {
      console.log("[crawler] step 9/9: dry-run — skipping drift detection");
    }

    // Update run record
    db.prepare(`
      UPDATE crawl_runs
      SET finished_at = datetime('now'),
          status = ?,
          discovered_count = ?,
          auto_accepted_count = ?,
          review_queue_count = ?,
          rejected_count = ?,
          duplicates_count = ?,
          errors = ?
      WHERE id = ?
    `).run(
      errors.length > 0 ? "success_with_errors" : "success",
      allCandidates.length,
      summary.autoAccepted,
      summary.queuedForReview,
      summary.rejected,
      dedupe.duplicates.length + dedupe.alreadyQueued.length,
      JSON.stringify(errors),
      runId
    );

    console.log(`
============================================
[crawler] ✅ DONE
  Discovery:
    Discovered:        ${allCandidates.length}
    Fresh candidates:  ${dedupe.fresh.length}
    Duplicates:        ${dedupe.duplicates.length}
    Already-queued:    ${dedupe.alreadyQueued.length}
    Auto-accepted:     ${summary.autoAccepted}
    Queued for review: ${summary.queuedForReview}
    Rejected:          ${summary.rejected}
  Refresh:
    Eligible:          ${refreshSummary.eligible}
    Refreshed:         ${refreshSummary.refreshed}
    Archived-flagged:  ${refreshSummary.archived_detected}
  Snapshot:
    Services:          ${snapshotSummary.services_snapshotted}
    Active today:      ${snapshotSummary.active_services}
    Total reports:     ${snapshotSummary.total_reports}
  Drift:
    Recipes scanned:   ${driftSummary.recipes_scanned}
    Gotchas appended:  ${driftSummary.gotchas_appended}
    Services flagged:  ${driftSummary.services_flagged}
  Errors:              ${errors.length}
============================================
`);

    if (summary.ingestedServiceIds.length > 0) {
      console.log("New services ingested:");
      summary.ingestedServiceIds.slice(0, 20).forEach((id) => console.log(`  - ${id}`));
      if (summary.ingestedServiceIds.length > 20) {
        console.log(`  ... and ${summary.ingestedServiceIds.length - 20} more`);
      }
    }
  } catch (err) {
    console.error("[crawler] fatal error:", err);
    db.prepare(`UPDATE crawl_runs SET status = 'failed', finished_at = datetime('now'), errors = ? WHERE id = ?`).run(
      JSON.stringify([...errors, (err as Error).message]),
      runId
    );
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
