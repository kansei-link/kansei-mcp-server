/**
 * Crawler entry point. Run daily via cron.
 *
 * Usage (CLI):
 *   pnpm tsx src/crawler/run.ts
 *   pnpm tsx src/crawler/run.ts --dry-run
 *   pnpm tsx src/crawler/run.ts --since-days=30 --max=200
 *
 * Usage (programmatic, e.g. from an admin HTTP endpoint):
 *   import { runCrawler } from "./crawler/run.js";
 *   const summary = await runCrawler(db, { dryRun: false });
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
import { recomputeAxrGrades } from "./recompute-axr.js";
import { detectRecipeDrift } from "./drift.js";

export interface CrawlerOptions {
  dryRun?: boolean;
  sinceDays?: number;
  maxResults?: number;
}

export interface CrawlerSummary {
  run_id: number;
  status: "success" | "success_with_errors" | "failed";
  discovered: number;
  fresh: number;
  duplicates: number;
  already_queued: number;
  auto_accepted: number;
  queued_for_review: number;
  rejected: number;
  refresh: {
    eligible: number;
    refreshed: number;
    archived_detected: number;
    errors: number;
    changelog_entries: number;
    by_type: Record<string, number>;
  };
  snapshot: {
    services_snapshotted: number;
    active_services: number;
    total_reports: number;
  };
  drift: {
    recipes_scanned: number;
    gotchas_appended: number;
    services_flagged: number;
  };
  errors: string[];
  ingested_service_ids: string[];
}

export async function runCrawler(
  db: Database.Database,
  options: CrawlerOptions = {}
): Promise<CrawlerSummary> {
  const dryRun = Boolean(options.dryRun);
  const sinceDays = options.sinceDays ?? 90;
  const maxResults = options.maxResults ?? 300;

  console.log(`[crawler] start | dryRun=${dryRun} sinceDays=${sinceDays} max=${maxResults}`);
  const runInsert = db.prepare(`
    INSERT INTO crawl_runs (status, sources_crawled)
    VALUES ('running', ?)
  `);
  const runInfo = runInsert.run(
    JSON.stringify([
      "github-topics",
      "awesome-lists",
      "refresh",
      "snapshot",
      "drift",
      "axr",
    ])
  );
  const runId = runInfo.lastInsertRowid as number;

  const errors: string[] = [];
  const summaryOut: CrawlerSummary = {
    run_id: runId,
    status: "success",
    discovered: 0,
    fresh: 0,
    duplicates: 0,
    already_queued: 0,
    auto_accepted: 0,
    queued_for_review: 0,
    rejected: 0,
    refresh: { eligible: 0, refreshed: 0, archived_detected: 0, errors: 0, changelog_entries: 0, by_type: {} },
    snapshot: { services_snapshotted: 0, active_services: 0, total_reports: 0 },
    drift: { recipes_scanned: 0, gotchas_appended: 0, services_flagged: 0 },
    errors,
    ingested_service_ids: [],
  };

  try {
    // 1. Discovery
    console.log("[crawler] step 1/10: discovering from GitHub topics + awesome lists");
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
    summaryOut.discovered = allCandidates.length;
    console.log(
      `[crawler]   github-topics: ${githubResults.length}, awesome-lists: ${awesomeResults.length}, total: ${allCandidates.length}`
    );

    // 2. Dedupe
    console.log("[crawler] step 2/10: deduping against existing services + queue");
    const dedupe = dedupeAgainstDb(db, allCandidates);
    summaryOut.fresh = dedupe.fresh.length;
    summaryOut.duplicates = dedupe.duplicates.length;
    summaryOut.already_queued = dedupe.alreadyQueued.length;
    console.log(
      `[crawler]   fresh: ${dedupe.fresh.length}, duplicates: ${dedupe.duplicates.length}, already-queued: ${dedupe.alreadyQueued.length}`
    );

    // 3. Enrich (fetch README, star counts for awesome-list entries)
    console.log("[crawler] step 3/10: enriching via GitHub API");
    const enriched = await enrichCandidates(dedupe.fresh);
    console.log(`[crawler]   enriched: ${enriched.length}`);

    // 3b. Post-enrichment mainstream filter
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
    console.log(
      `[crawler]   mainstream-filtered: ${mainstream.length} (dropped ${enriched.length - mainstream.length} low-traction)`
    );

    // 4. Classify
    console.log("[crawler] step 4/10: LLM classification");
    const classified = await classifyCandidates(mainstream);
    console.log(`[crawler]   classified: ${classified.length}`);

    // 5. Score + triage
    console.log("[crawler] step 5/10: scoring + tier triage");
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
    if (!dryRun) {
      console.log("[crawler] step 6/10: ingesting into DB");
      const ingest = ingestCandidates(db, scored);
      summaryOut.auto_accepted = ingest.autoAccepted;
      summaryOut.queued_for_review = ingest.queuedForReview;
      summaryOut.rejected = ingest.rejected;
      summaryOut.ingested_service_ids = ingest.ingestedServiceIds;
    } else {
      console.log("[crawler] step 6/10: dry-run — skipping DB writes");
    }

    // 7. Refresh
    if (!dryRun) {
      console.log("[crawler] step 7/10: refreshing existing service metadata");
      try {
        const r = await refreshExistingServices(db);
        summaryOut.refresh = {
          eligible: r.eligible,
          refreshed: r.refreshed,
          archived_detected: r.archived_detected,
          errors: r.errors,
          changelog_entries: r.changelog_entries,
          by_type: r.by_type,
        };
        console.log(
          `[crawler]   eligible: ${r.eligible}, refreshed: ${r.refreshed}, archived-flagged: ${r.archived_detected}, errors: ${r.errors}, changelog: ${r.changelog_entries} (${Object.entries(r.by_type).map(([k, v]) => `${k}:${v}`).join(", ")})`
        );
      } catch (e) {
        const msg = `refresh: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`[crawler]   ${msg}`);
      }
    } else {
      console.log("[crawler] step 7/10: dry-run — skipping refresh");
    }

    // 8. Daily snapshots
    if (!dryRun) {
      console.log("[crawler] step 8/10: writing daily snapshots");
      try {
        const snap = snapshotAllServices(db);
        summaryOut.snapshot = {
          services_snapshotted: snap.summary.services_snapshotted,
          active_services: snap.summary.active_services,
          total_reports: snap.summary.total_reports,
        };
        console.log(
          `[crawler]   snapshotted: ${snap.summary.services_snapshotted}, active: ${snap.summary.active_services}, reports: ${snap.summary.total_reports}`
        );
      } catch (e) {
        const msg = `snapshot: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`[crawler]   ${msg}`);
      }
    } else {
      console.log("[crawler] step 8/10: dry-run — skipping snapshot");
    }

    // 9. Recipe drift detection
    if (!dryRun) {
      console.log("[crawler] step 9/10: recipe drift detection");
      try {
        const d = detectRecipeDrift(db);
        summaryOut.drift = d;
        console.log(
          `[crawler]   recipes: ${d.recipes_scanned}, gotchas appended: ${d.gotchas_appended}, services flagged: ${d.services_flagged}`
        );
      } catch (e) {
        const msg = `drift: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`[crawler]   ${msg}`);
      }
    } else {
      console.log("[crawler] step 9/10: dry-run — skipping drift detection");
    }

    // 10. AXR (Agent Experience Rating) dynamic recompute
    //
    // Keeps axr_score/axr_grade honest: hardcoded seed values drift away from
    // reality as total_calls / success_rate / trust_score evolve. Without this
    // step, services retain "AAA" from seed even after agents find them
    // unreliable. Safe & cheap: no external calls, pure SQL.
    if (!dryRun) {
      console.log("[crawler] step 10/10: recomputing AXR grades");
      try {
        const axr = recomputeAxrGrades(db);
        const dist = Object.entries(axr.grade_distribution)
          .sort(([a], [b]) => {
            const order = ["AAA", "AA", "A", "BBB", "BB", "B", "C", "D"];
            return order.indexOf(a) - order.indexOf(b);
          })
          .map(([g, n]) => `${g}:${n}`)
          .join(" ");
        console.log(
          `[crawler]   evaluated: ${axr.services_evaluated}, changed: ${axr.changed}, AAA: [${axr.aaa_services.join(", ")}]`
        );
        console.log(`[crawler]   distribution: ${dist}`);
      } catch (e) {
        const msg = `axr: ${(e as Error).message}`;
        errors.push(msg);
        console.error(`[crawler]   ${msg}`);
      }
    } else {
      console.log("[crawler] step 10/10: dry-run — skipping AXR recompute");
    }

    summaryOut.status = errors.length > 0 ? "success_with_errors" : "success";

    db.prepare(
      `UPDATE crawl_runs
       SET finished_at = datetime('now'),
           status = ?,
           discovered_count = ?,
           auto_accepted_count = ?,
           review_queue_count = ?,
           rejected_count = ?,
           duplicates_count = ?,
           errors = ?
       WHERE id = ?`
    ).run(
      summaryOut.status,
      summaryOut.discovered,
      summaryOut.auto_accepted,
      summaryOut.queued_for_review,
      summaryOut.rejected,
      summaryOut.duplicates + summaryOut.already_queued,
      JSON.stringify(errors),
      runId
    );

    console.log(`
============================================
[crawler] ✅ DONE
  Discovery:
    Discovered:        ${summaryOut.discovered}
    Fresh candidates:  ${summaryOut.fresh}
    Duplicates:        ${summaryOut.duplicates}
    Already-queued:    ${summaryOut.already_queued}
    Auto-accepted:     ${summaryOut.auto_accepted}
    Queued for review: ${summaryOut.queued_for_review}
    Rejected:          ${summaryOut.rejected}
  Refresh:
    Eligible:          ${summaryOut.refresh.eligible}
    Refreshed:         ${summaryOut.refresh.refreshed}
    Archived-flagged:  ${summaryOut.refresh.archived_detected}
  Snapshot:
    Services:          ${summaryOut.snapshot.services_snapshotted}
    Active today:      ${summaryOut.snapshot.active_services}
    Total reports:     ${summaryOut.snapshot.total_reports}
  Drift:
    Recipes scanned:   ${summaryOut.drift.recipes_scanned}
    Gotchas appended:  ${summaryOut.drift.gotchas_appended}
    Services flagged:  ${summaryOut.drift.services_flagged}
  Errors:              ${errors.length}
============================================
`);

    if (summaryOut.ingested_service_ids.length > 0) {
      console.log("New services ingested:");
      summaryOut.ingested_service_ids.slice(0, 20).forEach((id) => console.log(`  - ${id}`));
      if (summaryOut.ingested_service_ids.length > 20) {
        console.log(`  ... and ${summaryOut.ingested_service_ids.length - 20} more`);
      }
    }
  } catch (err) {
    console.error("[crawler] fatal error:", err);
    db.prepare(
      `UPDATE crawl_runs SET status = 'failed', finished_at = datetime('now'), errors = ? WHERE id = ?`
    ).run(JSON.stringify([...errors, (err as Error).message]), runId);
    summaryOut.status = "failed";
    summaryOut.errors.push((err as Error).message);
  }

  return summaryOut;
}

// ─── CLI entry point ────────────────────────────────────────────
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

async function cli() {
  const flags = parseFlags(process.argv);
  const dbPath = process.env.DB_PATH || "kansei-link.db";
  const db = new Database(dbPath);
  initializeDb(db);

  try {
    const summary = await runCrawler(db, {
      dryRun: Boolean(flags["dry-run"]),
      sinceDays: flags["since-days"] ? Number(flags["since-days"]) : undefined,
      maxResults: flags["max"] ? Number(flags["max"]) : undefined,
    });
    if (summary.status === "failed") process.exitCode = 1;
  } finally {
    db.close();
  }
}

// Run as CLI if invoked directly (not imported)
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/") ?? "");
if (isDirectRun) {
  cli();
}
