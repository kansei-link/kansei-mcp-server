import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';
import { ensureNotesSchema, recordNote, recordResult, findNotes, getNote } from '../dist/notes/store.js';
import { createNotesHandlers } from '../dist/notes/routes.js';
import { register as registerLookup } from '../dist/tools/lookup.js';
import { register as registerReport } from '../dist/tools/report-unified.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec("CREATE TABLE services (id TEXT PRIMARY KEY); INSERT INTO services VALUES ('fixture'), ('other');");
  ensureNotesSchema(db);
  return db;
}
function input(overrides = {}) {
  return { service_id: 'fixture', request_id: randomUUID(), session_id: randomUUID(), share: true,
    runtime: 'codex', task: 'Read fixture', symptom: 'Protocol version missing', procedure: 'Set x-fixture-protocol to 2',
    conditions: 'Local test fixture v2', evidence: '400 without header; 200 with header', observation_kind: 'execution', ...overrides };
}
function result(note, overrides = {}) {
  return { service_id: 'fixture', request_id: randomUUID(), session_id: randomUUID(), share: true,
    runtime: 'codex', note_id: note.id, outcome: 'succeeded', conditions: 'Local fixture v2', evidence: 'HTTP 200', ...overrides };
}
test('persistent note/result relationship, no rating or verification promotion', () => {
  const db = setup();
  const original = input();
  const { note } = recordNote(db, original);
  assert.equal(findNotes(db, { service_id: 'fixture', q: 'protocol version' }).notes[0].id, note.id);
  const reused = recordResult(db, result(note));
  assert.equal(reused.counts.succeeded, 1);
  assert.equal(reused.results[0].same_session, 0);
  const nextReader = findNotes(db, { service_id: 'fixture', q: 'protocol' }).notes[0];
  assert.equal(nextReader.reuse.counts.succeeded, 1);
  assert.equal(nextReader.reuse.recent_results[0].outcome, 'succeeded');
  assert.equal(reused.note.status, 'unverified');
  recordResult(db, result(note, { session_id: original.session_id, outcome: 'failed' }));
  assert.equal(getNote(db, note.id).counts.failed, 1);
  assert.equal(getNote(db, note.id).results.filter(r => r.same_session).length, 1);
  db.close();
});
test('read requests create no records, search is bounded and SQL wildcards are literal', () => {
  const db = setup(); recordNote(db, input());
  const before = db.prepare('SELECT total_changes() AS n').get().n;
  for (let i = 0; i < 3; i++) findNotes(db, { service_id: 'fixture', q: 'version' });
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
  assert.equal(findNotes(db, { service_id: 'other' }).notes.length, 0);
  assert.equal(findNotes(db, { service_id: 'fixture', q: '%' }).notes.length, 0);
  assert.throws(() => findNotes(db, { service_id: 'fixture', limit: 100 }));
  db.close();
});
test('idempotency rejects changed retries and duplicate session results', () => {
  const db = setup(); const original = input(); const { note } = recordNote(db, original);
  assert.equal(recordNote(db, original).deduplicated, true);
  assert.throws(() => recordNote(db, { ...original, symptom: 'Different' }), /request_id_conflict/);
  const r = result(note); recordResult(db, r);
  assert.equal(recordResult(db, r).deduplicated, true);
  assert.throws(() => recordResult(db, { ...r, evidence: 'Changed' }), /request_id_conflict/);
  assert.throws(() => recordResult(db, { ...r, request_id: randomUUID() }), /session_already_reported/);
  assert.equal(getNote(db, note.id).counts.total, 1);
  db.close();
});
test('unknown services, mismatched services and missing consent cannot write', () => {
  const db = setup();
  assert.throws(() => recordNote(db, input({ service_id: 'absent' })), /service_not_found/);
  assert.throws(() => recordNote(db, input({ share: false })));
  assert.throws(() => recordNote(db, input({ share: undefined })));
  assert.throws(() => recordNote(db, input({ status: 'verified' })));
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_notes').get().n, 0);
  const { note } = recordNote(db, input());
  assert.throws(() => recordResult(db, result(note, { service_id: 'other' })), /service_mismatch/);
  assert.throws(() => recordResult(db, result(note, { note_id: randomUUID() })), /note_not_found/);
  assert.equal(getNote(db, note.id).counts.total, 0);
  db.close();
});
test('all narrative fields are redacted before persistence and public reads exclude identifiers', () => {
  const db = setup();
  const dirty = 'email person@example.com token=abcd Bearer a.b.c https://tenant.example.com/path?key=private sk-testSECRET';
  const { note } = recordNote(db, input({ task: dirty, symptom: dirty, procedure: dirty, conditions: dirty, evidence: dirty }));
  const saved = JSON.stringify(db.prepare('SELECT * FROM agent_notes').get());
  for (const forbidden of ['person@example.com', 'abcd', 'a.b.c', 'tenant.example.com', 'sk-testSECRET']) assert.ok(!saved.includes(forbidden));
  recordResult(db, result(note, { conditions: dirty, evidence: dirty }));
  const publicData = JSON.stringify(getNote(db, note.id));
  for (const forbidden of ['session_hash', 'payload_hash', 'request_id', 'person@example.com', 'tenant.example.com']) assert.ok(!publicData.includes(forbidden));
  db.close();
});
test('HTTP API validates, persists, deduplicates and never publishes on GET', async () => {
  const db = setup(); const app = express(); app.use(express.json()); const handlers = createNotesHandlers(db);
  app.get('/api/v1/notes', handlers.list); app.get('/api/v1/notes/:id', handlers.detail);
  app.post('/api/v1/notes', handlers.writes, handlers.create); app.post('/api/v1/notes/:id/results', handlers.writes, handlers.result);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/notes', input({ share: false }))).status, 400);
    const source = input(); const created = await post('/notes', source); assert.equal(created.status, 200);
    const { note } = await created.json();
    assert.equal((await (await post('/notes', source)).json()).deduplicated, true);
    const read = await fetch(base + '/notes?service_id=fixture&q=protocol');
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal((await read.json()).notes.length, 1);
    const changes = db.prepare('SELECT total_changes() AS n').get().n;
    await fetch(base + '/notes?service_id=fixture&q=new-symptom');
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
    assert.equal((await post(`/notes/${note.id}/results`, result(note))).status, 200);
    assert.equal((await (await fetch(base + `/notes/${note.id}`)).json()).counts.succeeded, 1);
    assert.equal((await fetch(base + '/notes/not-a-uuid')).status, 400);
    assert.equal((await fetch(base + '/notes?service_id=fixture&limit=10000')).status, 400);
  } finally { await new Promise(r => server.close(r)); db.close(); }
});
test('HTTP writes are rate limited', async () => {
  const db = setup(); const app = express(); app.use(express.json()); const handlers = createNotesHandlers(db);
  app.get('/api/v1/notes', handlers.list); app.get('/api/v1/notes/:id', handlers.detail);
  app.post('/api/v1/notes', handlers.writes, handlers.create); app.post('/api/v1/notes/:id/results', handlers.writes, handlers.result);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    let response;
    for (let i = 0; i < 11; i++) response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 429);
  } finally { await new Promise(r => server.close(r)); db.close(); }
});
test('existing MCP lookup/report expose the same store without a new tool or network upload', async () => {
  const db = setup(); const tools = {};
  const server = { registerTool(name, definition, handler) { tools[name] = { definition, handler }; } };
  registerLookup(server, db); registerReport(server, db);
  const call = async (name, args) => {
    const parsed = tools[name].definition.inputSchema.parse(args);
    return JSON.parse((await tools[name].handler(parsed)).content[0].text);
  };
  const created = await call('report', { mode: 'note', note: input() });
  assert.ok(created.note.id);
  const found = await call('lookup', { mode: 'notes', service_id: 'fixture', q: 'version' });
  assert.equal(found.notes[0].id, created.note.id);
  const reused = await call('report', { mode: 'note_result', note_result: result(created.note) });
  assert.equal(reused.counts.succeeded, 1);
  assert.equal((await call('report', { mode: 'note' })).error, 'invalid_note_input');
  assert.deepEqual(Object.keys(tools), ['lookup', 'report']); db.close();
});

test('verification records are excluded from normal discovery, including reuse results', async () => {
  const db = setup(); const { note } = recordNote(db, input({ scope: 'verification' }));
  recordResult(db, result(note));
  assert.equal(findNotes(db, { service_id: 'fixture' }).notes.length, 0);
  assert.equal(findNotes(db, { service_id: 'fixture', scope: 'verification' }).notes[0].reuse.counts.succeeded, 1);
  assert.equal(getNote(db, note.id).note.scope, 'verification');
  const tools = {}; registerLookup({ registerTool(name, definition, handler) { tools[name] = { definition, handler }; } }, db);
  const args = tools.lookup.definition.inputSchema.parse({ mode: 'notes', service_id: 'fixture', note_scope: 'verification' });
  assert.equal(JSON.parse((await tools.lookup.handler(args)).content[0].text).notes[0].id, note.id);
  // ask v1 adds ask_log (+ sqlite_sequence for its AUTOINCREMENT); still no scoring/stats tables.
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name).filter(n => !['ask_log','sqlite_sequence'].includes(n)), ['agent_note_results','agent_notes','services']);
  db.close();
});

// ── Claude review 2026-10-20 follow-ups (items 1, 2, 5) ─────────────────────
import { setHidden, countToday, notesWritesEnabled } from '../dist/notes/store.js';

function legacyDb() {
  // Shape of production before this commit: agent_notes/agent_note_results without `hidden`.
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec("CREATE TABLE services (id TEXT PRIMARY KEY); INSERT INTO services VALUES ('fixture'), ('other');");
  db.exec(`
    CREATE TABLE agent_notes (
      id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id),
      request_id TEXT NOT NULL UNIQUE, session_hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL, runtime TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'field' CHECK(scope IN ('field','verification')),
      task TEXT NOT NULL, symptom TEXT NOT NULL, procedure TEXT NOT NULL,
      conditions TEXT NOT NULL, evidence TEXT NOT NULL,
      observation_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unverified' CHECK(status = 'unverified'),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_agent_notes_service ON agent_notes(service_id, created_at DESC);
    CREATE TABLE agent_note_results (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES agent_notes(id),
      request_id TEXT NOT NULL UNIQUE, session_hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL, runtime TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed','not_applicable')),
      conditions TEXT NOT NULL, evidence TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(note_id, session_hash)
    );
    CREATE INDEX idx_note_results_note ON agent_note_results(note_id);
    INSERT INTO agent_notes (id,service_id,request_id,session_hash,payload_hash,runtime,task,symptom,procedure,conditions,evidence,observation_kind)
      VALUES ('11111111-1111-4111-8111-111111111111','fixture','r1','s1','p1','codex','old task','old symptom','old procedure','old cond','old evidence','execution');
    INSERT INTO agent_note_results (id,note_id,request_id,session_hash,payload_hash,runtime,outcome,conditions,evidence)
      VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','r2','s2','p2','codex','succeeded','c','e');
  `);
  return db;
}
const cols = (db, t) => db.pragma(`table_info(${t})`).map(c => c.name);

test('existing DB without hidden: column added, rows kept, second start is a no-op', () => {
  const db = legacyDb();
  assert.ok(!cols(db, 'agent_notes').includes('hidden'));
  assert.ok(!cols(db, 'agent_note_results').includes('hidden'));
  ensureNotesSchema(db);
  assert.ok(cols(db, 'agent_notes').includes('hidden'));
  assert.ok(cols(db, 'agent_note_results').includes('hidden'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_notes').get().n, 1);
  assert.equal(db.prepare('SELECT hidden FROM agent_notes').get().hidden, 0);
  assert.equal(getNote(db, '11111111-1111-4111-8111-111111111111').counts.succeeded, 1);
  const schemaBefore = JSON.stringify(db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all());
  const changesBefore = db.prepare('SELECT total_changes() AS n').get().n;
  ensureNotesSchema(db);
  assert.equal(JSON.stringify(db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()), schemaBefore);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changesBefore);
  db.close();
});

test('global daily cap: note N+1 and result M+1 answer 429 daily_limit (HTTP and MCP)', async () => {
  const db = setup(); const app = express(); app.use(express.json()); const handlers = createNotesHandlers(db);
  app.post('/api/v1/notes', handlers.create); app.post('/api/v1/notes/:id/results', handlers.result);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  process.env.NOTES_DAILY_NOTE_LIMIT = '3'; process.env.NOTES_DAILY_RESULT_LIMIT = '2';
  try {
    let note;
    for (let i = 0; i < 3; i++) { const r = await post('/notes', input()); assert.equal(r.status, 200); note = (await r.json()).note; }
    assert.equal(countToday(db, 'agent_notes'), 3);
    const over = await post('/notes', input());
    assert.equal(over.status, 429); assert.deepEqual(await over.json(), { error: 'daily_limit' });
    assert.equal(db.prepare('SELECT count(*) AS n FROM agent_notes').get().n, 3);
    for (let i = 0; i < 2; i++) assert.equal((await post(`/notes/${note.id}/results`, result(note))).status, 200);
    const overR = await post(`/notes/${note.id}/results`, result(note));
    assert.equal(overR.status, 429); assert.deepEqual(await overR.json(), { error: 'daily_limit' });
    // MCP report shares the cap
    const tools = {}; registerReport({ registerTool(n, d, h) { tools[n] = { d, h }; } }, db);
    const mcp = await tools.report.h(tools.report.d.inputSchema.parse({ mode: 'note', note: input() }));
    assert.equal(mcp.isError, true); assert.deepEqual(JSON.parse(mcp.content[0].text), { error: 'daily_limit' });
  } finally { delete process.env.NOTES_DAILY_NOTE_LIMIT; delete process.env.NOTES_DAILY_RESULT_LIMIT; await new Promise(r => server.close(r)); db.close(); }
});

test('NOTES_WRITES_ENABLED=false: writes 503 (HTTP) / error (MCP), reads 200; default enabled', async () => {
  const db = setup(); const { note } = recordNote(db, input());
  const app = express(); app.use(express.json()); const handlers = createNotesHandlers(db);
  app.get('/api/v1/notes', handlers.list); app.get('/api/v1/notes/:id', handlers.detail);
  app.post('/api/v1/notes', handlers.create); app.post('/api/v1/notes/:id/results', handlers.result);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal(notesWritesEnabled(), true);
    process.env.NOTES_WRITES_ENABLED = 'false';
    assert.equal(notesWritesEnabled(), false);
    const w = await post('/notes', input()); assert.equal(w.status, 503); assert.deepEqual(await w.json(), { error: 'notes_writes_disabled' });
    const wr = await post(`/notes/${note.id}/results`, result(note)); assert.equal(wr.status, 503);
    assert.equal((await fetch(base + '/notes?service_id=fixture')).status, 200);
    assert.equal((await fetch(base + `/notes/${note.id}`)).status, 200);
    const tools = {}; registerReport({ registerTool(n, d, h) { tools[n] = { d, h }; } }, db); registerLookup({ registerTool(n, d, h) { tools[n] = { d, h }; } }, db);
    const mcp = await tools.report.h(tools.report.d.inputSchema.parse({ mode: 'note', note: input() }));
    assert.deepEqual(JSON.parse(mcp.content[0].text), { error: 'notes_writes_disabled' });
    const read = await tools.lookup.h(tools.lookup.d.inputSchema.parse({ mode: 'notes', service_id: 'fixture' }));
    assert.equal(JSON.parse(read.content[0].text).notes.length, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM agent_notes').get().n, 1);
    process.env.NOTES_WRITES_ENABLED = 'true';
    assert.equal((await post('/notes', input())).status, 200);
  } finally { delete process.env.NOTES_WRITES_ENABLED; await new Promise(r => server.close(r)); db.close(); }
});

test('hidden rows leave list, detail, counts and MCP lookup; nothing is deleted; restore works', async () => {
  const db = setup();
  const { note: a } = recordNote(db, input({ task: 'alpha' }));
  const { note: b } = recordNote(db, input({ task: 'beta' }));
  const r1 = recordResult(db, result(b)).results[0];
  recordResult(db, result(b));
  assert.equal(getNote(db, b.id).counts.total, 2);
  setHidden(db, { kind: 'result', id: r1.id });
  assert.equal(getNote(db, b.id).counts.total, 1);
  assert.equal(getNote(db, b.id).results.length, 1);
  assert.equal(findNotes(db, { service_id: 'fixture', q: 'beta' }).notes[0].reuse.counts.total, 1);
  setHidden(db, { kind: 'note', id: a.id });
  assert.equal(findNotes(db, { service_id: 'fixture' }).notes.length, 1);
  assert.equal(findNotes(db, { service_id: 'fixture', q: 'alpha' }).notes.length, 0);
  assert.throws(() => getNote(db, a.id), /note_not_found/);
  assert.throws(() => recordResult(db, result(a)), /note_not_found/);
  const tools = {}; registerLookup({ registerTool(n, d, h) { tools[n] = { d, h }; } }, db);
  const found = JSON.parse((await tools.lookup.h(tools.lookup.d.inputSchema.parse({ mode: 'notes', service_id: 'fixture' }))).content[0].text);
  assert.deepEqual(found.notes.map(n => n.id), [b.id]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_notes').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_note_results').get().n, 2);
  assert.throws(() => setHidden(db, { kind: 'note', id: randomUUID() }), /note_not_found/);
  assert.throws(() => setHidden(db, { kind: 'note', id: a.id, extra: 1 }));
  setHidden(db, { kind: 'note', id: a.id, hidden: false });
  assert.equal(findNotes(db, { service_id: 'fixture' }).notes.length, 2);
  // HTTP: hide handler sets hidden; the admin secret check lives in http-server.ts
  const app = express(); app.use(express.json()); const handlers = createNotesHandlers(db);
  app.post('/admin/notes/hide', handlers.hide); app.get('/api/v1/notes/:id', handlers.detail);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const h = await fetch(base + '/admin/notes/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'note', id: a.id }) });
    assert.equal(h.status, 200); assert.deepEqual(await h.json(), { kind: 'note', id: a.id, hidden: true });
    assert.equal((await fetch(base + `/api/v1/notes/${a.id}`)).status, 404);
  } finally { await new Promise(r => server.close(r)); db.close(); }
});
