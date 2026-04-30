/**
 * Markdown reporter — formats reconnaissance findings as a daily report.
 *
 * Output structure:
 *
 * # Reconnaissance Report — YYYY-MM-DD
 *
 * ## Summary
 * | Product | Status | Findings |
 * | KanseiLink | 🟢 | 10/10 healthy |
 * | ScaNavi   | 🟡 | 0/1 healthy (fail_open) |
 * | CardWize  | 🟢 | 4/4 healthy |
 *
 * ## Per-product details
 * ...
 */

const ICON = {
  critical: "🔴",
  warning: "🟡",
  info: "🟢",
  ok: "🟢",
};

export function formatReport(date, productResults) {
  const lines = [];
  lines.push(`# Reconnaissance Report — ${date}`);
  lines.push("");
  lines.push(
    `> Daily crawl of all Synapse Arrows products from inside KanseiLINK MCP.`
  );
  lines.push(
    `> See [scripts/reconnaissance/README.md](../../../scripts/reconnaissance/README.md).`
  );
  lines.push("");

  // ---------- Summary ----------
  lines.push("## Summary");
  lines.push("");
  lines.push("| Product | Status | Health | Snapshot |");
  lines.push("|---|---|---|---|");

  for (const result of productResults) {
    const allFindings = result.findings || [];
    const overall = classifyOverall(allFindings);
    const healthCounts = countByUrgency(result.health || []);
    const snapCounts = countByUrgency(result.snapshot || []);

    const healthCell = (result.health || []).length === 0
      ? "—"
      : formatCellSummary(healthCounts, (result.health || []).length);
    const snapCell = (result.snapshot || []).length === 0
      ? "—"
      : formatCellSummary(snapCounts, (result.snapshot || []).length);

    lines.push(
      `| ${result.product} | ${ICON[overall] || "⚪"} ${overall} | ${healthCell} | ${snapCell} |`
    );
  }
  lines.push("");

  // ---------- Per-product details ----------
  for (const result of productResults) {
    lines.push(`## ${result.product}`);
    lines.push("");
    lines.push(`Tier: ${result.tier || "unknown"}`);
    lines.push(`Monitors run: ${result.monitorsRun.join(", ") || "(none)"}`);
    lines.push("");

    // Health findings
    if (result.health && result.health.length > 0) {
      lines.push("### Health probe");
      lines.push("");
      lines.push("| URL | Status | Response | Result |");
      lines.push("|---|---|---|---|");
      for (const f of result.health) {
        const status = f.status ?? "—";
        const rt = `${f.response_time_ms}ms`;
        const icon = ICON[f.urgency] || "⚪";
        lines.push(
          `| ${escapeUrl(f.url)} | ${status} | ${rt} | ${icon} ${f.reason} |`
        );
      }
      lines.push("");
    }

    // Snapshot findings
    if (result.snapshot && result.snapshot.length > 0) {
      lines.push("### Snapshot diff");
      lines.push("");
      lines.push("| URL | Diff % | Result | Files |");
      lines.push("|---|---|---|---|");
      for (const f of result.snapshot) {
        const icon = ICON[f.urgency] || "⚪";
        const diff = f.diff_pct === null ? "—" : `${f.diff_pct.toFixed(2)}%`;
        const files = [];
        if (f.screenshot_path) files.push(`[baseline](${repoLink(f.screenshot_path)})`);
        if (f.diff_path) files.push(`[diff](${repoLink(f.diff_path)})`);
        const filesCell = files.join(" / ") || "—";
        lines.push(
          `| ${escapeUrl(f.url)} | ${diff} | ${icon} ${f.reason} | ${filesCell} |`
        );
      }
      lines.push("");
    }

    if (
      (!result.health || result.health.length === 0) &&
      (!result.snapshot || result.snapshot.length === 0)
    ) {
      lines.push("_No findings (no monitors enabled)._");
      lines.push("");
    }
  }

  // ---------- Footer ----------
  lines.push("---");
  lines.push("");
  lines.push(`Report generated at ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Tier B-β. Future tiers will add:");
  lines.push("- Tier B-γ: agent_voice probe (chat API regression detection)");
  lines.push("- Tier C: design.lock.json compliance, perf/cost baselines, Slack alerts, cross-repo STATE.md, 朝digest agent");
  lines.push("");

  return lines.join("\n");
}

function formatCellSummary(counts, total) {
  const parts = [];
  parts.push(`${counts.ok}/${total} ok`);
  if (counts.critical > 0) parts.push(`${counts.critical} 🔴`);
  if (counts.warning > 0) parts.push(`${counts.warning} 🟡`);
  return parts.join(", ");
}

function repoLink(repoRelativePath) {
  // Markdown link to the file relative to the report's location
  // (data/reconnaissance/reports/{date}.md → ../../../{path})
  return `../../../${repoRelativePath}`;
}

function classifyOverall(findings) {
  if (!findings || findings.length === 0) return "info";
  if (findings.some((f) => f.urgency === "critical")) return "critical";
  if (findings.some((f) => f.urgency === "warning")) return "warning";
  return "info";
}

function countByUrgency(findings) {
  return (findings || []).reduce(
    (acc, f) => {
      if (f.ok) acc.ok += 1;
      if (f.urgency === "critical") acc.critical += 1;
      if (f.urgency === "warning") acc.warning += 1;
      return acc;
    },
    { ok: 0, critical: 0, warning: 0 }
  );
}

function escapeUrl(url) {
  // Markdown table cell — pipe characters need escaping
  return url.replace(/\|/g, "\\|");
}
