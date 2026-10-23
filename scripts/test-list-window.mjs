import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listWindow, listCaps } from '../dist/utils/list-window.js';

// /api/dashboard/rankings and /api/dashboard/changelog page through listWindow (security hardening v1).
const caps = { maxLimit: 50, maxOffset: 450 };

test('defaults and the 50-row cap', () => {
  assert.deepEqual(listWindow(undefined, undefined, 50, caps), { limit: 50, offset: 0 });
  assert.deepEqual(listWindow('30', '0', 50, caps), { limit: 30, offset: 0 });
  assert.deepEqual(listWindow('1000', '0', 50, caps), { limit: 50, offset: 0 }, 'was 1,000 before');
  assert.deepEqual(listWindow('500', undefined, 30, caps), { limit: 50, offset: 0 });
});

test('a negative or junk limit can no longer mean "no limit" (SQLite LIMIT -1)', () => {
  for (const bad of ['-1', '-1000', '0', 'abc', '', null, 'NaN', ' -5 ']) {
    const { limit } = listWindow(bad, '0', 30, caps);
    assert.ok(limit >= 1 && limit <= 50, `limit=${JSON.stringify(bad)} → ${limit}`);
  }
});

test('offset is clamped to 0..maxOffset (only the top 500 are reachable)', () => {
  assert.equal(listWindow('50', '-10', 50, caps).offset, 0);
  assert.equal(listWindow('50', '450', 50, caps).offset, 450);
  assert.equal(listWindow('50', '451', 50, caps).offset, 450);
  assert.equal(listWindow('50', '100000', 50, caps).offset, 450);
  assert.equal(listWindow('50', 'abc', 50, caps).offset, 0);
});

test('caps come from the environment with safe defaults', () => {
  assert.deepEqual(listCaps({}), { maxLimit: 50, maxOffset: 450 });
  assert.deepEqual(listCaps({ DASHBOARD_MAX_LIMIT: '1000', DASHBOARD_MAX_OFFSET: '100000' }), { maxLimit: 1000, maxOffset: 100000 });
  assert.deepEqual(listCaps({ DASHBOARD_MAX_LIMIT: '-3', DASHBOARD_MAX_OFFSET: 'x' }), { maxLimit: 50, maxOffset: 450 }, 'bad env values fall back to the defaults');
});
