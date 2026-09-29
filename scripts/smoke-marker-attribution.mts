#!/usr/bin/env tsx
/**
 * Smoke test for the attribution columns A/B and rename detection (ATTRIBUTION-Rules v0.1, M-004).
 *
 *   npx tsx scripts/smoke-marker-attribution.mts
 *
 * Part A: lib/attribution-rules.mjs as pure functions (A2: the source matcher — host/owner/repo exact,
 *         anything below the repository allowed, HTML character references decoded for A pages) — the whole truth table (#1–#8), the
 *         undetermined cases U0–U4 and their precedence, and the cell texts.
 * Part B: run-marker end to end in --dry-run with the M-994 fixture seal, provider 'fake', and a
 *         loopback server (127.0.0.1:47336) playing A1/A2, the KanseiLINK catalog and the GitHub API.
 * Part C: the sheet drawn from Part B's readings (三列 + 判断（規則 v0.1）).
 * No network beyond loopback, no real seal, no DB.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { columnA, columnB, columnC, judgeAttribution, attributionLines, gtLabel, ATTR_METHODS, sourceRepoKey, sourceListsRepo, decodeHtmlCharRefs, classifySource, catalogBody, sha256Hex, validateAttestation } from "../exec-harness/lib/attribution-rules.mjs";
import { renderSheet } from "../exec-harness/render-reading-sheet.mjs";
import { validateReading, loadReadingSchema } from "../exec-harness/lib/reading.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FIX = join(ROOT, "exec-harness", "fixtures");
let failures = 0;
const passed: string[] = [];
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; else passed.push(label); };
const spawnAsync = (cmd: string, args: string[], opts: any): Promise<{ status: number | null; out: string }> => new Promise((res) => { const p = spawn(cmd, args, opts); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ status: code, out })); });

// ── Part A: truth table and precedence ───────────────────────────────────
{
  const A = { listed: { state: "listed", text: "" }, not: { state: "not_listed", text: "" }, unk: { state: "unknown", text: "" } } as const;
  const B = { ok: { state: "correct", text: "" }, bad: { state: "wrong", text: "" }, unk: { state: "unknown", text: "" } } as const;
  const C = { pass: { state: "pass", text: "" }, miss: { state: "miss", text: "" }, fmt: { state: "format", text: "" }, inst: { state: "instrument", text: "" } } as const;
  const table: Array<[any, any, any, string]> = [
    [A.listed, B.ok, C.pass, "#1"], [A.listed, B.ok, C.miss, "#2"], [A.listed, B.bad, C.pass, "#3"], [A.listed, B.bad, C.miss, "#4"],
    [A.not, B.ok, C.pass, "#5"], [A.not, B.ok, C.miss, "#6"], [A.not, B.bad, C.pass, "#7"], [A.not, B.bad, C.miss, "#8"],
  ];
  for (const [a, b, c, code] of table) {
    const j = judgeAttribution({ a, b, c, gtConsistent: true });
    expect(`A ${code}: A=${a.state} B=${b.state} C=${c.state}`, j.code === code && j.text.startsWith(code) && j.counted === true, JSON.stringify(j));
  }
  // every one of the 8 codes appears exactly once
  expect("A truth table covers #1–#8 once each", new Set(table.map((t) => judgeAttribution({ a: t[0], b: t[1], c: t[2], gtConsistent: true }).code)).size === 8);
  const U = (o: any) => judgeAttribution({ a: A.listed, b: B.ok, c: C.pass, gtConsistent: true, ...o });
  expect("A U0 ground truth moved → 未確定（計器）, not counted", U({ gtConsistent: false }).code === "U0" && U({ gtConsistent: false }).text === "未確定（計器）" && U({ gtConsistent: false }).counted === false);
  expect("A U0 wins over everything (A/B unknown, C format)", judgeAttribution({ a: A.unk, b: B.unk, c: C.fmt, gtConsistent: false }).code === "U0");
  expect("A U1 A unknown → 未確定（計器）", U({ a: A.unk }).code === "U1" && U({ a: A.unk }).text === "未確定（計器）");
  expect("A U1 wins over U2/U3", judgeAttribution({ a: A.unk, b: B.unk, c: C.fmt, gtConsistent: true }).code === "U1");
  expect("A U2 B unknown → 未確定（計器）", U({ b: B.unk }).code === "U2");
  expect("A U4 AI instrument → 未確定（計器）", U({ c: C.inst }).code === "U4" && U({ c: C.inst }).text === "未確定（計器）");
  expect("A U3 format violation → 未確定（回答形式）", U({ c: C.fmt }).code === "U3" && U({ c: C.fmt }).text === "未確定（回答形式）");
  expect("A gtConsistent null (not checked) does not block a judgement", U({ gtConsistent: null }).code === "#1");
  // cells (§4-2: "not listed" / "wrong" only with the human attestation check on the row)
  const aObs = (a1: [boolean, boolean, boolean?], a2: [boolean, boolean, boolean?], pass: boolean, inst: string | null = null, rowAttested = false) => ({ method: ATTR_METHODS.A, pass, instrument_error: inst, checks: [{ label: "A1_page_fetched", ok: a1[0] }, { label: "A1_page_lists_sealed_repo", ok: a1[1] }, { label: "A1_page_not_listed_human_attested", ok: Boolean(a1[2]) }, { label: "A2_page_fetched", ok: a2[0] }, { label: "A2_page_lists_sealed_repo", ok: a2[1] }, { label: "A2_page_not_listed_human_attested", ok: Boolean(a2[2]) }, { label: "official_docs_not_listed_human_attested", ok: rowAttested }] });
  expect("A cell: A2 only (A1 read, no link, no attestation)", columnA(aObs([true, false], [true, true], true)).text === "載っている（A1 未確定・A2 あり）", columnA(aObs([true, false], [true, true], true)).text);
  expect("A cell: A2 only, A1 attested", columnA(aObs([true, false, true], [true, true], true)).text === "載っている（A1 なし（人の確認）・A2 あり）");
  expect("A cell: neither page, no attestation → unknown", columnA(aObs([true, false], [true, false], false, "other")).state === "unknown" && columnA(aObs([true, false], [true, false], false, "other")).text === "未確定（A1 未確定・A2 未確定）");
  expect("A cell: both pages attested → not listed, labelled 人の確認", columnA(aObs([true, false, true], [true, false, true], false, null, true)).state === "not_listed" && columnA(aObs([true, false, true], [true, false, true], false, null, true)).text === "載っていない・人の確認（A1 なし（人の確認）・A2 なし（人の確認））");
  expect("A cell: pass=false without the attestation check (any producer) is NOT shown as not listed", columnA({ method: ATTR_METHODS.A, pass: false, instrument_error: null, checks: [] }).state === "unknown");
  expect("A cell: fetch failure = 取得失敗 in the detail, unknown", columnA(aObs([false, false], [true, false], false, "other")).text === "未確定（A1 取得失敗・A2 未確定）", columnA(aObs([false, false], [true, false], false, "other")).text);
  expect("A cell: missing row = unknown", columnA(undefined).state === "unknown");
  const bObs = (pass: boolean, extra: any[] = [], inst: string | null = null) => ({ method: ATTR_METHODS.B, pass, instrument_error: inst, checks: [{ label: "catalog_item_observed", ok: inst !== "unobservable" }, ...extra] });
  expect("B cell: listed in a field", columnB(bObs(true, [{ label: "catalog_item_present", ok: true }, { label: "catalog_field_lists_sealed_repo:connection_guide.repository", ok: true }])).text === "正しい（欄: connection_guide.repository）");
  expect("B cell: item without the repo, attested → 誤り・人の確認（欠落）", columnB(bObs(false, [{ label: "catalog_item_present", ok: true }, { label: "catalog_item_not_listed_human_attested", ok: true }])).text === "誤り・人の確認（欠落）");
  expect("B cell: no item, attested → 誤り・人の確認（項なし）", columnB(bObs(false, [{ label: "catalog_item_present", ok: false }, { label: "catalog_item_not_listed_human_attested", ok: true }])).text === "誤り・人の確認（項なし）");
  expect("B cell: no link, no attestation → 未確定（人の確認なし）", columnB(bObs(false, [{ label: "catalog_item_present", ok: true }], "other")).text === "未確定（人の確認なし）");
  expect("B cell: pass=false without the attestation check is NOT shown as wrong", columnB({ method: ATTR_METHODS.B, pass: false, instrument_error: null, checks: [] }).state === "unknown");
  expect("B cell: a field naming the repo without resolving = 未確定 with the field name", columnB(bObs(false, [{ label: "catalog_item_present", ok: true }, { label: "catalog_field_names_sealed_repo_unresolved:connection_guide.repository", ok: false }], "other")).text === "未確定（名前はあるがリンクとして解けない欄: connection_guide.repository）");
  expect("B cell: unobservable = unknown", columnB({ method: ATTR_METHODS.B, pass: false, instrument_error: "other", checks: [{ label: "catalog_item_observed", ok: false }] }).text === "未確定（観測できない）");
  const cObs = (checks: Array<[string, boolean]>, inst: string | null = null) => ({ method: "llm_answer_rules_vs_sealed_expectation", instrument_error: inst, checks: checks.map(([label, ok]) => ({ label, ok })) });
  expect("C cell: pass", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", true], ["repo_value_is_not_none", true]])).state === "pass");
  expect("C cell: none", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", false], ["repo_value_is_not_none", false]])).text === "外した（none）");
  expect("C cell: other URL", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", false], ["repo_value_is_not_none", true]])).text === "外した（別 URL）");
  expect("C cell: format", columnC(cObs([["answer_region_in_form", false]])).state === "format");
  expect("C cell: instrument", columnC(cObs([], "provider_api")).state === "instrument");
  expect("gtLabel A/B/classic", gtLabel({ method: ATTR_METHODS.A, pass: true }) === "A 公式情報: 載っている" && gtLabel({ method: ATTR_METHODS.B, pass: false, instrument_error: "other" }) === "B KanseiLINK: 未確定" && gtLabel({ method: ATTR_METHODS.A, pass: false, instrument_error: null, checks: [] }) === "A 公式情報: 未確定" && gtLabel({ method: ATTR_METHODS.B, pass: false, instrument_error: null, checks: [{ label: "catalog_item_not_listed_human_attested", ok: true }] }) === "B KanseiLINK: 誤り（人の確認）" && gtLabel({ method: "sealed_repo_vs_github_api", pass: false }) === "不一致");
}

// ── Part A2: the source matcher (yardstick: blaming the other side must be right) ──
{
  const K = "github.com/fake-vendor/fake-official-mcp-server";
  const U0 = "https://github.com/fake-vendor/fake-official-mcp-server";
  const pos = [U0, U0 + "/", U0 + ".git", U0 + ".git/", U0 + "/tree/main", U0 + "/blob/main/README.md", U0 + "#readme", U0 + "?tab=readme-ov-file", U0 + "/tree/main?x=1#y", U0.toUpperCase().replace("HTTPS", "https"), U0 + "/issues/1",
    "http://github.com/fake-vendor/fake-official-mcp-server", "https://www.github.com/fake-vendor/fake-official-mcp-server", "http://www.github.com/fake-vendor/fake-official-mcp-server/tree/main", "github.com/fake-vendor/fake-official-mcp-server", "www.github.com/fake-vendor/fake-official-mcp-server#readme", "//github.com/fake-vendor/fake-official-mcp-server", "https://github.com:443/fake-vendor/fake-official-mcp-server", "github.com:443/fake-vendor/fake-official-mcp-server/blob/main/README.md", "HTTP://WWW.GITHUB.COM/FAKE-VENDOR/FAKE-OFFICIAL-MCP-SERVER"];
  const neg = ["https://evilgithub.com/fake-vendor/fake-official-mcp-server", "https://github.com.evil.example/fake-vendor/fake-official-mcp-server", "https://u@github.com/fake-vendor/fake-official-mcp-server", "https://github.com:8443/fake-vendor/fake-official-mcp-server", "http://github.com:80/fake-vendor/fake-official-mcp-server", "https://github.com:/fake-vendor/fake-official-mcp-server", "https://gist.github.com/fake-vendor/fake-official-mcp-server", "https://api.github.com/repos/fake-vendor/fake-official-mcp-server", "https://www2.github.com/fake-vendor/fake-official-mcp-server", "https://www.gitlab.com/fake-vendor/fake-official-mcp-server", "https:github.com/fake-vendor/fake-official-mcp-server", "https://github.com./fake-vendor/fake-official-mcp-server", "https://github.com:443@evil.example/fake-vendor/fake-official-mcp-server",
    "https://github.com/other-vendor/fake-official-mcp-server", "https://github.com/fake-vendor/other-repo", U0 + "-v2", U0 + "/../../other/other", U0 + "/%2e%2e/other/other", U0 + "\..\other", "https://github.com/fake-vendor", "https://github.com/fake-vendor/.git", "mygithub.com/fake-vendor/fake-official-mcp-server", "github.com.evil.example/fake-vendor/fake-official-mcp-server"];
  for (const u of pos) expect(`A2 (+) source key matches: ${u.slice(19)}`, sourceRepoKey(u) === K, String(sourceRepoKey(u)));
  for (const u of neg) expect(`A2 (−) source key does not match: ${u}`, sourceRepoKey(u) !== K, String(sourceRepoKey(u)));
  expect("A2 decode &amp; &#x2F; &#47; &quot;", decodeHtmlCharRefs("a&amp;b&#x2F;c&#47;d&quot;e") === 'a&b/c/d"e');
  expect("A2 decode once (no double decoding)", decodeHtmlCharRefs("&amp;amp;") === "&amp;");
  expect("A2 decoder is the WHATWG one: unknown names stay, bad code points become U+FFFD, &hyphen; is U+2010", decodeHtmlCharRefs("&bogus; &#0; &#xD800;") === "&bogus; � �" && decodeHtmlCharRefs("&hyphen;&dash;") === "‐‐");
  expect("A2 page with &amp; in the href lists the repo", sourceListsRepo(`<a href="${U0}?a=1&amp;b=2">x</a>`, K, { html: true }));
  expect("A2 page with &#x2F; in the href lists the repo only after decoding", sourceListsRepo(`<a href="https:&#x2F;&#x2F;github.com&#x2F;fake-vendor&#x2F;fake-official-mcp-server">x</a>`, K, { html: true }) && !sourceListsRepo(`<a href="https:&#x2F;&#x2F;github.com&#x2F;fake-vendor&#x2F;fake-official-mcp-server">x</a>`, K));
  expect("A2 a URL inside another URL's query is not the page pointing at the repo", !sourceListsRepo(`<a href="https://evil.example/r?to=${U0}">x</a>`, K, { html: true }));
  // Codex 8d905ee N1: any scheme other than http/https makes the rest (to the next whitespace) opaque
  for (const t of [`data:text/plain,${U0}`, `mailto:a@example.invalid?body=${U0}`, `javascript:open('${U0}')`, `urn:example:${U0}`, `urn://x/${U0}`, `custom-scheme:${U0}`, `Repo:${U0}`])
    expect(`A2 (−) N1 opaque non-http scheme: ${t.slice(0, 28)}…`, !sourceListsRepo(t, K, { html: true }));
  expect("A2 (+) N1 a non-http scheme only hides text up to the next whitespace", sourceListsRepo(`data:text/plain,x ${U0}`, K, { html: true }));
  expect("A2 (+) N1 host:443 is a port, not a scheme", sourceListsRepo("see github.com:443/fake-vendor/fake-official-mcp-server", K));
  expect("A2 (+) N1 an https URL inside is not re-scanned for schemes (query mailto: stays part of it)", sourceListsRepo(`${U0}?next=mailto:x`, K));
  for (const [t, want] of [
    ["公式リポジトリ: github.com/fake-vendor/fake-official-mcp-server を参照", true], ["<a href=\"//github.com/fake-vendor/fake-official-mcp-server\">x</a>", true], ["<a href=//www.github.com/fake-vendor/fake-official-mcp-server>x</a>", true], ["<img src=//github.com/fake-vendor/fake-official-mcp-server/raw/main/x.png>", true],
    ["evil.example/?to=github.com/fake-vendor/fake-official-mcp-server", false], ["evil.example/?to=//github.com/fake-vendor/fake-official-mcp-server", false], ["<a href=\"evil.example/r?to=//github.com/fake-vendor/fake-official-mcp-server\">", false], ["a?to=x&href=//github.com/fake-vendor/fake-official-mcp-server", false],
    ["https://evil.example/github.com/fake-vendor/fake-official-mcp-server", false], ["//evil.example/?to=//github.com/fake-vendor/fake-official-mcp-server", false], ["foo.github.com/fake-vendor/fake-official-mcp-server", false], ["github.com:8443/fake-vendor/fake-official-mcp-server", false],
  ] as const) expect(`A2 text ${want ? "(+)" : "(−)"} ${t.replace("fake-vendor/fake-official-mcp-server", "…")}`, sourceListsRepo(t, K, { html: true }) === want);
}

// ── Part B: end to end on loopback ───────────────────────────────────────
const REPO = "https://github.com/fake-vendor/fake-official-mcp-server";
const mode: Record<string, string> = { a1: "none", a2: "listed", catalog: "no_repo", gh: "ok" };
const page = (m: string) => m === "listed" ? `<html><body><a href="${REPO}">公式 MCP</a></body></html>`
  : m === "listed_fragment" ? `<html><body><a href="${REPO}#readme">公式 MCP</a></body></html>`
  : m === "listed_tree" ? `<html><body><a href="${REPO}/tree/main">公式 MCP</a></body></html>`
  : m === "listed_blob" ? `<html><body><a href="${REPO}/blob/main/README.md#setup">README</a></body></html>`
  : m === "listed_amp" ? `<html><body><a href="${REPO}?tab=readme-ov-file&amp;utm_source=news">公式 MCP</a></body></html>`
  : m === "listed_entities" ? `<html><body><a href="https:&#x2F;&#x2F;github.com&#x2F;fake-vendor&#x2F;fake-official-mcp-server">公式 MCP</a></body></html>`
  : m === "other_repo" ? `<html><body><a href="https://github.com/other/other">x</a></body></html>`
  : m === "other_owner" ? `<html><body><a href="https://github.com/other-vendor/fake-official-mcp-server/tree/main">x</a></body></html>`
  : m === "similar_host" ? `<html><body><a href="https://evilgithub.com/fake-vendor/fake-official-mcp-server">x</a> <a href="https://github.com.evil.example/fake-vendor/fake-official-mcp-server">y</a></body></html>`
  : m === "dot_segments" ? `<html><body><a href="${REPO}/../../other/other">x</a> <a href="${REPO}/%2e%2e/%2E%2E/other/other">y</a></body></html>`
  : m === "repo_prefix" ? `<html><body><a href="${REPO}-v2/tree/main">x</a></body></html>`
  : m === "listed_http_www" ? `<html><body><a href="http://www.github.com/fake-vendor/fake-official-mcp-server">公式 MCP</a></body></html>`
  : m === "listed_bare_text" ? `<html><body><p>リポジトリ: github.com/fake-vendor/fake-official-mcp-server</p></body></html>`
  : m === "listed_protocol_relative" ? `<html><body><a href="//github.com/fake-vendor/fake-official-mcp-server/tree/main">公式 MCP</a></body></html>`
  : m === "listed_port_443" ? `<html><body><a href="https://github.com:443/fake-vendor/fake-official-mcp-server">公式 MCP</a></body></html>`
  : m === "other_port" ? `<html><body><a href="https://github.com:8443/fake-vendor/fake-official-mcp-server">x</a></body></html>`
  : m === "url_in_url_bare" ? `<html><body>evil.example/?to=github.com/fake-vendor/fake-official-mcp-server and evil.example/?to=//github.com/fake-vendor/fake-official-mcp-server</body></html>`
  : m === "gist_host" ? `<html><body><a href="https://gist.github.com/fake-vendor/fake-official-mcp-server">x</a></body></html>`
  : m === "dot_tail" ? `<html><body><a href="${REPO}/..">x</a></body></html>`
  : m === "nested_data" ? `<html><body><a href="data:text/plain,${REPO}">PAGE_CANARY_PRIVATE</a></body></html>`
  : m === "percent_names" ? `<html><body><a href="https://github.com/%66%61%6b%65-vendor/%66%61%6b%65-official-mcp-server">PAGE_CANARY_PRIVATE</a></body></html>`
  : m === "entity_hyphen" ? `<html><body><a href="https://github.com/fake&hyphen;vendor/fake-official-mcp-server">x</a></body></html>` : "<html><body>AI 活用</body></html>";
// the fake catalog item (also used to compute the body a human attests for column B)
const catalogItem = (id: string): any => ({ service_id: id, name: "Fake", mcp_endpoint: "https://<your-host>/mcp", mcp_status: "official", api_auth_method: "oauth2", freshness: { confidence: "medium", data_age_days: Math.floor(Math.random() * 99) }, _meta: { attempt_id: Math.random().toString(36) }, connection_guide: { steps: ["install"] } });
const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const u = req.url || "";
    if (u === "/a1" || u === "/a2") {
      const m = mode[u.slice(1)];
      if (m === "500") { res.writeHead(500); return res.end(); }
      if (m === "404") { res.writeHead(404); return res.end(); }
      // Codex R1: HTTP 200 and the start of a body, then the connection is cut before Content-Length is reached
      if (m === "body_reset") { res.writeHead(200, { "content-type": "text/html", "content-length": "5000" }); res.write("<html><body>AI 活用"); return setTimeout(() => res.destroy(), 50); }
      res.writeHead(200, { "content-type": "text/html" }); return res.end(page(m));
    }
    if (u === "/mcp") {
      const rpc = JSON.parse(body || "{}"); const id = rpc.params?.arguments?.service_id;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const sse = (msg: any) => res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      if (mode.catalog === "rpc_error") return sse({ jsonrpc: "2.0", id: rpc.id, error: { code: -32603, message: "Internal error" } });
      if (mode.catalog === "absent") return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ error: `Service '${id}' not found. Use search_services to find valid service IDs.` }) }] } });
      const item: any = catalogItem(id);
      if (mode.catalog === "repo_in_guide") item.connection_guide.repository = REPO;
      if (mode.catalog === "repo_bare") item.connection_guide.repository = REPO.replace("https://", "");
      if (mode.catalog === "repo_tree") item.connection_guide.setup_url = `${REPO}/tree/main#install`;
      if (mode.catalog === "repo_other_owner") item.connection_guide.setup_url = "https://github.com/other-vendor/fake-official-mcp-server";
      if (mode.catalog === "bracket_relative") item.connection_guide.repository = "[//github.com/fake-vendor/fake-official-mcp-server]";
      if (mode.catalog === "nested_data") item.description = `CATALOG_CANARY_PRIVATE data:text/plain,${REPO}`;
      if (mode.catalog === "percent_names") item.description = "CATALOG_CANARY_PRIVATE https://github.com/%66%61%6b%65-vendor/%66%61%6b%65-official-mcp-server";
      return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(item) }] } });
    }
    if (u === "/gh/repos/fake-vendor/fake-official-mcp-server") {
      if (mode.gh === "404") { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
      if (mode.gh === "hang") return; // never answers: the harness's GitHub timeout must end it (→ U0)
      const d: any = { full_name: "fake-vendor/fake-official-mcp-server", private: false, archived: false };
      if (mode.gh === "renamed") d.full_name = "fake-vendor/fake-mcp-server-v2";
      if (mode.gh === "archived") d.archived = true;
      if (mode.gh === "case") d.full_name = "Fake-Vendor/Fake-Official-MCP-Server";
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(d));
    }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>((r) => server.listen(47336, "127.0.0.1", () => r()));
const tmp = mkdtempSync(join(tmpdir(), "fake-attr-"));
const answersPath = join(tmp, "answers.json");
writeFileSync(answersPath, JSON.stringify({ fake: `説明。\nREPO: ${REPO}\nAUTH: OAuth 2.0` }));
const attDir = join(tmp, "attestations"); mkdirSync(attDir, { recursive: true });
const env = { ...process.env, KANSEI_M994_SEALED_PATH: join(FIX, "M-994.sealed.json"), KANSEI_FAKE_LLM_ANSWERS_FILE: answersPath, KANSEI_FAKE_ATTR_BASE: "http://127.0.0.1:47336", KANSEI_FAKE_ATTESTATIONS_DIR: attDir };
const SEAL_DIGEST = JSON.parse(readFileSync(join(FIX, "taskpack-m994-attribution.json"), "utf-8")).marker.expected_digest;
const pageSha = (m: string) => sha256Hex(Buffer.from(page(m), "utf8"));
const bSha = (payload: any) => sha256Hex(catalogBody(payload));
// write a (valid unless overridden) human attestation for one source and body
function attest(sourceId: string, bodySha: string, over: Record<string, any> = {}, fileSha = bodySha) {
  const a: any = { attestation: "kansei-attribution-not-listed/v1", marker_id: "M-994", expected_digest: SEAL_DIGEST, source_id: sourceId, target: sourceId === "B" ? "fake-catalog: fake-subject" : `http://127.0.0.1:47336/${sourceId.toLowerCase()}`, body_sha256: bodySha, verdict: "not_listed", observer: "human:Smoke Tester", date: "2026-09-29", reason: "read the whole page; no link to the sealed repository", ...over };
  for (const k of Object.keys(over)) if (over[k] === undefined) delete a[k];
  writeFileSync(join(attDir, `M-994-${sourceId}-${fileSha}.json`), JSON.stringify(a));
}
const clearAtt = () => { for (const f of readdirSync(attDir)) rmSync(join(attDir, f)); };
const schema = loadReadingSchema();
async function run(extra: string[] = []) {
  const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m994-attribution.json", "--dry-run", ...extra], { cwd: ROOT, env });
  const m = /evidence: (\S+?)\/ \(manifest/.exec(r.out);
  const bundle = m ? join(ROOT, m[1]) : null;
  const metrics = bundle && existsSync(join(bundle, "metrics.json")) ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : null;
  const rel = bundle ? bundle.slice(ROOT.length + 1).replaceAll("\\", "/") : "none";
  const full = (x: any) => ({ ...x, evidence_ref: `${rel}#sha256:${"a".repeat(64)}` });
  const by = (method: string) => (metrics?.readings || []).filter((x: any) => x.observed.method === method).map(full);
  return { ...r, bundle, metrics, A: by(ATTR_METHODS.A)[0], B: by(ATTR_METHODS.B)[0], agent: by("llm_answer_rules_vs_sealed_expectation")[0], gt: by("sealed_repo_vs_github_api")[0] };
}
const ok = (o: any, label: string) => (o?.checks || []).find((c: any) => c.label === label)?.ok;
// row encoding: pass = listed; instrument_error = unknown; otherwise not listed BY HUMAN ATTESTATION (§4-2)
const stateOf = (o: any) => (!o ? "missing" : o.pass ? "listed" : o.instrument_error ? "unknown" : "not_listed");
// the judgement (規則 v0.1) of one loopback run, as the sheet would print it
const judgeOf = (r: any) => attributionLines([r.A, r.B, r.agent, r.gt].filter(Boolean).map((x: any) => ({ ...x, outcome_id: x.observed.method === "llm_answer_rules_vs_sealed_expectation" ? 1 : null })))[0]?.judgement.code;
let day1: any = null, renamedRun: any = null;
try {
  // (1) the real day-one shape: A1 without, A2 with, catalog item without the repo, repo unchanged
  {
    const r = await run();
    expect("B1 exit 0", r.status === 0, r.out.slice(-500));
    expect("B1 attribution line printed (B unknown: no link, no attestation)", /attribution: A official docs=listed B KanseiLINK catalog=instrument/.test(r.out), r.out.slice(-400));
    expect("B1 A row: pass (A2), A1 false, A2 true", r.A?.observed.pass === true && ok(r.A?.observed, "A1_page_lists_sealed_repo") === false && ok(r.A?.observed, "A2_page_lists_sealed_repo") === true && r.A?.observed.instrument_error === null, JSON.stringify(r.A?.observed));
    expect("B1 B row without an attestation: item present, no link → UNKNOWN (§4-2: the automatic reading never says not listed)", stateOf(r.B?.observed) === "unknown" && ok(r.B?.observed, "catalog_item_present") === true && ok(r.B?.observed, "catalog_item_not_listed_human_attested") === false, JSON.stringify(r.B?.observed));
    expect("B1 judgement without an attestation = U2 (nobody is blamed)", judgeOf(r) === "U2", judgeOf(r));
    const priv = JSON.parse(readFileSync(join(r.bundle!, "environment.private.json"), "utf-8"));
    const bDiag = priv.diagnostics.find((d: any) => d.event === "attribution_source" && d.source_id === "B");
    expect("B1 the private sidecar records B's body sha256 (what a human would attest)", bDiag?.body_sha256 === bSha(catalogItem("fake-subject")) && bDiag?.attestation === "none_for_this_body", JSON.stringify(bDiag));
    // now a human attests B for exactly this body
    attest("B", bSha(catalogItem("fake-subject")));
    const ra = await run(); day1 = ra;
    expect("B1 with a valid human attestation for today's body → B not listed (誤り・人の確認)", stateOf(ra.B?.observed) === "not_listed" && ok(ra.B?.observed, "catalog_item_not_listed_human_attested") === true && validateReading(ra.B, schema).length === 0, JSON.stringify(ra.B?.observed));
    expect("B1 judgement with the attestation = #3 KanseiLINK 側の穴", judgeOf(ra) === "#3", judgeOf(ra));
    expect("B1 the volatile fields (_meta, freshness) do not break the attestation (they are outside the body)", catalogBody(catalogItem("fake-subject")) === catalogBody(catalogItem("fake-subject")));
    // an attestation that does not match exactly is ignored
    for (const [why, over, fileSha] of [
      ["another body (file named for another sha)", {}, "0".repeat(64)],
      ["another seal", { expected_digest: "f".repeat(64) }, undefined],
      ["unsigned draft (extra _draft_instructions key)", { _draft_instructions: "sign me" }, undefined],
      ["placeholder observer", { observer: "human:<名前>" }, undefined],
      ["observer not human", { observer: "claude" }, undefined],
      ["verdict other than not_listed", { verdict: "listed" }, undefined],
      ["missing reason", { reason: undefined }, undefined],
      ["placeholder date", { date: "YYYY-MM-DD" }, undefined],
      ["another source id", { source_id: "A1" }, undefined],
    ] as const) {
      clearAtt(); attest("B", bSha(catalogItem("fake-subject")), over as any, (fileSha as any) ?? bSha(catalogItem("fake-subject")));
      const rx = await run();
      expect(`B1 invalid attestation (${why}) is ignored → B unknown`, stateOf(rx.B?.observed) === "unknown", JSON.stringify(rx.B?.observed.checks));
    }
    clearAtt();
    expect("B1 attribution rows are ground-truth side (model none, done, sealed_ method)", [r.A, r.B].every((x: any) => x?.target.model === "none" && x?.stage_reached === "done" && x?.observed.method.startsWith("sealed_")));
    expect("B1 attribution rows pass reading.v1", [r.A, r.B].every((x: any) => validateReading(x, schema).length === 0), JSON.stringify([r.A, r.B].map((x: any) => validateReading(x, schema))));
    expect("B1 ground truth consistent, no GT row, agent pass", r.agent?.observed.ground_truth_consistent === true && !r.gt && r.agent?.observed.pass === true);
    expect("B1 one agent reading + two attribution rows", r.metrics?.readings?.length === 3, String(r.metrics?.readings?.length));
    expect("B1 manifest fingerprints attribution-rules and all six vendored decoder files", ["lib/attribution-rules.mjs", "vendor/entities-8.1.0/decode.js", "vendor/entities-8.1.0/decode-codepoint.js", "vendor/entities-8.1.0/generated/decode-data-html.js", "vendor/entities-8.1.0/generated/decode-data-xml.js", "vendor/entities-8.1.0/internal/bin-trie-flags.js", "vendor/entities-8.1.0/internal/decode-shared.js"].every((k) => /^[0-9a-f]{64}$/.test(JSON.parse(readFileSync(join(r.bundle!, "manifest.json"), "utf-8")).executor.libs[k] || "")));
    const pub = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(r.bundle!, f), "utf-8")).join("\n");
    expect("B1 no repository value in public files", !/fake-official-mcp-server/.test(pub));
  }
  // (2) catalog names the repo in a field → B true, field NAME recorded
  {
    mode.catalog = "repo_in_guide";
    const r = await run();
    expect("B2 B row pass, field name recorded", r.B?.observed.pass === true && ok(r.B?.observed, "catalog_field_lists_sealed_repo:connection_guide.repository") === true, JSON.stringify(r.B?.observed.checks));
    {
      const { readCatalogDisplay } = await import("../exec-harness/lib/marker-targets.mjs");
      const d0 = await readCatalogDisplay("http://127.0.0.1:47336/mcp", "fake-subject");
      const d1 = await readCatalogDisplay("http://127.0.0.1:47336/mcp", "fake-subject", 20000, { keepPayload: true });
      const { payload, freshness: _f1, ...rest } = d1 as any; const { freshness: _f0, ...rest0 } = d0 as any; // the fake item's freshness moves on every call, like the real one
      expect("B2 keepPayload: default off returns no payload (M-002 unchanged), on returns it, other fields identical", !("payload" in d0) && typeof payload === "object" && JSON.stringify(rest) === JSON.stringify(rest0));
    }
    mode.catalog = "repo_bare";
    const r2 = await run();
    expect("B2 (+) scheme-less github.com/owner/repo in the catalog → B true", r2.B?.observed.pass === true, JSON.stringify(r2.B?.observed.checks));
    mode.catalog = "repo_tree";
    const rtree = await run();
    expect("B2 (+) catalog field with /tree/main#install below the repo → B true, field name recorded", rtree.B?.observed.pass === true && ok(rtree.B?.observed, "catalog_field_lists_sealed_repo:connection_guide.setup_url") === true, JSON.stringify(rtree.B?.observed.checks));
    mode.catalog = "repo_other_owner";
    const rown = await run();
    expect("B2 (−) catalog field naming the repo under another owner → B unknown (name present, does not resolve), field name recorded", stateOf(rown.B?.observed) === "unknown" && ok(rown.B?.observed, "catalog_field_names_sealed_repo_unresolved:connection_guide.setup_url") === false, JSON.stringify(rown.B?.observed.checks));
    mode.catalog = "bracket_relative";
    const rbr = await run();
    expect("B2 (+) Codex R4: catalog field [//github.com/owner/repo] → B listed, judgement #1", stateOf(rbr.B?.observed) === "listed" && judgeOf(rbr) === "#1", `${judgeOf(rbr)} ${JSON.stringify(rbr.B?.observed.checks)}`);
    mode.catalog = "absent";
    const r3 = await run();
    expect("B2 catalog has no item, no attestation → B unknown, catalog_item_present false", stateOf(r3.B?.observed) === "unknown" && ok(r3.B?.observed, "catalog_item_present") === false, JSON.stringify(r3.B?.observed));
    attest("B", bSha({ error: "Service 'fake-subject' not found. Use search_services to find valid service IDs." }));
    const r3a = await run();
    expect("B2 catalog has no item, attested → B not listed (項なし)", stateOf(r3a.B?.observed) === "not_listed" && columnB(r3a.B?.observed).text === "誤り・人の確認（項なし）", JSON.stringify(r3a.B?.observed));
    clearAtt();
    mode.catalog = "rpc_error";
    const r4 = await run();
    expect("B2 catalog unobservable → B instrument", r4.B?.observed.instrument_error === "other" && r4.B?.observed.pass === false && validateReading(r4.B, schema).length === 0);
    mode.catalog = "no_repo";
  }
  // (3) A variants
  {
    mode.a2 = "none";
    const r = await run();
    expect("B3 neither page links the repo, no attestation → A unknown (U1)", stateOf(r.A?.observed) === "unknown" && validateReading(r.A, schema).length === 0 && judgeOf(r) === "U1", `${judgeOf(r)} ${JSON.stringify(r.A?.observed.checks)}`);
    attest("A1", pageSha("none"));
    const rOne = await run();
    expect("B3 only A1 attested (A2 not) → A still unknown", stateOf(rOne.A?.observed) === "unknown" && ok(rOne.A?.observed, "A1_page_not_listed_human_attested") === true && ok(rOne.A?.observed, "A2_page_not_listed_human_attested") === false);
    attest("A2", pageSha("none"));
    const rBoth = await run();
    expect("B3 both pages attested for today's bodies → A not listed (人の確認)", stateOf(rBoth.A?.observed) === "not_listed" && ok(rBoth.A?.observed, "official_docs_not_listed_human_attested") === true && columnA(rBoth.A?.observed).text === "載っていない・人の確認（A1 なし（人の確認）・A2 なし（人の確認））", columnA(rBoth.A?.observed).text);
    mode.a2 = "other_repo";
    const rChanged = await run();
    expect("B3 A2's body changed → its attestation no longer matches → A unknown again", stateOf(rChanged.A?.observed) === "unknown" && ok(rChanged.A?.observed, "A2_page_not_listed_human_attested") === false);
    mode.a2 = "none"; clearAtt();
    // Codex review of 185d63d, the fatal cases, three-valued
    mode.a1 = "body_reset";
    const rbody = await run();
    expect("B3 Codex R1: A1 HTTP 200 but the body is cut off → A1 not fetched, A unknown, judgement U1", stateOf(rbody.A?.observed) === "unknown" && ok(rbody.A?.observed, "A1_page_fetched") === false && rbody.status === 0 && judgeOf(rbody) === "U1", `${judgeOf(rbody)} ${JSON.stringify(rbody.A?.observed.checks)}`);
    mode.a1 = "404";
    const r404 = await run();
    expect("B3 A1 HTTP 404 → A1 not fetched, A unknown", stateOf(r404.A?.observed) === "unknown" && ok(r404.A?.observed, "A1_page_fetched") === false);
    mode.a1 = "dot_tail";
    const rdot = await run();
    expect("B3 Codex R2: a link ending in /.. is not resolvable and names the repo → A unknown, judgement U1", stateOf(rdot.A?.observed) === "unknown" && judgeOf(rdot) === "U1", `${judgeOf(rdot)} ${JSON.stringify(rdot.A?.observed.checks)}`);
    mode.a1 = "entity_hyphen";
    const rhy = await run();
    expect("B3 Codex R3: fake&hyphen;vendor decodes to U+2010 (another owner) and the repo name is present → A unknown, judgement U1", stateOf(rhy.A?.observed) === "unknown" && judgeOf(rhy) === "U1", `${judgeOf(rhy)} ${JSON.stringify(rhy.A?.observed.checks)}`);
    mode.a1 = "none";
    mode.a2 = "listed_fragment";
    const rf = await run();
    expect("B3 (+) a page linking with #readme lists the repo → A true", rf.A?.observed.pass === true, JSON.stringify(rf.A?.observed.checks));
    mode.a2 = "listed_tree";
    const rt = await run();
    expect("B3 (+) a page linking to /tree/main lists the repo → A true", rt.A?.observed.pass === true);
    for (const [m, want, why] of [["listed_blob", true, "(+) /blob/…#setup below the repo"], ["listed_amp", true, "(+) query written with &amp;"], ["listed_entities", true, "(+) href written with &#x2F;"], ["other_owner", false, "(−) same repo name under another owner"], ["similar_host", false, "(−) evilgithub.com / github.com.evil.example"], ["dot_segments", false, "(−) /../ or %2e%2e below the repo leads elsewhere"], ["repo_prefix", false, "(−) repo name with a suffix (-v2)"], ["listed_http_www", true, "(+) http://www.github.com"], ["listed_bare_text", true, "(+) scheme-less github.com/owner/repo in the text"], ["listed_protocol_relative", true, "(+) protocol-relative //github.com in the href"], ["listed_port_443", true, "(+) :443"], ["other_port", false, "(−) :8443"], ["url_in_url_bare", false, "(−) URL inside another URL (scheme-less)"], ["gist_host", false, "(−) gist.github.com is another host"]] as const) {
      mode.a2 = m;
      const rx = await run();
      // three values: a negative whose page still NAMES the owner or repo is unknown (U1), never "not listed"
      const wantState = want ? "listed" : "unknown";
      expect(`B3 ${why} → A ${wantState}`, stateOf(rx.A?.observed) === wantState, JSON.stringify(rx.A?.observed.checks));
    }
    mode.a2 = "other_repo";
    const ro = await run();
    expect("B3 (−) a page naming another repo → A false", ro.A?.observed.pass === false);
    mode.a1 = "500"; mode.a2 = "listed";
    const r2 = await run();
    expect("B3 A1 fails but A2 lists → A true (known), A1 fetched=false", r2.A?.observed.pass === true && r2.A?.observed.instrument_error === null && ok(r2.A?.observed, "A1_page_fetched") === false);
    mode.a2 = "none";
    const r3 = await run();
    expect("B3 A1 fails and A2 does not list → A instrument", r3.A?.observed.instrument_error === "other" && r3.A?.observed.pass === false && validateReading(r3.A, schema).length === 0);
    mode.a1 = "none"; mode.a2 = "listed";
  }
  // (4) rename detection
  {
    mode.gh = "renamed";
    const r = await run(); renamedRun = r;
    expect("B4 renamed (full_name differs) → ground truth inconsistent, GT row written", r.agent?.observed.ground_truth_consistent === false && r.gt?.observed.pass === false && ok(r.gt?.observed, "sealed_repo_full_name_unchanged") === false, JSON.stringify(r.gt?.observed));
    expect("B4 renamed: attribution rows still written for the run", Boolean(r.A && r.B));
    mode.gh = "archived";
    const ra = await run();
    expect("B4 archived → inconsistent, check sealed_repo_not_archived false", ra.agent?.observed.ground_truth_consistent === false && ok(ra.gt?.observed, "sealed_repo_not_archived") === false);
    mode.gh = "404";
    const rn = await run();
    expect("B4 gone (404) → inconsistent", rn.agent?.observed.ground_truth_consistent === false && ok(rn.gt?.observed, "sealed_repo_exists_public_on_github") === false);
    mode.gh = "hang";
    const t0h = Date.now();
    const rh = await run();
    expect("B4 GitHub API never answers → timeout ends it, inconsistent (U0), run completes", rh.status === 0 && rh.agent?.observed.ground_truth_consistent === false && Date.now() - t0h < 60000, `${rh.status} ${Date.now() - t0h}ms`);
    mode.gh = "case";
    const rc = await run();
    expect("B4 full_name differing only in ASCII case is the same repo → consistent", rc.agent?.observed.ground_truth_consistent === true && !rc.gt);
    mode.gh = "ok";
  }
  // (6) Codex 8d905ee end-to-end: N1 (a URL inside a data: URL) and N2 (percent-encoded owner/repo) → A and B unknown, U1
  for (const [m, id] of [["nested_data", "e2e-nested-data"], ["percent_names", "e2e-percent-names"]] as const) {
    mode.a1 = m; mode.a2 = "none"; mode.catalog = m;
    const r = await run();
    expect(`B6 Codex 8d905ee ${id}: A unknown, B unknown, judgement U1`, stateOf(r.A?.observed) === "unknown" && stateOf(r.B?.observed) === "unknown" && judgeOf(r) === "U1", `${stateOf(r.A?.observed)} ${stateOf(r.B?.observed)} ${judgeOf(r)}`);
    const pub = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(r.bundle!, f), "utf-8")).join("\n");
    expect(`B6 Codex 8d905ee ${id}: no page/catalog/answer value in public files`, !/PAGE_CANARY_PRIVATE|CATALOG_CANARY_PRIVATE|fake-official-mcp-server|%66%61%6b%65/.test(pub));
    expect(`B6 Codex 8d905ee ${id}: rows pass reading.v1`, [r.A, r.B, r.agent].every((x: any) => x && validateReading(x, schema).length === 0));
  }
  mode.a1 = "none"; mode.a2 = "listed"; mode.catalog = "no_repo";
  // (5) the empty executor writes no attribution rows (correction runs are refused in --dry-run, so that gate is checked by reading marker-generic)
  {
    const r = await run(["--executor", "empty"]);
    expect("B5 executor=empty → no attribution rows", !r.A && !r.B, r.out.slice(-300));
  }
} finally { server.close(); }

// ── Part C: the sheet from Part B's readings ─────────────────────────────
{
  const toRow = (x: any) => ({ ...x, outcome_id: x.observed.method === "llm_answer_rules_vs_sealed_expectation" ? 1 : null, target_json: JSON.stringify(x.target), observed_json: JSON.stringify(x.observed) });
  const rows = [day1, renamedRun].flatMap((r: any) => [r?.A, r?.B, r?.agent, r?.gt].filter(Boolean)).map(toRow).sort((a: any, b: any) => a.observed_at.localeCompare(b.observed_at));
  const lines = attributionLines(rows);
  expect("C1 two agent readings joined with their own run's A/B rows", lines.length === 2, String(lines.length));
  expect("C1 day-one judgement = #3 KanseiLINK 側の穴", lines[0]?.judgement.code === "#3" && lines[0]?.a.text === "載っている（A1 未確定・A2 あり）" && lines[0]?.b.text === "誤り・人の確認（欠落）" && lines[0]?.c.text === "通過", JSON.stringify(lines[0]));
  expect("C1 renamed run = 未確定（計器）, C not counted", lines[1]?.judgement.code === "U0" && /数えない/.test(lines[1]?.c.text || ""), JSON.stringify(lines[1]));
  const md = renderSheet(rows as any, { markerId: "M-994", now: new Date() });
  expect("C2 sheet has the three columns and the judgement label", md.includes("## 三列と判断（規則 v0.1・臓器1 発見）") && md.includes("| A 公式情報 | B KanseiLINK | C AI（REPO 行） | 判断（規則 v0.1） |"));
  expect("C2 sheet row for day one", md.includes("| 載っている（A1 未確定・A2 あり） | 誤り・人の確認（欠落） | 通過 | #3 KanseiLINK 側の穴（AI は KanseiLINK 以外から到達） |"));
  expect("C2 sheet row for the renamed run prints only 未確定（計器）", /通過（正解側のずれ・数えない） \| 未確定（計器） \|$/m.test(md));
  expect("C2 period tally by observer", md.includes("### 観測者ごとの集計（期間通し・判断（規則 v0.1））") && /\| harness→fake-model \| #3 KanseiLINK 側の穴（AI は KanseiLINK 以外から到達） \| 1 \|/.test(md));
  expect("C2 ground-truth table labels the attribution rows", md.includes("| A 公式情報: 載っている |") && md.includes("| B KanseiLINK: 誤り（人の確認） |"));
  expect("C2 no repository value in the sheet", !/fake-official-mcp-server/.test(md));
  const plain = renderSheet(rows.filter((r: any) => r.outcome_id != null || r.observed.method === "sealed_repo_vs_github_api") as any, { markerId: "M-994" });
  expect("C3 no attribution rows → no attribution section", !plain.includes("三列と判断"));
}

// ── Part D: Codex's 110 independent cases (fixtures/attribution-cases.json) ──
{
  const fx = JSON.parse(readFileSync(join(FIX, "attribution-cases.json"), "utf-8"));
  const S = fx.sealed_fixture;
  expect("D0 110 cases, each with an expectation", fx.cases.length === 110 && fx.cases.every((c: any) => c.expect_state || c.expect_key === null || c.expect_text || c.expect_code || c.expect_codes || c.expect !== undefined));
  for (const c of fx.cases) {
    if (c.kind === "source_text") { const got = classifySource(c.input.text, S, { html: c.input.html }).state; expect(`D ${c.id} → ${c.expect_state}`, got === c.expect_state, got); }
    else if (c.kind === "source_key") expect(`D ${c.id} → no key`, sourceRepoKey(c.input.url) === c.expect_key);
    else if (c.kind === "decoder") expect(`D ${c.id} → WHATWG decoding`, decodeHtmlCharRefs(c.input.text) === c.expect_text);
    else if (c.kind === "truth_table") { const j = judgeAttribution(c.input); expect(`D ${c.id} → ${c.expect_code}`, j.code === c.expect_code, j.code); }
    else if (c.kind === "bundle_join") { const got = attributionLines(c.input).map((l: any) => l.judgement.code); expect(`D ${c.id} → ${c.expect_codes.join(",")}`, JSON.stringify(got) === JSON.stringify(c.expect_codes), JSON.stringify(got)); }
    else if (c.kind === "loopback_equivalent") { const named = c.smoke_case.startsWith("("); expect(`D ${c.id} replayed by "${c.smoke_case}"`, named || passed.some((l) => l.startsWith(c.smoke_case))); }
  }
}

// ── Part E: Codex's 93 independent cases of 8d905ee (fixtures/attribution-cases-8d905ee.json) ──
{
  const fx = JSON.parse(readFileSync(join(FIX, "attribution-cases-8d905ee.json"), "utf-8"));
  const S = fx.sealed;
  expect("E0 93 cases, each with an expectation, verbatim evidence present", fx.cases.length === 93 && fx.cases.every((c: any) => c.expect !== undefined) && existsSync(join(FIX, "evidence", "codex-8d905ee-independent-cases.json")));
  const { TARGETS } = await import("../exec-harness/lib/marker-targets.mjs");
  let ghBody: any = {}; let ghHang = false;
  const gh = createServer((req, res) => { if (ghHang) return; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(ghBody)); });
  await new Promise<void>((r) => gh.listen(47338, "127.0.0.1", () => r()));
  const toState = (c: any) => c.state === "listed" ? "listed" : "unknown";
  const col = (x: string) => ({ state: x });
  try {
    for (const c of fx.cases) {
      if (c.kind === "source_text") { const got = classifySource(c.input.text, c.input.sealed, { html: c.input.html }).state; expect(`E ${c.id} → ${c.expect}`, got === c.expect, got); }
      else if (c.kind === "source_page") { const got = toState(classifySource(c.input.page, S, { html: true })); expect(`E ${c.id} → ${c.expect}`, got === c.expect, got); }
      else if (c.kind === "source_catalog_field") { const got = toState(classifySource(c.input.description, S)); expect(`E ${c.id} → ${c.expect}`, got === c.expect, got); }
      else if (c.kind === "decoder") expect(`E ${c.id} → WHATWG decoding`, decodeHtmlCharRefs(c.input) === c.expect);
      else if (c.kind === "truth_table") { const i = c.input; const j = judgeAttribution({ a: col(i.a), b: col(i.b), c: col(i.c), gtConsistent: i.gt === undefined ? true : i.gt }); expect(`E ${c.id} → ${c.expect}`, j.code === c.expect, j.code); }
      else if (c.kind === "bundle_join") { const got = attributionLines(c.input).map((l: any) => l.judgement.code); expect(`E ${c.id} → ${c.expect}`, got.length === 1 && got[0] === c.expect, JSON.stringify(got)); }
      else if (c.kind === "ground_truth") {
        ghBody = c.input; ghHang = c.codex_id === "gt-timeout";
        const t = await TARGETS.llmAnswer.groundTruth({ MK: { github_api_base: "http://127.0.0.1:47338", github_timeout_ms: 1500 }, sealed: { owner: "acme", name: "widget" }, harnessLog: () => {} });
        expect(`E ${c.id} → consistent=${c.expect}`, t.consistent === c.expect, JSON.stringify(t.checks));
      }
      else if (c.kind === "judgement_from_sources") {
        const a = toState(classifySource(c.input.page, S, { html: true })); const b = toState(classifySource(c.input.description, S));
        const j = judgeAttribution({ a: col(a), b: col(b === "listed" ? "correct" : "unknown"), c: col("pass"), gtConsistent: true });
        expect(`E ${c.id} → ${c.expect}`, j.code === c.expect, j.code);
      }
      else if (c.kind === "loopback_equivalent") {
        const [file, label] = c.smoke_case.split(": ");
        const ok2 = file.endsWith("smoke-marker-attribution.mts") ? passed.some((l) => l.startsWith(c.smoke_case.slice(file.length + 2))) : readFileSync(join(ROOT, file), "utf-8").includes(label);
        expect(`E ${c.id} replayed by "${c.smoke_case}"`, ok2);
      }
    }
  } finally { gh.close(); }
}

console.log(failures === 0 ? "\nmarker attribution smoke: ALL PASS" : `\nmarker attribution smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
