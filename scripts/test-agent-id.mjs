import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import Database from 'better-sqlite3';
import { initializeDb } from '../dist/db/schema.js';
import { reportOutcome } from '../dist/tools/report-outcome.js';
import { agentIdHash, installMaterial, uuidMaterial, sessionMaterial, outcomeAgentMaterial, ANONYMOUS_AGENT } from '../dist/agent-id.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { register as registerReport } from '../dist/tools/report-unified.js';

// Test DBs only (in-memory). Never the production DB.

const SALT = 'test-salt-0123456789abcdef';
const S1 = '0b1f3c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const S2 = '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4';

function setup() {
  const db = new Database(':memory:');
  initializeDb(db);
  db.prepare(`INSERT INTO services (id, name, category) VALUES ('svc-a', 'Service A', 'test')`).run();
  return db;
}
const hashes = (db) => db.prepare(`SELECT agent_id_hash AS h FROM outcomes ORDER BY id`).all().map((r) => r.h);
const uniqueAgents = (db) => db.prepare(`SELECT unique_agents AS n FROM service_stats WHERE service_id = 'svc-a'`).get().n;

beforeEach(() => { process.env.AGENT_HASH_SALT = SALT; });

test('same material → same hash; different material → different hash', () => {
  const db = setup();
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S1 });
  reportOutcome(db, { service_id: 'svc-a', success: false, agent_material: S1 });
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S2 });
  const [a, b, c] = hashes(db);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a, agentIdHash(S1));
});

test('unique_agents counts distinct callers (was always 0)', () => {
  const db = setup();
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S1 });
  assert.equal(uniqueAgents(db), 1);
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S1 });
  assert.equal(uniqueAgents(db), 1);
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S2 });
  assert.equal(uniqueAgents(db), 2);
  reportOutcome(db, { service_id: 'svc-a', success: true });
  assert.equal(uniqueAgents(db), 2, 'a report with no material stays anonymous and is not counted');
});

test('no salt (or a short one) → anonymous, as before', () => {
  delete process.env.AGENT_HASH_SALT;
  const db = setup();
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S1 });
  process.env.AGENT_HASH_SALT = 'short';
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S1 });
  assert.deepEqual(hashes(db), [ANONYMOUS_AGENT, ANONYMOUS_AGENT]);
  assert.equal(uniqueAgents(db), 0);
});

test('the raw material is stored nowhere in the DB', () => {
  const db = setup();
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: S1, context: 'ok' });
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
  for (const t of tables) {
    for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
      const text = JSON.stringify(row);
      assert.ok(!text.includes(S1), `raw session id found in ${t}`);
      assert.ok(!text.includes(SALT), `salt found in ${t}`);
    }
  }
});

test('the salt changes the hash (no cross-deployment linkage)', () => {
  const h1 = agentIdHash(S1);
  process.env.AGENT_HASH_SALT = 'another-salt-0123456789';
  assert.notEqual(agentIdHash(S1), h1);
});

test('stdio install id: created once, stable, and only its hash reaches outcomes', () => {
  const db = setup();
  const a = installMaterial(db);
  const b = installMaterial(db);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);
  reportOutcome(db, { service_id: 'svc-a', success: true, agent_material: a });
  assert.equal(hashes(db)[0], agentIdHash(a));
  assert.equal(db.prepare(`SELECT count(*) AS n FROM outcomes WHERE agent_id_hash = ?`).get(a).n, 0);
});

test('material filters: body session_id must be a UUID; Mcp-Session-Id must be visible ASCII', () => {
  assert.equal(uuidMaterial(S1.toUpperCase()), S1);
  for (const bad of ['', 'abc', '1.2.3.4', 'Mozilla/5.0', 42, null, undefined]) assert.equal(uuidMaterial(bad), null);
  assert.equal(sessionMaterial('sess_ABCdef12'), 'sess_ABCdef12');
  assert.equal(sessionMaterial(['sess_ABCdef12', 'x']), 'sess_ABCdef12');
  for (const bad of ['short', 'has space inside', 'x'.repeat(201), undefined, 7]) assert.equal(sessionMaterial(bad), null);
});

test('material order: Mcp-Session-Id → report session_id (UUID) → stdio install id → none', () => {
  const INSTALL = 'install-id-0000';
  assert.equal(outcomeAgentMaterial({ transportSessionId: 'sess_transport1', sessionHeader: 'sess_header01', argSessionId: S1, installMaterial: INSTALL }), 'sess_transport1');
  assert.equal(outcomeAgentMaterial({ sessionHeader: 'sess_header01', argSessionId: S1, installMaterial: INSTALL }), 'sess_header01');
  assert.equal(outcomeAgentMaterial({ argSessionId: S1.toUpperCase(), installMaterial: INSTALL }), S1);
  assert.equal(outcomeAgentMaterial({ argSessionId: 'not-a-uuid', installMaterial: INSTALL }), INSTALL, 'a non-UUID session_id is ignored');
  assert.equal(outcomeAgentMaterial({ argSessionId: 'not-a-uuid' }), null);
  assert.equal(outcomeAgentMaterial({}), null);
});

async function reportClient(db, options = {}) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerReport(server, db, options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('report tool (stateless HTTP-like, no Mcp-Session-Id): session_id makes the same task one agent', async () => {
  const db = setup();
  const { client, close } = await reportClient(db);
  try {
    await client.callTool({ name: 'report', arguments: { mode: 'outcome', service_id: 'svc-a', success: true, session_id: S1 } });
    await client.callTool({ name: 'report', arguments: { mode: 'outcome', service_id: 'svc-a', success: false, session_id: S1 } });
    await client.callTool({ name: 'report', arguments: { mode: 'outcome', service_id: 'svc-a', success: true, session_id: S2 } });
    await client.callTool({ name: 'report', arguments: { mode: 'outcome', service_id: 'svc-a', success: true, session_id: 'not-a-uuid' } });
    await client.callTool({ name: 'report', arguments: { mode: 'outcome', service_id: 'svc-a', success: true } });
    const h = hashes(db);
    assert.equal(h.length, 5);
    assert.equal(h[0], agentIdHash(S1)); assert.equal(h[0], h[1]); assert.equal(h[2], agentIdHash(S2));
    assert.equal(h[3], ANONYMOUS_AGENT, 'non-UUID session_id → anonymous');
    assert.equal(h[4], ANONYMOUS_AGENT, 'no session_id → anonymous');
    const dump = JSON.stringify(db.prepare('SELECT * FROM outcomes').all());
    assert.ok(!dump.includes(S1) && !dump.includes(S2), 'the raw session_id is stored nowhere');
    const tools = await client.listTools();
    assert.match(tools.tools.find((t) => t.name === 'report').inputSchema.properties.session_id.description, /UUID/);
  } finally { await close(); db.close(); }
});

test('report tool (stdio): an explicit session_id outranks the install id; without it the install id is used', async () => {
  const db = setup();
  const INSTALL = installMaterial(db);
  const { client, close } = await reportClient(db, { installMaterial: INSTALL });
  try {
    await client.callTool({ name: 'report', arguments: { mode: 'outcome', service_id: 'svc-a', success: true, session_id: S1 } });
    await client.callTool({ name: 'report', arguments: { mode: 'outcome', service_id: 'svc-a', success: true } });
    const [a, b] = hashes(db);
    assert.equal(a, agentIdHash(S1));
    assert.equal(b, agentIdHash(INSTALL));
  } finally { await close(); db.close(); }
});
