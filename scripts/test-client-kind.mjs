import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { classifyClient, compileClientKinds, clientKinds } from '../dist/utils/client-kind.js';
import { ensureUsageLogSchema, usageSummary, recordUsage } from '../dist/mcp-usage-log.js';
import { adminActivity } from '../dist/admin/activity.js';
import { ensureNotesSchema } from '../dist/notes/store.js';
import { ensureAskSchema, resetDailyCapForTests } from '../dist/ask/engine.js';

// Probe / agent split of the /mcp usage summary (2026-10-24). In-memory DBs only.

// The top 20 clientInfo names seen on production between the 1.3.0 Registry listing and 00:25 JST
// on 2026-10-24 (50 of 65 initializes), with their counts.
const OBSERVED = [
  ['mcpbeat', '0.1', 11], ['glama', '1.0.0', 7], ['smartbench-quality-probe', '1.0', 4], ['talaria-catalog', '1', 4],
  ['agentrank-probe', '0.1', 3], ['verifymcp-probe', '1', 3], ['AgentToolIndex', '1.0', 2], ['agent-collector', '0.1', 2],
  ['codexguild-catalog-review', '1.0.0', 2], ['moonglade-shadows', '1', 2], ['ElectraIndexBot', '1.0', 1],
  ['InvokeRankBot', '0.1.0', 1], ['MCP-Marketplace-Scanner', '1.0.0', 1], ['agentprobe', '0.1', 1],
  ['alphaproxy-probe', '1.0', 1], ['anlyon.dev-indexer', '0.1.0', 1], ['eda-claw-runtime-probe', '1', 1],
  ['every-mcp-probe', '1.0.0', 1], ['factanker-probe', '1.0', 1], ['heldfast', '0.2.3', 1],
];

test('the shipped list: every observed name is sorted, and only confirmed clients are agents', () => {
  const k = clientKinds();
  const unknown = OBSERVED.filter(([n]) => classifyClient(n, k) !== 'probe').map(([n]) => n);
  assert.deepEqual(unknown, ['moonglade-shadows', 'heldfast'], 'two names give no hint of what they are: stay unknown');
  assert.equal(classifyClient('claude-code', k), 'agent');
  assert.equal(classifyClient('codex-mcp-client', k), 'agent');
  assert.equal(classifyClient('Claude-Code', k), 'agent', 'case-insensitive');
  for (const n of ['cursor', 'Visual Studio Code', 'claude-ai', 'windsurf']) assert.equal(classifyClient(n, k), 'unknown', `${n}: not confirmed, so not an agent`);
  const file = JSON.parse(readFileSync(new URL('../src/data/mcp-client-kinds.json', import.meta.url), 'utf8'));
  for (const a of file.agent.names) assert.ok(typeof a.confirmed === 'string' && a.confirmed.length > 20, `${a.name} needs a confirmed note`);
});

test('order: agent names beat probe patterns; other / empty / non-string are unknown', () => {
  const k = compileClientKinds({ agent: { names: [{ name: 'helpbot-desktop' }] }, probe: { names: [{ name: 'x-scan' }], patterns: ['bot', 'scan'] } });
  assert.equal(classifyClient('helpbot-desktop', k), 'agent');
  assert.equal(classifyClient('otherbot', k), 'probe');
  assert.equal(classifyClient('X-SCAN', k), 'probe');
  assert.equal(classifyClient('other', k), 'unknown');
  assert.equal(classifyClient('', k), 'unknown');
  assert.equal(classifyClient(null, k), 'unknown');
  assert.equal(classifyClient(42, k), 'unknown');
  const broken = compileClientKinds({ probe: { patterns: ['(unclosed'] } });
  assert.equal(classifyClient('anything-probe', broken), 'unknown', 'a broken pattern disables patterns instead of matching everything');
});

function seeded() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE services (id TEXT PRIMARY KEY, api_url TEXT); CREATE TABLE service_api_guides (service_id TEXT, docs_url TEXT);`);
  ensureUsageLogSchema(db);
  const ctx = { uaClass: 'unknown', serverVersion: '1.3.0' };
  const init = (name, version) => ({ rpcId: 1, kind: 'initialize', tool: null, service_id: null, service_unknown: 0, mode: null, client_name: name, client_version: version });
  for (const [name, v, n] of OBSERVED) for (let i = 0; i < n; i++) recordUsage(db, init(name, v), 'ok', ctx);
  for (let i = 0; i < 2; i++) recordUsage(db, init('claude-code', '2.1.301'), 'ok', ctx);
  recordUsage(db, init('other', null), 'ok', ctx);
  // 21 more distinct probes so the full split must look beyond the top-20 by_client
  for (let i = 0; i < 21; i++) recordUsage(db, init(`tail-probe-${i}`, '1'), 'ok', ctx);
  recordUsage(db, { rpcId: 2, kind: 'tools_call', tool: 'lookup', service_id: null, service_unknown: 0, mode: 'tips', client_name: null, client_version: null }, 'ok', ctx);
  return db;
}

test('usageSummary: by_client_kind over every client, probe-free counts and list', () => {
  delete process.env.USAGE_LOG_ENABLED;
  const db = seeded();
  const u = usageSummary(db, 7);
  assert.equal(u.initializes, 50 + 2 + 1 + 21);
  assert.equal(u.by_client.length, 20, 'the existing top-20 field is unchanged');
  assert.deepEqual(u.by_client_kind, {
    probe: { initializes: 47 + 21, clients: 18 + 21 },
    agent: { initializes: 2, clients: 1 },
    unknown: { initializes: 3 + 1, clients: 3 },
  });
  assert.equal(u.initializes_excluding_probes, 2 + 4);
  assert.deepEqual(u.clients_excluding_probes.map((c) => [c.client_name, c.kind, c.n]), [
    ['claude-code', 'agent', 2], ['moonglade-shadows', 'unknown', 2], ['heldfast', 'unknown', 1], ['other', 'unknown', 1],
  ]);
  assert.equal(u.calls, 1, 'tools_call rows are untouched (no client on them)');
  db.close();
});

test('/admin/activity carries the split', () => {
  const db = seeded();
  db.pragma('foreign_keys=ON');
  ensureNotesSchema(db); ensureAskSchema(db); resetDailyCapForTests();
  const a = adminActivity(db).mcp_usage;
  assert.equal(a.by_client_kind.probe.initializes, 68);
  assert.equal(a.initializes_excluding_probes, 6);
  assert.ok(Array.isArray(a.clients_excluding_probes));
  db.close();
});
