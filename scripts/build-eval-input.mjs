#!/usr/bin/env node
/**
 * Build Eval Input
 * ────────────────────────────────────────────────────────────
 * Emits one compact JSON object per service containing everything
 * an agent-rater needs to apply the 5-dimension rubric.
 *
 * Output: content/eval/eval-input.json
 *
 * Per-service shape:
 * {
 *   id, name, category, mcp_status, trust_score,
 *   description, description_chars,
 *   api_url, api_auth_method, mcp_endpoint,
 *   has_guide,
 *   guide: {                         // only if has_guide
 *     base_url, auth_method, auth_overview, setup_hint,
 *     endpoints_count, endpoints_sample,
 *     agent_tips_count, agent_tips_sample,
 *     has_quickstart, has_error_format,
 *     docs_url, rate_limit,
 *   },
 *   signals: {                       // quick heuristic flags for the rater
 *     description_is_generic,        // boolean guess
 *     api_url_is_company_top,        // boolean guess
 *     semantic_mismatch,             // boolean guess
 *   }
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVICES_PATH = path.join(ROOT, 'src', 'data', 'services-seed.json');
const GUIDES_PATH = path.join(ROOT, 'src', 'data', 'api-guides-seed.json');
const OUT_DIR = path.join(ROOT, 'content', 'eval');
const OUT_PATH = path.join(OUT_DIR, 'eval-input.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

const services = JSON.parse(fs.readFileSync(SERVICES_PATH, 'utf8'));
const guidesRaw = JSON.parse(fs.readFileSync(GUIDES_PATH, 'utf8'));

// Normalize guides to a map keyed by service_id
const guides = new Map();
if (Array.isArray(guidesRaw)) {
  for (const g of guidesRaw) {
    if (g?.service_id) guides.set(g.service_id, g);
  }
} else if (guidesRaw && typeof guidesRaw === 'object') {
  for (const [k, v] of Object.entries(guidesRaw)) {
    if (v && typeof v === 'object') guides.set(k, { service_id: k, ...v });
  }
}

// ─── Quick heuristic signal helpers ─────────────────────────

function isGenericDescription(desc) {
  if (!desc) return true;
  const s = String(desc).toLowerCase();
  // very short descriptions are not "generic" — they're "sparse"
  if (s.length < 40) return false;
  // marketing copy markers
  const genericMarkers = [
    /world['']?s (leading|best|most)/,
    /industry[- ]leading/,
    /enterprise[- ]grade (solution|platform)/,
    /empower(?:s|ing)? (your )?(business|team)/,
    /transform(?:s|ing)? how/,
    /revolutioniz/,
    /next[- ]generation/,
  ];
  return genericMarkers.some((rx) => rx.test(s));
}

function isCompanyTopUrl(apiUrl) {
  if (!apiUrl) return false;
  const u = String(apiUrl).toLowerCase();
  // Heuristics: no /docs, /developer, /api, /v1, /reference in path
  const devMarkers = ['/docs', '/developer', '/api', '/v1', '/v2', '/v3', '/reference', '/sdk', '.dev/', 'developer.'];
  const hasDevMarker = devMarkers.some((m) => u.includes(m));
  return !hasDevMarker;
}

function semanticMismatchGuess(category, mcpEndpoint) {
  if (!mcpEndpoint) return false;
  const ep = String(mcpEndpoint).toLowerCase();
  // Very obvious mismatches: endpoint name contains a category keyword
  // that differs from the service's category.
  const categoryHints = {
    ecommerce: ['shop', 'cart', 'product', 'order', 'commerce'],
    travel: ['travel', 'hotel', 'flight', 'booking'],
    accounting: ['account', 'ledger', 'invoice', 'journal'],
    crm: ['crm', 'contact', 'lead', 'sales'],
    hr: ['employee', 'payroll', 'hr'],
    communication: ['chat', 'message', 'msg'],
  };
  // Check if endpoint mentions a category that is NOT the service's category
  for (const [cat, hints] of Object.entries(categoryHints)) {
    if (cat === category) continue;
    if (hints.some((h) => ep.includes(h)) && category !== cat) {
      // only flag if service's own category is present in the dict
      if (categoryHints[category]) return true;
    }
  }
  return false;
}

// ─── Build output ──────────────────────────────────────────

const out = [];
for (const s of services) {
  const guide = guides.get(s.id);
  const entry = {
    id: s.id,
    name: s.name,
    category: s.category,
    mcp_status: s.mcp_status,
    trust_score: s.trust_score,
    description: s.description,
    description_chars: (s.description || '').length,
    api_url: s.api_url || null,
    api_auth_method: s.api_auth_method || null,
    mcp_endpoint: s.mcp_endpoint || null,
    has_guide: !!guide,
  };

  if (guide) {
    const endpoints = Array.isArray(guide.key_endpoints)
      ? guide.key_endpoints
      : typeof guide.key_endpoints === 'string'
        ? (() => {
            try {
              return JSON.parse(guide.key_endpoints);
            } catch {
              return [];
            }
          })()
        : [];
    const tips = Array.isArray(guide.agent_tips)
      ? guide.agent_tips
      : typeof guide.agent_tips === 'string'
        ? (() => {
            try {
              return JSON.parse(guide.agent_tips);
            } catch {
              return [];
            }
          })()
        : [];

    entry.guide = {
      base_url: guide.base_url || null,
      auth_method:
        guide.authentication?.method ||
        guide.auth?.method ||
        null,
      auth_overview:
        guide.authentication?.overview ||
        guide.auth_overview ||
        guide.auth?.overview ||
        null,
      setup_hint:
        guide.authentication?.setup_hint ||
        guide.auth_setup_hint ||
        guide.auth?.setup_hint ||
        null,
      endpoints_count: endpoints.length,
      endpoints_sample: endpoints.slice(0, 3).map((e) => ({
        method: e.method,
        path: e.path,
        description: e.description,
      })),
      agent_tips_count: tips.length,
      agent_tips_sample: tips.slice(0, 3),
      has_quickstart: !!(guide.quickstart_example && String(guide.quickstart_example).length > 20),
      has_error_format: !!(guide.request_format?.error_format || guide.error_format),
      docs_url: guide.docs_url || null,
      rate_limit:
        guide.request_format?.rate_limit ||
        guide.rate_limit ||
        null,
    };
  }

  entry.signals = {
    description_is_generic: isGenericDescription(s.description),
    api_url_is_company_top: isCompanyTopUrl(s.api_url),
    semantic_mismatch: semanticMismatchGuess(s.category, s.mcp_endpoint),
  };

  out.push(entry);
}

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

const withGuide = out.filter((x) => x.has_guide).length;
const withoutGuide = out.length - withGuide;
const flags = {
  generic_description: out.filter((x) => x.signals.description_is_generic).length,
  company_top_url: out.filter((x) => x.signals.api_url_is_company_top).length,
  semantic_mismatch: out.filter((x) => x.signals.semantic_mismatch).length,
};

console.log('─'.repeat(60));
console.log('Eval Input Built');
console.log('─'.repeat(60));
console.log(`  total services : ${out.length}`);
console.log(`  with guide     : ${withGuide}`);
console.log(`  without guide  : ${withoutGuide}`);
console.log('');
console.log(`  quick flags (rater should verify):`);
console.log(`    generic description   : ${flags.generic_description}`);
console.log(`    company top url       : ${flags.company_top_url}`);
console.log(`    semantic mismatch     : ${flags.semantic_mismatch}`);
console.log('');
console.log(`  → wrote ${path.relative(ROOT, OUT_PATH)}`);
