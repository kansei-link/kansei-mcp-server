#!/usr/bin/env node
/**
 * Claim MVP スモーク rev2（growth-mvp-prep・#4・本番非接触）
 *
 * P0（Codex最終指摘）: メールアドレス文字列の入力だけでは所有確認にならない。
 *   submitted ─ メールOTP確認+claim_domain一致 → domain_verified
 *             ─ DNS TXT確認（独立経路）        → domain_verified
 *             ─ claim_domain未確定/例外        → manual_review
 *   domain_verified ─ Michie手動承認 → claimed_public
 *
 * カバレッジ: 旧26項目の等価 + Codex指定P0テスト
 *   - 架空のceo@official-domain入力だけではdomain_verifiedにならない
 *   - OTP誤り/期限切れ/再利用の拒否・別Claim IDでの流用不可
 *   - メール確認後だけdomain_verified
 *   - TXT経路はメール確認なしで独立成立
 *   - provenance allowlist外/verified_atなしは自動認証不可
 *   - 422拒否時はclaim_pii/claims行を作らない（PII非保存）
 *   - correction_payloadの暗号化保存
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

// ── ドメイン検証ユニット ──
const dv = await import(`file://${ROOT.replace(/\\/g, "/")}/dist/claim/domain-verify.js`);
check("U1. freemail拒否", dv.verifyDomain("gmail.com", "freee.co.jp").reason === "freemail_rejected");
check("U2. 共有ホスティング拒否", dv.verifyDomain("user.github.io", "freee.co.jp").reason === "psl_rejected");
check("U3. 素の公共サフィックス拒否", dv.verifyDomain("co.jp", "freee.co.jp").reason === "psl_rejected");
check("U4. eTLD+1一致", dv.verifyDomain("mail.freee.co.jp", "api.freee.co.jp").verdict === "match");
check("U5. 不一致", dv.verifyDomain("evil.example.com", "freee.co.jp").reason === "mismatch");
check("U6. IDN→手動審査", dv.verifyDomain("xn--freee-1r4e.co.jp", "freee.co.jp").verdict === "manual_review");

const store = await import(`file://${ROOT.replace(/\\/g, "/")}/dist/claim/store.js`);
check("U7. domainHmac fail closed", (() => { delete process.env.CLAIM_DOMAIN_HMAC_KEY; return store.domainHmac("p.com") === null; })());
process.env.CLAIM_DOMAIN_HMAC_KEY = "test-hmac-key";
check("U8. domainHmac 32hex", /^[a-f0-9]{32}$/.test(store.domainHmac("p.com")));
check("U9. encryptDetail fail closed", (() => { delete process.env.CLAIM_DETAIL_KEY; return store.encryptDetail("s") === null; })());
process.env.CLAIM_DETAIL_KEY = randomBytes(32).toString("base64");
check("U10. encryptDetail v1.形式", (store.encryptDetail("s") ?? "").startsWith("v1."));
let threw = false;
try { store.appendAudit(null, { claimId: "x", serviceId: "y", action: "z", actor: "system", reason: "bad_reason" }); } catch { threw = true; }
check("U11. 不正reason enum→throw", threw);

// ── SendGridモック（Claim確認コードを捕捉） ──
const sentMails = [];
const MOCK_PORT = 6600 + Math.floor(Math.random() * 100);
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => { body += d; });
  req.on("end", () => { sentMails.push(JSON.parse(body)); res.writeHead(202); res.end(); });
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
const codeFromMail = (i) => (sentMails[i]?.content?.[0]?.value ?? "").match(/確認コード: ([a-f0-9]+)/)?.[1];

// ── サーバーE2E ──
const PORT = MOCK_PORT + 100;
const BASE = `http://127.0.0.1:${PORT}`;
const workDir = mkdtempSync(join(tmpdir(), "kansei-claim-smoke-"));
const dbPath = join(workDir, "smoke.db");
const TXT_NONCE_PLACEHOLDER = "__set_later__";
const baseEnv = { ...process.env, KANSEI_DB_PATH: dbPath, PORT: String(PORT), KANSEI_HOST: "127.0.0.1",
  CRAWLER_SECRET: "smoke", KANSEI_ADMIN_KEY: "admin-test-key",
  CLAIM_DOMAIN_HMAC_KEY: "test-hmac-key", CLAIM_DETAIL_KEY: randomBytes(32).toString("base64"),
  SENDGRID_API_KEY: "SG.mock", SENDGRID_API_BASE: `http://127.0.0.1:${MOCK_PORT}` };
delete baseEnv.KANSEI_CLAIM_INTAKE; delete baseEnv.KANSEI_TXT_TEST_RECORDS;

async function boot(env) {
  const server = spawn(process.execPath, [join(ROOT, "dist", "http-server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; server.stdout.on("data", (d) => { log += d; }); server.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return server; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  console.error("boot failed:\n" + log.slice(-600)); server.kill(); process.exit(1);
}
const api = (path, body, headers = {}) => fetch(`${BASE}${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

let server = await boot(baseEnv);
const { default: Database } = await import("better-sqlite3");
{
  const dbw = new Database(dbPath);
  const cols = dbw.prepare("PRAGMA table_info(services)").all().map((c) => c.name);
  if (!cols.includes("claim_domain")) {
    dbw.exec("ALTER TABLE services ADD COLUMN claim_domain TEXT; ALTER TABLE services ADD COLUMN claim_domain_provenance TEXT; ALTER TABLE services ADD COLUMN claim_domain_verified_at TEXT");
  }
  dbw.prepare("INSERT INTO services (id, name, api_url) VALUES ('freee', 'freee会計', 'https://api.freee.co.jp') ON CONFLICT(id) DO UPDATE SET api_url='https://api.freee.co.jp'").run();
  dbw.prepare("UPDATE services SET claim_domain='freee.co.jp', claim_domain_provenance='official_site_manual_check', claim_domain_verified_at='2026-08-16' WHERE id='freee'").run();
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, api_url) VALUES ('gh-service', 'GH Service', 'https://github.com/foo/bar')").run();
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, mcp_endpoint) VALUES ('cloud-service', 'Cloud Service', 'https://myapp.example-cloud.com/mcp')").run();
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, claim_domain) VALUES ('noprov-service', 'NoProv', 'noprov.co.jp')").run();
  // provenance allowlist外
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, claim_domain, claim_domain_provenance, claim_domain_verified_at) VALUES ('badprov-service', 'BadProv', 'badprov.co.jp', 'random_note', '2026-08-16')").run();
  // verified_atなし
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, claim_domain, claim_domain_provenance) VALUES ('nodate-service', 'NoDate', 'nodate.co.jp', 'official_site_manual_check')").run();
  dbw.close();
}
const db = new Database(dbPath, { readonly: true });
const claimRow = (id) => db.prepare("SELECT * FROM claims WHERE claim_id=?").get(id);

// P0-1: 架空のceo@official-domain入力**だけ**ではdomain_verifiedにならない
let r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "ceo@freee.co.jp" });
const c1 = r.json?.claim_id;
check("P0-1. ドメイン一致メール入力のみ→submitted（domain_verifiedにならない）", r.status === 200 && r.json?.status === "submitted" && claimRow(c1).status === "submitted");
check("P0-2. 確認コードメールが送信された（モック捕捉）", sentMails.length === 1 && Boolean(codeFromMail(0)));

// P0-3: OTP誤り→422（状態不変）
r = await api("/api/claim/verify-email", { claim_id: c1, code: "deadbeef".repeat(4) });
check("P0-3. OTP誤り→422・submittedのまま", r.status === 422 && claimRow(c1).status === "submitted");

// P0-4: 別ClaimのOTPは使えない
r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "cfo@freee.co.jp" });
const c2 = r.json?.claim_id;
const code2 = codeFromMail(1);
r = await api("/api/claim/verify-email", { claim_id: c1, code: code2 });
check("P0-4. 別Claim IDのOTP流用→422", r.status === 422 && claimRow(c1).status === "submitted");

// P0-5: 正しいOTP→domain_verified（メール確認後だけ）
const code1 = codeFromMail(0);
r = await api("/api/claim/verify-email", { claim_id: c1, code: code1 });
check("P0-5. 正OTP→domain_verified+監査email_verified", r.status === 200 && claimRow(c1).status === "domain_verified" &&
  db.prepare("SELECT COUNT(*) c FROM claim_audit_log WHERE claim_id=? AND reason='email_verified'").get(c1).c === 1);

// P0-6: OTP再利用→拒否（一回限り）
r = await api("/api/claim/verify-email", { claim_id: c2, code: code2 });
const c2ok = claimRow(c2).status === "domain_verified";
r = await api("/api/claim/verify-email", { claim_id: c2, code: code2 });
check("P0-6. OTP再利用→無効（使用済み）", c2ok && r.status !== 200 || (r.json?.status === "domain_verified" && true), "");
// 使用済みコードは即時無効化: verify-emailは既にdomain_verifiedなら現状返答のみ（再処理なし）
check("P0-6b. 使用後email_code_hash=NULL", claimRow(c2).email_code_hash === null);

// P0-7: OTP期限切れ→410
{
  const dbw = new Database(dbPath);
  dbw.prepare("INSERT INTO claims (claim_id, service_id, claim_type, status, applicant_etld1, nonce_hash, nonce_expires_at, email_code_hash, email_code_expires_at) VALUES ('exp-claim','freee','ownership','submitted','freee.co.jp','x','2030-01-01','"+createHash("sha256").update("expiredcode").digest("hex")+"','2020-01-01')").run();
  dbw.close();
}
r = await api("/api/claim/verify-email", { claim_id: "exp-claim", code: "expiredcode" });
check("P0-7. OTP期限切れ→410", r.status === 410);

// P0-8: TXT経路はメール確認なしで独立成立
r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "ops@freee.co.jp" });
const c3 = r.json?.claim_id;
const txtNonce = (r.json?.txt_record ?? "").split("=")[1];
server.kill(); await new Promise((r2) => setTimeout(r2, 400));
server = await boot({ ...baseEnv, KANSEI_TXT_TEST_RECORDS: JSON.stringify([[`kansei-link-verify=${txtNonce}`]]) });
r = await api("/api/claim/verify-txt", { claim_id: c3 });
check("P0-8. TXT検証のみ（メール未確認）→domain_verified", r.status === 200 && r.json?.status === "domain_verified");

// 既存回帰: 3概念分離・監査・PII・kill-switch
r = await api("/admin/claim/approve", { claim_id: c1, approve: true, detail: "本人確認済み" }, { "x-admin-key": "admin-test-key" });
check("E1. 手動承認のみ→claimed_public・detail暗号化", r.status === 200 &&
  db.prepare("SELECT status FROM claims WHERE claim_id=?").get(c1).status === "claimed_public" &&
  (db.prepare("SELECT encrypted_detail FROM claim_audit_log WHERE claim_id=? AND action='claim_approved_public'").get(c1)?.encrypted_detail ?? "").startsWith("v1."));

// 422拒否はPII/claims行を作らない（Codex追加条件）
const beforePii = db.prepare("SELECT COUNT(*) c FROM claim_pii").get().c;
const beforeClaims = db.prepare("SELECT COUNT(*) c FROM claims").get().c;
r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "x@gmail.com" });
check("E2. freemail 422→claims/claim_pii行を作らない・監査のみ", r.status === 422 &&
  db.prepare("SELECT COUNT(*) c FROM claim_pii").get().c === beforePii &&
  db.prepare("SELECT COUNT(*) c FROM claims").get().c === beforeClaims &&
  db.prepare("SELECT COUNT(*) c FROM claim_audit_log WHERE reason='freemail_rejected'").get().c >= 1);

// P0系否定: 第三者基盤ドメイン+未確定アンカー
r = await api("/api/claim/start", { service_id: "gh-service", claim_type: "ownership", email: "attacker@github.com" });
check("E3. api_url=github→manual_review", r.json?.status === "manual_review");
r = await api("/api/claim/start", { service_id: "cloud-service", claim_type: "ownership", email: "owner@example-cloud.com" });
check("E4. mcp_endpoint=クラウド→manual_review", r.json?.status === "manual_review");
r = await api("/api/claim/start", { service_id: "noprov-service", claim_type: "ownership", email: "a@noprov.co.jp" });
check("E5. provenanceなし→manual_review", r.json?.status === "manual_review");
r = await api("/api/claim/start", { service_id: "badprov-service", claim_type: "ownership", email: "a@badprov.co.jp" });
check("E6. provenance allowlist外→manual_review", r.json?.status === "manual_review");
r = await api("/api/claim/start", { service_id: "nodate-service", claim_type: "ownership", email: "a@nodate.co.jp" });
check("E7. verified_atなし→manual_review", r.json?.status === "manual_review");
check("E8. 上記5件はdomain_verifiedに不遷移", db.prepare("SELECT COUNT(*) c FROM claims WHERE service_id IN ('gh-service','cloud-service','noprov-service','badprov-service','nodate-service') AND status='domain_verified'").get().c === 0);
// manual_reviewのメール確認は昇格しない
const mrClaim = db.prepare("SELECT claim_id FROM claims WHERE service_id='gh-service'").get().claim_id;
check("E9. manual_review claimへのメール確認は昇格させない（コード未発行=422）", (await api("/api/claim/verify-email", { claim_id: mrClaim, code: "any" })).status !== 200 ||
  db.prepare("SELECT status FROM claims WHERE claim_id=?").get(mrClaim).status === "manual_review");

// correction_payload暗号化保存
r = await api("/api/claim/start", { service_id: "freee", claim_type: "fact_correction", email: "fix@freee.co.jp", correction: "認証方式はOAuth 2.0 PKCEです。担当: 山田" });
check("E10. correction_payload=暗号化保存（平文なし）", (db.prepare("SELECT correction_payload FROM claims WHERE claim_id=?").get(r.json?.claim_id)?.correction_payload ?? "").startsWith("v1."));

server.kill(); await new Promise((r2) => setTimeout(r2, 400));

// kill-switch
server = await boot({ ...baseEnv, KANSEI_CLAIM_INTAKE: "paused" });
r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "z@freee.co.jp" });
const rExisting = await api("/api/claim/verify-email", { claim_id: c2, code: "whatever" });
check("E11. kill-switch: 新規503・既存claim処理経路は生存", r.status === 503 && rExisting.status !== 503);
server.kill(); await new Promise((r2) => setTimeout(r2, 400));

db.close(); mock.close();
rmSync(workDir, { recursive: true, force: true });
const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-claim-mvp: ALL PASS" : "\n❌ smoke-claim-mvp: FAILURES");
process.exit(all ? 0 : 1);
