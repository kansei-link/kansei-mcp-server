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
import { LOOPS } from './lib/provider-loops.mjs';
import { newUlid, validateReading, loadReadingSchema, isoWithOffset, sqliteUtc } from './lib/reading.mjs';

const VERSION = '0.1.0';
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
  if (expired) console.warn(`[warn] sealed marker is past expires_at (${sealed.expires_at}); contents may be disclosed. Readings continue and are flagged in manifest.`);
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
  return db;
}

/* ================= 3. ground truth (harness direct reads; never shown to the model) ================= */
// freee-mcp renders API errors as Japanese text (e.g. "APIリクエストエラー: company_id の不整合 …",
// "パス検証エラー: …") or as {"error": …} when the JSON-RPC call itself fails.
const isErrorResult = (s) => /^\s*\{\s*"error"/.test(String(s)) || /\b(401|403)\b|Unauthorized|Forbidden|status_code"?\s*:\s*4\d\d|アクセス権限|APIリクエストエラー|パス検証エラー|APIエラー|不整合/i.test(String(s));
const isSwitchOk = (s) => !isErrorResult(s) && !/失敗|エラー|error/i.test(String(s));

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
  return { currentId, ownIds, sealedIsOwn, harnessCount: total, needSwitch };
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
const numRe = (n) => new RegExp(`(?<![\\d,])${n}(?![\\d,])`);
const pathOf = (c) => String(c.args?.path || '');

/** Annotate each call with the company freee-mcp would serve at that moment
 *  (its persisted "current company", moved only by successful switches). */
function annotateCurrent(callLog, truth) {
  let current = truth.currentId;
  for (const c of callLog) {
    c.current_before = current;
    if (c.name === 'freee_set_current_company' && isSwitchOk(c.result)) { const v = Number(c.args?.company_id); if (Number.isInteger(v)) current = v; }
    c.current_after = current;
  }
  return current;
}
const companyOf = (c) => { const v = c.args?.query?.company_id ?? c.args?.company_id; return v == null ? c.current_before : Number(v); };

function judge({ finalText, callLog, error, budgetExceeded, truth, sealed }) {
  const text = String(finalText || '');
  const realId = sealed.realCompanyId;
  const calledAny = callLog.length > 0;
  annotateCurrent(callLog, truth);
  const dealsCalls = callLog.filter((c) => c.name === 'freee_api_get' && /^\/api\/1\/deals$/.test(pathOf(c)));
  const lookedAtCompanies = callLog.some((c) => c.name === 'freee_list_companies' || (c.name === 'freee_api_get' && /^\/api\/1\/companies/.test(pathOf(c))));
  const switchedToReal = callLog.some((c) => c.name === 'freee_set_current_company' && Number(c.args?.company_id) === realId && isSwitchOk(c.result));
  // Naming the sealed company by its 事業所番号 (company_number) counts as naming it.
  const realNumberMentioned = sealed.realCompanyNumber != null && numRe(sealed.realCompanyNumber).test(text);
  const mentioned = truth.ownIds.filter((id) => numRe(id).test(text));
  if (realNumberMentioned && !mentioned.includes(realId)) mentioned.push(realId);
  const lastDeals = dealsCalls[dealsCalls.length - 1];
  const lastUsed = lastDeals ? companyOf(lastDeals) : null;
  let answeredOk;
  if (mentioned.length === 1) answeredOk = mentioned[0] === realId;
  else if (mentioned.length > 1) answeredOk = mentioned.includes(realId) && lastUsed === realId;
  else answeredOk = lastUsed === realId;
  const realDeals = dealsCalls.filter((c) => companyOf(c) === realId);
  const realDealsOk = realDeals.some((c) => !isErrorResult(c.result));
  const periodOk = realDeals.some((c) => c.args?.query?.start_issue_date === sealed.periodStart && c.args?.query?.end_issue_date === sealed.periodEnd);
  const idInAnswer = numRe(realId).test(text) || realNumberMentioned;
  const countInAnswer = numRe(truth.harnessCount).test(text);

  let reached, stopped;
  if (!calledAny) { reached = 'discover'; stopped = 'discover'; }
  else if (!answeredOk) { reached = 'understand'; stopped = 'understand'; }
  else if (!realDealsOk) { reached = 'connect'; stopped = 'connect'; }
  else if (budgetExceeded || !(idInAnswer && countInAnswer)) { reached = 'execute'; stopped = 'execute'; }
  else { reached = 'done'; stopped = null; }

  const checks = [
    { label: 'called_any_read_tool', ok: calledAny },
    { label: 'looked_at_company_list', ok: lookedAtCompanies },
    { label: 'switched_to_sealed_company', ok: switchedToReal },
    { label: 'deals_call_used_sealed_company', ok: dealsCalls.length > 0 && lastUsed === realId },
    { label: 'deals_call_used_sealed_period', ok: periodOk },
    { label: 'deals_call_for_sealed_company_returned_without_error', ok: realDealsOk },
    { label: 'final_answer_names_sealed_company', ok: idInAnswer && answeredOk },
    { label: 'final_answer_count_matches_harness_direct_read', ok: countInAnswer },
  ];
  const pass = reached === 'done';
  const claimsSuccess = /完了|できました|確認しました|取得しました|件です|件でした|successfully|retrieved|confirmed|the count is/i.test(text);
  const falseCompletion = !pass && !error && claimsSuccess;

  let instrument = null;
  if (error) {
    instrument = /quota|rate.?limit|429|overloaded|529|not_found|model|invalid_request|authentication|api key|ECONNRE|fetch failed|ENOTFOUND/i.test(error) ? 'provider_api'
      : /timeout_s exceeded/.test(error) ? 'timeout' : 'other';
    reached = calledAny ? (dealsCalls.length ? 'connect' : 'understand') : 'discover';
    stopped = reached;
  }
  return { reached, stopped, pass: pass && !error, checks, falseCompletion, instrument };
}

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
  const mcp = new McpClient('npx', ['freee-mcp']);
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'kansei-run-marker', version: VERSION } });
  mcp.notify('notifications/initialized');
  const allTools = (await mcp.request('tools/list')).result?.tools || [];
  const tools = allTools.filter((t) => R0_TOOL_ALLOWLIST.has(t.name));
  const callToolRaw = async (name, targs) => {
    const r = await mcp.request('tools/call', { name, arguments: targs });
    return r.error ? JSON.stringify({ error: r.error.message }) : (textOf(r.result) || JSON.stringify(r.result));
  };

  const readings = [];
  let truth = null, instrumentBefore = null, preflightOutputs = [], mcpVersion = null;

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

  const gtConsistent = truth ? truth.harnessCount === sealed.expectedCount : null;
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

  const runRows = [];
  for (const providerName of MODELS) {
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
      const started = Date.now();
      let run = { finalText: '', steps: 0, toolCalls: [], tokens: 0, model: providerName }, error = null;
      if (instrumentBefore) error = `instrument:${instrumentBefore}`;
      else {
        try {
          run = await Promise.race([
            loop(goal, tools, makeGuarded(callLog), PACK.budgets, log),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout_s exceeded')), PACK.budgets.timeout_s * 1000)),
          ]);
        } catch (e) { error = e.message; }
      }
      const elapsed = Date.now() - started;
      const observedAt = isoWithOffset(new Date());

      const v = truth ? judge({ finalText: run.finalText, callLog, error, budgetExceeded: Boolean(run.budget_exceeded), truth, sealed })
        : { reached: 'discover', stopped: 'discover', pass: false, checks: [], falseCompletion: false, instrument: instrumentBefore || 'other' };
      if (error && !v.instrument) v.instrument = 'other';
      log({ role: 'harness', event: 'assert', stage_reached: v.reached, stage_stopped: v.stopped, pass: v.pass, checks: v.checks, false_completion: v.falseCompletion, instrument_error: v.instrument, guard_violations: guardViolations.slice(violBefore), error, metrics: { steps: run.steps, tool_calls: callLog.length, provider_reported_tokens: run.tokens, elapsed_ms: elapsed } });

      const reading = {
        reading_id: newUlid(), claim: MK.claim, marker_id: MK.marker_id, expected_digest: sealed.digest,
        target: { service_id: PACK.service_id, model: run.model || providerName, harness_version: HARNESS_VERSION },
        stage_reached: v.reached, stage_stopped: v.stopped,
        observed: { pass: v.pass, method: 'harness_direct_api_vs_sealed_expectation', checks: v.checks, false_completion: v.falseCompletion, ground_truth_consistent: gtConsistent, instrument_error: v.instrument },
        evidence_ref: `${bundleRel}#sha256:PENDING`, observer: OBSERVER, kind: 'synthetic', observed_at: observedAt, supersedes: null,
        _outcome: { success: v.pass ? 1 : 0, latency_ms: elapsed, error_type: v.instrument ? `instrument_${v.instrument}` : (v.stopped ? `stage_${v.stopped}` : null), model_name: run.model || providerName, failed_step: v.stopped, verification_status: v.instrument ? 'unverified' : 'assertion_verified', context_masked: `[marker ${MK.marker_id}] stage_reached=${v.reached} stage_stopped=${v.stopped ?? 'none'} false_completion=${v.falseCompletion}` },
      };
      readings.push(reading);
      runRows.push({ provider: providerName, run: n, model: reading.target.model, stage_reached: v.reached, stage_stopped: v.stopped, pass: v.pass, false_completion: v.falseCompletion, instrument_error: v.instrument, steps: run.steps, tool_calls: callLog.length, guard_violations: guardViolations.length - violBefore, provider_reported_tokens: run.tokens, elapsed_ms: elapsed, budget_exceeded: Boolean(run.budget_exceeded) });
      const tag = v.instrument ? 'INST' : v.pass ? 'PASS' : 'FAIL';
      console.log(`  [${tag}] ${providerName} n${n}: reached=${v.reached} stopped=${v.stopped ?? '-'} steps=${run.steps} calls=${callLog.length} ${(elapsed / 1000).toFixed(1)}s${v.falseCompletion ? ' ⚠️false-completion' : ''}${error ? ' ERR:' + String(error).slice(0, 80) : ''}`);

      // The agent may have moved freee-mcp's persisted current company; put it back
      // so the next run (and every other freee-mcp user on this machine) starts from
      // the same state Michie's account was in.
      if (truth?.currentId && (await readCurrentCompany(callToolRaw)) !== truth.currentId) {
        const back = await callToolRaw('freee_set_current_company', { company_id: String(truth.currentId) });
        harnessLog({ event: 'restore_current_company_after_agent', ok: isSwitchOk(back) });
        if (!isSwitchOk(back)) console.error('[warn] could not restore the original current company after the agent run');
      }
    }
  }
  mcp.kill();

  // ---- manifest (no tenant values) ----
  const files = ['metrics.json', 'harness.jsonl'];
  for (const p of MODELS) for (let n = 1; n <= RUNS; n++) { const f = `${p}-n${n}/transcript.jsonl`; if (existsSync(join(bundleDir, f))) files.push(f); }
  const manifest = {
    bundle: `marker-${MK.marker_id}`, generated_at_utc: new Date().toISOString(), generated_at_local: isoWithOffset(new Date()),
    pack: { id: PACK.id, version: PACK.version, sha256: fileSha(packPath) },
    executor: { file: 'run-marker.mjs', version: VERSION, sha256: fileSha(fileURLToPath(import.meta.url)), libs: { 'lib/mcp-client.mjs': fileSha(join(__dir, 'lib', 'mcp-client.mjs')), 'lib/provider-loops.mjs': fileSha(join(__dir, 'lib', 'provider-loops.mjs')), 'lib/reading.mjs': fileSha(join(__dir, 'lib', 'reading.mjs')) }, git_head: HARNESS_VERSION.split('+')[1] },
    marker: { marker_id: MK.marker_id, kind: 'synthetic', expected_digest: sealed.digest, commitment_file: MK.commitment_file, commitment_commit: sealed.commitSha, commitment_remote_branches: sealed.remoteBranches, sealed_at: sealed.sealedAt, expires_at: sealed.expiresAt, expired_at_run: sealed.expired, sealed_key_kind: sealed.keyKind ?? null, ground_truth_consistent: gtConsistent, sealed_company_visible_to_token: truth ? truth.sealedIsOwn : null, companies_visible_to_token: truth ? truth.ownIds.length : null, sealed_company_was_current_at_start: truth ? !truth.needSwitch : null },
    environment: { freee_mcp_version: mcpVersion, tool_schema_sha256: sha256(JSON.stringify(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })))), node: process.version, dry_run: DRY },
    models: Object.fromEntries(runRows.map((r) => [r.provider, r.model])),
    note: 'goal-prompt-only; sealed file and scripted steps never shown to the model; R0 tool allowlist + pack-derived least-privilege guard (permitted paths, own companies only); judgement is rule-based against the harness direct read and the sealed expectation; tenant identifiers, counts and amounts withheld from every committed file (raw values only in transcript.jsonl, which is git-ignored)',
    files: [],
  };
  // metrics first (readings without evidence digest), then manifest digest, then patch evidence_ref
  const writeMetrics = () => writeFileSync(join(bundleDir, 'metrics.json'), JSON.stringify({ pack: PACK.id, pack_version: PACK.version, marker_id: MK.marker_id, kind: 'synthetic', date: stamp, lang: LANG, dry_run: DRY, runs: runRows, readings: readings.map(({ _outcome, ...r }) => r) }, null, 1));
  writeMetrics();
  manifest.files = files.map((f) => ({ file: f, sha256: existsSync(join(bundleDir, f)) ? fileSha(join(bundleDir, f)) : null, committed: !f.endsWith('transcript.jsonl') }));
  writeFileSync(join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const manifestSha = fileSha(join(bundleDir, 'manifest.json'));
  for (const r of readings) r.evidence_ref = `${bundleRel}#sha256:${manifestSha}`;
  writeMetrics();

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
