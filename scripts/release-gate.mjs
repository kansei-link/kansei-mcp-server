#!/usr/bin/env node
/**
 * P0 #39: リリースゲート — clean tag + clean worktree + 承認済みcommit 以外からの
 * publish を拒否する。**このスクリプト自身は npm publish を実行しない**（検証のみ。
 * publish は常に Michie L3 承認後の手動操作）。
 *
 * 検査（全PASSが publish の前提条件・1つでも違反で exit 1）:
 *   R1. clean worktree — `git status --porcelain` が空
 *   R2. タグ存在 — `v<package.json version>` タグが存在する
 *   R3. タグ=HEAD — そのタグの指すcommitがHEADと一致（承認済みcommitからのみpublish可）
 *   R4. pack-gate — npm pack実物が G1-G5 をPASS
 *   R5. route-gate — 公開ルートがallowlist+SECレビューと一致（route-allowlist.jsonがある場合）
 *
 * 使い方:
 *   node scripts/release-gate.mjs                 … フル検査（リリース前の標準工程）
 *   node scripts/release-gate.mjs --dir <repo>    … 対象リポジトリ差し替え（テスト用）
 *   node scripts/release-gate.mjs --checks git    … R1-R3のみ（テスト用）
 */
import { execSync, execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const DIR = argOf("--dir") ?? join(SCRIPTS, "..");
const CHECKS = argOf("--checks") ?? "all";

const git = (cmd) => execSync(`git ${cmd}`, { cwd: DIR, encoding: "utf8" }).trim();
const errors = [];

// R1: clean worktree
const porcelain = git("status --porcelain");
if (porcelain !== "") {
  errors.push(`R1 dirty worktree — publishはclean状態のみ (${porcelain.split("\n").length} 件の未コミット変更)`);
}

// R2/R3: tag
const version = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8")).version;
const tag = `v${version}`;
let tagCommit = null;
try {
  tagCommit = git(`rev-parse "${tag}^{commit}"`);
} catch {
  errors.push(`R2 タグ ${tag} が存在しません — 承認済みリリースはタグ必須`);
}
if (tagCommit) {
  const head = git("rev-parse HEAD");
  if (tagCommit !== head) {
    errors.push(`R3 タグ ${tag} (${tagCommit.slice(0, 7)}) と HEAD (${head.slice(0, 7)}) が不一致 — タグの指すcommit以外からpublish不可`);
  }
}

// R4/R5: pack-gate + route-gate（R1-R3が通っている場合のみ実行——dirty状態のpackは無意味）
if (CHECKS === "all" && errors.length === 0) {
  let tgz = null;
  try {
    const out = execSync("npm pack --json", { cwd: DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    tgz = join(DIR, JSON.parse(out)[0].filename);
    execFileSync(process.execPath, [join(SCRIPTS, "pack-gate.mjs"), tgz], { stdio: "inherit" });
  } catch {
    errors.push("R4 pack-gate FAIL — 配布物衛生違反（上記ログ参照）");
  } finally {
    if (tgz) rmSync(tgz, { force: true });
  }

  if (existsSync(join(DIR, "route-allowlist.json"))) {
    try {
      execFileSync(process.execPath, [join(SCRIPTS, "route-gate.mjs"), "--allowlist", join(DIR, "route-allowlist.json")], {
        stdio: "inherit",
        cwd: DIR,
      });
    } catch {
      errors.push("R5 route-gate FAIL — 公開ルートがallowlist/SECレビューと不一致（上記ログ参照）");
    }
  } else {
    console.log("  (R5 route-allowlist.json なし — スキップ)");
  }
}

if (errors.length) {
  console.error(`❌ release-gate FAIL (${errors.length}) — この状態からのpublishは禁止:`);
  errors.forEach((e) => console.error("  -", e));
  process.exit(1);
}
console.log(`✅ release-gate PASS — ${tag} @ HEAD, clean worktree${CHECKS === "all" ? ", pack-gate/route-gate PASS" : " (gitのみ検査)"}`);
console.log("   publish自体はこのスクリプトでは実行しません（L3承認後に手動: npm publish <検証済みtgz>）");
