#!/usr/bin/env node
/**
 * pSEO Page Generator for KanseiLINK
 *
 * Generates individual service pages from aeo-data.json.
 * Target: services with grade BBB and above.
 * Purpose: agent discoverability (AEO) + human SEO.
 *
 * URL pattern: /services/{service_id}/
 * Output:      public/services/{service_id}/index.html
 *
 * Usage: node scripts/generate-pseo-pages.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_PATH = join(ROOT, "public", "aeo-data.json");
const OUT_DIR = join(ROOT, "public", "services");

// Minimum grade to generate a page for
const MIN_GRADES = new Set(["AAA", "AA", "A", "BBB"]);

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

function generatePage(service) {
  const s = service;
  const cat = CATEGORY_LABELS[s.category] || s.category;
  const gradeColor = GRADE_COLORS[s.grade] || "#6B7280";
  const gradeLabel = GRADE_LABELS[s.grade] || s.grade;
  const title = `${s.name} AEO Score & AI Agent Readiness | KanseiLink`;
  const desc = `${s.name} is rated ${s.grade} (score: ${s.aeo_score.toFixed(2)}) for AI agent readiness. ${cat} category. Check MCP status, integration options, and how to connect via AI agents.`;
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
      a: `In the ${cat} category, ${s.name} is rated ${s.grade}. KanseiLink evaluates services based on MCP availability, API quality, documentation, agent success rates, and integration recipe availability. Visit the full rankings at kansei-link.com to see how ${s.name} compares.`,
    },
    {
      q: `How can I integrate ${s.name} with an AI agent?`,
      a: `The fastest way to integrate ${s.name} with an AI agent is through KanseiLink MCP. Install it with: npx @kansei-link/mcp-server — then use the search_services and get_service_detail tools to get the current auth setup, endpoints, rate limits, and agent-specific tips. This data is kept fresh and verified against real agent usage.`,
    },
  ];

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
    <p>Exact success rates, auth setup, endpoints, rate limits, known pitfalls, and step-by-step recipes — all verified against real agent usage.</p>
    <code class="cta-code">npx @kansei-link/mcp-server</code>
    <p style="margin-top:12px;margin-bottom:0;font-size:13px;color:var(--gray-text)">Then use: <code style="background:var(--white);padding:2px 6px;border-radius:4px;font-size:12px">search_services</code> → <code style="background:var(--white);padding:2px 6px;border-radius:4px;font-size:12px">get_service_detail</code></p>
  </div>
</section>

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

const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));

// Collect all unique services with dedup
const serviceMap = new Map();
data.overall_top.forEach((s) => serviceMap.set(s.service_id, s));
Object.values(data.category_rankings).forEach((cat) =>
  cat.rankings.forEach((s) => {
    if (!serviceMap.has(s.service_id)) serviceMap.set(s.service_id, s);
  })
);

// Filter to BBB+ only
const targets = [...serviceMap.values()].filter((s) =>
  MIN_GRADES.has(s.grade)
);

console.log(`Found ${serviceMap.size} total services, ${targets.length} with grade BBB+`);

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
