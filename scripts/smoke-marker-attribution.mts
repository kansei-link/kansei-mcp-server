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
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { columnA, columnB, columnC, judgeAttribution, attributionLines, gtLabel, ATTR_METHODS, sourceRepoKey, sourceListsRepo, decodeHtmlCharRefs } from "../exec-harness/lib/attribution-rules.mjs";
import { renderSheet } from "../exec-harness/render-reading-sheet.mjs";
import { validateReading, loadReadingSchema } from "../exec-harness/lib/reading.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FIX = join(ROOT, "exec-harness", "fixtures");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };
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
  // cells
  const aObs = (a1: [boolean, boolean], a2: [boolean, boolean], pass: boolean, inst: string | null = null) => ({ method: ATTR_METHODS.A, pass, instrument_error: inst, checks: [{ label: "A1_page_fetched", ok: a1[0] }, { label: "A1_page_lists_sealed_repo", ok: a1[1] }, { label: "A2_page_fetched", ok: a2[0] }, { label: "A2_page_lists_sealed_repo", ok: a2[1] }] });
  expect("A cell: A2 only", columnA(aObs([true, false], [true, true], true)).text === "載っている（A1 なし・A2 あり）");
  expect("A cell: neither", columnA(aObs([true, false], [true, false], false)).state === "not_listed");
  expect("A cell: fetch failure without a listing = unknown", columnA(aObs([false, false], [true, false], false, "other")).state === "unknown" && columnA(aObs([false, false], [true, false], false, "other")).text === "取得失敗（A1 取得失敗・A2 なし）");
  expect("A cell: missing row = unknown", columnA(undefined).state === "unknown");
  const bObs = (pass: boolean, extra: any[] = [], inst: string | null = null) => ({ method: ATTR_METHODS.B, pass, instrument_error: inst, checks: [{ label: "catalog_item_observed", ok: !inst }, ...extra] });
  expect("B cell: listed in a field", columnB(bObs(true, [{ label: "catalog_item_present", ok: true }, { label: "catalog_field_lists_sealed_repo:connection_guide.repository", ok: true }])).text === "正しい（欄: connection_guide.repository）");
  expect("B cell: item without the repo = 誤り（欠落）", columnB(bObs(false, [{ label: "catalog_item_present", ok: true }])).text === "誤り（欠落）");
  expect("B cell: no item = 誤り（項なし）", columnB(bObs(false, [{ label: "catalog_item_present", ok: false }])).text === "誤り（項なし）");
  expect("B cell: instrument = unknown", columnB(bObs(false, [], "other")).state === "unknown");
  const cObs = (checks: Array<[string, boolean]>, inst: string | null = null) => ({ method: "llm_answer_rules_vs_sealed_expectation", instrument_error: inst, checks: checks.map(([label, ok]) => ({ label, ok })) });
  expect("C cell: pass", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", true], ["repo_value_is_not_none", true]])).state === "pass");
  expect("C cell: none", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", false], ["repo_value_is_not_none", false]])).text === "外した（none）");
  expect("C cell: other URL", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", false], ["repo_value_is_not_none", true]])).text === "外した（別 URL）");
  expect("C cell: format", columnC(cObs([["answer_region_in_form", false]])).state === "format");
  expect("C cell: instrument", columnC(cObs([], "provider_api")).state === "instrument");
  expect("gtLabel A/B/classic", gtLabel({ method: ATTR_METHODS.A, pass: true }) === "A 公式情報: 載っている" && gtLabel({ method: ATTR_METHODS.B, pass: false, instrument_error: "other" }) === "B KanseiLINK: 計器エラー" && gtLabel({ method: "sealed_repo_vs_github_api", pass: false }) === "不一致");
}

// ── Part A2: the source matcher (yardstick: blaming the other side must be right) ──
{
  const K = "github.com/fake-vendor/fake-official-mcp-server";
  const U0 = "https://github.com/fake-vendor/fake-official-mcp-server";
  const pos = [U0, U0 + "/", U0 + ".git", U0 + ".git/", U0 + "/tree/main", U0 + "/blob/main/README.md", U0 + "#readme", U0 + "?tab=readme-ov-file", U0 + "/tree/main?x=1#y", U0.toUpperCase().replace("HTTPS", "https"), U0 + "/issues/1"];
  const neg = ["https://evilgithub.com/fake-vendor/fake-official-mcp-server", "https://github.com.evil.example/fake-vendor/fake-official-mcp-server", "https://www.github.com/fake-vendor/fake-official-mcp-server", "https://github.com:443/fake-vendor/fake-official-mcp-server", "https://u@github.com/fake-vendor/fake-official-mcp-server",
    "https://github.com/other-vendor/fake-official-mcp-server", "https://github.com/fake-vendor/other-repo", U0 + "-v2", U0 + "/../../other/other", U0 + "/%2e%2e/other/other", U0 + "\..\other", "https://github.com/fake-vendor", "https://github.com/fake-vendor/.git", "github.com/fake-vendor/fake-official-mcp-server"];
  for (const u of pos) expect(`A2 (+) source key matches: ${u.slice(19)}`, sourceRepoKey(u) === K, String(sourceRepoKey(u)));
  for (const u of neg) expect(`A2 (−) source key does not match: ${u}`, sourceRepoKey(u) !== K, String(sourceRepoKey(u)));
  expect("A2 decode &amp; &#x2F; &#47; &quot;", decodeHtmlCharRefs("a&amp;b&#x2F;c&#47;d&quot;e") === 'a&b/c/d"e');
  expect("A2 decode once (no double decoding)", decodeHtmlCharRefs("&amp;amp;") === "&amp;");
  expect("A2 unknown names and bad code points left as they are", decodeHtmlCharRefs("&bogus; &#0; &#xD800;") === "&bogus; &#0; &#xD800;");
  expect("A2 page with &amp; in the href lists the repo", sourceListsRepo(`<a href="${U0}?a=1&amp;b=2">x</a>`, K, { html: true }));
  expect("A2 page with &#x2F; in the href lists the repo only after decoding", sourceListsRepo(`<a href="https:&#x2F;&#x2F;github.com&#x2F;fake-vendor&#x2F;fake-official-mcp-server">x</a>`, K, { html: true }) && !sourceListsRepo(`<a href="https:&#x2F;&#x2F;github.com&#x2F;fake-vendor&#x2F;fake-official-mcp-server">x</a>`, K));
  expect("A2 a URL inside another URL's query is not the page pointing at the repo", !sourceListsRepo(`<a href="https://evil.example/r?to=${U0}">x</a>`, K, { html: true }));
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
  : m === "repo_prefix" ? `<html><body><a href="${REPO}-v2/tree/main">x</a></body></html>` : "<html><body>AI 活用</body></html>";
const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const u = req.url || "";
    if (u === "/a1" || u === "/a2") { const m = mode[u.slice(1)]; if (m === "500") { res.writeHead(500); return res.end(); } res.writeHead(200, { "content-type": "text/html" }); return res.end(page(m)); }
    if (u === "/mcp") {
      const rpc = JSON.parse(body || "{}"); const id = rpc.params?.arguments?.service_id;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const sse = (msg: any) => res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      if (mode.catalog === "rpc_error") return sse({ jsonrpc: "2.0", id: rpc.id, error: { code: -32603, message: "Internal error" } });
      if (mode.catalog === "absent") return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ error: `Service '${id}' not found. Use search_services to find valid service IDs.` }) }] } });
      const item: any = { service_id: id, name: "Fake", mcp_endpoint: "https://<your-host>/mcp", mcp_status: "official", api_auth_method: "oauth2", freshness: { confidence: "medium" }, connection_guide: { steps: ["install"] } };
      if (mode.catalog === "repo_in_guide") item.connection_guide.repository = REPO;
      if (mode.catalog === "repo_bare") item.connection_guide.repository = REPO.replace("https://", "");
      if (mode.catalog === "repo_tree") item.connection_guide.setup_url = `${REPO}/tree/main#install`;
      if (mode.catalog === "repo_other_owner") item.connection_guide.setup_url = "https://github.com/other-vendor/fake-official-mcp-server";
      return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(item) }] } });
    }
    if (u === "/gh/repos/fake-vendor/fake-official-mcp-server") {
      if (mode.gh === "404") { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
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
const env = { ...process.env, KANSEI_M994_SEALED_PATH: join(FIX, "M-994.sealed.json"), KANSEI_FAKE_LLM_ANSWERS_FILE: answersPath, KANSEI_FAKE_ATTR_BASE: "http://127.0.0.1:47336" };
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
let day1: any = null, renamedRun: any = null;
try {
  // (1) the real day-one shape: A1 without, A2 with, catalog item without the repo, repo unchanged
  {
    const r = await run(); day1 = r;
    expect("B1 exit 0", r.status === 0, r.out.slice(-500));
    expect("B1 attribution line printed", /attribution: A official docs=listed B KanseiLINK catalog=not listed/.test(r.out), r.out.slice(-400));
    expect("B1 A row: pass (A2), A1 false, A2 true", r.A?.observed.pass === true && ok(r.A?.observed, "A1_page_lists_sealed_repo") === false && ok(r.A?.observed, "A2_page_lists_sealed_repo") === true && r.A?.observed.instrument_error === null, JSON.stringify(r.A?.observed));
    expect("B1 B row: item present, repo not listed", r.B?.observed.pass === false && ok(r.B?.observed, "catalog_item_present") === true && r.B?.observed.instrument_error === null, JSON.stringify(r.B?.observed));
    expect("B1 attribution rows are ground-truth side (model none, done, sealed_ method)", [r.A, r.B].every((x: any) => x?.target.model === "none" && x?.stage_reached === "done" && x?.observed.method.startsWith("sealed_")));
    expect("B1 attribution rows pass reading.v1", [r.A, r.B].every((x: any) => validateReading(x, schema).length === 0), JSON.stringify([r.A, r.B].map((x: any) => validateReading(x, schema))));
    expect("B1 ground truth consistent, no GT row, agent pass", r.agent?.observed.ground_truth_consistent === true && !r.gt && r.agent?.observed.pass === true);
    expect("B1 one agent reading + two attribution rows", r.metrics?.readings?.length === 3, String(r.metrics?.readings?.length));
    const pub = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(r.bundle!, f), "utf-8")).join("\n");
    expect("B1 no repository value in public files", !/fake-official-mcp-server/.test(pub));
  }
  // (2) catalog names the repo in a field → B true, field NAME recorded
  {
    mode.catalog = "repo_in_guide";
    const r = await run();
    expect("B2 B row pass, field name recorded", r.B?.observed.pass === true && ok(r.B?.observed, "catalog_field_lists_sealed_repo:connection_guide.repository") === true, JSON.stringify(r.B?.observed.checks));
    mode.catalog = "repo_bare";
    const r2 = await run();
    expect("B2 scheme-less value in the catalog is not the canonical form → B false (same normalisation as the REPO line)", r2.B?.observed.pass === false, JSON.stringify(r2.B?.observed.checks));
    mode.catalog = "repo_tree";
    const rtree = await run();
    expect("B2 (+) catalog field with /tree/main#install below the repo → B true, field name recorded", rtree.B?.observed.pass === true && ok(rtree.B?.observed, "catalog_field_lists_sealed_repo:connection_guide.setup_url") === true, JSON.stringify(rtree.B?.observed.checks));
    mode.catalog = "repo_other_owner";
    const rown = await run();
    expect("B2 (−) catalog field naming another owner → B false", rown.B?.observed.pass === false);
    mode.catalog = "absent";
    const r3 = await run();
    expect("B2 catalog has no item → B false (not instrument), catalog_item_present false", r3.B?.observed.pass === false && r3.B?.observed.instrument_error === null && ok(r3.B?.observed, "catalog_item_present") === false);
    mode.catalog = "rpc_error";
    const r4 = await run();
    expect("B2 catalog unobservable → B instrument", r4.B?.observed.instrument_error === "other" && r4.B?.observed.pass === false && validateReading(r4.B, schema).length === 0);
    mode.catalog = "no_repo";
  }
  // (3) A variants
  {
    mode.a2 = "none";
    const r = await run();
    expect("B3 neither page lists → A false (not instrument)", r.A?.observed.pass === false && r.A?.observed.instrument_error === null && validateReading(r.A, schema).length === 0);
    mode.a2 = "listed_fragment";
    const rf = await run();
    expect("B3 (+) a page linking with #readme lists the repo → A true", rf.A?.observed.pass === true, JSON.stringify(rf.A?.observed.checks));
    mode.a2 = "listed_tree";
    const rt = await run();
    expect("B3 (+) a page linking to /tree/main lists the repo → A true", rt.A?.observed.pass === true);
    for (const [m, want, why] of [["listed_blob", true, "(+) /blob/…#setup below the repo"], ["listed_amp", true, "(+) query written with &amp;"], ["listed_entities", true, "(+) href written with &#x2F;"], ["other_owner", false, "(−) same repo name under another owner"], ["similar_host", false, "(−) evilgithub.com / github.com.evil.example"], ["dot_segments", false, "(−) /../ or %2e%2e below the repo leads elsewhere"], ["repo_prefix", false, "(−) repo name with a suffix (-v2)"]] as const) {
      mode.a2 = m;
      const rx = await run();
      expect(`B3 ${why} → A ${want}`, rx.A?.observed.pass === want && rx.A?.observed.instrument_error === null, JSON.stringify(rx.A?.observed.checks));
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
    mode.gh = "case";
    const rc = await run();
    expect("B4 full_name differing only in ASCII case is the same repo → consistent", rc.agent?.observed.ground_truth_consistent === true && !rc.gt);
    mode.gh = "ok";
  }
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
  expect("C1 day-one judgement = #3 KanseiLINK 側の穴", lines[0]?.judgement.code === "#3" && lines[0]?.a.text === "載っている（A1 なし・A2 あり）" && lines[0]?.b.text === "誤り（欠落）" && lines[0]?.c.text === "通過", JSON.stringify(lines[0]));
  expect("C1 renamed run = 未確定（計器）, C not counted", lines[1]?.judgement.code === "U0" && /数えない/.test(lines[1]?.c.text || ""), JSON.stringify(lines[1]));
  const md = renderSheet(rows as any, { markerId: "M-994", now: new Date() });
  expect("C2 sheet has the three columns and the judgement label", md.includes("## 三列と判断（規則 v0.1・臓器1 発見）") && md.includes("| A 公式情報 | B KanseiLINK | C AI（REPO 行） | 判断（規則 v0.1） |"));
  expect("C2 sheet row for day one", md.includes("| 載っている（A1 なし・A2 あり） | 誤り（欠落） | 通過 | #3 KanseiLINK 側の穴（AI は KanseiLINK 以外から到達） |"));
  expect("C2 sheet row for the renamed run prints only 未確定（計器）", /通過（正解側のずれ・数えない） \| 未確定（計器） \|$/m.test(md));
  expect("C2 period tally by observer", md.includes("### 観測者ごとの集計（期間通し・判断（規則 v0.1））") && /\| harness→fake-model \| #3 KanseiLINK 側の穴（AI は KanseiLINK 以外から到達） \| 1 \|/.test(md));
  expect("C2 ground-truth table labels the attribution rows", md.includes("| A 公式情報: 載っている |") && md.includes("| B KanseiLINK: 誤り |"));
  expect("C2 no repository value in the sheet", !/fake-official-mcp-server/.test(md));
  const plain = renderSheet(rows.filter((r: any) => r.outcome_id != null || r.observed.method === "sealed_repo_vs_github_api") as any, { markerId: "M-994" });
  expect("C3 no attribution rows → no attribution section", !plain.includes("三列と判断"));
}

console.log(failures === 0 ? "\nmarker attribution smoke: ALL PASS" : `\nmarker attribution smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
