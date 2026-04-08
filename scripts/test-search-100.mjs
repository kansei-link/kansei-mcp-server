#!/usr/bin/env node
/**
 * KanseiLink Search Quality — 100 Query Stress Test
 * Tests across: categories, JP/EN, vague/specific, compound, edge cases
 */
import { searchServices } from "../dist/tools/search-services.js";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.KANSEI_DB_PATH || path.join(__dirname, "..", "kansei-link.db");
const db = new Database(dbPath);

const tests = [
  // === HR (10) ===
  { id: 1, intent: "employee onboarding HR", expect: ["smarthr"], cat: "hr" },
  { id: 2, intent: "勤怠管理", expect: ["jobcan", "kingoftime"], cat: "hr" },
  { id: 3, intent: "給与計算", expect: ["freee-hr"], cat: "hr" },
  { id: 4, intent: "年末調整", expect: ["smarthr", "freee-hr"], cat: "hr" },
  { id: 5, intent: "採用管理 ATS", expect: ["greenhouse", "hrmos"], cat: "hr" },
  { id: 6, intent: "シフト管理", expect: ["kingoftime", "jobcan"], cat: "hr" },
  { id: 7, intent: "talent management platform", expect: ["kaonavi", "smarthr"], cat: "hr" },
  { id: 8, intent: "人事労務 SaaS", expect: ["smarthr", "freee-hr"], cat: "hr" },
  { id: 9, intent: "payroll processing", expect: ["gusto", "rippling", "deel"], cat: "hr" },
  { id: 10, intent: "employee database management", expect: ["smarthr", "bamboohr"], cat: "hr" },

  // === Accounting (10) ===
  { id: 11, intent: "請求書作成", expect: ["freee", "misoca"], cat: "accounting" },
  { id: 12, intent: "経費精算", expect: ["freee", "bakuraku"], cat: "accounting" },
  { id: 13, intent: "確定申告 クラウド", expect: ["freee", "yayoi"], cat: "accounting" },
  { id: 14, intent: "invoice management SaaS", expect: ["freee", "misoca"], cat: "accounting" },
  { id: 15, intent: "bookkeeping automation", expect: ["freee", "yayoi"], cat: "accounting" },
  { id: 16, intent: "expense report tool", expect: ["freee", "bakuraku"], cat: "accounting" },
  { id: 17, intent: "会計ソフト", expect: ["freee", "yayoi"], cat: "accounting" },
  { id: 18, intent: "tax filing Japan", expect: ["freee", "yayoi"], cat: "accounting" },
  { id: 19, intent: "仕訳入力 自動化", expect: ["freee"], cat: "accounting" },
  { id: 20, intent: "クラウド請求書", expect: ["freee", "misoca"], cat: "accounting" },

  // === CRM (8) ===
  { id: 21, intent: "顧客管理 CRM", expect: ["salesforce-jp", "hubspot-jp"], cat: "crm" },
  { id: 22, intent: "名刺管理", expect: ["sansan", "eight"], cat: "crm" },
  { id: 23, intent: "営業支援 SFA", expect: ["salesforce-jp", "hubspot-jp"], cat: "crm" },
  { id: 24, intent: "lead management pipeline", expect: ["hubspot-jp", "salesforce-jp", "pipedrive"], cat: "crm" },
  { id: 25, intent: "contact database CRM", expect: ["salesforce-jp", "hubspot-jp"], cat: "crm" },
  { id: 26, intent: "商談管理", expect: ["salesforce-jp", "hubspot-jp"], cat: "crm" },
  { id: 27, intent: "business card scanning", expect: ["sansan", "eight"], cat: "crm" },
  { id: 28, intent: "sales automation", expect: ["salesforce-jp", "hubspot-jp", "salesgo"], cat: "crm" },

  // === Communication (6) ===
  { id: 29, intent: "社内チャット", expect: ["chatwork", "slack"], cat: "communication" },
  { id: 30, intent: "team messaging", expect: ["slack", "chatwork"], cat: "communication" },
  { id: 31, intent: "ビデオ会議", expect: ["zoom"], cat: "communication" },
  { id: 32, intent: "社内連絡ツール", expect: ["chatwork", "slack", "lineworks"], cat: "communication" },
  { id: 33, intent: "business chat Japan", expect: ["chatwork", "lineworks"], cat: "communication" },
  { id: 34, intent: "team notification system", expect: ["slack", "chatwork"], cat: "communication" },

  // === E-commerce (8) ===
  { id: 35, intent: "e-commerce order management", expect: ["shopify-jp", "base-ec"], cat: "ecommerce" },
  { id: 36, intent: "ネットショップ 開設", expect: ["shopify-jp", "base-ec", "stores-jp"], cat: "ecommerce" },
  { id: 37, intent: "EC在庫管理", expect: ["shopify-jp", "ec-cube"], cat: "ecommerce" },
  { id: 38, intent: "Amazon seller tools", expect: ["amazon-jp"], cat: "ecommerce" },
  { id: 39, intent: "楽天出店 管理", expect: ["rakuten"], cat: "ecommerce" },
  { id: 40, intent: "online store builder", expect: ["shopify-jp", "woocommerce", "base-ec"], cat: "ecommerce" },
  { id: 41, intent: "shopping cart integration", expect: ["shopify-jp", "woocommerce"], cat: "ecommerce" },
  { id: 42, intent: "デジタルコンテンツ販売", expect: ["gumroad", "lemonsqueezy"], cat: "ecommerce" },

  // === Legal (6) ===
  { id: 43, intent: "電子契約", expect: ["cloudsign", "docusign-jp"], cat: "legal" },
  { id: 44, intent: "contract lifecycle management", expect: ["cloudsign", "docusign-jp"], cat: "legal" },
  { id: 45, intent: "NDA 電子署名", expect: ["cloudsign", "docusign-jp"], cat: "legal" },
  { id: 46, intent: "法務 契約管理", expect: ["cloudsign", "legalon"], cat: "legal" },
  { id: 47, intent: "e-signature platform", expect: ["docusign-jp", "cloudsign"], cat: "legal" },
  { id: 48, intent: "契約書レビュー AI", expect: ["legalon"], cat: "legal" },

  // === Project Management (8) ===
  { id: 49, intent: "project task management", expect: ["clickup", "asana", "backlog"], cat: "pm" },
  { id: 50, intent: "タスク管理 カンバン", expect: ["backlog", "clickup", "trello"], cat: "pm" },
  { id: 51, intent: "バグ管理 issue tracking", expect: ["backlog", "jira", "linear"], cat: "pm" },
  { id: 52, intent: "agile sprint planning", expect: ["jira", "asana", "clickup"], cat: "pm" },
  { id: 53, intent: "プロジェクト進捗管理", expect: ["backlog", "asana"], cat: "pm" },
  { id: 54, intent: "team collaboration workspace", expect: ["notion", "clickup"], cat: "pm" },
  { id: 55, intent: "ガントチャート プロジェクト", expect: ["wrike", "monday-com", "backlog"], cat: "pm" },
  { id: 56, intent: "software development project tracker", expect: ["jira", "linear", "backlog"], cat: "pm" },

  // === DevOps (8) ===
  { id: 57, intent: "CI/CD deployment", expect: ["github-actions", "circleci"], cat: "devops" },
  { id: 58, intent: "container orchestration", expect: ["cloudflare", "fly-io"], cat: "devops" },
  { id: 59, intent: "application monitoring APM", expect: ["new-relic", "grafana-cloud", "pagerduty"], cat: "devops" },
  { id: 60, intent: "インフラ監視 アラート", expect: ["pagerduty", "grafana-cloud"], cat: "devops" },
  { id: 61, intent: "serverless hosting", expect: ["vercel", "netlify", "cloudflare"], cat: "devops" },
  { id: 62, intent: "git repository hosting", expect: ["github", "gitlab", "bitbucket"], cat: "devops" },
  { id: 63, intent: "デプロイ自動化", expect: ["github-actions", "circleci"], cat: "devops" },
  { id: 64, intent: "error tracking debugging", expect: ["sentry"], cat: "devops" },

  // === AI/ML (8) ===
  { id: 65, intent: "AI inference API", expect: ["openai-api", "groq", "anthropic-api"], cat: "ai" },
  { id: 66, intent: "LLM チャットボット", expect: ["openai-api", "anthropic-api"], cat: "ai" },
  { id: 67, intent: "text to speech API", expect: ["elevenlabs"], cat: "ai" },
  { id: 68, intent: "vector database embedding", expect: ["pinecone", "weaviate", "qdrant"], cat: "ai" },
  { id: 69, intent: "RAG retrieval augmented generation", expect: ["langchain", "pinecone"], cat: "ai" },
  { id: 70, intent: "AI画像生成", expect: ["replicate"], cat: "ai" },
  { id: 71, intent: "LLM observability tracing", expect: ["langfuse"], cat: "ai" },
  { id: 72, intent: "web search API for AI", expect: ["tavily", "brave-search", "perplexity"], cat: "ai" },

  // === Marketing (8) ===
  { id: 73, intent: "customer data platform", expect: ["mixpanel", "amplitude", "bdash", "segment"], cat: "marketing" },
  { id: 74, intent: "メール配信 マーケティング", expect: ["brevo", "klaviyo"], cat: "marketing" },
  { id: 75, intent: "MA マーケティングオートメーション", expect: ["marketo", "hubspot-jp"], cat: "marketing" },
  { id: 76, intent: "SNS 投稿管理", expect: ["buffer"], cat: "marketing" },
  { id: 77, intent: "web analytics dashboard", expect: ["mixpanel", "amplitude", "posthog"], cat: "marketing" },
  { id: 78, intent: "email campaign automation", expect: ["brevo", "klaviyo", "customer-io"], cat: "marketing" },
  { id: 79, intent: "product analytics funnel", expect: ["mixpanel", "amplitude", "posthog"], cat: "marketing" },
  { id: 80, intent: "SEO competitor analysis", expect: ["ahrefs"], cat: "marketing" },

  // === Data / BI (6) ===
  { id: 81, intent: "BI ダッシュボード", expect: ["tableau", "metabase", "looker"], cat: "bi" },
  { id: 82, intent: "data warehouse cloud", expect: ["bigquery", "snowflake", "databricks"], cat: "bi" },
  { id: 83, intent: "SQL query visualization", expect: ["metabase", "tableau"], cat: "bi" },
  { id: 84, intent: "データ可視化 レポート", expect: ["tableau", "metabase"], cat: "bi" },
  { id: 85, intent: "ETL data pipeline", expect: ["treasure-data", "segment"], cat: "bi" },
  { id: 86, intent: "KPI monitoring real-time", expect: ["grafana-cloud", "metabase"], cat: "bi" },

  // === Support (6) ===
  { id: 87, intent: "カスタマーサポート チケット", expect: ["zendesk", "freshdesk"], cat: "support" },
  { id: 88, intent: "helpdesk ticketing system", expect: ["zendesk", "freshdesk", "helpscout"], cat: "support" },
  { id: 89, intent: "チャットボット 問い合わせ", expect: ["channel-talk", "karte"], cat: "support" },
  { id: 90, intent: "customer support automation", expect: ["zendesk", "freshdesk", "gorgias"], cat: "support" },
  { id: 91, intent: "問い合わせ管理", expect: ["zendesk", "freshdesk"], cat: "support" },
  { id: 92, intent: "live chat customer service", expect: ["channel-talk", "front"], cat: "support" },

  // === Storage / Groupware (4) ===
  { id: 93, intent: "ファイル共有 クラウド", expect: ["dropbox-business", "box-jp", "google-workspace"], cat: "storage" },
  { id: 94, intent: "team file storage", expect: ["dropbox-business", "box-jp"], cat: "storage" },
  { id: 95, intent: "社内wiki ナレッジベース", expect: ["notion", "confluence"], cat: "groupware" },
  { id: 96, intent: "グループウェア 日本", expect: ["garoon", "google-workspace"], cat: "groupware" },

  // === Payment / Logistics (4) ===
  { id: 97, intent: "オンライン決済", expect: ["stripe-global", "payjp"], cat: "payment" },
  { id: 98, intent: "subscription billing", expect: ["stripe-global"], cat: "payment" },
  { id: 99, intent: "配送追跡 物流", expect: ["japan-post"], cat: "logistics" },
  { id: 100, intent: "shipping label API", expect: ["japan-post"], cat: "logistics" },

  // === Edge cases / Vague queries (5) ===
  { id: 101, intent: "DX推進 バックオフィス", expect: ["freee"], cat: "vague" },
  { id: 102, intent: "ペーパーレス化", expect: ["cloudsign", "freee"], cat: "vague" },
  { id: 103, intent: "リモートワーク ツール", expect: ["slack", "zoom", "notion"], cat: "vague" },
  { id: 104, intent: "スタートアップ 必須SaaS", expect: [], cat: "vague" },
  { id: 105, intent: "best MCP server for CRM", expect: ["salesforce-jp", "hubspot-jp"], cat: "vague" },
];

// Run all tests
let pass = 0, partial = 0, fail = 0;
const failures = [];
const catStats = {};

for (const t of tests) {
  const results = searchServices(db, t.intent, undefined, 10);
  const ids = results.map(r => r.service_id);
  const top3cats = results.slice(0, 3).map(r => r.category);

  const found = t.expect.filter(e => ids.includes(e));
  const missing = t.expect.filter(e => !ids.includes(e));

  let grade;
  if (t.expect.length === 0) {
    // Vague query — just check results exist
    grade = results.length > 0 ? "PASS" : "FAIL";
  } else if (found.length === t.expect.length) {
    grade = "PASS";
  } else if (found.length >= Math.ceil(t.expect.length * 0.5)) {
    grade = "PARTIAL";
  } else {
    grade = "FAIL";
  }

  if (grade === "PASS") pass++;
  else if (grade === "PARTIAL") partial++;
  else fail++;

  // Track category stats
  if (!catStats[t.cat]) catStats[t.cat] = { pass: 0, partial: 0, fail: 0, total: 0 };
  catStats[t.cat].total++;
  catStats[t.cat][grade.toLowerCase()]++;

  if (grade !== "PASS") {
    const top5 = results.slice(0, 5).map((r, i) => `${r.service_id}[${r.category}]`).join(", ");
    failures.push({
      id: t.id,
      intent: t.intent,
      grade,
      missing: missing.join(", "),
      top5,
      cat: t.cat,
    });
  }
}

// Summary
console.log("=== KanseiLink Search Quality — 100+ Query Test ===\n");
console.log(`PASS: ${pass}  PARTIAL: ${partial}  FAIL: ${fail}  Total: ${tests.length}`);
console.log(`Pass rate: ${Math.round(pass / tests.length * 100)}%  (incl. partial: ${Math.round((pass + partial) / tests.length * 100)}%)\n`);

// Category breakdown
console.log("--- Category Breakdown ---");
for (const [cat, s] of Object.entries(catStats).sort((a, b) => a[0].localeCompare(b[0]))) {
  const pct = Math.round(s.pass / s.total * 100);
  const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
  console.log(`  ${cat.padEnd(14)} ${bar} ${pct}% (${s.pass}/${s.total}) P:${s.pass} R:${s.partial} F:${s.fail}`);
}

// Failures detail
if (failures.length > 0) {
  console.log(`\n--- Failures & Partials (${failures.length}) ---`);
  for (const f of failures) {
    console.log(`  #${String(f.id).padStart(3)} [${f.grade.padEnd(7)}] "${f.intent}"`);
    console.log(`       Missing: ${f.missing || "n/a"}  |  Top5: ${f.top5}`);
  }
}

db.close();
