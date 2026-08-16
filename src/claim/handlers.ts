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
import { initClaimSchema, appendAudit, intakePaused, encryptDetail, verifiedAltDomains, CLAIM_DOMAIN_PROVENANCES, type ClaimReason } from "./store.js";
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
  const row = db.prepare("SELECT claim_domain, claim_domain_provenance, claim_domain_verified_at FROM services WHERE id = ?").get(serviceId) as
    | { claim_domain?: string | null; claim_domain_provenance?: string | null; claim_domain_verified_at?: string | null } | undefined;
  // 自動認証の条件（Codex追加条件）: claim_domain + allowlist内provenance + verified_at の3点が揃って初めて確定
  if (!row?.claim_domain || !row.claim_domain_provenance || !row.claim_domain_verified_at) return null;
  if (!(CLAIM_DOMAIN_PROVENANCES as readonly string[]).includes(row.claim_domain_provenance)) return null;
  return { domain: row.claim_domain, provenance: row.claim_domain_provenance };
}

// P0: Claim専用のメール所有確認コード送信（authのマジックリンク基盤とは独立・
// claim_idに束縛・一回限り・30分期限）。SendGrid未設定時はログにコードを出さず
// AUDIT行のみ（auth.tsと同じログ安全契約）。
const EMAIL_CODE_TTL_MIN = 30;
// 配送結果を必ず返す（Codex条件: 失敗の握りつぶし禁止——非202/no_key/timeoutで
// 「送信しました」と応答してはならない）。ログはauth.tsと同じ安全契約
// （コード・宛先を出さない・reasonタグのみ）。
type MailDelivery = "sent" | "no_key" | "send_failed" | "timeout" | "send_error";
async function sendClaimEmailCode(email: string, code: string, serviceName: string): Promise<MailDelivery> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error(`[claim][AUDIT] verification email not sent (reason=no_key) — code withheld from logs`);
    return "no_key";
  }
  const base = (process.env.SENDGRID_API_BASE || "https://api.sendgrid.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v3/mail/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: process.env.KANSEI_MAIL_FROM || "contact@synapse-arrows.com", name: "KanseiLink" },
        subject: `KanseiLink Claim確認コード（${serviceName}）`,
        content: [{ type: "text/plain", value:
          `Claim申請のメールアドレス確認コード: ${code}\n有効期限${EMAIL_CODE_TTL_MIN}分・1回限り有効です。このコードを申請画面に入力してください。\n心当たりがない場合はこのメールを無視してください。` }],
        tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 202) {
      console.error(`[claim][AUDIT] verification email not sent (reason=send_failed status=${res.status})`);
      return "send_failed";
    }
    return "sent";
  } catch (err) {
    const kind: MailDelivery = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "send_error";
    console.error(`[claim][AUDIT] verification email not sent (reason=${kind})`);
    return kind;
  }
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
  // 入力サイズ制限（Codex追加条件・rate limitはルート側apiLimiter）
  if (!service_id || service_id.length > 64 || !email || email.length > 254 ||
      (correction && String(correction).length > 4000) ||
      !["ownership", "fact_correction", "official_mcp"].includes(claim_type ?? "")) {
    res.status(400).json({ error: "service_id, claim_type, email required (size limits apply)" });
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

  // P0(1): 422確定（freemail/共有ホスティング）は**PIIを一切保存しない**（Codex追加
  // 条件: 拒否した申請者のメール保持に正当な目的がない）。claims行も作らず監査のみ。
  if (hardReject) {
    appendAudit(db, {
      claimId, serviceId: service_id, action: "claim_rejected_at_intake",
      actor: "system", reason: (applicantOnly as { reason: ClaimReason }).reason,
    });
    res.status(422).json({ error: "このメールドメインではClaimを受け付けられません（フリーメール・共有ホスティング不可）。公式ドメインのメールをご利用ください。" });
    return;
  }

  // P0(2): claim_domain（provenance allowlist + verified_at）が無ければ自動認証不可——必ずmanual_review。
  const verdict = anchor ? verifyDomain(emailDomain, anchor.domain) : null;
  const officialE1 = anchor ? etld1(normalizeDomain(anchor.domain) ?? "") : null;

  // Shared-domain guard（Codex条件B）: メール経路は**eTLD+1一致では昇格させない**。
  // 申請メールの実ドメインが claim_domain と完全一致（正規化後）するか、
  // 確認済み代替ドメイン（claim_alt_domains・provenance+verified_at必須）と
  // 完全一致する場合のみOTP経路へ。同一eTLD+1でも不一致（例: tenant.shop-pro.jp
  // vs shop-pro.jp）は manual_review——共有サブドメイン型ホスティングの
  // 第三者テナントなりすましを構造的に遮断する。TXT経路は従来どおりapex照合。
  const normEmailDomain = normalizeDomain(emailDomain);
  const exactMatch = anchor !== null && normEmailDomain !== null &&
    normEmailDomain === normalizeDomain(anchor.domain);
  const altMatch = anchor !== null && normEmailDomain !== null &&
    verifiedAltDomains(db, service_id).includes(normEmailDomain);

  // TXT用nonce（7日）+ メール所有確認コード（30分・claim_id束縛・一回限り）
  const nonce = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + NONCE_TTL_DAYS * 86400000).toISOString();
  const emailCode = randomBytes(16).toString("hex");
  const emailCodeExpires = new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60000).toISOString();

  // P0(3): メールドメインがアンカーと一致しても、メールボックスの**所有確認が済むまで
  // submittedのまま**。domain_verifiedへの遷移はメールOTP確認（verify-email）または
  // DNS TXT（verify-txt・独立経路）のみ。
  // submitted（OTP待ち）になれるのは完全一致/確認済みaltのみ。それ以外は
  // アンカー有無を問わずmanual_review（TXT経路はnonceを返すため温存される——
  // verify-txtはmanual_review状態からでもapex TXT証明で昇格可能）。
  const status = (exactMatch || altMatch) ? "submitted" : "manual_review";
  const domainMatches = anchor !== null && (exactMatch || altMatch); // OTP経路は完全一致のみ

  db.prepare(`
    INSERT INTO claims (claim_id, service_id, claim_type, status, applicant_etld1, nonce_hash, nonce_expires_at,
                        correction_payload, email_code_hash, email_code_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    claimId, service_id, claim_type, status,
    etld1(normalizeDomain(emailDomain) ?? "") ?? null,
    sha256(nonce), expires,
    // correction_payloadはPIIを含み得るため暗号化保存（鍵未設定なら平文を保存せずマーカーのみ）
    claim_type === "fact_correction" && correction
      ? (encryptDetail(String(correction).slice(0, 4000)) ?? "[unencrypted-storage-disabled]")
      : null,
    sha256(emailCode), emailCodeExpires,
  );
  db.prepare("INSERT INTO claim_pii (claim_id, email) VALUES (?, ?)").run(claimId, email.trim().toLowerCase());

  const reason: ClaimReason = !anchor ? "claim_domain_missing"
    : verdict!.verdict === "manual_review" ? "homograph_review"
    : (exactMatch || altMatch) ? "domain_match"
    : verdict!.verdict === "match" ? "email_domain_not_exact" // 同一eTLD+1・非完全一致
    : (verdict as { reason: ClaimReason }).reason;
  appendAudit(db, {
    claimId, serviceId: service_id, action: "claim_started",
    applicantEtld1: etld1(normalizeDomain(emailDomain) ?? ""),
    officialEtld1: officialE1,
    verificationMethod: anchor ? `email_domain(anchor=${anchor.provenance})` : "no_anchor",
    actor: "system", reason,
  });

  let delivery: MailDelivery | null = null;
  if (domainMatches) {
    const svcName = (db.prepare("SELECT name FROM services WHERE id=?").get(service_id) as { name?: string } | undefined)?.name ?? service_id;
    delivery = await sendClaimEmailCode(email.trim().toLowerCase(), emailCode, svcName);
  }

  res.json({
    claim_id: claimId,
    status,
    // 配送結果に正直な応答（Codex条件）: sent以外で「送信しました」と言わない
    ...(domainMatches ? (delivery === "sent" ? {
      email_verification: `確認コードを ${email} 宛に送信しました（有効期限${EMAIL_CODE_TTL_MIN}分・1回限り）。/api/claim/verify-email にclaim_idとコードを送信してください。`,
    } : {
      email_verification_error: "確認コードのメール送信に失敗しました。DNS TXT検証をご利用いただくか、時間をおいて再申請してください。",
    }) : {}),
    ...(anchor ? {
      txt_record: txtRecordValue(nonce),
      txt_instructions: `確認済み公式ドメイン（${anchor.domain}）のDNSに上記TXTレコードを設置し、/api/claim/verify-txt を呼んでください（有効期限${NONCE_TTL_DAYS}日・1回限り・メール確認とは独立の経路です）。`,
    } : {
      note_anchor: "このサービスは公式ドメインの独立確認が未了のため、運営による手動審査となります（5営業日以内に一次応答）。",
    }),
    note: "機械検証の通過後も、公開表示（Claimed）は運営の手動承認後に有効になります。",
  });
}

/**
 * POST /api/claim/verify-email  { claim_id, code }
 * P0: メールボックス所有確認。コードはclaim_idに束縛・ハッシュ照合・期限30分・
 * 一回限り（成功/失敗を問わず検証後は無効化しない——失敗は回数無制限にしない）。
 * 成功時、申請ドメインがアンカーと一致している場合のみ domain_verified へ。
 */
export function handleClaimVerifyEmail(req: Request, res: Response) {
  const db = getDb();
  initClaimSchema(db);
  const { claim_id, code } = (req.body ?? {}) as Record<string, string>;
  if (!claim_id || !code || code.length > 128) { res.status(400).json({ error: "claim_id and code required" }); return; }
  const claim = db.prepare("SELECT * FROM claims WHERE claim_id = ?").get(claim_id) as
    | { claim_id: string; service_id: string; status: string; applicant_etld1: string | null;
        email_code_hash: string | null; email_code_expires_at: string | null; email_verified_at: string | null } | undefined;
  if (!claim) { res.status(404).json({ error: "claim not found" }); return; }
  // Codex条件: 使用済み/未発行コードは**状態にかかわらず**非200で拒否する。
  // （旧実装はdomain_verified済みclaimへ先に200を返しており、コード再利用が
  //   200になる偽陽性経路だった——早期returnを廃止し、コード検証を先に行う）
  if (!claim.email_code_hash) {
    appendAudit(db, { claimId: claim.claim_id, serviceId: claim.service_id, action: "email_verify_attempt", actor: "system", reason: "email_code_invalid" });
    res.status(409).json({ error: "確認コードは使用済みまたは未発行です。ステータスの確認に再送信は不要です。" });
    return;
  }
  if (new Date(claim.email_code_expires_at ?? 0).getTime() < Date.now()) {
    db.prepare("UPDATE claims SET email_code_hash=NULL, updated_at=datetime('now') WHERE claim_id=?").run(claim.claim_id);
    appendAudit(db, { claimId: claim.claim_id, serviceId: claim.service_id, action: "email_verify_attempt", actor: "system", reason: "email_code_expired" });
    res.status(410).json({ error: "確認コードの期限が切れました。再申請してください。" });
    return;
  }
  if (sha256(code) !== claim.email_code_hash) {
    appendAudit(db, { claimId: claim.claim_id, serviceId: claim.service_id, action: "email_verify_attempt", actor: "system", reason: "email_code_invalid" });
    res.status(422).json({ error: "確認コードが正しくありません。" });
    return;
  }
  // 成功: コードを一回限りで無効化
  db.prepare("UPDATE claims SET email_code_hash=NULL, email_verified_at=datetime('now'), updated_at=datetime('now') WHERE claim_id=?").run(claim.claim_id);
  // 昇格判定はOTP消費時点で権威再計算（shared-domain guard: eTLD+1でなく
  // 完全一致——claim_piiの実メールドメイン vs claim_domain/確認済みalt）。
  // manual_review/mismatchはメール確認だけでは昇格しない。
  const anchor = claimDomainFor(claim.service_id);
  const anchorE1 = anchor ? etld1(normalizeDomain(anchor.domain) ?? "") : null;
  const piiEmail = (db.prepare("SELECT email FROM claim_pii WHERE claim_id=?").get(claim.claim_id) as { email?: string } | undefined)?.email ?? "";
  const emailDom = normalizeDomain(piiEmail.split("@")[1] ?? "");
  const exactNow = anchor !== null && emailDom !== null && emailDom === normalizeDomain(anchor.domain);
  const altNow = anchor !== null && emailDom !== null && verifiedAltDomains(db, claim.service_id).includes(emailDom);
  const promote = claim.status === "submitted" && (exactNow || altNow);
  if (promote) {
    db.prepare("UPDATE claims SET status='domain_verified', updated_at=datetime('now') WHERE claim_id=?").run(claim.claim_id);
  }
  appendAudit(db, {
    claimId: claim.claim_id, serviceId: claim.service_id,
    action: promote ? "email_verified_domain_verified" : "email_verified_no_promotion",
    applicantEtld1: claim.applicant_etld1, officialEtld1: anchorE1,
    verificationMethod: "email_otp", actor: "system", reason: "email_verified",
  });
  res.json({ status: promote ? "domain_verified" : claim.status,
    note: promote ? "公開表示（Claimed）は運営の手動承認後に有効になります。" : "メールアドレスの確認は完了しました（審査は継続中です）。" });
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
  if (process.env.KANSEI_TXT_TEST_RECORDS) {
    // テスト専用注入（STRIPE_API_BASEと同型・本番未設定）
    records = JSON.parse(process.env.KANSEI_TXT_TEST_RECORDS);
  } else {
    try {
      records = await dns.resolveTxt(normalizeDomain(official) ?? official);
    } catch {
      res.status(502).json({ error: "DNS lookup failed — 伝播をお待ちのうえ再試行してください" });
      return;
    }
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
