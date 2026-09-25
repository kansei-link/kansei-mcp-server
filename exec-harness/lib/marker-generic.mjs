/**
 * Generic marker runner for every kind_of_truth other than mcp_direct_read.
 * Same discipline as run-marker's M-001 path: sealed fingerprint checked first,
 * ground truth by the harness, one reading per observer, rule-based judgement,
 * Evidence Bundle (metrics/manifest/harness.jsonl public; transcript private),
 * append-only DB rows quarantined as synthetic, README rows. Nothing here
 * touches freee-mcp, the catalog, or the subject.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasReadingCapacity, effectiveAgentCount, validateSupersedes } from './marker-store.mjs';
import { writeMarkerBundle } from './marker-bundle.mjs';
import { newUlid, validateReading, loadReadingSchema, isoWithOffset } from './reading.mjs';
import { persistReadings, appendReadme } from './marker-persist.mjs';
import { resolveEnvRefs } from './marker-targets.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileSha = (p) => sha256(readFileSync(p));

export async function runGenericMarker({ target, PACK, MK, packPath, ROOT, KANSEI_ROOT, flags, sealedCommon, db, libDir, VERSION, HARNESS_VERSION, OBSERVER }) {
  const t0 = new Date();
  const MKr = resolveEnvRefs(MK);
  let sealed;
  try { sealed = target.parseSealed(sealedCommon.json); }
  catch (e) { console.error(`sealed file fields invalid: ${e.message} (values withheld)`); process.exit(3); }
  const schema = loadReadingSchema();

  const stamp = t0.toISOString().slice(0, 10);
  const hhmmss = isoWithOffset(t0).slice(11, 19).replace(/:/g, '');
  const bundleDir = join(ROOT, 'evidence', flags.dry ? '_dryrun' : PACK.service_id, stamp, `marker-${MK.marker_id.toLowerCase()}`, `${hhmmss}-${newUlid()}`);
  mkdirSync(bundleDir, { recursive: true });
  const bundleRel = relative(ROOT, bundleDir).replaceAll('\\', '/');
  const harnessLog = (e) => appendFileSync(join(bundleDir, 'harness.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');
  const privateEnvironment = { nonce: randomBytes(32).toString('hex'), diagnostics: [] };

  // ---- ground truth (harness) ----
  let truth = null, instrumentBefore = null;
  try { truth = await target.groundTruth({ MK: MKr, sealed, harnessLog, flags }); }
  catch (e) { instrumentBefore = 'other'; privateEnvironment.diagnostics.push({ event: 'ground_truth_failed', message: String(e.message) }); harnessLog({ event: 'ground_truth_failed', ok: false }); console.error('ground truth failed (details in private sidecar)'); }
  const gtConsistent = truth ? truth.consistent : null;
  if (truth) console.log(`ground truth: ${gtConsistent ? 'CONSISTENT' : 'INCONSISTENT'} with sealed expectation`);

  const readings = [];
  const observers = target.observers({ MK: MKr, PACK });
  if (truth && (!gtConsistent || flags.supersedesGt)) {
    readings.push({
      reading_id: newUlid(), claim: target.gtClaim, marker_id: MK.marker_id, expected_digest: sealedCommon.digest,
      target: { service_id: PACK.service_id, model: 'none', harness_version: HARNESS_VERSION },
      stage_reached: 'done', stage_stopped: null,
      observed: { pass: gtConsistent, method: target.gtMethod, checks: truth.checks || [], ground_truth_consistent: gtConsistent, instrument_error: null },
      evidence_ref: `${bundleRel}#sha256:PENDING`, observer: OBSERVER, kind: 'synthetic', observed_at: isoWithOffset(new Date()), supersedes: flags.supersedesGt || null, _outcome: null,
    });
  }

  // ---- observations (one reading per observer) ----
  const runRows = [];
  const files = ['metrics.json', 'harness.jsonl', 'environment.private.json'];
  const wanted = flags.executor === 'empty' ? [] : observers.filter((o) => !flags.observerFilter || flags.observerFilter.includes(o.label));
  if (flags.executor === 'empty') { harnessLog({ event: 'executor_empty' }); console.log('executor=empty: no observation run'); }
  for (const observer of wanted) {
    if (!hasReadingCapacity(db, MK.marker_id, flags.maxReadings, readings, Boolean(flags.supersedes))) { console.log('max-readings reached; remaining observers skipped'); break; }
    const runDir = join(bundleDir, observer.label);
    mkdirSync(runDir, { recursive: true });
    const transcriptPath = join(runDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, '');
    files.push(`${observer.label}/transcript.jsonl`);
    const log = (e) => appendFileSync(transcriptPath, JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');
    log({ role: 'harness', event: 'start', pack: PACK.id, pack_version: PACK.version, marker: MK.marker_id, observer: observer.label, kind_of_truth: MK.kind_of_truth, observation: MK.observation || null });

    const started = Date.now();
    let obs = {}, error = null, timer = null;
    if (instrumentBefore) error = `instrument:${instrumentBefore}`;
    else {
      try {
        obs = await Promise.race([
          target.observe({ MK: MKr, PACK, observer, sealed, flags, log, stamp }),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout_s exceeded')), (PACK.budgets?.timeout_s || 240) * 1000); }),
        ]);
      } catch (e) { error = e.message; }
      finally { clearTimeout(timer); } // otherwise the pending timer keeps the process alive for timeout_s after the reading is done
    }
    if (obs?.missing) { harnessLog({ event: 'observation_missing', observer: observer.label, ok: false }); console.log(`  [SKIP] ${observer.label}: no observation available today (${obs.reason || 'summary file missing'})`); continue; }
    const elapsed = Date.now() - started;
    const observedAt = isoWithOffset(new Date());

    const v = truth && !error ? target.judge({ obs, sealed, truth, MK: MKr })
      : { reached: 'discover', stopped: 'discover', pass: false, checks: [], falseCompletion: false, instrument: instrumentBefore || (/timeout_s/.test(String(error)) ? 'timeout' : 'other') };
    if (error && !v.instrument) v.instrument = 'other';
    log({ role: 'harness', event: 'assert', stage_reached: v.reached, stage_stopped: v.stopped, pass: v.pass, checks: v.checks, false_completion: v.falseCompletion, instrument_error: v.instrument, error, metrics: { elapsed_ms: elapsed } });

    const observerStr = observer.id === 'kansei_harness' ? OBSERVER : `${observer.id}@${obs.cliVersion || 'unknown'}`;
    const model = obs.model || observer.model || observer.provider || 'none';
    const reading = {
      reading_id: newUlid(), claim: MK.claim, marker_id: MK.marker_id, expected_digest: sealedCommon.digest,
      target: { service_id: PACK.service_id, model, harness_version: HARNESS_VERSION },
      stage_reached: v.reached, stage_stopped: v.stopped,
      observed: { pass: v.pass, method: target.method, checks: v.checks, false_completion: v.falseCompletion, ground_truth_consistent: gtConsistent, instrument_error: v.instrument, trap_armed: false },
      evidence_ref: `${bundleRel}#sha256:PENDING`, observer: observerStr, kind: 'synthetic', observed_at: observedAt, supersedes: flags.supersedes || null,
      _outcome: { success: v.pass ? 1 : 0, latency_ms: elapsed, error_type: v.instrument ? `instrument_${v.instrument}` : (v.stopped ? `stage_${v.stopped}` : null), model_name: model, failed_step: v.stopped, verification_status: v.instrument ? 'unverified' : 'assertion_verified', context_masked: `[marker ${MK.marker_id}] observer=${observer.label} stage_reached=${v.reached} stage_stopped=${v.stopped ?? 'none'} false_completion=${v.falseCompletion}` },
    };
    readings.push(reading);
    runRows.push({ observer: observer.label, model, stage_reached: v.reached, stage_stopped: v.stopped, pass: v.pass, false_completion: v.falseCompletion, instrument_error: v.instrument, elapsed_ms: elapsed });
    const tag = v.instrument ? 'INST' : v.pass ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${observer.label}: reached=${v.reached} stopped=${v.stopped ?? '-'} ${(elapsed / 1000).toFixed(1)}s${v.falseCompletion ? ' ⚠️false-completion' : ''}${error ? ' ERR:' + String(error).slice(0, 80) : ''}`);
  }

  // ---- bundle ----
  writeFileSync(join(bundleDir, 'environment.private.json'), JSON.stringify(privateEnvironment, null, 1));
  const libs = {};
  for (const f of ['marker-sealed.mjs', 'marker-generic.mjs', 'marker-targets.mjs', 'marker-persist.mjs', 'llm-ask.mjs', 'reading.mjs', 'marker-bundle.mjs', 'marker-store.mjs']) libs[`lib/${f}`] = fileSha(join(libDir, f));
  const manifest = {
    bundle: `marker-${MK.marker_id}`, generated_at_utc: new Date().toISOString(), generated_at_local: isoWithOffset(new Date()),
    pack: { id: PACK.id, version: PACK.version, sha256: fileSha(packPath) },
    executor: { file: 'run-marker.mjs', version: VERSION, sha256: fileSha(join(libDir, '..', 'run-marker.mjs')), libs, git_head: HARNESS_VERSION.split('+')[1] },
    marker: { marker_id: MK.marker_id, kind: 'synthetic', kind_of_truth: MK.kind_of_truth, observation: MK.observation || null, expected_digest: sealedCommon.digest, commitment_file: MK.commitment_file, commitment_commit: sealedCommon.commitSha, commitment_remote_branches: sealedCommon.remoteBranches, sealed_at: sealedCommon.sealedAt, expires_at: sealedCommon.expiresAt, expired_at_run: sealedCommon.expired, ground_truth_consistent: gtConsistent },
    environment: { node: process.version, executor: flags.executor, dry_run: flags.dry, max_readings: flags.maxReadings, allow_expired: flags.allowExpired, observers: observers.map((o) => o.label), display_api_url: MKr.display_api_url || null, fetch_check_dir: MKr.fetch_check_dir || null, providers: MKr.providers || null },
    models: Object.fromEntries(runRows.map((r) => [r.observer, r.model])),
    note: 'harness-only ground truth; judgement is rule-based (no model grades a model); one reading per observer; subject values (endpoints, page bodies, answer texts) only in transcript.jsonl (git-ignored); synthetic readings never enter public statistics',
    files: [],
  };
  const manifestSha = writeMarkerBundle({ bundleDir, bundleRel, manifest, files, readings, metrics: { pack: PACK.id, pack_version: PACK.version, marker_id: MK.marker_id, kind: 'synthetic', date: stamp, dry_run: flags.dry, runs: runRows } });

  for (const r of readings) {
    const { _outcome, ...pure } = r;
    const errs = validateReading(pure, schema);
    if (errs.length) { console.error(`reading ${r.reading_id} violates reading.v1 schema:\n  ${errs.join('\n  ')}`); process.exit(1); }
  }

  if (db) persistReadings({ db, readings, MK, PACK, sealedDigest: sealedCommon.digest, maxReadings: flags.maxReadings, schemasDir: join(libDir, '..', 'schemas') });
  const readmePath = flags.readme || (MK.report_readme ? join(KANSEI_ROOT, MK.report_readme) : null);
  if (!flags.dry && readmePath) appendReadme({ readmePath, readings });
  console.log(`evidence: ${bundleRel}/ (manifest sha256 ${manifestSha.slice(0, 12)}…)`);
  return { readings, bundleRel, manifestSha };
}
