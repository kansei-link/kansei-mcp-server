import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  ensureUsageLogSchema, describeUsage, outcomeOf, recordUsage, usageRecorder, usageSummary, minuteOf, USAGE_LOG_RETENTION_DAYS,
} from '../dist/mcp-usage-log.js';
import { adminActivity } from '../dist/admin/activity.js';
import { ensureNotesSchema } from '../dist/notes/store.js';
import { ensureAskSchema, resetDailyCapForTests } from '../dist/ask/engine.js';

// Stage 2a usage log for the hosted /mcp. In-memory DBs only. Never the production DB.

const SECRET = 'sk-live-THIS-MUST-NEVER-BE-STORED-9f8e7d';
const CTX = { uaClass: 'mcp_client', serverVersion: '1.3.0-test' };

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE services (id TEXT PRIMARY KEY, api_url TEXT);
    INSERT INTO services VALUES ('freee', NULL), ('kintone', NULL);
    CREATE TABLE service_api_guides (service_id TEXT, docs_url TEXT);`);
  ensureUsageLogSchema(db);
  return db;
}
const dump = (db) => JSON.stringify(db.prepare('SELECT * FROM mcp_usage_log').all());
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const ok = (id) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'fine' }] } });

test('arguments never reach the table: only the validated id, the mode and the outcome', () => {
  process.env.AGENT_HASH_SALT = 'test-salt-0123456789abcdef';
  delete process.env.USAGE_LOG_ENABLED;
  const db = setup();
  const body = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.0.1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    call(2, 'search_services', { intent: `connect to freee with key ${SECRET}` }),
    call(3, 'lookup', { service_id: 'freee', mode: 'notes', q: SECRET }),
    call(4, 'lookup', { service_id: 'freee', error: `401 ${SECRET}` }),
    call(5, 'report', { service_id: 'kintone', success: false, context: SECRET }),
    call(6, 'report', { mode: 'note', note: { service_id: 'freee', task: SECRET, symptom: SECRET } }),
  ];
  const pending = describeUsage(db, body);
  assert.equal(pending.length, 6, 'the notification gets no row');
  assert.deepEqual(pending.map((p) => [p.kind, p.tool, p.service_id, p.mode]), [
    ['initialize', null, null, null],
    ['tools_call', 'search_services', null, null],
    ['tools_call', 'lookup', 'freee', 'notes'],
    ['tools_call', 'lookup', 'freee', 'ask'],
    ['tools_call', 'report', 'kintone', 'outcome'],
    ['tools_call', 'report', null, 'note'],
  ]);
  assert.equal(pending[0].client_name, 'claude-code');
  assert.equal(pending[0].client_version, '2.0.1');
  const rec = usageRecorder(db, pending, { ...CTX, sessionId: 'session-ABCDEFGH-12345' });
  for (const id of [1, 2, 3]) rec.onSend(ok(id));
  rec.onSend({ jsonrpc: '2.0', id: 4, result: { isError: true, content: [] } });
  rec.onSend({ jsonrpc: '2.0', id: 5, error: { code: -32602, message: `Invalid arguments: ${SECRET}` } });
  rec.onClose(); // id 6 never answered
  const rows = db.prepare('SELECT kind, tool, service_id, service_unknown, mode, outcome, client_name, client_version, ua_class, server_version, agent_hash FROM mcp_usage_log ORDER BY id').all();
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.outcome), ['ok', 'ok', 'ok', 'tool_error', 'invalid_params', 'no_response']);
  assert.equal(rows[0].client_name, 'claude-code');
  assert.equal(rows[1].client_name, null, 'tools_call rows carry no client (stateless)');
  assert.match(rows[0].agent_hash, /^[0-9a-f]{32}$/);
  assert.equal(rows[0].agent_hash, rows[3].agent_hash, 'same session → same hash');
  assert.equal(rows[0].ua_class, 'mcp_client');
  assert.equal(rows[0].server_version, '1.3.0-test');
  const all = dump(db);
  assert.ok(!all.includes(SECRET), 'the secret-looking argument is nowhere in the table');
  assert.ok(!all.includes('session-ABCDEFGH'), 'the raw session id is not kept');
  assert.ok(!all.includes('connect to freee'), 'no intent text');
  assert.ok(!all.includes('401'), 'no error text');
  assert.ok(!all.includes('fine'), 'no response content');
  db.close();
});

test('an unknown or malformed service id leaves nothing but a count', () => {
  const db = setup();
  const pending = describeUsage(db, [
    call(1, 'lookup', { service_id: 'no-such-service-xyz' }),
    call(2, 'lookup', { service_id: `../etc/passwd ${SECRET}` }),
    call(3, 'lookup', { service_id: 'FREEE' }),
    call(4, 'frobnicate', { service_id: 'freee' }),
  ]);
  assert.deepEqual(pending.map((p) => [p.tool, p.service_id, p.service_unknown]), [
    ['lookup', null, 1], ['lookup', null, 1], ['lookup', null, 1], ['other', 'freee', 0],
  ]);
  const rec = usageRecorder(db, pending, CTX);
  rec.onSend(ok(1)); rec.onSend(ok(2)); rec.onSend(ok(3));
  rec.onSend({ jsonrpc: '2.0', id: 4, error: { code: -32602, message: 'Tool frobnicate not found' } });
  const all = dump(db);
  for (const bad of ['no-such-service', 'passwd', SECRET, 'FREEE', 'frobnicate']) assert.ok(!all.includes(bad), `${bad} is not stored`);
  const s = usageSummary(db, 7);
  assert.equal(s.unknown_service_ids, 3);
  assert.deepEqual(s.by_outcome, [{ outcome: 'ok', n: 3 }, { outcome: 'unknown_tool', n: 1 }]);
  assert.deepEqual(s.by_tool, [{ tool: 'lookup', n: 3 }, { tool: 'other', n: 1 }]);
  db.close();
});

test('clientInfo is kept only when it is plain text of sane length', () => {
  const db = setup();
  const init = (ci) => describeUsage(db, [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: ci } }])[0];
  assert.equal(init({ name: 'Cursor', version: '1.2.3-beta_4' }).client_name, 'Cursor');
  assert.equal(init({ name: `<script>${SECRET}</script>`, version: '1' }).client_name, 'other');
  assert.equal(init({ name: 'x'.repeat(65), version: '1' }).client_name, 'other');
  assert.equal(init({ name: 42 }).client_name, null);
  assert.equal(init(undefined).client_name, null);
  db.close();
});

test('USAGE_LOG_ENABLED=0 writes nothing; no salt → no agent hash, still a row', () => {
  const db = setup();
  process.env.USAGE_LOG_ENABLED = '0';
  try {
    const rec = usageRecorder(db, describeUsage(db, [call(1, 'lookup', { service_id: 'freee' })]), CTX);
    rec.onSend(ok(1)); rec.onClose();
    assert.equal(db.prepare('SELECT count(*) AS n FROM mcp_usage_log').get().n, 0);
    assert.equal(usageSummary(db).log_enabled, false);
  } finally { delete process.env.USAGE_LOG_ENABLED; }
  const salt = process.env.AGENT_HASH_SALT;
  delete process.env.AGENT_HASH_SALT;
  try {
    assert.equal(recordUsage(db, describeUsage(db, [call(2, 'lookup', { service_id: 'freee' })])[0], 'ok', { ...CTX, sessionId: 'session-ABCDEFGH-12345' }), true);
    const r = db.prepare('SELECT agent_hash, called_at FROM mcp_usage_log').get();
    assert.equal(r.agent_hash, null);
    assert.match(r.called_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/, 'minute precision');
    assert.equal(r.called_at, minuteOf());
  } finally { if (salt) process.env.AGENT_HASH_SALT = salt; }
  db.close();
});

test('a write failure never throws (the tool call must not be affected)', () => {
  const db = setup();
  db.exec('DROP TABLE mcp_usage_log');
  const rec = usageRecorder(db, describeUsage(db, [call(1, 'lookup', { service_id: 'freee' })]), CTX);
  assert.doesNotThrow(() => { rec.onSend(ok(1)); rec.onClose(); });
  assert.equal(recordUsage(db, { rpcId: 1, kind: 'tools_call', tool: 'lookup', service_id: null, service_unknown: 0, mode: null, client_name: null, client_version: null }, 'ok', CTX), false);
  db.close();
});

test('retention: rows older than the window are removed when the schema is ensured', () => {
  const db = setup();
  db.prepare(`INSERT INTO mcp_usage_log (called_at, kind, tool, outcome, ua_class, server_version)
    VALUES (datetime('now', '-${USAGE_LOG_RETENTION_DAYS + 1} days'), 'tools_call', 'lookup', 'ok', 'unknown', 'x'),
           (datetime('now', '-1 days'), 'tools_call', 'lookup', 'ok', 'unknown', 'x')`).run();
  ensureUsageLogSchema(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM mcp_usage_log').get().n, 1);
  db.close();
});

test('/admin/activity carries the mcp_usage section (counts only) and stays free of argument text', () => {
  const db = setup();
  db.pragma('foreign_keys=ON');
  ensureNotesSchema(db); ensureAskSchema(db); resetDailyCapForTests();
  const rec = usageRecorder(db, describeUsage(db, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code', version: '2.0.1' } } },
    call(2, 'lookup', { service_id: 'freee', q: SECRET }),
    call(3, 'lookup', { service_id: 'nope-nope' }),
  ]), { ...CTX, sessionId: 'session-ABCDEFGH-12345' });
  rec.onSend(ok(1)); rec.onSend(ok(2)); rec.onSend(ok(3));
  const a = adminActivity(db);
  assert.equal(a.schema, 'kansei-admin-activity/v1');
  const u = a.mcp_usage;
  assert.equal(u.window_days, 7);
  assert.equal(u.calls, 2);
  assert.equal(u.initializes, 1);
  assert.deepEqual(u.top_services, [{ service_id: 'freee', n: 1 }]);
  assert.equal(u.unknown_service_ids, 1);
  assert.deepEqual(u.by_client, [{ client_name: 'claude-code', client_version: '2.0.1', n: 1 }]);
  assert.deepEqual(u.by_tool_mode, [{ tool: 'lookup', mode: 'tips', n: 2 }]);
  assert.equal(u.by_server_version[0].server_version, '1.3.0-test');
  const text = JSON.stringify(a);
  for (const bad of [SECRET, 'nope-nope', 'session-ABCDEFGH']) assert.ok(!text.includes(bad), `${bad} is not in /admin/activity`);
  db.close();
});
