#!/usr/bin/env tsx
/**
 * Generate ranking table data for homepage from DB.
 * Outputs JS array for embedding in index.html.
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../kansei-link.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Category mapping: all known DB category values → JA display
const catJA: Record<string, string> = {
  // Capitalized EN (from crawl)
  "AI & LLM": "AI・機械学習",
  "Commerce": "EC・コマース",
  "Communication": "コミュニケーション",
  "Data & Analytics": "BI・アナリティクス",
  "DeFi & Web3": "DeFi・Web3",
  "Design": "デザイン",
  "Developer Tools": "開発ツール",
  "File Storage": "ストレージ",
  "Finance & Accounting": "会計・経理",
  "IoT & Hardware": "IoT",
  "Knowledge & Docs": "生産性ツール",
  "Location & Travel": "旅行・位置情報",
  "Media & Content": "メディア",
  "Other": "その他",
  "Project Management": "プロジェクト管理",
  "Search & Discovery": "データ連携",
  "Security": "セキュリティ",
  // snake_case (from seed/manual)
  "accounting": "会計・経理",
  "ai-ml": "AI・機械学習",
  "ai_ml": "AI・機械学習",
  "automation": "データ連携",
  "bi_analytics": "BI・アナリティクス",
  "communication": "コミュニケーション",
  "crm": "CRM",
  "data_integration": "データ連携",
  "database": "データベース",
  "design": "デザイン",
  "developer_tools": "開発ツール",
  "devops": "DevOps",
  "ecommerce": "EC・コマース",
  "finance": "会計・経理",
  "food_beverage": "飲食",
  "groupware": "グループウェア",
  "hr": "人事・労務",
  "legal": "法務",
  "marketing": "マーケティング",
  "payment": "決済",
  "productivity": "生産性ツール",
  "project_management": "プロジェクト管理",
  "security": "セキュリティ",
  "storage": "ストレージ",
  "support": "サポート",
};

// ---- Top tier: trust_score >= 0.6 (verified/rich) ----
const topServices = db.prepare(`
  SELECT
    s.id, s.name, s.axr_grade, s.trust_score,
    s.mcp_status, s.mcp_endpoint, s.api_auth_method, s.category
  FROM services s
  WHERE s.archived = 0 AND s.trust_score >= 0.6
  ORDER BY s.trust_score DESC, s.name
  LIMIT 150
`).all() as any[];

// ---- Middle tier: 0.4 <= trust_score < 0.6 (reachable) — sample ----
const midServices = db.prepare(`
  SELECT
    s.id, s.name, s.axr_grade, s.trust_score,
    s.mcp_status, s.mcp_endpoint, s.api_auth_method, s.category
  FROM services s
  WHERE s.archived = 0 AND s.trust_score >= 0.4 AND s.trust_score < 0.6
  ORDER BY s.trust_score DESC, s.name
  LIMIT 50
`).all() as any[];

// ---- Low tier: trust_score < 0.4 — sample for depth ----
const lowServices = db.prepare(`
  SELECT
    s.id, s.name, s.axr_grade, s.trust_score,
    s.mcp_status, s.mcp_endpoint, s.api_auth_method, s.category
  FROM services s
  WHERE s.archived = 0 AND s.trust_score < 0.4 AND s.trust_score > 0
  ORDER BY s.trust_score DESC, s.name
  LIMIT 50
`).all() as any[];

const allServices = [...topServices, ...midServices, ...lowServices];

// Recipe count per service (required_services is a JSON-encoded array string)
const recipes = db.prepare("SELECT required_services FROM recipes").all() as any[];
const recipeMap: Record<string, number> = {};
for (const r of recipes) {
  let raw: string = r.required_services || "";
  // Handle double-encoded JSON: "\"[\\\"a\\\",\\\"b\\\"]\""
  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (Array.isArray(parsed)) {
      for (const id of parsed) {
        if (typeof id === "string" && id.trim()) {
          recipeMap[id.trim()] = (recipeMap[id.trim()] || 0) + 1;
        }
      }
    }
  } catch {
    // Fallback: comma-separated
    const ids = raw.split(",").map((s: string) => s.trim().replace(/["\[\]\\]/g, "")).filter(Boolean);
    for (const id of ids) {
      recipeMap[id] = (recipeMap[id] || 0) + 1;
    }
  }
}

// Success rate from outcomes
const outcomes = db.prepare(`
  SELECT service_id,
    ROUND(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0 END)) as rate
  FROM outcomes
  GROUP BY service_id
`).all() as any[];
const outcomeMap: Record<string, number> = {};
for (const o of outcomes) {
  outcomeMap[o.service_id] = o.rate;
}

function gradeFromScore(score: number): string {
  if (score >= 0.95) return "AAA";
  if (score >= 0.85) return "AA";
  if (score >= 0.75) return "A";
  if (score >= 0.6) return "BBB";
  if (score >= 0.45) return "BB";
  if (score >= 0.3) return "B";
  if (score >= 0.15) return "CCC";
  return "D";
}

function mcpLabel(status: string): string {
  switch (status) {
    case "official": return "Official";
    case "verified": return "Verified";
    case "community": return "Community";
    case "api_only": return "API Only";
    case "third_party": return "Third-party";
    default: return "Community";
  }
}

function statusLabel(score: number, mcpStatus: string): string {
  if (score >= 0.6 && (mcpStatus === "official" || mcpStatus === "verified")) return "Verified";
  if (score >= 0.4) return "Connectable";
  return "Connectable";
}

function agentReady(score: number, mcpStatus: string): string {
  if (score >= 0.6 && (mcpStatus === "official" || mcpStatus === "verified")) return "verified";
  if (score >= 0.4) return "connectable";
  return "connectable";
}

const lines: string[] = [];

for (const s of allServices) {
  const grade = s.axr_grade || gradeFromScore(s.trust_score);
  const rc = recipeMap[s.id] || 0;
  const sr = outcomeMap[s.id] !== undefined ? `${outcomeMap[s.id]}%` : "—";
  const cat = catJA[s.category] || s.category || "その他";
  const mcp = mcpLabel(s.mcp_status);
  const status = statusLabel(s.trust_score, s.mcp_status);
  const ar = agentReady(s.trust_score, s.mcp_status);
  const auth = s.api_auth_method || "API Key";

  let entry = `  { name:${JSON.stringify(s.name)}, grade:"${grade}", score:${s.trust_score}, status:"${status}", mcp:"${mcp}", recipes:${rc}, success:"${sr}", category:"${cat}", agentReady:"${ar}"`;
  if (s.mcp_endpoint) {
    entry += `, mcpEndpoint:${JSON.stringify(s.mcp_endpoint)}`;
  }
  entry += `, apiAuth:"${auth}" }`;
  lines.push(entry);
}

console.log("const services = [");
console.log(lines.join(",\n"));
console.log("];");

console.error(`\nGenerated ${lines.length} entries`);
console.error(`  Top tier (≥0.6): ${topServices.length}`);
console.error(`  Mid tier (0.4–0.6): ${midServices.length}`);
console.error(`  Low tier (<0.4): ${lowServices.length}`);

db.close();
