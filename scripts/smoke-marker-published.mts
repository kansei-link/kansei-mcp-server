#!/usr/bin/env tsx
/** Verify a specific committed bundle, using Git blobs rather than checkout bytes.
 * npx tsx scripts/smoke-marker-published.mts <git-ref> <evidence/bundle/path>
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sha256 } from '../exec-harness/lib/marker-bundle.mjs';
import { validateReading } from '../exec-harness/lib/reading.mjs';
const [ref, bundle] = process.argv.slice(2);
if (!ref || !bundle || !/^evidence\/[\w/-]+$/.test(bundle)) throw new Error('usage: <git-ref> <evidence/bundle/path>');
const root = resolve(import.meta.dirname, '..');
const blob = (file: string) => execFileSync('git', ['show', `${ref}:${bundle}/${file}`], { cwd: root });
const manifestBytes = blob('manifest.json');
const manifest = JSON.parse(manifestBytes.toString());
for (const f of manifest.files.filter((f: any) => f.committed)) {
  assert.match(f.file, /^[\w./-]+$/); assert.equal(f.file.includes('..'), false);
  assert.equal(sha256(blob(f.file)), f.sha256, f.file);
  console.log('PASS Git blob sha256', f.file);
}
const metrics = JSON.parse(blob('metrics.json').toString());
for (const payload of metrics.readings) {
  assert.equal('evidence_ref' in payload, false, 'metrics must not contain a hash cycle');
  const reading = { ...payload, evidence_ref: `${bundle}#sha256:${sha256(manifestBytes)}` };
  assert.deepEqual(validateReading(reading), []);
  console.log('PASS reconstructed reading', reading.reading_id, 'supersedes', reading.supersedes);
}
console.log('marker-published smoke: ALL PASS');
