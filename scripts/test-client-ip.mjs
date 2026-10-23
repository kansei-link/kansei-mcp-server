import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { clientIp, isCloudflareIp, buildCloudflareList, resetCloudflareListForTests } from '../dist/utils/client-ip.js';

// Visitor IP behind Cloudflare (2026-10-24). No network, no production.

const CF4 = '104.16.1.1';          // inside 104.16.0.0/13
const CF6 = '2606:4700:10::1';     // inside 2606:4700::/32
const req = (ip, headers = {}) => ({ ip, header: (h) => headers[h.toLowerCase()] });

test('Cloudflare ranges: built-in list matches v4 and v6 edges and nothing else', () => {
  assert.equal(isCloudflareIp(CF4), true);
  assert.equal(isCloudflareIp(CF6), true);
  assert.equal(isCloudflareIp('::ffff:104.16.1.1'), true, 'IPv4-mapped form');
  assert.equal(isCloudflareIp('203.0.113.9'), false);
  assert.equal(isCloudflareIp('10.0.0.1'), false);
  assert.equal(isCloudflareIp(''), false);
  assert.equal(isCloudflareIp('not-an-ip'), false);
  assert.equal(isCloudflareIp(undefined), false);
});

test('CF-Connecting-IP is used only when the direct sender is a Cloudflare edge', () => {
  assert.equal(clientIp(req(CF4, { 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(clientIp(req(CF6, { 'cf-connecting-ip': '2001:db8::7' })), '2001:db8::7');
  // forged on the direct railway.app path → ignored, the sender keeps its own address
  assert.equal(clientIp(req('203.0.113.50', { 'cf-connecting-ip': '198.51.100.1' })), '203.0.113.50');
  // a Cloudflare edge without the header, or with garbage → the edge address (as before)
  assert.equal(clientIp(req(CF4, {})), CF4);
  assert.equal(clientIp(req(CF4, { 'cf-connecting-ip': 'nope, 1.2.3.4' })), CF4);
  assert.equal(clientIp(req(CF4, { 'cf-connecting-ip': '<script>' })), CF4);
  // nothing at all → 'unknown', never a throw
  assert.equal(clientIp({ ip: undefined, header: () => undefined }), 'unknown');
  assert.equal(clientIp({ ip: '', header: () => undefined, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

test('CLOUDFLARE_IP_RANGES replaces the built-in list; malformed entries are skipped, not widened', () => {
  process.env.CLOUDFLARE_IP_RANGES = '198.51.100.0/24, bogus, 10.0.0.0/notanumber';
  resetCloudflareListForTests();
  try {
    assert.equal(isCloudflareIp('198.51.100.7'), true);
    assert.equal(isCloudflareIp(CF4), false, 'built-in list is replaced, not merged');
    assert.equal(isCloudflareIp('10.0.0.1'), false);
    const empty = buildCloudflareList(['garbage']);
    assert.equal(empty.check('1.2.3.4'), false);
  } finally {
    delete process.env.CLOUDFLARE_IP_RANGES;
    resetCloudflareListForTests();
  }
});

test('an express rate limiter keyed on clientIp separates two visitors behind one Cloudflare edge', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (r) => ipKeyGenerator(clientIp(r)) }));
  app.get('/x', (r, res) => res.json({ ip: clientIp(r) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const get = (xff, cf) => fetch(`http://127.0.0.1:${port}/x`, { headers: { 'x-forwarded-for': xff, ...(cf ? { 'cf-connecting-ip': cf } : {}) } });
  try {
    // trust proxy = 1: req.ip is the last X-Forwarded-For entry (the sender to Railway = the Cloudflare edge)
    const a1 = await get(CF4, '203.0.113.1'); assert.equal(a1.status, 200); assert.equal((await a1.json()).ip, '203.0.113.1');
    const a2 = await get(CF4, '203.0.113.1'); assert.equal(a2.status, 200);
    const a3 = await get(CF4, '203.0.113.1'); assert.equal(a3.status, 429, 'visitor A hit its own limit');
    const b1 = await get(CF4, '203.0.113.2'); assert.equal(b1.status, 200, 'visitor B behind the same edge is a separate bucket');
    // direct path: a forged header does not open a fresh bucket for the same sender
    const d1 = await get('198.51.100.9', '203.0.113.3'); assert.equal((await d1.json()).ip, '198.51.100.9');
    await get('198.51.100.9', '203.0.113.4');
    const d3 = await get('198.51.100.9', '203.0.113.5'); assert.equal(d3.status, 429, 'forged CF-Connecting-IP values share the sender bucket');
  } finally {
    server.close();
  }
});
