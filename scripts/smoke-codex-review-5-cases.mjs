/**
 * Codex review 5 (on 45afcc1, 2026-10-02) — the reviewer's 39 independent
 * cases, kept verbatim and re-run against this tree.
 *
 * Fixture: scripts/fixtures/codex-review-5/independent-cases-45afcc1.json is the
 * reviewer's output file byte for byte (29 conforming, 10 not: F1/F2 invalid
 * calendar date read as a fresh handshake, F4 vendor / propose returning to an
 * observed endpoint or leaving a NULL observation, F8 the newly reachable DNS
 * branch downgrading trust). The reviewer's runner is kept beside it as
 * independent-review-45afcc1.mjs.txt; this file is that runner ported — same
 * cases, same inputs, same expectations — with only the paths changed (the
 * transpiled 775a797 sources go to a temp dir with a node_modules junction).
 *
 * What passes:
 *   - the 39 ids come out in the reviewer's order with the reviewer's inputs;
 *   - every case conforms now;
 *   - every expected value equals the fixture's, except the three whose
 *     expected value IS the run's own "before" snapshot (seed-liveness-unchanged,
 *     seed-conflict-liveness-unchanged, migration-second-start-logically-identical:
 *     they carry timestamps of the run, or the vendor / propose rows' liveness,
 *     which this fix changes on purpose).
 * Added after the 39 (prefix CL-, not the reviewer's): trust / archived / the
 * outcome row are the same under 775a797's probe and this one for ENOTFOUND,
 * ECONNREFUSED, 404 and 410, and the new probe records the DNS / refused
 * endpoint as unreachable → displayed unverified.
 *
 * Usage: npm run build && node scripts/smoke-codex-review-5-cases.mjs
 */
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { initializeDb } from '../dist/db/schema.js';
import { seedDatabase } from '../dist/db/seed.js';
import { displayMcpStatus, parseUtc } from '../dist/utils/mcp-status.js';
import { vendorClaimWriter } from '../dist/crawler/sources/vendor-submissions-step.js';
import { proposeUpdate, reviewUpdate } from '../dist/tools/propose-update.js';
import { runHealthProbe } from '../dist/crawler/health-probe.js';
import { register as registerLookup } from '../dist/tools/lookup.js';
import { register as registerSearch } from '../dist/tools/search-services.js';
import { registerResources } from '../dist/resources.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/codex-review-5/independent-cases-45afcc1.json', import.meta.url), 'utf8'));
const RUNTIME_EXPECTED = new Set(['seed-liveness-unchanged', 'seed-conflict-liveness-unchanged', 'migration-second-start-logically-identical']);
const TMP = mkdtempSync(join(tmpdir(), 'kansei-codex5-'));
symlinkSync(resolve('node_modules'), join(TMP, 'node_modules'), 'junction');
const quiet = async (fn) => { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };

const cases = [];
const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function record(id,input,expected,actual) { cases.push({id,input,expected,actual,conforms:eq(expected,actual)}); }
function transpileAt(ref, name) {
  const src = execFileSync('git', ['show', ref], { encoding: 'utf8' });
  const file = join(TMP, name);
  writeFileSync(file, ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  return import(pathToFileURL(file).href);
}

try {
// ── the reviewer's 39 cases (logic as in independent-review-45afcc1.mjs.txt) ──
const now = new Date('2026-10-02T12:00:00Z');
const ep = 'https://fake-independent.invalid/mcp';
const base = {mcp_status:'verified',mcp_endpoint:ep,archived:0,mcp_liveness:'handshake',mcp_liveness_checked_at:'2026-10-01T00:00:00Z',mcp_liveness_endpoint:ep};
for (const [id,patch,want] of [
 ['fresh',{},'verified'],['missing',{mcp_liveness:null},'unverified'],['old',{mcp_liveness_checked_at:'2026-09-02T11:59:59Z'},'unverified'],
 ['edge',{mcp_liveness_checked_at:'2026-09-02T12:00:00Z'},'verified'],['future',{mcp_liveness_checked_at:'2026-10-02T12:00:01Z'},'unverified'],
 ['invalid-text',{mcp_liveness_checked_at:'yesterday'},'unverified'],['invalid-calendar',{mcp_liveness_checked_at:'2026-09-31T00:00:00Z'},'unverified'],
 ['dead',{mcp_status:'dead'},'unverified'],['stored-unreachable',{mcp_status:'unreachable'},'unverified'],['archived',{archived:1},'unverified'],
 ['unreachable',{mcp_liveness:'unreachable'},'unverified'],['other-endpoint',{mcp_liveness_endpoint:ep+'/'},'unverified'],
 ['official-no-probe',{mcp_status:'official',mcp_liveness:null},'official'],['official-old',{mcp_status:'official',mcp_liveness_checked_at:'2020-01-01T00:00:00Z'},'official'],
 ['official-reachable',{mcp_status:'official',mcp_liveness:'reachable'},'official'],['official-other',{mcp_status:'official',mcp_liveness_endpoint:ep+'/'},'official'],
]) {const input={...base,...patch}; record('display-'+id,{row:input,now:now.toISOString()},want,displayMcpStatus(input,now).mcp_status);}
record('invalid-calendar-parser',{timestamp:'2026-09-31T00:00:00Z'},null,Number.isNaN(parseUtc('2026-09-31T00:00:00Z'))?null:new Date(parseUtc('2026-09-31T00:00:00Z')).toISOString());

const db = new Database(':memory:'); await quiet(() => initializeDb(db));
const insert = db.prepare('INSERT INTO services (id,name,description,category,mcp_endpoint,mcp_status,mcp_liveness,mcp_liveness_checked_at,mcp_liveness_endpoint,trust_score) VALUES (?,?,?,?,?,?,?,?,?,?)');
const row = id=>db.prepare('SELECT * FROM services WHERE id=?').get(id);
const live = id=>{const r=row(id);return [r.mcp_liveness,r.mcp_liveness_checked_at,r.mcp_liveness_endpoint];};
function add(id,endpoint=ep,observed=endpoint) {insert.run(id,id,'fakeauditunique','fake-audit',endpoint,'verified','handshake','2026-10-01T00:00:00Z',observed,0.8);}
for(const writer of ['vendor','propose']) for(const scenario of ['new','same','return-to-observed','missing-observed']) {
 const id=`fake-${writer}-${scenario}`; const old=ep+'/current';const observed=scenario==='missing-observed'?null:scenario==='return-to-observed'?ep:old;
 add(id,old,observed);const before=live(id);const target=scenario==='same'?old:ep;
 if(writer==='vendor') vendorClaimWriter(db).run('verified',target,id);
 else {const p=proposeUpdate(db,{service_id:id,changes:{mcp_endpoint:target},reason:'Independent fake test',change_type:'update'});await quiet(()=>reviewUpdate(db,{proposal_id:p.proposal_id,action:'approve',reviewer:'fake-reviewer'}));}
 record(`${writer}-${scenario}`,{beforeEndpoint:old,observedEndpoint:observed,afterEndpoint:target},scenario==='same'?before:[null,null,null],live(id));
}

const invalidId='fakeauditunique-invalid-calendar';add(invalidId);
db.prepare('UPDATE services SET mcp_liveness_checked_at=? WHERE id=?').run('2026-09-31T00:00:00Z',invalidId);
const server=new McpServer({name:'independent-review',version:'0'});registerLookup(server,db);registerSearch(server,db);registerResources(server,db);
const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);const client=new Client({name:'fake-review-client',version:'0'});await client.connect(ct);
const parse=res=>{const t=res.content[0].text;return JSON.parse(t.slice(t.indexOf('{')));};
function find(o,k){if(!o||typeof o!=='object')return undefined;if(k in o)return o[k];for(const v of Object.values(o)){const f=find(v,k);if(f!==undefined)return f;}}
const lookup=parse(await client.callTool({name:'lookup',arguments:{service_id:invalidId}}));
record('public-lookup-invalid-calendar',{id:invalidId,checked_at:'2026-09-31T00:00:00Z'},'unverified',find(lookup,'connection').mcp_status);
const compact=parse(await client.callTool({name:'search_services',arguments:{intent:invalidId,compact:true,limit:20}}));
record('public-compact-invalid-calendar',{id:invalidId},'unverified',find(compact,'r').find(r=>r.id===invalidId)?.mcp);
const resource=JSON.parse((await client.readResource({uri:`kansei://service/${invalidId}`})).contents[0].text);
record('public-resource-invalid-calendar',{id:invalidId},'unverified',resource.mcp_status);
await client.close();await server.close();

const seedBefore=db.prepare('SELECT id,mcp_liveness,mcp_liveness_checked_at,mcp_liveness_endpoint FROM services ORDER BY id').all();
await quiet(() => seedDatabase(db));
const seedAfter=seedBefore.map(r=>{const s=row(r.id);return {id:s.id,mcp_liveness:s.mcp_liveness,mcp_liveness_checked_at:s.mcp_liveness_checked_at,mcp_liveness_endpoint:s.mcp_liveness_endpoint};});
record('seed-liveness-unchanged',{fakeRows:seedBefore.length},seedBefore,seedAfter);
// Exercise the seed's ON CONFLICT branch too, choosing a row by shape only.
const selected=db.prepare("SELECT id,mcp_endpoint FROM services WHERE mcp_status='verified' AND mcp_endpoint LIKE 'http%' AND COALESCE(archived,0)=0 AND mcp_liveness IS NULL ORDER BY id LIMIT 1").get();
db.prepare("UPDATE services SET mcp_liveness='unreachable',mcp_liveness_checked_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),mcp_liveness_endpoint=mcp_endpoint WHERE id=?").run(selected.id);
const conflictBefore=live(selected.id);await quiet(() => seedDatabase(db));
record('seed-conflict-liveness-unchanged',{selection:'first live verified HTTP seed row with no observation; chosen by shape, no fixed service ID'},conflictBefore,live(selected.id));
db.close();

const {initializeDb:initializeBase}=await transpileAt('775a797:src/db/schema.ts','base-schema.mjs');
const mig=new Database(':memory:');await quiet(() => initializeBase(mig));
for(const type of ['deprecated','deprecation','archived','probe_failed']) {
 const id='fake-death-'+type; mig.prepare('INSERT INTO services(id,name,upstream_checked_at,upstream_check_source,last_refreshed_at) VALUES (?,?,?, ?,?)').run(id,id,'2026-09-20','changelog_backfill','2026-09-20');
 mig.prepare('INSERT INTO service_changelog(service_id,change_date,change_type,summary) VALUES (?,?,?,?)').run(id,'2026-09-20',type,'fake death');
}
for(const source of ['github','npm'])mig.prepare('INSERT INTO services(id,name,upstream_checked_at,upstream_check_source,last_refreshed_at) VALUES (?,?,?,?,?)').run('fake-'+source,'fake-'+source,'2026-09-20',source,'2026-09-20');
mig.prepare('INSERT INTO services(id,name,upstream_checked_at,upstream_check_source,last_refreshed_at) VALUES (?,?,?,?,?)').run('fake-mixed','fake-mixed','2026-09-20','changelog_backfill','2026-09-20');
for(const [type,date] of [['feature','2026-09-01'],['deprecated','2026-09-20']])mig.prepare('INSERT INTO service_changelog(service_id,change_date,change_type,summary) VALUES (?,?,?,?)').run('fake-mixed',date,type,'fake mixed');
await quiet(() => initializeDb(mig));
for(const type of ['deprecated','deprecation','archived','probe_failed'])record('migration-'+type,{base:'775a797',change_type:type},null,mig.prepare('SELECT upstream_checked_at FROM services WHERE id=?').get('fake-death-'+type).upstream_checked_at);
for(const source of ['github','npm'])record('migration-preserve-'+source,{source},'2026-09-20',mig.prepare('SELECT upstream_checked_at FROM services WHERE id=?').get('fake-'+source).upstream_checked_at);
record('migration-mixed',{},'2026-09-01',mig.prepare("SELECT upstream_checked_at FROM services WHERE id='fake-mixed'").get().upstream_checked_at);
const migrationSnapshot=()=>({services:mig.prepare('SELECT * FROM services ORDER BY id').all(),markers:mig.prepare('SELECT * FROM schema_migrations ORDER BY migration_id').all(),audit:mig.prepare('SELECT * FROM migration_audit ORDER BY id').all()});
const beforeDump=migrationSnapshot();await quiet(() => initializeDb(mig));record('migration-second-start-logically-identical',{base:'775a797',tables:['services','schema_migrations','migration_audit']},beforeDump,migrationSnapshot());mig.close();

const {runHealthProbe:oldProbe}=await transpileAt('775a797:src/crawler/health-probe.ts','base-probe.mjs');
const realFetch=globalThis.fetch;
const netError=(code,msg)=>async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error(msg),{code})});};
globalThis.fetch=netError('ENOTFOUND','getaddrinfo ENOTFOUND fake-independent.invalid');
try {const scores={};for(const [version,probe] of [['775a797',oldProbe],['45afcc1',runHealthProbe]]){const d=new Database(':memory:');await quiet(()=>initializeDb(d));d.prepare('INSERT INTO services(id,name,mcp_status,mcp_endpoint,trust_score) VALUES (?,?,?,?,?)').run('fake-dns','fake-dns','verified',ep,0.8);await quiet(()=>probe(d,{limit:1}));scores[version]=d.prepare("SELECT trust_score FROM services WHERE id='fake-dns'").get().trust_score;d.close();}record('F8-dns-trust-parity',{initialTrust:0.8,error:'TypeError(fetch failed), cause.code=ENOTFOUND',baseline:scores['775a797']},scores['775a797'],scores['45afcc1']);} finally {globalThis.fetch=realFetch;}

// ── CL- (added, not the reviewer's): 775a797 vs this tree, same input → same trust / archived / outcome ──
const shapes = {
  ENOTFOUND: netError('ENOTFOUND','getaddrinfo ENOTFOUND fake-independent.invalid'),
  ECONNREFUSED: netError('ECONNREFUSED','connect ECONNREFUSED 127.0.0.1:9'),
  'HTTP 404': async()=>new Response(null,{status:404}),
  'HTTP 410': async()=>new Response(null,{status:410}),
};
for (const [label, fake] of Object.entries(shapes)) {
  globalThis.fetch = fake;
  try {
    const seen = {};
    for (const [version, probe] of [['775a797', oldProbe], ['this', runHealthProbe]]) {
      const d = new Database(':memory:'); await quiet(() => initializeDb(d));
      d.prepare('INSERT INTO services(id,name,mcp_status,mcp_endpoint,trust_score) VALUES (?,?,?,?,?)').run('fake-parity','fake-parity','verified',ep,0.8);
      await quiet(() => probe(d, { limit: 1 }));
      const s = d.prepare("SELECT * FROM services WHERE id='fake-parity'").get();
      const o = d.prepare("SELECT success, error_type, context_masked, provenance, task_type FROM outcomes WHERE service_id='fake-parity'").all();
      seen[version] = { row: s, kept: { trust_score: s.trust_score, archived: s.archived, outcomes: o } };
      d.close();
    }
    record(`CL-parity-${label}`, { initialTrust: 0.8, fetch: label }, seen['775a797'].kept, seen['this'].kept);
    if (label === 'ENOTFOUND' || label === 'ECONNREFUSED') {
      const r = seen['this'].row;
      record(`CL-liveness-${label}`, { initialTrust: 0.8, fetch: label }, { trust_score: 0.8, mcp_liveness: 'unreachable', mcp_liveness_endpoint: ep, shown: 'unverified', mcp_status: 'verified' },
        { trust_score: r.trust_score, mcp_liveness: r.mcp_liveness, mcp_liveness_endpoint: r.mcp_liveness_endpoint, shown: displayMcpStatus(r).mcp_status, mcp_status: r.mcp_status });
    }
  } finally { globalThis.fetch = realFetch; }
}
} finally {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows may hold a handle briefly */ }
}

// ── compare with the reviewer's fixture ──
let failures = 0;
const expect = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  (${detail})`}`); if (!ok) failures++; };
const theirs = FIXTURE.cases;
const mine = cases.slice(0, theirs.length);
expect(`fixture: ${theirs.length} cases (${FIXTURE.summary.conforming} conforming, ${FIXTURE.summary.nonconforming} not, on ${FIXTURE.commit.slice(0, 7)})`, theirs.length === 39 && FIXTURE.summary.nonconforming === 10);
expect('same ids in the same order', eq(mine.map((c) => c.id), theirs.map((c) => c.id)), JSON.stringify(mine.map((c) => c.id)));
for (const [i, t] of theirs.entries()) {
  const m = mine[i];
  if (!m) continue;
  const was = t.conforms ? 'conformed' : 'did NOT conform';
  const sameInput = eq(m.input, t.input);
  const sameExpected = RUNTIME_EXPECTED.has(t.id) || eq(m.expected, t.expected);
  expect(`${t.id} (${was} on 45afcc1)${RUNTIME_EXPECTED.has(t.id) ? ' [expected = this run\'s own before-snapshot]' : ''}`, m.conforms && sameInput && sameExpected,
    JSON.stringify({ conforms: m.conforms, sameInput, sameExpected, expected: m.expected, actual: m.actual }).slice(0, 400));
}
const fixed = theirs.filter((t) => !t.conforms).map((t) => t.id);
expect(`the ${fixed.length} that did not conform on 45afcc1 now do`, fixed.every((id) => cases.find((c) => c.id === id)?.conforms));
for (const c of cases.slice(theirs.length)) expect(`${c.id}`, c.conforms, JSON.stringify({ expected: c.expected, actual: c.actual }).slice(0, 400));

console.log(failures === 0 ? `\ncodex-review-5 cases: ALL PASS (${theirs.length} reviewer cases + ${cases.length - theirs.length} added)` : `\ncodex-review-5 cases: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
