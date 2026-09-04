#!/usr/bin/env tsx
/**
 * ① 第2ソースの受け口 — 事業者の自己申告(JSONL)を検証して台帳へ合流させる。
 *
 * Agent Wiki 側の出力形式は `founder-ops/SEAM-AgentWiki-VerificationGate_2026-09-04.md`
 * の `VendorSubmission` が契約。形さえ合っていれば入口はファイルでもAPIでもよい。
 *
 * ここは「判定して台帳に書く」までで、配布データ(services-seed.json)への反映は
 * 既存の apply-freshness-verdicts.mjs が行う。決めるのと出すのを分けておく。
 *
 *   <tsx> scripts/ingest-vendor-submissions.ts <file.jsonl> [--dry-run]
 *
 * --dry-run はネットワークに出ない。判定は「取得できなかった」扱いになるので、
 * 形の検証と経路Aの確認にだけ使う。
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  verifyVendorSubmission, isSafeFetchTarget, type VendorSubmission,
} from "../src/crawler/sources/vendor-submission.js";

const root = resolve(import.meta.dirname, "..");
const DB = process.env.KANSEI_DB_PATH ?? resolve(root, "..", "kansei-link-mcp", "kansei-link.db");
const LEDGER = resolve(root, "data/runtime-freshness/verdicts.json");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const INPUT = args.find((a) => !a.startsWith("--"));
if (!INPUT) { console.error("使い方: ingest-vendor-submissions.ts <file.jsonl> [--dry-run]"); process.exit(1); }

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 512 * 1024; // 証明の確認に本文全部は要らない。無制限に読まない

/** evidence_url を取りに行く。安全性は呼ぶ前に検証済みだが、ここでも念のため見る。 */
async function fetchEvidence(url: string): Promise<string | null> {
  if (DRY) return null;
  const safe = isSafeFetchTarget(url);
  if (!safe.ok) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      // 別ホストへのリダイレクトを追うと、証明したドメインの外へ出てしまう
      redirect: "manual",
      headers: { "user-agent": "KanseiLinkVerifier/1.0 (+https://kansei-link.com)" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, MAX_BYTES);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 申告の形を検証する。契約を満たさないものは受け取らない。 */
function parseSubmission(line: string, n: number): VendorSubmission | string {
  let o: Record<string, unknown>;
  try { o = JSON.parse(line); } catch { return `${n}行目: JSONとして読めない`; }
  for (const k of ["service_id", "mcp_endpoint", "evidence_url"]) {
    if (typeof o[k] !== "string" || !(o[k] as string).trim()) {
      // evidence_url が欠けた申告は検証しようがない。契約で必須にしてある
      return `${n}行目: ${k} が無い（契約では必須）`;
    }
  }
  return o as unknown as VendorSubmission;
}

const db = new DatabaseSync(DB, { readOnly: true });
const lines = (await readFile(resolve(root, INPUT), "utf8")).split("\n").filter((l) => l.trim());

const ledger = existsSync(LEDGER)
  ? JSON.parse(await readFile(LEDGER, "utf8"))
  : { note: "", verdicts: {} as Record<string, unknown> };

let verified = 0, review = 0, rejected = 0, malformed = 0;
console.log(`${lines.length}件の申告を検証${DRY ? "（--dry-run: ネットワークに出ない）" : ""}\n`);

for (const [i, line] of lines.entries()) {
  const parsed = parseSubmission(line, i + 1);
  if (typeof parsed === "string") { console.log(`  却下  ${parsed}`); malformed++; continue; }

  const svc = db.prepare("SELECT id, name, api_url FROM services WHERE id = ?").get(parsed.service_id) as
    { id: string; name: string; api_url: string | null } | undefined;
  if (!svc) {
    // 存在しないサービスへの申告は受け取らない。新規サービスの登録とは別の経路
    console.log(`  却下  ${parsed.service_id}: そのサービスidは存在しない`);
    rejected++; continue;
  }

  const r = await verifyVendorSubmission(parsed, svc.api_url, fetchEvidence);
  const label = r.status === "publisher_verified" ? "受理" : r.status === "needs_review" ? "要確認" : "却下";
  console.log(`  ${label}  ${svc.id} (${svc.name})\n          ${r.detail}`);

  if (r.status === "publisher_verified") {
    // 人が一次資料で確認した判定を、自動判定が黙って置き換えてはいけない。
    // 確認済みの事実が失われるほうが、申告を1件取りこぼすより悪い
    const existing = ledger.verdicts[svc.id] as { verdict?: string } | undefined;
    if (existing && existing.verdict !== "vendor_verified") {
      console.log(`          → 台帳に人の判定(${existing.verdict})が既にあるため上書きしない`);
      review++;
      continue;
    }
    verified++;
    ledger.verdicts[svc.id] = {
      verdict: "vendor_verified",
      checked_at: new Date().toISOString().slice(0, 10),
      evidence_url: parsed.evidence_url,
      finding: `事業者の自己申告を検証ゲートが承認（経路: ${r.proof}）。${r.detail}`,
      submitted_by: parsed.submitted_by ?? null,
      correction: { mcp_status: "official", mcp_endpoint: parsed.mcp_endpoint },
    };
  } else if (r.status === "needs_review") review++;
  else rejected++;
}

console.log(`\n受理 ${verified} ／ 要確認 ${review} ／ 却下 ${rejected + malformed}`);
if (verified && !DRY) {
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  console.log(`台帳を更新: ${LEDGER}`);
  console.log("配布データへの反映は apply-freshness-verdicts.mjs（決めるのと出すのは分けてある）");
}
