// Seed tag-MERGE regression test.
//
// Guards the systemic fix that replaced the manual scripts/enrich-jp-tags.mjs
// migration: seedDatabase() now UNIONs seed tags onto each row's existing tags
// instead of skipping `tags` in ON CONFLICT. The contract this verifies:
//
//   1. PROPAGATION  — seed tag additions reach EXISTING rows on reseed
//                     (the original regression: they never used to).
//   2. PRESERVATION — post-seed enriched tags survive reseed
//                     ("seed = FLOOR, not ceiling").
//   3. CANONICAL    — output is CSV; the legacy JSON-array shape is retired.
//   4. IDEMPOTENT   — repeated reseeds don't duplicate or grow tags.
//
// Run: npx tsx scripts/verify-seed-tag-merge.mts
import Database from "better-sqlite3";
import { initializeDb } from "../src/db/schema.js";
import { seedDatabase } from "../src/db/seed.js";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
initializeDb(db);

const getTags = (id: string): string =>
  (db.prepare("SELECT tags FROM services WHERE id = ?").get(id) as { tags: string } | undefined)
    ?.tags ?? "";
const tagSet = (id: string): Set<string> =>
  new Set(getTags(id).toLowerCase().split(",").map((t) => t.trim()).filter(Boolean));

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? `\n      ${detail}` : ""}`);
};

// ── Boot 1: initial seed ───────────────────────────────────────────────────
seedDatabase(db);
const smaregiAfterSeed = getTags("smaregi");
check(
  "boot1: smaregi seed tags landed (JP + canonical CSV)",
  tagSet("smaregi").has("在庫管理") && tagSet("smaregi").has("posレジ") && !smaregiAfterSeed.includes("["),
  smaregiAfterSeed
);

// ── Simulate post-seed community enrichment ────────────────────────────────
// (a) a brand-new enriched tag on smaregi, and
// (b) a row deliberately left in the legacy JSON-array shape to prove the
//     merge tolerates mixed input formats coming from a real persistent DB.
const ENRICHED = "community_enriched_zzz";
db.prepare("UPDATE services SET tags = tags || ? WHERE id = ?").run(`,${ENRICHED}`, "smaregi");
db.prepare("UPDATE services SET tags = ? WHERE id = ?").run(
  '["crm","legacy_json_tag"]',
  "salesforce-jp"
);

// ── Boot 2: reseed onto the now-"enriched" DB (exercises ON CONFLICT merge) ──
seedDatabase(db);

check(
  "boot2: PRESERVATION — enriched tag survived reseed",
  tagSet("smaregi").has(ENRICHED),
  getTags("smaregi")
);
check(
  "boot2: PROPAGATION — seed JP tags still present after reseed",
  tagSet("smaregi").has("在庫管理") && tagSet("smaregi").has("店舗管理")
);
check(
  "boot2: PRESERVATION+PROPAGATION on JSON-array row (salesforce-jp)",
  tagSet("salesforce-jp").has("legacy_json_tag") && // enriched survived
    tagSet("salesforce-jp").has("crm") &&
    tagSet("salesforce-jp").has("顧客管理"), // seed JP tag propagated
  getTags("salesforce-jp")
);
check(
  "boot2: CANONICAL — no legacy JSON-array bracket remains",
  !getTags("smaregi").includes("[") && !getTags("salesforce-jp").includes("[")
);
check(
  "boot2: no case-insensitive duplicate tags (smaregi)",
  (() => {
    const raw = getTags("smaregi").toLowerCase().split(",").map((t) => t.trim()).filter(Boolean);
    return raw.length === new Set(raw).size;
  })(),
  getTags("smaregi")
);

// ── Boot 3: reseed again — must be byte-identical (idempotent, no growth) ────
const smaregiBeforeBoot3 = getTags("smaregi");
const sfBeforeBoot3 = getTags("salesforce-jp");
seedDatabase(db);
check(
  "boot3: IDEMPOTENT — smaregi tags unchanged on repeat reseed",
  getTags("smaregi") === smaregiBeforeBoot3,
  `before=${smaregiBeforeBoot3}\n      after =${getTags("smaregi")}`
);
check(
  "boot3: IDEMPOTENT — salesforce-jp tags unchanged on repeat reseed",
  getTags("salesforce-jp") === sfBeforeBoot3
);

console.log(`\n${pass} pass, ${fail} fail`);
db.close();
process.exit(fail > 0 ? 1 : 0);
