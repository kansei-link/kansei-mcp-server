import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { isVendorOfficial, hasRegistryShapedId } from '../dist/utils/vendor-official.js';

// Reads the committed seed only (no DB). The seed is what production upserts on startup.
const seed = JSON.parse(readFileSync(new URL('../src/data/services-seed.json', import.meta.url), 'utf8'));
const rows = Array.isArray(seed) ? seed : seed.services;
const byId = new Map(rows.map((r) => [r.id, r]));
const pages = JSON.parse(readFileSync(new URL('../src/data/mcp-ja-pages.json', import.meta.url), 'utf8'));

test('Misoca and LINE WORKS are vendor_official in the seed (confirmed 2026-10-22 on /mcp/ pages)', () => {
  for (const id of ['misoca', 'lineworks']) {
    const r = byId.get(id);
    assert.ok(r, `${id} in seed`);
    assert.equal(r.mcp_status, 'official', `${id} mcp_status`);
    assert.equal(hasRegistryShapedId(r), false, `${id} id is curated, not Registry-shaped`);
    assert.ok(isVendorOfficial(r), `${id} is vendor_official`);
  }
  assert.equal(byId.get('misoca').mcp_endpoint, 'https://mcp.misoca.jp/mcp');
  assert.equal(byId.get('lineworks').mcp_endpoint, '', 'LINE WORKS endpoint is not published — left empty, not guessed');
});

test('every /mcp/ page marked official is official in the seed (no drift between the two)', () => {
  const official = pages.items.filter((p) => p.status === 'official').map((p) => p.id);
  assert.ok(official.length >= 7);
  for (const id of official) assert.equal(byId.get(id)?.mcp_status, 'official', `${id}: /mcp/ page says official, seed must agree`);
});

test('Registry-imported servers are not vendor_official', () => {
  assert.equal(isVendorOfficial({ id: 'com-korture-hiring', mcp_status: 'official', namespace: 'com.korture', api_url: 'https://github.com/x/y' }), false);
  assert.equal(isVendorOfficial({ id: 'io-github-foo-bar', mcp_status: 'official', namespace: 'io.github.foo', api_url: 'https://foo.example.com/' }), false);
  assert.equal(isVendorOfficial({ id: 'acme', mcp_status: 'official', namespace: '', api_url: 'https://www.npmjs.com/package/acme' }), false);
  assert.equal(isVendorOfficial({ id: 'acme', mcp_status: 'api_only', namespace: '', api_url: 'https://developer.acme.co.jp/' }), false);
});
