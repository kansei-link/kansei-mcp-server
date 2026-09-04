#!/usr/bin/env tsx
/**
 * ④（raw推論を等級から外す）が入ると等級がどう動くかを、読み取り専用で測る。
 * 本番の再計算は日次クローラが行う。ここでは書き込まない。
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statusProvenance } from "../src/crawler/sources/publisher-match.js";

const root = resolve(import.meta.dirname, "..");
const DB = process.env.KANSEI_DB_PATH ?? resolve(root, "..", "kansei-link-mcp", "kansei-link.db");
const db = new DatabaseSync(DB, { readOnly: true });

let adjudicated = new Set<string>();
try {
  const led = JSON.parse(readFileSync(resolve(root, "data/runtime-freshness/verdicts.json"), "utf8"));
  adjudicated = new Set(Object.entries(led.verdicts as Record<string, { verdict: string }>)
    .filter(([, v]) => v.verdict === "seed_wrong").map(([id]) => id));
} catch { /* noop */ }

interface Row {
  id: string; namespace: string | null; mcp_status: string | null;
  api_url: string | null; api_auth_method: string | null; trust_score: number | null;
  axr_grade: string | null; success_rate: number; total_calls: number;
}
const rows = db.prepare(`
  SELECT s.id, s.namespace, s.mcp_status, s.api_url, s.api_auth_method, s.trust_score, s.axr_grade,
         COALESCE(ss.success_rate,0) success_rate, COALESCE(ss.total_calls,0) total_calls
  FROM services s LEFT JOIN service_stats ss ON ss.service_id = s.id
  WHERE COALESCE(s.archived,0)=0
`).all() as unknown as Row[];

function score(r: Row, credited: boolean): number {
  let v = 0;
  if (credited && r.mcp_status === "official") v += 0.5;
  else if (credited && r.mcp_status === "third_party") v += 0.4;
  else if (r.api_url) v += 0.3;
  else v += 0.1;
  if (r.api_url) v += 0.1;
  if (r.api_auth_method) v += 0.1;
  const ev = (r.total_calls ?? 0) >= 3;
  if (ev) v += 0.1;
  if (ev && (r.success_rate ?? 0) >= 0.8) v += 0.1;
  if ((r.trust_score ?? 0) >= 0.8) v += 0.1;
  return Math.min(1, Math.max(0, v));
}
function grade(v: number, ev: boolean): string {
  if (v >= 0.9 && ev) return "AAA";
  if (v >= 0.9) return "AA";
  if (v >= 0.8) return "AA";
  if (v >= 0.7) return "A";
  if (v >= 0.6) return "BBB";
  if (v >= 0.5) return "BB";
  if (v >= 0.4) return "B";
  if (v >= 0.3) return "C";
  return "D";
}

const before: Record<string, number> = {}, after: Record<string, number> = {};
const moves = new Map<string, number>();
let changed = 0;
for (const r of rows) {
  const ev = (r.total_calls ?? 0) >= 3;
  const b = grade(score(r, true), ev);
  const credited = statusProvenance(r, adjudicated) !== "registry_inferred";
  const a = grade(score(r, credited), ev);
  before[b] = (before[b] ?? 0) + 1;
  after[a] = (after[a] ?? 0) + 1;
  if (a !== b) { changed++; const k = `${b} -> ${a}`; moves.set(k, (moves.get(k) ?? 0) + 1); }
}
const ORDER = ["AAA", "AA", "A", "BBB", "BB", "B", "C", "D"];
const fmt = (o: Record<string, number>) => ORDER.filter((g) => o[g]).map((g) => `${g}:${o[g]}`).join("  ");
console.log(`対象 ${rows.length}件 / 人が確認済み ${adjudicated.size}件`);
console.log(`変更前: ${fmt(before)}`);
console.log(`変更後: ${fmt(after)}`);
console.log(`\n等級が動く: ${changed}件 (${Math.round(changed / rows.length * 100)}%)`);
for (const [k, v] of [...moves.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`\n上位帯(A以上) 変更前 ${ORDER.slice(0,3).reduce((n,g)=>n+(before[g]??0),0)} -> 変更後 ${ORDER.slice(0,3).reduce((n,g)=>n+(after[g]??0),0)}`);
