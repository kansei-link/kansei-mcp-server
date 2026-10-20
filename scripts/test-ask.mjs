import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';
import { ask, askStats, askCandidates, ensureAskSchema, resetDailyCapForTests, parseErrorKey, cleanText, ASK_POST_MAX } from '../dist/ask/engine.js';
import { createAskHandlers } from '../dist/ask/routes.js';
import { ensureNotesSchema, recordNote } from '../dist/notes/store.js';
import { register as registerLookup } from '../dist/tools/lookup.js';

const FREEE_403 = 'freee API returned 403 {"status_code":403,"errors":[{"type":"forbiddenError","messages":["このアプリケーションにはアクセス権限がないエンドポイントです"]}]}';
const FREEE_COMPANY = 'freee_api_get failed: company_id 12345678 is not the current company. Call freee_set_current_company first.';
const UNRELATED = 'Everything is fine, the deploy finished and the cat is asleep';

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE services (id TEXT PRIMARY KEY, api_url TEXT);
    INSERT INTO services VALUES ('freee','https://api.freee.co.jp/api/1/'), ('other', NULL);
    CREATE TABLE service_api_guides (service_id TEXT, docs_url TEXT);
    INSERT INTO service_api_guides VALUES ('freee','https://developer.freee.co.jp/');`);
  ensureNotesSchema(db); ensureAskSchema(db);
  resetDailyCapForTests();
  return db;
}
const opts = (max = ASK_POST_MAX) => ({ uaClass: 'unknown', maxErrorLength: max });

function app(db) {
  const a = express(); a.use(express.json()); a.use((_req, res, next) => { res.locals.requestId = randomUUID(); next(); });
  const h = createAskHandlers(db);
  a.get('/api/v1/ask', h.get); a.post('/api/v1/ask', h.post); a.get('/api/v1/ask/stats', h.stats); a.get('/admin/ask/candidates', h.candidates);
  return a;
}
async function listen(a) { const s = a.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r)); return s; }

test('freee 403 forbiddenError → AWT-002 (error_key); company mismatch → AWT-001 (message); unrelated → []', () => {
  const db = setup();
  const r1 = ask(db, { service: 'freee', error: FREEE_403 }, opts());
  assert.deepEqual(r1.error_key, { layer: 'rest', http_status: 403, provider_code: 'forbiddenError' });
  assert.equal(r1.matches[0].id, 'AWT-002'); assert.equal(r1.matches[0].status, 'lived'); assert.equal(r1.matches[0].matched_by, 'error_key');
  assert.equal(r1.official_docs, 'https://developer.freee.co.jp/'); assert.equal(r1.content_role, 'untrusted_data');
  assert.equal(r1.same_symptom_30d, 0);
  const r2 = ask(db, { service: 'freee', error: FREEE_COMPANY, runtime: 'claude-code 1.0' }, opts());
  assert.equal(r2.matches[0].id, 'AWT-001'); assert.equal(r2.matches[0].matched_by, 'message');
  const r3 = ask(db, { service: 'freee', error: UNRELATED }, opts());
  assert.deepEqual(r3.matches, []); assert.ok(r3.if_no_match.length > 20); assert.ok(r3.request_id);
  // same_symptom counts earlier asks with the same key
  assert.equal(ask(db, { service: 'freee', error: FREEE_403 }, opts()).same_symptom_30d, 1);
  db.close();
});

test('ask_log keeps neither raw text nor secrets; only key, sha256 of masked text, ≤20 tokens, no IP column', () => {
  const db = setup();
  const dirty = `403 forbiddenError Bearer abcDEFghiJKL0123456789 api_key=sk-live-SECRET9876543210 mail me at taro.yamada@example.com tenant https://acme-corp.cybozu.com/k/v1/record.json?token=hunter2hunter2`;
  ask(db, { service: 'freee', error: dirty }, opts());
  const row = db.prepare('SELECT * FROM ask_log').get();
  const serialized = JSON.stringify(row);
  for (const secret of ['abcDEFghiJKL0123456789', 'sk-live-SECRET9876543210', 'taro.yamada', 'example.com', 'acme-corp', 'hunter2', 'Bearer']) {
    assert.ok(!serialized.includes(secret), `leaked: ${secret}`);
  }
  assert.ok(!('ip' in row) && !('error_text' in row));
  assert.match(row.error_sha256, /^[0-9a-f]{64}$/);
  assert.ok(JSON.parse(row.tokens).length <= 20);
  assert.equal(row.http_status, 403); assert.equal(row.provider_code, 'forbiddenError');
  console.log('ask_log row:', row);
  db.close();
});

test('HTTP: 301-char GET → 400 problem+json (points to POST); 2,001-char POST → 400; unknown service → 404; 200 on no match', async () => {
  const db = setup(); const server = await listen(app(db)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const g = await fetch(`${base}/api/v1/ask?service=freee&error=${encodeURIComponent('x'.repeat(301))}`);
    assert.equal(g.status, 400); assert.equal(g.headers.get('content-type').split(';')[0], 'application/problem+json');
    const gb = await g.json(); assert.match(gb.detail, /POST \/api\/v1\/ask/); console.log('GET 301:', g.status, gb.detail);
    const ok300 = await fetch(`${base}/api/v1/ask?service=freee&error=${encodeURIComponent('x'.repeat(300))}`); assert.equal(ok300.status, 200);
    const p = await fetch(`${base}/api/v1/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'freee', error: 'y'.repeat(2001) }) });
    assert.equal(p.status, 400); console.log('POST 2001:', p.status, (await p.json()).detail);
    const ok2000 = await fetch(`${base}/api/v1/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'freee', error: 'y'.repeat(2000) }) });
    assert.equal(ok2000.status, 200);
    const nf = await fetch(`${base}/api/v1/ask?service=nope&error=403`); assert.equal(nf.status, 404);
    const miss = await fetch(`${base}/api/v1/ask?service=freee&error=${encodeURIComponent(UNRELATED)}`);
    assert.equal(miss.status, 200); assert.equal(miss.headers.get('cache-control'), 'no-store'); assert.deepEqual((await miss.json()).matches, []);
    const hit = await (await fetch(`${base}/api/v1/ask?service=freee&error=${encodeURIComponent(FREEE_403)}`)).json();
    assert.equal(hit.matches[0].id, 'AWT-002');
    const bad = await fetch(`${base}/api/v1/ask?service=freee`); assert.equal(bad.status, 400);
  } finally { await new Promise(r => server.close(r)); db.close(); }
});

test('limits: 30/min/IP → 429; global daily cap → 429 (HTTP and MCP share it)', async () => {
  const db = setup(); const a = express(); a.use(express.json()); const h = createAskHandlers(db);
  a.get('/api/v1/ask', h.limiter, h.get); const server = await listen(a); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let last; for (let i = 0; i < 31; i++) last = await fetch(`${base}/api/v1/ask?service=freee&error=403`);
    assert.equal(last.status, 429); console.log('31st request/min:', last.status, await last.json());
  } finally { await new Promise(r => server.close(r)); }
  process.env.ASK_DAILY_CAP = '2'; resetDailyCapForTests();
  try {
    ask(db, { service: 'freee', error: '403' }, opts()); ask(db, { service: 'freee', error: '403' }, opts());
    assert.throws(() => ask(db, { service: 'freee', error: '403' }, opts()), e => e.status === 429 && e.code === 'daily_limit');
    const tools = {}; registerLookup({ registerTool(n, d, f) { tools[n] = { d, f }; } }, db);
    const r = await tools.lookup.f(tools.lookup.d.inputSchema.parse({ mode: 'ask', service_id: 'freee', error: '403' }));
    assert.deepEqual(JSON.parse(r.content[0].text), { error: 'daily_limit' }); console.log('3rd ask with cap=2 (MCP):', r.content[0].text);
    const s2 = await listen(app(db)); try {
      const r2 = await fetch(`http://127.0.0.1:${s2.address().port}/api/v1/ask?service=freee&error=403`); assert.equal(r2.status, 429); console.log('3rd ask with cap=2 (HTTP):', r2.status);
    } finally { await new Promise(r => s2.close(r)); }
  } finally { delete process.env.ASK_DAILY_CAP; resetDailyCapForTests(); db.close(); }
});

test('ASK_LOG_ENABLED=false: nothing recorded, answer still returned; default records', () => {
  const db = setup();
  process.env.ASK_LOG_ENABLED = 'false';
  try {
    const r = ask(db, { service: 'freee', error: FREEE_403 }, opts());
    assert.equal(r.matches[0].id, 'AWT-002');
    assert.equal(db.prepare('SELECT count(*) AS n FROM ask_log').get().n, 0);
  } finally { delete process.env.ASK_LOG_ENABLED; }
  ask(db, { service: 'freee', error: FREEE_403 }, opts());
  assert.equal(db.prepare('SELECT count(*) AS n FROM ask_log').get().n, 1);
  db.close();
});

test('an unverified agent note is never returned by ask (even with an exact error key)', () => {
  const db = setup();
  recordNote(db, { service_id: 'other', request_id: randomUUID(), session_id: randomUUID(), share: true, runtime: 'codex',
    task: 'call other API', symptom: '403 forbiddenError on GET /x', procedure: 'retry', conditions: 'c', evidence: 'e', observation_kind: 'execution' });
  assert.equal(db.prepare("SELECT status FROM agent_notes").get().status, 'unverified');
  const r = ask(db, { service: 'other', error: '403 forbiddenError on GET /x' }, opts());
  assert.deepEqual(r.matches, []);
  assert.equal(r.official_docs, null);
  db.close();
});

test('lookup mode:"ask" returns the same matches as HTTP, records ua_class=mcp_client, no attempt handle', async () => {
  const db = setup();
  const tools = {}; registerLookup({ registerTool(n, d, f) { tools[n] = { d, f }; } }, db);
  const explicit = JSON.parse((await tools.lookup.f(tools.lookup.d.inputSchema.parse({ mode: 'ask', service_id: 'freee', error: FREEE_403, runtime: 'codex' }))).content[0].text);
  const inferred = JSON.parse((await tools.lookup.f(tools.lookup.d.inputSchema.parse({ service_id: 'freee', error: FREEE_403 }))).content[0].text);
  const http = ask(db, { service: 'freee', error: FREEE_403 }, opts());
  const strip = (r) => ({ ...r, request_id: null, same_symptom_30d: null });
  assert.deepEqual(strip(explicit), strip(http)); assert.deepEqual(strip(inferred), strip(http));
  assert.equal(explicit.matches[0].id, 'AWT-002');
  assert.deepEqual(db.prepare("SELECT ua_class, runtime FROM ask_log ORDER BY id LIMIT 1").get(), { ua_class: 'mcp_client', runtime: 'codex' });
  assert.ok(!db.prepare("SELECT name FROM sqlite_master WHERE name='execution_attempts'").get() || db.prepare('SELECT count(*) AS n FROM execution_attempts').get().n === 0);
  const bad = JSON.parse((await tools.lookup.f(tools.lookup.d.inputSchema.parse({ mode: 'ask', service_id: 'freee' }))).content[0].text);
  assert.equal(bad.error, 'invalid_ask_input');
  db.close();
});

test('stats are aggregates only; candidates list unmatched keys, most frequent first', async () => {
  const db = setup();
  for (let i = 0; i < 3; i++) ask(db, { service: 'freee', error: UNRELATED }, opts());
  ask(db, { service: 'freee', error: FREEE_403 }, opts());
  ask(db, { service: 'other', error: '500 InternalServerError' }, opts());
  const stats = askStats(db);
  assert.equal(stats.total_asks, 5); assert.equal(stats.entries[0].asks, 3); assert.equal(stats.entries[0].matched, 0);
  assert.ok(!JSON.stringify(stats).includes('sha256') && !JSON.stringify(stats).includes('request_id'));
  const c = askCandidates(db);
  assert.equal(c.candidates[0].asks, 3); assert.ok(c.candidates.every(x => x.service_id !== 'freee' || x.provider_code !== 'forbiddenError'));
  const server = await listen(app(db)); try {
    const s = await (await fetch(`http://127.0.0.1:${server.address().port}/api/v1/ask/stats`)).json(); assert.equal(s.schema, 'kansei-ask-stats/v1');
  } finally { await new Promise(r => server.close(r)); }
  db.close();
});

test('retention: rows older than 180 days are deleted at startup', () => {
  const db = setup();
  db.prepare(`INSERT INTO ask_log (asked_at, service_id, layer, error_sha256, tokens, ua_class, match_count, request_id) VALUES (datetime('now','-181 days'),'freee','rest','x','[]','unknown',0,'r')`).run();
  db.prepare(`INSERT INTO ask_log (asked_at, service_id, layer, error_sha256, tokens, ua_class, match_count, request_id) VALUES (datetime('now','-179 days'),'freee','rest','x','[]','unknown',0,'r')`).run();
  ensureAskSchema(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM ask_log').get().n, 1);
  db.close();
});

test('parseErrorKey / cleanText basics', () => {
  assert.deepEqual(parseErrorKey('HTTP 429 {"code":"rate_limited"}'), { layer: 'rest', http_status: 429, provider_code: 'rate_limited' });
  assert.equal(parseErrorKey('freee-mcp tool call rejected').layer, 'mcp');
  assert.ok(!cleanText('token=abcdef123456 x', 100).includes('abcdef123456'));
});
