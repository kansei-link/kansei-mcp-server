// Canary唯一の正本 canary-20-active.json の生成と、派生物の再導出（Codex条件2）
//
// 正本: growth-mvp/canary-20-active.json（Keeper入り・Jootoなし・20件・
//        claim_domain/confidence/organization_idを1行に統合）
// 派生: canary-20.csv ／ claim-domain-canary20-active.json ／
//        claim-domain-history.json（Jooto等の除外行・監査用）
// Profile20枚とpublish manifestは正本のservice集合から生成・検証
//   （集合一致テスト = scripts/smoke-canary-consistency.mjs）
import { readFileSync, writeFileSync } from "node:fs";

const sel = JSON.parse(readFileSync("growth-mvp/selection-100.json", "utf8"));
const cd = JSON.parse(readFileSync("growth-mvp/claim-domain-canary20-candidate.json", "utf8"));
const cdRows = Array.isArray(cd) ? cd : (cd.rows || cd.candidates);

const ACTIVE_SERVICES = sel.canary20; // rev2確定: Keeper入り・Jootoなし
if (ACTIVE_SERVICES.length !== 20) throw new Error(`canary20 must be 20, got ${ACTIVE_SERVICES.length}`);
if (ACTIVE_SERVICES.includes("Jooto")) throw new Error("Jooto must not be active");
if (!ACTIVE_SERVICES.includes("Keeper")) throw new Error("Keeper must be active");

const selBySvc = new Map(sel.rows.map((r) => [r.service, r]));
const cdBySvc = new Map(cdRows.map((r) => [r.service_id, r]));

const active = ACTIVE_SERVICES.map((svc) => {
  const s = selBySvc.get(svc);
  const d = cdBySvc.get(svc);
  if (!s || !d) throw new Error(`missing data for ${svc}: selection=${Boolean(s)} claim_domain=${Boolean(d)}`);
  return {
    service: svc,
    organization_id: s.organization_id,
    category: s.category,
    grade: s.grade,
    mcp: s.mcp,
    auth: s.auth,
    in_qa10: sel.qa10.includes(svc),
    claim_domain: d.claim_domain,
    claim_domain_provenance: d.provenance,
    claim_domain_confidence: d.confidence,
    claim_domain_source_url: d.source_url,
    auto_verification: d.confidence === "high", // mediumはmanual_review運用
    exception_reason: d.exception_reason ?? null,
    status: "candidate", // L3承認まで
  };
});

// assert: high+medium = 20（lowが混ざったら止める）
const conf = { high: 0, medium: 0, low: 0 };
active.forEach((a) => { conf[a.claim_domain_confidence] = (conf[a.claim_domain_confidence] || 0) + 1; });
if (conf.high + conf.medium !== 20 || conf.low > 0) throw new Error(`confidence assert failed: ${JSON.stringify(conf)}`);

writeFileSync("growth-mvp/canary-20-active.json", JSON.stringify({
  generated: "2026-08-16",
  rev: "rev2 (Jooto EOL out / Keeper in / org-gmo-epsilon merged)",
  status: "candidate",
  note: "canaryの唯一の正本。csv・claim-domain active・Profile20枚・publish manifestは全て本ファイルから導出（smoke-canary-consistency.mjsが集合一致を強制）",
  confidence_summary: conf,
  services: active,
}, null, 1));

// 派生1: canary-20.csv
const csvRows = [["service", "organization_id", "category", "grade", "mcp", "auth", "in_qa10", "claim_domain", "confidence", "auto_verification"]];
active.forEach((a) => csvRows.push([a.service, a.organization_id, a.category, a.grade, a.mcp, a.auth, a.in_qa10 ? "yes" : "no", a.claim_domain, a.claim_domain_confidence, a.auto_verification ? "yes" : "manual_review"]));
writeFileSync("growth-mvp/canary-20.csv", "﻿" + csvRows.map((r) => r.join(",")).join("\n"));

// 派生2: claim-domain active / history 分割（21件集計の解消）
const activeSet = new Set(ACTIVE_SERVICES);
const cdActive = cdRows.filter((r) => activeSet.has(r.service_id));
const cdHistory = cdRows.filter((r) => !activeSet.has(r.service_id));
writeFileSync("growth-mvp/claim-domain-canary20-active.json", JSON.stringify({ generated: "2026-08-16", count: cdActive.length, rows: cdActive }, null, 1));
writeFileSync("growth-mvp/claim-domain-history.json", JSON.stringify({ generated: "2026-08-16", note: "canary activeから除外された行の監査用アーカイブ（削除しない）", count: cdHistory.length, rows: cdHistory }, null, 1));

console.log(`canary-20-active.json: ${active.length}件 (high=${conf.high} medium=${conf.medium})`);
console.log(`claim-domain: active=${cdActive.length} history=${cdHistory.length} (${cdHistory.map((r) => r.service_id).join(",")})`);
