import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { uaFamily, productToken, UA_FAMILIES } from '../dist/utils/ua-family.js';
import { compileClientKinds } from '../dist/utils/client-kind.js';
import { ensureUsageLogSchema, describeUsage, usageRecorder, usageSummary, recordUsage } from '../dist/mcp-usage-log.js';
import { adminActivity } from '../dist/admin/activity.js';
import { ensureNotesSchema } from '../dist/notes/store.js';
import { ensureAskSchema, resetDailyCapForTests } from '../dist/ask/engine.js';

// ua_family (SEC-2026-10-24-001 addendum A). In-memory DBs only.

// User-Agents seen for real: the first three captured locally in #89, the probe ones as published
// by their operators (mcpbeat /bot, AgentToolIndex /method, InvokeRankBot /bot, anlyon.dev /about).
const CASES = [
  ['claude-code/2.1.301 (claude-desktop, agent-sdk/0.3.308)', 'claude-code'],
  ['codex-mcp-client/0.153.4', 'codex'],
  ['node', 'node'],
  ['mcpbeat/0.1 (+https://mcpbeat.com/bot/)', 'probe'],
  ['AgentToolIndex/1.0 (+https://agenttoolindex.com/method)', 'probe'],
  ['InvokeRankBot/0.1 (+https://invokerank.com/bot)', 'probe'],
  ['anlyon.dev-indexer/0.1', 'probe'],
  ['ElectraIndexBot/1.0', 'probe'],
  ['io.verifymcp/probe', 'probe'],
  ['python-httpx/0.27.0', 'python'],
  ['python-requests/2.32.3', 'python'],
  ['Python-urllib/3.12', 'python'],
  ['aiohttp/3.9.5', 'python'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', 'other'],
  ['curl/8.9.1', 'other'],
  ['', 'other'],
  [undefined, 'other'],
  [42, 'other'],
  ['x'.repeat(65) + '/1.0', 'other'],
];

test('each User-Agent lands in exactly one of the six families', () => {
  assert.deepEqual([...UA_FAMILIES], ['claude-code', 'codex', 'probe', 'node', 'python', 'other']);
  for (const [ua, want] of CASES) assert.equal(uaFamily(ua), want, `${String(ua).slice(0, 60)} → ${want}`);
});

test('only the product token is read; the two real clients beat any probe pattern', () => {
  assert.equal(productToken('claude-code/2.1.301 (claude-desktop, agent-sdk/0.3.308)'), 'claude-code');
  assert.equal(productToken('  Node  '), 'node');
  assert.equal(uaFamily('node-fetch/1.0'), 'other', 'a different product that starts with "node" is not node');
  assert.equal(uaFamily('Mozilla/5.0 (compatible; Googlebot/2.1)'), 'other', 'a probe word after the token is not read');
  const greedy = compileClientKinds({ probe: { patterns: ['code', 'codex', 'mcp'] } });
  assert.equal(uaFamily('claude-code/2', greedy), 'claude-code');
  assert.equal(uaFamily('codex-mcp-client/1', greedy), 'codex');
});

test('the raw User-Agent and its version never reach the table (full dump)', () => {
  process.env.AGENT_HASH_SALT = 'test-salt-0123456789abcdef';
  delete process.env.USAGE_LOG_ENABLED;
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE services (id TEXT PRIMARY KEY, api_url TEXT); INSERT INTO services VALUES ('freee', NULL);
    CREATE TABLE service_api_guides (service_id TEXT, docs_url TEXT);`);
  ensureUsageLogSchema(db);
  const body = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code', version: '2.1.301' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lookup', arguments: { service_id: 'freee' } } },
  ];
  for (const [ua] of CASES) {
    const rec = usageRecorder(db, describeUsage(db, body), { uaClass: 'unknown', serverVersion: '1.3.0', uaFamily: uaFamily(ua) });
    rec.onSend({ jsonrpc: '2.0', id: 1, result: {} });
    rec.onSend({ jsonrpc: '2.0', id: 2, result: { content: [] } });
  }
  const rows = db.prepare('SELECT * FROM mcp_usage_log').all();
  assert.equal(rows.length, CASES.length * 2);
  for (const r of rows) assert.ok(UA_FAMILIES.includes(r.ua_family), `ua_family is one of six: ${r.ua_family}`);
  const dump = JSON.stringify(rows);
  for (const bad of ['agent-sdk', '0.153.4', '0.3.308', 'Mozilla', 'mcpbeat.com', 'agenttoolindex', 'invokerank', 'verifymcp',
    'httpx', 'requests', 'urllib', 'aiohttp', 'curl', 'Windows NT', '+https']) {
    assert.ok(!dump.includes(bad), `${bad} is not stored`);
  }
  // initialize rows still carry clientInfo (that is the existing, ratified column) — the UA itself never does
  assert.equal(rows.filter((r) => r.kind === 'initialize' && r.client_version === '2.1.301').length, CASES.length);
  db.close();
});

test('an unexpected value is stored as NULL, not as text', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE services (id TEXT PRIMARY KEY)');
  ensureUsageLogSchema(db);
  const p = { rpcId: 1, kind: 'tools_call', tool: 'lookup', service_id: null, service_unknown: 0, mode: null, client_name: null, client_version: null };
  recordUsage(db, p, 'ok', { uaClass: 'unknown', serverVersion: 'x', uaFamily: 'Mozilla/5.0 something' });
  recordUsage(db, p, 'ok', { uaClass: 'unknown', serverVersion: 'x' });
  assert.deepEqual(db.prepare('SELECT ua_family FROM mcp_usage_log').all().map((r) => r.ua_family), [null, null]);
  db.close();
});

test('an existing table without the column gets it; old rows stay NULL', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE services (id TEXT PRIMARY KEY);
    CREATE TABLE mcp_usage_log (id INTEGER PRIMARY KEY AUTOINCREMENT, called_at TEXT NOT NULL, kind TEXT NOT NULL, tool TEXT,
      service_id TEXT, service_unknown INTEGER NOT NULL DEFAULT 0, mode TEXT, outcome TEXT NOT NULL, client_name TEXT,
      client_version TEXT, ua_class TEXT NOT NULL, server_version TEXT NOT NULL, agent_hash TEXT);
    INSERT INTO mcp_usage_log (called_at, kind, tool, outcome, ua_class, server_version) VALUES (datetime('now'), 'tools_call', 'lookup', 'ok', 'unknown', '1.3.0');`);
  ensureUsageLogSchema(db);
  ensureUsageLogSchema(db); // idempotent
  assert.deepEqual(db.prepare('SELECT ua_family FROM mcp_usage_log').all(), [{ ua_family: null }]);
  db.close();
});

test('summary: by_ua_family over both row kinds, and tools_calls_excluding_probe', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE services (id TEXT PRIMARY KEY, api_url TEXT); INSERT INTO services VALUES ('freee', NULL);
    CREATE TABLE service_api_guides (service_id TEXT, docs_url TEXT);`);
  db.pragma('foreign_keys=ON');
  ensureUsageLogSchema(db); ensureNotesSchema(db); ensureAskSchema(db); resetDailyCapForTests();
  const init = { rpcId: 1, kind: 'initialize', tool: null, service_id: null, service_unknown: 0, mode: null, client_name: 'mcpbeat', client_version: '0.1' };
  const call = { rpcId: 2, kind: 'tools_call', tool: 'lookup', service_id: 'freee', service_unknown: 0, mode: 'tips', client_name: null, client_version: null };
  const ctx = (f) => ({ uaClass: 'unknown', serverVersion: '1.3.0', uaFamily: f });
  for (let i = 0; i < 5; i++) recordUsage(db, init, 'ok', ctx('probe'));
  for (let i = 0; i < 3; i++) recordUsage(db, call, 'ok', ctx('probe'));
  recordUsage(db, call, 'ok', ctx('claude-code'));
  recordUsage(db, call, 'ok', ctx('node'));
  recordUsage(db, call, 'ok', ctx(undefined)); // e.g. a row from before the column → NULL
  const u = usageSummary(db, 7);
  assert.deepEqual(u.by_ua_family, [
    { kind: 'initialize', ua_family: 'probe', n: 5 },
    { kind: 'tools_call', ua_family: 'probe', n: 3 },
    { kind: 'tools_call', ua_family: null, n: 1 },
    { kind: 'tools_call', ua_family: 'claude-code', n: 1 },
    { kind: 'tools_call', ua_family: 'node', n: 1 },
  ]);
  assert.equal(u.calls, 6);
  assert.equal(u.tools_calls_excluding_probe, 3, 'claude-code + node + the NULL row');
  const a = adminActivity(db).mcp_usage;
  assert.equal(a.tools_calls_excluding_probe, 3);
  assert.ok(Array.isArray(a.by_ua_family));
  db.close();
});
