#!/usr/bin/env node
/**
 * P0 #39 否定テスト一式 — 「不適切な配布物を生成できない仕組み」の検証
 *
 *   node scripts/smoke-dist-hygiene.mjs          … フル（実tarball検証含む・要 ../kansei-hotfix-v121）
 *   node scripts/smoke-dist-hygiene.mjs --ci     … CI用（実tarball/ローカルDB依存テストをスキップ）
 *
 * 検証対象: pack-gate (G1-G5) / route-gate (RG1-RG3) / release-gate (R1-R5) /
 *           synth-guard（default-deny + 出力先制限）/ 正本seed空化 / regen-seed経路遮断
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildTgz } from "./lib-tgz.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, "..");
const CI = process.argv.includes("--ci");
const TMP = mkdtempSync(join(tmpdir(), "kansei-hygiene-"));
process.on("exit", () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function runNode(scriptArgs, opts = {}) {
  return spawnSync(process.execPath, scriptArgs, { encoding: "utf8", cwd: opts.cwd ?? ROOT, env: { ...process.env, ...opts.env } });
}

function makeTgz(name, extraEntries) {
  const entries = new Map([
    ["package/package.json", { data: Buffer.from(JSON.stringify({ name: "t", version: "0.0.0" })), mode: 0o644 }],
    ["package/dist/index.js", { data: Buffer.from("console.log('ok')\n"), mode: 0o644 }],
  ]);
  for (const [p, content] of Object.entries(extraEntries)) {
    entries.set(p, { data: Buffer.from(content), mode: 0o644 });
  }
  const p = join(TMP, name);
  writeFileSync(p, buildTgz(entries).tgz);
  return p;
}

function sh(cwd, cmd) {
  const r = spawnSync("git", cmd.split(" "), { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  if (r.status !== 0) throw new Error(`git ${cmd} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

const packGate = join(SCRIPTS, "pack-gate.mjs");
const routeGate = join(SCRIPTS, "route-gate.mjs");
const releaseGate = join(SCRIPTS, "release-gate.mjs");
const fixtureVoices = readFileSync(join(ROOT, "fixtures", "synthetic", "voices-seed.fixture.json"), "utf8");

// ---------------- T1/T2: 実tarball（出荷済み実物での回帰） ----------------
console.log("[T1-T2] pack-gate vs 実tarball");
if (CI) {
  console.log("  (CI mode — 実tarballはローカル専用のためスキップ。同等の合成検証はT3以降で実施)");
} else {
  const v120 = join(ROOT, "..", "kansei-hotfix-v121", "kansei-link-mcp-server-1.2.0.tgz");
  const v121 = join(ROOT, "..", "kansei-hotfix-v121", "kansei-link-mcp-server-1.2.1-final.tgz");
  if (existsSync(v120)) {
    const r = runNode([packGate, v120]);
    check("T1 v1.2.0 tarball → FAIL (synthetic実名を検出)", r.status !== 0 && /G1/.test(r.stderr));
  } else check("T1 v1.2.0 tarball fixture present", false, "not found");
  if (existsSync(v121)) {
    const r = runNode([packGate, v121]);
    check("T2 v1.2.1 tarball → PASS", r.status === 0, r.stderr.slice(0, 200));
  } else check("T2 v1.2.1 tarball fixture present", false, "not found");
}

// ---------------- T3: fixtureをsrc/dataへコピー → FAIL ----------------
console.log("[T3] synthetic fixture が src/data に載った tarball");
{
  const tgz = makeTgz("t3.tgz", { "package/src/data/voices-seed.json": fixtureVoices });
  let r = runNode([packGate, tgz]);
  check("T3 fixture→src/data コピー → G1 FAIL", r.status !== 0 && /G1/.test(r.stderr));

  r = runNode([packGate, makeTgz("t3b.tgz", { "package/dist/db/schema.js": "db.exec(\"DELETE FROM agent_voice_responses WHERE agent_id = 'kansei-link-synth'\")" })]);
  check("T3b コード内の隔離migrationマーカー → PASS (偽陽性でない)", r.status === 0, r.stderr.slice(0, 200));

  r = runNode([packGate, makeTgz("t3c.tgz", { "package/dist/other.json": '[{"agent_id":"kansei-link-synth"}]' })]);
  check("T3c データファイル内のsyntheticマーカー → G1 FAIL", r.status !== 0 && /G1/.test(r.stderr));
}

// ---------------- T4: Claimテスト/PII/内部manifest/fixtures混入 → FAIL ----------------
console.log("[T4] 内部成果物・テスト・PII混入");
{
  let r = runNode([packGate, makeTgz("t4a.tgz", { "package/scripts/smoke-claim-mvp.mjs": "// test" })]);
  check("T4a Claimテスト混入 → G5 FAIL", r.status !== 0 && /G5/.test(r.stderr));
  r = runNode([packGate, makeTgz("t4b.tgz", { "package/fixtures/synthetic/x.json": "[]" })]);
  check("T4b fixtures/ 混入 → G5 FAIL", r.status !== 0 && /G5/.test(r.stderr));
  r = runNode([packGate, makeTgz("t4c.tgz", { "package/qa-internal/manifest.json": "{}" })]);
  check("T4c 内部manifest混入 → G5 FAIL", r.status !== 0 && /G5/.test(r.stderr));
  r = runNode([packGate, makeTgz("t4d.tgz", { "package/src/data/leads.json": '[{"email":"taro.yamada@gmail.com"}]' })]);
  check("T4d seed内個人メール → G4 FAIL", r.status !== 0 && /G4/.test(r.stderr));
  r = runNode([packGate, makeTgz("t4e.tgz", { "package/scripts/claim_pii-fixture.json": "{}" })]);
  check("T4e claim_pii fixture混入 → G5 FAIL", r.status !== 0 && /G5/.test(r.stderr));
}

// ---------------- T5: クリーンなtarball → PASS（陽性対照） ----------------
console.log("[T5] クリーンtarball");
{
  const r = runNode([packGate, makeTgz("t5.tgz", { "package/src/data/services-seed.json": '[{"id":"x","name":"X"}]' })]);
  check("T5 クリーンtarball → PASS", r.status === 0, r.stderr.slice(0, 200));
}

// ---------------- T6: G3恒久条件（未承認Claim経路） ----------------
console.log("[T6] G3: Claim配布の恒久条件");
{
  const claimTgz = makeTgz("t6.tgz", { "package/dist/claim/handlers.js": "// claim" });
  let r = runNode([packGate, claimTgz]);
  check("T6a enabled=false(現状) で dist/claim → G3 FAIL", r.status !== 0 && /G3/.test(r.stderr));

  const allowedList = ["package/dist/claim/handlers.js"];
  const allowedHash = createHash("sha256").update(JSON.stringify([...allowedList].sort())).digest("hex");
  const enabledOk = join(TMP, "claim-allow-ok.json");
  writeFileSync(enabledOk, JSON.stringify({ enabled: true, sec_review_id: "SEC-2026-08-16-002", allowed: allowedList, allowed_sha256: allowedHash }));
  r = runNode([packGate, claimTgz], { env: { KANSEI_CLAIM_DIST_ALLOWLIST: enabledOk } });
  check("T6b enabled=true+有効SEC ID+hash束縛+allowed内 → PASS", r.status === 0, r.stderr.slice(0, 200));

  const extraTgz = makeTgz("t6c.tgz", { "package/dist/claim/handlers.js": "// claim", "package/dist/claim/extra.js": "// rogue" });
  r = runNode([packGate, extraTgz], { env: { KANSEI_CLAIM_DIST_ALLOWLIST: enabledOk } });
  check("T6c enabled=true でも allowlist外claimファイル → G3 FAIL", r.status !== 0 && /G3/.test(r.stderr));

  const enabledBadId = join(TMP, "claim-allow-badid.json");
  writeFileSync(enabledBadId, JSON.stringify({ enabled: true, sec_review_id: "approved-by-nobody", allowed: allowedList, allowed_sha256: allowedHash }));
  r = runNode([packGate, claimTgz], { env: { KANSEI_CLAIM_DIST_ALLOWLIST: enabledBadId } });
  check("T6d enabled=true でも SEC ID形式不正 → G3 FAIL (enabled扱いしない)", r.status !== 0 && /G3/.test(r.stderr));

  const enabledBadHash = join(TMP, "claim-allow-badhash.json");
  writeFileSync(enabledBadHash, JSON.stringify({ enabled: true, sec_review_id: "SEC-2026-08-16-002", allowed: allowedList, allowed_sha256: "0".repeat(64) }));
  r = runNode([packGate, claimTgz], { env: { KANSEI_CLAIM_DIST_ALLOWLIST: enabledBadHash } });
  check("T6e allowed書き換え(hash不一致) → G3 FAIL (Checker P1-3)", r.status !== 0 && /G3/.test(r.stderr));
}

// ---------------- T7-T9: route-gate ----------------
console.log("[T7-T9] route-gate");
{
  let r = runNode([routeGate]);
  check("T7 現行ルート+正allowlist → PASS", r.status === 0, (r.stderr || r.stdout).slice(0, 300));

  // T8: 未申告ルートを足したソース
  const srcCopy = join(TMP, "http-server-evil.ts");
  writeFileSync(srcCopy, readFileSync(join(ROOT, "src", "http-server.ts"), "utf8") + '\napp.get("/api/evil-backdoor", (_req, res) => res.json({}));\n');
  r = runNode([routeGate, "--src", srcCopy]);
  check("T8 allowlist外ルート追加 → RG1 FAIL", r.status !== 0 && /RG1/.test(r.stderr) && /evil-backdoor/.test(r.stderr));

  // T9a: allowlistのroutesを書き換えたが sec_reviews を更新しない
  const allow = JSON.parse(readFileSync(join(ROOT, "route-allowlist.json"), "utf8"));
  const tampered = { ...allow, routes: [...allow.routes, "GET /api/evil-backdoor"] };
  const tamperedPath = join(TMP, "allow-tampered.json");
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  r = runNode([routeGate, "--src", srcCopy, "--allowlist", tamperedPath]);
  check("T9a allowlist変更+SECレビュー未追加 → RG2 FAIL", r.status !== 0 && /RG2/.test(r.stderr));

  // T9b: hashは更新したが review_id が無効形式
  const rp = runNode([routeGate, "--src", srcCopy, "--print-routes"]);
  const printed = JSON.parse(rp.stdout);
  const badReview = { ...allow, routes: printed.routes, sec_reviews: [...allow.sec_reviews, { review_id: "no-review", routes_sha256: printed.routes_sha256, date: "2026-08-16" }] };
  const badReviewPath = join(TMP, "allow-badreview.json");
  writeFileSync(badReviewPath, JSON.stringify(badReview));
  r = runNode([routeGate, "--src", srcCopy, "--allowlist", badReviewPath]);
  check("T9b SECレビューID形式不正 → RG3 FAIL", r.status !== 0 && /RG3/.test(r.stderr));

  // T9c: 正規手順（有効ID+正hash）なら PASS
  const goodReview = { ...allow, routes: printed.routes, sec_reviews: [...allow.sec_reviews, { review_id: "SEC-2026-08-16-099", routes_sha256: printed.routes_sha256, date: "2026-08-16" }] };
  const goodReviewPath = join(TMP, "allow-goodreview.json");
  writeFileSync(goodReviewPath, JSON.stringify(goodReview));
  r = runNode([routeGate, "--src", srcCopy, "--allowlist", goodReviewPath]);
  check("T9c 正規手順(有効ID+正hash) → PASS", r.status === 0, (r.stderr || r.stdout).slice(0, 300));
}

// ---------------- T10: release-gate（模擬gitリポジトリ） ----------------
console.log("[T10] release-gate");
{
  const repo = join(TMP, "mock-repo");
  mkdirSync(join(repo, "dist"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "mock-pkg", version: "9.9.9", files: ["dist"] }, null, 1));
  writeFileSync(join(repo, "dist", "index.js"), "console.log('mock')\n");
  sh(repo, "init -q");
  sh(repo, "add -A");
  sh(repo, "commit -q -m init");

  // a. clean だが tag なし → FAIL
  let r = runNode([releaseGate, "--dir", repo, "--checks", "git"]);
  check("T10a clean+非tag → R2 FAIL", r.status !== 0 && /R2/.test(r.stderr));

  // b. dirty worktree → FAIL
  writeFileSync(join(repo, "dirty.txt"), "x");
  r = runNode([releaseGate, "--dir", repo, "--checks", "git"]);
  check("T10b dirty worktree → R1 FAIL", r.status !== 0 && /R1/.test(r.stderr));
  rmSync(join(repo, "dirty.txt"));

  // c. tagが旧commitを指す → FAIL
  sh(repo, "tag v9.9.9");
  writeFileSync(join(repo, "dist", "index.js"), "console.log('mock2')\n");
  sh(repo, "add -A");
  sh(repo, "commit -q -m second");
  r = runNode([releaseGate, "--dir", repo, "--checks", "git"]);
  check("T10c tagとHEAD不一致 → R3 FAIL", r.status !== 0 && /R3/.test(r.stderr));

  // d. clean + tag@HEAD + クリーンな配布物 → フル検査 PASS
  sh(repo, "tag -f v9.9.9");
  r = runNode([releaseGate, "--dir", repo]);
  check("T10d clean+tag@HEAD+クリーン配布物 → release-gate PASS", r.status === 0, (r.stderr || r.stdout).slice(0, 300));
}

// ---------------- T11-T12: synth-guard（default-deny + 出力先制限） ----------------
console.log("[T11-T12] 再生成経路の default-deny");
{
  const before = readFileSync(join(ROOT, "src", "data", "voices-seed.json"), "utf8");
  let r = runNode([join(SCRIPTS, "aggregate-voices.mjs")]);
  check("T11a aggregate-voices 引数なし → 拒否(exit 1)", r.status === 1 && /BLOCKED/.test(r.stderr));
  check("T11b 拒否時に voices-seed.json 無変更", readFileSync(join(ROOT, "src", "data", "voices-seed.json"), "utf8") === before);

  r = runNode([join(SCRIPTS, "aggregate-voices.mjs"), "--fixture-out", "src/data/voices-seed.json"]);
  check("T11c --fixture-out で src/data 指定 → 即時FAIL", r.status === 1 && /許可範囲外/.test(r.stderr));
  check("T11d src/data FAIL後も voices-seed.json 無変更", readFileSync(join(ROOT, "src", "data", "voices-seed.json"), "utf8") === before);

  r = runNode([join(SCRIPTS, "aggregate-voices.mjs"), "--fixture-out", "dist/data/voices-seed.json"]);
  check("T11e --fixture-out で dist 指定 → 即時FAIL", r.status === 1 && /許可範囲外/.test(r.stderr));

  r = runNode([join(SCRIPTS, "aggregate-voices.mjs"), "--fixture-out", `\\\\?\\${join(ROOT, "src", "data", "evil.json")}`]);
  check("T11g デバイスパス(\\\\?\\)迂回 → 即時FAIL (Checker P1-4)", r.status === 1 && /デバイスパス/.test(r.stderr) && !existsSync(join(ROOT, "src", "data", "evil.json")));

  r = runNode([join(SCRIPTS, "export-stats-seed.mjs")]);
  check("T12a export-stats-seed 引数なし → 拒否(exit 1)", r.status === 1 && /BLOCKED/.test(r.stderr));
  r = runNode([join(SCRIPTS, "export-stats-seed.mjs"), "--fixture-out", "src/data/service-stats-seed.json"]);
  check("T12b --fixture-out で src/data 指定 → 即時FAIL", r.status === 1 && /許可範囲外/.test(r.stderr));

  if (CI || !existsSync(join(ROOT, "kansei-link.db"))) {
    console.log("  (ローカルDBなし/CI — fixture正常系の実書き出しはスキップ)");
  } else {
    const outV = join(ROOT, "fixtures", "synthetic", "tmp-smoke-voices.json");
    const outS = join(ROOT, "fixtures", "synthetic", "tmp-smoke-stats.json");
    r = runNode([join(SCRIPTS, "aggregate-voices.mjs"), "--fixture-out", outV]);
    check("T11f 正しい隔離fixture出力 → PASS+ファイル生成", r.status === 0 && existsSync(outV), r.stderr.slice(0, 200));
    r = runNode([join(SCRIPTS, "export-stats-seed.mjs"), "--fixture-out", outS]);
    check("T12c 正しい隔離fixture出力 → PASS+ファイル生成", r.status === 0 && existsSync(outS), r.stderr.slice(0, 200));
    rmSync(outV, { force: true });
    rmSync(outS, { force: true });
  }
}

// ---------------- T13-T14: 正本の状態 ----------------
console.log("[T13-T14] 正本seedと第3経路");
{
  const regen = readFileSync(join(SCRIPTS, "regen-seed.mjs"), "utf8");
  check("T13 regen-seed に voices書き出しコードが存在しない", !/voicesOut|agent_voice_responses/.test(regen));
  const v = JSON.parse(readFileSync(join(ROOT, "src", "data", "voices-seed.json"), "utf8"));
  const s = JSON.parse(readFileSync(join(ROOT, "src", "data", "service-stats-seed.json"), "utf8"));
  check("T14 正本 voices-seed / service-stats-seed = []", Array.isArray(v) && v.length === 0 && Array.isArray(s) && s.length === 0);

  const fx = readFileSync(join(ROOT, "fixtures", "synthetic", "voices-seed.fixture.json"), "utf8") + readFileSync(join(ROOT, "fixtures", "synthetic", "service-stats-seed.fixture.json"), "utf8");
  check("T14b fixtureは匿名合成のみ (Fixture Service/fixture-service以外のサービス名なし)", /Fixture Service 1 /.test(fx) && !/freee|Adyen|ActiveCampaign|Boolsai/i.test(fx));
}

// ---------------- T15: 実DB残留syntheticの隔離migration (Checker P1-1) ----------------
console.log("[T15] schema隔離migration");
{
  const schemaJs = join(ROOT, "dist", "db", "schema.js");
  if (!existsSync(schemaJs)) {
    console.log("  (dist未build — スキップ。CIではbuild後に実行される)");
  } else {
    const { default: Database } = await import("better-sqlite3");
    const { initializeDb } = await import(`file://${schemaJs.replace(/\\/g, "/")}`);
    const db = new Database(join(TMP, "t15.db"));
    initializeDb(db);
    db.prepare("INSERT INTO services (id, name) VALUES ('svc-a','Svc A')").run();
    db.prepare(
      "INSERT INTO agent_voice_responses (service_id, agent_type, agent_id, question_id, response_choice, response_text, confidence) VALUES ('svc-a','aggregated','kansei-link-synth','auto_voice_summary','works_well','Svc A succeeds on 100% of calls (n=3).','low')"
    ).run();
    db.prepare(
      "INSERT INTO agent_voice_responses (service_id, agent_type, agent_id, question_id, response_choice, response_text, confidence) VALUES ('svc-a','human','real-agent-1','q1','works_well','fine','low')"
    ).run();
    initializeDb(db); // 再起動相当
    const synth = db.prepare("SELECT COUNT(*) c FROM agent_voice_responses WHERE agent_id='kansei-link-synth' OR agent_type='aggregated'").get().c;
    const human = db.prepare("SELECT COUNT(*) c FROM agent_voice_responses WHERE agent_type='human'").get().c;
    db.close();
    check("T15a 起動時にsynthetic voices行が隔離削除される", synth === 0);
    check("T15b 非synthetic行は削除されない", human === 1);
  }
}

rmSync(TMP, { recursive: true, force: true });

console.log(`\n=== smoke-dist-hygiene: ${pass} passed, ${fail} failed ===`);
if (fail) {
  failures.forEach((f) => console.error("  FAILED:", f));
  process.exit(1);
}
