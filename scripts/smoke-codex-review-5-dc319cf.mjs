/**
 * Codex review 5 (on dc319cf, 2026-10-02) — the reviewer's 223 independent cases,
 * kept verbatim and re-run against this tree; plus the CLI-upgrade regression of A.
 *
 * Fixtures (byte for byte, scripts/fixtures/codex-review-5/):
 *   independent-cases-dc319cf.json            the reviewer's output (220 conforming, 3 not:
 *       F2-admin-propose-current-status — inspect/propose returned the stored mcp_status;
 *       F8-standalone-probe-upgrade, F8-watchdog-upgrade-exit — the CLIs opened a
 *       775a797-shaped DB without initializeDb and died on "no such column: mcp_liveness")
 *   independent-review-dc319cf.mjs.txt, independent-extra-dc319cf.mjs.txt,
 *   verify-cli-migration-dc319cf.mjs.txt      the reviewer's three runners
 *
 * How it runs: the three runners are copied unchanged into <tmp>/work/ and run in the
 * reviewer's order from <tmp>, where dist/ and node_modules/ are junctions to this tree
 * and GIT_DIR points at this repository (their `git show 775a797:…` reads git objects).
 * Two port changes, written out below. PORT_PATCH (independent-extra): the
 * isolated "head" CLI tree gets the whole dist/ instead of two files, because the head
 * CLIs now import dist/db/open.js (the fix). The "base" (775a797) tree is as the reviewer
 * built it. PORT_PATCH_2 (verify-cli-migration): see its comment.
 *
 * What passes:
 *   - 223 cases, the reviewer's ids in the reviewer's order, every case conforms;
 *   - inputs and expectations equal the fixture's, except where they are made at run
 *     time (RUN_DEPENDENT below: timestamps of the run, the 775a797 baseline's own
 *     observation, the run's "before" snapshots) — those are compared by their keys;
 *   - A (Michie's regression): a 775a797-shaped DB, a fake handshake partner, the
 *     health-probe and watchdog CLIs started alone → exit 0, the new columns are
 *     added, trust and the outcome rows equal 775a797's.
 *
 * Usage: npm run build && node scripts/smoke-codex-review-5-dc319cf.mjs
 */
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = resolve('.');
const FIX = join(ROOT, 'scripts', 'fixtures', 'codex-review-5');
const FIXTURE = JSON.parse(readFileSync(join(FIX, 'independent-cases-dc319cf.json'), 'utf8'));
const GIT_DIR = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
let failures = 0;
const ok = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const TMP = mkdtempSync(join(tmpdir(), 'kansei-codex5-dc-'));
symlinkSync(join(ROOT, 'node_modules'), join(TMP, 'node_modules'), 'junction');
symlinkSync(join(ROOT, 'dist'), join(TMP, 'dist'), 'junction');
mkdirSync(join(TMP, 'work'));

const PORT_PATCH = {
  from: " for(const name of ['health-probe','watchdog']) {\n  const target=join(tree,'dist/crawler',name+'.js');\n  if(version==='head')copyFileSync('dist/crawler/'+name+'.js',target);",
  to: " if(version==='head')cpSync(realpathSync('dist'),join(tree,'dist'),{recursive:true}); // PORT: the head CLIs import dist/db/open.js\n for(const name of ['health-probe','watchdog']) {\n  const target=join(tree,'dist/crawler',name+'.js');\n  if(version==='head')continue;",
};
const runners = [
  ['independent-review.mjs', readFileSync(join(FIX, 'independent-review-dc319cf.mjs.txt'), 'utf8')],
  ['independent-extra.mjs', (() => {
    const s = readFileSync(join(FIX, 'independent-extra-dc319cf.mjs.txt'), 'utf8');
    if (!s.includes(PORT_PATCH.from)) throw new Error('port patch anchor missing');
    return s.replace(PORT_PATCH.from, () => PORT_PATCH.to).replace("import { readFileSync,writeFileSync,mkdirSync,copyFileSync } from 'node:fs';", () => "import { readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,realpathSync } from 'node:fs';");
  })()],
  ['verify-cli-migration.mjs', (() => {
    // PORT_PATCH_2: the case "standalone-probe-after-explicit-migration" starts from the head tree's DB as the
    // reviewer's run left it — the 775a797-shaped DB with the one fake row and no outcome (the head CLI had died
    // before writing). With the fix the earlier head run succeeds and writes an outcome, so that state is rebuilt
    // here, exactly as independent-extra built it, before the reviewer's own statements run.
    const s = readFileSync(join(FIX, 'verify-cli-migration-dc319cf.mjs.txt'), 'utf8');
    const from = "const db=new Database(join(tree,'kansei-link.db'));initializeDb(db);db.close();";
    if (!s.includes(from)) throw new Error('port patch 2 anchor missing');
    const rebuild = "{const p=join(tree,'kansei-link.db');for(const x of ['','-wal','-shm'])rmSync(p+x,{force:true});const m=new Database(':memory:');oldInit(m);m.prepare('INSERT INTO services(id,name,mcp_status,mcp_endpoint,trust_score) VALUES(?,?,?,?,?)').run('fake-cli-upgrade','fake-cli-upgrade','official','https://fake-extra.invalid/mcp',0.2);await m.backup(p);m.close();} // PORT_PATCH_2\n";
    return s.replace(from, () => rebuild + from).replace("import { readFileSync,writeFileSync } from 'node:fs';", () => "import { readFileSync,writeFileSync,rmSync } from 'node:fs';");
  })()],
];
const env = { ...process.env, GIT_DIR };
try {
  for (const [name, text] of runners) {
    writeFileSync(join(TMP, 'work', name), text);
    const r = spawnSync(process.execPath, [join('work', name)], { cwd: TMP, env, encoding: 'utf8', timeout: 300000 });
    ok(`runner ${name} completes (exit 0)`, r.status === 0, (r.stderr || '').slice(-800));
  }
  const got = JSON.parse(readFileSync(join(TMP, 'work', 'independent-cases-dc319cf.json'), 'utf8'));
  const want = FIXTURE.cases;
  ok('223 cases, the reviewer\'s ids in the reviewer\'s order', got.cases.length === 223 && want.length === 223 && got.cases.every((c, i) => c.id === want[i].id), `${got.cases.length}`);
  ok('the fixture is the reviewer\'s file: 220 conforming, 3 not', FIXTURE.commit === 'dc319cfdbc28473a010cc0d31581017916d84bb1' && want.filter((c) => !c.conforms).map((c) => c.id).join() === 'F2-admin-propose-current-status,F8-standalone-probe-upgrade,F8-watchdog-upgrade-exit');

  // made at run time: timestamps from Date.now(), the 775a797 baseline's observation, "before" snapshots
  const RUN_DEPENDENT = (id) => /^route-|^no-raw-observation-|^article-|^migration-second-|^seed-preserve$|^probe-parity-|^search-parity-|^F8-standalone-probe-upgrade$|^F8-watchdog-upgrade-exit$|^endpoint-/.test(id);
  const keysOf = (v) => (v && typeof v === 'object' ? Object.keys(v).sort().join() : typeof v);
  const mism = [];
  got.cases.forEach((c, i) => {
    const w = want[i];
    if (RUN_DEPENDENT(c.id)) { if (keysOf(c.input) !== keysOf(w.input)) mism.push(`${c.id}: input keys`); }
    else { if (!eq(c.input, w.input)) mism.push(`${c.id}: input`); if (!eq(c.expected, w.expected)) mism.push(`${c.id}: expected`); }
  });
  ok('inputs and expectations equal the fixture\'s (run-time values compared by shape)', mism.length === 0, mism.slice(0, 8).join(' | '));
  const nonconf = got.cases.filter((c) => !c.conforms);
  ok('every case conforms now', nonconf.length === 0, JSON.stringify(nonconf.map((c) => ({ id: c.id, expected: c.expected, actual: c.actual }))).slice(0, 1200));
  for (const id of ['F2-admin-propose-current-status', 'F8-standalone-probe-upgrade', 'F8-watchdog-upgrade-exit']) {
    const c = got.cases.find((x) => x.id === id);
    ok(`was nonconforming, now as expected: ${id} → ${JSON.stringify(c?.expected)}`, Boolean(c?.conforms), JSON.stringify(c?.actual));
  }

  // ── A: the CLIs started alone on a 775a797-shaped DB (Michie's regression) ──
  const { initializeDb: oldInit } = await import(pathToFileURL(join(TMP, 'work', 'base-db-schema.mjs')).href);
  const folder = join(TMP, 'work', 'cli-upgrade');
  const preload = pathToFileURL(join(folder, 'fake-fetch.mjs')).href; // the reviewer's fake handshake partner (no network)
  const NEW_COLS = ['mcp_liveness', 'mcp_liveness_checked_at', 'mcp_liveness_endpoint'];
  const quiet = (fn) => { const l = console.log, e = console.error; console.log = console.error = () => {}; try { return fn(); } finally { console.log = l; console.error = e; } };
  const legacyDb = async (path, rows) => {
    rmSync(path, { force: true }); rmSync(path + '-wal', { force: true }); rmSync(path + '-shm', { force: true });
    const m = new Database(':memory:'); quiet(() => oldInit(m));
    rows(m);
    await m.backup(path); m.close();
  };
  const cols = (d) => d.prepare('PRAGMA table_info(services)').all().map((c) => c.name);
  const outcomeRows = (d) => d.prepare('SELECT service_id,agent_id_hash,success,error_type,context_masked,provenance,verification_status,task_type FROM outcomes ORDER BY id').all();
  const runCli = async (cli, args, rows) => {
    const r = {};
    for (const version of ['base', 'head']) {
      const tree = join(folder, version), path = join(tree, 'kansei-link.db');
      await legacyDb(path, rows);
      const before = new Database(path); const hadCols = NEW_COLS.some((c) => cols(before).includes(c)); before.close();
      const p = spawnSync(process.execPath, ['--import', preload, join(tree, 'dist', 'crawler', cli + '.js'), ...args], { encoding: 'utf8', timeout: 60000 });
      const d = new Database(path);
      r[version] = { exit: p.status, hadCols, cols: NEW_COLS.filter((c) => cols(d).includes(c)), trust: d.prepare('SELECT id, trust_score FROM services ORDER BY id').all(), outcomes: outcomeRows(d), stderr: (p.stderr || '').slice(-300) };
      d.close();
    }
    return r;
  };
  const ep = 'https://fake-cli-a.invalid/mcp';
  const probe = await runCli('health-probe', ['--limit', '1'], (m) => m.prepare('INSERT INTO services(id,name,mcp_status,mcp_endpoint,trust_score) VALUES(?,?,?,?,?)').run('fake-cli-a', 'fake-cli-a', 'official', ep, 0.2));
  ok('A health-probe alone on a 775a797 DB: exit 0 (775a797: exit 0)', probe.head.exit === 0 && probe.base.exit === 0, probe.head.stderr);
  ok('A health-probe: the DB had none of the new columns before, and has all three after', !probe.head.hadCols && eq(probe.head.cols, NEW_COLS), JSON.stringify(probe.head.cols));
  ok('A health-probe: trust and the outcome rows equal 775a797\'s', eq(probe.head.trust, probe.base.trust) && eq(probe.head.outcomes, probe.base.outcomes) && probe.head.outcomes.length === 1, JSON.stringify({ base: probe.base.trust, head: probe.head.trust, bo: probe.base.outcomes.length, ho: probe.head.outcomes.length }));
  const watch = await runCli('watchdog', ['--fix'], (m) => {
    m.prepare('INSERT INTO services(id,name,mcp_endpoint,mcp_status,trust_score) VALUES(?,?,?,?,?)').run('fake-cli-w', 'fake-cli-w', 'https://fake-cli-w.invalid/mcp', 'verified', 0.8);
    for (let i = 0; i < 5; i++) m.prepare("INSERT INTO outcomes(service_id,agent_id_hash,success) VALUES('fake-cli-w','fake-agent',0)").run();
  });
  ok('A watchdog --fix alone on a 775a797 DB: exit 0 (775a797: exit 0)', watch.head.exit === 0 && watch.base.exit === 0, watch.head.stderr);
  ok('A watchdog: the new columns are added', !watch.head.hadCols && eq(watch.head.cols, NEW_COLS), JSON.stringify(watch.head.cols));
  ok('A watchdog: trust and the outcome rows equal 775a797\'s', eq(watch.head.trust, watch.base.trust) && eq(watch.head.outcomes, watch.base.outcomes), JSON.stringify({ base: watch.base.trust, head: watch.head.trust }));
  // idempotent: a second start of the same CLI on the now-current DB changes nothing in the schema
  {
    const tree = join(folder, 'head'), path = join(tree, 'kansei-link.db');
    const snap = () => { const d = new Database(path); const s = { cols: cols(d), markers: d.prepare('SELECT migration_id FROM schema_migrations ORDER BY migration_id').all() }; d.close(); return s; };
    const a = snap();
    spawnSync(process.execPath, ['--import', preload, join(tree, 'dist', 'crawler', 'watchdog.js')], { encoding: 'utf8', timeout: 60000 });
    ok('A openDb is idempotent: a second start leaves the columns and the migration markers as they were', eq(a, snap()));
  }
  // ── finding (deep-audit.ts:276): its targets are chosen by the display function's own freshness test ──
  {
    const { openDb } = await import('../dist/db/open.js');
    const { selectDeepAuditTargets } = await import('../dist/crawler/deep-audit-targets.js');
    const d = quiet(() => openDb(':memory:'));
    const now = new Date('2026-10-02T12:00:00Z'), e = (id) => `https://${id}.invalid/mcp`;
    const rows = [
      ['da-fresh', 'handshake', '2026-10-02T11:00:00Z', null, 0, 0.9],
      ['da-30-days', 'handshake', '2026-09-02T12:00:00Z', null, 0, 0.8],
      ['da-31-days', 'handshake', '2026-09-01T12:00:00Z', null, 0, 0.95],
      ['da-future', 'handshake', '2026-10-03T00:00:00Z', null, 0, 0.95],
      ['da-bad-calendar', 'handshake', '2026-09-31T00:00:00Z', null, 0, 0.95],
      ['da-archived', 'handshake', '2026-10-02T11:00:00Z', null, 1, 0.95],
      ['da-other-endpoint', 'handshake', '2026-10-02T11:00:00Z', 'https://elsewhere.invalid/mcp', 0, 0.95],
      ['da-unreachable', 'unreachable', '2026-10-02T11:00:00Z', null, 0, 0.95],
    ];
    for (const [id, state, at, observed, archived, trust] of rows) d.prepare('INSERT INTO services(id,name,mcp_endpoint,mcp_status,trust_score,archived,mcp_liveness,mcp_liveness_checked_at,mcp_liveness_endpoint) VALUES(?,?,?,?,?,?,?,?,?)').run(id, id, e(id), 'verified', trust, archived, state, at, observed ?? e(id));
    ok('finding: deep-audit targets = fresh handshakes on the current endpoint only (30 days, no future, real dates, not archived)', eq(selectDeepAuditTargets(d, 100, now).map((t) => t.id), ['da-fresh', 'da-30-days']), JSON.stringify(selectDeepAuditTargets(d, 100, now).map((t) => t.id)));
    ok('finding: the limit applies after the freshness test', eq(selectDeepAuditTargets(d, 1, now).map((t) => t.id), ['da-fresh']));
    d.close();
  }
} finally {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}
console.log(failures === 0 ? '\ncodex review 5 (dc319cf) cases: ALL PASS' : `\ncodex review 5 (dc319cf) cases: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
