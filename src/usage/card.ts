// Self-contained HTML share card for the monthly Wrapped report.
// No external assets (fonts, CDN, images) — safe to open offline,
// screenshot, or attach anywhere.

import type { WrappedStats } from "./aggregate.js";
import { METHODOLOGY_NOTES_JA, METHODOLOGY_NOTES_EN } from "./baselines.js";

export interface CardOptions {
  lang: "ja" | "en";
  /** percentile info from --share, if the user opted in and N was large enough */
  percentileTop?: number | null;
  population?: number | null;
  /** illustrative cost figures (labeled as estimates) */
  savedUsd?: number | null;
  costNote?: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderCardHtml(stats: WrappedStats, opts: CardOptions): string {
  const ja = opts.lang === "ja";
  const t = ja
    ? {
        title: "KanseiLink Wrapped",
        subtitle: "あなたのエージェント燃費レポート",
        totalLabel: "総トークン消費（実測）",
        freshLabel: "うち新規処理分",
        savedLabel: "KanseiLinkが節約したトークン（推定）",
        savedPct: "新規処理分に対する節約率",
        calls: "KanseiLink参照回数",
        services: "調べたサービス",
        sessions: "計測セッション数",
        percentile: (p: number, n: number) =>
          `測定ユーザー${fmt(n)}人中 上位${p}%の節約量`,
        earlyCohort: (n: number) =>
          `初期測定群（現在${fmt(n)}人）— 母数が増えると順位が表示されます`,
        stuckTokens: "ハマりで溶けたトークン",
        stuckDetail: (chains: number) => `リトライ連鎖 ${fmt(chains)}回`,
        attributed: "帰属推定",
        measured: "実測",
        estimated: "推定",
        methodology: "測定方法",
        notes: METHODOLOGY_NOTES_JA,
        cta: "npx -y @kansei-link/mcp-server",
      }
    : {
        title: "KanseiLink Wrapped",
        subtitle: "Your agent fuel-efficiency report",
        totalLabel: "Total tokens (measured)",
        freshLabel: "of which fresh work",
        savedLabel: "Tokens saved by KanseiLink (estimated)",
        savedPct: "Savings rate vs fresh work",
        calls: "KanseiLink lookups",
        services: "Services researched",
        sessions: "Sessions measured",
        percentile: (p: number, n: number) =>
          `Top ${p}% saver among ${fmt(n)} measured users`,
        earlyCohort: (n: number) =>
          `Early cohort (${fmt(n)} users so far) — ranks unlock as the population grows`,
        stuckTokens: "Tokens burned while stuck",
        stuckDetail: (chains: number) => `${fmt(chains)} retry chains`,
        attributed: "attributed",
        measured: "measured",
        estimated: "estimated",
        methodology: "Methodology",
        notes: METHODOLOGY_NOTES_EN,
        cta: "npx -y @kansei-link/mcp-server",
      };

  const services = Object.keys(stats.kansei_services);
  const serviceChips = services
    .slice(0, 8)
    .map((s) => `<span class="chip">${esc(s)}</span>`)
    .join("");
  const moreServices =
    services.length > 8 ? `<span class="chip more">+${services.length - 8}</span>` : "";

  const percentileBlock =
    opts.percentileTop != null && opts.population != null
      ? `<div class="percentile">${esc(t.percentile(opts.percentileTop, opts.population))}</div>`
      : opts.population != null
        ? `<div class="percentile early">${esc(t.earlyCohort(opts.population))}</div>`
        : "";

  const usdBlock =
    opts.savedUsd != null
      ? `<div class="usd">≈ $${opts.savedUsd.toFixed(2)}<span class="usd-note"> ${esc(opts.costNote ?? "")}</span></div>`
      : "";

  const notesHtml = t.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title} — ${stats.month}</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Hiragino Sans", "Yu Gothic UI", "Segoe UI", system-ui, sans-serif;
    background: #0d1117; color: #e6edf3;
    display: flex; justify-content: center; padding: 32px 16px;
  }
  .card {
    width: 100%; max-width: 560px; border-radius: 20px; overflow: hidden;
    background: linear-gradient(160deg, #101c3a 0%, #0d2b2b 60%, #0d1117 100%);
    border: 1px solid #263248; padding: 36px 32px;
  }
  .brand { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: #6ee7b7; }
  h1 { font-size: 28px; margin-top: 6px; }
  .month { color: #8b949e; font-size: 15px; margin-top: 2px; }
  .subtitle { color: #8b949e; font-size: 14px; margin-top: 2px; }
  .hero { margin: 28px 0 8px; }
  .hero .num { font-size: 44px; font-weight: 700; color: #6ee7b7; line-height: 1.1; }
  .hero .label { font-size: 14px; color: #c9d1d9; margin-top: 4px; }
  .tag { display: inline-block; font-size: 11px; border-radius: 999px; padding: 1px 8px;
         margin-left: 8px; vertical-align: middle; }
  .tag.measured { background: #123b2a; color: #6ee7b7; border: 1px solid #1f6f4c; }
  .tag.estimated { background: #3b2a12; color: #e7c46e; border: 1px solid #6f5a1f; }
  .usd { font-size: 16px; color: #e7c46e; margin-top: 6px; }
  .usd-note { font-size: 11px; color: #8b949e; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 26px; }
  .stat { background: rgba(255,255,255,0.04); border: 1px solid #263248;
          border-radius: 12px; padding: 14px; }
  .stat .num { font-size: 22px; font-weight: 700; }
  .stat .label { font-size: 12px; color: #8b949e; margin-top: 3px; }
  .percentile { margin-top: 24px; font-size: 17px; font-weight: 600; color: #79c0ff;
                background: rgba(56,139,253,0.1); border: 1px solid #1f4a7a;
                border-radius: 12px; padding: 12px 16px; }
  .percentile.early { color: #8b949e; font-weight: 400; font-size: 13px; }
  .chips { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 12px; background: rgba(255,255,255,0.06); border: 1px solid #30363d;
          border-radius: 999px; padding: 3px 10px; color: #c9d1d9; }
  .chip.more { color: #8b949e; }
  details { margin-top: 26px; font-size: 12px; color: #8b949e; }
  details summary { cursor: pointer; }
  details li { margin: 6px 0 0 18px; line-height: 1.5; }
  .cta { margin-top: 26px; font-size: 12px; color: #6ee7b7; font-family: ui-monospace, monospace;
         background: rgba(110,231,183,0.07); border: 1px dashed #1f6f4c; border-radius: 8px;
         padding: 8px 12px; text-align: center; }
  .footer { margin-top: 14px; font-size: 11px; color: #484f58; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <div class="brand">KanseiLink</div>
  <h1>${t.title}</h1>
  <div class="month">${stats.month}</div>
  <div class="subtitle">${esc(t.subtitle)}</div>

  <div class="hero">
    <div class="num">${fmt(stats.saved_tokens_estimated)}</div>
    <div class="label">${esc(t.savedLabel)}<span class="tag estimated">${t.estimated}</span></div>
    ${usdBlock}
  </div>

  ${percentileBlock}

  <div class="grid">
    <div class="stat">
      <div class="num">${fmt(stats.total_tokens)}</div>
      <div class="label">${esc(t.totalLabel)}<span class="tag measured">${t.measured}</span></div>
    </div>
    <div class="stat">
      <div class="num">${fmt(stats.fresh_tokens)}</div>
      <div class="label">${esc(t.freshLabel)}<span class="tag measured">${t.measured}</span></div>
    </div>
    <div class="stat">
      <div class="num">${stats.saved_pct_of_fresh != null ? stats.saved_pct_of_fresh + "%" : "—"}</div>
      <div class="label">${esc(t.savedPct)}<span class="tag estimated">${t.estimated}</span></div>
    </div>
    <div class="stat">
      <div class="num">${fmt(stats.kansei_calls)}</div>
      <div class="label">${esc(t.calls)}<span class="tag measured">${t.measured}</span></div>
    </div>
    ${
      stats.error_failed_calls > 0
        ? `<div class="stat stuck" style="grid-column: 1 / -1;">
      <div class="num" style="color:#f87171;">${fmt(stats.error_stuck_tokens)}</div>
      <div class="label">${esc(t.stuckTokens)} · ${esc(t.stuckDetail(stats.error_retry_chains))}<span class="tag estimated">${t.attributed}</span></div>
    </div>`
        : ""
    }
  </div>

  ${services.length > 0 ? `<div class="chips">${serviceChips}${moreServices}</div>` : ""}

  <details>
    <summary>${esc(t.methodology)}</summary>
    <ul>${notesHtml}</ul>
  </details>

  <div class="cta">${t.cta}</div>
  <div class="footer">${esc(t.sessions)}: ${fmt(stats.sessions)} · kansei-link.com</div>
</div>
</body>
</html>
`;
}
