#!/usr/bin/env node
/**
 * Agent Wiki 生成器（下ごしらえ試作・非公開）— CANON-Ecosystem-Architecture v1 / DESIGN-AgentFindable-ServiceRecords §1
 *
 * 目的: エージェントに見つかる per-service 構造化ページ（クロール可能な静的HTML＋インラインJSON-LD）と、
 *       親の「SaaS横断DB」ページ（Dataset+ItemList＝AIが『そんなDBは見当たらない』と言った空白に機械可読で名乗り出る）を生成する。
 *
 * ⚠️ これは**試作**。公開・被索引化・デプロイはしない（出力は out/ ＝gitignore・PROTOTYPEバナー付き）。
 *    本番投入は generate-profiles.mjs 拡張＋実サービスDBで、別Claudeのサイト構成・ARI/service_id正規化の完了後（Aフェーズ）。
 *
 * 設計原則（CANON準拠）:
 *   - 出所分離: independently_observed（信頼）と vendor_submitted（事業者提出・別ラベル）を混ぜない。
 *   - 等級は read-only の第三者評価として表示（"independently rated by KanseiLINK"）。自己主張の格付けにしない。
 *   - footprint未検証・未確認は「事実」としてJSON-LDに埋めない（煙は別レーン）。
 *   - データ源non依存: buildAgentWiki(records, outDir) は §1レコード配列を受け取る（本番は実DBを渡せる）。
 *
 * 実行: ./node_modules/.bin/tsx dogfood/agent-wiki/build.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.AGENT_WIKI_OUT || path.join(HERE, "out");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 試作の既定値。本番は buildAgentWiki(..., { site }) で差し替える
const SITE = "https://agent-wiki.example";

// ── §1レコード → JSON-LD（サービス） ─────────────────────────────
// independently_observed のみを SoftwareApplication の構造化プロパティに載せる。
// vendor_submitted は別ノード（disambiguatingDescriptionで非独立を明示）。等級は独立第三者評価ノード。
function jsonLdService(rec, SITE) {
  const additive = rec.confirmed.map((f) => ({
    "@type": "PropertyValue", name: f.field, value: f.value,
    description: `provenance: independently_observed${f.evidence?.file ? ` / source: ${f.evidence.file}` : ""}`,
  }));
  const node = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    identifier: rec.service_id,
    name: rec.display_name,
    applicationCategory: rec.category ?? "SaaS",
    url: `${SITE}/services/${rec.service_id}.html`,
    sameAs: rec.official_domain ? [`https://${rec.official_domain}`] : undefined,
    additionalProperty: additive,
    subjectOf: {
      "@type": "Dataset",
      name: "KanseiLINK Agent Wiki record",
      creator: { "@type": "Organization", name: "KanseiLINK" },
      isBasedOn: rec.confirmed.map((f) => f.evidence?.file).filter(Boolean),
    },
    // report経路（書く側）を機械可読に提示（potentialAction）。実呼び出しは本番で配線。
    potentialAction: {
      "@type": "Action", name: "report_outcome",
      description: "AIエージェントは統合の成否・詰まりをここに報告できる（検証は信頼のはしごに従う・等級は実測のみ）",
      target: `${SITE}/api/report?service=${rec.service_id}`,
    },
  };
  // 等級（独立第三者評価・read-only）— データにある場合のみ。自己主張の格付けにしない。
  if (rec.grade) {
    node.review = {
      "@type": "Review",
      author: { "@type": "Organization", name: "KanseiLINK (independent rating agency)" },
      reviewRating: { "@type": "Rating", ratingValue: rec.grade.value, ratingExplanation: `${rec.grade.scale}（independently rated by KanseiLINK・read-only）` },
    };
  }
  // vendor_submitted は別ノード（非独立を明示・独立プロパティに混ぜない）
  const vendorNode = rec.vendor.length ? {
    "@type": "Dataset", name: `${rec.display_name} — 事業者提出情報`,
    disambiguatingDescription: "vendor_submitted（事業者提出・運営審査済み）＝独立観測ではない。等級・順位には非連動。",
    creator: { "@type": "Organization", name: rec.display_name },
    variableMeasured: rec.vendor.map((f) => ({ "@type": "PropertyValue", name: f.field, value: f.value, description: "provenance: vendor_submitted" })),
  } : null;
  // 未検証（registry_inferred等）は別ノード。発見性シグナルであって等級非寄与・独立プロパティに混ぜない。
  const unverifiedNode = rec.unverified?.length ? {
    "@type": "Dataset", name: `${rec.display_name} — 未検証の参考情報`,
    disambiguatingDescription: "unverified（registry_inferred等）＝発見性シグナル。検証（公式ドメイン照合/verdict）で昇格するまで等級・順位に寄与しない。",
    variableMeasured: rec.unverified.map((f) => ({ "@type": "PropertyValue", name: f.field, value: f.value, description: "provenance: unverified (registry_inferred)" })),
  } : null;
  const nodes = [node, vendorNode, unverifiedNode].filter(Boolean);
  return nodes.length > 1 ? nodes : node;
}

// ── §1レコード → HTML（クロール可能・インラインJSON-LD・出所可視・内部リンク） ──
function htmlService(rec, SITE, prototype) {
  const ld = JSON.stringify(jsonLdService(rec, SITE), null, 2);
  const row = (f, prov) => `<tr><td>${esc(f.field)}</td><td>${esc(f.value)}</td><td><small>${prov}</small></td></tr>`;
  const scope = rec.delegation_scope?.length
    ? `<h2>AIに任せられる範囲（提供側から見えている状態）</h2><table><tr><th>項目</th><th>状態</th><th>証拠状態</th></tr>${rec.delegation_scope.map((it) => `<tr><td>${esc(it.item)}</td><td>${esc(it.provider_view)}</td><td>${esc(it.evidence_status)}</td></tr>`).join("")}</table>` : "";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(rec.display_name)}のAI統合ガイド（認証・MCP・レシピ）｜Agent Wiki</title>
<meta name="description" content="${esc(rec.display_name)}にAIエージェントを接続する実践情報（認証方式・公開MCP・レシピ・落とし穴）。出所と検証状態つき。">
<link rel="canonical" href="${SITE}/services/${rec.service_id}.html">
<script type="application/ld+json">${ld}</script>
</head><body>
${prototype ? `<!-- PROTOTYPE — not for publication -->
` : ""}${prototype ? `<p style="background:#fee;border:2px solid #c00;padding:6px">試作（PROTOTYPE）・非公開。本番投入はサイト構成・実データ確定後。</p>` : ""}
<p><a href="../index.html">← Agent Wiki（SaaS横断DB）</a></p>
<h1>${esc(rec.display_name)} — AI統合ガイド</h1>
${rec.grade ? `<p><strong>独立評価</strong>: ${esc(rec.grade.value)}（${esc(rec.grade.scale)}・<em>independently rated by KanseiLINK</em>・read-only）</p>` : `<p><small>独立評価: 未評価${prototype ? "（試作）" : ""}。等級は実測のみで算出＝この面の拡充では動かない。</small></p>`}
<h2>確認済みの実践情報（独立観測）</h2><table><tr><th>項目</th><th>内容</th><th>出所</th></tr>${rec.confirmed.map((f) => row(f, `独立観測${f.evidence?.file ? "・" + esc(f.evidence.file) : ""}`)).join("") || "<tr><td colspan=3>—</td></tr>"}</table>
${rec.vendor.length ? `<h2>事業者提出情報（運営審査済み・独立観測ではない／等級非連動）</h2><table><tr><th>項目</th><th>内容</th><th>出所</th></tr>${rec.vendor.map((f) => row(f, "事業者提出")).join("")}</table>` : ""}
${rec.unverified?.length ? `<h2>参考（未検証・発見性シグナル／検証で昇格・等級非連動）</h2><table><tr><th>項目</th><th>内容</th><th>出所</th></tr>${rec.unverified.map((f) => row(f, "未検証(registry_inferred)")).join("")}</table><p><small>公式ドメイン照合またはverdictで検証されるまで、参考情報として表示し等級・順位には寄与しません。事業者は自己申告（出所URL付き）で検証・昇格できます。</small></p>` : ""}
${rec.unconfirmed.length ? `<h2>公開資料で確認できない事項</h2><ul>${rec.unconfirmed.map((u) => `<li>${esc(u.field)} <small>（${esc(u.note)}）</small></li>`).join("")}</ul><p><small>空白は機能の不存在を意味しない。</small></p>` : ""}
${scope}
<hr><p><small>この記録はKanseiLINKの独立記録層（Agent Wiki）。事業者提出は別ラベル・等級は実測のみ・エージェントからの未検証報告は「事実」に混ぜない（CANON-Ecosystem-Architecture v1）。</small></p>
</body></html>`;
}

// ── 親インデックス（SaaS横断DB＝空きスロットに機械可読で名乗り出る） ──
function jsonLdIndex(recs, SITE) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "KanseiLINK Agent Wiki — 日本SaaSのAI統合・MCP有無・実践レシピ 横断DB",
    description: "AIコーディングエージェントが統合コードを書く前に参照できる、SaaS横断のAPI統合ガイド・公開MCP有無・実践レシピの構造化データベース（出所・検証状態つき）。",
    creator: { "@type": "Organization", name: "KanseiLINK", url: SITE },
    hasPart: recs.map((r) => ({ "@type": "SoftwareApplication", name: r.display_name, url: `${SITE}/services/${r.service_id}.html` })),
  }, null, 2);
}
function htmlIndex(recs, SITE, prototype) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>SaaS横断のAI統合・MCP有無・実践レシピDB｜Agent Wiki</title>
<meta name="description" content="AIエージェントが統合前に参照できる、SaaS横断のAPI統合ガイド・公開MCP有無・レシピの構造化DB。出所と検証状態つき。">
<link rel="canonical" href="${SITE}/index.html">
<script type="application/ld+json">${jsonLdIndex(recs, SITE)}</script>
</head><body>
${prototype ? `<!-- PROTOTYPE — not for publication --><p style="background:#fee;border:2px solid #c00;padding:6px">試作（PROTOTYPE）・非公開。</p>` : ""}
<h1>Agent Wiki — SaaS横断のAI統合・MCP有無・実践レシピDB</h1>
<p>AIエージェントが統合コードを書く前に参照できる、横断的な実践DB。各サービスの認証方式・公開MCP・レシピ・落とし穴を、出所と検証状態つきで提供します。</p>
<ul>${recs.map((r) => `<li><a href="services/${r.service_id}.html">${esc(r.display_name)}</a></li>`).join("")}</ul>
</body></html>`;
}
function sitemap(recs, SITE) {
  const urls = [`${SITE}/index.html`, ...recs.map((r) => `${SITE}/services/${r.service_id}.html`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`;
}

/** データ源non依存の本体。§1レコード配列→out/ に生成。 */
export function buildAgentWiki(records, outDir = OUT, opts = {}) {
  // 既定は試作のまま（dogfood側の挙動とテストを変えない）。
  // 本番は { site, prototype: false } を渡す
  const site = opts.site ?? SITE;
  const prototype = opts.prototype ?? true;
  mkdirSync(path.join(outDir, "services"), { recursive: true });
  for (const rec of records) writeFileSync(path.join(outDir, "services", `${rec.service_id}.html`), htmlService(rec, site, prototype));
  writeFileSync(path.join(outDir, "index.html"), htmlIndex(records, site, prototype));
  writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(records, site));
  return records.length;
}

/** dogfoodエンティティ（provenance整備済み）を §1レコードへ写像＝試作の入力。 */
export async function recordsFromDogfood() {
  const render = await import(new URL("../lib/render.mjs", import.meta.url).href);
  const { readFileSync } = await import("node:fs");
  const entities = JSON.parse(readFileSync(new URL("../fixtures/entities.json", import.meta.url), "utf8"));
  const domainOf = (id) => id === entities.org.entity_id ? entities.org.claim_domain_fixture
    : entities.services.find((s) => s.entity_id === id)?.claim_domain_fixture;
  const ids = [entities.org.entity_id, ...entities.services.map((s) => s.entity_id)];
  const recs = [];
  for (const id of ids) {
    const pd = render.profileData(id);
    if (!pd) continue;
    const map = render.loadScopeMap(id);
    recs.push({
      service_id: id, display_name: pd.entity.display_name,
      category: pd.entity.kind === "organization" ? "Organization" : "SaaS / MCP",
      official_domain: domainOf(id),
      confirmed: pd.confirmed, vendor: pd.vendor, unconfirmed: pd.unconfirmed,
      delegation_scope: map ? map.items.map((it) => ({ item: it.item, provider_view: it.viewB, evidence_status: it.status })) : null,
      grade: null, // 試作: 等級は実測のみ。dogfoodエンティティに実測グレードなし＝「未評価」。本番は独立実測から read-only で付与
    });
  }
  return recs;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build.mjs")) {
  const recs = await recordsFromDogfood();
  const n = buildAgentWiki(recs);
  console.log(`Agent Wiki 試作生成: ${n}サービス → ${OUT}（非公開・PROTOTYPE）`);
}
