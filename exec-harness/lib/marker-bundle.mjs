import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Hash graph: reading -> manifest -> immutable metrics/transcripts.
 * metrics contains the reading payload, without the outgoing evidence_ref.
 * The full schema-valid reading is completed in memory for DB/README storage.
 */
export function writeMarkerBundle({ bundleDir, bundleRel, metrics, manifest, files, readings }) {
  const payloads = readings.map(({ _outcome, evidence_ref, ...payload }) => payload);
  writeFileSync(join(bundleDir, 'metrics.json'), JSON.stringify({ ...metrics, readings: payloads }, null, 1));
  manifest.files = files.map((file) => ({
    file,
    sha256: existsSync(join(bundleDir, file)) ? sha256(readFileSync(join(bundleDir, file))) : null,
    committed: !file.endsWith('transcript.jsonl'),
  }));
  writeFileSync(join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const digest = sha256(readFileSync(join(bundleDir, 'manifest.json')));
  for (const reading of readings) reading.evidence_ref = `${bundleRel}#sha256:${digest}`;
  return digest;
}
