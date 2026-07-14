#!/usr/bin/env node
/**
 * Triage of docs-404 findings from the Discoverability scan (2026-07-14).
 * Splits into: (A) GitHub-hosted → repo alive/renamed/gone via GitHub API,
 *              (B) own-domain  → probe candidate docs URLs to find where docs moved.
 * Output: data/discoverability/triage-YYYY-MM-DD.json + console table.
 * Does NOT change services table — proposals go to pending_updates separately.
 */
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const UA = 'KanseiLink-ARI-Scanner/1.1 (+https://kansei-link.com; docs-url triage)';
const TODAY = new Date().toISOString().slice(0, 10);

const scan = JSON.parse((await import('node:fs')).readFileSync(join(ROOT, 'data', 'discoverability', `scan-${TODAY}.json`), 'utf-8'));
const bad = scan.results.filter((r) => ['404', '410', 'timeout', '0'].includes(String(r.developer.docs_status)));

async function head(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctrl.signal });
    return { status: res.status, finalUrl: res.url };
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message) };
  } finally { clearTimeout(t); }
}

// candidate docs URLs for own-domain services (curated patterns)
const CANDIDATES = {
  moneyforward: ['https://developer.moneyforward.com/', 'https://biz.moneyforward.com/api/', 'https://accounting.moneyforward.com/docs/index.html', 'https://api.biz.moneyforward.com/docs'],
  elevenlabs: ['https://elevenlabs.io/docs/api-reference/introduction', 'https://elevenlabs.io/docs'],
  langfuse: ['https://langfuse.com/docs/api', 'https://api.reference.langfuse.com/', 'https://langfuse.com/docs'],
  looker: ['https://cloud.google.com/looker/docs/api-intro', 'https://developers.looker.com/api/overview', 'https://cloud.google.com/looker/docs'],
  firecrawl: ['https://docs.firecrawl.dev/api-reference/introduction', 'https://docs.firecrawl.dev/'],
  hrmos: ['https://ieyasu.co/docs/api.html', 'https://www.ieyasu.co/docs/api/', 'https://hrmos.co/kintai/function/api/', 'https://ieyasu.co/help/api/'],
  'freee-sign': ['https://developer.freee.co.jp/reference/sign/reference', 'https://developer.freee.co.jp/docs/sign', 'https://www.freee.co.jp/sign/', 'https://developer.freee.co.jp/'],
  paidy: ['https://paidy.com/docs/en/', 'https://paidy.com/docs/jp/', 'https://docs.paidy.com/', 'https://paidy.com/developers/'],
};

const out = { triaged_at: TODAY, github: [], own_domain: [] };

for (const r of bad) {
  if (r.platform_hosted && r.developer.docs_url.includes('github.com')) {
    const m = r.developer.docs_url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
    if (!m) { out.github.push({ service_id: r.service_id, verdict: 'bad-url', url: r.developer.docs_url }); continue; }
    const api = await head(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, '')}`);
    let verdict, note = '';
    if (api.status === 200) {
      // repo exists (page 404 was transient or rename-redirect handled) — check rename
      const finalMatch = api.finalUrl.match(/repos\/([^/]+\/[^/?#]+)/);
      const finalRepo = finalMatch ? finalMatch[1] : `${m[1]}/${m[2]}`;
      verdict = finalRepo.toLowerCase() !== `${m[1]}/${m[2]}`.toLowerCase() ? 'renamed' : 'alive';
      note = finalRepo;
    } else if (api.status === 404) { verdict = 'gone-or-private'; }
    else if (api.status === 403) { verdict = 'rate-limited(recheck)'; }
    else { verdict = `api:${api.status || api.error}`; }
    out.github.push({ service_id: r.service_id, service: r.service, repo: `${m[1]}/${m[2]}`, verdict, note });
  } else {
    const tried = [];
    let found = null;
    for (const cand of (CANDIDATES[r.service_id] || [])) {
      const res = await head(cand);
      tried.push({ url: cand, status: res.status || res.error, finalUrl: res.finalUrl });
      if (!found && res.status === 200) found = res.finalUrl || cand;
    }
    // also re-check the original (transient 404?)
    const orig = await head(r.developer.docs_url);
    out.own_domain.push({
      service_id: r.service_id, service: r.service,
      db_api_url: r.developer.docs_url, original_recheck: orig.status || orig.error,
      working_candidate: found, tried,
      verdict: found ? 'stale-db-url(fix-available)' : (orig.status === 200 ? 'transient(now-ok)' : 'needs-manual-research'),
    });
  }
}

const outPath = join(ROOT, 'data', 'discoverability', `triage-${TODAY}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 1));

console.log('=== GitHub-hosted ===');
for (const g of out.github) console.log(`${g.verdict.padEnd(22)} ${g.service_id}  ${g.repo || ''} ${g.note || ''}`);
console.log('\n=== Own-domain ===');
for (const o of out.own_domain) console.log(`${o.verdict.padEnd(28)} ${o.service_id.padEnd(14)} -> ${o.working_candidate || '(none)'}`);
console.log(`\nwrote ${outPath}`);
