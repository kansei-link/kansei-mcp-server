#!/usr/bin/env node
/**
 * Release Safety rev3 — v1.2.1「配布物衛生回復リリース」の監査・構築・検証（Codex 10項目）
 *
 * サブコマンド:
 *   audit <tgz>              … seed/data棚卸し+機械検査（PII/secret/実名synthetic数値/否定情報/claimコード）
 *   build <v120.tgz> <out>   … 決定的構築: 公開済みv1.2.0 + 承認済み差分（PAYLOAD）→ v1.2.1候補
 *   verify <v120> <cand>     … semantic diff（package.json=versionのみ・README=承認置換のみ・
 *                               seed=サニタイズ規則どおり・その他バイト一致）+最終安全検査
 *
 * 承認済み差分（PAYLOAD）:
 *   - package.json: versionを1.2.1へ（他キー不変・verifyで意味検証）
 *   - README.md: `npx -y @kansei-link/mcp-server kansei-link` → `npx -y -p ...`（この置換のみ）
 *   - dist/bin/{install-hooks,report-hook,usage-hook,wrapped}.js(+.map): growth-mvp-prepのビルド物
 *     （リポジトリ内 growth-mvp/hotfix-v121-payload/ に凍結コピー・入力固定で決定的）
 *   - src/data/voices-seed.json → []（実名×synthetic成功率テキスト207件の除去）
 *   - src/data/service-stats-seed.json → []（実名×synthetic success_rate/latency 1019件の除去）
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { untgz, buildTgz, sha256 } from "./lib-tgz.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD_DIR = join(ROOT, "growth-mvp", "hotfix-v121-payload");
const [cmd, a1, a2] = process.argv.slice(2);

const NPX_OLD = /npx -y @kansei-link\/mcp-server (kansei-link[a-z-]*)/g;
const NPX_NEW = "npx -y -p @kansei-link/mcp-server $1";
const SANITIZE_EMPTY = ["package/src/data/voices-seed.json", "package/src/data/service-stats-seed.json"];
const BIN_FILES = ["install-hooks", "report-hook", "usage-hook", "wrapped"]
  .flatMap((b) => [`package/dist/bin/${b}.js`, `package/dist/bin/${b}.js.map`]);

// ── 機械検査（監査/最終検査で共用） ──
const SECRET_RES = [
  [/(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/, "stripe key"],
  [/whsec_[A-Za-z0-9]{10,}/, "webhook secret"],
  [/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, "github token"],
  [/AKIA[A-Z0-9]{16}/, "aws key"],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, "jwt"],
  [/SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, "sendgrid key"],
];
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;
const EMAIL_ALLOW = new Set(["contact@synapse-arrows.com", "noreply@anthropic.com", "user@example.com", "you@example.com", "test@example.com", "noreply@github.com"]);
const SYNTH_NUM_RES = [
  [/succeeds on \d+% of calls/i, "実名×synthetic成功率テキスト"],
  [/"success_rate":\s*0?\.\d+/, "synthetic success_rate数値"],
  [/median latency \d+ms/i, "synthetic latencyテキスト"],
];
const NEG_RES = [[/(使えない|接続できない|非推奨です|do not use|completely broken)/i, "未検証の否定断定"]];

function scanEntry(path, buf) {
  const findings = [];
  if (/\.(js|json|md|txt|map)$/.test(path)) {
    const text = buf.toString("utf8");
    for (const [re, label] of SECRET_RES) if (re.test(text)) findings.push(`secret:${label}`);
    if (/^package\/(src\/data|dist\/data)\//.test(path)) {
      for (const [re, label] of SYNTH_NUM_RES) if (re.test(text)) findings.push(`synthetic:${label}`);
      for (const [re, label] of NEG_RES) if (re.test(text)) findings.push(`negative:${label}`);
      for (const m of text.match(EMAIL_RE) ?? []) {
        const e = m.toLowerCase();
        if (!EMAIL_ALLOW.has(e) && !e.endsWith("users.noreply.github.com")) { findings.push(`pii:email(${e.slice(0, 40)})`); break; }
      }
    }
  }
  if (path.startsWith("package/dist/claim")) findings.push("claim-code:present");
  return findings;
}

function audit(tgzPath) {
  const files = untgz(readFileSync(tgzPath));
  const dataFiles = [...files.keys()].filter((p) => /^package\/src\/data\//.test(p));
  const rows = [];
  const allFindings = new Map();
  for (const [p, { data }] of files) {
    const f = scanEntry(p, data);
    if (f.length) allFindings.set(p, f);
  }
  for (const p of dataFiles.sort()) {
    const { data } = files.get(p);
    let entries = "-", cls = "public/curated";
    try { const j = JSON.parse(data.toString("utf8")); entries = Array.isArray(j) ? j.length : Object.keys(j).length; } catch { /* txt */ }
    if (/voices-seed/.test(p)) cls = "SYNTHETIC(実名×合成テキスト)";
    else if (/service-stats-seed/.test(p)) cls = "SYNTHETIC(実名×合成統計)";
    else if (/github-issues/.test(p)) cls = "public(GitHub由来・帰属明示)";
    else if (/services-seed|changelog|api-guides|recipes|watchlist/.test(p)) cls = "curated(カタログ/レシピ)";
    rows.push({ file: p, entries, class: cls, findings: (allFindings.get(p) ?? []).join("; ") || "-" });
  }
  console.log(JSON.stringify({ total_files: files.size, data_files: rows, other_findings: [...allFindings].filter(([p]) => !p.startsWith("package/src/data/")).map(([p, f]) => ({ p, f })) }, null, 1));
  const critical = [...allFindings.values()].flat().filter((f) => f.startsWith("secret:") || f.startsWith("claim-code:"));
  process.exit(critical.length ? 1 : 0);
}

function build(v120Path, outPath) {
  const files = untgz(readFileSync(v120Path));
  // 1) version
  const pkg = JSON.parse(files.get("package/package.json").data.toString("utf8"));
  pkg.version = "1.2.1";
  files.set("package/package.json", { data: Buffer.from(JSON.stringify(pkg, null, 2) + "\n"), mode: 0o644 });
  // 2) README（承認置換のみ）
  const readme = files.get("package/README.md").data.toString("utf8").replace(NPX_OLD, NPX_NEW);
  files.set("package/README.md", { data: Buffer.from(readme), mode: 0o644 });
  // 3) bins（凍結payloadから）
  for (const p of BIN_FILES) {
    const src = join(PAYLOAD_DIR, p.replace("package/dist/bin/", ""));
    files.set(p, { data: readFileSync(src), mode: 0o755 });
  }
  // 4) seed sanitize
  for (const p of SANITIZE_EMPTY) files.set(p, { data: Buffer.from("[]\n"), mode: 0o644 });
  const { tgz, tarSha256 } = buildTgz(files);
  writeFileSync(outPath, tgz);
  console.log(JSON.stringify({ out: outPath, files: files.size, tar_sha256: tarSha256, tgz_sha256: sha256(tgz) }, null, 1));
}

function verify(v120Path, candPath) {
  const oldF = untgz(readFileSync(v120Path));
  const newF = untgz(readFileSync(candPath));
  const errors = [], notes = [];
  // 集合一致
  for (const p of oldF.keys()) if (!newF.has(p)) errors.push(`removed: ${p}`);
  for (const p of newF.keys()) if (!oldF.has(p)) errors.push(`added: ${p}`);
  // 意味検証
  for (const [p, { data }] of newF) {
    const old = oldF.get(p); if (!old) continue;
    const same = Buffer.compare(old.data, data) === 0;
    if (p === "package/package.json") {
      const a = JSON.parse(old.data.toString("utf8")), b = JSON.parse(data.toString("utf8"));
      const aa = { ...a, version: "X" }, bb = { ...b, version: "X" };
      if (JSON.stringify(aa) !== JSON.stringify(bb)) errors.push("package.json: version以外に差分");
      else notes.push(`package.json: version ${a.version}→${b.version} のみ`);
    } else if (p === "package/README.md") {
      const expected = old.data.toString("utf8").replace(NPX_OLD, NPX_NEW);
      if (expected !== data.toString("utf8")) errors.push("README.md: 承認置換以外の差分");
      else notes.push("README.md: 承認済みnpx置換のみ");
    } else if (SANITIZE_EMPTY.includes(p)) {
      if (data.toString("utf8").trim() !== "[]") errors.push(`${p}: サニタイズ結果が[]でない`);
      else notes.push(`${p}: []（synthetic実名データ除去）`);
    } else if (BIN_FILES.includes(p)) {
      notes.push(`${p}: hotfixビルド物（差分許可）`);
    } else if (!same) {
      errors.push(`想定外の差分: ${p}`);
    }
  }
  // 最終安全検査（候補全体）:
  //   secret / claim-code / synthetic = 全域でゼロ必須
  //   pii / negative = 変更ファイルでのみerror（未変更ファイルはv1.2.0からの継承で、
  //   監査で「公開ベンダー連絡先・ベンダー自身の告知＝良性」と分類済み。データ源の
  //   恒久是正はC2のデータパイプライン課題として影響範囲レポートに記録）
  for (const [p, { data }] of newF) {
    const f = scanEntry(p, data);
    const old = oldF.get(p);
    const unchanged = old && Buffer.compare(old.data, data) === 0;
    const critical = f.filter((x) =>
      x.startsWith("secret:") || x.startsWith("claim-code:") || x.startsWith("synthetic:") ||
      (!unchanged && (x.startsWith("pii:") || x.startsWith("negative:"))));
    if (critical.length) errors.push(`最終検査: ${p}: ${critical.join("; ")}`);
  }
  console.log(errors.length ? `❌ verify FAIL (${errors.length})` : "✅ verify PASS");
  errors.slice(0, 20).forEach((e) => console.log("  -", e));
  notes.forEach((n) => console.log("  ✓", n));
  console.log(`candidate tgz sha256: ${sha256(readFileSync(candPath))}`);
  process.exit(errors.length ? 1 : 0);
}

if (cmd === "audit") audit(a1);
else if (cmd === "build") build(a1, a2);
else if (cmd === "verify") verify(a1, a2);
else { console.error("usage: release-safety-v121.mjs audit|build|verify ..."); process.exit(2); }
