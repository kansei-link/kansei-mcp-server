#!/usr/bin/env node
/**
 * run-marker — flow a sealed marker (dye) through the agent path and record
 * one reading line per run (docs/READING-PREDICATE-v1.md).
 *
 *   node exec-harness/run-marker.mjs taskpacks/freee/freee-accounting-m001-monthly-deal-count.v1.json \
 *        --models claude --runs 1 [--lang ja] [--dry-run] [--db <path>] [--readme <path>]
 *
 * What it refuses to do (exit codes):
 *   2  KANSEI_DB_PATH / sealed path / DB not initialised (run scripts/init-marker-db.mts)
 *   3  sealed file has FILL_ME_ placeholders, or its sha256 differs from the public commitment
 *   4  the commitment commit is not on any remote branch (readings before publication do not count)
 *   1  instrument error before any reading could be written
 *
 * What it never does: show the model the sealed file or the scripted steps;
 * expose freee write tools (R0 allowlist, tool definitions hidden); write
 * tenant identifiers, counts or amounts to metrics.json, manifest.json, the
 * DB reading, or the README table (raw values exist only in transcript.jsonl,
 * which .gitignore keeps out of git, and in the sealed file).
 *
 * --dry-run: performs every check and the run, writes the Evidence Bundle under
 * evidence/_dryrun/, but writes nothing to the DB or the README.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { McpClient, textOf, extractJson } from './lib/mcp-client.mjs';
import { judge, isErrorResult, isSwitchOk } from './lib/marker-judge.mjs';
import { writeMarkerBundle } from './lib/marker-bundle.mjs';
import { LOOPS } from './lib/provider-loops.mjs';
import { newUlid, validateReading, loadReadingSchema, isoWithOffset, sqliteUtc } from './lib/reading.mjs';

const VERSION = '0.2.0';
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');                 // repo root (worktree)
const KANSEI_ROOT = join(ROOT, '..');           // C:\Users\HP\KanseiLINK — founder-ops lives here, outside the repo
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileSha = (p) => sha256(readFileSync(p));

// ---- CLI ----
const args = process.argv.slice(2);
const packArg = args.find((a) => !a.startsWith('--'));
if (!packArg) { console.error('usage: node exec-harness/run-marker.mjs <taskpack.json> [--models claude] [--runs 1] [--lang ja|en] [--dry-run] [--db <path>] [--readme <path>]'); process.exit(1); }
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MODELS = flag('models', 'claude').split(',');
const RUNS = Number(flag('runs', 1));
const LANG = flag('lang', 'ja');
const DRY = args.includes('--dry-run');
// --arm-trap: before the agent runs, move freee-mcp's current company to a random
// test company (never the sealed one) so that choosing the production company is
// actually exercised; the original selection is restored in `finally`. The trap
// company's id is never recorded (only the boolean observed.trap_armed).
const ARM_TRAP = args.includes('--arm-trap');
// --max-readings N: refuse to run once N effective agent readings exist for this marker (default: pack marker.max_readings, else 7).
const MAX_READINGS_FLAG = flag('max-readings', null);
// --executor agent|empty: `empty` does everything except run a model (ground truth,
// trap arming, restore, bundle). Used by scripts/smoke-run-marker.mts.
const EXECUTOR = flag('executor', 'agent');
// --mcp "<command> [args...]" (or KANSEI_MCP_COMMAND): the MCP server to drive.
// Default is the real freee-mcp; smoke tests point it at exec-harness/fixtures/fake-freee-mcp.mjs.
const MCP_COMMAND = (flag('mcp', process.env.KANSEI_MCP_COMMAND || 'npx freee-mcp')).split(/\s+/).filter(Boolean);
// past expires_at the run stops by default (contents may be disclosed); --allow-expired overrides.
const ALLOW_EXPIRED = args.includes('--allow-expired');

// ---- .env (repo root, git-ignored) ----
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ---- pack ----
const packPath = resolve(ROOT, 'exec-harness', packArg.replace(/^exec-harness[\\/]/, ''));
const PACK = JSON.parse(readFileSync(packPath, 'utf8'));
const MK = PACK.marker;
if (!MK?.marker_id || !MK.commitment_file || !MK.sealed_path_env || !MK.expected_digest) { console.error('taskpack has no complete marker block'); process.exit(1); }
const MAX_READINGS = Number(MAX_READINGS_FLAG ?? MK.max_readings ?? 7);
const HARNESS_VERSION = (() => { let g = '0000000'; try { g = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* not a repo */ } return `run-marker@${VERSION}+${g}`; })();
const OBSERVER = `kansei_harness@run-marker@${VERSION}`;

const R0_TOOL_ALLOWLIST = new Set([
  'freee_server_info', 'freee_auth_status', 'freee_current_user',
  'freee_list_companies', 'freee_get_current_company', 'freee_api_get', 'freee_api_list_paths',
  // Pack-declared extras. M-001 adds freee_set_current_company: freee-mcp refuses any
  // freee_api_get whose company_id differs from its persisted "current company", so
  // choosing the production company REQUIRES the switch. It changes only freee-mcp's
  // local config.json (no freee data); the harness restores the original selection.
  ...(MK.tools_allowlist_extra || []),
]);

/* ================= 1. sealed file: fingerprint only ================= */
function loadSealed() {
  const sealedPath = process.env[MK.sealed_path_env];
  if (!sealedPath || !existsSync(sealedPath)) { console.error(`sealed file not found: set ${MK.sealed_path_env} in .env`); process.exit(2); }
  const raw = readFileSync(sealedPath);
  const text = raw.toString('utf8');
  if (text.includes('FILL_ME_')) { console.error('sealed file still has FILL_ME_ placeholders — refusing to run (HANDOFF §2)'); process.exit(3); }
  const digest = sha256(raw);
  const commitmentPath = join(ROOT, MK.commitment_file);
  if (!existsSync(commitmentPath)) { console.error(`commitment file missing: ${MK.commitment_file}`); process.exit(3); }
  const committed = readFileSync(commitmentPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => /^[0-9a-f]{64}\s+\S+/.test(l))?.split(/\s+/)[0];
  if (!committed) { console.error('commitment file has no sha256 line'); process.exit(3); }
  if (digest !== committed || digest !== MK.expected_digest) {
    console.error(`sealed file sha256 does not match the public commitment\n  sealed    : ${digest}\n  committed : ${committed}\n  taskpack  : ${MK.expected_digest}\nRefusing to run.`);
    process.exit(3);
  }
  let sealed; try { sealed = JSON.parse(text); } catch { console.error('sealed file is not JSON'); process.exit(3); }
  const problems = [];
  // The sealed file is fingerprinted, so it cannot be normalised in place: accept
  // integers written either as JSON numbers or as digit strings ("12345").
  const asInt = (v) => (typeof v === 'number' && Number.isInteger(v)) ? v : (typeof v === 'string' && /^\d+$/.test(v.trim())) ? Number(v.trim()) : NaN;
  sealed.real_company_id = asInt(sealed.real_company_id);
  if (sealed.expected) sealed.expected.deal_count = asInt(sealed.expected.deal_count);
  if (sealed.marker_id !== MK.marker_id) problems.push('marker_id');
  if (!(Number.isInteger(sealed.real_company_id) && sealed.real_company_id > 0)) problems.push('real_company_id');
  if (!(Number.isInteger(sealed.expected?.deal_count) && sealed.expected.deal_count >= 0)) problems.push('expected.deal_count');
  const pm = String(sealed.expected?.period || '').match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!pm) problems.push('expected.period');
  if (problems.length) { console.error(`sealed file fields invalid: ${problems.join(', ')} (values withheld)`); process.exit(3); }
  const expired = sealed.expires_at ? Date.now() > Date.parse(sealed.expires_at) : false;
  if (expired && !ALLOW_EXPIRED) { console.log(`sealed marker is past expires_at (${sealed.expires_at}); contents may be disclosed, so the run stops by default (use --allow-expired to override). Nothing written.`); process.exit(0); }
  if (expired) console.warn(`[warn] sealed marker is past expires_at (${sealed.expires_at}); continuing because --allow-expired was given. Flagged in manifest.`);
  // commitment publication (HANDOFF T2: readings before the public fingerprint do not count)
  let commitSha = null, remoteBranches = '';
  try {
    commitSha = execSync(`git log -n1 --format=%H -- "${MK.commitment_file}"`, { cwd: ROOT }).toString().trim() || null;
    if (commitSha) remoteBranches = execSync(`git branch -r --contains ${commitSha}`, { cwd: ROOT }).toString().trim();
  } catch { /* handled below */ }
  if (!commitSha || !remoteBranches) {
    const msg = `commitment ${MK.commitment_file} is not on any remote branch (commit ${commitSha || 'none'}) — readings before publication do not count`;
    if (DRY) console.warn(`[warn] ${msg} (continuing: --dry-run)`); else { console.error(msg); process.exit(4); }
  }
  return {
    realCompanyId: sealed.real_company_id,
    expectedCount: sealed.expected.deal_count,
    periodStart: pm[1], periodEnd: pm[2],
    digest, commitSha, remoteBranches: remoteBranches.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    sealedAt: sealed.sealed_at || null, expiresAt: sealed.expires_at || null, expired,
  };
}

/* ================= 2. DB ================= */
function openDb() {
  if (DRY) return null;
  const dbPath = flag('db', process.env.KANSEI_DB_PATH);
  if (!dbPath) { console.error('KANSEI_DB_PATH is required (dedicated marker DB); refusing to guess'); process.exit(2); }
  if (!existsSync(dbPath)) { console.error(`DB not found: ${dbPath}\n  run:  npx tsx scripts/init-marker-db.mts`); process.exit(2); }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!has('outcomes') || !has('services')) { console.error('DB not initialised (outcomes/services missing). run: npx tsx scripts/init-marker-db.mts'); process.exit(2); }
  if (!db.prepare('SELECT 1 FROM services WHERE id=?').get(PACK.service_id)) { console.error(`service '${PACK.service_id}' missing from services; run scripts/init-marker-db.mts`); process.exit(2); }
  db.exec(readFileSync(join(__dir, 'schemas', 'marker_readings.sql'), 'utf8'));
  // --max-readings: count effective agent readings (outcome-backed, not superseded)
  const have = db.prepare(`SELECT COUNT(*) AS n FROM marker_readings r
     WHERE r.marker_id = ? AND r.outcome_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM marker_readings s WHERE s.supersedes = r.reading_id)`).get(MK.marker_id).n;
  if (Number.isFinite(MAX_READINGS) && have >= MAX_READINGS) {
    console.log(`marker ${MK.marker_id} already has ${have} effective reading(s) (max ${MAX_READINGS}); not running. Nothing written.`);
    db.close(); process.exit(0);
  }
  console.log(`readings so far: ${have}/${MAX_READINGS}`);
  return db;
}

/* ================= 3. ground truth (harness direct reads; never shown to the model) ================= */
// freee-mcp renders API errors as Japanese text (e.g. "APIリクエストエラー: company_id の不整合 …",
// "パス検証エラー: …") or as {"error": …} when the JSON-RPC call itself fails.
async function readCurrentCompany(callToolRaw) {
  const raw = await callToolRaw('freee_get_current_company', {});
  return Number((String(raw).match(/ID[:：]\s*(\d+)/i) || [])[1]) || null;
}

/** freee-mcp only serves the persisted current company: switch, read, switch back. */
async function fetchGroundTruth(callToolRaw, sealed, harnessLog) {
  const currentId = await readCurrentCompany(callToolRaw);
  const companiesRaw = await callToolRaw('freee_api_get', { service: 'accounting', path: '/api/1/companies' });
  const cj = extractJson(companiesRaw);
  let ownIds = (cj?.companies || []).map((c) => Number(c.id)).filter((n) => Number.isInteger(n) && n > 0);
  if (!ownIds.length) ownIds = [...String(companiesRaw).matchAll(/"id"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
  if (!ownIds.length) throw new Error('cannot extract company list (output withheld)');
  // The sealed key may be the API `id` (8 digits) or freee's 事業所番号 `company_number`
  // (10 digits, shown in the freee UI). Both identify exactly one company; resolve
  // the latter to the API id and record which kind was used (manifest.sealed_key_kind).
  const numbers = new Map((cj?.companies || []).map((c) => [String(c.company_number ?? ''), Number(c.id)]));
  sealed.keyKind = 'id';
  if (!ownIds.includes(sealed.realCompanyId)) {
    const viaNumber = numbers.get(String(sealed.realCompanyId));
    if (Number.isInteger(viaNumber) && [...numbers.values()].filter((v) => v === viaNumber).length === 1) {
      sealed.realCompanyNumber = sealed.realCompanyId;
      sealed.realCompanyId = viaNumber;
      sealed.keyKind = 'company_number';
      harnessLog({ event: 'sealed_key_resolved', kind: 'company_number' });
    }
  }
  const sealedIsOwn = ownIds.includes(sealed.realCompanyId);
  if (!sealedIsOwn) throw new Error('sealed company is not among the companies visible to this token (neither as id nor as company_number)');
  // Trap candidates (--arm-trap): companies that look like test tenants, never the sealed one.
  // Kept in memory only; neither ids nor names are written anywhere.
  const looksTest = (c) => /テスト|test|未設定/i.test(String(c.display_name ?? c.name ?? ''));
  const nonSealed = (cj?.companies || []).filter((c) => Number(c.id) !== sealed.realCompanyId);
  const trapCandidates = (nonSealed.filter(looksTest).length ? nonSealed.filter(looksTest) : nonSealed).map((c) => Number(c.id));
  const needSwitch = currentId !== sealed.realCompanyId;
  let total = null;
  try {
    if (needSwitch) {
      const sw = await callToolRaw('freee_set_current_company', { company_id: String(sealed.realCompanyId) });
      harnessLog({ event: 'harness_switch_to_sealed_company', ok: isSwitchOk(sw) });
      if (!isSwitchOk(sw)) throw new Error('harness could not switch current company to the sealed one (output withheld)');
    }
    const dealsRaw = await callToolRaw('freee_api_get', { service: 'accounting', path: '/api/1/deals', query: { company_id: String(sealed.realCompanyId), start_issue_date: sealed.periodStart, end_issue_date: sealed.periodEnd, limit: '1' } });
    if (isErrorResult(dealsRaw)) throw new Error('harness direct deals read returned an error (output withheld)');
    const dj = extractJson(dealsRaw);
    total = dj?.meta?.total_count;
    if (total == null) { const m = String(dealsRaw).match(/total_count["']?\s*[:=]\s*(\d+)/); if (m) total = Number(m[1]); }
  } finally {
    if (needSwitch && currentId) {
      const back = await callToolRaw('freee_set_current_company', { company_id: String(currentId) });
      harnessLog({ event: 'harness_restore_current_company', ok: isSwitchOk(back) });
      if (!isSwitchOk(back)) console.error('[warn] harness could not restore the original current company — check freee-mcp config');
    }
  }
  if (!Number.isInteger(total)) throw new Error('cannot extract meta.total_count (output withheld)');
  return { currentId, ownIds, sealedIsOwn, harnessCount: total, needSwitch, trapCandidates };
}

/* ================= 4. least-privilege guard (pack-derived) ================= */
function deriveApiConstraints(pack) {
  const allowed = [];
  for (const st of pack.scripted_steps || []) {
    if (st.tool !== 'freee_api_get' || !st.arguments?.path) continue;
    const pattern = '^' + st.arguments.path.replace(/\{\{[^}]+\}\}/g, '\\d+').replace(/\//g, '\\/') + '$';
    allowed.push({ service: st.arguments.service, re: new RegExp(pattern) });
  }
  return allowed;
}

/* ================= 5. judgement (rule-based; docs/READING-PREDICATE-v1.md §3) ================= */
/* ================= 6. main ================= */
async function main() {
  const t0 = new Date();
  const goal = PACK.goal_prompt[LANG];
  console.log(`run-marker ${VERSION} — pack=${PACK.id} v${PACK.version} marker=${MK.marker_id} risk=${PACK.risk} lang=${LANG} models=${MODELS.join(',')} N=${RUNS}${DRY ? ' [DRY-RUN]' : ''}`);

  const sealed = loadSealed();
  console.log(`sealed digest ${sealed.digest.slice(0, 12)}… matches commitment; commitment commit ${sealed.commitSha ? sealed.commitSha.slice(0, 7) : 'none'} on ${sealed.remoteBranches.join(', ') || '(no remote branch)'}`);
  const db = openDb();
  const schema = loadReadingSchema();

  // Evidence Bundle dir (one per invocation; several runs a day never overwrite each other)
  const stamp = t0.toISOString().slice(0, 10);
  const hhmmss = isoWithOffset(t0).slice(11, 19).replace(/:/g, '');
  const bundleDir = join(ROOT, 'evidence', DRY ? '_dryrun' : PACK.service_id, stamp, `marker-${MK.marker_id.toLowerCase()}`, hhmmss);
  mkdirSync(bundleDir, { recursive: true });
  const bundleRel = relative(ROOT, bundleDir).replaceAll('\\', '/');
  const harnessLog = (e) => appendFileSync(join(bundleDir, 'harness.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');

  // MCP
  const mcp = new McpClient(MCP_COMMAND[0], MCP_COMMAND.slice(1));
  if (MCP_COMMAND.join(' ') !== 'npx freee-mcp') console.log(`mcp: ${MCP_COMMAND.join(' ')} (override)`);
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'kansei-run-marker', version: VERSION } });
  mcp.notify('notifications/initialized');
  const allTools = (await mcp.request('tools/list')).result?.tools || [];
  const tools = allTools.filter((t) => R0_TOOL_ALLOWLIST.has(t.name));
  const callToolRaw = async (name, targs) => {
    const r = await mcp.request('tools/call', { name, arguments: targs });
    return r.error ? JSON.stringify({ error: r.error.message }) : (textOf(r.result) || JSON.stringify(r.result));
  };

  const readings = [];
  const runRows = [];
  let truth = null, instrumentBefore = null, preflightOutputs = [], mcpVersion = null, gtConsistent = null;

  // Restore freee-mcp's persisted current company to what it was before this process
  // touched it. Called in every `finally` (per run and at process end); never throws.
  const restoreCurrent = async (where) => {
    if (!truth?.currentId) return;
    try {
      if ((await readCurrentCompany(callToolRaw)) === truth.currentId) { harnessLog({ event: 'restore_current_company', where, changed: false, ok: true }); return; }
      const back = await callToolRaw('freee_set_current_company', { company_id: String(truth.currentId) });
      harnessLog({ event: 'restore_current_company', where, changed: true, ok: isSwitchOk(back) });
      if (!isSwitchOk(back)) console.error(`[warn] could not restore the original current company (${where}) — check freee-mcp config`);
    } catch (e) { harnessLog({ event: 'restore_current_company', where, ok: false, note: String(e.message).slice(0, 80) }); }
  };

  try {
  if (!allTools.length) { instrumentBefore = 'mcp_process'; harnessLog({ event: 'mcp_tools_list_empty', stderr_head: mcp.stderr.slice(0, 300) }); }
  else {
    console.log(`tools exposed to agent (R0 allowlist): ${tools.map((t) => t.name).join(', ')}`);
    for (const pf of PACK.preflight || []) {
      const out = await callToolRaw(pf.tool, {});
      preflightOutputs.push(out);
      const bad = /"error"/.test(out) || (pf.tool === 'freee_auth_status' && /not authenticated|未認証|expired/i.test(out) && !/authenticated[^a-z]*(true|yes|済)/i.test(out));
      harnessLog({ event: 'preflight', tool: pf.tool, ok: !bad, head: out.slice(0, 160) });
      console.log(`preflight ${pf.tool}: ${out.slice(0, 100).replace(/\n/g, ' ')}`);
      if (bad) { instrumentBefore = 'mcp_process'; break; }
    }
    mcpVersion = (preflightOutputs.join(' ').match(/version[:\s]+([\d.]+)/i) || [])[1] || null;
    if (!instrumentBefore) {
      try { truth = await fetchGroundTruth(callToolRaw, sealed, harnessLog); }
      catch (e) { instrumentBefore = 'other'; harnessLog({ event: 'ground_truth_failed', message: String(e.message).slice(0, 200) }); console.error(`ground truth failed: ${e.message}`); }
    }
  }

  gtConsistent = truth ? truth.harnessCount === sealed.expectedCount : null;
  if (truth) {
    console.log(`ground truth: companies visible=${truth.ownIds.length}, sealed company visible=${truth.sealedIsOwn}, harness count vs sealed expectation: ${gtConsistent ? 'EQUAL' : 'DIFFERENT'}`);
    harnessLog({ event: 'ground_truth', companies_visible: truth.ownIds.length, sealed_is_own: truth.sealedIsOwn, consistent: gtConsistent });
    if (!gtConsistent) {
      // separate row: the sealed expectation and the harness direct read disagree (docs §3)
      readings.push({
        reading_id: newUlid(), claim: 'sealed expectation matches harness direct API read for the sealed company and period', marker_id: MK.marker_id,
        expected_digest: sealed.digest, target: { service_id: PACK.service_id, model: 'none', harness_version: HARNESS_VERSION },
        stage_reached: 'done', stage_stopped: null,
        observed: { pass: false, method: 'sealed_expectation_vs_harness_direct_api', checks: [{ label: 'harness_direct_count_equals_sealed_expectation', ok: false }], ground_truth_consistent: false, instrument_error: null },
        evidence_ref: `${bundleRel}#sha256:PENDING`, observer: OBSERVER, kind: 'synthetic', observed_at: isoWithOffset(new Date()), supersedes: null, _outcome: null,
      });
    }
  }

  // least-privilege guard: pack-derived paths, own-tenant company ids only, write tools hidden
  const apiConstraints = deriveApiConstraints(PACK);
  const guardViolations = [];
  const makeGuarded = (callLog) => async (name, targs) => {
    if (!R0_TOOL_ALLOWLIST.has(name)) { guardViolations.push({ name, reason: 'tool_not_permitted' }); return JSON.stringify({ error: `tool '${name}' is not permitted in this read-only (R0) session` }); }
    if (name === 'freee_set_current_company') {
      // Only companies visible to this token; the switch touches freee-mcp's local config, never freee data.
      const v = Number(String(targs?.company_id ?? '').trim());
      if (!(truth && truth.ownIds.includes(v))) {
        guardViolations.push({ name, reason: 'company_id_not_own' });
        const out = JSON.stringify({ error: 'company_id is not one of the companies visible to this account' });
        callLog.push({ name, args: targs, result: out }); return out;
      }
    }
    if (name === 'freee_api_get') {
      const path = String(targs?.path || '');
      const svcOk = apiConstraints.some((c) => c.service === targs?.service);
      const pathOk = apiConstraints.some((c) => c.service === targs?.service && c.re.test(path));
      const cid = targs?.query?.company_id ?? targs?.company_id;
      const cidOk = cid == null || (truth && truth.ownIds.includes(Number(cid)));
      if (!svcOk || !pathOk || !cidOk) {
        guardViolations.push({ name, reason: !cidOk ? 'company_id_not_own' : 'path_not_in_pack' });
        const out = JSON.stringify({ error: `request outside this task's permitted scope (service=${apiConstraints[0]?.service}, permitted paths only, own companies only)` });
        callLog.push({ name, args: targs, result: out }); return out;
      }
    }
    const out = await callToolRaw(name, targs);
    callLog.push({ name, args: targs, result: out });
    return out;
  };

  // --arm-trap: move the current company to a random test company (never the sealed one).
  // Returns { trapArmed, agentStartId }. The chosen id stays in memory only.
  const armTrap = async () => {
    let trapArmed = false, agentStartId = truth?.currentId ?? null;
    if (ARM_TRAP && truth && !instrumentBefore) {
      if (truth.currentId !== sealed.realCompanyId) { trapArmed = true; harnessLog({ event: 'trap_armed', ok: true, how: 'environment_already_on_another_company' }); }
      else if (truth.trapCandidates.length) {
        const pick = truth.trapCandidates[Math.floor(Math.random() * truth.trapCandidates.length)];
        const sw = await callToolRaw('freee_set_current_company', { company_id: String(pick) });
        trapArmed = isSwitchOk(sw);
        if (trapArmed) agentStartId = pick;
        harnessLog({ event: 'trap_armed', ok: trapArmed, how: 'harness_switched_to_random_test_company', candidates: truth.trapCandidates.length });
      } else harnessLog({ event: 'trap_armed', ok: false, how: 'no_candidate_company' });
    }
    return { trapArmed, agentStartId };
  };

  if (EXECUTOR === 'empty') {
    // Empty executor: arm the trap (if asked) and run no model. The only thing that
    // can put the current company back is the process_end `finally` below.
    const t = await armTrap();
    harnessLog({ event: 'executor_empty', trap_armed: t.trapArmed });
    console.log(`executor=empty: no model run (trap_armed=${t.trapArmed})`);
  }

  for (const providerName of (EXECUTOR === 'empty' ? [] : MODELS)) {
    const loop = LOOPS[providerName];
    if (!loop) { console.log(`skip unknown model ${providerName}`); continue; }
    for (let n = 1; n <= RUNS; n++) {
      const runDir = join(bundleDir, `${providerName}-n${n}`);
      mkdirSync(runDir, { recursive: true });
      const transcriptPath = join(runDir, 'transcript.jsonl');
      writeFileSync(transcriptPath, '');
      const log = (e) => appendFileSync(transcriptPath, JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');
      log({ role: 'harness', event: 'start', pack: PACK.id, pack_version: PACK.version, marker: MK.marker_id, provider: providerName, run: n, lang: LANG, tools: tools.map((t) => t.name) });

      const callLog = [];
      const violBefore = guardViolations.length;
      let run = { finalText: '', steps: 0, toolCalls: [], tokens: 0, model: providerName }, error = null;
      let trapArmed = false, agentStartId = truth?.currentId ?? null, started = Date.now();
      try {
        ({ trapArmed, agentStartId } = await armTrap());
        started = Date.now();
        if (instrumentBefore) error = `instrument:${instrumentBefore}`;
        else {
          try {
            run = await Promise.race([
              loop(goal, tools, makeGuarded(callLog), PACK.budgets, log),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timeout_s exceeded')), PACK.budgets.timeout_s * 1000)),
            ]);
          } catch (e) { error = e.message; }
        }
      } finally {
        // Whatever happened (trap, agent switch, exception), put the original selection back.
        await restoreCurrent(`after_run_${providerName}_n${n}`);
      }
      const elapsed = Date.now() - started;
      const observedAt = isoWithOffset(new Date());

      const v = truth ? judge({ finalText: run.finalText, callLog, error, budgetExceeded: Boolean(run.budget_exceeded), truth, sealed, agentStartId })
        : { reached: 'discover', stopped: 'discover', pass: false, checks: [], falseCompletion: false, instrument: instrumentBefore || 'other' };
      if (error && !v.instrument) v.instrument = 'other';
      log({ role: 'harness', event: 'assert', stage_reached: v.reached, stage_stopped: v.stopped, pass: v.pass, checks: v.checks, false_completion: v.falseCompletion, instrument_error: v.instrument, trap_armed: trapArmed, guard_violations: guardViolations.slice(violBefore), error, metrics: { steps: run.steps, tool_calls: callLog.length, provider_reported_tokens: run.tokens, elapsed_ms: elapsed } });

      const reading = {
        reading_id: newUlid(), claim: MK.claim, marker_id: MK.marker_id, expected_digest: sealed.digest,
        target: { service_id: PACK.service_id, model: run.model || providerName, harness_version: HARNESS_VERSION },
        stage_reached: v.reached, stage_stopped: v.stopped,
        observed: { pass: v.pass, method: 'harness_direct_api_vs_sealed_expectation', checks: v.checks, false_completion: v.falseCompletion, ground_truth_consistent: gtConsistent, instrument_error: v.instrument, trap_armed: trapArmed },
        evidence_ref: `${bundleRel}#sha256:PENDING`, observer: OBSERVER, kind: 'synthetic', observed_at: observedAt, supersedes: null,
        _outcome: { success: v.pass ? 1 : 0, latency_ms: elapsed, error_type: v.instrument ? `instrument_${v.instrument}` : (v.stopped ? `stage_${v.stopped}` : null), model_name: run.model || providerName, failed_step: v.stopped, verification_status: v.instrument ? 'unverified' : 'assertion_verified', context_masked: `[marker ${MK.marker_id}] stage_reached=${v.reached} stage_stopped=${v.stopped ?? 'none'} false_completion=${v.falseCompletion}` },
      };
      readings.push(reading);
      runRows.push({ provider: providerName, run: n, model: reading.target.model, stage_reached: v.reached, stage_stopped: v.stopped, pass: v.pass, false_completion: v.falseCompletion, instrument_error: v.instrument, steps: run.steps, tool_calls: callLog.length, guard_violations: guardViolations.length - violBefore, provider_reported_tokens: run.tokens, elapsed_ms: elapsed, budget_exceeded: Boolean(run.budget_exceeded) });
      const tag = v.instrument ? 'INST' : v.pass ? 'PASS' : 'FAIL';
      console.log(`  [${tag}] ${providerName} n${n}: reached=${v.reached} stopped=${v.stopped ?? '-'} steps=${run.steps} calls=${callLog.length} ${(elapsed / 1000).toFixed(1)}s${v.falseCompletion ? ' ⚠️false-completion' : ''}${error ? ' ERR:' + String(error).slice(0, 80) : ''}`);

    }
  }
  } finally {
    await restoreCurrent('process_end');
    mcp.kill();
  }

  // ---- manifest (no tenant values) ----
  const files = ['metrics.json', 'harness.jsonl'];
  for (const p of MODELS) for (let n = 1; n <= RUNS; n++) { const f = `${p}-n${n}/transcript.jsonl`; if (existsSync(join(bundleDir, f))) files.push(f); }
  const manifest = {
    bundle: `marker-${MK.marker_id}`, generated_at_utc: new Date().toISOString(), generated_at_local: isoWithOffset(new Date()),
    pack: { id: PACK.id, version: PACK.version, sha256: fileSha(packPath) },
    executor: { file: 'run-marker.mjs', version: VERSION, sha256: fileSha(fileURLToPath(import.meta.url)), libs: { 'lib/mcp-client.mjs': fileSha(join(__dir, 'lib', 'mcp-client.mjs')), 'lib/provider-loops.mjs': fileSha(join(__dir, 'lib', 'provider-loops.mjs')), 'lib/reading.mjs': fileSha(join(__dir, 'lib', 'reading.mjs')), 'lib/marker-judge.mjs': fileSha(join(__dir, 'lib', 'marker-judge.mjs')), 'lib/marker-bundle.mjs': fileSha(join(__dir, 'lib', 'marker-bundle.mjs')) }, git_head: HARNESS_VERSION.split('+')[1] },
    marker: { marker_id: MK.marker_id, kind: 'synthetic', expected_digest: sealed.digest, commitment_file: MK.commitment_file, commitment_commit: sealed.commitSha, commitment_remote_branches: sealed.remoteBranches, sealed_at: sealed.sealedAt, expires_at: sealed.expiresAt, expired_at_run: sealed.expired, sealed_key_kind: sealed.keyKind ?? null, ground_truth_consistent: gtConsistent, sealed_company_visible_to_token: truth ? truth.sealedIsOwn : null, companies_visible_to_token: truth ? truth.ownIds.length : null, sealed_company_was_current_at_start: truth ? !truth.needSwitch : null },
    environment: { freee_mcp_version: mcpVersion, tool_schema_sha256: sha256(JSON.stringify(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })))), node: process.version, dry_run: DRY, arm_trap: ARM_TRAP, max_readings: MAX_READINGS, allow_expired: ALLOW_EXPIRED },
    models: Object.fromEntries(runRows.map((r) => [r.provider, r.model])),
    note: 'goal-prompt-only; sealed file and scripted steps never shown to the model; R0 tool allowlist + pack-derived least-privilege guard (permitted paths, own companies only); judgement is rule-based against the harness direct read and the sealed expectation; tenant identifiers, counts and amounts withheld from every committed file (raw values only in transcript.jsonl, which is git-ignored)',
    files: [],
  };
  const manifestSha = writeMarkerBundle({
    bundleDir, bundleRel, manifest, files, readings,
    metrics: { pack: PACK.id, pack_version: PACK.version, marker_id: MK.marker_id, kind: 'synthetic', date: stamp, lang: LANG, dry_run: DRY, runs: runRows },
  });

  // ---- validate every reading against the schema before anything is stored ----
  for (const r of readings) {
    const { _outcome, ...pure } = r;
    const errs = validateReading(pure, schema);
    if (errs.length) { console.error(`reading ${r.reading_id} violates reading.v1 schema:\n  ${errs.join('\n  ')}`); process.exit(1); }
  }

  // ---- DB (append-only) ----
  if (db) {
    const insOutcome = db.prepare(`INSERT INTO outcomes (service_id, agent_id_hash, success, latency_ms, error_type, context_masked, provenance, verification_status, model_name, agent_type, task_type, failed_step, created_at)
      VALUES (?, 'kansei-marker-harness', ?, ?, ?, ?, 'synthetic', ?, ?, 'harness', ?, ?, ?)`);
    const insReading = db.prepare(`INSERT INTO marker_readings (reading_id, outcome_id, claim, marker_id, expected_digest, target_json, stage_reached, stage_stopped, observed_json, evidence_ref, observer, kind, observed_at, supersedes)
      VALUES (@reading_id, @outcome_id, @claim, @marker_id, @expected_digest, @target_json, @stage_reached, @stage_stopped, @observed_json, @evidence_ref, @observer, @kind, @observed_at, @supersedes)`);
    db.transaction(() => {
      for (const r of readings) {
        let outcomeId = null;
        if (r._outcome) {
          const o = r._outcome;
          outcomeId = insOutcome.run(PACK.service_id, o.success, o.latency_ms, o.error_type, o.context_masked, o.verification_status, o.model_name, `marker:${MK.marker_id}`, o.failed_step, sqliteUtc(new Date(r.observed_at))).lastInsertRowid;
        }
        insReading.run({ reading_id: r.reading_id, outcome_id: outcomeId, claim: r.claim, marker_id: r.marker_id, expected_digest: r.expected_digest, target_json: JSON.stringify(r.target), stage_reached: r.stage_reached, stage_stopped: r.stage_stopped, observed_json: JSON.stringify(r.observed), evidence_ref: r.evidence_ref, observer: r.observer, kind: r.kind, observed_at: r.observed_at, supersedes: r.supersedes });
      }
    })();
    const leak = db.prepare(`SELECT COUNT(*) AS n FROM publishable_outcomes WHERE task_type = ?`).get(`marker:${MK.marker_id}`);
    console.log(`db: ${readings.length} reading(s) appended; publishable_outcomes rows for this marker = ${leak.n} (must be 0)`);
    if (leak.n !== 0) { console.error('QUARANTINE BREACH: synthetic marker rows visible in publishable_outcomes'); process.exit(1); }
    db.close();
  }

  // ---- README seven-row table (founder-ops, outside the repo) ----
  const readmePath = flag('readme', process.env.KANSEI_M001_REPORT_README || join(KANSEI_ROOT, 'founder-ops', 'research', 'Marker-M001_2026-09-24', 'README.md'));
  if (!DRY && existsSync(readmePath)) {
    let md = readFileSync(readmePath, 'utf8');
    const append = (marker, rowsText) => { const i = md.indexOf(marker); if (i < 0) return false; md = md.slice(0, i) + rowsText + md.slice(i); return true; };
    const agentRows = readings.filter((r) => r._outcome).map((r) => `| ${r.observed_at.slice(0, 10)} | ${r.reading_id} | ${r.stage_reached} | ${r.stage_stopped ?? '—'} | ${r.observed.instrument_error ? `計器:${r.observed.instrument_error}` : r.observed.pass ? 'pass' : 'fail'}${r.observed.false_completion ? '（自称成功）' : ''} | ${r.evidence_ref} |\n`).join('');
    const gtRows = readings.filter((r) => !r._outcome).map((r) => `| ${r.observed_at.slice(0, 10)} | ${r.reading_id} | 不一致 | ${r.evidence_ref} |\n`).join('');
    const ok1 = agentRows ? append('<!-- seven-rows:end -->', agentRows) : true;
    const ok2 = gtRows ? append('<!-- gt-rows:end -->', gtRows) : true;
    if (ok1 && ok2) { writeFileSync(readmePath, md); console.log(`readme: appended ${readings.length} row(s) to ${readmePath}`); }
    else console.warn('[warn] README table markers not found; rows not appended');
  } else if (!DRY) console.warn(`[warn] README not found at ${readmePath}; rows not appended`);

  console.log(`evidence: ${bundleRel}/ (manifest sha256 ${manifestSha.slice(0, 12)}…)`);
}

main().catch((e) => { console.error('RUN-MARKER ERROR:', e); process.exit(1); });
