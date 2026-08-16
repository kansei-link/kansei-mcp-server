/**
 * Claim MVP — storage layer (PLAN-Profile-Claim-MVP v1 rev3 §4).
 *
 * Three stores, deliberately separated (rev3② PII minimization):
 *   - claims:          current state machine per claim
 *   - claim_audit_log: append-only, PII-MINIMIZED decision trail
 *                      (corporate domains in the clear; personal-ish domains
 *                      as HMAC; reason is an enum; free text only in the
 *                      separate encrypted_detail column — condition ④)
 *   - claim_pii:       applicant contact data, joined by claim_id, with its
 *                      own retention schedule (FUNNEL-METRICS §5)
 *
 * Status machine (condition ②: machine verification alone never shows
 * a public badge):
 *   submitted → domain_verified → claimed_public   (Michie manual approval)
 *                └→ manual_review → domain_verified | rejected
 *                └→ rejected / expired
 */

import type BetterSqlite3 from "better-sqlite3";
import { createHmac, createCipheriv, randomBytes } from "node:crypto";

export const CLAIM_REASONS = [
  "domain_match", "txt_verified",
  "manual_exception_group_company", "manual_exception_ma",
  "fact_confirmed", "fact_rejected_no_evidence",
  "homograph_review", "expired_nonce", "psl_rejected", "freemail_rejected",
  "mismatch", "intake_paused", "claim_domain_missing", "other",
] as const;
export type ClaimReason = (typeof CLAIM_REASONS)[number];

export function initClaimSchema(db: BetterSqlite3.Database): void {
  // P0（Codex中間レビュー 8/16）: 自動認証の唯一のアンカーは、独立確認された
  // services.claim_domain のみ。api_url / mcp_endpoint は第三者基盤ドメイン
  // （GitHub・API Gateway・クラウド・共用ドキュメント基盤・外部MCP提供者）に
  // なり得るため、所有権の証明には一切使わない（参考情報限定）。
  // claim_domain の確定は provenance 付き（例: official_site_manual_check /
  // vendor_confirmed）で、確定作業自体が監査対象。
  const svcCols = db.prepare("PRAGMA table_info(services)").all().map((c) => (c as { name: string }).name);
  if (!svcCols.includes("claim_domain")) {
    db.exec("ALTER TABLE services ADD COLUMN claim_domain TEXT");
    db.exec("ALTER TABLE services ADD COLUMN claim_domain_provenance TEXT");
    db.exec("ALTER TABLE services ADD COLUMN claim_domain_verified_at TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      claim_id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      claim_type TEXT NOT NULL CHECK (claim_type IN ('ownership','fact_correction','official_mcp')),
      status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted','manual_review','domain_verified','claimed_public','rejected','expired')),
      applicant_etld1 TEXT,
      nonce_hash TEXT,
      nonce_expires_at TEXT,
      correction_payload TEXT, -- fact_correction本文（未検証vendor_reported・内部審査キューのみ=絶対に公開面へ出さない）
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS claim_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      action TEXT NOT NULL,
      applicant_domain_public TEXT,  -- 法人ドメインのみ生値
      applicant_domain_hmac TEXT,    -- 個人系ドメインはHMACのみ（生値はclaim_pii側）
      verification_method TEXT,
      actor TEXT NOT NULL,           -- 'system' | 'kl-integrity' | 'michie'
      reason TEXT NOT NULL,          -- CLAIM_REASONS enum（自由記述禁止）
      encrypted_detail TEXT,         -- 条件④: reasonと別フィールド。鍵(CLAIM_DETAIL_KEY)はSEC管理
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS claim_pii (
      claim_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      applicant_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
      -- retention: Claim有効期間+2年（FUNNEL-METRICS §5）。削除請求はここを削除し
      -- suppressionへHMACを残す。監査ログは残る（PII最小化済みデータ）。
    );

    CREATE INDEX IF NOT EXISTS idx_claims_service ON claims(service_id);
    CREATE INDEX IF NOT EXISTS idx_claim_audit_claim ON claim_audit_log(claim_id);
  `);
}

/** 個人系ドメインの仮名化（rev3②）。専用secret必須——素のSHA-256は照合攻撃可能なため不使用。 */
export function domainHmac(domain: string): string | null {
  const key = process.env.CLAIM_DOMAIN_HMAC_KEY;
  if (!key) return null; // fail closed: キー未設定なら生値もHMACも記録せずnull（auditにはreasonのみ残る）
  return createHmac("sha256", key).update(domain.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * encrypted_detail（条件④）: AES-256-GCM。鍵（CLAIM_DETAIL_KEY: 32byte base64）は
 * SEC管理・未設定時は詳細を保存しない（reason enumのみ）。
 */
export function encryptDetail(plaintext: string): string | null {
  const keyB64 = process.env.CLAIM_DETAIL_KEY;
  if (!keyB64) return null;
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64")}.${ct.toString("base64")}.${cipher.getAuthTag().toString("base64")}`;
}

/** 法人/個人系ドメインの区分。確信が持てない場合は個人扱い（保守側）。 */
export function isLikelyPersonalDomain(etld1: string): boolean {
  // ヒューリスティック: 明確な法人シグナル（co.jp / or.jp / ne.jp等の属性型JPドメイン、
  // 既知サービスの公式ドメインとの一致）以外で、短い.com/.jp等は判定不能→個人扱い。
  // MVPでは「サービス公式ドメインとeTLD+1一致」だけを法人確定とし、それ以外は個人扱いで
  // HMAC化する（審査上は生値が必要ならclaim_pii経由・アクセス制限下で参照）。
  return !/\.(co|or|ne|ac|go)\.jp$/.test(etld1);
}

export interface AuditEntry {
  claimId: string;
  serviceId: string;
  action: string;
  applicantEtld1?: string | null;
  officialEtld1?: string | null; // 公式ドメインと一致していれば法人確定
  verificationMethod?: string;
  actor: "system" | "kl-integrity" | "michie";
  reason: ClaimReason;
  detail?: string; // enumで表せない場合のみ→暗号化して格納
}

export function appendAudit(db: BetterSqlite3.Database, e: AuditEntry): void {
  if (!CLAIM_REASONS.includes(e.reason)) throw new Error(`invalid reason enum: ${e.reason}`);
  let domainPublic: string | null = null;
  let domainMasked: string | null = null;
  if (e.applicantEtld1) {
    const corporate = e.officialEtld1 && e.applicantEtld1 === e.officialEtld1 && !isLikelyPersonalDomain(e.applicantEtld1)
      ? true
      : e.officialEtld1 === e.applicantEtld1; // 公式一致は法人確定扱い
    if (corporate) domainPublic = e.applicantEtld1;
    else domainMasked = domainHmac(e.applicantEtld1);
  }
  db.prepare(`
    INSERT INTO claim_audit_log
      (claim_id, service_id, action, applicant_domain_public, applicant_domain_hmac,
       verification_method, actor, reason, encrypted_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    e.claimId, e.serviceId, e.action, domainPublic, domainMasked,
    e.verificationMethod ?? null, e.actor, e.reason,
    e.detail ? encryptDetail(e.detail) : null,
  );
}

/**
 * Intake kill-switch（実装条件③）: なりすまし成立・検証迂回・PII漏えい・PSL/IDN不具合の
 * いずれかで新規受付を停止する。トリガーは運用判断（env設定=再デプロイで発効）。
 * Profile苦情では止めない（窓口継続・対応品質も観測対象）。
 */
export function intakePaused(): boolean {
  return process.env.KANSEI_CLAIM_INTAKE === "paused";
}
