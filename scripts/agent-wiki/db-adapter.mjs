#!/usr/bin/env node
/**
 * Agent Wiki 本番アダプタ（turnkey下ごしらえ・非公開）— 実サービスDB → §1レコード
 *
 * DESIGN-AgentFindable §1 / CANON-Ecosystem の provenance階梯に忠実に、実servicesテーブルの行を
 * Agent Wikiの §1レコードへ写像する。build.mjs の buildAgentWiki() に渡せる形。
 *
 * ⚠️ 非公開の下ごしらえ。DBは**読み取り専用**で開く（書き込まない）。出力は out/（gitignore）。
 *    本番投入(Aフェーズ)では、この写像ロジックをサイトの generate-profiles.mjs 拡張へ移植する。
 *
 * provenance階梯（CANON）に沿う:
 *   - verdict / publisher_verified / curated → 検証済み（confirmed・grade-worthy）
 *   - registry_inferred（既定・namespace由来のprovenanceは grade側の正準ロジックが持つ）→ **unverified**（参考・発見性シグナル・等級非寄与）
 *   本アダプタは provenance を**消費**するのみ（namespace→provenance の導出は再実装しない＝正準は別Claudeのgrade pipeline）。
 *   検証済みかどうかは `verdicts`（{service_id: 'verdict'|'publisher_verified'|'curated'}）を注入して判定。無ければ全て unverified（保守側）。
 *
 * 実行: ./node_modules/.bin/tsx dogfood/agent-wiki/db-adapter.mjs [--limit N] [--only id1,id2]
 */
// 依存なしで動かす（このworktreeには node_modules が無い）。Node 22+ の node:sqlite。
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 既定はローカル研究DB（readonly）。本番prod DBはここに向けない（下ごしらえ検証用）。
const DEFAULT_DB = process.env.KANSEI_DB_PATH || path.join(HERE, "..", "..", "kansei-link.db");

const GRADE_WORTHY = new Set(["verdict", "publisher_verified", "curated"]);
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };

/** servicesの1行 → §1レコード。provenanceを消費して confirmed/unverified を振り分ける。 */
function rowToRecord(r, provenance) {
  const verified = GRADE_WORTHY.has(provenance);
  const confirmed = [];
  const unverified = [];
  // MCP: 検証済みなら confirmed、そうでなければ unverified（発見性シグナル・等級非寄与）
  if (r.mcp_endpoint) {
    const f = { field: "公開MCP", value: `${r.mcp_endpoint}（${r.mcp_status ?? "?"}）` };
    (verified ? confirmed : unverified).push(f);
  }
  // 接続・認証・APIはDB記録（registry/curated由来）。検証済みでなければ参考扱い。
  const dbFacts = [
    r.api_auth_method && { field: "認証方式", value: r.api_auth_method },
    r.api_url && { field: "API/開発者ドキュメント", value: r.api_url },
    r.category && { field: "カテゴリ", value: r.category },
  ].filter(Boolean);
  for (const f of dbFacts) (verified ? confirmed : unverified).push(f);
  return {
    service_id: r.id,
    display_name: r.name,
    category: r.category ?? "SaaS",
    official_domain: hostOf(r.api_url),
    confirmed,               // 検証済みのみ（provenance消費）
    vendor: [],              // 本番では profile-overrides（事業者拡充・審査済み）を合流
    unverified,              // registry_inferred等＝参考・発見性・等級非寄与
    unconfirmed: [],         // §1で未取得の項目（料金/SLA等）は本番で付与
    delegation_scope: null,  // 範囲マップは別データ源（55系）から本番で付与
    grade: r.axr_grade ? { value: r.axr_grade, scale: "AXR Runtime" } : null, // read-only 第三者評価
    last_verified: r.last_refreshed_at ?? null,
  };
}

/** DB（readonly）から §1レコード群を作る。verdicts注入で検証済み判定。 */
export function recordsFromDb(dbPath = DEFAULT_DB, { serviceIds, verdicts = {}, limit } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    let rows;
    if (serviceIds?.length) {
      const ph = serviceIds.map(() => "?").join(",");
      rows = db.prepare(`SELECT id,name,category,mcp_endpoint,mcp_status,api_url,api_auth_method,axr_grade,last_refreshed_at FROM services WHERE id IN (${ph})`).all(...serviceIds);
    } else {
      rows = db.prepare(`SELECT id,name,category,mcp_endpoint,mcp_status,api_url,api_auth_method,axr_grade,last_refreshed_at FROM services WHERE archived IS NOT 1 ORDER BY axr_grade LIMIT ?`).all(limit ?? 20);
    }
    return rows.map((r) => rowToRecord(r, verdicts[r.id] ?? "registry_inferred"));
  } finally {
    db.close();
  }
}

if (process.argv[1]?.endsWith("db-adapter.mjs")) {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 8;
  // 検証済みの実例（別Claudeのverdict台帳相当・下ごしらえの手投入サンプル）
  const verdicts = { freee: "verdict", moneyforward: "verdict" };
  const recs = recordsFromDb(DEFAULT_DB, only ? { serviceIds: only, verdicts } : { limit, verdicts });
  const build = await import(new URL("./build.mjs", import.meta.url).href);
  const n = build.buildAgentWiki(recs, path.join(HERE, "out-db"));
  console.log(`Agent Wiki 本番アダプタ試作: ${n}サービス（readonly DB→§1→生成）→ ${path.join(HERE, "out-db")}（非公開）`);
  console.log(`検証済み(verdict注入): freee/moneyforward → confirmed / 他 → unverified(参考)`);
}
