#!/usr/bin/env node
/**
 * v1.2.1 hotfix: install-hooks の legacy repair スモーク（本番非接触）
 *
 * HOMEをtempへ差し替え（win32: USERPROFILE）て dist/bin/install-hooks.js を駆動。
 * シナリオ（Codex指定）:
 *   1. 旧設定→修復（unrelated hooks保持・バックアップ作成）
 *   2. 混在設定（legacy+新形式+無関係）→ legacyのみ置換
 *   3. 2回実行 → 2回目は変更なし（idempotent）
 *   4. 壊れたJSON → exit 1・ファイル不変
 *   5. 権限エラー（read-only） → 非0 exit・原本不変
 *   6. バックアップ復元 → バックアップ内容=修復前と完全一致
 *   + dry-run: 差分表示のみ・ファイル不変
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "dist", "bin", "install-hooks.js");
const LEGACY_U = "npx -y @kansei-link/mcp-server kansei-link-usage-hook";
const FIXED_U = "npx -y -p @kansei-link/mcp-server kansei-link-usage-hook";
const LEGACY_R = "npx -y @kansei-link/mcp-server kansei-link-report-hook";
const FIXED_R = "npx -y -p @kansei-link/mcp-server kansei-link-report-hook";
const UNRELATED = "python C:/tools/my-custom-hook.py --flag";

const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

function freshHome(settings) {
  const home = mkdtempSync(join(tmpdir(), "kansei-hooks-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  if (settings !== undefined) writeFileSync(join(home, ".claude", "settings.json"), settings);
  return home;
}
function run(home, args = []) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args],
      { encoding: "utf8", env: { ...process.env, USERPROFILE: home, HOME: home } });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
}
const readSettings = (home) => JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
const rawSettings = (home) => readFileSync(join(home, ".claude", "settings.json"), "utf8");

// ── 1+2. 混在設定の修復（legacyのみ置換・unrelated/新形式保持） ──
const mixed = JSON.stringify({
  theme: "dark",
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: LEGACY_U }] },
           { hooks: [{ type: "command", command: UNRELATED }] }],
    SessionEnd: [{ hooks: [{ type: "command", command: FIXED_U }] }],
    PostToolUse: [{ matcher: "mcp__.*", hooks: [{ type: "command", command: LEGACY_R }] }],
    PreToolUse: [{ hooks: [{ type: "command", command: UNRELATED }] }],
  },
}, null, 2);
let home = freshHome(mixed);
const before = rawSettings(home);
let r = run(home, ["--repair"]);
let s = readSettings(home);
check("1. --repair: legacy 2件が修復される", r.code === 0 &&
  s.hooks.Stop[0].hooks[0].command === FIXED_U && s.hooks.PostToolUse[0].hooks[0].command === FIXED_R);
check("2. unrelated hooks・既存新形式・他設定キーは無傷", s.hooks.Stop[1].hooks[0].command === UNRELATED &&
  s.hooks.PreToolUse[0].hooks[0].command === UNRELATED && s.hooks.SessionEnd[0].hooks[0].command === FIXED_U && s.theme === "dark");

// ── 6. バックアップ=修復前と一致・復元可能 ──
const backups = readdirSync(join(home, ".claude")).filter((f) => f.startsWith("settings.json.bak-"));
check("3. バックアップ作成・内容=修復前と完全一致", backups.length === 1 &&
  readFileSync(join(home, ".claude", backups[0]), "utf8") === before);

// ── 3. idempotent（2回目は変更なし・バックアップも増えない） ──
r = run(home, ["--repair"]);
const backups2 = readdirSync(join(home, ".claude")).filter((f) => f.startsWith("settings.json.bak-"));
check("4. 2回目--repair→『nothing to repair』・書き込みなし", r.code === 0 && r.out.includes("nothing to repair") && backups2.length === 1);

// installモードでもrepairが走り、その後の再installで重複追加なし
r = run(home, []);
s = readSettings(home);
const stopCmds = s.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
check("5. install実行→重複追加なし（Stopに新形式1+unrelated1のみ）", stopCmds.filter((c) => c === FIXED_U).length === 1 && stopCmds.length === 2);
rmSync(home, { recursive: true, force: true });

// ── dry-run: ファイル不変 ──
home = freshHome(mixed);
r = run(home, ["--repair", "--dry-run"]);
check("6. --dry-run: 差分表示のみ・ファイル不変", r.code === 0 && r.out.includes("dry-run") && rawSettings(home) === mixed);
rmSync(home, { recursive: true, force: true });

// ── 4. 壊れたJSON → exit 1・不変 ──
home = freshHome("{ broken json !!");
r = run(home, ["--repair"]);
check("7. 壊れたJSON→exit 1・ファイル不変", r.code === 1 && rawSettings(home) === "{ broken json !!");
rmSync(home, { recursive: true, force: true });

// ── 5. 権限エラー（read-only） → 非0・原本不変 ──
home = freshHome(mixed);
const sf = join(home, ".claude", "settings.json");
chmodSync(sf, 0o444);
r = run(home, ["--repair"]);
chmodSync(sf, 0o666);
const unchanged = rawSettings(home) === mixed;
check("8. read-only settings→非0 exit・原本不変", r.code !== 0 && unchanged, `code=${r.code}`);
rmSync(home, { recursive: true, force: true });

// ── settings.jsonなし（新規install） ──
home = freshHome(undefined);
r = run(home, []);
s = readSettings(home);
check("9. 新規install: 3フックとも新形式（-p）で書かれる", r.code === 0 &&
  [s.hooks.Stop, s.hooks.SessionEnd, s.hooks.PostToolUse].every((ev) => ev.every((e) => e.hooks.every((h) => h.command.includes(" -p ")))));
rmSync(home, { recursive: true, force: true });

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-install-hooks-repair: ALL PASS" : "\n❌ smoke-install-hooks-repair: FAILURES");
process.exit(all ? 0 : 1);
