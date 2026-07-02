#!/usr/bin/env node
/**
 * pSEO Page Generator for KanseiLINK
 *
 * Generates individual service pages from kansei-link.db.
 * Target (2026-07-02 Phase 1): every service with a curated API guide
 * (service_api_guides, ~199) plus any service that already has a page.
 * Guides are curated from official docs + registry checks, so these
 * pages carry real connection content ("how to connect X" queries),
 * not just a grade — authority-before-scale.
 *
 * URL pattern: /services/{service_id}/
 * Output:      public/services/{service_id}/index.html
 *
 * Usage: node scripts/generate-pseo-pages.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DB_PATH = join(ROOT, "kansei-link.db");
const OUT_DIR = join(ROOT, "public", "services");

const CATEGORY_LABELS = {
  accounting: "Accounting & Finance",
  hr: "HR & People",
  communication: "Communication",
  crm: "CRM & Sales",
  project_management: "Project Management",
  ecommerce: "E-Commerce",
  legal: "Legal & Contracts",
  marketing: "Marketing",
  groupware: "Groupware & Collaboration",
  productivity: "Productivity",
  storage: "Cloud Storage",
  support: "Customer Support",
  payment: "Payment",
  logistics: "Logistics",
  reservation: "Reservations",
  data_integration: "Data Integration",
  bi_analytics: "BI & Analytics",
  security: "Security",
  developer_tools: "Developer Tools",
  ai_ml: "AI & ML",
  database: "Database",
  devops: "DevOps",
  design: "Design",
};

const GRADE_COLORS = {
  AAA: "#065F46",
  AA: "#059669",
  A: "#0891B2",
  BBB: "#D97706",
  BB: "#EA580C",
  B: "#DC2626",
  CCC: "#991B1B",
};

const GRADE_LABELS = {
  AAA: "Excellent — Best-in-class agent integration",
  AA: "Very Good — Strong agent support with minor gaps",
  A: "Good — Functional agent integration",
  BBB: "Adequate — Basic agent connectivity available",
  BB: "Limited — Partial agent connectivity",
  B: "Weak — Significant integration gaps",
  CCC: "Needs Improvement — Not yet agent-ready",
  D: "Not Agent-Ready",
};

function successTier(rate) {
  if (rate == null) return "—";
  if (rate >= 80) return "🟢 High";
  if (rate >= 50) return "🟡 Medium";
  return "🔴 Low";
}

function activityLevel(calls) {
  if (calls == null) return "—";
  if (calls >= 100) return "●●● Active";
  if (calls >= 10) return "●● Moderate";
  return "● New";
}

function agentReadyLabel(status) {
  if (status === "verified") return "✓ Verified";
  if (status === "connectable") return "Connectable";
  return "Info Only";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGuideSection(s) {
  const g = s.guide;
  if (!g) return "";
  let endpoints = [];
  try { endpoints = JSON.parse(g.key_endpoints || "[]"); } catch { /* keep empty */ }
  let tips = [];
  try { tips = JSON.parse(g.agent_tips || "[]"); } catch { /* keep empty */ }

  const factRows = [
    ["Base URL", g.base_url && `<code>${escapeHtml(g.base_url)}</code>`],
    ["API version", g.api_version && escapeHtml(g.api_version)],
    ["Auth", g.auth_overview && escapeHtml(g.auth_overview)],
    ["Token URL", g.auth_token_url && `<code>${escapeHtml(g.auth_token_url)}</code>`],
    ["Scopes", g.auth_scopes && escapeHtml(g.auth_scopes)],
    ["Request body", g.request_content_type && `<code>${escapeHtml(g.request_content_type)}</code>`],
    ["Pagination", g.pagination_style && escapeHtml(g.pagination_style)],
    ["Rate limit", g.rate_limit && escapeHtml(g.rate_limit)],
    ["Error format", g.error_format && `<code>${escapeHtml(g.error_format)}</code>`],
  ].filter(([, v]) => v);

  return `
<section class="guide" id="connect">
  <h2>How to Connect ${escapeHtml(s.name)} to an AI Agent</h2>
  ${g.auth_setup_hint ? `<h3>Auth setup</h3>\n  <p>${escapeHtml(g.auth_setup_hint)}</p>` : ""}
  ${factRows.length ? `<h3>Key facts</h3>\n  <table>\n${factRows.map(([k, v]) => `    <tr><th>${k}</th><td>${v}</td></tr>`).join("\n")}\n  </table>` : ""}
  ${endpoints.length ? `<h3>Key endpoints</h3>\n  <table>\n    <tr><th>Method</th><th>Path</th><th>Description</th></tr>\n${endpoints.map((e) => `    <tr><td><code>${escapeHtml(e.method || "")}</code></td><td><code>${escapeHtml(e.path || "")}</code></td><td>${escapeHtml(e.description || "")}</td></tr>`).join("\n")}\n  </table>` : ""}
  ${g.quickstart_example ? `<h3>Quickstart</h3>\n  <pre><code>${escapeHtml(g.quickstart_example)}</code></pre>` : ""}
  ${tips.length ? `<h3>Agent pitfalls &amp; tips</h3>\n  <ul>\n${tips.map((t) => `    <li>${escapeHtml(t)}</li>`).join("\n")}\n  </ul>` : ""}
  <p class="src-note">Source: curated by KanseiLink from official documentation${g.docs_url ? ` (<a href="${escapeHtml(g.docs_url)}" rel="noopener" target="_blank">docs</a>)` : ""} and registry checks${g.updated_at ? `. Last reviewed: ${escapeHtml(String(g.updated_at).split(" ")[0])}` : ""}. Specs change — verify against the official docs before production use.</p>
</section>`;
}

function generatePage(service) {
  const s = service;
  const cat = CATEGORY_LABELS[s.category] || s.category;
  const gradeColor = GRADE_COLORS[s.grade] || "#6B7280";
  const gradeLabel = GRADE_LABELS[s.grade] || s.grade;
  const title = s.guide
    ? `${s.name} Integration Guide — Auth Setup, Rate Limits & AEO Score | KanseiLink`
    : `${s.name} AEO Score & AI Agent Readiness | KanseiLink`;
  const desc = s.guide
    ? `How to connect ${s.name} to an AI agent: auth setup (${s.guide.auth_scopes ? "scoped " : ""}${(s.guide.auth_overview || "").split(".")[0]}), rate limits, key endpoints, and known pitfalls. AEO grade ${s.grade} in ${cat}.`.slice(0, 300)
    : `${s.name} is rated ${s.grade} (score: ${s.aeo_score.toFixed(2)}) for AI agent readiness. ${cat} category. Check MCP status, integration options, and how to connect via AI agents.`;
  const url = `https://kansei-link.com/services/${s.service_id}/`;
  const today = new Date().toISOString().split("T")[0];

  // FAQ items for JSON-LD + accordion
  const faqs = [
    {
      q: `What is ${s.name}'s AEO score?`,
      a: `${s.name} has an AEO score of ${s.aeo_score.toFixed(2)} and is rated ${s.grade} (${gradeLabel.split(" — ")[1] || gradeLabel}). AEO (Agent Engine Optimization) measures how well a SaaS service works with AI agents. Scores range from 0.00 to 1.00, with grades from AAA (best) to D (not agent-ready).`,
    },
    {
      q: `Is ${s.name} AI-agent-ready?`,
      a: `${s.name} is currently ${agentReadyLabel(s.agent_ready).toLowerCase()} for AI agent use. ${s.mcp_type === "Official MCP" ? "It offers an official MCP (Model Context Protocol) server, which means AI agents can connect directly." : s.mcp_type === "Third-party" ? "Third-party MCP integrations are available for this service." : s.mcp_type === "Community" ? "Community-maintained MCP servers exist for this service." : "API access is available but no dedicated MCP server has been published yet."} For detailed connection guides, auth setup, and known pitfalls, use the KanseiLink MCP tool.`,
    },
    {
      q: `How does ${s.name} compare to other ${cat} services?`,
      a: `In the ${cat} category, ${s.name} is rated ${s.grade}. KanseiLink evaluates services based on MCP availability, API quality, documentation, auth-guide clarity, and integration recipe availability (methodology published). Visit the full rankings at kansei-link.com to see how ${s.name} compares.`,
    },
    {
      q: `How can I integrate ${s.name} with an AI agent?`,
      a: `The fastest way to integrate ${s.name} with an AI agent is through KanseiLink MCP. Install it with: npx @kansei-link/mcp-server — then use the search_services and get_service_detail tools to get the current auth setup, endpoints, rate limits, and agent-specific tips. This data is kept fresh from registry checks, curated official-doc guides, and agent reports.`,
    },
  ];
  if (s.guide?.auth_overview) {
    faqs.push({
      q: `How do I authenticate with ${s.name}?`,
      a: `${s.guide.auth_overview}${s.guide.auth_setup_hint ? " Setup: " + s.guide.auth_setup_hint : ""}`,
    });
  }
  if (s.guide?.rate_limit) {
    faqs.push({
      q: `What are ${s.name}'s API rate limits?`,
      a: s.guide.rate_limit,
    });
  }

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: title,
        description: desc,
        url,
        publisher: {
          "@type": "Organization",
          name: "KanseiLink",
          legalName: "Synapse Arrows PTE. LTD.",
        },
        dateModified: today,
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        // aggregateRating は使わない: ratingCount に total_agent_calls を入れると
        // ユーザーレビュー数を偽装する形になる（実体は probe/seed 含む呼び出し数）。
        // 自社単独評価は critic review (単一 Review, author=KanseiLink) が正直な表現。
        "@type": "SoftwareApplication",
        name: s.name,
        applicationCategory: cat,
        review: {
          "@type": "Review",
          author: {
            "@type": "Organization",
            name: "KanseiLink",
            url: "https://kansei-link.com",
          },
          reviewRating: {
            "@type": "Rating",
            ratingValue: s.aeo_score.toFixed(2),
            bestRating: "1.00",
            worstRating: "0.00",
          },
          reviewBody: `AEO (Agent Engine Optimization) readiness rating by KanseiLink, based on published methodology: MCP availability, API quality, documentation, and auth-guide clarity.`,
        },
      },
    ],
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url}">

  <!-- OGP -->
  <meta property="og:title" content="${escapeHtml(s.name)} AEO Score: ${s.grade} | KanseiLink">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="KanseiLink">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@KanseiLink">

  <!-- JSON-LD -->
  <script type="application/ld+json">${jsonLd}</script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root {
      --blue: #1A3FD6; --blue-light: #7882DC; --teal: #00C4B3;
      --black: #000; --white: #FFF; --lavender: #F4F5FD;
      --gray-light: #F5F5F5; --gray-mid: #E5E7EB;
      --gray-text: #6B7280; --gray-dark: #374151;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; color: var(--black); background: var(--white); line-height: 1.6; -webkit-font-smoothing: antialiased; }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* NAV */
    .nav { background: var(--white); border-bottom: 1px solid var(--gray-mid); position: sticky; top: 0; z-index: 100; }
    .nav .inner { max-width: 960px; margin: 0 auto; padding: 0 24px; display: flex; align-items: center; height: 56px; justify-content: space-between; }
    .logo { font-size: 20px; font-weight: 800; color: var(--blue); text-decoration: none; letter-spacing: -0.5px; }
    .nav-links { display: flex; gap: 20px; font-size: 14px; }
    .nav-links a { color: var(--gray-text); }
    .nav-links a:hover { color: var(--blue); text-decoration: none; }

    /* HERO */
    .hero { background: linear-gradient(135deg, var(--lavender) 0%, var(--white) 100%); padding: 48px 24px; text-align: center; }
    .hero-grade { font-size: 72px; font-weight: 800; line-height: 1; color: ${gradeColor}; margin-bottom: 8px; }
    .hero-score { font-size: 18px; color: var(--gray-text); margin-bottom: 8px; }
    .hero-name { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .hero-cat { font-size: 15px; color: var(--gray-text); text-transform: capitalize; }
    .hero-label { display: inline-block; margin-top: 16px; padding: 4px 16px; border-radius: 9999px; font-size: 13px; font-weight: 600; color: var(--white); background: ${gradeColor}; }

    /* METRICS */
    .metrics { max-width: 720px; margin: -24px auto 0; padding: 0 24px; position: relative; z-index: 10; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; }
    .metric-card { background: var(--white); border: 1px solid var(--gray-mid); border-radius: 12px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .metric-label { font-size: 12px; color: var(--gray-text); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .metric-value { font-size: 18px; font-weight: 600; }

    /* CTA BANNER */
    .cta-banner { max-width: 720px; margin: 32px auto; padding: 0 24px; }
    .cta-card { background: var(--lavender); border: 1px solid rgba(26,63,214,0.1); border-radius: 12px; padding: 24px 32px; text-align: center; }
    .cta-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    .cta-card p { font-size: 14px; color: var(--gray-text); margin-bottom: 16px; }
    .cta-code { display: inline-block; background: var(--white); border: 1px solid var(--gray-mid); border-radius: 8px; padding: 10px 24px; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 15px; font-weight: 600; color: var(--blue); letter-spacing: -0.3px; }

    /* CONNECT GUIDE */
    .guide { max-width: 720px; margin: 40px auto; padding: 0 24px; }
    .guide h2 { font-size: 22px; font-weight: 700; margin-bottom: 20px; }
    .guide h3 { font-size: 16px; font-weight: 700; margin: 24px 0 10px; }
    .guide p, .guide li { font-size: 14px; color: var(--gray-dark); line-height: 1.7; }
    .guide ul { padding-left: 20px; margin: 8px 0; }
    .guide table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; }
    .guide td, .guide th { border: 1px solid var(--gray-mid); padding: 8px 10px; text-align: left; vertical-align: top; }
    .guide th { background: var(--gray-light); font-weight: 600; white-space: nowrap; }
    .guide pre { background: #0F172A; color: #E2E8F0; border-radius: 10px; padding: 16px; font-size: 12.5px; overflow-x: auto; line-height: 1.6; margin: 8px 0; }
    .guide code { font-family: 'SFMono-Regular', Consolas, monospace; }
    .guide .src-note { font-size: 12px; color: var(--gray-text); margin-top: 12px; }

    /* FAQ */
    .faq { max-width: 720px; margin: 40px auto; padding: 0 24px; }
    .faq h2 { font-size: 22px; font-weight: 700; margin-bottom: 20px; }
    .faq-item { border: 1px solid var(--gray-mid); border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
    .faq-q { padding: 16px 20px; font-weight: 600; font-size: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: var(--white); }
    .faq-q:hover { background: var(--gray-light); }
    .faq-q .arrow { font-size: 12px; color: var(--gray-text); transition: transform 0.2s; }
    .faq-q.open .arrow { transform: rotate(180deg); }
    .faq-a { padding: 0 20px 16px; font-size: 14px; color: var(--gray-dark); line-height: 1.7; display: none; }
    .faq-a.open { display: block; }

    /* RELATED */
    .related { max-width: 720px; margin: 40px auto; padding: 0 24px 64px; }
    .related h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: var(--gray-dark); }
    .related-links { display: flex; flex-wrap: wrap; gap: 12px; }
    .related-links a { display: inline-block; padding: 8px 16px; background: var(--gray-light); border-radius: 8px; font-size: 14px; color: var(--gray-dark); }
    .related-links a:hover { background: var(--lavender); color: var(--blue); text-decoration: none; }

    /* FOOTER */
    .footer { border-top: 1px solid var(--gray-mid); padding: 32px 24px; text-align: center; font-size: 13px; color: var(--gray-text); }
    .footer a { color: var(--gray-text); }

    @media (max-width: 600px) {
      .hero-grade { font-size: 56px; }
      .hero-name { font-size: 22px; }
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>

<nav class="nav">
  <div class="inner">
    <a href="/" class="logo">KanseiLink</a>
    <div class="nav-links">
      <a href="/">Rankings</a>
      <a href="/checker/">Score Checker</a>
      <a href="/insights/">Insights</a>
    </div>
  </div>
</nav>

<section class="hero">
  <div class="hero-grade">${s.grade}</div>
  <div class="hero-score">AEO Score: ${s.aeo_score.toFixed(2)} / 1.00</div>
  <h1 class="hero-name">${escapeHtml(s.name)}</h1>
  <div class="hero-cat">${escapeHtml(cat)}</div>
  <div class="hero-label">${escapeHtml(gradeLabel)}</div>
</section>

<section class="metrics">
  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Agent Ready</div>
      <div class="metric-value">${agentReadyLabel(s.agent_ready)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">MCP Type</div>
      <div class="metric-value">${escapeHtml(s.mcp_type || "N/A")}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Success Rate</div>
      <div class="metric-value">${successTier(s.success_rate)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Agent Activity</div>
      <div class="metric-value">${activityLevel(s.total_agent_calls)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Recipes</div>
      <div class="metric-value">${s.recipe_count > 0 ? "✓ Available" : "—"}</div>
    </div>
  </div>
</section>

<section class="cta-banner">
  <div class="cta-card">
    <h3>Get Full Integration Guide</h3>
    <p>Current auth setup, endpoints, rate limits, known pitfalls, and step-by-step recipes — kept fresh from registry checks, curated official-doc guides, and agent reports.</p>
    <code class="cta-code">npx @kansei-link/mcp-server</code>
    <p style="margin-top:12px;margin-bottom:0;font-size:13px;color:var(--gray-text)">Then use: <code style="background:var(--white);padding:2px 6px;border-radius:4px;font-size:12px">search_services</code> → <code style="background:var(--white);padding:2px 6px;border-radius:4px;font-size:12px">get_service_detail</code></p>
  </div>
</section>
${renderGuideSection(s)}
<section class="faq">
  <h2>Frequently Asked Questions</h2>
${faqs
  .map(
    (f, i) => `  <div class="faq-item">
    <div class="faq-q${i === 0 ? " open" : ""}" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
      ${escapeHtml(f.q)}
      <span class="arrow">▼</span>
    </div>
    <div class="faq-a${i === 0 ? " open" : ""}">${escapeHtml(f.a)}</div>
  </div>`
  )
  .join("\n")}
</section>

<section class="related">
  <h2>Explore More</h2>
  <div class="related-links">
    <a href="/">← Full AEO Rankings</a>
    <a href="/checker/?s=${s.service_id}">Score Checker</a>
    <a href="/insights/">Insights & Reports</a>
  </div>
</section>

<footer class="footer">
  <p>&copy; ${new Date().getFullYear()} KanseiLink by Synapse Arrows PTE. LTD.</p>
  <p style="margin-top:8px">
    <a href="/">Rankings</a> · <a href="/checker/">Checker</a> · <a href="/insights/">Insights</a> · <a href="/about.html">About</a>
  </p>
</footer>

</body>
</html>`;
}

// ── Main ──

// ページ対象 = 「キュレーション済みAPIガイドを持つサービス」∪「git管理下の既存ページ」。
// ガイドの無い薄いページを量産しない (authority-before-scale)。
// 既存ページはgit追跡ベースで判定（生成後のreaddirだと自己増殖するため）。
import { execSync } from "child_process";
const existingSlugs = [...new Set(
  execSync("git ls-files public/services", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => (l.match(/^public\/services\/([^/]+)\//) || [])[1])
    .filter(Boolean)
)];

const db = new Database(DB_PATH, { readonly: true });
const placeholders = existingSlugs.map(() => "?").join(",") || "''";
const rows = db
  .prepare(
    `SELECT s.id AS service_id, s.name, s.category, s.mcp_status,
            s.axr_score, s.axr_grade,
            COALESCE(ss.success_rate, 0) AS success_rate_raw,
            COALESCE(ss.total_calls, 0) AS total_agent_calls,
            COALESCE(r.recipe_count, 0) AS recipe_count,
            g.base_url, g.api_version, g.auth_overview, g.auth_token_url, g.auth_scopes,
            g.auth_setup_hint, g.key_endpoints, g.request_content_type, g.pagination_style,
            g.rate_limit, g.error_format, g.quickstart_example, g.agent_tips, g.docs_url,
            g.updated_at AS guide_updated_at
     FROM services s
     LEFT JOIN service_stats ss ON ss.service_id = s.id
     LEFT JOIN service_api_guides g ON g.service_id = s.id
     LEFT JOIN (
       SELECT j.value AS svc_id, COUNT(*) AS recipe_count
       FROM recipes, json_each(recipes.required_services) j
       GROUP BY j.value
     ) r ON r.svc_id = s.id
     WHERE (g.service_id IS NOT NULL
            AND (g.auth_setup_hint IS NOT NULL OR g.rate_limit IS NOT NULL OR g.docs_url IS NOT NULL))
        OR s.id IN (${placeholders})`
  )
  .all(...existingSlugs);
db.close();

function mcpTypeOf(status) {
  if (status === "official") return "Official MCP";
  if (status === "third_party") return "Third-party";
  if (status === "community") return "Community";
  return "API Only";
}

const targets = rows.map((r) => ({
  service_id: r.service_id,
  name: r.name,
  category: r.category,
  grade: r.axr_grade || "BB",
  aeo_score: (r.axr_score ?? 50) / 100,
  agent_ready: r.mcp_status === "official" ? "verified" : "connectable",
  mcp_type: mcpTypeOf(r.mcp_status),
  success_rate: r.success_rate_raw > 0 ? Math.round(r.success_rate_raw * 100) : null,
  total_agent_calls: r.total_agent_calls,
  recipe_count: r.recipe_count,
  guide: r.auth_overview || r.base_url || r.quickstart_example
    ? {
        base_url: r.base_url,
        api_version: r.api_version,
        auth_overview: r.auth_overview,
        auth_token_url: r.auth_token_url,
        auth_scopes: r.auth_scopes,
        auth_setup_hint: r.auth_setup_hint,
        key_endpoints: r.key_endpoints,
        request_content_type: r.request_content_type,
        pagination_style: r.pagination_style,
        rate_limit: r.rate_limit,
        error_format: r.error_format,
        quickstart_example: r.quickstart_example,
        agent_tips: r.agent_tips,
        docs_url: r.docs_url,
        updated_at: r.guide_updated_at,
      }
    : null,
}));

console.log(`Targets: ${targets.length} (guides: ${targets.filter((t) => t.guide).length}, existing pages: ${existingSlugs.length})`);

// Generate pages
let created = 0;
for (const service of targets) {
  const dir = join(OUT_DIR, service.service_id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const html = generatePage(service);
  const outPath = join(dir, "index.html");
  writeFileSync(outPath, html, "utf-8");
  created++;
}

console.log(`Generated ${created} pSEO pages in public/services/`);

// Generate sitemap entries for easy pasting
const sitemapEntries = targets
  .map(
    (s) =>
      `  <url><loc>https://kansei-link.com/services/${s.service_id}/</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`
  )
  .join("\n");

const sitemapPath = join(ROOT, "scripts", "_pseo-sitemap-entries.xml");
writeFileSync(sitemapPath, sitemapEntries, "utf-8");
console.log(`Sitemap entries written to scripts/_pseo-sitemap-entries.xml`);

// Summary
console.log("\nGenerated pages:");
targets.sort((a, b) => b.aeo_score - a.aeo_score);
for (const s of targets) {
  console.log(`  ${s.grade.padEnd(4)} ${s.aeo_score.toFixed(2)}  /services/${s.service_id}/  ${s.name}`);
}
