#!/usr/bin/env node
/**
 * Claim MVP スモーク（growth-mvp-prep・#4・本番非接触）
 *
 * カバレッジ（rev3 §4.1 + 実装条件②③④）:
 *   ドメイン検証: freemail拒否 / 共有ホスティング拒否 / 素の公共サフィックス拒否 /
 *                 eTLD+1一致 / 不一致 / IDN→手動審査
 *   状態機械: domain_verified≠公開Claimed（条件②: 手動承認のみがclaimed_public）
 *   監査: reason enum強制 / encrypted_detail別フィールド（条件④） / 個人系HMAC / PII分離
 *   運用: intake kill-switch（条件③） / nonce期限切れ→410
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

// ── 1. ドメイン検証ユニット（dist直接） ──
const dv = await import(`file://${ROOT.replace(/\\/g, "/")}/dist/claim/domain-verify.js`);
check("U1. freemail拒否", dv.verifyDomain("gmail.com", "freee.co.jp").verdict === "reject" && dv.verifyDomain("gmail.com", "freee.co.jp").reason === "freemail_rejected");
check("U2. 共有ホスティング拒否(user.github.io)", dv.verifyDomain("user.github.io", "freee.co.jp").reason === "psl_rejected");
check("U3. 素の公共サフィックス拒否(co.jp)", dv.verifyDomain("co.jp", "freee.co.jp").reason === "psl_rejected");
check("U4. eTLD+1一致(mail.freee.co.jp vs api.freee.co.jp)", dv.verifyDomain("mail.freee.co.jp", "api.freee.co.jp").verdict === "match" && dv.verifyDomain("mail.freee.co.jp", "api.freee.co.jp").etld1 === "freee.co.jp");
check("U5. 不一致", dv.verifyDomain("evil.example.com", "freee.co.jp").reason === "mismatch");
check("U6. IDN→手動審査(homograph)", dv.verifyDomain("xn--freee-1r4e.co.jp", "freee.co.jp").verdict === "manual_review");

const store = await import(`file://${ROOT.replace(/\\/g, "/")}/dist/claim/store.js`);
check("U7. domainHmac: キー未設定→null(fail closed)", (() => { delete process.env.CLAIM_DOMAIN_HMAC_KEY; return store.domainHmac("personal.com") === null; })());
process.env.CLAIM_DOMAIN_HMAC_KEY = "test-hmac-key";
check("U8. domainHmac: キーあり→32hex", /^[a-f0-9]{32}$/.test(store.domainHmac("personal.com")));
check("U9. encryptDetail: キー未設定→null", (() => { delete process.env.CLAIM_DETAIL_KEY; return store.encryptDetail("secret") === null; })());
process.env.CLAIM_DETAIL_KEY = randomBytes(32).toString("base64");
check("U10. encryptDetail: v1.形式で暗号化", (store.encryptDetail("secret") ?? "").startsWith("v1."));

// ── 2. サーバーE2E ──
const PORT = 6400 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const workDir = mkdtempSync(join(tmpdir(), "kansei-claim-smoke-"));
const dbPath = join(workDir, "smoke.db");
const baseEnv = { ...process.env, KANSEI_DB_PATH: dbPath, PORT: String(PORT), KANSEI_HOST: "127.0.0.1",
  CRAWLER_SECRET: "smoke", KANSEI_ADMIN_KEY: "admin-test-key",
  CLAIM_DOMAIN_HMAC_KEY: "test-hmac-key", CLAIM_DETAIL_KEY: randomBytes(32).toString("base64") };
delete baseEnv.KANSEI_CLAIM_INTAKE;

async function boot(env) {
  const server = spawn(process.execPath, [join(ROOT, "dist", "http-server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; server.stdout.on("data", (d) => { log += d; }); server.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return { server, log: () => log }; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  console.error("boot failed:\n" + log.slice(-600)); server.kill(); process.exit(1);
}

const api = (path, body, headers = {}) => fetch(`${BASE}${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

let { server } = await boot(baseEnv);
const { default: Database } = await import("better-sqlite3");
{
  const dbw = new Database(dbPath);
  // claim schemaのALTERはハンドラ初回実行時だが、テストseedのため先に列を作る
  const cols = dbw.prepare("PRAGMA table_info(services)").all().map((c) => c.name);
  if (!cols.includes("claim_domain")) {
    dbw.exec("ALTER TABLE services ADD COLUMN claim_domain TEXT; ALTER TABLE services ADD COLUMN claim_domain_provenance TEXT; ALTER TABLE services ADD COLUMN claim_domain_verified_at TEXT");
  }
  // 正例: 独立確認済みclaim_domain（P0: api_urlは自動認証に使われない）
  dbw.prepare("INSERT INTO services (id, name, api_url) VALUES ('freee', 'freee会計', 'https://api.freee.co.jp') ON CONFLICT(id) DO UPDATE SET api_url='https://api.freee.co.jp'").run();
  dbw.prepare("UPDATE services SET claim_domain='freee.co.jp', claim_domain_provenance='official_site_manual_check', claim_domain_verified_at='2026-08-16' WHERE id='freee'").run();
  // 否定例1: api_urlがGitHub（第三者基盤）・claim_domainなし
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, api_url) VALUES ('gh-service', 'GH Service', 'https://github.com/foo/bar')").run();
  // 否定例2: mcp_endpointがクラウド事業者ドメイン・claim_domainなし
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, mcp_endpoint) VALUES ('cloud-service', 'Cloud Service', 'https://myapp.example-cloud.com/mcp')").run();
  // 否定例3: claim_domainはあるがprovenanceなし=未確定扱い
  dbw.prepare("INSERT OR REPLACE INTO services (id, name, claim_domain) VALUES ('noprov-service', 'NoProv Service', 'noprov.co.jp')").run();
  dbw.close();
}

// E1: 確認済みclaim_domainのドメインメール → domain_verified（公開Claimedにはならない）
let r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "taro@freee.co.jp" });
const claimId = r.json?.claim_id;
check("E1. 公式ドメインClaim→domain_verified", r.status === 200 && r.json?.status === "domain_verified" && Boolean(claimId));

const db = new Database(dbPath, { readonly: true });
const claim = () => db.prepare("SELECT status, applicant_etld1 FROM claims WHERE claim_id=?").get(claimId);
check("E2. 条件②: 機械合格してもclaimed_publicではない", claim().status === "domain_verified");
const audit = db.prepare("SELECT * FROM claim_audit_log WHERE claim_id=? ORDER BY id").all(claimId);
check("E3. 監査: reason=domain_match・法人ドメイン生値・enum準拠", audit.length === 1 && audit[0].reason === "domain_match" && audit[0].applicant_domain_public === "freee.co.jp");
const pii = db.prepare("SELECT email FROM claim_pii WHERE claim_id=?").get(claimId);
const auditHasEmail = JSON.stringify(audit).includes("taro@");
check("E4. PII分離: emailはclaim_piiのみ・監査ログに不在", pii?.email === "taro@freee.co.jp" && !auditHasEmail);

// E5: freemail → 拒否
r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "someone@gmail.com" });
check("E5. freemail→422拒否+監査記録", r.status === 422 && db.prepare("SELECT COUNT(*) c FROM claim_audit_log WHERE reason='freemail_rejected'").get().c === 1);

// E6: 未verifiedの承認は409
r = await api("/admin/claim/approve", { claim_id: "nonexistent", approve: true }, { "x-admin-key": "admin-test-key" });
const r6b = await api("/admin/claim/approve", { claim_id: claimId, approve: true }, { "x-admin-key": "wrong" });
check("E6. admin鍵なし=404・不明claim=404", r.status === 404 && r6b.status === 404);

// E7: Michie手動承認 → claimed_public（条件②の唯一の遷移経路）
r = await api("/admin/claim/approve", { claim_id: claimId, approve: true, detail: "本人確認: 商談で面識あり" }, { "x-admin-key": "admin-test-key" });
const approved = db.prepare("SELECT status FROM claims WHERE claim_id=?").get(claimId);
const approveAudit = db.prepare("SELECT reason, actor, encrypted_detail FROM claim_audit_log WHERE claim_id=? AND action='claim_approved_public'").get(claimId);
check("E7. 手動承認→claimed_public・actor=michie・detailは暗号化別フィールド(条件④)",
  r.status === 200 && approved.status === "claimed_public" && approveAudit?.actor === "michie" && (approveAudit?.encrypted_detail ?? "").startsWith("v1."));

// E10-E13: P0否定テスト（api_url/mcp_endpointは所有権アンカーにならない）
r = await api("/api/claim/start", { service_id: "gh-service", claim_type: "ownership", email: "attacker@github.com" });
check("E10. P0: api_url=github.com/...でも自動認証されない→manual_review", r.status === 200 && r.json?.status === "manual_review" &&
  db.prepare("SELECT reason FROM claim_audit_log WHERE service_id='gh-service' ORDER BY id DESC LIMIT 1").get().reason === "claim_domain_missing");
r = await api("/api/claim/start", { service_id: "cloud-service", claim_type: "ownership", email: "owner@example-cloud.com" });
check("E11. P0: mcp_endpointがクラウド事業者ドメインでも自動認証されない→manual_review", r.status === 200 && r.json?.status === "manual_review");
r = await api("/api/claim/start", { service_id: "noprov-service", claim_type: "ownership", email: "a@noprov.co.jp" });
check("E12. P0: provenanceなしclaim_domain=未確定→manual_review", r.status === 200 && r.json?.status === "manual_review");
const ghClaims = db.prepare("SELECT COUNT(*) c FROM claims WHERE service_id IN ('gh-service','cloud-service','noprov-service') AND status='domain_verified'").get().c;
check("E13. P0: 上記3件がdomain_verifiedに一切遷移していない", ghClaims === 0);
r = await api("/api/claim/verify-txt", { claim_id: db.prepare("SELECT claim_id FROM claims WHERE service_id='gh-service'").get().claim_id });
check("E14. P0: アンカー未確定サービスへのTXT検証は422", r.status === 422);

// E8: nonce期限切れ → 410 + expired
{
  const dbw = new Database(dbPath);
  dbw.prepare("INSERT INTO claims (claim_id, service_id, claim_type, status, nonce_hash, nonce_expires_at) VALUES ('expired-claim','freee','ownership','submitted','deadbeef','2020-01-01T00:00:00Z')").run();
  dbw.close();
}
r = await api("/api/claim/verify-txt", { claim_id: "expired-claim" });
check("E8. nonce期限切れ→410+status=expired", r.status === 410 && db.prepare("SELECT status FROM claims WHERE claim_id='expired-claim'").get().status === "expired");

db.close();
server.kill();
await new Promise((r2) => setTimeout(r2, 500));

// E9: intake kill-switch（条件③）
({ server } = await boot({ ...baseEnv, KANSEI_CLAIM_INTAKE: "paused" }));
r = await api("/api/claim/start", { service_id: "freee", claim_type: "ownership", email: "taro@freee.co.jp" });
const r9b = await api("/api/claim/verify-txt", { claim_id: claimId }); // 既存申請の処理は継続（404でなく処理される=ここでは既にverified扱い応答）
check("E9. 条件③: 新規受付503停止・既存claimの処理経路は生存", r.status === 503 && r9b.status !== 503);
server.kill();
await new Promise((r2) => setTimeout(r2, 500));
rmSync(workDir, { recursive: true, force: true });

// U11: reason enum強制
let threw = false;
try { store.appendAudit(null, { claimId: "x", serviceId: "y", action: "z", actor: "system", reason: "free_text_not_allowed" }); } catch { threw = true; }
check("U11. 不正reason enum→throw", threw);

const all = results.every(Boolean);
console.log(all ? "\n✅ smoke-claim-mvp: ALL PASS" : "\n❌ smoke-claim-mvp: FAILURES");
process.exit(all ? 0 : 1);
