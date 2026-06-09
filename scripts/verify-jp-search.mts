// Clean-room JP search-precision regression test.
//
// Builds a FRESH in-memory DB from the seed source-of-truth (no post-seed
// enrich-jp-tags.mjs patch applied) and asserts that the five services that
// previously suffered "search_miss" on native Japanese queries surface within
// the top-N. This reproduces the exact regression scenario (a clean reseed)
// and guards against it recurring.
//
// Run: npx tsx scripts/verify-jp-search.mts
import Database from "better-sqlite3";
import { initializeDb } from "../src/db/schema.js";
import { seedDatabase } from "../src/db/seed.js";
import { searchServices } from "../src/tools/search-services.js";

interface Target {
  id: string;
  queries: string[];
}

// Two natural JP phrasings per service: a "core" term and an alternate phrasing
// an agent might realistically use. Both must surface the service.
const TARGETS: Target[] = [
  { id: "cloudsign", queries: ["電子契約 契約書の締結", "電子署名サービス 押印"] },
  { id: "zendesk", queries: ["問い合わせ管理 カスタマーサポート", "ヘルプデスク FAQ 導入"] },
  { id: "smaregi", queries: ["POSレジ 店舗管理", "レジ 在庫管理 小売"] },
  { id: "kintone", queries: ["業務アプリ 社内システム構築", "ノーコード アプリ開発 ワークフロー"] },
  { id: "salesforce-jp", queries: ["顧客管理 営業支援 CRM", "営業管理 パイプライン SFA"] },
];

const LIMIT = 8;

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
initializeDb(db);
seedDatabase(db);

let pass = 0;
let fail = 0;
const misses: string[] = [];

for (const t of TARGETS) {
  for (const q of t.queries) {
    const results = searchServices(db, q, undefined, LIMIT) as Array<{
      service_id: string;
    }>;
    const rank = results.findIndex((r) => r.service_id === t.id);
    const ok = rank >= 0;
    if (ok) pass++;
    else {
      fail++;
      misses.push(`${t.id} ⟵ "${q}"`);
    }
    const top = results.map((r) => r.service_id).join(", ");
    console.log(
      `${ok ? "✅" : "❌"} [${t.id}] "${q}" → ${ok ? `rank ${rank + 1}` : "MISS"}\n      top${LIMIT}: ${top}`
    );
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
if (misses.length) {
  console.log("Misses:\n  " + misses.join("\n  "));
}
db.close();
process.exit(fail > 0 ? 1 : 0);
