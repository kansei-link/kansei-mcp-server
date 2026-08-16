#!/usr/bin/env node
/**
 * Canary正本の集合完全一致テスト（Codex条件2）
 *
 * 唯一の正本 growth-mvp/canary-20-active.json に対し:
 *   S1. active=20件・Jooto不在・Keeper在・high+medium=20（low 0）
 *   S2. canary-20.csv のservice集合 = 正本
 *   S3. claim-domain-canary20-active.json のservice集合 = 正本
 *   S4. claim-domain-history.json と active が互いに素・historyにJooto在
 *   S5. profile-drafts/ のスラッグ集合 = 正本のservice集合（qa-internal manifestで対応）
 *   S6. publish-manifest.json の profiles/ ファイル集合 = 正本
 *   S7. selection-100.json の canary20 = 正本（生成元との循環一致）
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const g = (p) => JSON.parse(readFileSync(join(ROOT, "growth-mvp", p), "utf8"));
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };
const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const diff = (a, b) => [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))).slice(0, 5).join(",");

const master = g("canary-20-active.json");
const M = new Set(master.services.map((s) => s.service));

// S1（rev: 集合サイズだけでなく物理行数もassert——重複行の混入を確実に検出）
const conf = master.confidence_summary;
check("S1. 正本=20件・Jooto無・Keeper有・high+medium=20", M.size === 20 && !M.has("Jooto") && M.has("Keeper") && (conf.high + conf.medium === 20) && !(conf.low > 0));
check("S1b. 物理行数=20（正本配列・CSV・claim-domain active各々・重複なし）",
  master.services.length === 20 &&
  readFileSync(join(ROOT, "growth-mvp", "canary-20.csv"), "utf8").replace(/^﻿/, "").trim().split("\n").length === 21 && // header+20
  g("claim-domain-canary20-active.json").rows.length === 20);

// S2 CSV
const csv = readFileSync(join(ROOT, "growth-mvp", "canary-20.csv"), "utf8").replace(/^﻿/, "").trim().split("\n").slice(1);
const C = new Set(csv.map((l) => l.split(",")[0]));
check("S2. csv集合=正本", eqSet(M, C), diff(M, C));

// S3 claim-domain active
const cda = g("claim-domain-canary20-active.json");
const A = new Set(cda.rows.map((r) => r.service_id));
check("S3. claim-domain active集合=正本", eqSet(M, A), diff(M, A));

// S4 history disjoint + Jooto
const hist = g("claim-domain-history.json");
const H = new Set(hist.rows.map((r) => r.service_id));
check("S4. historyとactiveが互いに素・historyにJooto", [...H].every((x) => !M.has(x)) && H.has("Jooto"));

// S5 profile slugs
const qa = g("qa-internal/manifest.json");
const slugBySvc = new Map(qa.profiles.map((p) => [p.name, p.file]));
const expectedFiles = new Set([...M].map((s) => slugBySvc.get(s)));
const actualFiles = new Set(readdirSync(join(ROOT, "growth-mvp", "profile-drafts")).filter((f) => f.endsWith(".html")));
check("S5. profile-drafts集合=正本(20枚)", !expectedFiles.has(undefined) && eqSet(expectedFiles, actualFiles), diff(expectedFiles, actualFiles));

// S6 publish manifest
const pm = g("publish-manifest.json");
const P = new Set(pm.files.filter((f) => f.path.startsWith("/profiles/")).map((f) => f.path.replace("/profiles/", "")));
check("S6. publish manifestのprofiles集合=正本", eqSet(expectedFiles, P), diff(expectedFiles, P));

// S7 selection canary20
const sel = g("selection-100.json");
const S = new Set(sel.canary20);
check("S7. selection.canary20=正本", eqSet(M, S), diff(M, S));

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-canary-consistency: ALL PASS" : "\n❌ smoke-canary-consistency: FAILURES");
process.exit(all ? 0 : 1);
