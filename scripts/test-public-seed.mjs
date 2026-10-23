import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { initializeDb } from '../dist/db/schema.js';
import { seedDatabase, seedSourceFor } from '../dist/db/seed.js';
import { searchServices } from '../dist/tools/search-services.js';
import { notFoundHint } from '../dist/utils/not-found-hint.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { register as registerLookup } from '../dist/tools/lookup.js';

// Disclosure stage 1: an npm install has only src/data/public/*. These tests force that view with
// KANSEI_SEED_PUBLIC_ONLY=1 and check the tools still work on it. In-memory DBs only.

const PUB = new URL('../src/data/public/', import.meta.url);

test('the public copy exists, is current with the full seed, and carries no internal scores', () => {
  for (const f of ['services.json', 'recipes.json', 'api-guides.json', 'changelog.json', 'meta.json']) assert.ok(existsSync(new URL(f, PUB)), f);
  const pub = JSON.parse(readFileSync(new URL('services.json', PUB), 'utf8'));
  const full = JSON.parse(readFileSync(new URL('../src/data/services-seed.json', import.meta.url), 'utf8'));
  const live = full.filter((s) => !s.archived);
  assert.equal(pub.length, live.length, 'public copy must be regenerated (npm run data:public) when the seed changes');
  const keys = new Set(pub.flatMap((r) => Object.keys(r)));
  for (const k of ['trust_score', 'axr_score', 'axr_dims', 'axr_facade', 'description']) assert.ok(!keys.has(k), `${k} must not ship`);
  for (const r of pub.slice(0, 200)) assert.ok((r.summary ?? '').length <= 161, `summary too long for ${r.id}`);
  const meta = JSON.parse(readFileSync(new URL('meta.json', PUB), 'utf8'));
  assert.equal(meta.shipped_counts.services, pub.length);
  assert.ok(meta.not_included.some((x) => /voices/.test(x)));
});

test('seedSourceFor prefers the full seed in the repo and the public copy when forced', () => {
  delete process.env.KANSEI_SEED_PUBLIC_ONLY;
  assert.equal(seedSourceFor('services-seed.json').layer, 'full');
  process.env.KANSEI_SEED_PUBLIC_ONLY = '1';
  try {
    assert.equal(seedSourceFor('services-seed.json').layer, 'public');
    assert.equal(seedSourceFor('recipes-seed.json').layer, 'public');
    assert.equal(seedSourceFor('api-guides-seed.json').layer, 'public');
    assert.equal(seedSourceFor('changelog-seed.json').layer, 'public');
    assert.equal(seedSourceFor('voices-seed.json'), null, 'nothing public for voices');
  } finally { delete process.env.KANSEI_SEED_PUBLIC_ONLY; }
});

test('a DB seeded from the public copy only: search, named lookup and recipes work', () => {
  process.env.KANSEI_SEED_PUBLIC_ONLY = '1';
  const db = new Database(':memory:');
  try {
    initializeDb(db);
    seedDatabase(db);
    const n = db.prepare('SELECT count(*) AS n FROM services').get().n;
    assert.ok(n > 9000, `services seeded: ${n}`);
    assert.equal(db.prepare('SELECT count(*) AS n FROM recipes').get().n, 200);
    assert.ok(db.prepare('SELECT count(*) AS n FROM service_api_guides').get().n >= 190);
    const freee = db.prepare('SELECT trust_score, axr_score, axr_grade, description FROM services WHERE id = ?').get('freee');
    assert.equal(freee.trust_score, 0.5, 'no internal score shipped → column default');
    assert.equal(freee.axr_score, null);
    assert.equal(freee.axr_grade, 'AAA', 'the public grade (result) is kept');
    assert.ok(freee.description.length <= 161);
    const ids = searchServices(db, 'freee で請求書を作る', undefined, 5).map((r) => r.service_id);
    assert.equal(ids[0], 'freee', `named search still finds freee first: ${ids}`);
    const jp = searchServices(db, '勤怠管理', undefined, 10).map((r) => r.service_id);
    assert.ok(jp.some((id) => ['kingoftime', 'jobcan', 'teamspirit'].includes(id)), `intent search works on the public copy: ${jp}`);
  } finally { db.close(); delete process.env.KANSEI_SEED_PUBLIC_ONLY; }
});

test('a lookup miss points to the public card and to ask (no new route)', () => {
  const h = notFoundHint('some-missing-service');
  assert.match(h.error, /^Service 'some-missing-service' not found\./);
  assert.equal(h.see, 'https://kansei-link.com/services/some-missing-service/');
  assert.match(h.ask, /^https:\/\/kansei-link\.com\/api\/v1\/ask/);
  const bad = notFoundHint('<script>alert(1)</script>');
  assert.equal(bad.see, undefined, 'an id that is not an id gets no URL built from it');
  assert.match(bad.hint, /lowercase/);
});

test('lookup tool on a miss returns the hint (no FOREIGN KEY failure from the attempt handle)', async () => {
  process.env.KANSEI_SEED_PUBLIC_ONLY = '1';
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const server = new McpServer({ name: 't', version: '0' });
  const client = new Client({ name: 'tc', version: '0' });
  try {
    initializeDb(db); seedDatabase(db);
    registerLookup(server, db);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: 'lookup', arguments: { service_id: 'no-such-service-xyz' } });
    const text = r.content[0].text;
    assert.ok(!r.isError, text.slice(0, 200));
    const j = JSON.parse(text);
    assert.match(j.error, /not found/);
    assert.equal(j.see, 'https://kansei-link.com/services/no-such-service-xyz/');
    assert.match(j.ask, /\/api\/v1\/ask/);
    const row = db.prepare('SELECT service_id FROM execution_attempts ORDER BY issued_at DESC LIMIT 1').get();
    assert.equal(row.service_id, null, 'attempt handle stored without a link to a missing service');
    const ok = JSON.parse((await client.callTool({ name: 'lookup', arguments: { service_id: 'freee' } })).content[0].text);
    assert.equal(ok.service_id, 'freee');
  } finally { await client.close().catch(() => {}); await server.close().catch(() => {}); db.close(); delete process.env.KANSEI_SEED_PUBLIC_ONLY; }
});
