#!/usr/bin/env node
/**
 * Consolidated 250-test audit runner (2026-04-24)
 *
 * SECTION A: 150 endpoint health checks (HTTP GET)
 * SECTION D: 40 classification spot-checks (heuristic)
 *
 * SECTION B is driven by the agent via MCP tools, not this script.
 *
 * Writes:
 *   - _audit-a-endpoint-health-2026-04-24.json  (per-service A data)
 *   - _audit-d-classification-2026-04-24.json   (per-service D data)
 *   - _audit-services-sample-2026-04-24.json    (meta for reproducibility)
 *
 * Finally the agent composes _audit-report-2026-04-24.md from these.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'kansei-link.db');

const OUT_A = path.join(__dirname, '_audit-a-endpoint-health-2026-04-24.json');
const OUT_D = path.join(__dirname, '_audit-d-classification-2026-04-24.json');
const OUT_SAMPLE = path.join(__dirname, '_audit-services-sample-2026-04-24.json');

const UA = 'kansei-link-audit/1.0';
const TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 10;
const BATCH_GAP_MS = 200;

function nowIso() { return new Date().toISOString(); }

// --- DB bootstrap ----------------------------------------------------
const db = new Database(DB_PATH, { readonly: false, fileMustExist: true });
db.pragma('journal_mode = WAL');

// Verify schema
const cols = db.prepare('PRAGMA table_info(services)').all().map(c => c.name);
const need = ['id', 'name', 'mcp_endpoint', 'category', 'description', 'axr_score', 'axr_grade', 'last_refreshed_at', 'archived'];
const missing = need.filter(n => !cols.includes(n));
if (missing.length) {
  console.error('Missing columns (will degrade gracefully):', missing);
}

// --- Section A: sample 150 ------------------------------------------
const sampleA = db.prepare(`
  SELECT id, name, mcp_endpoint, category
  FROM services
  WHERE mcp_endpoint IS NOT NULL AND mcp_endpoint != ''
    AND mcp_endpoint LIKE 'http%'
  ORDER BY RANDOM() LIMIT 150
`).all();
console.log(`[A] Sampled ${sampleA.length} endpoints to probe`);

// --- Section D: sample 40 -------------------------------------------
const sampleD = db.prepare(`
  SELECT id, name, description, category
  FROM services
  WHERE description IS NOT NULL AND length(description) > 30
    AND axr_score IS NOT NULL
  ORDER BY RANDOM() LIMIT 40
`).all();
console.log(`[D] Sampled ${sampleD.length} services for classification review`);

fs.writeFileSync(OUT_SAMPLE, JSON.stringify({
  generated_at: nowIso(),
  section_a_count: sampleA.length,
  section_d_count: sampleD.length,
  section_a_ids: sampleA.map(s => s.id),
  section_d_ids: sampleD.map(s => s.id),
}, null, 2));

// --- Section A runner ------------------------------------------------
function classify(statusCode, error) {
  if (error) {
    if (/abort|timeout|deadline/i.test(error)) return 'unreachable-timeout';
    return 'unreachable-error';
  }
  if (statusCode >= 200 && statusCode < 300) return 'live';
  if (statusCode >= 300 && statusCode < 400) return 'redirect-issue';
  if (statusCode === 401 || statusCode === 403) return 'live-but-auth-required';
  if (statusCode === 404 || statusCode === 410) return 'gone';
  if (statusCode >= 500) return 'server-error';
  if (statusCode >= 400) return 'client-error';
  return 'unknown';
}

async function probe(svc) {
  const start = Date.now();
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let statusCode = null;
  let finalUrl = null;
  let error = null;
  let redirectHops = 0;
  try {
    // Node's fetch follows redirects automatically (max 20). We record final url.
    const res = await fetch(svc.mcp_endpoint, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': '*/*' },
      signal: ac.signal,
    });
    statusCode = res.status;
    finalUrl = res.url;
    // Read & discard body to release socket (small cap)
    try {
      const reader = res.body?.getReader?.();
      if (reader) {
        let bytes = 0;
        while (bytes < 8192) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value?.byteLength || 0;
        }
        try { await reader.cancel(); } catch {}
      }
    } catch {}
  } catch (e) {
    error = (e && (e.message || String(e))) || 'unknown';
  } finally {
    clearTimeout(to);
  }
  const latency_ms = Date.now() - start;
  return {
    id: svc.id,
    name: svc.name,
    category: svc.category,
    url: svc.mcp_endpoint,
    final_url: finalUrl,
    status: statusCode,
    latency_ms,
    redirect_hops: redirectHops,
    error,
    classification: classify(statusCode, error),
  };
}

async function runA() {
  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < sampleA.length; i += MAX_CONCURRENT) {
    const batch = sampleA.slice(i, i + MAX_CONCURRENT);
    const out = await Promise.all(batch.map(probe));
    results.push(...out);
    process.stdout.write(`\r[A] ${results.length}/${sampleA.length} probed (${Math.round((Date.now()-t0)/1000)}s)   `);
    if (i + MAX_CONCURRENT < sampleA.length) {
      await new Promise(r => setTimeout(r, BATCH_GAP_MS));
    }
  }
  process.stdout.write('\n');

  // Update last_refreshed_at for every service that got ANY HTTP response
  const upd = db.prepare(`UPDATE services SET last_refreshed_at = datetime('now') WHERE id = ?`);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      if (r.status !== null) upd.run(r.id);
    }
  });
  tx(results);

  const now = nowIso();
  fs.writeFileSync(OUT_A, JSON.stringify({ generated_at: now, count: results.length, results }, null, 2));
  console.log(`[A] wrote ${OUT_A}`);
  return results;
}

// --- Section D: heuristic classification check ----------------------
// Official 21 categories
const CATEGORIES = [
  'AI & LLM', 'DeFi & Web3', 'Developer Tools', 'Productivity', 'Communication',
  'Data & Analytics', 'File Storage', 'Search & Discovery', 'Design',
  'Finance & Accounting', 'CRM & Sales', 'Marketing', 'HR & Recruiting',
  'Project Management', 'Knowledge & Docs', 'Media & Content', 'Commerce',
  'Location & Travel', 'IoT & Hardware', 'Security', 'Other'
];

// Keyword -> suggested canonical category. Multiple keywords may apply; scoring picks best.
const KEYWORD_MAP = [
  // AI & LLM
  { cat: 'AI & LLM', kw: ['llm', 'large language model', 'gpt', 'chatbot ai', 'embedding', 'vector db', 'rag', 'ai assistant', 'generative ai', 'machine learning model', 'claude', 'openai', 'anthropic', 'transformer model'] },
  // DeFi & Web3
  { cat: 'DeFi & Web3', kw: ['blockchain', 'crypto', 'web3', 'defi', 'nft', 'ethereum', 'solana', 'bitcoin', 'wallet chain', 'smart contract', 'dao', 'token swap'] },
  // Developer Tools
  { cat: 'Developer Tools', kw: ['developer tool', 'ci/cd', 'devops', 'git hosting', 'source control', 'code review', 'linter', 'build system', 'package manager', 'testing framework', 'ide ', 'sdk for', 'api platform'] },
  // Productivity
  { cat: 'Productivity', kw: ['todo', 'task list', 'note-taking', 'personal productivity', 'calendar app', 'time tracker', 'timer'] },
  // Communication
  { cat: 'Communication', kw: ['chat platform', 'team chat', 'messaging', 'email client', 'video call', 'video conferenc', 'voip', 'sms ', 'push notification'] },
  // Data & Analytics
  { cat: 'Data & Analytics', kw: ['analytics', 'bi dashboard', 'business intelligence', 'data warehouse', 'etl', 'data pipeline', 'metrics dashboard', 'tracking pixel'] },
  // File Storage
  { cat: 'File Storage', kw: ['file storage', 'cloud storage', 'object storage', 'file sync', 'backup service', 'dropbox', 'bucket'] },
  // Search & Discovery
  { cat: 'Search & Discovery', kw: ['search engine', 'enterprise search', 'semantic search', 'discovery platform'] },
  // Design
  { cat: 'Design', kw: ['design tool', 'prototyping', 'wireframe', 'figma', 'vector graphics', 'illustration tool', 'ui design', 'mockup'] },
  // Finance & Accounting
  { cat: 'Finance & Accounting', kw: ['accounting', 'bookkeeping', 'invoice', 'invoicing', '請求書', '会計', '仕訳', '経理', 'tax filing', 'expense management', 'payroll', '給与', 'ledger', 'freee', 'banking api', 'erp'] },
  // CRM & Sales
  { cat: 'CRM & Sales', kw: ['crm', 'sales pipeline', 'lead management', 'customer relationship', 'sales automation', '顧客管理', '名刺'] },
  // Marketing
  { cat: 'Marketing', kw: ['marketing automation', 'email marketing', 'drip campaign', 'seo tool', 'ad platform', 'advertis', 'mailchimp', 'newsletter', 'social media scheduler'] },
  // HR & Recruiting
  { cat: 'HR & Recruiting', kw: ['human resources', 'hr platform', 'recruit', 'applicant tracking', 'onboarding hr', 'performance review', '勤怠', '人事', '採用', 'employee management'] },
  // Project Management
  { cat: 'Project Management', kw: ['project management', 'kanban', 'issue tracker', 'sprint planning', 'task management', 'gantt', 'scrum', 'jira'] },
  // Knowledge & Docs
  { cat: 'Knowledge & Docs', kw: ['wiki', 'knowledge base', 'documentation platform', 'docs platform', 'note editor', 'confluence', 'notion', '議事録', 'ドキュメント管理'] },
  // Media & Content
  { cat: 'Media & Content', kw: ['video hosting', 'podcast', 'streaming media', 'cms', 'content management', 'image hosting', 'youtube alternative', 'video platform', '動画配信'] },
  // Commerce
  { cat: 'Commerce', kw: ['ecommerce', 'e-commerce', 'shopping cart', 'online store', 'marketplace', 'shopify', 'pos', 'レジ', 'ec サイト', 'ecサイト', '在庫管理', 'payment process', 'stripe', 'checkout'] },
  // Location & Travel
  { cat: 'Location & Travel', kw: ['maps api', 'geocoding', 'navigation', 'travel booking', 'hotel booking', 'flight booking', 'ride hailing', 'delivery logistics', '物流'] },
  // IoT & Hardware
  { cat: 'IoT & Hardware', kw: ['iot', 'sensor', 'smart home', 'embedded device', 'hardware sdk', 'raspberry pi', 'mqtt'] },
  // Security
  { cat: 'Security', kw: ['password manager', 'sso', 'single sign-on', 'identity provider', 'vulnerability scan', 'secrets management', 'security audit', 'auth0', '2fa', 'mfa', 'cybersecurity', 'encryption tool'] },
];

function suggestCategory(name, desc) {
  const hay = `${name} ${desc}`.toLowerCase();
  const scores = {};
  for (const { cat, kw } of KEYWORD_MAP) {
    let s = 0;
    for (const k of kw) if (hay.includes(k.toLowerCase())) s += 1;
    if (s > 0) scores[cat] = (scores[cat] || 0) + s;
  }
  const entries = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  if (!entries.length) return { suggested: null, confidence: 0 };
  return { suggested: entries[0][0], confidence: entries[0][1], allScores: entries };
}

function normalizeCategory(cat) {
  if (!cat) return '';
  return String(cat).trim();
}

function categoryEquivalent(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return true;
  // common DB category names that map to canonical labels
  const aliases = {
    'ai_ml': 'ai & llm', 'ai': 'ai & llm',
    'developer_tools': 'developer tools', 'devops': 'developer tools', 'database': 'developer tools',
    'productivity': 'productivity', 'groupware': 'productivity',
    'communication': 'communication',
    'bi_analytics': 'data & analytics', 'data_integration': 'data & analytics',
    'storage': 'file storage',
    'design': 'design',
    'accounting': 'finance & accounting', 'payment': 'finance & accounting',
    'crm': 'crm & sales',
    'marketing': 'marketing',
    'hr': 'hr & recruiting',
    'project_management': 'project management',
    'ecommerce': 'commerce',
    'logistics': 'location & travel', 'reservation': 'location & travel',
    'security': 'security',
    'legal': 'other', 'support': 'communication',
  };
  const canonA = aliases[na] || na;
  const canonB = aliases[nb] || nb;
  return canonA === canonB;
}

function runD() {
  const results = [];
  for (const svc of sampleD) {
    const cur = normalizeCategory(svc.category);
    const { suggested, confidence, allScores } = suggestCategory(svc.name || '', svc.description || '');
    let verdict = 'correct';
    if (!suggested) {
      verdict = 'no-signal'; // heuristic had no signal -> skip
    } else if (categoryEquivalent(cur, suggested)) {
      verdict = 'correct';
    } else if (confidence >= 2) {
      verdict = 'clearly-wrong';
    } else {
      verdict = 'questionable';
    }
    results.push({
      id: svc.id,
      name: svc.name,
      current_category: cur,
      suggested_category: suggested,
      confidence,
      verdict,
      description_excerpt: (svc.description || '').slice(0, 180),
      top_scores: allScores?.slice(0, 3) || [],
    });
  }
  fs.writeFileSync(OUT_D, JSON.stringify({ generated_at: nowIso(), count: results.length, results }, null, 2));
  console.log(`[D] wrote ${OUT_D}`);
  return results;
}

// --- Main ------------------------------------------------------------
(async () => {
  const dStart = Date.now();
  const D = runD();
  const dMs = Date.now() - dStart;
  console.log(`[D] done in ${dMs}ms`);

  const aStart = Date.now();
  const A = await runA();
  const aMs = Date.now() - aStart;
  console.log(`[A] done in ${Math.round(aMs/1000)}s`);

  db.close();

  // Quick summary printed to stdout for the agent
  const counts = {};
  for (const r of A) counts[r.classification] = (counts[r.classification] || 0) + 1;
  console.log('\n=== A classification counts ===');
  console.log(JSON.stringify(counts, null, 2));

  const dCounts = {};
  for (const r of D) dCounts[r.verdict] = (dCounts[r.verdict] || 0) + 1;
  console.log('\n=== D verdict counts ===');
  console.log(JSON.stringify(dCounts, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
