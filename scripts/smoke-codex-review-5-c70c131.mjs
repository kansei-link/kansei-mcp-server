/** Replay the reviewer's 38 cases verbatim, with documented fixture setup ports. */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { initializeDb } from '../dist/db/schema.js';
import { openDb } from '../dist/db/open.js';

const ROOT=resolve('.'), FIX=join(ROOT,'scripts/fixtures/codex-review-5');
const expected=JSON.parse(readFileSync(join(FIX,'independent-cases-c70c131.json'),'utf8'));
const manifest=JSON.parse(readFileSync(join(FIX,'c70c131-evidence-sha256.json'),'utf8'));
for(const [name,sha] of Object.entries(manifest))assert.equal(createHash('sha256').update(readFileSync(join(FIX,name))).digest('hex'),sha,`verbatim evidence: ${name}`);
const T=mkdtempSync(join(tmpdir(),'kansei-review-c70-'));
const quiet=fn=>{const l=console.log,e=console.error;console.log=console.error=()=>{};try{return fn();}finally{console.log=l;console.error=e;}};
const replaceOnce=(s,from,to)=>{assert.equal(s.split(from).length,2,`port anchor: ${from}`);return s.replace(from,()=>to);};
try {
  symlinkSync(join(ROOT,'node_modules'),join(T,'node_modules'),'junction');
  // The original runner cpSyncs dist into CLI fixtures. A real copy avoids
  // requiring Windows symbolic-link privileges when that copy is nested.
  cpSync(join(ROOT,'dist'),join(T,'dist'),{recursive:true});
  mkdirSync(join(T,'work'));
  let runner=readFileSync(join(FIX,'independent-c70c131.mjs.txt'),'utf8').replace(/\r\n?/g,'\n');
  // Port 1: openDb is now intentionally not an empty-DB bootstrap. Build the
  // latest fixture with initializeDb before inserting its test outcomes.
  runner=replaceOnce(runner,"import { openDb } from '../dist/db/open.js';","import { openDb } from '../dist/db/open.js';\nimport { initializeDb } from '../dist/db/schema.js';");
  runner=replaceOnce(runner,"const latest=()=>quiet(()=>openDb(':memory:'));","const latest=()=>quiet(()=>{const d=new Database(':memory:');initializeDb(d);return d;});");
  // Port 2: bootstrap the second-open fixture once BEFORE its first openDb.
  // Both tested opens, the inserted rows, and all 38 assertions stay unchanged.
  runner=replaceOnce(runner,"const path=join(dir,'second-open.db');let d=quiet(()=>openDb(path));","const path=join(dir,'second-open.db');{const setup=latest();await setup.backup(path);setup.close();}let d=quiet(()=>openDb(path));");
  writeFileSync(join(T,'work/runner.mjs'),runner);
  const env={...process.env,GIT_DIR:execFileSync('git',['rev-parse','--absolute-git-dir'],{encoding:'utf8'}).trim()};
  const result=spawnSync(process.execPath,['work/runner.mjs'],{cwd:T,env,encoding:'utf8',timeout:180000});
  assert.equal(result.status,0,result.stderr);
  const actual=JSON.parse(readFileSync(join(T,'work/independent-cases-c70c131.json'),'utf8'));
  assert.equal(actual.cases.length,38);
  assert.deepEqual(actual.cases.map(c=>c.id),expected.cases.map(c=>c.id));
  // Only B's wall-clock fixture timestamps vary across runs; no expected
  // status, provenance, outcome value or CLI exit code is waived.
  // Columns added to services after c70c131 are not part of that review's oracle
  // (B snapshots whole rows); they are named here one by one, never by pattern.
  const LATER_COLUMNS=['mcp_repo_url'];
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!LATER_COLUMNS.includes(k)).map(([k,x])=>[k,['created_at','mcp_liveness_checked_at'].includes(k)&&typeof x==='string'?'runtime-timestamp':stable(x)])):v;
  for(let i=0;i<38;i++){
    const oracle=actual.cases[i].id.startsWith('B-')?stable:v=>v;
    assert.deepEqual(oracle(actual.cases[i].expected),oracle(expected.cases[i].expected),`unchanged oracle: ${expected.cases[i].id}`);
    assert.equal(actual.cases[i].conforms,true,JSON.stringify(actual.cases[i]));
  }
  const former=expected.cases.filter(c=>!c.conforms).map(c=>c.id);
  assert.equal(former.length,7);
  for(const id of former)assert.equal(actual.cases.find(c=>c.id===id).conforms,true,id);
  console.log('PASS 38/38 reviewer cases; all 7 formerly nonconforming cases now conform');

  // Stronger shape-only invariant: ALL outcome columns and ALL pre-existing
  // service columns survive both opens, including rows eligible for hygiene.
  const oldFile=join(T,'legacy.mjs');
  writeFileSync(oldFile,ts.transpileModule(execFileSync('git',['show','775a797:src/db/schema.ts'],{encoding:'utf8'}),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
  const {initializeDb:oldInit}=await import(pathToFileURL(oldFile));
  const newCols=['mcp_liveness','mcp_liveness_checked_at','mcp_liveness_endpoint'];
  for(const shape of ['775a797','latest','partial']){
    const p=join(T,shape+'.db');let db=new Database(p);quiet(()=>shape==='latest'?initializeDb(db):oldInit(db));
    if(shape==='partial')db.exec('ALTER TABLE services ADD COLUMN mcp_liveness TEXT');
    const cols=db.prepare('PRAGMA table_info(services)').all().map(c=>c.name);
    db.prepare('INSERT INTO services(id,name,mcp_status,mcp_endpoint,trust_score) VALUES(?,?,?,?,?)').run('fake-shape','fake-shape','official','https://fake-shape.invalid/mcp',0.8);
    for(const agent of ['self-test-fleet','github-issues-miner','health-probe','fake-normal'])db.prepare('INSERT INTO outcomes(service_id,agent_id_hash,success) VALUES(?,?,0)').run('fake-shape',agent);
    if(shape==='latest')db.prepare("UPDATE services SET mcp_liveness='handshake',mcp_liveness_checked_at='2026-10-01T00:00:00Z',mcp_liveness_endpoint=mcp_endpoint").run();
    const snap=d=>({outcomes:d.prepare('SELECT * FROM outcomes ORDER BY id').all(),services:d.prepare(`SELECT ${cols.map(c=>'"'+c+'"').join(',')} FROM services ORDER BY id`).all(),markers:d.prepare('SELECT * FROM schema_migrations ORDER BY migration_id').all(),audit:d.prepare('SELECT * FROM migration_audit ORDER BY id').all()});
    const before=JSON.stringify(snap(db));
    const oldObjects=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    db.close();
    for(let n=1;n<=2;n++){
      db=openDb(p);assert.equal(JSON.stringify(snap(db)),before,`${shape} open ${n}: all data unchanged`);
      assert.deepEqual(db.prepare('PRAGMA table_info(services)').all().map(c=>c.name),[...cols,...newCols.filter(c=>!cols.includes(c))]);
      const objects=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
      assert.deepEqual(objects.filter(o=>o.name!=='services'&&o.name!=='services_endpoint_clears_liveness'),oldObjects.filter(o=>o.name!=='services'&&o.name!=='services_endpoint_clears_liveness'));
      assert.equal(objects.filter(o=>o.name==='services_endpoint_clears_liveness').length,1);db.close();
    }
    console.log(`PASS ${shape}: both opens preserve whole outcomes, all existing service columns, markers and audit; only liveness DDL added`);
  }
  // Full bootstrap remains at the two historically initializing entrypoints.
  // Compare the actual statements with 775a797, and verify server hygiene lives.
  for(const p of ['src/crawler/run.ts','src/agent-army/run.ts']){
    const old=execFileSync('git',['show',`775a797:${p}`],{encoding:'utf8'}), head=readFileSync(p,'utf8');
    const pattern=/const db = new Database\(dbPath\);\s*initializeDb\(db\);/;
    assert.match(old,pattern);assert.match(head,pattern);assert.doesNotMatch(head,/openDb/);
    console.log(`PASS ${p}: full startup pair matches 775a797`);
  }
  const d=new Database(':memory:');quiet(()=>initializeDb(d));
  d.prepare('INSERT INTO services(id,name) VALUES(?,?)').run('fake-hygiene','fake-hygiene');
  d.prepare("INSERT INTO outcomes(service_id,agent_id_hash,success) VALUES('fake-hygiene','self-test-fleet',1)").run();
  quiet(()=>initializeDb(d));assert.equal(d.prepare('SELECT provenance FROM outcomes').get().provenance,'synthetic');d.close();
  console.log('PASS server initialization still performs data hygiene');
  if(process.env.KANSEI_REVIEW_RESULT)writeFileSync(process.env.KANSEI_REVIEW_RESULT,JSON.stringify(actual,null,2));
} finally {
  // T is created by this test beneath tmpdir; never delete the linked targets.
  for(const name of ['dist','node_modules']){try{rmSync(join(T,name));}catch{}}
  try{rmSync(T,{recursive:true,force:true});}catch{}
}
console.log('codex review c70c131 regression: ALL PASS');
