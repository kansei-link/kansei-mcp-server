#!/usr/bin/env node
/**
 * Agent Wiki 限定生成の回帰テスト（準実験の対照群を公開しないための安全網）
 *
 * 背景: 公開は「介入」、対照群は同じ検証済み集合の中から選んで公開を保留する（wait-list control）。
 *       生成器が検証済み全件を一括で出すと対照群も公開されてしまうため、--only / --forbid / --ledger-sha256 を足した。
 *
 * 検査（ステージング出力 build/agent-wiki だけを使う。public/ には触れない）:
 *   1. --only で指定した id だけが出力される（index・sitemap・services の 3 か所とも）
 *   2. --forbid の id が出力対象に入ると exit≠0 で停止
 *   3. --only に検証済み集合に無い id があると exit≠0 で停止（id の正規化ミスを公開前に止める）
 *   4. --ledger-sha256 が実ファイルと違うと exit≠0／一致すれば通る
 *   5. 失敗時に直前の出力を壊さない（停止は出力ディレクトリを消す前に起きる）
 *
 * 判定台帳 data/runtime-freshness/verdicts.json は git 管理外。無い環境ではテスト用の最小台帳を一時的に置く。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GEN = join(ROOT, "scripts", "build-agent-wiki.mjs");
const OUT = join(ROOT, "build", "agent-wiki");
const LEDGER = join(ROOT, "data", "runtime-freshness", "verdicts.json");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };
const run = (args) => spawnSync(process.execPath, [GEN, ...args], { cwd: ROOT, encoding: "utf8" });

// 台帳が無い環境（CI・新しい worktree）では、Award 認定だけで対象が決まる。テストは Award A 以上の id を使う。
const award = JSON.parse(readFileSync(join(ROOT, "data", "ari-award-2026-summer.json"), "utf8")).services.filter((s) => ["AAA", "AA", "A"].includes(s.grade)).map((s) => s.service_id);
const seedRaw = JSON.parse(readFileSync(join(ROOT, "src", "data", "services-seed.json"), "utf8"));
const seedIds = new Set((seedRaw.services ?? seedRaw).map((r) => r.id)); // seed は配列そのもの／{services:[]} の両形式がある
const usable = award.filter((id) => seedIds.has(id));
const ONLY = usable.slice(0, 3);
const FORBID = usable.slice(3, 5);
let placedLedger = false;
if (!existsSync(LEDGER)) { mkdirSync(dirname(LEDGER), { recursive: true }); writeFileSync(LEDGER, JSON.stringify({ note: "smoke placeholder", verdicts: {} })); placedLedger = true; }
const ledgerSha = createHash("sha256").update(readFileSync(LEDGER)).digest("hex");

try {
  // 1. 限定生成
  let r = run([`--only=${ONLY.join(",")}`, `--forbid=${FORBID.join(",")}`, `--ledger-sha256=${ledgerSha}`]);
  const pages = existsSync(join(OUT, "services")) ? readdirSync(join(OUT, "services")).map((f) => f.replace(/\.html$/, "")).sort() : [];
  check("1a. --only の id だけがページになる", r.status === 0 && JSON.stringify(pages) === JSON.stringify([...ONLY].sort()), `pages=${pages.join(",")}`);
  const sitemap = readFileSync(join(OUT, "sitemap.xml"), "utf8");
  const index = readFileSync(join(OUT, "index.html"), "utf8");
  check("1b. sitemap は index＋指定件数だけ", (sitemap.match(/<loc>/g) || []).length === ONLY.length + 1);
  check("1c. 対照群の id が index・sitemap・ページのどこにも無い", FORBID.every((id) => !sitemap.includes(`services/${id}.html`) && !index.includes(`services/${id}.html`) && !existsSync(join(OUT, "services", `${id}.html`))));
  const pageHtml = ONLY.map((id) => readFileSync(join(OUT, "services", `${id}.html`), "utf8"));
  check("1d. ページの JSON-LD に未接続の報告先（potentialAction・/api/report）が無い", pageHtml.every((h) => !/potentialAction|report_outcome|\/api\/report/.test(h)));
  const snapshot = JSON.stringify(readdirSync(join(OUT, "services")).sort());

  // 2. 対照群が対象に入る → 停止
  r = run([`--only=${[...ONLY, FORBID[0]].join(",")}`, `--forbid=${FORBID.join(",")}`]);
  check("2. 対照群が --only に混ざると停止（exit≠0）", r.status !== 0 && /対照群/.test(r.stderr), (r.stderr || "").trim().split("\n").pop());
  r = run([`--forbid=${FORBID.join(",")}`]);
  check("2b. 限定なしの全件生成でも、対照群を含むなら停止", r.status !== 0 && /対照群/.test(r.stderr));

  // 3. 検証済み集合に無い id → 停止
  r = run([`--only=${ONLY[0]},this-id-does-not-exist`]);
  check("3. --only に検証済み集合に無い id があると停止", r.status !== 0 && /検証済み集合に無い/.test(r.stderr), (r.stderr || "").trim().split("\n").pop());

  // 4. 台帳の版固定
  r = run([`--only=${ONLY.join(",")}`, "--ledger-sha256=0000000000000000000000000000000000000000000000000000000000000000"]);
  check("4. 台帳の sha256 が違うと停止", r.status !== 0 && /版が違う/.test(r.stderr));

  // 5. 失敗は出力を壊さない
  check("5. 停止した実行は直前の出力を消さない", JSON.stringify(readdirSync(join(OUT, "services")).sort()) === snapshot);

  // 6. --all と --only の併用は拒否
  r = run(["--all", `--only=${ONLY[0]}`]);
  check("6. --all と --only の併用は停止", r.status !== 0);

  // 7. 台帳の訂正値がページに出る（seed の値ではなく）。確認日・出典・注記も出る。台帳は一時的に差し替え、必ず元に戻す
  const savedLedger = readFileSync(LEDGER);
  try {
    const led = JSON.parse(savedLedger.toString("utf8")); led.verdicts = led.verdicts ?? {};
    led.verdicts[ONLY[0]] = { verdict: "seed_wrong", checked_at: "2099-01-02", evidence_url: "https://docs.example.test/mcp", correction: { mcp_endpoint: "https://mcp.example.test/corrected", mcp_status: "official" }, notes: ["SMOKE-NOTE: 公式情報どうしの不一致の注記"] };
    writeFileSync(LEDGER, JSON.stringify(led));
    r = run([`--only=${ONLY.join(",")}`]);
    const page = readFileSync(join(OUT, "services", `${ONLY[0]}.html`), "utf8");
    check("7a. 台帳の訂正値が seed の値に代わってページと JSON-LD に出る", r.status === 0 && page.includes("https://mcp.example.test/corrected（official）") && (page.match(/mcp\.example\.test\/corrected/g) || []).length >= 2);
    check("7b. 確認日と出典（一次資料のホスト）が公開MCP の行に出る", /公開MCP<\/td><td>[^<]*<\/td><td><small>独立観測・確認 2099-01-02・出典 <a href="https:\/\/docs\.example\.test\/mcp"[^>]*>docs\.example\.test<\/a>/.test(page));
    check("7c. 注記が表の下に出る／確認・出典は訂正していない行（カテゴリ）には付かない", page.includes("SMOKE-NOTE") && /カテゴリ<\/td><td>[^<]*<\/td><td><small>独立観測<\/small>/.test(page));
  } finally { writeFileSync(LEDGER, savedLedger); }
} finally {
  if (placedLedger) rmSync(LEDGER, { force: true });
}

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-agent-wiki-limited: ALL PASS" : "\n❌ smoke-agent-wiki-limited: FAILURES");
process.exit(all ? 0 : 1);
