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
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name), ['agent_note_results','agent_notes','services']);
  db.close();
});
