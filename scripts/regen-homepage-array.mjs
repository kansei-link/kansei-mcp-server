#!/usr/bin/env node
/**
 * Regenerate the hardcoded `const services = [...]` array inside
 * public/index.html from the current kansei-link.db. The homepage
 * keeps a static data block for SEO (search engines parse it
 * without running JS), so we refresh it whenever the DB grows.
 *
 * Run after regen-seed.mjs in the daily loop. Idempotent: if the
 * output is byte-for-byte identical, no file change happens.
 *
 *   node scripts/regen-homepage-array.mjs
 */
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "kansei-link.db");
const indexPath = path.join(__dirname, "..", "public", "index.html");

const START_MARKER = "// Service data (embedded for static site)";
const ARRAY_PREFIX = "const services = [";
const ARRAY_SUFFIX = "];";

const db = new Database(dbPath, { readonly: true });

// Pull what the homepage array needs — roughly matching the current
// hand-written shape. Stable ordering: axr_score DESC, then id.
const rows = db
  .prepare(
    `SELECT s.id, s.name, s.category, s.mcp_status, s.mcp_endpoint,
            s.api_auth_method, s.axr_score, s.axr_grade, s.trust_score,
            COALESCE(ss.success_rate, 0) as success_rate,
            COALESCE(r.recipe_count, 0) as recipe_count
     FROM services s
     LEFT JOIN service_stats ss ON ss.service_id = s.id
     LEFT JOIN (
       SELECT j.value as svc_id, COUNT(*) as recipe_count
       FROM recipes, json_each(recipes.required_services) j
       GROUP BY j.value
     ) r ON r.svc_id = s.id
     WHERE s.axr_score IS NOT NULL
     ORDER BY s.axr_score DESC, s.id ASC`
  )
  .all();

function statusFromRow(r) {
  if (!r.mcp_endpoint && !r.api_auth_method) return "API Only";
  if (r.mcp_status === "official") return "Verified";
  if (r.mcp_status === "third_party" || r.mcp_status === "community") return "Connectable";
  if (r.mcp_status === "api_only" || !r.mcp_status) return "Connectable";
  return "Connectable";
}

function mcpTypeLabel(r) {
  if (r.mcp_status === "official") return "Official";
  if (r.mcp_status === "third_party") return "Third-party";
  if (r.mcp_status === "community") return "Community";
  return "API Only";
}

function authLabel(r) {
  if (!r.api_auth_method) return "";
  const m = { oauth2: "OAuth 2.0", oauth2_pkce: "OAuth 2.0 PKCE", api_key: "API Key", bearer: "Bearer Token" };
  return m[r.api_auth_method] ?? r.api_auth_method;
}

function categoryLabel(cat) {
  // Map internal category slugs to the user-facing JP labels the homepage uses.
  const map = {
    crm: "CRM",
    accounting: "会計・経理",
    hr: "人事・労務",
    legal: "法務・契約",
    ecommerce: "EC・コマース",
    communication: "コミュニケーション",
    productivity: "生産性ツール",
    groupware: "グループウェア",
    project_management: "プロジェクト管理",
    storage: "ストレージ",
    payment: "決済",
    marketing: "マーケティング",
    support: "サポート",
    data_integration: "データ連携",
    database: "データベース",
    ai_ml: "AI・機械学習",
    "ai-ml": "AI・機械学習",
    bi_analytics: "BI・アナリティクス",
    developer_tools: "開発ツール",
    devops: "DevOps",
    finance: "金融",
    security: "セキュリティ",
    automation: "オートメーション",
    design: "デザイン",
    media: "メディア",
    search: "検索",
    logistics: "物流",
    reservation: "予約",
    food_beverage: "飲食",
    iot: "IoT",
  };
  return map[cat] ?? cat;
}

function jsLiteral(obj) {
  // Produce a compact JS object literal on one line (matches existing style).
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    let valStr;
    if (Array.isArray(v)) {
      valStr = "[" + v.map((x) => JSON.stringify(x)).join(",") + "]";
    } else if (typeof v === "string") {
      valStr = JSON.stringify(v);
    } else {
      valStr = String(v);
    }
    parts.push(`${k}:${valStr}`);
  }
  return `{ ${parts.join(", ")} }`;
}

const serviceObjs = rows.map((r) => {
  const scoreDecimal = r.axr_score != null ? Math.round((r.axr_score / 100) * 100) / 100 : null;
  const successPct =
    r.success_rate && r.success_rate > 0
      ? Math.round(r.success_rate * 100) + "%"
      : "N/A";
  const obj = {
    name: r.name,
    grade: r.axr_grade ?? "BB",
    score: scoreDecimal != null ? scoreDecimal : 0.5,
    status: statusFromRow(r),
    mcp: mcpTypeLabel(r),
    recipes: r.recipe_count ?? 0,
    success: successPct,
    category: categoryLabel(r.category),
    agentReady: r.mcp_status === "official" ? "verified" : "connectable",
  };
  if (r.mcp_endpoint) obj.mcpEndpoint = r.mcp_endpoint;
  const auth = authLabel(r);
  if (auth) obj.apiAuth = auth;
  return obj;
});

const arrayBody = serviceObjs.map((o) => "  " + jsLiteral(o) + ",").join("\n");
const newBlock = `${START_MARKER}\n${ARRAY_PREFIX}\n${arrayBody}\n${ARRAY_SUFFIX}`;

// Replace the existing block in index.html.
const html = readFileSync(indexPath, "utf-8");
const startIdx = html.indexOf(START_MARKER);
if (startIdx === -1) {
  console.error(`[regen-homepage] START_MARKER not found in ${indexPath}`);
  process.exit(1);
}
// The existing block ends at the first `];` after the prefix. Use a
// conservative search so we don't eat unrelated arrays.
const prefixIdx = html.indexOf(ARRAY_PREFIX, startIdx);
if (prefixIdx === -1) {
  console.error(`[regen-homepage] ARRAY_PREFIX not found after marker`);
  process.exit(1);
}
const endIdx = html.indexOf(ARRAY_SUFFIX, prefixIdx);
if (endIdx === -1) {
  console.error(`[regen-homepage] ARRAY_SUFFIX not found after prefix`);
  process.exit(1);
}
const endFinal = endIdx + ARRAY_SUFFIX.length;

const before = html.slice(0, startIdx);
const after = html.slice(endFinal);
const updatedHtml = before + newBlock + after;

if (updatedHtml === html) {
  console.log("[regen-homepage] no change — homepage array already matches DB");
  db.close();
  process.exit(0);
}

writeFileSync(indexPath, updatedHtml, "utf-8");

const prevCount = (html.match(/^\s*\{\s*name:/gm) || []).length;
const nextCount = serviceObjs.length;

console.log("=== regen-homepage ===");
console.log(`services embedded: ${prevCount} -> ${nextCount}  (${nextCount - prevCount >= 0 ? "+" : ""}${nextCount - prevCount})`);
console.log(`wrote: ${indexPath}`);

db.close();
