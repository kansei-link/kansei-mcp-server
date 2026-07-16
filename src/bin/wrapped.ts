#!/usr/bin/env node
// kansei-link-wrapped
//
// Monthly "agent fuel-efficiency" report built from the LOCAL session
// records the usage hook writes. Prints a terminal summary and renders a
// self-contained HTML share card to ~/.kansei-link/wrapped/<month>.html.
//
// Usage:
//   kansei-link-wrapped                    current month, Japanese
//   kansei-link-wrapped --month 2026-06    specific month
//   kansei-link-wrapped --lang en          English output
//   kansei-link-wrapped --json             machine-readable stats only
//   kansei-link-wrapped --share            opt-in: submit anonymized monthly
//                                          aggregates and get your percentile
//                                          ("top X% saver") back
//
// Privacy: without --share NOTHING leaves this machine. With --share, only
// the scalar aggregates below are sent (anon id + token counts) — never
// session content, file paths, or service payloads.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import { aggregateMonth, availableMonths, loadSessions, type WrappedStats } from "../usage/aggregate.js";
import { renderCardHtml } from "../usage/card.js";
import { METHODOLOGY_NOTES_JA, METHODOLOGY_NOTES_EN } from "../usage/baselines.js";
import { WRAPPED_DIR, ensureDirs, getAnonId } from "../usage/paths.js";

const DEFAULT_API_BASE =
  process.env.KANSEI_ENDPOINT_BASE || "https://kansei-link-mcp-production.up.railway.app";

// Illustrative input-token rates per 1M tokens (USD) by model family.
// Savings are input-side (avoided web research results), so input rates apply.
const FAMILY_INPUT_USD_PER_M: Array<{ prefix: string; rate: number }> = [
  { prefix: "claude-opus", rate: 15 },
  { prefix: "claude-sonnet", rate: 3 },
  { prefix: "claude-haiku", rate: 0.8 },
  { prefix: "gpt-4o-mini", rate: 0.15 },
  { prefix: "gpt", rate: 2.5 },
  { prefix: "gemini", rate: 1.25 },
];
const DEFAULT_INPUT_USD_PER_M = 3;

function parseArgs(argv: string[]) {
  const args = { month: "", lang: "ja" as "ja" | "en", json: false, share: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--month") args.month = argv[++i] ?? "";
    else if (a === "--lang") args.lang = argv[++i] === "en" ? "en" : "ja";
    else if (a === "--json") args.json = true;
    else if (a === "--share") args.share = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function dominantModelRate(stats: WrappedStats): { rate: number; model: string } {
  let best = "";
  let bestTokens = -1;
  for (const [model, tokens] of Object.entries(stats.models)) {
    if (tokens > bestTokens) {
      best = model;
      bestTokens = tokens;
    }
  }
  const family = FAMILY_INPUT_USD_PER_M.find((f) => best.startsWith(f.prefix));
  return { rate: family?.rate ?? DEFAULT_INPUT_USD_PER_M, model: best || "unknown" };
}

function postJson(
  url: string,
  body: unknown,
  timeoutMs = 5000
): Promise<{ status: number; body: any } | null> {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const client = u.protocol === "https:" ? https : http;
      const data = JSON.stringify(body);
      const req = client.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
            "User-Agent": "kansei-link-wrapped/1",
          },
          timeout: timeoutMs,
        },
        (res) => {
          let out = "";
          res.on("data", (c) => (out += c));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(out || "{}") });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: {} });
            }
          });
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.write(data);
      req.end();
    } catch {
      resolve(null);
    }
  });
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`kansei-link-wrapped — monthly agent fuel-efficiency report

Options:
  --month YYYY-MM   Report month (default: current month)
  --lang ja|en      Output language (default: ja)
  --json            Print stats as JSON and exit
  --share           Opt-in: submit anonymized aggregates, get your percentile
  --help            This message

Requires the usage hook to be installed first:
  npx -y @kansei-link/mcp-server kansei-link-install-hooks`);
    return;
  }

  const ja = args.lang === "ja";
  const sessions = loadSessions();
  if (sessions.length === 0) {
    console.log(
      ja
        ? "計測データがまだありません。まずフックをインストールしてください:\n  npx -y @kansei-link/mcp-server kansei-link-install-hooks\nインストール後、Claude Codeのセッションが終わるたびに自動で記録されます。"
        : "No usage data yet. Install the hook first:\n  npx -y @kansei-link/mcp-server kansei-link-install-hooks\nSessions are recorded automatically once installed."
    );
    return;
  }

  const month = args.month || new Date().toISOString().slice(0, 7);
  const stats = aggregateMonth(month, sessions);

  if (stats.sessions === 0) {
    const months = availableMonths(sessions);
    console.log(
      ja
        ? `${month} のセッション記録がありません。データがある月: ${months.join(", ")}`
        : `No sessions recorded for ${month}. Months with data: ${months.join(", ")}`
    );
    return;
  }

  // ── optional percentile share ──
  let percentileTop: number | null = null;
  let population: number | null = null;
  if (args.share) {
    const payload = {
      anon_id: getAnonId(),
      month: stats.month,
      total_tokens: stats.total_tokens,
      fresh_tokens: stats.fresh_tokens,
      kansei_calls: stats.kansei_calls,
      kansei_services_count: Object.keys(stats.kansei_services).length,
      kansei_response_tokens: stats.kansei_response_tokens,
      saved_tokens_estimated: stats.saved_tokens_estimated,
      sessions: stats.sessions,
      error_failed_calls: stats.error_failed_calls,
      error_stuck_tokens: stats.error_stuck_tokens,
    };
    const res = await postJson(`${DEFAULT_API_BASE}/api/wrapped`, payload);
    if (res && res.status === 200 && res.body?.ok) {
      population = typeof res.body.population === "number" ? res.body.population : null;
      percentileTop =
        typeof res.body.percentile_top === "number" ? res.body.percentile_top : null;
    } else {
      console.error(
        ja
          ? "[warn] 共有サーバーに接続できませんでした（レポートはローカルで生成します）"
          : "[warn] Could not reach the share server (report is still generated locally)"
      );
    }
  }

  const { rate, model } = dominantModelRate(stats);
  const savedUsd = (stats.saved_tokens_estimated / 1_000_000) * rate;
  const costNote = ja
    ? `参考換算: ${model} input単価 $${rate}/1Mトークン想定`
    : `illustrative: assumes ${model} input rate $${rate}/1M tokens`;

  if (args.json) {
    console.log(
      JSON.stringify(
        { ...stats, percentile_top: percentileTop, population, saved_usd_estimated: savedUsd },
        null,
        2
      )
    );
    return;
  }

  // ── terminal report ──
  const L = ja
    ? {
        title: `KanseiLink Wrapped — ${stats.month}`,
        sessions: "計測セッション",
        total: "総トークン消費 [実測]",
        fresh: "うち新規処理分 [実測]",
        cacheRead: "うちキャッシュ再読込 [実測]",
        calls: "KanseiLink参照回数 [実測]",
        respTokens: "KanseiLink応答トークン [実測]",
        avoided: "回避できた調査コスト [推定]",
        saved: "正味節約トークン [推定]",
        savedPct: "新規処理分に対する節約率 [推定]",
        services: "調べたサービス",
        stuckTitle: "ハマり（エラーループ）",
        failedCalls: "失敗したツール呼び出し [実測]",
        retryChains: "リトライ連鎖（2連続以上） [実測]",
        stuckTokens: "ハマりで溶けたトークン [実測・帰属はヒューリスティック]",
        worstTools: "よく失敗したツール",
        card: "シェアカード",
        shareHint: "順位を見るには --share を付けて実行（匿名の集計値のみ送信）",
        methodTitle: "測定方法:",
      }
    : {
        title: `KanseiLink Wrapped — ${stats.month}`,
        sessions: "Sessions measured",
        total: "Total tokens [measured]",
        fresh: "Fresh work tokens [measured]",
        cacheRead: "Cache re-reads [measured]",
        calls: "KanseiLink lookups [measured]",
        respTokens: "KanseiLink response tokens [measured]",
        avoided: "Avoided research cost [estimated]",
        saved: "Net tokens saved [estimated]",
        savedPct: "Savings rate vs fresh work [estimated]",
        services: "Services researched",
        stuckTitle: "Stuck time (error loops)",
        failedCalls: "Failed tool calls [measured]",
        retryChains: "Retry chains (2+ in a row) [measured]",
        stuckTokens: "Tokens burned while stuck [measured, heuristic attribution]",
        worstTools: "Most-failing tools",
        card: "Share card",
        shareHint: "Run with --share to see your rank (sends anonymous aggregates only)",
        methodTitle: "Methodology:",
      };

  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${L.title}`);
  lines.push("  " + "─".repeat(46));
  lines.push(`  ${L.sessions}: ${fmt(stats.sessions)}`);
  lines.push(`  ${L.total}: ${fmt(stats.total_tokens)}`);
  lines.push(`  ${L.fresh}: ${fmt(stats.fresh_tokens)}`);
  lines.push(`  ${L.cacheRead}: ${fmt(stats.cache_read_tokens)}`);
  lines.push("");
  lines.push(`  ${L.calls}: ${fmt(stats.kansei_calls)}`);
  lines.push(`  ${L.respTokens}: ${fmt(stats.kansei_response_tokens)}`);
  lines.push(`  ${L.avoided}: ${fmt(stats.avoided_research_tokens)}`);
  lines.push(
    `  ${L.saved}: ${fmt(stats.saved_tokens_estimated)}  (≈ $${savedUsd.toFixed(2)}, ${costNote})`
  );
  if (stats.saved_pct_of_fresh != null) {
    lines.push(`  ${L.savedPct}: ${stats.saved_pct_of_fresh}%`);
  }
  const services = Object.keys(stats.kansei_services);
  if (services.length > 0) {
    lines.push(`  ${L.services}: ${services.join(", ")}`);
  }
  if (stats.error_failed_calls > 0) {
    lines.push("");
    lines.push(`  ${L.stuckTitle}`);
    lines.push(`  ${L.failedCalls}: ${fmt(stats.error_failed_calls)}`);
    lines.push(`  ${L.retryChains}: ${fmt(stats.error_retry_chains)}`);
    lines.push(`  ${L.stuckTokens}: ${fmt(stats.error_stuck_tokens)}`);
    const worst = Object.entries(stats.error_by_tool)
      .sort((a, b) => b[1].error_tokens - a[1].error_tokens)
      .slice(0, 3)
      .map(([tool, t]) => `${tool} (${t.fails}${ja ? "回" : "x"}, ${fmt(t.error_tokens)}tok)`);
    if (worst.length > 0) lines.push(`  ${L.worstTools}: ${worst.join(", ")}`);
  }
  if (percentileTop != null && population != null) {
    lines.push("");
    lines.push(
      ja
        ? `  ★ 測定ユーザー${fmt(population)}人中 上位${percentileTop}%の節約量`
        : `  ★ Top ${percentileTop}% saver among ${fmt(population)} measured users`
    );
  } else if (population != null) {
    lines.push("");
    lines.push(
      ja
        ? `  （初期測定群: 現在${fmt(population)}人 — 母数が増えると順位が出ます）`
        : `  (Early cohort: ${fmt(population)} users — ranks unlock as the population grows)`
    );
  } else if (!args.share) {
    lines.push("");
    lines.push(`  ${L.shareHint}`);
  }
  lines.push("");
  lines.push(`  ${L.methodTitle}`);
  for (const n of ja ? METHODOLOGY_NOTES_JA : METHODOLOGY_NOTES_EN) {
    lines.push(`   - ${n}`);
  }

  // ── share card ──
  ensureDirs();
  const cardPath = join(WRAPPED_DIR, `${stats.month}.html`);
  writeFileSync(
    cardPath,
    renderCardHtml(stats, {
      lang: args.lang,
      percentileTop,
      population,
      savedUsd,
      costNote,
    }),
    "utf8"
  );
  lines.push("");
  lines.push(`  ${L.card}: ${cardPath}`);
  lines.push("");

  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(`[error] ${e?.message ?? e}`);
  process.exit(1);
});
