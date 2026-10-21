import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { adminActivity, ACTIVITY_ALERTS } from '../dist/admin/activity.js';
import { ensureNotesSchema, recordNote, recordResult } from '../dist/notes/store.js';
import { ensureAskSchema, ask, resetDailyCapForTests, ASK_POST_MAX } from '../dist/ask/engine.js';

// Test DBs only (in-memory or a temp file). Never the production DB.

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE services (id TEXT PRIMARY KEY, api_url TEXT);
    INSERT INTO services VALUES ('fixture', NULL), ('other', NULL), ('freee', NULL);
    CREATE TABLE service_api_guides (service_id TEXT, docs_url TEXT);`);
  ensureNotesSchema(db); ensureAskSchema(db);
  resetDailyCapForTests();
  return db;
}
const note = (service_id = 'fixture', o = {}) => ({ service_id, request_id: randomUUID(), session_id: randomUUID(), share: true,
  runtime: 'codex', task: 'Read fixture', symptom: 'Protocol version missing', procedure: 'Set header to 2',
  conditions: 'Local fixture', evidence: '400 then 200', observation_kind: 'execution', ...o });
const result = (n, o = {}) => ({ service_id: n.service_id, note_id: n.id, request_id: randomUUID(), session_id: randomUUID(),
  share: true, runtime: 'codex', outcome: 'succeeded', conditions: 'Local fixture', evidence: 'HTTP 200', ...o });

test('quiet store: shape is stable and there are no alerts', () => {
  const a = adminActivity(setup());
  assert.equal(a.schema, 'kansei-admin-activity/v1');
  assert.deepEqual(a.alerts, []);
  assert.deepEqual(a.notes.last_24h, { notes: 0, results: 0 });
  assert.deepEqual(a.notes.by_status, { unverified: 0, verified: 0, lived: 0, hidden: 0 });
  assert.equal(a.notes.daily_cap.notes.limit, 200);
  assert.equal(a.notes.daily_cap.results.limit, 1000);
  assert.equal(a.ask.daily_cap.limit, 5000);
  assert.equal(typeof a.notes.writes_enabled, 'boolean');
  assert.equal(typeof a.ask.log_enabled, 'boolean');
  assert.ok(a.generated_at);
});

test('counts, hidden notes lose their body, latest is capped at 20 and bodies at 200 chars', () => {
  const db = setup();
  const long = 'word '.repeat(60).trim(); // spaced, so the store's opaque-token mask leaves it alone
  const first = recordNote(db, note('fixture', { symptom: long })).note;
  for (let i = 0; i < 21; i++) recordNote(db, note('other'));
  recordResult(db, result(first));
  db.prepare('UPDATE agent_notes SET hidden = 1 WHERE id = ?').run(first.id);
  // make the long note the newest so it is in the latest list
  db.prepare("UPDATE agent_notes SET created_at = datetime('now', '+1 minute') WHERE id = ?").run(first.id);
  const a = adminActivity(db);
  assert.deepEqual(a.notes.last_24h, { notes: 22, results: 1 });
  assert.equal(a.notes.by_status.unverified, 21);
  assert.equal(a.notes.by_status.hidden, 1);
  assert.equal(a.notes.latest.length, 20);
  assert.equal(a.notes.latest[0].id, first.id);
  assert.equal(a.notes.latest[0].hidden, true);
  assert.equal(a.notes.latest[0].body, null);
  db.prepare('UPDATE agent_notes SET hidden = 0 WHERE id = ?').run(first.id);
  const b = adminActivity(db).notes.latest[0];
  assert.equal(b.body.length, 201); // 200 chars + ellipsis
});

test('alerts: writes per hour, same service per hour, notes daily cap share', () => {
  const db = setup();
  // 11 notes for one service in the last hour → same-service alert (> 10), not yet the 20/hour alert
  for (let i = 0; i < 11; i++) recordNote(db, note('fixture'));
  let a = adminActivity(db);
  assert.ok(a.alerts.some((x) => x.startsWith('service fixture: 11 writes')), a.alerts.join(' | '));
  assert.ok(!a.alerts.some((x) => x.startsWith('writes in the last hour')));
  // 10 more on another service → 21 writes in the hour (> 20)
  for (let i = 0; i < 10; i++) recordNote(db, note('other'));
  a = adminActivity(db);
  assert.ok(a.alerts.some((x) => x.startsWith('writes in the last hour: 21')), a.alerts.join(' | '));
  assert.ok(!a.alerts.some((x) => x.startsWith('notes daily cap')));
  // lower the cap so 21 notes today is over half of it
  process.env.NOTES_DAILY_NOTE_LIMIT = '40';
  try {
    a = adminActivity(db);
    assert.ok(a.alerts.some((x) => x.startsWith('notes daily cap: 21/40')), a.alerts.join(' | '));
    assert.equal(a.notes.daily_cap.notes.ratio, 0.525);
  } finally { delete process.env.NOTES_DAILY_NOTE_LIMIT; }
  // writes older than an hour no longer count toward the hourly alerts
  db.exec("UPDATE agent_notes SET created_at = datetime('now', '-2 hours')");
  a = adminActivity(db);
  assert.ok(!a.alerts.some((x) => x.startsWith('writes in the last hour') || x.startsWith('service ')), a.alerts.join(' | '));
  assert.equal(a.notes.last_24h.notes, 21);
});

test('alerts: ask daily cap share; ask counts and top unmatched come from ask_log', () => {
  const db = setup();
  process.env.ASK_DAILY_CAP = '4';
  try {
    const o = { uaClass: 'unknown', maxErrorLength: ASK_POST_MAX };
    ask(db, { service: 'freee', error: 'HTTP 500 something odd happened upstream' }, o);
    ask(db, { service: 'freee', error: 'HTTP 500 something odd happened upstream' }, o);
    let a = adminActivity(db);
    assert.ok(!a.alerts.some((x) => x.startsWith('ask daily cap')), 'exactly half is not over half');
    ask(db, { service: 'freee', error: 'HTTP 502 bad gateway from the proxy' }, o);
    a = adminActivity(db);
    assert.ok(a.alerts.some((x) => x.startsWith('ask daily cap: 3/4')), a.alerts.join(' | '));
    assert.deepEqual(a.ask.last_24h, { asks: 3, matched: 0, unmatched: 3 });
    assert.equal(a.ask.top_unmatched_30d[0].service_id, 'freee');
    assert.equal(a.ask.top_unmatched_30d[0].asks, 2);
    const text = JSON.stringify(a);
    assert.ok(!text.includes('something odd'), 'question text never appears');
  } finally { delete process.env.ASK_DAILY_CAP; }
});

test('thresholds live in one constant', () => {
  assert.deepEqual(ACTIVITY_ALERTS, { writesPerHour: 20, dailyCapShare: 0.5, sameServicePerHour: 10 });
});

test('HTTP: /admin/activity needs the admin secret; with it the shape matches and nothing private leaks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kansei-activity-'));
  const port = 18900 + Math.floor(Math.random() * 500);
  const secret = `test-${randomUUID()}`;
  const child = spawn(process.execPath, ['dist/http-server.js'], {
    env: { ...process.env, PORT: String(port), KANSEI_HOST: '127.0.0.1', KANSEI_DB_PATH: join(dir, 'test.db'), CRAWLER_SECRET: secret, ASK_LOG_ENABLED: 'true' },
    stdio: 'ignore',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal((await fetch(`${base}/admin/activity`)).status, 401);
    assert.equal((await fetch(`${base}/admin/activity`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const r = await fetch(`${base}/admin/activity`, { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const body = await r.json();
    assert.equal(body.schema, 'kansei-admin-activity/v1');
    for (const k of ['notes', 'ask', 'alerts', 'generated_at']) assert.ok(k in body, k);
    const text = JSON.stringify(body).toLowerCase();
    for (const banned of ['"ip"', 'client_ip', 'user_agent', 'error_sha256', '"tokens"', secret.toLowerCase()]) {
      assert.ok(!text.includes(banned), `must not contain ${banned}`);
    }
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
