/**
 * ① 第2ソースをクローラの一部として常設化する。
 *
 * 手動スクリプトのままだと、事業者が申告しても誰かが実行するまで反映されない。
 * 日次で回る場所に置く。ただし**既定は無効**——申告の入口(Agent Wiki)がまだ
 * 本番に無い段階で自動書き込みを始めると、変化の出どころが分からなくなる。
 * ④ をゲートで止めているのと同じ理由。
 *
 * 有効化: VENDOR_SUBMISSIONS_DIR に申告(JSONL)の置き場を指定する。
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { verifyVendorSubmission, isSafeFetchTarget, type VendorSubmission } from "./vendor-submission.js";

export interface VendorIngestSummary {
  enabled: boolean;
  files: number;
  submissions: number;
  verified: number;
  needs_review: number;
  rejected: number;
  applied: string[];
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 512 * 1024;

async function fetchEvidence(url: string): Promise<string | null> {
  if (!isSafeFetchTarget(url).ok) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      // 別ホストへのリダイレクトを追うと、証明したドメインの外へ出てしまう
      redirect: "manual",
      headers: { "user-agent": "KanseiLinkVerifier/1.0 (+https://kansei-link.com)" },
    });
    return res.ok ? (await res.text()).slice(0, MAX_BYTES) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function ingestVendorSubmissions(
  db: Database.Database,
  opts: { dryRun?: boolean } = {}
): Promise<VendorIngestSummary> {
  const dir = process.env.VENDOR_SUBMISSIONS_DIR;
  const empty: VendorIngestSummary = {
    enabled: false, files: 0, submissions: 0, verified: 0, needs_review: 0, rejected: 0, applied: [],
  };
  if (!dir || !existsSync(dir)) return empty;

  const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const out: VendorIngestSummary = { ...empty, enabled: true, files: files.length };
  if (!files.length) return out;

  const getSvc = db.prepare("SELECT id, name, api_url FROM services WHERE id = ?");
  const update = db.prepare("UPDATE services SET mcp_status = ?, mcp_endpoint = ? WHERE id = ?");
  const trail: unknown[] = [];

  for (const f of files) {
    const lines = (await readFile(join(dir, f), "utf8")).split("\n").filter((l) => l.trim());
    for (const line of lines) {
      out.submissions++;
      let sub: VendorSubmission;
      try {
        sub = JSON.parse(line);
      } catch { out.rejected++; continue; }
      // 契約を満たさない申告は受け取らない。evidence_url が証明の本体
      if (!sub.service_id || !sub.mcp_endpoint || !sub.evidence_url) { out.rejected++; continue; }

      const svc = getSvc.get(sub.service_id) as { id: string; api_url: string | null } | undefined;
      if (!svc) { out.rejected++; continue; }

      const r = await verifyVendorSubmission(sub, svc.api_url, fetchEvidence);
      if (r.status === "publisher_verified") {
        out.verified++;
        out.applied.push(svc.id);
        trail.push({
          service_id: svc.id, verdict: "vendor_verified", proof: r.proof,
          evidence_url: sub.evidence_url, detail: r.detail,
          submitted_by: sub.submitted_by ?? null, checked_at: new Date().toISOString(),
        });
        if (!opts.dryRun) update.run("official", sub.mcp_endpoint, svc.id);
      } else if (r.status === "needs_review") out.needs_review++;
      else out.rejected++;
    }
  }

  // 根拠を残さずに配布データを書き換えない。格付け機関として、
  // 何をどの証拠で変えたかが後から辿れないと成立しない
  if (trail.length && !opts.dryRun) {
    await writeFile(
      join(dir, `accepted-${new Date().toISOString().slice(0, 10)}.json`),
      JSON.stringify(trail, null, 2) + "\n",
      "utf8"
    );
  }
  return out;
}
