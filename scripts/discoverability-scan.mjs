#!/usr/bin/env node
/**
 * AI Discoverability scan — quarterly pipeline (ARI評価モデル仕様 v1 §②)
 *
 * Extends the 2026-07-13 31社 measurement (aeo/ari-aeo-scan-2026-07-13.json)
 * to the top services in the KanseiLink DB. Measures, per service:
 *
 *   product domain (guessed registrable domain of api_url) and docs domain:
 *     - llms.txt presence/size ................... source_label: public_signal
 *     - robots.txt AI-bot policy (9 bots) ........ source_label: public_signal
 *     - JSON-LD blocks on root page .............. source_label: public_signal
 *     - root/docs reachability for our honest UA . source_label: probe
 *
 * Honesty rules (independence policy §04): UA declares who we are and why.
 * No per-service success-rate claims are produced by this scan.
 *
 * Usage:
 *   node scripts/discoverability-scan.mjs [--limit N] [--min-score 70]
 *        [--fill-bbb 160] [--concurrency 8] [--services id1,id2] [--no-db]
 *
 * Output:
 *   data/discoverability/scan-YYYY-MM-DD.json          (full results)
 *   data/discoverability/scan-YYYY-MM-DD-summary.md    (headline stats)
 *   DB table discoverability_scans (upsert per service_id+scan date)
 */

import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const OUT_DIR = join(ROOT, 'data', 'discoverability');
const DB_PATH = join(ROOT, 'kansei-link.db');

const UA = 'KanseiLink-ARI-Scanner/1.1 (+https://kansei-link.com; AI Discoverability measurement)';
const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'Google-Extended', 'PerplexityBot', 'CCBot',
];
const TIMEOUT_MS = 15000;
const PER_DOMAIN_GAP_MS = 600;

// ---- CLI ----
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const LIMIT = Number(flag('limit', 0)) || 0;
const MIN_SCORE = Number(flag('min-score', 70));
const FILL_BBB = Number(flag('fill-bbb', 160));
const CONCURRENCY = Number(flag('concurrency', 8));
const ONLY_SERVICES = flag('services', '') ? flag('services', '').split(',') : null;
const WRITE_DB = !args.includes('--no-db');
const TODAY = new Date().toISOString().slice(0, 10);

// ---- target selection ----
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function selectTargets() {
  if (ONLY_SERVICES) {
    const q = db.prepare(`SELECT id, name, category, api_url, axr_grade, axr_score FROM services WHERE id IN (${ONLY_SERVICES.map(() => '?').join(',')})`);
    return q.all(...ONLY_SERVICES);
  }
  const top = db.prepare(`
    SELECT id, name, category, api_url, axr_grade, axr_score
    FROM services
    WHERE archived = 0 AND api_url LIKE 'http%' AND axr_score >= ?
    ORDER BY axr_score DESC, github_stars DESC
  `).all(MIN_SCORE);
  const fill = db.prepare(`
    SELECT id, name, category, api_url, axr_grade, axr_score
    FROM services
    WHERE archived = 0 AND api_url LIKE 'http%' AND axr_score < ? AND axr_grade = 'BBB'
    ORDER BY github_stars DESC, usage_count DESC
    LIMIT ?
  `).all(MIN_SCORE, FILL_BBB);
  let targets = [...top, ...fill];
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);
  return targets;
}

// Shared platform domains: their llms.txt/robots/JSON-LD belong to the PLATFORM,
// not to the service hosted on it (github.com/llms.txt is GitHub's, not the repo's).
// Attributing them to the service would be a false positive.
const PLATFORM_DOMAINS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'npmjs.com', 'pypi.org',
  'smithery.ai', 'glama.ai', 'huggingface.co', 'sourceforge.net',
]);

// ---- registrable-domain heuristic (product domain guess) ----
const TWO_PART_TLDS = new Set([
  'co.jp', 'ne.jp', 'or.jp', 'gr.jp', 'ac.jp', 'go.jp', 'lg.jp',
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au',
  'co.kr', 'co.in', 'com.br', 'com.cn', 'com.tw', 'com.sg', 'com.hk',
]);
function registrableDomain(host) {
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2) return host.toLowerCase();
  const last2 = parts.slice(-2).join('.');
  const n = TWO_PART_TLDS.has(last2) ? 3 : 2;
  return parts.slice(-n).join('.');
}

// ---- fetch helpers (polite: serialized per domain, gap between hits) ----
const domainQueues = new Map(); // domain -> Promise chain
function politeFetch(url, opts = {}) {
  const domain = new URL(url).host;
  const prev = domainQueues.get(domain) || Promise.resolve();
  const next = prev
    .then(() => new Promise((r) => setTimeout(r, PER_DOMAIN_GAP_MS)))
    .then(() => doFetch(url, opts))
    .catch(() => doFetch(url, opts)); // keep the chain alive after failures
  domainQueues.set(domain, next.catch(() => {}));
  return next;
}
async function doFetch(url, { method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
      signal: ctrl.signal,
    });
    const body = res.ok ? await res.text() : '';
    return { status: res.status, body, finalUrl: res.url, server: res.headers.get('server') || '' };
  } catch (e) {
    return { status: 0, body: '', finalUrl: url, error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message || 'fetch_error') };
  } finally {
    clearTimeout(t);
  }
}

// ---- robots.txt parsing (grouped by user-agent; fallback to *) ----
function parseRobots(text) {
  const groups = []; // {agents: [..], disallow: [..], allow: [..]}
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
    } else if ((key === 'disallow' || key === 'allow') && current) {
      current.rules.push({ type: key, path: val });
    }
  }
  return groups;
}
function botPolicy(groups, bot) {
  const botL = bot.toLowerCase();
  let group = groups.find((g) => g.agents.some((a) => a === botL || (a !== '*' && botL.includes(a))));
  let matched = 'specific';
  if (!group) { group = groups.find((g) => g.agents.includes('*')); matched = 'wildcard'; }
  if (!group) return 'allowed(no-rule)';
  const disallowAll = group.rules.some((r) => r.type === 'disallow' && r.path === '/');
  const allowAll = group.rules.some((r) => r.type === 'allow' && (r.path === '/' || r.path === ''));
  if (disallowAll && !allowAll) return matched === 'specific' ? 'blocked' : 'blocked(wildcard)';
  const disallowSome = group.rules.some((r) => r.type === 'disallow' && r.path && r.path !== '');
  if (disallowSome) return 'partial';
  return 'allowed';
}

// ---- JSON-LD detection ----
function scanJsonLd(html) {
  const types = new Set();
  let count = 0;
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    count++;
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const it of items) {
        const t = it && it['@type'];
        if (typeof t === 'string') types.add(t);
        else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
      }
    } catch { /* unparseable block still counts */ }
  }
  return { count, types: [...types].sort() };
}

// ---- per-domain checks (cached: many services share a docs domain) ----
const domainCache = new Map();
async function checkDomain(domain) {
  if (domainCache.has(domain)) return domainCache.get(domain);
  const base = `https://${domain}`;
  const result = { domain };

  const llms = await politeFetch(`${base}/llms.txt`);
  result.llms_txt = llms.status === 200 && llms.body.trim().length > 0 && !/^\s*</.test(llms.body)
    ? 'present' : `absent(${llms.status || llms.error})`;
  result.llms_txt_bytes = result.llms_txt === 'present' ? Buffer.byteLength(llms.body) : 0;

  const robots = await politeFetch(`${base}/robots.txt`);
  result.robots_status = robots.status || robots.error;
  result.ai_bots = {};
  if (robots.status === 200 && robots.body) {
    const groups = parseRobots(robots.body);
    for (const bot of AI_BOTS) result.ai_bots[bot] = botPolicy(groups, bot);
  } else {
    for (const bot of AI_BOTS) result.ai_bots[bot] = `unknown(robots:${robots.status || robots.error})`;
  }

  const root = await politeFetch(base + '/');
  result.root_status = root.status || root.error;
  result.json_ld = root.status === 200 ? scanJsonLd(root.body) : { count: 0, types: [] };

  domainCache.set(domain, result);
  return result;
}

// ---- main ----
async function scanService(svc) {
  const out = {
    service_id: svc.id, service: svc.name, category: svc.category,
    axr_grade: svc.axr_grade,
    source_labels: { llms_txt: 'public_signal', ai_bots: 'public_signal', json_ld: 'public_signal', reachability: 'probe' },
  };
  let docsUrl;
  try { docsUrl = new URL(svc.api_url); } catch { out.error = `bad api_url: ${svc.api_url}`; return out; }

  const docsDomain = docsUrl.host;
  const productDomain = registrableDomain(docsDomain);
  // api_url sometimes points at the API base itself, not human/agent docs (DB §F backlog).
  // robots "Disallow: /" on an API endpoint domain is NORMAL — never report it as AI-blocking.
  out.domain_kind = /^api\./i.test(docsDomain) || (/\/api\//i.test(docsUrl.pathname) && !/docs|developer|reference/i.test(docsDomain + docsUrl.pathname))
    ? 'api-endpoint' : 'docs';

  // Platform-hosted (GitHub repo etc.): only the reachability probe is attributable
  // to the service — llms.txt/robots/JSON-LD there are the platform's, not theirs.
  if (PLATFORM_DOMAINS.has(productDomain)) {
    out.platform_hosted = true;
    const docsPage0 = await politeFetch(svc.api_url);
    out.developer = {
      domain: docsDomain, docs_url: svc.api_url,
      docs_status: docsPage0.status || docsPage0.error,
      llms_txt: 'n/a(platform-domain)', ai_bots: {}, json_ld: null,
    };
    out.product = { platform_domain: productDomain, note: 'no own domain in DB' };
    return out;
  }

  out.developer = await checkDomain(docsDomain);
  const docsPage = await politeFetch(svc.api_url);
  out.developer = { ...out.developer, docs_url: svc.api_url, docs_status: docsPage.status || docsPage.error };

  if (productDomain !== docsDomain) {
    out.product = { ...(await checkDomain(productDomain)), domain_guessed: true };
  } else {
    out.product = { same_as_developer: true };
  }
  return out;
}

async function run() {
  const targets = selectTargets();
  console.log(`targets: ${targets.length} services (min-score=${MIN_SCORE}, fill-bbb=${FILL_BBB}${LIMIT ? `, limit=${LIMIT}` : ''})`);

  const results = [];
  let done = 0;
  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const svc = queue.shift();
      const r = await scanService(svc);
      results.push(r);
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${targets.length} scanned`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // ---- write JSON ----
  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    scanned_at: TODAY, ua: UA, spec: 'ARI評価モデル仕様_v1_2026-07-14.md §② AI Discoverability',
    selection: { min_score: MIN_SCORE, fill_bbb: FILL_BBB, limit: LIMIT || null, total: results.length },
    results: results.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.service.localeCompare(b.service)),
  };
  const jsonPath = join(OUT_DIR, `scan-${TODAY}.json`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 1));

  // ---- DB upsert ----
  if (WRITE_DB) {
    db.exec(`CREATE TABLE IF NOT EXISTS discoverability_scans (
      service_id TEXT NOT NULL REFERENCES services(id),
      scanned_at TEXT NOT NULL,
      llms_txt_product INTEGER, llms_txt_developer INTEGER,
      bots_blocked_developer INTEGER,   -- count of AI bots blocked on docs domain
      docs_status TEXT,                 -- probe: HTTP status of api_url for our UA
      json_ld_types_product TEXT,       -- JSON array
      raw TEXT NOT NULL,                -- full per-service JSON
      source_note TEXT DEFAULT 'public_signal+probe; UA disclosed',
      PRIMARY KEY (service_id, scanned_at)
    )`);
    const up = db.prepare(`INSERT OR REPLACE INTO discoverability_scans
      (service_id, scanned_at, llms_txt_product, llms_txt_developer, bots_blocked_developer, docs_status, json_ld_types_product, raw)
      VALUES (?,?,?,?,?,?,?,?)`);
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        if (r.error) continue;
        const prod = r.product.same_as_developer ? r.developer : r.product;
        const blocked = (r.domain_kind === 'api-endpoint' || r.platform_hosted) ? 0
          : Object.values(r.developer.ai_bots || {}).filter((v) => v === 'blocked').length;
        up.run(
          r.service_id, TODAY,
          r.platform_hosted ? null : (prod.llms_txt === 'present' ? 1 : 0),
          r.platform_hosted ? null : (r.developer.llms_txt === 'present' ? 1 : 0),
          blocked,
          String(r.developer.docs_status),
          JSON.stringify(prod.json_ld?.types || []),
          JSON.stringify(r),
        );
      }
    });
    tx(results);
    console.log('DB: discoverability_scans upserted');
  }

  // ---- summary MD ----
  const ok = results.filter((r) => !r.error);
  const own = ok.filter((r) => !r.platform_hosted); // percentages only over own-domain services
  const platformHosted = ok.filter((r) => r.platform_hosted);
  const llmsProduct = own.filter((r) => (r.product.same_as_developer ? r.developer : r.product).llms_txt === 'present');
  const llmsDev = own.filter((r) => r.developer.llms_txt === 'present');
  const docsBlocked = ok.filter((r) => [401, 403, 451].includes(Number(r.developer.docs_status)));
  const docsDead = ok.filter((r) => [404, 410].includes(Number(r.developer.docs_status)) || r.developer.docs_status === 'timeout' || Number(r.developer.docs_status) === 0);
  // Strict: only bot-SPECIFIC blocks on a docs-kind domain count. Wildcard Disallow:/ on
  // api-endpoint domains is normal ops, not an AI policy — reporting it as one would be unfair.
  const botBlockers = ok.filter((r) => r.domain_kind !== 'api-endpoint'
    && Object.values(r.developer.ai_bots || {}).some((v) => v === 'blocked'));
  const apiEndpointUrls = ok.filter((r) => r.domain_kind === 'api-endpoint');
  const jsonLdAny = own.filter((r) => (r.product.same_as_developer ? r.developer : r.product).json_ld?.count > 0);

  const li = (rs) => rs.map((r) => `- ${r.service} (${r.category}, ${r.axr_grade}) — docs: ${r.developer.docs_status}`).join('\n') || '- なし';
  const md = `# AI Discoverability scan — ${TODAY}

対象: ${results.length}サービス（AXR ${MIN_SCORE}+ 全件 + BBB上位${FILL_BBB}） / UA: \`${UA}\`
出所ラベル: llms.txt・robots・JSON-LD=公開シグナル / 到達性ステータス=プローブ実測（ARI評価モデル仕様v1 §②）

## ヘッドライン
| 指標 | 値 |
|---|---|
| 自社ドメインを持つサービス（母数） | ${own.length}/${ok.length}（残り${platformHosted.length}はGitHub等プラットフォーム掲載のみ＝llms.txt等は評価対象外） |
| llms.txt設置（製品ドメイン） | ${llmsProduct.length}/${own.length} (${own.length ? Math.round(llmsProduct.length / own.length * 100) : 0}%) |
| llms.txt設置（開発者ドメイン） | ${llmsDev.length}/${own.length} |
| 開発者docsが当スキャナーに401/403/451 | ${docsBlocked.length} |
| 開発者docsが404/timeout/接続不能 | ${docsDead.length} |
| robots.txtでAIボットを明示ブロックする開発者ドメイン | ${botBlockers.length} |
| 製品ページにJSON-LDあり | ${jsonLdAny.length}/${own.length} |
| スキャン失敗（bad api_url等） | ${results.length - ok.length} |
| api_urlがdocsでなくAPIエンドポイントを指す（DB整備バックログ＝突合表§F系） | ${apiEndpointUrls.length} |

## docsがAIスキャナーを門前払い（401/403/451）
${li(docsBlocked)}

## docsに到達できない（404/timeout）
${li(docsDead)}

## AIボットをrobots.txtで明示ブロック
${botBlockers.map((r) => {
    const blocked = Object.entries(r.developer.ai_bots).filter(([, v]) => v === 'blocked').map(([k]) => k);
    return `- ${r.service} (${r.category}) — ${blocked.join(', ')}`;
  }).join('\n') || '- なし'}

---
再実行: \`node scripts/discoverability-scan.mjs\`（四半期ごと）。全データ: \`data/discoverability/scan-${TODAY}.json\` / DB \`discoverability_scans\`
`;
  const mdPath = join(OUT_DIR, `scan-${TODAY}-summary.md`);
  writeFileSync(mdPath, md);
  console.log(`\nwrote:\n  ${jsonPath}\n  ${mdPath}`);
  console.log(`headline: llms.txt(product) ${llmsProduct.length}/${ok.length}, docs-blocked ${docsBlocked.length}, bot-blockers ${botBlockers.length}`);
}

run().then(() => db.close()).catch((e) => { console.error(e); db.close(); process.exit(1); });
