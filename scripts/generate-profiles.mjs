#!/usr/bin/env node
/**
 * generate-profiles.mjs — 公開Profileドラフト生成パイプライン（Maker）
 *
 * 設計正典: founder-ops/PLAN-Profile-Claim-MVP-v1.md rev3
 *   §1 公開原則（憲法）:
 *     1. 公開できるのは「検証済み事実」と「未確認（検証予定）」表示の2種類だけ
 *     2. 公開禁止: 合成成功率・否定的断定・未検証の推測
 *     3. 欠落は空欄ではなく「未確認（検証予定）」
 *     4. 全ての事実に last_verified。検証日なしの事実は公開しない
 *     5. R-005解除まで個社数値は非公開（本ドラフトは格付けバッジのみ・スコア数値は出さない）
 *   §3 Profile項目定義 / §4.0 Claimed・Company Representative Verified・Evidence Tierの3概念分離
 *
 * Maker/Checker分離: 本スクリプトはドラフト生成のみ。公開判定はChecker（kl-integrity + Michie L3）。
 * 出力:
 *   growth-mvp/profile-drafts/{slug}.html  — 公開してよいHTMLのみ（内部データ・コメント一切なし）
 *   growth-mvp/qa-internal/manifest.json   — Checker向け生成記録＋未検証seed候補（公開ディレクトリ外）
 * 原則（Codex P1）: 未検証データは「公開時にstripする」のではなく最初から公開成果物に入れない。
 * HTMLコメントも公開データ（view-source/クローラーに見える）として扱う。
 *
 * 使い方:
 *   node scripts/generate-profiles.mjs            # qa10のみ生成（デフォルト）
 *   node scripts/generate-profiles.mjs --all      # 選定100社すべて生成
 *   node scripts/generate-profiles.mjs --only freee-kaikei
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "growth-mvp", "profile-drafts"); // 公開してよいHTMLのみ
const QA_DIR = path.join(ROOT, "growth-mvp", "qa-internal"); // Checker向け内部データ（公開しない）

// ARI Award 2026 Summer 公開データの基準日（public/ari-award/2026-summer.html から生成された日）
const ARI_LAST_VERIFIED = "2026-07-21";
const ARI_EDITION = "ARI Award 2026 Summer";
// 確認日がARI調査日であることを誤読なく明示する表記（Codex追加条件）
const CONFIRMED_AT = `確認日: ${ARI_LAST_VERIFIED}（${ARI_EDITION}調査時点）`;

// ---------------------------------------------------------------------------
// 入力1: 選定100社
// ---------------------------------------------------------------------------
const selection = JSON.parse(
  readFileSync(path.join(ROOT, "growth-mvp", "selection-100.json"), "utf8")
);

// ---------------------------------------------------------------------------
// 入力2: ARI Award CSV（格付け・カテゴリ・MCP提供・認証方式の正本）
// ---------------------------------------------------------------------------
function loadAriCsv() {
  const ts = readFileSync(
    path.join(ROOT, "src", "data", "ari-award-2026-summer-csv.ts"),
    "utf8"
  );
  const m = ts.match(/ARI_AWARD_2026_SUMMER_CSV\s*=\s*"([\s\S]*?)";/);
  if (!m) throw new Error("ARI CSV not found in ari-award-2026-summer-csv.ts");
  const raw = m[1].replace(/^﻿/, "").replace(/\\n/g, "\n");
  const lines = raw.split("\n").filter((l) => l.trim());
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const [rank, name, category, grade, score, mcp, auth] = line.split(",");
    if (!name) continue;
    rows.set(name.trim(), {
      rank: Number(rank),
      name: name.trim(),
      category: category?.trim() ?? "",
      grade: grade?.trim() ?? "",
      // スコア数値は公開しない（R-005）。整合チェック用に保持のみ・出力には一切使わない
      _score_internal: Number(score),
      mcp: mcp?.trim() ?? "",
      auth: auth?.trim() ?? "",
    });
  }
  return rows;
}
const ariRows = loadAriCsv();

// ---------------------------------------------------------------------------
// 入力3: services-seed.json（補足参照のみ・未検証データは公開HTMLに描画しない）
// 一致はサービス名の正規化マッチ。無理に紐付けない（一致しなければ no_match）。
// ---------------------------------------------------------------------------
function normalizeName(s) {
  return String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・:：!！&＆'’()（）.]/g, "");
}

function loadSeedIndex() {
  let seed;
  try {
    seed = JSON.parse(
      readFileSync(path.join(ROOT, "src", "data", "services-seed.json"), "utf8")
    );
  } catch {
    return new Map(); // seedが読めなくても生成は続行（補足なし）
  }
  const idx = new Map();
  // 手作業キュレーション分（namespaceなし）のみを補足候補とする。
  // MCPレジストリ由来のサードパーティ登録（namespaceあり）は同名でも別実体の
  // 可能性が高いため紐付けない。
  for (const e of seed) {
    if (e.namespace) continue;
    const key = normalizeName(e.name || "");
    if (key && !idx.has(key)) idx.set(key, e);
  }
  return idx;
}
const seedIndex = loadSeedIndex();

// ---------------------------------------------------------------------------
// slug: ローマ字/英名ベース・URL安全。日本語名は明示マップ（推測変換をしない）
// ---------------------------------------------------------------------------
const SLUG_OVERRIDES = {
  "freee会計": "freee-kaikei",
  "freee人事労務": "freee-jinji-roumu",
  "freeeサイン": "freee-sign",
  "freee給与計算": "freee-kyuyo-keisan",
  "カラーミーショップ": "colorme-shop",
  "GMOイプシロン": "gmo-epsilon",
  "GMOペイメントゲートウェイ": "gmo-payment-gateway",
  "スマレジ": "smaregi",
  "GMOトラスト・ログイン": "gmo-trust-login",
  "ネクストエンジン": "next-engine",
  "マネーフォワード クラウド": "moneyforward-cloud",
  "ロジクラ(freee在庫管理)": "logikura",
  "楽天市場": "rakuten-ichiba",
  "invox受取請求書": "invox-uketori-seikyusho",
  "MFクラウド給与": "mf-cloud-kyuyo",
  "バクラク": "bakuraku",
  "ロジレス": "logiless",
  "奉行クラウド会計": "bugyo-cloud-kaikei",
  "奉行クラウド給与": "bugyo-cloud-kyuyo",
  "奉行クラウドワークフロー": "bugyo-cloud-workflow",
  "カオナビ": "kaonavi",
  "クラウドサイン": "cloudsign",
  "日本郵便API": "japan-post-api",
  "Create!Webフロー": "create-web-flow",
  "eセールスマネージャー": "e-sales-manager",
  "Ship&co": "shipandco",
  "LINE公式アカウント": "line-official-account",
};

function slugify(name) {
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name];
  const s = String(name)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s || /[^a-z0-9-]/.test(s)) {
    throw new Error(
      `slug化できないサービス名: "${name}" — SLUG_OVERRIDES に明示追加してください（推測変換はしない）`
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// 表示語彙（憲法準拠の定型文のみ。自由記述の評価文を生成しない）
// ---------------------------------------------------------------------------
const UNVERIFIED = "未確認（検証予定）";

const MCP_LABELS = {
  "公式MCP": "公式MCPの提供を確認",
  "サードパーティMCP": "サードパーティMCPの存在を確認",
  "API公開のみ": "公開APIを確認（MCPは確認時点で未提供）",
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// HTMLテンプレート
// ---------------------------------------------------------------------------
function renderProfile(svc) {
  const name = escapeHtml(svc.name);
  const grade = escapeHtml(svc.grade);
  const category = escapeHtml(svc.category);
  const authKnown = svc.auth && svc.auth !== "—";
  const auth = authKnown ? escapeHtml(svc.auth) : null;
  const mcpLabel = MCP_LABELS[svc.mcp] || null;

  // 未確認項目リスト（欠落は空欄ではなく明示する — 憲法§1-3）
  const unverifiedItems = [
    "運営会社（公式情報での照合を予定）",
    "公式サイトURL（公式情報での照合を予定）",
    "API方式（REST/GraphQL等の別）",
    "公式APIドキュメントURL",
    ...(authKnown ? [] : ["認証方式"]),
    ...(mcpLabel ? [] : ["MCP提供状況"]),
    "接続実測の実施と確認日",
    "既知の注意点（実測裏付けのある事実のみ掲載予定）",
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: svc.name,
    applicationCategory: svc.category,
    // url: 公式URLは未検証のため出力しない（推測URL禁止）
  };

  // verified=true の行はARI調査時点の確認である旨を明示した定型表記を使う。
  // 未検証の候補データ（seed等）はHTMLに一切書かない — HTMLコメントも公開データ（Codex P1）。
  const factRow = (label, value, verified) => `
        <tr>
          <th scope="row">${label}</th>
          <td>${value}</td>
          <td class="lv">${verified ? CONFIRMED_AT : `—`}</td>
        </tr>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} のAI Agent Readiness Profile | KanseiLink</title>
<meta name="description" content="${name}（${category}）のAI Agent Readiness Profile。ARI Award 2026 Summer 格付け、MCP提供状況、認証方式など、検証済み事実と未確認項目を確認日つきで区別して掲載しています。">
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
<style>
  :root { --teal: #00bfa5; --ink: #1a2b32; --muted: #5f7480; --line: #e3ebee; --bg: #f7fafb; --card: #ffffff; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Inter", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; color: var(--ink); background: var(--bg); line-height: 1.75; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 40px 20px 64px; }
  header.site { border-bottom: 3px solid var(--teal); padding: 14px 0; margin-bottom: 32px; }
  header.site .brand { font-weight: 700; letter-spacing: .02em; }
  header.site .brand span { color: var(--teal); }
  .crumb { font-size: .8rem; color: var(--muted); margin-bottom: 12px; }
  h1 { font-size: 1.7rem; line-height: 1.4; margin-bottom: 8px; }
  .meta-line { color: var(--muted); font-size: .9rem; margin-bottom: 24px; }
  .chip { display: inline-block; background: #e6f7f4; color: #00806f; border: 1px solid #bfe9e2; border-radius: 999px; padding: 1px 12px; font-size: .8rem; margin-right: 8px; }
  .grade-badge { display: inline-flex; align-items: center; gap: 10px; background: var(--card); border: 2px solid var(--teal); border-radius: 12px; padding: 14px 20px; margin: 8px 0 6px; }
  .grade-badge .g { font-size: 1.9rem; font-weight: 800; color: var(--teal); letter-spacing: .04em; }
  .grade-badge .d { font-size: .82rem; color: var(--muted); }
  .note { font-size: .8rem; color: var(--muted); margin-bottom: 28px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 22px 24px; margin-bottom: 20px; }
  h2 { font-size: 1.05rem; border-left: 4px solid var(--teal); padding-left: 10px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th[scope="row"] { width: 11em; color: var(--muted); font-weight: 600; }
  td.lv { width: 16em; font-size: .8rem; color: var(--muted); }
  @media (max-width: 680px) {
    th[scope="row"] { width: auto; min-width: 7em; }
    td.lv { width: auto; white-space: normal; }
    .badge-unverified { white-space: nowrap; }
  }
  .badge-unverified { display: inline-block; background: #f2f5f7; color: var(--muted); border: 1px dashed #c6d2d8; border-radius: 6px; padding: 0 8px; font-size: .8rem; }
  ul.unverified-list { list-style: none; }
  ul.unverified-list li { padding: 6px 0 6px 1.4em; position: relative; border-bottom: 1px dashed var(--line); font-size: .9rem; }
  ul.unverified-list li::before { content: "□"; position: absolute; left: 0; color: var(--teal); }
  .tier-box { background: #f2fbf9; border: 1px solid #cdeee8; border-radius: 10px; padding: 14px 16px; font-size: .9rem; }
  .claim-box { text-align: center; padding: 26px 20px; }
  .claim-box p { font-size: .92rem; color: var(--muted); margin-top: 8px; }
  .claim-cta { display: inline-block; background: var(--teal); color: #fff; font-weight: 700; border-radius: 8px; padding: 12px 28px; opacity: .55; cursor: default; }
  footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); font-size: .78rem; color: var(--muted); }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e6edf0; --muted: #9db2bc; --line: #2a3b43; --bg: #101b20; --card: #16242b; }
    .chip { background: #123833; color: #6fd9c9; border-color: #1d4f48; }
    .badge-unverified { background: #1b2930; border-color: #3a4d56; }
    .tier-box { background: #12312c; border-color: #1d4f48; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="site"><div class="brand">Kansei<span>Link</span> — AI Agent Readiness Profile</div></header>

  <div class="crumb">Profiles / ${category} / ${name}</div>
  <h1>${name}</h1>
  <div class="meta-line"><span class="chip">${category}</span>本プロフィールの基準データ: ${ARI_EDITION}（確認日: ${ARI_LAST_VERIFIED}）</div>

  <section>
    <h2>ARI 格付け</h2>
    <div class="grade-badge">
      <div class="g">${grade}</div>
      <div class="d">${ARI_EDITION} 認定<br>${CONFIRMED_AT}</div>
    </div>
    <p class="note">格付けは既公開の ${ARI_EDITION}（AIエージェントからの接続しやすさの段階評価）に基づく段階表示です。本ページに数値評価は掲載しません。</p>
  </section>

  <section>
    <h2>基本情報</h2>
    <table>
      <tbody>${factRow("正式名（ARI掲載名）", name, ARI_LAST_VERIFIED)}${factRow("カテゴリ", category, ARI_LAST_VERIFIED)}${factRow("運営会社", `<span class="badge-unverified">${UNVERIFIED}</span>`, null)}${factRow("公式サイトURL", `<span class="badge-unverified">${UNVERIFIED}</span>`, null)}
      </tbody>
    </table>
  </section>

  <section>
    <h2>接続性</h2>
    <table>
      <tbody>${factRow("MCP提供状況", mcpLabel ? escapeHtml(mcpLabel) : `<span class="badge-unverified">${UNVERIFIED}</span>`, mcpLabel ? ARI_LAST_VERIFIED : null)}${factRow("認証方式", auth ? auth : `<span class="badge-unverified">${UNVERIFIED}</span>`, auth ? ARI_LAST_VERIFIED : null)}${factRow("API方式", `<span class="badge-unverified">${UNVERIFIED}</span>`, null)}${factRow("公式APIドキュメント", `<span class="badge-unverified">${UNVERIFIED}</span>`, null)}
      </tbody>
    </table>
  </section>

  <section>
    <h2>検証状態（Evidence Tier）</h2>
    <div class="tier-box">
      <strong>E0（未実測）</strong> — 接続性の実測は準備中です。実測が完了した項目から、確認日つきで順次このページに反映します。<br>
      Evidence Tier は KanseiLink の実測のみで決まり、企業からの申告や Claim の有無では変わりません。
    </div>
  </section>

  <section>
    <h2>未確認の項目（検証予定）</h2>
    <p class="note">「未確認」は検証待ちの宣言であり、評価ではありません。確認が済んだ項目から確認日つきで掲載します。</p>
    <ul class="unverified-list">
${unverifiedItems.map((i) => `      <li>${escapeHtml(i)}</li>`).join("\n")}
    </ul>
  </section>

  <section>
    <h2>更新情報</h2>
    <table>
      <tbody>${factRow("データ基準", `${ARI_EDITION}（公開済みデータ）`, ARI_LAST_VERIFIED)}${factRow("次回検証", "準備中（実測パイプライン整備後に順次実施）", null)}
      </tbody>
    </table>
  </section>

  <section class="claim-box">
    <h2>この企業のご担当者ですか？</h2>
    <span class="claim-cta">掲載内容の確認・訂正申請（準備中）</span>
    <p>公式窓口としての確認と、事実の訂正申請を受け付ける仕組みを準備しています。<br>訂正申請は KanseiLink の検証を経て反映され、申請の有無で格付け・順位は変わりません。</p>
  </section>

  <footer>
    <p>本ページは検証済み事実と未確認項目を区別して表示します。データはKanseiLinkの実測・公開情報に基づき、確認日を併記しています。</p>
    <p>&copy; 2026 KanseiLink — AI Agent Readiness 評価機関</p>
  </footer>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// 公開原則ガード（機械チェック）— 違反があれば書き込みを中止する
// ---------------------------------------------------------------------------
const FORBIDDEN_PATTERNS = [
  { re: /成功率/, why: "成功率の表示は5点セット必須・R-005によりMVPでは全面禁止" },
  { re: /\d+(\.\d+)?\s*%/, why: "パーセント数値（成功率等の数値公開の疑い）" },
  { re: /スコア\s*[:：]?\s*\d/, why: "スコア数値の公開（R-005）" },
  { re: /90点|満点/, why: "スコア数値の公開（R-005）" },
  { re: /使えない|接続できない|非推奨|できません/, why: "否定的断定の禁止" },
  { re: /synthetic|legacy_unknown|kansei_probe/, why: "provenance禁止語（Data Architecture §3）" },
  { re: /Claimed済|Claimedバッジ|claimed-badge/i, why: "ClaimedバッジはMichie手動承認後のみ（§4.0）" },
  { re: /(?<![Uu]n)[Vv]erified/, why: "「Verified」はEvidence Tier系表示に予約（rev2③）" },
  { re: /CHECKER-NOTE/, why: "内部QAデータの混入（HTMLコメントも公開データ — Codex P1）" },
  { re: /最終検証日/, why: "表記は「確認日: YYYY-MM-DD（ARI Award 2026 Summer調査時点）」形式に統一（Codex追加条件）" },
];

// ガードは「読者に見える本文テキスト」を対象とする。
// CSS（width:100%等）・JSON-LD・HTMLコメント（Checker向けメモ）・タグ属性（class名）は
// 表示事実ではないため除外する。ただし last_verified 併記文言は本文なので検査対象に残る。
function extractVisibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ");
}

function guardHtml(html, name) {
  const text = extractVisibleText(html);
  const violations = [];
  for (const { re, why } of FORBIDDEN_PATTERNS) {
    const m = text.match(re);
    if (m) violations.push(`${name}: 「${m[0]}」 — ${why}`);
  }
  // 構造チェック（生HTML全体 = コメント・meta属性・JSON-LD含む。全てが公開データ — Codex P1）
  if (html.includes("<!--")) {
    violations.push(`${name}: HTMLコメントを検出 — 公開HTMLにコメントは含めない（Codex P1）`);
  }
  for (const raw of ["CHECKER-NOTE", "最終検証日", "Connection Verified", "api_url", "seed_"]) {
    if (html.includes(raw)) {
      violations.push(`${name}: 生HTMLに「${raw}」を検出 — 公開面から排除すること`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

  // selection-100.jsonのrowsはスキーマ改定でキー名が変わり得る（name→service）。両対応。
  const rowName = (r) => r.name ?? r.service;

  let targets;
  if (all) {
    targets = selection.rows.map(rowName);
  } else {
    targets = selection.qa10;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(QA_DIR, { recursive: true });

  // 旧配置のmanifest（公開ディレクトリ内）が残っていれば除去する — profile-drafts/は公開HTMLのみ
  try {
    rmSync(path.join(OUT_DIR, "manifest.json"));
    console.log("旧 profile-drafts/manifest.json を削除（qa-internal/へ移設）");
  } catch {}

  const manifest = [];
  const allViolations = [];
  let written = 0;

  for (const svcName of targets) {
    const ari = ariRows.get(svcName);
    if (!ari) {
      console.error(`SKIP: "${svcName}" はARI Award CSVに見つかりません（正本にない事実は公開しない）`);
      continue;
    }
    // 選定リストとCSV正本の整合チェック
    const sel = selection.rows.find((r) => rowName(r) === svcName);
    if (sel && (sel.grade !== ari.grade || sel.category !== ari.category)) {
      console.error(`WARN: "${svcName}" selection-100.jsonとARI CSVが不一致 → CSV正本を採用`);
    }

    const slug = slugify(svcName);
    if (only && slug !== only) continue;

    // seed候補は内部QA記録（qa-internal）専用。公開HTML生成には渡さない（Codex P1）
    const seedMatch = seedIndex.get(normalizeName(svcName)) || null;
    const html = renderProfile(ari);

    const violations = guardHtml(html, svcName);
    if (violations.length) {
      allViolations.push(...violations);
      continue; // 違反ページは書かない
    }

    writeFileSync(path.join(OUT_DIR, `${slug}.html`), html, "utf8");
    written++;
    manifest.push({
      name: svcName,
      slug,
      file: `${slug}.html`,
      grade: ari.grade,
      category: ari.category,
      mcp: ari.mcp,
      auth: ari.auth === "—" ? null : ari.auth,
      ari_last_verified: ARI_LAST_VERIFIED,
      evidence_tier: "E0",
      seed_match: seedMatch
        ? { id: seedMatch.id, api_url_candidate: seedMatch.api_url || null, status: "unverified_not_rendered" }
        : null,
    });
  }

  if (allViolations.length) {
    console.error("公開原則ガード違反（該当ページは未生成）:");
    for (const v of allViolations) console.error("  - " + v);
    process.exitCode = 1;
  }

  writeFileSync(
    path.join(QA_DIR, "manifest.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString().slice(0, 10),
        generator: "scripts/generate-profiles.mjs",
        role: "Maker（公開判定はChecker: kl-integrity + Michie L3）",
        internal_only:
          "このファイルは内部QA用。未検証seed候補（api_url等）を含むため公開しない。profile-drafts/は公開してよいHTMLのみ",
        ari_edition: ARI_EDITION,
        ari_confirmed_at: ARI_LAST_VERIFIED,
        count: manifest.length,
        profiles: manifest,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`生成完了: ${written}ページ → ${path.relative(ROOT, OUT_DIR)}/（公開候補HTMLのみ）`);
  console.log(`内部QA記録: ${manifest.length}件 → ${path.relative(ROOT, QA_DIR)}/manifest.json（未検証seed候補はここのみ・HTMLへは非出力）`);
}

main();
