/**
 * Every way mcp_status leaves the server goes through displayMcpStatus()
 * (Codex review 5 of dc319cf, B / F1 / F2).
 *
 * 1. Inventory (static): every file under src/ that names mcp_status is listed in
 *    INVENTORY with what it does with it. A new file that names mcp_status fails this
 *    smoke until it is classified here.
 * 2. Outbound (dynamic): the real server (createServer, admin tools ON, so inspect /
 *    analyze are reachable too) on a temp DB. Two fake rows whose display can never be
 *    their stored value:
 *      - SENTINEL: stored mcp_status 'zzrawclaimzz' (no display ever yields it), the
 *        same endpoint observed unreachable just now → displayed 'unverified';
 *      - VERIFIED: stored 'verified', the same observation → displayed 'unverified'.
 *    Every tool and every mode is called on them (search, lookup ×9, report ×4,
 *    inspect ×8, analyze ×5), and every resource is read. Passing = the sentinel
 *    string appears in no response, and no object about VERIFIED carries an mcp-ish
 *    key with the value 'verified'. A positive control (a fresh handshake row) must
 *    come out 'verified', so the detector is alive.
 *    The public HTTP pages are covered by smoke-mcp-status-provenance (133 cases).
 *
 * Usage: npm run build && node scripts/smoke-mcp-status-outbound.mjs
 */
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

let failures = 0;
const ok = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; };

// ── 1. inventory ──────────────────────────────────────────────────────────
// display  = the value leaves only through displayMcpStatus (with basis / liveness)
// internal = read or written, never returned to a client (reason given)
const INVENTORY = {
  'src/tools/get-service-detail.ts': 'display: lookup detail — displayMcpStatus + legend',
  'src/tools/get-service-tips.ts': 'display: lookup tips connection block — displayMcpStatus',
  'src/tools/search-services.ts': 'display: results carry the displayed value (ScoredResult.mcp_status set from displayMcpStatus); compact `mcp` is that value',
  'src/tools/audit-cost.ts': 'display: alternatives — alt_mcp_status from displayMcpStatus',
  'src/tools/propose-update.ts': 'display: diff.mcp_status.current from displayMcpStatus with basis and liveness (this commit); the allowed-field list is text',
  'src/resources.ts': 'display: kansei://service/{id} and kansei://mcp-status — displayMcpStatus',
  'src/http-server.ts': 'display: public pages via displayMcpStatus + statusProvenance; /stats mcp_count is an aggregate COUNT of provider claims or endpoints, no per-service status leaves',
  'src/tools/inspect.ts': 'text only: the list of fields a proposal may change',
  'src/tools/generate-aeo-article.ts': 'internal: the provider claim is one condition of agent_ready; the status value itself is not in the article',
  'src/tools/generate-aeo-report.ts': 'internal: the provider claim is one condition of a score; the status value itself is not in the report',
  'src/tools/analyze-token-savings.ts': 'internal: selected with the row, not returned',
  'src/utils/trust-recalc.ts': 'internal: an input to trust_score',
  'src/crawler/recompute-axr.ts': 'internal: an input to the AXR score',
  'src/crawler/watchdog.ts': 'internal (declared exception): the operator\'s watchdog report file; and the WHERE of the liveness update',
  'src/agent-army/run.ts': 'internal (declared exception): agent-army picks its targets by it; its reports are operator files',
  'src/crawler/health-probe.ts': 'comment: the probe never writes mcp_status',
  'src/crawler/deep-audit.ts': 'comment: deep-audit selects by liveness, not by mcp_status',
  'src/crawler/deep-audit-targets.ts': 'internal: read with the row for the freshness test, never returned (targets carry id / name / endpoint / trust only)',
  'src/crawler/pipeline/ingest.ts': 'writer: new crawled rows are community',
  'src/crawler/sources/vendor-submissions-step.ts': 'writer: a verified vendor\'s claim',
  'src/crawler/sources/publisher-match.ts': 'writer: who provides the server (provider claim)',
  'src/crawler/sync-registry.ts': 'writer: registry rows and the generated registry-diff.json (an operator file)',
};
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const named = walk('src').map((p) => relative('.', p).replace(/\\/g, '/'))
  .filter((p) => /\.ts$/.test(p) && !p.startsWith('src/db/') && !p.startsWith('src/data/') && p !== 'src/utils/mcp-status.ts')
  .filter((p) => /mcp_status/.test(readFileSync(p, 'utf8')));
const unlisted = named.filter((p) => !(p in INVENTORY));
const stale = Object.keys(INVENTORY).filter((p) => !named.includes(p));
ok(`inventory: every src file that names mcp_status is classified (${named.length} files)`, unlisted.length === 0, unlisted.join(', '));
ok('inventory: no stale entry', stale.length === 0, stale.join(', '));
for (const p of Object.keys(INVENTORY).filter((p) => INVENTORY[p].startsWith('display'))) {
  const s = readFileSync(p, 'utf8');
  ok(`inventory: ${p} uses displayMcpStatus`, /displayMcpStatus/.test(s) || (p === 'src/tools/search-services.ts' && /McpStatusBasis/.test(s)));
}

// ── 2. outbound ───────────────────────────────────────────────────────────
const DIR = mkdtempSync(join(tmpdir(), 'kansei-outbound-'));
process.env.KANSEI_DB_PATH = join(DIR, 'outbound.db');
const quiet = async (fn) => { const l = console.log, e = console.error, w = console.warn; console.log = console.error = console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; } };
const { createServer } = await import('../dist/server.js');
const { getDb, closeDb } = await import('../dist/db/connection.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

const SENTINEL = 'zzrawclaimzz';
const IDS = { sentinel: 'fake-outbound-sentinel', verified: 'fake-outbound-verified', control: 'fake-outbound-control' };
const server = await quiet(() => createServer({ exposeAdminTools: true }));
const db = getDb();
const nowIso = new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const put = (id, status, liveness) => db.prepare(`INSERT INTO services (id,name,description,category,tags,mcp_endpoint,mcp_status,trust_score,axr_score,mcp_liveness,mcp_liveness_checked_at,mcp_liveness_endpoint)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, id, `outbound audit row ${id}`, 'fake-outbound', 'outbound', `https://${id}.invalid/mcp`, status, 0.9, 90, liveness, nowIso, `https://${id}.invalid/mcp`);
put(IDS.sentinel, SENTINEL, 'unreachable');
put(IDS.verified, 'verified', 'unreachable');
put(IDS.control, 'verified', 'handshake');
db.prepare("INSERT INTO service_api_guides (service_id, base_url, auth_overview, key_endpoints, quickstart_example, agent_tips) VALUES (?,?,?,?,?,?)").run(IDS.verified, 'https://x.invalid', 'none', '[]', 'none', '[]');
for (const id of Object.values(IDS)) db.prepare("INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms) VALUES (?, 'fake-agent', 1, 100)").run(id);

const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: 'outbound-audit', version: '0' });
await client.connect(ct);

const texts = []; // [label, text]
const call = async (name, args) => {
  const r = await quiet(() => client.callTool({ name, arguments: args }));
  const text = (r.content || []).map((c) => c.text ?? '').join('\n');
  texts.push([`${name} ${JSON.stringify(args)}`, text]);
  return text;
};
const calls = [];
for (const id of Object.values(IDS)) {
  calls.push(['search_services', { intent: id, limit: 20 }], ['search_services', { intent: id, compact: true, limit: 20 }]);
  for (const f of ['verified', 'connectable', 'info_only']) calls.push(['search_services', { intent: 'outbound audit row', agent_ready: f, limit: 20 }]);
  calls.push(['lookup', { service_id: id }], ['lookup', { service_id: id, detail: true }], ['lookup', { service_id: id, insights: true }]);
  for (const mode of ['tips', 'detail', 'insights', 'history', 'feedback', 'voices']) calls.push(['lookup', { service_id: id, mode }]);
  calls.push(['lookup', { service_id: id, period: '30d' }], ['lookup', { service: id }], ['lookup', { goal: `outbound audit ${id}` }]);
  calls.push(['report', { mode: 'outcome', service_id: id, success: true, latency_ms: 10 }], ['report', { mode: 'feedback', service_id: id, feedback_type: 'bug_report', subject: 'fake outbound', body: 'fake outbound audit body' }],
    ['report', { mode: 'event', service_id: id, event_date: '2026-10-02', event_type: 'fix', title: 'fake outbound', description: 'fake' }],
    ['report', { mode: 'voice', service_id: id, question_id: 'q1', response_choice: 'a', response_text: 'fake' }]);
  calls.push(['inspect', { mode: 'queue', queue_service_id: id }], ['inspect', { mode: 'check_updates', check_service_id: id }],
    ['inspect', { mode: 'propose', propose_service_id: id, field: 'mcp_status', new_value: 'community', reason: 'Fake outbound audit proposal' }],
    ['inspect', { mode: 'propose', propose_service_id: id, changes: { mcp_status: 'third_party', description: 'fake outbound description' }, reason: 'Fake outbound audit proposal two' }],
    ['inspect', { mode: 'pending', pending_service_id: id, pending_status: 'all' }], ['inspect', { mode: 'snapshot', snapshot_service_id: id }],
    ['inspect', { mode: 'evaluate', evaluate_service_id: id, api_quality_score: 0.5, doc_completeness_score: 0.5, auth_stability_score: 0.5, error_clarity_score: 0.5 }]);
  calls.push(['analyze', { mode: 'token_savings', services: [id] }], ['analyze', { mode: 'cost', cost_service_id: id }], ['analyze', { mode: 'aeo_report', aeo_service_id: id }]);
}
calls.push(['analyze', { mode: 'aeo_report', category: 'fake-outbound' }], ['analyze', { mode: 'aeo_article', format: 'json', article_top_n: 500 }], ['analyze', { mode: 'aeo_article', format: 'markdown', article_top_n: 500 }]);
calls.push(['inspect', { mode: 'pending', pending_status: 'all' }], ['inspect', { mode: 'queue', queue_status: 'all' }], ['inspect', { mode: 'submit', inspection_id: 1, verdict: 'false_alarm', findings: 'fake' }]);
for (const [name, args] of calls) await call(name, args);
// review the proposals made above (rejected: nothing changes the rows under test)
const pend = await call('inspect', { mode: 'pending', pending_status: 'pending' });
const ids = [...pend.matchAll(/"(?:proposal_id|id)"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
for (const update_id of [...new Set(ids)].slice(0, 10)) await call('inspect', { mode: 'review', update_id, approved: false, reviewer: 'fake-reviewer', review_note: 'fake' });
// resources
const resources = (await client.listResources()).resources.map((r) => r.uri);
for (const uri of [...resources, ...Object.values(IDS).map((id) => `kansei://service/${id}`)]) {
  const r = await quiet(() => client.readResource({ uri }));
  texts.push([`resource ${uri}`, r.contents.map((c) => c.text ?? '').join('\n')]);
}
const toolsCalled = new Set(texts.filter(([l]) => !l.startsWith('resource ')).map(([l]) => l.split(' ')[0]));
ok(`every tool was called (${[...toolsCalled].join(', ')})`, ['search_services', 'lookup', 'report', 'inspect', 'analyze'].every((t) => toolsCalled.has(t)) && (await client.listTools()).tools.every((t) => toolsCalled.has(t.name)));
ok(`${texts.length} responses collected`, texts.length > 100, String(texts.length));

// the sentinel never leaves
const aboutSentinel = texts.filter(([, t]) => t.includes(IDS.sentinel)).length;
ok('the sentinel row is in the responses (' + aboutSentinel + ' of them name it): the test sees it', aboutSentinel >= 20, String(aboutSentinel));
const sentinelHits = texts.filter(([, t]) => t.includes(SENTINEL)).map(([l]) => l);
ok('the stored claim of the sentinel row appears in no response (only displayMcpStatus\'s output leaves)', sentinelHits.length === 0, sentinelHits.slice(0, 6).join(' | '));
// the stored 'verified' of an unreachable row never leaves as 'verified'
const parseAll = (t) => { const out = []; for (let i = t.indexOf('{'); i >= 0; i = t.indexOf('{', i + 1)) { try { out.push(JSON.parse(t.slice(i))); break; } catch {} } return out; };
const leaks = []; let controlSeen = 0;
// a 'verified' string under an mcp* key, directly or nested (e.g. diff.mcp_status.current)
const visit = (o, label, ctxId, underMcp = false) => {
  if (Array.isArray(o)) { o.forEach((x) => visit(x, label, ctxId, underMcp)); return; }
  if (!o || typeof o !== 'object') return;
  const id = o.id ?? o.service_id ?? o.alt_service_id ?? ctxId;
  for (const [k, v] of Object.entries(o)) {
    const mcpKey = (underMcp || /mcp/i.test(k)) && !/legend/i.test(k);
    if (mcpKey && v === 'verified') {
      if (id === IDS.control) controlSeen++;
      else if (id === IDS.verified || id === undefined) leaks.push(`${label} :: ${k} (id=${id})`);
    }
    visit(v, label, id, mcpKey);
  }
};
// an object without its own id belongs to the service the call was about (the label names it)
for (const [label, t] of texts) { const about = Object.values(IDS).find((id) => label.includes(id)); for (const j of parseAll(t)) visit(j, label, about); }
ok('the unreachable row stored as verified never comes out as verified (any mcp* key, any response)', leaks.length === 0, leaks.slice(0, 6).join(' | '));
ok('positive control: the fresh-handshake row does come out verified (the detector is alive)', controlSeen > 0, String(controlSeen));
const proposal = texts.find(([l]) => l.startsWith('inspect') && l.includes(IDS.verified) && l.includes('"field":"mcp_status"'));
const diff = proposal && parseAll(proposal[1])[0];
const cur = JSON.stringify(diff ?? {}).match(/"mcp_status":\{[^}]*"current":"(\w+)"/);
ok('inspect propose: diff.mcp_status.current is the displayed value, with its basis and liveness beside it', Boolean(cur) && cur[1] === 'unverified' && /"current_basis":"unreachable"/.test(JSON.stringify(diff)) && /"current_liveness":\{/.test(JSON.stringify(diff)), JSON.stringify(diff ?? {}).slice(0, 400));

await client.close(); await server.close(); closeDb();
try { rmSync(DIR, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? '\nmcp_status outbound smoke: ALL PASS' : `\nmcp_status outbound smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
