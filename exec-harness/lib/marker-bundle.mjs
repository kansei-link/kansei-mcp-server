import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const isPrivateMarkerFile = (file) => file.endsWith('transcript.jsonl') || file === 'environment.private.json';

// Apply only to new bundles; historical evidence must remain byte-for-byte intact.
export function assertPublicMarkerData(value) {
  const forbidden = new Set(['head', 'stderr_head', 'companies_visible_to_token',
    'sealed_company_visible_to_token', 'sealed_company_was_current_at_start',
    'companies_visible', 'sealed_is_own', 'candidates', 'trap_candidates', 'diagnostics', 'nonce']);
  const visit = (v) => {
    if (!v || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      if (forbidden.has(key)) throw new Error(`private operational field in public bundle: ${key}`);
      visit(child);
    }
    const eventKeys = {
      preflight: ['t', 'event', 'tool', 'ok', 'version'],
      ground_truth: ['t', 'event', 'consistent'],
      trap_armed: ['t', 'event', 'ok'],
      ground_truth_failed: ['t', 'event', 'ok'],
      mcp_tools_list_empty: ['t', 'event', 'ok'],
      restore_current_company: ['t', 'event', 'where', 'changed', 'ok'],
    };
    const allowed = eventKeys[v.event];
    if (allowed && Object.keys(v).some((key) => !allowed.includes(key))) throw new Error('unexpected field in public harness event');
    if (v.event === 'preflight' && (typeof v.ok !== 'boolean' || (v.version !== null && !/^\d+\.\d+\.\d+$/.test(v.version)))) throw new Error('invalid public preflight summary');
  };
  visit(value);
}

/** Hash graph: reading -> manifest -> immutable metrics/transcripts.
 * metrics contains the reading payload, without the outgoing evidence_ref.
 * The full schema-valid reading is completed in memory for DB/README storage.
 */
export function writeMarkerBundle({ bundleDir, bundleRel, metrics, manifest, files, readings }) {
  const payloads = readings.map(({ _outcome, evidence_ref, ...payload }) => payload);
  assertPublicMarkerData({ metrics, manifest, readings: payloads });
  const log = join(bundleDir, 'harness.jsonl');
  if (existsSync(log)) for (const line of readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean)) assertPublicMarkerData(JSON.parse(line));
  writeFileSync(join(bundleDir, 'metrics.json'), JSON.stringify({ ...metrics, readings: payloads }, null, 1));
  manifest.files = files.map((file) => ({
    file,
    sha256: existsSync(join(bundleDir, file)) ? sha256(readFileSync(join(bundleDir, file))) : null,
    committed: !isPrivateMarkerFile(file),
  }));
  writeFileSync(join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const digest = sha256(readFileSync(join(bundleDir, 'manifest.json')));
  for (const reading of readings) reading.evidence_ref = `${bundleRel}#sha256:${digest}`;
  return digest;
}
