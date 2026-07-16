// Monthly aggregation over the local session records written by the
// usage hook. Produces the numbers behind `kansei-link-wrapped`.
//
// Measured and estimated values are kept in separate fields end-to-end.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_DIR } from "./paths.js";
import { baselineForService } from "./baselines.js";
import type { SessionRecord } from "./transcript.js";

export interface WrappedStats {
  month: string; // "YYYY-MM"
  sessions: number;
  sessions_with_kansei: number;

  // ── measured ──
  total_tokens: number; // incl. cache reads
  fresh_tokens: number; // input + output + cache creation
  output_tokens: number;
  cache_read_tokens: number;
  kansei_calls: number;
  kansei_response_tokens: number;
  kansei_tools: Record<string, number>;
  kansei_services: Record<string, number>; // service → sessions touched
  models: Record<string, number>; // model → total tokens

  // ── error loops (measured tokens, heuristic attribution) ──
  error_failed_calls: number;
  error_result_tokens: number; // measured size of all error outputs
  error_retry_chains: number; // >=2 consecutive same-tool failures
  error_longest_chain: number;
  error_stuck_tokens: number; // error outputs + assistant output inside chains
  error_by_tool: Record<string, { fails: number; error_tokens: number }>;

  // ── estimated (labeled) ──
  avoided_research_tokens: number; // Σ baseline per distinct service per session
  saved_tokens_estimated: number; // avoided - measured kansei responses (floor 0)
  saved_pct_of_fresh: number | null; // saved / (fresh + saved), null if no fresh
}

export function loadSessions(): SessionRecord[] {
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: SessionRecord[] = [];
  for (const f of files) {
    try {
      const rec = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (rec && typeof rec === "object" && typeof rec.session_id === "string") {
        out.push(rec as SessionRecord);
      }
    } catch {
      /* skip corrupt file */
    }
  }
  return out;
}

/** Month a session belongs to: its last activity, falling back to record time. */
export function sessionMonth(rec: SessionRecord): string {
  const ts = rec.ended_at ?? rec.recorded_at;
  return ts.slice(0, 7);
}

export function aggregateMonth(month: string, sessions?: SessionRecord[]): WrappedStats {
  const all = sessions ?? loadSessions();
  const inMonth = all.filter((s) => sessionMonth(s) === month);

  const stats: WrappedStats = {
    month,
    sessions: inMonth.length,
    sessions_with_kansei: 0,
    total_tokens: 0,
    fresh_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    kansei_calls: 0,
    kansei_response_tokens: 0,
    kansei_tools: {},
    kansei_services: {},
    models: {},
    error_failed_calls: 0,
    error_result_tokens: 0,
    error_retry_chains: 0,
    error_longest_chain: 0,
    error_stuck_tokens: 0,
    error_by_tool: {},
    avoided_research_tokens: 0,
    saved_tokens_estimated: 0,
    saved_pct_of_fresh: null,
  };

  for (const s of inMonth) {
    stats.total_tokens += s.total_tokens ?? 0;
    stats.fresh_tokens += s.fresh_tokens ?? 0;
    for (const [model, u] of Object.entries(s.models ?? {})) {
      stats.output_tokens += u.output_tokens ?? 0;
      stats.cache_read_tokens += u.cache_read_tokens ?? 0;
      stats.models[model] =
        (stats.models[model] ?? 0) +
        (u.input_tokens ?? 0) +
        (u.output_tokens ?? 0) +
        (u.cache_creation_tokens ?? 0) +
        (u.cache_read_tokens ?? 0);
    }

    // Older session records (pre error-tracking) simply lack `errors`.
    const e = s.errors;
    if (e) {
      stats.error_failed_calls += e.failed_calls ?? 0;
      stats.error_result_tokens += e.error_result_tokens ?? 0;
      stats.error_retry_chains += e.retry_chains ?? 0;
      stats.error_longest_chain = Math.max(stats.error_longest_chain, e.longest_chain ?? 0);
      stats.error_stuck_tokens += e.stuck_tokens ?? 0;
      for (const [tool, t] of Object.entries(e.by_tool ?? {})) {
        const agg = (stats.error_by_tool[tool] ??= { fails: 0, error_tokens: 0 });
        agg.fails += t.fails ?? 0;
        agg.error_tokens += t.error_tokens ?? 0;
      }
    }

    const k = s.kansei;
    if (!k || k.calls === 0) continue;
    stats.sessions_with_kansei += 1;
    stats.kansei_calls += k.calls;
    stats.kansei_response_tokens += k.response_tokens ?? 0;
    for (const [tool, n] of Object.entries(k.tools ?? {})) {
      stats.kansei_tools[tool] = (stats.kansei_tools[tool] ?? 0) + n;
    }
    // Avoided cost: once per distinct service per session (conservative).
    for (const service of Object.keys(k.services ?? {})) {
      stats.kansei_services[service] = (stats.kansei_services[service] ?? 0) + 1;
      stats.avoided_research_tokens += baselineForService(service).tokens;
    }
  }

  stats.saved_tokens_estimated = Math.max(
    0,
    stats.avoided_research_tokens - stats.kansei_response_tokens
  );
  if (stats.fresh_tokens > 0) {
    // Share of the fresh-token bill you would have had WITHOUT KanseiLink.
    stats.saved_pct_of_fresh =
      Math.round(
        (stats.saved_tokens_estimated /
          (stats.fresh_tokens + stats.saved_tokens_estimated)) *
          1000
      ) / 10;
  }

  return stats;
}

/** All months present in the local store, newest first. */
export function availableMonths(sessions?: SessionRecord[]): string[] {
  const all = sessions ?? loadSessions();
  return [...new Set(all.map(sessionMonth))].sort().reverse();
}
