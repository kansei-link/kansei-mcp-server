// #1: Profile MVP 候補リスト生成（rev: Codex中間レビュー反映）
// - 公開単位は「100サービスプロフィール」・Claim単位は企業組織（organization_id接続）
// - 状態は candidate（L3承認まで完了扱いしない）
// - 選定理由をprovenanceに分解（ari_rank / focus_category / search_demand / verified_evidence）
// - 同一組織の掲載上限は「提案値」であり決定はL3
// - ARIの個別スコア・順位はProfile生成物に出力しない（本ファイルの数値は選定根拠の内部データ）
import { readFileSync, writeFileSync } from "node:fs";

const m = readFileSync("src/data/ari-award-2026-summer-csv.ts", "utf8");
const csv = m.slice(m.indexOf('"') + 1, m.lastIndexOf('";')).replace(/\\n/g, "\n").replace(/^﻿/, "");
const rows = csv.trim().split("\n").slice(1).map((l) => {
  const [rank, name, category, grade, score, mcp, auth] = l.split(",");
  return { rank: +rank, name, category, grade, score: +score, mcp, auth };
});

// organization_id: 名前接頭辞で確実な製品ファミリーのみ自動束ね（org_status=candidate・確定はFレーン/L3）。
// グループ会社（GMO系・LINE系等）は法人が異なるため自動で束ねない（rev3方針: グループ会社は別法人扱い）。
function orgOf(name) {
  // 同一法人確認済み（GMOイプシロン株式会社・fincode.jpフッター/epsilon.jp相互確認）
  if (name === "fincode byGMO" || name === "GMOイプシロン") return "org-gmo-epsilon";
  if (/^freee|freee/.test(name) || name.includes("freee")) return "org-freee";
  if (name.startsWith("奉行クラウド")) return "org-obc";
  if (name.startsWith("KARTE")) return "org-plaid";
  if (name.startsWith("マネーフォワード") || name.startsWith("MFクラウド")) return "org-moneyforward";
  if (name.startsWith("STORES")) return "org-stores";
  // 既定はサービス名そのままの1組織（CJKを保持——ASCII化すると日本語名が空になり
  // 無関係サービスが同一orgへ誤結合する。GMO系等のグループは法人が異なるため束ねない）
  return `org-${name.toLowerCase().replace(/\s+/g, "-")}`;
}

// 重点カテゴリ（battery v2の検索需要と商談接点から提案・確定はL3）
const FOCUS_CATEGORIES = ["会計・経理", "人事・労務", "CRM・営業"];

const candidates = rows.filter((r) => r.rank <= 100).map((r) => ({
  service: r.name,
  category: r.category,
  grade: r.grade,            // Profileには段階バッジのみ出力（数値スコア・順位は出さない）
  mcp: r.mcp,
  auth: r.auth,
  organization_id: orgOf(r.name),
  org_status: "candidate",   // 組織同定はFレーン確定まで候補
  selection_provenance: {
    ari_rank: r.rank,        // 内部選定根拠（公開生成物には出力しない）
    focus_category: FOCUS_CATEGORIES.includes(r.category),
    search_demand: FOCUS_CATEGORIES.includes(r.category) ? "battery-v2対象カテゴリ" : null,
    verified_evidence: null, // E1実測との結合はC2（現時点ではnull=正直に未結合）
  },
}));

// 同一組織の件数集計と上限提案
const orgCount = {};
candidates.forEach((c) => { orgCount[c.organization_id] = (orgCount[c.organization_id] || 0) + 1; });
const PROPOSED_ORG_CAP = 4; // 提案値（L3決定事項）
const flagged = candidates.filter((c) => orgCount[c.organization_id] > PROPOSED_ORG_CAP)
  .map((c) => c.service);

writeFileSync("growth-mvp/selection-100.json", JSON.stringify({
  generated: "2026-08-16",
  status: "candidate",        // ★L3承認まで候補（「完了」ではない）
  unit: "100サービスプロフィール（100社ではない。Claim単位=組織・organization_idで接続）",
  basis: "一次基準=ARI Award 2026 Summer順位（内部根拠・公開生成物にスコア/順位は出力しない）。分解provenance=ari_rank/focus_category/search_demand/verified_evidence。同一組織上限は提案値4（超過分の扱い=L3決定: 掲載継続 or 入替）",
  proposed_org_cap: PROPOSED_ORG_CAP,
  org_cap_exceeded: { orgs: Object.entries(orgCount).filter(([, n]) => n > PROPOSED_ORG_CAP).map(([o, n]) => `${o}(${n})`), services: flagged },
  focus_categories: FOCUS_CATEGORIES,
  qa10: candidates.slice(0, 10).map((c) => c.service),
  canary20_rev2_note: "rev2: Jooto除外（2027-07一般提供終了の公式告知・Checker発見）→rank21 Keeper繰上げ",
  canary20: (()=>{ const base=candidates.slice(0,20).map((c)=>c.service).filter((s)=>s!=="Jooto"); const next=rows.find((r)=>r.rank===21); if(next&&base.length<20)base.push(next.name); return base; })(),
  org_summary: orgCount,
  rows: candidates,
}, null, 1));

console.log("candidates:", candidates.length, "(status=candidate・L3承認待ち)");
console.log("multi-service orgs:", Object.entries(orgCount).filter(([, n]) => n > 1).map(([o, n]) => `${o}:${n}`).join(" "));
console.log(`org cap ${PROPOSED_ORG_CAP}超過:`, flagged.join(", ") || "なし");
