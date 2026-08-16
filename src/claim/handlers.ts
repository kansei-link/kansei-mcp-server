/**
 * Claim MVP — HTTP handlers (PLAN-Profile-Claim-MVP v1 rev3 §4).
 *
 * Route wiring happens in http-server.ts ONLY on the growth-mvp-prep branch;
 * nothing here is publicly reachable until C1 GO + publication gates.
 *
 * Status semantics (implementation condition ②):
 *   domain_verified  = machine check passed (INTERNAL state, no public display)
 *   claimed_public   = Michie manually approved (the ONLY state that shows
 *                      "Claimed" or unlocks the badge)
 */

import type { Request, Response } from "express";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { getDb } from "../db/connection.js";
import { verifyDomain, etld1, normalizeDomain, txtRecordValue, NONCE_TTL_DAYS } from "./domain-verify.js";
import { initClaimSchema, appendAudit, intakePaused, type ClaimReason } from "./store.js";
import { promises as dns } from "node:dns";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * P0（Codex中間レビュー 8/16）: 自動認証のアンカーは、独立確認済みの
 * services.claim_domain（provenance必須）だけ。
 *
 * api_url / mcp_endpoint は GitHub・API Gateway・クラウドホスティング・
 * ドキュメント基盤・外部MCP提供者など第三者ドメインになり得る——そのドメインの
 * 管理者が**他社のサービスを自動認証できてしまう**（偽陰性ではなく誤認証）。
 * よって両者は所有権の判定に一切使わない（Profileの参考表示のみ）。
 *
 * claim_domain未確定のサービスへのClaimは、拒否ではなく必ず manual_review。
 */
function claimDomainFor(serviceId: string): { domain: string; provenance: string } | null {
  const db = getDb();
  const row = db.prepare("SELECT claim_domain, claim_domain_provenance FROM services WHERE id = ?").get(serviceId) as
    | { claim_domain?: string | null; claim_domain_provenance?: string | null } | undefined;
  if (!row?.claim_domain || !row.claim_domain_provenance) return null; // provenanceなしのclaim_domainは未確定扱い
  return { domain: row.claim_domain, provenance: row.claim_domain_provenance };
}

/** POST /api/claim/start  { service_id, claim_type, email, correction? } */
export async function handleClaimStart(req: Request, res: Response) {
  const db = getDb();
  initClaimSchema(db);
  if (intakePaused()) {
    // 実装条件③: 停止中も既存申請の処理は続く。新規のみ辞退（理由は明示・PIIは受け取らない）
    res.status(503).json({ error: "新規Claim受付は一時停止中です。再開までお待ちください。" });
    return;
  }
  const { service_id, claim_type, email, correction } = (req.body ?? {}) as Record<string, string>;
  if (!service_id || !email || !["ownership", "fact_correction", "official_mcp"].includes(claim_type ?? "")) {
    res.status(400).json({ error: "service_id, claim_type, email required" });
    return;
  }
  const anchor = claimDomainFor(service_id);
  const emailDomain = (email.split("@")[1] ?? "").trim();
  const claimId = randomUUID();

  // freemail / 共有ホスティングは、アンカーの有無に関係なく組織所有を証明できない
  // （applicant側だけで判定可能な絶対拒否）。
  const applicantOnly = verifyDomain(emailDomain, emailDomain);
  const hardReject = applicantOnly.verdict === "reject" &&
    (applicantOnly.reason === "freemail_rejected" || applicantOnly.reason === "psl_rejected");

  // P0: claim_domain（provenance付き）が無ければ自動認証は不可能——必ずmanual_review。
  const verdict = anchor && !hardReject ? verifyDomain(emailDomain, anchor.domain) : null;
  const officialE1 = anchor ? etld1(normalizeDomain(anchor.domain) ?? "") : null;

  // nonce（TXT検証用・7日期限・ハッシュのみ保存）。アンカー未確定時はTXT経路も
  // 提示しない（検証先ドメイン自体が未確定なため）。
  const nonce = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + NONCE_TTL_DAYS * 86400000).toISOString();

  const status = hardReject ? "rejected"
    : !anchor ? "manual_review"
    : verdict!.verdict === "match" ? "domain_verified"
    : verdict!.verdict === "manual_review" ? "manual_review"
    : "submitted"; // mismatch: TXT経路が残る

  db.prepare(`
    INSERT INTO claims (claim_id, service_id, claim_type, status, applicant_etld1, nonce_hash, nonce_expires_at, correction_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    claimId, service_id, claim_type, status,
    hardReject ? null : etld1(normalizeDomain(emailDomain) ?? "") ?? null,
    sha256(nonce), expires,
    claim_type === "fact_correction" ? String(correction ?? "").slice(0, 4000) : null,
  );
  db.prepare("INSERT INTO claim_pii (claim_id, email) VALUES (?, ?)").run(claimId, email.trim().toLowerCase());

  const reason: ClaimReason = hardReject ? (applicantOnly as { reason: ClaimReason }).reason
    : !anchor ? "claim_domain_missing"
    : verdict!.verdict === "match" ? "domain_match"
    : verdict!.verdict === "manual_review" ? "homograph_review"
    : (verdict as { reason: ClaimReason }).reason;
  appendAudit(db, {
    claimId, serviceId: service_id, action: "claim_started",
    applicantEtld1: hardReject ? null : etld1(normalizeDomain(emailDomain) ?? ""),
    officialEtld1: officialE1,
    verificationMethod: anchor ? `email_domain(anchor=${anchor.provenance})` : "no_anchor",
    actor: "system", reason,
  });

  if (hardReject) {
    res.status(422).json({ error: "このメールドメインではClaimを受け付けられません（フリーメール・共有ホスティング不可）。公式ドメインのメールをご利用ください。" });
    return;
  }
  res.json({
    claim_id: claimId,
    status,
    ...(anchor ? {
      txt_record: txtRecordValue(nonce),
      txt_instructions: `確認済み公式ドメイン（${anchor.domain}）のDNSに上記TXTレコードを設置し、/api/claim/verify-txt を呼んでください（有効期限${NONCE_TTL_DAYS}日・1回限り）。`,
    } : {
      note_anchor: "このサービスは公式ドメインの独立確認が未了のため、運営による手動審査となります（5営業日以内に一次応答）。",
    }),
    note: "機械検証の通過後も、公開表示（Claimed）は運営の手動承認後に有効になります。",
  });
}

/** POST /api/claim/verify-txt  { claim_id } — DNS TXT照合 */
export async function handleClaimVerifyTxt(req: Request, res: Response) {
  const db = getDb();
  initClaimSchema(db);
  const { claim_id } = (req.body ?? {}) as Record<string, string>;
  const claim = db.prepare("SELECT * FROM claims WHERE claim_id = ?").get(claim_id ?? "") as
    | { claim_id: string; service_id: string; status: string; nonce_hash: string; nonce_expires_at: string } | undefined;
  if (!claim) { res.status(404).json({ error: "claim not found" }); return; }
  if (claim.status === "claimed_public" || claim.status === "domain_verified") {
    res.json({ status: claim.status }); return;
  }
  if (new Date(claim.nonce_expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE claims SET status='expired', updated_at=datetime('now') WHERE claim_id=?").run(claim.claim_id);
    appendAudit(db, { claimId: claim.claim_id, serviceId: claim.service_id, action: "txt_verify_attempt", actor: "system", reason: "expired_nonce" });
    res.status(410).json({ error: "nonce expired — 再申請してください" });
    return;
  }
  // P0: TXT検証も、独立確認済みclaim_domainに対してのみ実施（api_url等は使わない）
  const anchor = claimDomainFor(claim.service_id);
  if (!anchor) { res.status(422).json({ error: "このサービスは公式ドメインの独立確認が未了のため、TXT検証は利用できません（手動審査へ）" }); return; }
  const official = anchor.domain;
  let records: string[][] = [];
  try {
    records = await dns.resolveTxt(normalizeDomain(official) ?? official);
  } catch {
    res.status(502).json({ error: "DNS lookup failed — 伝播をお待ちのうえ再試行してください" });
    return;
  }
  const flat = records.map((r) => r.join(""));
  const hit = flat.find((v) => v.startsWith("kansei-link-verify=") &&
    sha256(v.slice("kansei-link-verify=".length)) === claim.nonce_hash);
  const officialE1 = etld1(normalizeDomain(official) ?? "");
  if (!hit) {
    appendAudit(db, { claimId: claim.claim_id, serviceId: claim.service_id, action: "txt_verify_attempt", actor: "system", reason: "mismatch" });
    res.status(422).json({ error: "TXTレコードが確認できませんでした" });
    return;
  }
  db.prepare("UPDATE claims SET status='domain_verified', applicant_etld1=?, updated_at=datetime('now') WHERE claim_id=?")
    .run(officialE1, claim.claim_id);
  appendAudit(db, { claimId: claim.claim_id, serviceId: claim.service_id, action: "txt_verified",
    applicantEtld1: officialE1, officialEtld1: officialE1, verificationMethod: "dns_txt", actor: "system", reason: "txt_verified" });
  res.json({ status: "domain_verified", note: "公開表示（Claimed）は運営の手動承認後に有効になります。" });
}

/**
 * POST /admin/claim/approve  { claim_id, approve: bool, reason?, detail? }
 * 実装条件②: claimed_publicへの遷移はここ（Michie手動・admin鍵ゲート）のみ。
 */
export function handleClaimAdminApprove(req: Request, res: Response) {
  const adminKey = process.env.KANSEI_ADMIN_KEY;
  if (!adminKey || req.header("x-admin-key") !== adminKey) { res.status(404).end(); return; }
  const db = getDb();
  initClaimSchema(db);
  const { claim_id, approve, reason, detail } = (req.body ?? {}) as { claim_id?: string; approve?: boolean; reason?: ClaimReason; detail?: string };
  const claim = db.prepare("SELECT * FROM claims WHERE claim_id = ?").get(claim_id ?? "") as
    | { claim_id: string; service_id: string; status: string; applicant_etld1: string | null } | undefined;
  if (!claim) { res.status(404).json({ error: "claim not found" }); return; }
  if (approve && claim.status !== "domain_verified") {
    res.status(409).json({ error: `cannot approve from status=${claim.status} (domain_verified required)` });
    return;
  }
  const next = approve ? "claimed_public" : "rejected";
  db.prepare("UPDATE claims SET status=?, updated_at=datetime('now') WHERE claim_id=?").run(next, claim.claim_id);
  appendAudit(db, {
    claimId: claim.claim_id, serviceId: claim.service_id,
    action: approve ? "claim_approved_public" : "claim_rejected",
    applicantEtld1: claim.applicant_etld1, officialEtld1: claim.applicant_etld1,
    actor: "michie",
    reason: reason ?? (approve ? "fact_confirmed" : "fact_rejected_no_evidence"),
    detail,
  });
  res.json({ status: next });
}
