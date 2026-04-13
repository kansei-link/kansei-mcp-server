import type Database from "better-sqlite3";

const VERIFIED_TIPS = [
  {
    tip_id: "infra-vercel-to-cloudflare",
    category: "infrastructure",
    title: "Vercel → Cloudflare Workers migration",
    from_stack: "Vercel (Edge Functions / Serverless)",
    to_stack: "Cloudflare Workers",
    savings_pct: 85,
    confidence: "verified",
    conditions: "High-traffic apps (100M+ req/month) benefit most. Trade-off: Vercel has better Next.js DX. Cloudflare has no bandwidth charges.",
    evidence_url: "https://www.morphllm.com/comparisons/cloudflare-workers-vs-vercel",
    evidence_summary: "100M req/month: Vercel ~$200 vs Cloudflare ~$30. Cloudflare paid plan $5/mo includes 10M requests, $0.30/M after. No bandwidth fees.",
    related_services: '["vercel", "cloudflare"]',
  },
  {
    tip_id: "infra-app-runner-to-cloudflare",
    category: "infrastructure",
    title: "AWS App Runner → Cloudflare Workers / ECS Express",
    from_stack: "AWS App Runner",
    to_stack: "Cloudflare Workers or Amazon ECS Express Mode",
    savings_pct: 50,
    confidence: "verified",
    conditions: "App Runner stops accepting new customers 2026/4/30. Existing services continue but no new features. Migration recommended.",
    evidence_url: "https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html",
    evidence_summary: "AWS App Runner entering maintenance mode. New signups blocked from April 30, 2026. AWS recommends ECS Express Mode as successor.",
    related_services: '["aws", "cloudflare"]',
  },
  {
    tip_id: "orm-prisma-to-drizzle",
    category: "architecture",
    title: "Prisma → Drizzle ORM for edge/serverless",
    from_stack: "Prisma ORM",
    to_stack: "Drizzle ORM",
    savings_pct: 0,
    confidence: "verified",
    conditions: "Critical for Cloudflare Workers (3MB free plan limit). Drizzle ~7KB vs Prisma ~600KB gzipped (85x smaller). Cold start 300-500ms faster.",
    evidence_url: "https://www.pkgpulse.com/blog/prisma-vs-drizzle-2026",
    evidence_summary: "Drizzle: ~7KB gzip, zero binary deps, native edge runtime. Prisma 7: ~600KB gzip, needs Accelerate proxy for edge. 85x bundle size difference.",
    related_services: '[]',
  },
  {
    tip_id: "api-claude-cache-read",
    category: "model_optimization",
    title: "Claude API prompt caching (cache read = 90% off)",
    from_stack: "Standard Claude API input tokens",
    to_stack: "Claude API with prompt caching enabled",
    savings_pct: 90,
    confidence: "verified",
    conditions: "Requires repeated context/system prompts. Cache read = 0.1x base input price. 5-min cache write = 1.25x, 1-hour = 2x. Pays off after 1-2 reads.",
    evidence_url: "https://platform.claude.com/docs/en/about-claude/pricing",
    evidence_summary: "Sonnet: $3/MTok input → $0.30/MTok cache read. Opus: $15/MTok → $1.50/MTok. Combined with batch API, up to 95% savings possible.",
    related_services: '[]',
  },
  {
    tip_id: "plan-max-sub-vs-api",
    category: "model_optimization",
    title: "Claude Max subscription vs API pay-per-token",
    from_stack: "Claude API (pay-per-token)",
    to_stack: "Claude Max $100-$200/month subscription",
    savings_pct: 93,
    confidence: "conditional",
    conditions: "Only for heavy users (200M+ tokens/month). Light users (<50M tokens) are cheaper on API. Power user reported ~10B tokens for $100/mo vs $15K API equivalent.",
    evidence_url: "https://www.ksred.com/claude-code-pricing-guide-which-plan-actually-saves-you-money/",
    evidence_summary: "Max $100/mo = 5x Pro usage. Heavy users save 90%+. Light users should stay on API. Break-even around 50-100M tokens/month.",
    related_services: '[]',
  },
];

export function seedInfrastructureTips(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO infrastructure_tips
      (tip_id, category, title, from_stack, to_stack, savings_pct, confidence, conditions, evidence_url, evidence_summary, related_services)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const tip of VERIFIED_TIPS) {
    const result = insert.run(
      tip.tip_id, tip.category, tip.title, tip.from_stack, tip.to_stack,
      tip.savings_pct, tip.confidence, tip.conditions, tip.evidence_url,
      tip.evidence_summary, tip.related_services
    );
    if (result.changes > 0) inserted++;
  }

  if (inserted > 0) {
    console.log(`Seeded ${inserted} infrastructure tips.`);
  }
}
