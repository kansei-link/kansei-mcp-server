#!/usr/bin/env tsx
/**
 * Smoke test: a broken optional part never stops a marker that does not use it.
 *
 *   npx tsx scripts/smoke-marker-optional-parts.mts
 *
 * The attribution columns (M-004) need lib/attribution-attest.mjs (bodies, sha256, human attestations);
 * the automatic reading lib/attribution-rules.mjs and the vendored HTML decoder
 * (exec-harness/vendor/entities-8.1.0) are a private HINT only (§4-2 after Codex review of 7e9a3e2).
 * M-001, M-002 and M-003 need none of them. Before this change run-marker.mjs
 * loaded both at start-up (through marker-targets.mjs and marker-persist.mjs), so when a copy of the
 * harness lacked vendor/ every marker failed to start (seen once in smoke-marker-limits).
 *
 * Part 1: the static import graph of every entry point reaches neither attribution-rules.mjs nor
 *         vendor/ — only attribution-labels.mjs, which has no imports at all.
 * Part 2–4 (Codex 8d905ee N3 and P3; 7e9a3e2 §4-2): a git copy of the harness carrying human
 *         attestations (A1 not listed, A2 listed, B not listed) for the loopback bodies, first WITHOUT
 *         vendor/, then with an EACCES injected on reading the decoder (fingerprint), then with the hint
 *         reader attribution-rules.mjs broken (syntax error, missing export). In every case M-001, M-002,
 *         M-003 and M-004's agent reading run exactly as before AND M-004's attribution rows are exactly
 *         the rows of the intact copy (the hint decides nothing); only the private hint says it was unavailable.
 * Part 5: attribution-attest.mjs itself broken → only M-004's two attribution rows become instrument
 *         errors (→ U1/U2); every other marker and the agent reading are unaffected.
 * --dry-run only, loopback only, no real seal, no DB, no README.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const SRC = resolve(import.meta.dirname, "..");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };
const spawnAsync = (cmd: string, args: string[], opts: any): Promise<{ status: number | null; out: string }> => new Promise((res) => { const p = spawn(cmd, args, opts); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ status: code, out })); });

// ── Part 1: static import graph ──────────────────────────────────────────
{
  const seen = new Set<string>();
  const walk = (f: string) => {
    if (seen.has(f)) return; seen.add(f);
    const s = readFileSync(f, "utf-8");
    for (const m of s.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) walk(resolve(dirname(f), m[1]));
    for (const m of s.matchAll(/^\s*import\s+['"](\.[^'"]+)['"]/gm)) walk(resolve(dirname(f), m[1]));
  };
  for (const entry of ["exec-harness/run-marker.mjs", "exec-harness/render-reading-sheet.mjs", "exec-harness/draft-marker.mjs"]) walk(join(SRC, entry));
  const rel = [...seen].map((f) => relative(SRC, f).replaceAll("\\", "/"));
  expect("1 static graph of run-marker / render-reading-sheet / draft-marker never reaches attribution-rules.mjs", !rel.some((r) => r.endsWith("attribution-rules.mjs")), rel.join(", "));
  expect("1 static graph never reaches attribution-attest.mjs", !rel.some((r) => r.endsWith("attribution-attest.mjs")));
  expect("1 static graph never reaches the M-006 parts (natural-task.mjs, natural-task-rules.mjs, repo-key.mjs)", !rel.some((r) => /(natural-task(-rules)?|repo-key)\.mjs$/.test(r)), rel.join(", "));
  expect("1 static graph never reaches exec-harness/vendor/", !rel.some((r) => r.startsWith("exec-harness/vendor/")));
  expect("1 attribution-labels.mjs is in the graph (marker-persist, renderer) and has no imports", rel.includes("exec-harness/lib/attribution-labels.mjs") && !/^\s*import\s/m.test(readFileSync(join(SRC, "exec-harness/lib/attribution-labels.mjs"), "utf-8")));
  const mt = readFileSync(join(SRC, "exec-harness/lib/marker-targets.mjs"), "utf-8");
  expect("1 marker-targets.mjs loads attribution-rules.mjs only through a dynamic import, inside try/catch (hint only)", /try \{ hints = await import\('\.\/attribution-rules\.mjs'\); \} catch/.test(mt));
  expect("1 marker-targets.mjs loads attribution-attest.mjs only through a dynamic import", /await import\('\.\/attribution-attest\.mjs'\)/.test(mt));
  expect("1 attribution-attest.mjs imports node built-ins only", [...readFileSync(join(SRC, "exec-harness/lib/attribution-attest.mjs"), "utf-8").matchAll(/^\s*import\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].every((m) => m[1].startsWith("node:")));
}

// ── Part 2: a copy of the harness without vendor/ ────────────────────────
const root = mkdtempSync(join(tmpdir(), "marker-optional-"));
mkdirSync(join(root, "exec-harness"), { recursive: true });
for (const item of ["run-marker.mjs", "lib", "schemas", "fixtures"]) cpSync(join(SRC, "exec-harness", item), join(root, "exec-harness", item), { recursive: true });
expect("2 the copy has no vendor/ folder", !existsSync(join(root, "exec-harness", "vendor")));
symlinkSync(join(SRC, "node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
writeFileSync(join(root, "package.json"), '{"type":"module"}');
writeFileSync(join(root, ".gitignore"), "node_modules/\nevidence/\n");
const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
git("init"); git("add", "-A"); git("-c", "user.name=Offline smoke", "-c", "user.email=smoke@example.invalid", "commit", "-q", "-m", "copy without vendor");
git("update-ref", "refs/remotes/origin/offline-test", git("rev-parse", "HEAD").toString().trim());
const FIX = join(root, "exec-harness", "fixtures");
// human attestations for the loopback bodies (evidence/attestations of the copy; the M-994 pack falls back to it)
const { sha256Hex, catalogBody, sourceTarget, ATTESTATION_KIND } = await import(pathToFileURL(join(SRC, "exec-harness/lib/attribution-attest.mjs")).href);
const PACK994 = JSON.parse(readFileSync(join(FIX, "taskpack-m994-attribution.json"), "utf-8"));
const attCfg = JSON.parse(JSON.stringify(PACK994.marker.attribution).replaceAll("${ENV:KANSEI_FAKE_ATTR_BASE}", "http://127.0.0.1:47331"));

// loopback on 47331 (the port the M-996 fixture seal names): M-002 catalog + dead endpoints, M-004 A1/A2 + catalog + GitHub API
const REPO = "https://github.com/fake-vendor/fake-official-mcp-server";
const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const u = req.url || "";
    if (u === "/dead-404") { res.writeHead(404); return res.end(); }
    if (u === "/dead-410") { res.writeHead(410); return res.end(); }
    if (u === "/a1") { res.writeHead(200, { "content-type": "text/html" }); return res.end(A1_BODY); }
    if (u === "/a2") { res.writeHead(200, { "content-type": "text/html" }); return res.end(A2_BODY); }
    if (u === "/mcp") {
      const rpc = JSON.parse(body || "{}"); const id = rpc.params?.arguments?.service_id;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const item = B_ITEM(id);
      return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(item) }] } })}\n\n`);
    }
    if (u === "/gh/repos/fake-vendor/fake-official-mcp-server") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ full_name: "fake-vendor/fake-official-mcp-server", private: false, archived: false })); }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>((r) => server.listen(47331, "127.0.0.1", () => r()));
const A1_BODY = "<html><body>AI 活用</body></html>";
const A2_BODY = `<html><body><a href="${REPO}">公式 MCP</a></body></html>`;
const B_ITEM = (id: string) => ({ service_id: id, name: "Fake", mcp_status: "official", freshness: { confidence: "medium" }, connection_guide: { steps: ["install"] } });
const attDir = join(root, "evidence", "attestations"); mkdirSync(attDir, { recursive: true });
writeFileSync(join(attDir, "observers.json"), JSON.stringify(["human:smoke-fixture"])); // the copy's allow-list of observers
for (const [source, body, verdict] of [["A1", A1_BODY, "not_listed"], ["A2", A2_BODY, "listed"], ["B", catalogBody(B_ITEM("fake-subject")), "not_listed"]] as const) {
  const sha = sha256Hex(Buffer.from(body, "utf8"));
  writeFileSync(join(attDir, `M-994-${source}-${sha}.json`), JSON.stringify({ attestation: ATTESTATION_KIND, marker_id: "M-994", expected_digest: PACK994.marker.expected_digest, source_id: source, target: sourceTarget(attCfg, source), body_sha256: sha, verdict, observer: "human:smoke-fixture", date: "2026-09-29", reason: "fixture: the whole loopback body was read" }));
}
const answers = join(root, "answers.json");
writeFileSync(answers, JSON.stringify({ fake: `説明。\nREPO: ${REPO}\nAUTH: OAuth 2.0` }));
const baseEnv = { ...process.env, KANSEI_M998_SEALED_PATH: join(FIX, "M-998.sealed.json"), KANSEI_M996_SEALED_PATH: join(FIX, "M-996.sealed.json"), KANSEI_M994_SEALED_PATH: join(FIX, "M-994.sealed.json"), KANSEI_FAKE_LLM_ANSWERS_FILE: answers, KANSEI_FAKE_ATTR_BASE: "http://127.0.0.1:47331", FAKE_FREEE_STATE_FILE: join(root, "fake-freee-state.json") };
// M-003 shape: the fetch-check summary (loopback pages on 47332, the port the M-995 fixture seal names)
const PAGES: Record<string, string> = {
  "/agent-wiki/": "<html><head><title>Fake Agent Wiki index</title></head><body>fixture</body></html>\n",
  "/agent-wiki/services/square.html": "<html><head><title>Fake Square guide</title></head><body>fixture</body></html>\n",
  "/insights/control.html": "<html><head><title>Fake control article</title></head><body>fixture</body></html>\n",
};
const pages = createServer((req, res) => { const b = PAGES[req.url || ""]; if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(b); });
await new Promise<void>((r) => pages.listen(47332, "127.0.0.1", () => r()));
const TODAY = new Date().toISOString().slice(0, 10);
const summaryPath = join(root, "fetch-summary.json");
const cell = { status: "fetched", error: null, snippet: "…" };
writeFileSync(summaryPath, JSON.stringify({ date: TODAY, run_at: `${TODAY}T00:00:01.000Z`, agents: { claude: "claude-opus-5", codex: "gpt-6-astra" }, cli_versions: { claude: "9.9.9 (Claude Code)", codex: "codex-cli 0.0.1" }, checks: { "fetch-index": { claude: cell, codex: cell }, "fetch-square": { claude: cell, codex: cell }, "fetch-control-insights": { claude: cell, codex: cell } } }));
// preload that makes reading the vendored decoder's bytes fail with EACCES (Codex 8d905ee N3 injection)
const preloadEacces = join(root, "preload-eacces.mjs");
writeFileSync(preloadEacces, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...a) {
  const s = String(p && p.href ? p.href : p).replaceAll('\\\\', '/');
  if (s.endsWith('vendor/entities-8.1.0/decode.js')) { const e = new Error('Injected EACCES for the optional decoder fingerprint'); e.code = 'EACCES'; throw e; }
  return orig.call(this, p, ...a);
};
syncBuiltinESMExports();
`);
const withEnv = { ...baseEnv, KANSEI_M995_SEALED_PATH: join(FIX, "M-995.sealed.json") };
async function runIn(pack: string, extra: string[] = [], nodeArgs: string[] = []) {
  const r = await spawnAsync(process.execPath, [...nodeArgs, join(root, "exec-harness", "run-marker.mjs"), pack, "--dry-run", ...extra], { cwd: root, env: withEnv });
  const m = /evidence: (\S+?)\/ \(manifest/.exec(r.out);
  const bundle = m ? join(root, m[1]) : null;
  const metrics = bundle && existsSync(join(bundle, "metrics.json")) ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : null;
  const manifest = bundle && existsSync(join(bundle, "manifest.json")) ? JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf-8")) : null;
  return { ...r, bundle, metrics, manifest, readings: (metrics?.readings || []) as any[] };
}
const FAKE_MCP = `node ${join(FIX, "fake-freee-mcp.mjs").replaceAll("\\", "/")}`;
/** M-001, M-002, M-003 must run exactly as before; M-004's agent reading must be unaffected. */
async function existingMarkersUnaffected(tag: string, nodeArgs: string[] = []) {
  const r1 = await runIn("fixtures/taskpack-m998.json", ["--mcp", FAKE_MCP, "--executor", "empty"], nodeArgs);
  expect(`${tag} M-001 shape (M-998) starts and completes`, r1.status === 0 && Boolean(r1.bundle) && !/ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/.test(r1.out), r1.out.slice(-500));
  const r2 = await runIn("fixtures/taskpack-m996.json", [], nodeArgs);
  const a2 = r2.readings.find((x) => x.observed.method === "catalog_display_vs_sealed_expectation");
  expect(`${tag} M-002 shape (M-996) completes, reading as before (done/pass)`, r2.status === 0 && Boolean(r2.bundle) && a2?.stage_reached === "done" && a2?.observed.pass === true && a2?.observed.instrument_error === null, r2.out.slice(-500));
  const r3 = await runIn("fixtures/taskpack-m995.json", ["--fetch-summary", summaryPath], nodeArgs);
  const obs3 = r3.readings.filter((x) => x.observed.method === "agent_fetch_vs_sealed_body_digest");
  expect(`${tag} M-003 shape (M-995 fetch-check) completes, both observers done/pass`, r3.status === 0 && obs3.length === 2 && obs3.every((x) => x.stage_reached === "done" && x.observed.pass === true), `${r3.status} ${obs3.length} ${r3.out.slice(-400)}`);
  const r4 = await runIn("fixtures/taskpack-m994-attribution.json", [], nodeArgs);
  const agent = r4.readings.find((x) => x.observed.method === "llm_answer_rules_vs_sealed_expectation");
  expect(`${tag} M-004 shape completes, its agent reading unaffected (done/pass)`, r4.status === 0 && agent?.stage_reached === "done" && agent?.observed.pass === true, r4.out.slice(-500));
  return { r1, r2, r3, r4 };
}
const attrRows = (r: any) => ({ A: r.readings.find((x: any) => x.observed.method === "sealed_repo_vs_official_docs"), B: r.readings.find((x: any) => x.observed.method === "sealed_repo_vs_kansei_catalog") });
// the attested rows of the intact harness: A listed (A2 attested listed), B not listed (attested) — fixed here, compared below
const WANT_A = { pass: true, instrument_error: null, checks: [["A1_page_fetched", true], ["A1_attested_listed", false], ["A1_attested_not_listed", true], ["A1_needs_recheck", false], ["A2_page_fetched", true], ["A2_attested_listed", true], ["A2_attested_not_listed", false], ["A2_needs_recheck", false], ["official_docs_attested_listed", true], ["official_docs_attested_not_listed", false]] };
const WANT_B = { pass: false, instrument_error: null, checks: [["catalog_item_observed", true], ["catalog_body_fields_fixed", true], ["catalog_item_present", true], ["catalog_item_attested_listed", false], ["catalog_item_attested_not_listed", true], ["catalog_item_needs_recheck", false]] };
const same = (o: any, w: any) => o && o.pass === w.pass && o.instrument_error === w.instrument_error && JSON.stringify(o.checks.map((c: any) => [c.label, c.ok])) === JSON.stringify(w.checks);
const hintOf = (r: any) => { const priv = r.bundle ? JSON.parse(readFileSync(join(r.bundle, "environment.private.json"), "utf-8")) : {}; return (priv.diagnostics || []).filter((d: any) => d.event === "attribution_source").map((d: any) => d.hint?.reason); };
try {
  // (2) no vendor/ at all
  {
    const { r4 } = await existingMarkersUnaffected("2 without vendor/:");
    const { A, B } = attrRows(r4);
    expect("2 M-004: the attribution rows are exactly the attested rows (the hint reader's absence changes nothing)", same(A?.observed, WANT_A) && same(B?.observed, WANT_B), JSON.stringify([A?.observed, B?.observed]));
    expect("2 M-004: the attribution line reports the attested states", /attribution: A official docs=listed B KanseiLINK catalog=not listed/.test(r4.out), r4.out.slice(-400));
    expect("2 M-004: the private hint says the hint reader was unavailable (A1, A2, B)", JSON.stringify(hintOf(r4)) === JSON.stringify(["hint_reader_unavailable", "hint_reader_unavailable", "hint_reader_unavailable"]), JSON.stringify(hintOf(r4)));
    const harness = r4.bundle ? readFileSync(join(r4.bundle, "harness.jsonl"), "utf-8") : "";
    expect("2 M-004: no attribution_failed event, no module error in the public log", !/attribution_failed/.test(harness) && !/Cannot find|ERR_MODULE/.test(harness));
    expect("2 manifest: the absent optional parts are fingerprinted as null, the run still completes", r4.manifest?.executor?.libs?.["vendor/entities-8.1.0/decode.js"] === null && r4.manifest?.executor?.libs?.["vendor/entities-8.1.0/generated/decode-data-html.js"] === null);
  }
  // (3) control: vendor/ restored
  cpSync(join(SRC, "exec-harness", "vendor"), join(root, "exec-harness", "vendor"), { recursive: true });
  {
    const r2 = await runIn("fixtures/taskpack-m996.json");
    const a2 = r2.readings.find((x) => x.observed.method === "catalog_display_vs_sealed_expectation");
    expect("3 control: with vendor/ back, M-002 completes (done/pass) and all six decoder files are fingerprinted", r2.status === 0 && a2?.observed.pass === true && ["decode.js", "decode-codepoint.js", "generated/decode-data-html.js", "generated/decode-data-xml.js", "internal/bin-trie-flags.js", "internal/decode-shared.js"].every((f) => /^[0-9a-f]{64}$/.test(r2.manifest?.executor?.libs?.[`vendor/entities-8.1.0/${f}`] || "")), JSON.stringify(r2.manifest?.executor?.libs));
    const r4 = await runIn("fixtures/taskpack-m994-attribution.json");
    expect("3 control: with vendor/ back, the attribution rows are the same attested rows", same(attrRows(r4).A?.observed, WANT_A) && same(attrRows(r4).B?.observed, WANT_B), JSON.stringify(attrRows(r4)));
    expect("3 control: with vendor/ back, the private hint is computed again", hintOf(r4).length === 3 && hintOf(r4).every((x: any) => typeof x === "string" && x !== "hint_reader_unavailable"), JSON.stringify(hintOf(r4)));
  }
  // (3) EACCES while reading the decoder's bytes for the fingerprint (Codex 8d905ee N3)
  {
    const { r2, r4 } = await existingMarkersUnaffected("3 EACCES on the decoder fingerprint:", ["--import", pathToFileURL(preloadEacces).href]);
    expect("3 EACCES: M-002's manifest records the unreadable decoder as null and the bundle is complete", r2.manifest?.executor?.libs?.["vendor/entities-8.1.0/decode.js"] === null && Boolean(r2.metrics));
    const priv = r2.bundle ? JSON.parse(readFileSync(join(r2.bundle, "environment.private.json"), "utf-8")) : {};
    expect("3 EACCES: the private sidecar says which part could not be read", (priv.diagnostics || []).some((d: any) => d.event === "optional_part_unreadable" && d.part === "vendor/entities-8.1.0/decode.js" && d.code === "EACCES"), JSON.stringify(priv.diagnostics));
    const { A, B } = attrRows(r4);
    expect("3 EACCES: M-004's attribution rows are exactly the attested rows", same(A?.observed, WANT_A) && same(B?.observed, WANT_B), JSON.stringify([A?.observed, B?.observed]));
  }
  // (4) a broken optional part: syntax error, then a missing export
  const rules = join(root, "exec-harness", "lib", "attribution-rules.mjs");
  const original = readFileSync(rules, "utf-8");
  for (const [tag, broken] of [["4 syntax error in attribution-rules.mjs:", "export const = ;\n"], ["4 export missing from attribution-rules.mjs:", "export const unrelated = 1;\n"]] as const) {
    writeFileSync(rules, broken);
    const { r4 } = await existingMarkersUnaffected(tag);
    const { A, B } = attrRows(r4);
    expect(`${tag} M-004's attribution rows are exactly the attested rows (the hint decides nothing)`, same(A?.observed, WANT_A) && same(B?.observed, WANT_B), JSON.stringify([A?.observed, B?.observed]));
    const want = tag.includes("syntax") ? "hint_reader_unavailable" : "hint_failed"; // cannot load vs loads without classifySource
    expect(`${tag} the private hint says ${want}`, hintOf(r4).length === 3 && hintOf(r4).every((x: any) => x === want), JSON.stringify(hintOf(r4)));
  }
  writeFileSync(rules, original);
  // (5) the attestation part itself broken → only M-004's attribution rows are instrument errors
  const attest = join(root, "exec-harness", "lib", "attribution-attest.mjs");
  const attestOriginal = readFileSync(attest, "utf-8");
  writeFileSync(attest, "export const = ;\n");
  {
    const { r4 } = await existingMarkersUnaffected("5 syntax error in attribution-attest.mjs:");
    const { A, B } = attrRows(r4);
    expect("5 M-004: ONLY the attribution rows are instrument errors (A and B, pass=false → U1/U2)", A?.observed.instrument_error === "other" && B?.observed.instrument_error === "other" && A?.observed.pass === false && B?.observed.pass === false, JSON.stringify([A?.observed, B?.observed]));
    expect("5 M-004: the attribution line says unknown", /attribution: A official docs=unknown B KanseiLINK catalog=unknown/.test(r4.out), r4.out.slice(-400));
    const harness = r4.bundle ? readFileSync(join(r4.bundle, "harness.jsonl"), "utf-8") : "";
    expect("5 M-004: the public log records attribution_failed only as an event (no message)", /"event":"attribution_failed","ok":false/.test(harness) && !/SyntaxError|Unexpected/.test(harness));
    expect("5 manifest: the unparsable attribution-attest.mjs is still fingerprinted (its bytes are readable)", /^[0-9a-f]{64}$/.test(r4.manifest?.executor?.libs?.["lib/attribution-attest.mjs"] || ""));
  }
  writeFileSync(attest, attestOriginal);
} finally {
  server.close(); pages.close();
  try { rmSync(root, { recursive: true, force: true }); } catch { /* junction cleanup is best effort */ }
}

console.log(failures === 0 ? "\nmarker optional-parts smoke: ALL PASS" : `\nmarker optional-parts smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
