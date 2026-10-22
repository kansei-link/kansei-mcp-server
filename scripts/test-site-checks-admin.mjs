import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { adminSiteChecks, siteCheckRows, siteChecksCsv, domainOf, parseDays } from '../dist/admin/site-checks.js';

// Test DBs only (in-memory). Never the production DB.

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE site_checks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, score INTEGER NOT NULL, grade TEXT NOT NULL,
    findings TEXT NOT NULL, raw_signals TEXT DEFAULT '{}', ip_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);
  return db;
}
const add = (db, id, url, score, grade, ip, ago) =>
  db.prepare(`INSERT INTO site_checks (id, url, score, grade, findings, ip_hash, created_at)
              VALUES (?, ?, ?, ?, '[]', ?, datetime('now', ?))`).run(id, url, score, grade, ip, ago);

test('no table: stable empty shape', () => {
  const a = adminSiteChecks(new Database(':memory:'));
  assert.equal(a.schema, 'kansei-admin-site-checks/v1');
  assert.equal(a.totals.all_time, 0);
  assert.deepEqual(a.latest, []);
  assert.deepEqual(a.top_domains, []);
});

test('window, domains, grades and bands; never exposes ip_hash', () => {
  const db = setup();
  add(db, 'aaaaaaaaaaa1', 'https://www.Example.com/', 35, 'B', 'h1', '-1 hours');
  add(db, 'aaaaaaaaaaa2', 'https://example.com/menu', 40, 'BB', 'h1', '-2 hours');
  add(db, 'aaaaaaaaaaa3', 'https://shop.jp/', 90, 'AAA', 'h2', '-3 days');
  add(db, 'aaaaaaaaaaa4', 'https://old.jp/', 70, 'A', 'h3', '-40 days');

  const a = adminSiteChecks(db, 30);
  assert.equal(a.totals.all_time, 4);
  assert.equal(a.totals.in_window, 3);
  assert.equal(a.totals.distinct_domains, 2);
  assert.equal(a.totals.distinct_requesters, 2);
  assert.deepEqual(a.top_domains[0], { domain: 'example.com', checks: 2, last_at: a.top_domains[0].last_at, last_score: 35, last_grade: 'B' });
  assert.equal(a.by_grade.B, 1); assert.equal(a.by_grade.BB, 1); assert.equal(a.by_grade.AAA, 1); assert.equal(a.by_grade.A, 0);
  assert.deepEqual(a.score_bands, { '0-24': 0, '25-49': 2, '50-74': 0, '75-100': 1 });
  assert.equal(a.latest[0].id, 'aaaaaaaaaaa1');
  const text = JSON.stringify(a);
  for (const h of ['h1', 'h2', 'h3']) assert.ok(!text.includes(`"${h}"`), 'ip_hash value leaked');
  assert.ok(!('ip_hash' in a.latest[0]));
  assert.equal(adminSiteChecks(db, 365).totals.in_window, 4);
});

test('csv: BOM, header, one line per row in window', () => {
  const db = setup();
  add(db, 'bbbbbbbbbbb1', 'https://a.jp/', 50, 'BBB', 'x', '-1 hours');
  add(db, 'bbbbbbbbbbb2', 'https://b.jp/', 60, 'BBB', 'x', '-50 days');
  const csv = siteChecksCsv(siteCheckRows(db, 30));
  assert.ok(csv.startsWith('﻿id,domain,score,grade,created_at_utc\n'));
  assert.equal(csv.trim().split('\n').length, 2);
  assert.ok(csv.includes('bbbbbbbbbbb1,a.jp,50,BBB,'));
  assert.ok(!csv.includes('x,'));
});

test('helpers', () => {
  assert.equal(domainOf('https://WWW.Foo.co.jp/path?q=1'), 'foo.co.jp');
  assert.equal(domainOf('not a url'), 'not a url');
  assert.equal(parseDays(undefined), 30);
  assert.equal(parseDays('0'), 30);
  assert.equal(parseDays('abc'), 30);
  assert.equal(parseDays('7'), 7);
  assert.equal(parseDays('9999'), 365);
});
