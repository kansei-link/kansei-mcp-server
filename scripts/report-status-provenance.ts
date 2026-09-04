#!/usr/bin/env tsx
/**
 * mcp_status がどの根拠で付いているかを集計する。
 *
 * ④（raw推論を等級の自動決定者から外す）を入れたとき、何がどれだけ動くかを
 * 事前に見えるようにするための計測。ここでは値を一切変更しない。
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statusProvenance, type StatusProvenance } from "../src/crawler/sources/publisher-match.js";

const root = resolve(import.meta.dirname, "..");
const DB = process.env.KANSEI_DB_PATH ?? resolve(root, "..", "kansei-link-mcp", "kansei-link.db");
const db = new DatabaseSync(DB, { readOnly: true });

let adjudicated = new Set<string>();
try {
  const led = JSON.parse(readFileSync(resolve(root, "data/runtime-freshness/verdicts.json"), "utf8"));
  adjudicated = new Set(
    Object.entries(led.verdicts as Record<string, { verdict: string }>)
      .filter(([, v]) => v.verdict === "seed_wrong")
      .map(([id]) => id)
  );
} catch { /* 台帳が無くても集計はできる */ }

const rows = db.prepare(
  "SELECT id, namespace, mcp_status, axr_grade FROM services WHERE COALESCE(archived,0)=0"
).all() as Array<{ id: string; namespace: string | null; mcp_status: string | null; axr_grade: string | null }>;

const table = new Map<string, number>();
const gradeCounts = new Map<string, Map<string, number>>();
for (const r of rows) {
  const p: StatusProvenance = statusProvenance(r, adjudicated);
  const key = `${r.mcp_status ?? "(null)"} / ${p}`;
  table.set(key, (table.get(key) ?? 0) + 1);
  if (r.mcp_status === "official" || r.mcp_status === "third_party") {
    if (!gradeCounts.has(p)) gradeCounts.set(p, new Map());
    const g = gradeCounts.get(p)!;
    g.set(r.axr_grade ?? "-", (g.get(r.axr_grade ?? "-") ?? 0) + 1);
  }
}

console.log(`対象 ${rows.length}件（アーカイブ除く）／ 人が判定済み ${adjudicated.size}件`);
console.log();
console.log("mcp_status × 出所:");
for (const [k, v] of [...table.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}
console.log();
console.log("④で等級への寄与を失う候補（official/third_party のうち registry_inferred）:");
const inf = gradeCounts.get("registry_inferred");
if (inf) {
  const total = [...inf.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${total}件 — 現グレード: ${[...inf.entries()].sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g}:${c}`).join("  ")}`);
} else console.log("  なし");
console.log();
console.log("④の後も等級に効き続けるもの:");
for (const p of ["verdict", "publisher_verified", "curated"] as const) {
  const m = gradeCounts.get(p);
  if (!m) { console.log(`  ${p}: 0件`); continue; }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${p}: ${total}件 — ${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g}:${c}`).join("  ")}`);
}
