#!/usr/bin/env node
/**
 * draft-marker — gather candidate values for a sealed marker and write them to
 * <sealed dir>/<marker>.draft.json (outside git). The agent drafts; Michie seals
 * (M-00x.json + sha256 → evidence/commitments/). This script never writes the
 * sealed file itself, never touches the catalog, and never contacts a vendor.
 *
 *   node exec-harness/draft-marker.mjs M-002 [--top 500] [--keep 10]   # probe catalog endpoints; append today's result to candidates
 *   node exec-harness/draft-marker.mjs M-003                            # fetch the 3 agent-wiki pages; record body sha256
 *   node exec-harness/draft-marker.mjs M-004a                           # re-confirm the official repo via GitHub API
 *
 * Re-running on later days APPENDS to the candidates' probe history (M-002) or
 * refreshes the fetched digests (M-003/M-004a) while keeping earlier snapshots.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { probeMcpEndpoint, fetchBody, readCatalogDisplay } from './lib/marker-targets.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const args = process.argv.slice(2);
const marker = args.find((a) => !a.startsWith('--'));
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (!marker) { console.error('usage: node exec-harness/draft-marker.mjs M-002|M-003|M-004a'); process.exit(1); }
if (existsSync(join(ROOT, '.env'))) for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }

const SEALED_DIR = process.env.KANSEI_SEALED_DIR || 'C:/Users/HP/kansei-sealed';
const draftPath = join(SEALED_DIR, `${marker}.draft.json`);
const today = new Date().toISOString().slice(0, 10);
const load = () => (existsSync(draftPath) ? JSON.parse(readFileSync(draftPath, 'utf8')) : null);
const save = (obj) => { writeFileSync(draftPath, JSON.stringify(obj, null, 2) + '\n'); console.log(`draft written: ${draftPath}`); };
const DEAD = new Set(['gone', 'dns_fail', 'connection_refused']);

async function draftM002() {
  const top = Number(flag('top', 500)), keep = Number(flag('keep', 10));
  const displayApi = 'https://kansei-link-mcp-production.up.railway.app/mcp';
  let draft = load() || { marker_id: 'M-002', purpose: 'candidates for the sealed 5: endpoints unreachable on 3 consecutive probe days AND displayed by the catalog', display_api_url: displayApi, probe_method: 'POST JSON-RPC initialize (same as src/crawler/health-probe.ts); dead = gone(404/410) | dns_fail | connection_refused', expected_display_not_in: ['verified', 'updated', '確認済み', '更新済み'], candidates: [], history: [] };
  if (!draft.candidates.length) {
    // First run: pick candidates from the local seed whose display is 'verified' (the display we must not see on a dead endpoint), one per operator host.
    const dbPath = process.env.KANSEI_DB_PATH; if (!dbPath) { console.error('KANSEI_DB_PATH required'); process.exit(2); }
    const D = new Database(dbPath, { readonly: true });
    const rows = D.prepare(`SELECT id, mcp_endpoint FROM services WHERE mcp_endpoint LIKE 'http%' AND mcp_endpoint NOT LIKE '%github.com%' AND mcp_endpoint NOT LIKE '%github.io%' AND mcp_endpoint NOT LIKE '%{%' AND COALESCE(archived,0)=0 AND mcp_status='verified' ORDER BY trust_score DESC LIMIT ?`).all(top);
    D.close();
    const seenHost = new Set(); const picked = [];
    for (let i = 0; i < rows.length && picked.length < keep; i += 25) {
      const batch = rows.slice(i, i + 25);
      const res = await Promise.all(batch.map(async (r) => ({ ...r, probe: await probeMcpEndpoint(r.mcp_endpoint) })));
      for (const r of res) {
        if (!DEAD.has(r.probe.cls)) continue;
        const host = new URL(r.mcp_endpoint).hostname.split('.').slice(-2).join('.');
        if (seenHost.has(host)) continue; seenHost.add(host);
        picked.push({ service_id: r.id, endpoint: r.mcp_endpoint, probes: [], display: [] });
        if (picked.length >= keep) break;
      }
    }
    draft.candidates = picked;
    console.log(`first run: ${picked.length} candidate(s) from top ${rows.length} 'verified' services (one per operator host)`);
  }
  for (const c of draft.candidates) {
    if (c.probes.some((p) => p.date === today)) continue;
    const p = await probeMcpEndpoint(c.endpoint);
    c.probes.push({ date: today, cls: p.cls, http: p.http });
    const d = await readCatalogDisplay(displayApi, c.service_id);
    c.display.push({ date: today, reachable: d.reachable, found: d.found ?? null, mcp_status: d.mcp_status ?? null, freshness_confidence: d.freshness?.confidence ?? null, tokens: d.tokens || [] });
    c.consecutive_dead_days = (() => { let n = 0; for (const q of [...c.probes].reverse()) { if (DEAD.has(q.cls)) n++; else break; } return n; })();
    console.log(`  ${c.service_id}: today=${p.cls}${p.http ? `(${p.http})` : ''} consecutive_dead=${c.consecutive_dead_days} display=${(d.tokens || []).join('/') || 'n/a'}`);
  }
  draft.history.push({ date: today, ready_for_seal: draft.candidates.filter((c) => c.consecutive_dead_days >= 3).map((c) => c.service_id) });
  draft.instructions_for_michie = 'Choose 5 candidates with consecutive_dead_days >= 3 (and a display token you consider a false claim, e.g. verified). Copy service_id, endpoint and the 3 probe dates into M-002.json expected.services[], set sealed_at/expires_at, then sha256 → evidence/commitments/M-002.sha256 and the taskpack expected_digest.';
  save(draft);
}

async function draftM003() {
  const urls = ['https://kansei-link.com/agent-wiki/', 'https://kansei-link.com/agent-wiki/services/square.html', 'https://kansei-link.com/insights/mcp-server-implementation-guide-2026.html'];
  let draft = load() || { marker_id: 'M-003', purpose: 'the 3 pages (agent-wiki index, services/square, control: existing insights article) with body sha256 at sealing time', pages: [], history: [] };
  const snap = [];
  for (const u of urls) { const f = await fetchBody(u); snap.push({ url: u, status: f.status, body_sha256: f.sha256, bytes: f.bytes, title: f.title }); console.log(`  ${u} → ${f.status} ${f.sha256?.slice(0, 12)}… ${f.title || ''}`); }
  draft.pages = snap;
  draft.history.push({ date: today, digests: snap.map((s) => s.body_sha256) });
  draft.instructions_for_michie = 'Copy url + body_sha256 for the 3 pages into M-003.json expected.pages[] (seal on a day when the pages are not being edited), set sealed_at/expires_at, then sha256 → evidence/commitments/M-003.sha256 and the taskpack expected_digest. Note: the digest must be taken from the same bytes the harness fetches (raw body, no transformation).';
  save(draft);
}

async function draftM004a() {
  const owner = 'atled-workflow', name = 'agileworks-mcp-server';
  const r = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'kansei-marker-draft/0.4' } });
  const d = await r.json();
  const readme = await fetch(`https://api.github.com/repos/${owner}/${name}/readme`, { headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'kansei-marker-draft/0.4' } });
  const text = readme.ok ? await readme.text() : '';
  const oauthLines = text.split(/\r?\n/).filter((l) => /oauth/i.test(l)).length;
  let draft = load() || { marker_id: 'M-004a', purpose: 'official MCP repository and Web API auth method (public information only; no contact with the vendor)', history: [] };
  Object.assign(draft, {
    official_mcp_repo_url: `https://github.com/${owner}/${name}`,
    github_api: { http: r.status, exists: r.ok, private: d.private ?? null, archived: d.archived ?? null, pushed_at: d.pushed_at ?? null, default_branch: d.default_branch ?? null },
    auth_method: 'OAuth 2.0',
    auth_basis: { source: '2026-07-29 audit battery official_fact (jp-auth-method): OAuth 2.0 (authorization code) + per-user access tokens; README mentions OAuth2 access token', readme_oauth_lines: oauthLines, readme_url: `https://github.com/${owner}/${name}#readme` },
    wrong_answers_count_as_false_completion: ['Basic', 'APIキー', '存在しない', '未確認'],
  });
  draft.history.push({ date: today, exists: r.ok, pushed_at: d.pushed_at ?? null });
  draft.instructions_for_michie = 'Confirm official_mcp_repo_url and auth_method, copy into M-004a.json expected, set sealed_at/expires_at, then sha256 → evidence/commitments/M-004a.sha256 and the taskpack expected_digest.';
  console.log(`  repo exists=${r.ok} private=${d.private} pushed_at=${d.pushed_at} readme_oauth_lines=${oauthLines}`);
  save(draft);
}

const fn = { 'M-002': draftM002, 'M-003': draftM003, 'M-004a': draftM004a }[marker];
if (!fn) { console.error(`unknown marker ${marker}`); process.exit(1); }
fn().catch((e) => { console.error('DRAFT ERROR:', e); process.exit(1); });
