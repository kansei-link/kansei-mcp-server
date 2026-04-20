#!/usr/bin/env node
/**
 * Replace hardcoded display counts in public HTML files.
 * "225 services" -> "300+ services"
 * "132 / 188 Recipes" -> "180+ Recipes"
 *
 * Keeps API params (?limit=225) and code comments unchanged.
 */
import fs from "node:fs";
import path from "node:path";

// Minimal recursive HTML finder (avoids glob dependency).
function findHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findHtml(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const PUBLIC_DIR = path.resolve("public");

// Order matters — more specific patterns first.
const REPLACEMENTS = [
  // Ranking widget header
  { from: "AEO Readiness Ranking Q2 2026 (225 Services)", to: "AEO Readiness Ranking Q2 2026 (300+ Services)" },

  // Service + recipe counts in hero cards
  { from: "225 Services, 132 Recipes", to: "300+ Services, 180+ Recipes" },
  { from: "225 Services, 188 Recipes", to: "300+ Services, 180+ Recipes" },

  // JP phrases
  { from: "主要SaaS/API 225サービス", to: "主要SaaS/API 300+サービス" },
  { from: "225サービスの格付けデータと188レシピ", to: "300+サービスの格付けデータと180+レシピ" },
  { from: "225サービスを対象とした", to: "300+サービスを対象とした" },
  { from: "225のSaaS/APIサービス", to: "300+のSaaS/APIサービス" },
  { from: "100以上の統合レシピ", to: "180+の統合レシピ" },

  // EN phrases
  { from: "Comprehensive AEO ratings for 225+ global", to: "Comprehensive AEO ratings for 300+ global" },
  { from: "Comprehensive AEO (Agent Engine Optimization) ratings for 225+", to: "Comprehensive AEO (Agent Engine Optimization) ratings for 300+" },
  { from: "Comprehensive AEO ratings for 225+ SaaS/API", to: "Comprehensive AEO ratings for 300+ SaaS/API" },
  { from: "We evaluate 225 SaaS/API services", to: "We evaluate 300+ SaaS/API services" },
  { from: "Covering 225 major SaaS/API services", to: "Covering 300+ major SaaS/API services" },
  { from: "Comprehensive ranking of AI agent readiness across 225 global and Japan SaaS services", to: "Comprehensive ranking of AI agent readiness across 300+ global and Japan SaaS services" },
  { from: "Manual evaluation and rating of 225 services", to: "Manual evaluation and rating of 300+ services" },
  { from: "Based on ratings data from 225 services and execution test results from 188 recipes", to: "Based on ratings data from 300+ services and execution test results from 180+ recipes" },
  { from: "With over 100 integration recipes", to: "With 180+ integration recipes" },

  // Pricing page
  { from: "225サービスのAXR格付けスコア閲覧", to: "300+サービスのAXR格付けスコア閲覧" },
  { from: "225サービスのAXR格付けと188レシピの実行テスト結果", to: "300+サービスのAXR格付けと180+レシピの実行テスト結果" },
  { from: "225サービスのAXRグレード閲覧", to: "300+サービスのAXRグレード閲覧" },
  { from: "browse AXR rating scores for 225 services", to: "browse AXR rating scores for 300+ services" },
  { from: "AXR ratings across 225 services and execution test results from 188 recipes", to: "AXR ratings across 300+ services and execution test results from 180+ recipes" },
  { from: "AXR grades for 225 services", to: "AXR grades for 300+ services" },
  { from: "Comprehensive coverage of 225 major SaaS/API services", to: "Comprehensive coverage of 300+ major SaaS/API services" },

  // Bare "225" inside display widgets (use unique context to avoid hitting API params)
  { from: '<span class="stat-num">225</span>', to: '<span class="stat-num">300+</span>' },
  { from: '<div class="stat-value blue">225</div>', to: '<div class="stat-value blue">300+</div>' },
];

// Never touch: `limit=225`, `rotate(225deg)`, code comments like `total 225`, raw content of JSON
function shouldSkipLine(line) {
  return (
    line.includes("limit=225") ||
    line.includes("rotate(225") ||
    line.includes("// ---") ||
    line.includes("(total 225)")
  );
}

const files = findHtml(path.resolve("public"));

const summary = { files: 0, replacements: 0, byFile: {} };

for (const f of files) {
  let text = fs.readFileSync(f, "utf8");
  const before = text;
  let fileCount = 0;

  for (const { from, to } of REPLACEMENTS) {
    const parts = text.split(from);
    if (parts.length > 1) {
      const reassembled = parts.map((p, i) => {
        if (i === 0) return p;
        const prevEnd = parts[i - 1].slice(-50);
        const nextStart = p.slice(0, 50);
        const context = prevEnd + from + nextStart;
        if (shouldSkipLine(context)) return from + p;
        fileCount++;
        return to + p;
      }).join("");
      text = reassembled;
    }
  }

  if (text !== before) {
    fs.writeFileSync(f, text, "utf8");
    summary.files++;
    summary.replacements += fileCount;
    summary.byFile[path.relative(".", f)] = fileCount;
  }
}

console.log(`=== site count update ===`);
console.log(`files modified: ${summary.files}`);
console.log(`total replacements: ${summary.replacements}`);
console.log();
for (const [f, n] of Object.entries(summary.byFile)) {
  console.log(`  ${n}  ${f}`);
}
