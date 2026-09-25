#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'marker-isolation-'));
const dbPath = join(temp, 'marker.db'), report = join(temp, 'README.md'), state = join(temp, 'fake-state.json');
const db = new Database(dbPath); db.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES (\'unchanged\')'); db.close();
writeFileSync(report, '<!-- seven-rows:end -->\n<!-- gt-rows:end -->\n');
const beforeDb = readFileSync(dbPath), beforeReport = readFileSync(report);
const realPack = 'taskpacks/freee/freee-accounting-m001-monthly-deal-count.v1.json';
const fakeCommand = `node ${join(root, 'exec-harness/fixtures/fake-freee-mcp.mjs').replaceAll('\\', '/')}`;
const copiedSeal = join(temp, 'copied-seal.json');
writeFileSync(copiedSeal, readFileSync(join(root, 'exec-harness/fixtures/M-998.sealed.json')));
const cases: [string, string, string[], Record<string, string>][] = [
  ['--mcp', realPack, ['--mcp', fakeCommand], {}],
  ['explicit default --mcp', realPack, ['--mcp', 'npx freee-mcp'], {}],
  ['environment MCP', realPack, [], { KANSEI_MCP_COMMAND: fakeCommand }],
  ['empty executor', realPack, ['--executor', 'empty'], {}],
  ['fixture pack and seal', 'fixtures/taskpack-m998.json', [], { KANSEI_M998_SEALED_PATH: join(root, 'exec-harness/fixtures/M-998.sealed.json') }],
  ['fixture seal with real pack', realPack, [], { KANSEI_M001_SEALED_PATH: join(root, 'exec-harness/fixtures/M-998.sealed.json') }],
  ['copied fixture seal', realPack, [], { KANSEI_M001_SEALED_PATH: copiedSeal }],
];
for (const [name, pack, args, extra] of cases) {
  const env = { ...process.env, KANSEI_DB_PATH: dbPath, KANSEI_M001_REPORT_README: report, KANSEI_M001_SEALED_PATH: join(temp, 'absent'), FAKE_FREEE_STATE_FILE: state, ...extra };
  if (!Object.hasOwn(extra, 'KANSEI_MCP_COMMAND')) delete env.KANSEI_MCP_COMMAND;
  const r = spawnSync(process.execPath, [join(root, 'exec-harness/run-marker.mjs'), pack, ...args], { cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 5, `${name}: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /test-only execution requires --dry-run/);
  assert.deepEqual(readFileSync(dbPath), beforeDb, name);
  assert.deepEqual(readFileSync(report), beforeReport, name);
  assert.equal(existsSync(state), false, 'MCP must not start');
  console.log('PASS', name, 'refused before DB/README/MCP');
}
console.log('marker-isolation smoke: 7/7 PASS');
