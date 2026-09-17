#!/usr/bin/env node
/**
 * Synthesize 'agent voice' rows per service from the outcomes table — FIXTURE ONLY.
 *
 * ⚠️ P0 #39 (2026-08-16): このスクリプトは配布データ汚染の元凶だったため恒久的に
 *    デフォルト拒否です。src/data/ への出力・DB (agent_voice_responses) への
 *    INSERT/UPDATE は削除済みで、復活は SEC レビュー付きコミットでのみ許可されます。
 *
 *    出力は --fixture-out で明示されたパス（fixtures/ 配下 or repo 外）への
 *    JSON 書き出しのみ。DB は read-only で開きます。
 *
 *   node scripts/aggregate-voices.mjs --fixture-out fixtures/synthetic/<name>.json
 *
 * Logic (unchanged): For each service with ≥ 3 outcomes in last 90 days, compute
 * success_rate / median latency / top errors / top workarounds → one synthesized
 * row shaped like agent_voice_responses (agent_id 'kansei-link-synth').
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireFixtureOut, assertSafeOutPath } from "./lib-synth-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const fixtureOut = requireFixtureOut(process.argv.slice(2), "aggregate-voices.mjs");
const outAbs = assertSafeOutPath(fixtureOut, ROOT);

const dbPath = path.join(ROOT, "kansei-link.db");
const db = new Database(dbPath, { readonly: true });

const WINDOW_DAYS = 90;
const MIN_OUTCOMES = 3;

const candidates = db
  .prepare(
    `SELECT o.service_id, s.name, COUNT(*) as total
     FROM outcomes o
     JOIN services s ON s.id = o.service_id
     WHERE o.created_at >= datetime('now', '-' || @days || ' days')
     GROUP BY o.service_id
     HAVING total >= @min
     ORDER BY total DESC`
  )
  .all({ days: WINDOW_DAYS, min: MIN_OUTCOMES });

console.log(`[agg-voices] ${candidates.length} services have ≥ ${MIN_OUTCOMES} outcomes in ${WINDOW_DAYS}d (fixture mode, DB read-only)`);

const selectOutcomes = db.prepare(
  `SELECT success, latency_ms, error_type, workaround
   FROM outcomes
   WHERE service_id = @svc
     AND created_at >= datetime('now', '-' || @days || ' days')
   ORDER BY created_at DESC`
);

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function topKFreq(items, k = 3) {
  const counts = new Map();
  for (const x of items) {
    if (!x) continue;
    const key = String(x).trim();
    if (!key || key.length > 200) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([text, count]) => ({ text, count }));
}

function grade(successRate) {
  if (successRate >= 0.85) return "works_well";
  if (successRate >= 0.6) return "mostly_works";
  return "needs_attention";
}

function confidenceOf(n) {
  if (n >= 30) return "high";
  if (n >= 10) return "medium";
  return "low";
}

function renderText(name, stats) {
  const pct = Math.round(stats.successRate * 100);
  const parts = [];
  parts.push(`${name} succeeds on ${pct}% of calls (n=${stats.sample})`);
  if (stats.medianLatency) parts.push(`median latency ${stats.medianLatency}ms`);
  if (stats.topErrors.length > 0) {
    const errStr = stats.topErrors
      .slice(0, 2)
      .map((e) => `${e.text} (${e.count}x)`)
      .join(", ");
    parts.push(`most common errors: ${errStr}`);
  }
  if (stats.topWorkarounds.length > 0) {
    const waStr = stats.topWorkarounds
      .slice(0, 1)
      .map((w) => `"${w.text.slice(0, 120)}"`)
      .join(", ");
    parts.push(`common workaround: ${waStr}`);
  }
  return parts.join(". ") + ".";
}

const rows = candidates.map((cand) => {
  const outcomes = selectOutcomes.all({ svc: cand.service_id, days: WINDOW_DAYS });
  const successCount = outcomes.filter((r) => r.success === 1).length;
  const successRate = outcomes.length > 0 ? successCount / outcomes.length : 0;
  const latencies = outcomes.map((r) => r.latency_ms).filter((l) => l > 0);
  const stats = {
    sample: outcomes.length,
    successRate,
    medianLatency: median(latencies),
    topErrors: topKFreq(outcomes.filter((r) => r.success === 0).map((r) => r.error_type)),
    topWorkarounds: topKFreq(outcomes.map((r) => r.workaround)),
  };
  return {
    service_id: cand.service_id,
    agent_type: "aggregated",
    agent_id: "kansei-link-synth",
    question_id: "auto_voice_summary",
    response_choice: grade(successRate),
    response_text: renderText(cand.name, stats),
    confidence: confidenceOf(outcomes.length),
  };
});

db.close();

fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, JSON.stringify(rows, null, 1) + "\n");
console.log(`[agg-voices] wrote ${rows.length} synthesized rows -> ${path.relative(process.cwd(), outAbs)} (fixture only — NOT for src/data or distribution)`);
