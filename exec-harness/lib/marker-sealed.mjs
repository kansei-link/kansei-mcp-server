/**
 * Sealed-file handling shared by every kind_of_truth (docs/READING-PREDICATE-v1.md §2 rule 5).
 * Fingerprint, expiry and publication checks are target-independent; field
 * validation belongs to the target module (lib/marker-targets.mjs).
 *
 * Exit codes (unchanged from run-marker 0.1): 2 missing, 3 fingerprint/placeholder, 4 unpublished.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function loadSealedCommon({ MK, ROOT, env = process.env, allowExpired = false, dry = false }) {
  const sealedPath = env[MK.sealed_path_env];
  if (!sealedPath || !existsSync(sealedPath)) { console.error(`sealed file not found: set ${MK.sealed_path_env} in .env`); process.exit(2); }
  const raw = readFileSync(sealedPath);
  const text = raw.toString('utf8');
  if (text.includes('FILL_ME')) { console.error('sealed file still has FILL_ME placeholders — refusing to run (HANDOFF §2)'); process.exit(3); }
  const digest = sha256(raw);
  const commitmentPath = join(ROOT, MK.commitment_file);
  if (!existsSync(commitmentPath)) { console.error(`commitment file missing: ${MK.commitment_file}`); process.exit(3); }
  const committed = readFileSync(commitmentPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => /^[0-9a-f]{64}\s+\S+/.test(l))?.split(/\s+/)[0];
  if (!committed) { console.error('commitment file has no sha256 line'); process.exit(3); }
  if (digest !== committed || digest !== MK.expected_digest) {
    console.error(`sealed file sha256 does not match the public commitment\n  sealed    : ${digest}\n  committed : ${committed}\n  taskpack  : ${MK.expected_digest}\nRefusing to run.`);
    process.exit(3);
  }
  let json; try { json = JSON.parse(text); } catch { console.error('sealed file is not JSON'); process.exit(3); }
  if (json.marker_id !== MK.marker_id) { console.error('sealed marker_id does not match the taskpack'); process.exit(3); }
  const expired = json.expires_at ? Date.now() > Date.parse(json.expires_at) : false;
  if (expired && !allowExpired) { console.log(`sealed marker is past expires_at (${json.expires_at}); contents may be disclosed, so the run stops by default (use --allow-expired to override). Nothing written.`); process.exit(0); }
  if (expired) console.warn(`[warn] sealed marker is past expires_at (${json.expires_at}); continuing because --allow-expired was given. Flagged in manifest.`);
  // commitment publication (readings before the public fingerprint do not count)
  let commitSha = null, remoteBranches = '';
  try {
    commitSha = execSync(`git log -n1 --format=%H -- "${MK.commitment_file}"`, { cwd: ROOT }).toString().trim() || null;
    if (commitSha) remoteBranches = execSync(`git branch -r --contains ${commitSha}`, { cwd: ROOT }).toString().trim();
  } catch { /* handled below */ }
  if (!commitSha || !remoteBranches) {
    const msg = `commitment ${MK.commitment_file} is not on any remote branch (commit ${commitSha || 'none'}) — readings before publication do not count`;
    if (dry) console.warn(`[warn] ${msg} (continuing: --dry-run)`); else { console.error(msg); process.exit(4); }
  }
  return {
    json, digest, commitSha,
    remoteBranches: remoteBranches.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    sealedAt: json.sealed_at || null, expiresAt: json.expires_at || null, expired,
  };
}
