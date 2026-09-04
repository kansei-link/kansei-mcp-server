#!/usr/bin/env tsx
/**
 * 公式MCPを取りこぼしている curated サービスの「候補」を出す。**自動では適用しない。**
 *
 * RCA ② の対策として、結合キーを派生idからドメイン一致へ変える設計を検討したが、
 * ドライランで欠陥が出た: **ドメイン一致は「同じ会社」までしか言えない。**
 * 1社が複数製品を持つため、そのまま endpoint を付けると
 *   freee会計のMCP → freeeサイン
 *   Backlogのサーバー → Typetalk
 *   Microsoftのテストサーバー → Azure / LinkedIn
 * のような取り違えが起きる。弥生←Misoca と同型の誤りを、今度は自動で量産することになる。
 *
 * よって候補出しまでを機械にやらせ、採否は一次資料を根拠に人が決める。
 * 判定は data/runtime-freshness/verdicts.json に evidence_url つきで記録し、
 * apply-freshness-verdicts.mjs が配布値へ反映する（既存の規律に合流させる）。
 *
 *   <tsx> scripts/mcp-enrichment-candidates.ts
 */
// このworktreeには node_modules が無いので、依存なしの node:sqlite を使う
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { registrableDomain, publisherDomains, namespaceToDomain } from "../src/crawler/sources/publisher-match.js";

const DB = process.env.KANSEI_DB_PATH ?? resolve(import.meta.dirname, "..", "..", "kansei-link-mcp", "kansei-link.db");
const db = new DatabaseSync(DB, { readOnly: true });
const OUT_DIR = resolve(import.meta.dirname, "..", "data", "runtime-freshness");
mkdirSync(OUT_DIR, { recursive: true });
const OUT = resolve(OUT_DIR, "mcp-enrichment-candidates.json");
const candidates: Array<Record<string, unknown>> = [];

// レジストリ由来の行（namespace を持つもの）を「発行元候補」として使う
const registryRows = db.prepare(`
  SELECT id, name, namespace, api_url, mcp_endpoint, mcp_status
  FROM services WHERE namespace IS NOT NULL AND namespace <> ''
`).all() as Array<{ id: string; name: string; namespace: string; api_url: string | null; mcp_endpoint: string | null; mcp_status: string | null }>;

// curated 行（namespace 無し）= 手作業で登録したサービス
const curated = db.prepare(`
  SELECT id, name, api_url, mcp_endpoint, mcp_status
  FROM services WHERE (namespace IS NULL OR namespace = '') AND api_url <> ''
`).all() as Array<{ id: string; name: string; api_url: string | null; mcp_endpoint: string | null; mcp_status: string | null }>;

console.log(`レジストリ由来 ${registryRows.length}件 / curated ${curated.length}件`);

// 発行元ドメイン -> レジストリ行
const byDomain = new Map<string, typeof registryRows>();
let withDomain = 0;
for (const r of registryRows) {
  const doms = publisherDomains({ name: r.namespace, website_url: r.api_url, repo_url: null });
  if (doms.length) withDomain++;
  for (const d of doms) {
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(r);
  }
}
console.log(`  発行元ドメインを判定できたレジストリ行: ${withDomain} (${Math.round(withDomain / registryRows.length * 100)}%)`);
console.log(`  ユニークな発行元ドメイン: ${byDomain.size}`);

let matched = 0, unambiguous = 0, ambiguous = 0;
const ok: string[] = [], warn: string[] = [];

// 同じ発行元ドメインを共有する curated 製品の数。2以上なら「どの製品のサーバーか」は
// ドメインだけでは決まらない（freee会計 と freeeサイン、Azure と LinkedIn など）
const productsPerDomain = new Map<string, number>();
for (const c of curated) {
  const d = registrableDomain(c.api_url);
  if (d) productsPerDomain.set(d, (productsPerDomain.get(d) ?? 0) + 1);
}

for (const c of curated) {
  const d = registrableDomain(c.api_url);
  if (!d) continue;
  const hits = byDomain.get(d);
  if (!hits?.length) continue;
  matched++;
  const withEp = hits.find((h) => h.mcp_endpoint);
  if (!withEp || c.mcp_endpoint) continue;

  const siblings = productsPerDomain.get(d) ?? 1;
  const many = siblings > 1 || hits.length > 1;
  const line = `  ${c.id.padEnd(20)} <- ${withEp.id.padEnd(38)} (製品${siblings} / サーバー${hits.length})`;
  if (many) { ambiguous++; if (warn.length < 12) warn.push(line); }
  else { unambiguous++; if (ok.length < 15) ok.push(line); }
  candidates.push({
    service_id: c.id, service_name: c.name, publisher_domain: d,
    candidate_server: withEp.id, candidate_endpoint: withEp.mcp_endpoint,
    candidate_mcp_status: withEp.mcp_status,
    // 同一ドメインに複数の製品/サーバーがあると、どれが対応するかはドメインでは決まらない
    ambiguous: many, curated_products_on_domain: siblings, servers_on_domain: hits.length,
    verdict: null, evidence_url: null,
  });
}

console.log();
console.log(`同一発行元のレジストリ行が見つかる curated: ${matched}`);
console.log();
console.log(`【自動で付けてよい】発行元に curated 製品もサーバーも1つずつ: ${unambiguous}`);
for (const l of ok) console.log(l);
console.log();
console.log(`【人の確認が要る】発行元が複数の製品/サーバーを持つ: ${ambiguous}`);
for (const l of warn) console.log(l);
console.log();
console.log("※ ドメイン一致は『同じ会社』までしか言えない。製品の対応づけには別の根拠が要る");
console.log("※ この一覧は候補。採否は一次資料で確認し verdicts.json に記録すること");

writeFileSync(OUT, JSON.stringify({
  generated_at: new Date().toISOString().slice(0, 10),
  note: "ドメイン一致で見つけた enrich 候補。**自動適用しないこと**——同一ドメインは同一会社であって同一製品ではない（freee会計/freeeサイン、Backlog/Typetalk など）。採否は一次資料で確認し verdicts.json へ。",
  needs_review: candidates,
}, null, 2) + "\n", "utf8");
console.log(`\nWrote ${OUT}（候補 ${candidates.length}件）`);
