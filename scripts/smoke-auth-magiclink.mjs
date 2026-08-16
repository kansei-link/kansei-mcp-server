#!/usr/bin/env node
/**
 * A1追加ゲート（Codex条件4）: マジックリンクのフルE2E
 *   request-link → メール送信（SendGridモックで捕捉） → リンクのcode検証 →
 *   v2トークン取得 → Pro判定 まで通しで確認する。
 *
 * あわせて検証:
 *   - 非加入者には同一応答でメールは送られない（anti-enumeration）
 *   - KANSEI_AUTH_ECHO未設定時、応答にdebug_linkが含まれない
 *   - codeは一回限り（再利用は400）
 *   - 発行トークンがv2形式で、ACCESS_TOKEN_SECRETから導出されたものと一致
 *
 * Usage: node scripts/smoke-auth-magiclink.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCESS_SECRET = "test-access-secret-a1";
const PORT = 6100 + Math.floor(Math.random() * 200);
const MOCK_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, note = "") => { results.push(ok); console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${note ? ` (${note})` : ""}`); };

// ── SendGridモック: 送信ペイロードを捕捉して202を返す ──
const sentMails = [];
const mock = http.createServer((req, res) => {
  if (req.url.startsWith("/v3/mail/send")) {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      sentMails.push(JSON.parse(body));
      res.writeHead(202); res.end();
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ errors: [{ message: `unhandled ${req.url}` }] }));
});

const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  const workDir = mkdtempSync(join(tmpdir(), "kansei-auth-smoke-"));
  const dbPath = join(workDir, "smoke.db");

  const env = { ...process.env, KANSEI_DB_PATH: dbPath, PORT: String(PORT), KANSEI_HOST: "127.0.0.1",
    CRAWLER_SECRET: "smoke", ACCESS_TOKEN_SECRET: ACCESS_SECRET,
    SENDGRID_API_KEY: "SG.test_mock", SENDGRID_API_BASE: `http://127.0.0.1:${MOCK_PORT}` };
  delete env.KANSEI_AUTH_ECHO; // 本番同等: echo無効を明示
  const server = spawn(process.execPath, [join(ROOT, "dist", "http-server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });

  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!up) { console.error("server did not boot:\n" + serverLog.slice(-800)); server.kill(); process.exit(1); }

  const { default: Database } = await import("better-sqlite3");
  const dbw = new Database(dbPath);
  dbw.prepare(`INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status)
               VALUES ('cus_a1', 'sub_a1', 'subscriber@example.com', 'pro', 'active')`).run();
  dbw.close();

  // 1. 加入者のrequest-link → 200 ok・メール1通・debug_linkなし
  let r = await api("POST", "/api/auth/request-link", { email: "subscriber@example.com" });
  check("1. request-link(加入者)→200 ok・debug_linkなし", r.status === 200 && r.json?.ok === true && !("debug_link" in (r.json || {})));
  check("2. SendGridモックがメール1通を受信", sentMails.length === 1, `got ${sentMails.length}`);

  // メール本文からcodeを抽出（実メール受信の代理）
  const html = sentMails[0]?.content?.[0]?.value ?? "";
  const codeMatch = html.match(/login\.html\?code=([a-f0-9]+)/);
  check("3. メール本文にログインリンク(code付き)・click-tracking無効", Boolean(codeMatch) && sentMails[0]?.tracking_settings?.click_tracking?.enable === false);

  // 2. 非加入者 → 同一応答・メールは増えない
  r = await api("POST", "/api/auth/request-link", { email: "stranger@example.com" });
  check("4. request-link(非加入者)→同一応答200・メール送信なし(anti-enumeration)", r.status === 200 && r.json?.ok === true && sentMails.length === 1);

  // 3. verify → v2トークン
  const code = codeMatch ? codeMatch[1] : "";
  r = await api("POST", "/api/auth/verify", { code });
  const token = r.json?.token ?? "";
  const expected = `v2.${createHmac("sha256", ACCESS_SECRET).update("subscriber@example.com").digest("hex").slice(0, 32)}`;
  check("5. verify→v2形式トークン・ACCESS_TOKEN_SECRET導出値と一致", r.status === 200 && token === expected, token.slice(0, 6));

  // 4. Pro判定
  const access = await api("GET", "/api/access?email=subscriber@example.com");
  check("6. Pro判定: /api/access → tier=pro/active", access.json?.tier === "pro" && access.json?.active === true);

  // 5. codeは一回限り
  r = await api("POST", "/api/auth/verify", { code });
  check("7. 同一codeの再利用→拒否", r.status === 400);

  // 6. ログ安全性（Codexセキュリティ条件）: SENDGRID_API_KEY未設定サーバーで
  //    request-linkしても、ログにメールアドレス・リンク・codeが出ないこと
  const PORT2 = PORT + 2;
  const workDir2 = mkdtempSync(join(tmpdir(), "kansei-auth-nokey-"));
  const dbPath2 = join(workDir2, "smoke.db");
  const env2 = { ...env, KANSEI_DB_PATH: dbPath2, PORT: String(PORT2) };
  delete env2.SENDGRID_API_KEY;
  const server2 = spawn(process.execPath, [join(ROOT, "dist", "http-server.js")], { env: env2, stdio: ["ignore", "pipe", "pipe"] });
  let log2 = "";
  server2.stdout.on("data", (d) => { log2 += d; });
  server2.stderr.on("data", (d) => { log2 += d; });
  let up2 = false;
  for (let i = 0; i < 60 && !up2; i++) {
    try { up2 = (await fetch(`http://127.0.0.1:${PORT2}/health`)).ok; } catch { await new Promise((r2) => setTimeout(r2, 1000)); }
  }
  const dbw2 = new Database(dbPath2);
  dbw2.prepare(`INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, email, tier, status)
                VALUES ('cus_a1', 'sub_a1', 'subscriber@example.com', 'pro', 'active')`).run();
  dbw2.close();
  const r2 = await fetch(`http://127.0.0.1:${PORT2}/api/auth/request-link`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "subscriber@example.com" }),
  });
  await new Promise((r3) => setTimeout(r3, 500));
  const db2 = new Database(dbPath2, { readonly: true });
  const codeIssued = db2.prepare("SELECT COUNT(*) c FROM login_codes").get().c === 1; // codeは発行される(ログに出ないだけ)
  db2.close();
  const audited = log2.includes("[auth][AUDIT]") && log2.includes("reason=no_key");
  const leaked = log2.includes("subscriber@example.com") || /login\.html\?code=/.test(log2) || /[a-f0-9]{48}/.test(log2);
  check("8. キー未設定: 200+AUDITログ(reason=no_key)・メール/リンク/codeはログ非出力", r2.status === 200 && audited && !leaked && codeIssued,
    leaked ? "SECRET LEAKED IN LOG" : "clean");
  server2.kill();
  rmSync(workDir2, { recursive: true, force: true });

  server.kill();
  mock.close();
  await new Promise((r2) => setTimeout(r2, 500));
  rmSync(workDir, { recursive: true, force: true });

  const all = results.every(Boolean);
  console.log(all ? "\n✅ smoke-auth-magiclink: ALL PASS" : "\n❌ smoke-auth-magiclink: FAILURES");
  process.exit(all ? 0 : 1);
}

main().catch((e) => { console.error("SMOKE ERROR:", e); process.exit(1); });
