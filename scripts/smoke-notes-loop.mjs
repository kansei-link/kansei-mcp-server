import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import express from 'express';
import { createNotesHandlers } from '../dist/notes/routes.js';
const dir = mkdtempSync(join(tmpdir(), 'agent-notes-loop-'));
const file = join(dir, 'fixture.sqlite');
let db = new Database(file);
db.pragma('foreign_keys=ON');
db.exec("CREATE TABLE services(id TEXT PRIMARY KEY); INSERT INTO services VALUES ('loop-fixture');");
const app = express(); app.use(express.json()); const handlers = createNotesHandlers(db);
app.get('/api/v1/notes', handlers.list); app.get('/api/v1/notes/:id', handlers.detail);
app.post('/api/v1/notes', handlers.writes, handlers.create); app.post('/api/v1/notes/:id/results', handlers.writes, handlers.result);
app.get('/fixture', (req, res) => req.get('x-fixture-protocol') === '2'
  ? res.json({ status: 'ok' }) : res.status(400).json({ error: 'protocol_header_missing', required_headers: { 'x-fixture-protocol': '2' } }));
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = promisify(execFile);
  const a = JSON.parse((await run(process.execPath, ['scripts/smoke-notes-worker.mjs', 'writer', base])).stdout);
  const b = JSON.parse((await run(process.execPath, ['scripts/smoke-notes-worker.mjs', 'reader', base])).stdout);
  assert.notEqual(a.process_id, b.process_id); assert.equal(a.note_id, b.note_id);
  await new Promise(r => server.close(r)); db.close();
  db = new Database(file);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_notes').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM agent_note_results').get().n, 1);
  console.log(JSON.stringify({ test: 'controlled_fixture_two_process_loop', production_data: false, autonomous_agents: false, a, b, persisted_after_reopen: true }, null, 2));
} finally {
  if (server.listening) await new Promise(r => server.close(r));
  if (db.open) db.close();
  assert.equal(dirname(resolve(dir)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.ok(basename(dir).startsWith('agent-notes-loop-'));
  rmSync(dir, { recursive: true, force: true });
}
