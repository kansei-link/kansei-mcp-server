#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeMarkerBundle, sha256, assertPublicMarkerData } from '../exec-harness/lib/marker-bundle.mjs';
import { newUlid, validateReading } from '../exec-harness/lib/reading.mjs';
const root = mkdtempSync(join(tmpdir(), 'marker-bundle-'));
const rel = 'evidence/freee/test/marker-test';
const dir = join(root, rel); mkdirSync(dir, { recursive: true });
const reading = { reading_id: newUlid(), claim: 'audit fixture observation', marker_id: 'M-998', expected_digest: 'a'.repeat(64), target: { service_id: 'freee', model: 'none', harness_version: 'smoke' }, stage_reached: 'discover', stage_stopped: 'discover', observed: { pass: false, method: 'harness_direct_api_vs_sealed_expectation' }, evidence_ref: '', observer: 'kansei_harness@smoke', kind: 'synthetic', observed_at: new Date().toISOString(), supersedes: null };
writeFileSync(join(dir, 'environment.private.json'), JSON.stringify({ companies_visible_to_token: 3 }));
mkdirSync(join(dir, 'claude-n1'));
writeFileSync(join(dir, 'claude-n1/transcript.jsonl'), '{"fixture":"private"}\n');
const digest = writeMarkerBundle({ bundleDir: dir, bundleRel: rel, metrics: { fixture: true }, manifest: { files: [] }, files: ['metrics.json', 'environment.private.json', 'claude-n1/transcript.jsonl'], readings: [reading] });
const bytes = readFileSync(join(dir, 'metrics.json'));
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
assert.equal(manifest.files[0].sha256, sha256(bytes));
assert.equal(reading.evidence_ref, `${rel}#sha256:${digest}`);
assert.deepEqual(validateReading(reading), []);
assert.equal('evidence_ref' in JSON.parse(bytes.toString()).readings[0], false);
console.log('PASS immutable metrics and complete reading have no hash cycle');
// Verify the exact repository attributes in a disposable Git index, including autocrlf.
writeFileSync(join(root, '.gitattributes'), readFileSync(resolve(import.meta.dirname, '../.gitattributes')));
writeFileSync(join(root, '.gitignore'), readFileSync(resolve(import.meta.dirname, '../.gitignore')));
const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=true', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
git('init'); git('add', '.gitattributes', rel);
const blob = (file: string) => git('show', `:${rel}/${file}`);
const gitManifest = JSON.parse(blob('manifest.json').toString());
assert.equal(sha256(blob('manifest.json')), digest);
assert.equal(gitManifest.files[0].sha256, sha256(blob('metrics.json')));
assert.deepEqual(blob('metrics.json'), bytes);
const tracked = git('ls-files').toString();
assert.equal(tracked.includes('environment.private.json'), false);
assert.equal(tracked.includes('transcript.jsonl'), false);
for (const name of ['environment.private.json', 'claude-n1/transcript.jsonl']) {
  const entry = gitManifest.files.find((f: any) => f.file === name);
  assert.equal(entry.committed, false);
  assert.equal(entry.sha256, sha256(readFileSync(join(dir, name))));
}
console.log('PASS Git blobs verify with core.autocrlf=true');
for (const key of ['head', 'stderr_head', 'companies_visible_to_token', 'sealed_company_visible_to_token', 'sealed_company_was_current_at_start', 'companies_visible', 'sealed_is_own', 'candidates']) {
  assert.throws(() => assertPublicMarkerData({ nested: { [key]: 'fixture' } }), /private operational field/);
}
assert.throws(() => assertPublicMarkerData({ event: 'preflight', ok: true, version: null, output: 'private' }), /unexpected field/);
assert.throws(() => assertPublicMarkerData({ event: 'preflight', ok: true, version: 'expiry metadata' }), /invalid public/);
assertPublicMarkerData({ event: 'preflight', tool: 'freee_server_info', ok: true, version: '0.26.5' });
console.log('PASS private sidecars ignored and metadata leakage rejected');
console.log('marker-bundle smoke: ALL PASS');
