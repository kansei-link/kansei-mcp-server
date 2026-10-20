// Controlled HTTP fixture, NOT an autonomous LLM experiment or production review.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const [mode, base] = process.argv.slice(2);
const post = async (path, body) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200); return response.json();
};
const common = { service_id: 'loop-fixture', request_id: randomUUID(), session_id: randomUUID(), share: true, runtime: 'other' };
if (mode === 'writer') {
  const failed = await fetch(base + '/fixture'); assert.equal(failed.status, 400);
  const { required_headers } = await failed.json();
  const passed = await fetch(base + '/fixture', { headers: required_headers }); assert.equal(passed.status, 200);
  const created = await post('/api/v1/notes', { ...common, task: 'Read controlled local fixture', symptom: 'Protocol header missing',
    procedure: JSON.stringify(required_headers), conditions: 'Controlled loop fixture v2; no external SaaS',
    evidence: 'HTTP 400 before header; HTTP 200 with required header', observation_kind: 'execution' });
  console.log(JSON.stringify({ actor: 'A', process_id: process.pid, observed_failure: 400, observed_success: 200, note_id: created.note.id }));
} else {
  // A fresh process receives only the service location, not the writer's state.
  const without = await fetch(base + '/fixture'); assert.equal(without.status, 400);
  const response = await fetch(base + '/api/v1/notes?service_id=loop-fixture&q=protocol');
  const { notes } = await response.json(); assert.equal(notes.length, 1);
  // Fixture-only JSON header instruction. General user notes are never executed as code.
  const headers = JSON.parse(notes[0].procedure);
  const withNote = await fetch(base + '/fixture', { headers }); assert.equal(withNote.status, 200);
  const outcome = await post(`/api/v1/notes/${notes[0].id}/results`, { ...common, outcome: 'succeeded',
    conditions: 'Fresh process; local fixture v2', evidence: 'HTTP 400 without note; HTTP 200 after applying stored header' });
  assert.equal(outcome.results[0].same_session, 0);
  console.log(JSON.stringify({ actor: 'B', process_id: process.pid, without_note: 400, with_note: 200, note_id: notes[0].id, recorded_reuse: outcome.counts.succeeded }));
}
