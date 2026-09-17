#!/usr/bin/env node
/**
 * サイト内から Agent Wiki への内部リンクを「1 か所だけ」置く／外す。
 *
 * 背景: Agent Wiki の公開は事前登録した準実験の介入。サイト内リンクが 0 だと索引到達の経路が sitemap だけになるため、
 *       関連ページから 1 か所だけリンクする（Founder 決定 2026-09-17）。リンクも介入の一部として記録するので、
 *       場所と文言をここに固定し、手で増やさない。
 *   置き場所: public/insights/mcp-server-implementation-guide-2026.html の「For AI Agents」節の末尾
 *             （特定サービスに寄らない実装ガイド＝介入群・対照群のどちらにも偏らない）
 *   リンク先: /agent-wiki/ （索引ページ。個別サービスのページへは直接リンクしない）
 *
 *   node scripts/agent-wiki-link.mjs           置く（public/agent-wiki/index.html が無ければ停止＝リンク切れを公開しない）
 *   node scripts/agent-wiki-link.mjs --remove  外す
 *   node scripts/agent-wiki-link.mjs --check   サイト全体で agent-wiki へのリンクが「この 1 か所だけ」かを検査（exit≠0 で不一致）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");
const HOST = join(PUB, "insights", "mcp-server-implementation-guide-2026.html");
const MARK = "<!-- agent-wiki-link:v1 -->";
const ANCHOR = /(<!-- For AI Agents -->[\s\S]*?)(\r?\n\s*<\/div>\s*\r?\n\s*<\/section>)/;
const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--check") ? "check" : "add";

const html = readFileSync(HOST, "utf8");
const nl = html.includes("\r\n") ? "\r\n" : "\n";
const BLOCK = `${nl}      ${MARK}${nl}      <p>サービスごとの認証方式・公開MCPの有無・接続時の注意を、確認できた範囲でまとめたページ: <a href="/agent-wiki/">Agent Wiki</a></p>`;
const strip = (s) => s.replace(new RegExp(`\\r?\\n\\s*${MARK}\\r?\\n[^\\n]*?</p>`), "");

if (mode === "check") {
  const hits = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) { if (p !== join(PUB, "agent-wiki")) walk(p); } else if (/\.html?$/.test(f) && /href="[^"]*\/agent-wiki\//.test(readFileSync(p, "utf8"))) hits.push(relative(PUB, p).replace(/\\/g, "/")); } };
  walk(PUB);
  const published = existsSync(join(PUB, "agent-wiki", "index.html"));
  const expect = published ? ["insights/mcp-server-implementation-guide-2026.html"] : [];
  const ok = JSON.stringify(hits.sort()) === JSON.stringify(expect);
  console.log(`[agent-wiki-link] 公開 ${published ? "あり" : "なし"} ／ agent-wiki へのリンクを持つページ: ${hits.join(", ") || "なし"} → ${ok ? "OK" : "不一致"}`);
  process.exit(ok ? 0 : 1);
}
if (mode === "add") {
  if (!existsSync(join(PUB, "agent-wiki", "index.html"))) { console.error("[agent-wiki-link] public/agent-wiki/index.html が無い。先に --publish で生成すること（リンク切れを公開しない）"); process.exit(2); }
  const base = strip(html);
  if (!ANCHOR.test(base)) { console.error("[agent-wiki-link] 置き場所（For AI Agents 節）が見つからない"); process.exit(2); }
  const next = base.replace(ANCHOR, (_, a, b) => a + BLOCK + b);
  writeFileSync(HOST, next);
  console.log(next === html ? "[agent-wiki-link] 既に設置済み（変更なし）" : "[agent-wiki-link] 設置した: insights/mcp-server-implementation-guide-2026.html → /agent-wiki/");
} else {
  const next = strip(html);
  writeFileSync(HOST, next);
  console.log(next === html ? "[agent-wiki-link] リンクは無い（変更なし）" : "[agent-wiki-link] 外した");
}
