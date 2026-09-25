#!/usr/bin/env tsx
/** Real CLI in an isolated local Git sandbox. The test-only Node preload replaces
 * transport/provider I/O; the production runner has no test bypass or write opt-in.
 * No real seal, MCP, API key, DB or README is accessed; no network is needed.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { initializeDb } from '../src/db/schema.js';
import { newUlid } from '../exec-harness/lib/reading.mjs';
import { sha256 } from '../exec-harness/lib/marker-bundle.mjs';
const source = resolve(import.meta.dirname, '..');
const root = mkdtempSync(join(tmpdir(), 'marker-limits-'));
mkdirSync(join(root, 'exec-harness'), { recursive: true });
for (const item of ['run-marker.mjs', 'lib', 'schemas', 'fixtures']) cpSync(join(source, 'exec-harness', item), join(root, 'exec-harness', item), { recursive: true });
symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(join(root, 'package.json'), '{"type":"module"}');
writeFileSync(join(root, '.gitignore'), 'node_modules/\n*.db*\nevidence/\n');
const fake = readFileSync(join(root, 'exec-harness/fixtures/fake-freee-mcp.mjs'), 'utf8');
writeFileSync(join(root, 'fake-fail.mjs'), fake.replace("case 'freee_auth_status': return text(", "case 'freee_auth_status': return text('未認証 error'); return text("));
writeFileSync(join(root, 'preload.mjs'), `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawn = cp.spawn;
cp.spawn = (command, args, options) => {
  if (command !== 'npx' || args.join(' ') !== 'freee-mcp') throw new Error('unexpected subprocess');
  const fake = process.env.AUDIT_AUTH_FAIL === '1' ? ${JSON.stringify(join(root, 'fake-fail.mjs'))} : ${JSON.stringify(join(root, 'exec-harness/fixtures/fake-freee-mcp.mjs'))};
  return spawn(process.execPath, [fake], { ...options, shell: false });
};
syncBuiltinESMExports();
globalThis.fetch = async () => { throw new Error('offline audit provider'); };
const timeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms, ...args).unref();
`);
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
git('init');
const sealed = { marker_id: 'M-997', real_company_id: 1000001, expected: { period: '2026-08-01..2026-08-31', deal_count: 42 }, salt: newUlid(), expires_at: '2099-01-01T00:00:00Z' };
const pack = JSON.parse(readFileSync(join(root, 'exec-harness/fixtures/taskpack-m998.json'), 'utf8'));
pack.id = 'audit-capacity';
pack.marker = { ...pack.marker, marker_id: 'M-997', claim: 'An agent counts deals in the selected company', commitment_file: 'commitment.sha256', sealed_path_env: 'KANSEI_AUDIT_SEAL' };
function savePack() {
  const bytes = JSON.stringify(sealed); writeFileSync(join(root, 'sealed.json'), bytes);
  pack.marker.expected_digest = sha256(bytes);
  writeFileSync(join(root, 'commitment.sha256'), pack.marker.expected_digest + '  sealed.json\n');
  writeFileSync(join(root, 'exec-harness/task.json'), JSON.stringify(pack));
  git('add', 'commitment.sha256');
  git('-c', 'user.name=Offline audit', '-c', 'user.email=audit@example.invalid', 'commit', '-m', 'local test commitment');
  git('update-ref', 'refs/remotes/origin/offline-test', git('rev-parse', 'HEAD').toString().trim());
}
savePack();
function setup(name: string, count: number, groundTruth = false) {
  const path = join(root, `${name}.db`), report = join(root, `${name}.md`);
  const db = new Database(path); initializeDb(db);
  db.exec("INSERT INTO services(id,name,category) VALUES('freee','freee','accounting')");
  db.exec(readFileSync(join(root, 'exec-harness/schemas/marker_readings.sql'), 'utf8'));
  const ids: string[] = [];
  const insert = (outcome: number | bigint | null) => {
    const id = newUlid(); ids.push(id);
    db.prepare(`INSERT INTO marker_readings(reading_id,outcome_id,claim,marker_id,expected_digest,target_json,stage_reached,stage_stopped,observed_json,evidence_ref,observer,kind,observed_at)
      VALUES(?,?,'original reading','M-997',?,'{"service_id":"freee"}','discover','discover','{"pass":false}','old-evidence','kansei_harness@audit','synthetic','2026-09-24T00:00:00Z')`).run(id, outcome, pack.marker.expected_digest);
  };
  for (let i = 0; i < count; i++) insert(db.prepare("INSERT INTO outcomes(service_id,agent_id_hash,success,provenance,task_type) VALUES('freee','kansei-marker-harness',0,'synthetic','marker:M-997')").run().lastInsertRowid);
  if (groundTruth) insert(null);
  db.close(); writeFileSync(report, 'original row remains\n<!-- seven-rows:end -->\n<!-- gt-rows:end -->\n');
  return { path, report, ids };
}
function run(s: ReturnType<typeof setup>, args: string[], authFail = true) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: root, USERPROFILE: root, KANSEI_DB_PATH: s.path, KANSEI_M001_REPORT_README: s.report, KANSEI_AUDIT_SEAL: join(root, 'sealed.json'), AUDIT_AUTH_FAIL: authFail ? '1' : '0' };
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'preload.mjs')).href, join(root, 'exec-harness/run-marker.mjs'), 'task.json', ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}
const capped = setup('six', 6); const out = run(capped, ['--runs', '2']);
const capDb = new Database(capped.path, { readonly: true });
assert.equal(capDb.prepare('SELECT COUNT(*) FROM marker_readings').pluck().get(), 7);
assert.match(out, /remaining runs skipped/);
assert.equal(readFileSync(capped.report, 'utf8').split('\n').filter((l) => l.startsWith('|')).length, 1); capDb.close();
console.log('PASS CLI six + two requested runs = seven; one README row');
const full = setup('seven', 7); const beforeDb = readFileSync(full.path), beforeMd = readFileSync(full.report);
assert.match(run(full, ['--runs', '2']), /Nothing written/);
assert.deepEqual(readFileSync(full.path), beforeDb); assert.deepEqual(readFileSync(full.report), beforeMd);
console.log('PASS CLI seven stops without changing DB or README bytes');
const correction = setup('correction', 7, true);
const before = new Database(correction.path, { readonly: true }); const original = before.prepare('SELECT * FROM marker_readings WHERE reading_id=?').get(correction.ids[0]); before.close();
run(correction, ['--supersedes', correction.ids[0], '--supersedes-ground-truth', correction.ids[7]], false);
const corrected = new Database(correction.path, { readonly: true });
assert.deepEqual(corrected.prepare('SELECT * FROM marker_readings WHERE reading_id=?').get(correction.ids[0]), original);
assert.equal(corrected.prepare('SELECT COUNT(*) FROM marker_readings WHERE supersedes IS NOT NULL').pluck().get(), 2);
assert.equal(corrected.prepare('SELECT COUNT(*) FROM marker_readings r WHERE outcome_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM marker_readings s WHERE s.supersedes=r.reading_id)').pluck().get(), 7);
assert.equal(JSON.parse((corrected.prepare('SELECT observed_json FROM marker_readings WHERE supersedes=?').get(correction.ids[7]) as any).observed_json).pass, true);
corrected.close();
console.log('PASS CLI supersedes preserves originals, corrects agent/ground truth, keeps seven effective rows');
sealed.expires_at = '2026-01-01T00:00:00Z'; savePack();
const expired = setup('expired', 0); const expDb = readFileSync(expired.path), expMd = readFileSync(expired.report);
assert.match(run(expired, []), /past expires_at/);
assert.deepEqual(readFileSync(expired.path), expDb); assert.deepEqual(readFileSync(expired.report), expMd);
console.log('PASS CLI expired seal changes neither DB nor README');
console.log('marker-limits smoke: ALL PASS');
