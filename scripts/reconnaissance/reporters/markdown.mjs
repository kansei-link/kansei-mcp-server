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
  lines.push("| Product | Status | Findings |");
  lines.push("|---|---|---|");

  for (const result of productResults) {
    const overall = classifyOverall(result.findings);
    const counts = countByUrgency(result.findings);
    const summary = `${counts.ok}/${result.findings.length} healthy${
      counts.critical > 0 ? `, ${counts.critical} critical` : ""
    }${counts.warning > 0 ? `, ${counts.warning} warning` : ""}`;
    lines.push(
      `| ${result.product} | ${ICON[overall] || "⚪"} ${overall} | ${summary} |`
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

    if (result.findings.length === 0) {
      lines.push("_No findings (no monitors enabled)._");
      lines.push("");
      continue;
    }

    lines.push("| URL | Status | Response | Result |");
    lines.push("|---|---|---|---|");
    for (const f of result.findings) {
      const status = f.status ?? "—";
      const rt = `${f.response_time_ms}ms`;
      const icon = ICON[f.urgency] || "⚪";
      lines.push(
        `| ${escapeUrl(f.url)} | ${status} | ${rt} | ${icon} ${f.reason} |`
      );
    }
    lines.push("");
  }

  // ---------- Footer ----------
  lines.push("---");
  lines.push("");
  lines.push(`Report generated at ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Tier B-α (MVP). Future tiers will add:");
  lines.push("- Tier B-β: Playwright UI snapshot diff, agent_voice probe");
  lines.push("- Tier C: design.lock.json compliance, perf/cost baselines, alerts");
  lines.push("");

  return lines.join("\n");
}

function classifyOverall(findings) {
  if (findings.length === 0) return "info";
  if (findings.some((f) => f.urgency === "critical")) return "critical";
  if (findings.some((f) => f.urgency === "warning")) return "warning";
  return "info";
}

function countByUrgency(findings) {
  return findings.reduce(
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
