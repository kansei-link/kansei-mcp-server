#!/usr/bin/env tsx
/**
 * Smoke test: a broken optional part never stops a marker that does not use it.
 *
 *   npx tsx scripts/smoke-marker-optional-parts.mts
 *
 * The attribution columns (M-004) need lib/attribution-rules.mjs and the vendored HTML decoder
 * (exec-harness/vendor/entities-8.1.0). M-001 and M-002 do not. Before this change run-marker.mjs
 * loaded both at start-up (through marker-targets.mjs and marker-persist.mjs), so when a copy of the
 * harness lacked vendor/ every marker failed to start (seen once in smoke-marker-limits).
 *
 * Part 1: the static import graph of every entry point reaches neither attribution-rules.mjs nor
 *         vendor/ — only attribution-labels.mjs, which has no imports at all.
 * Part 2–4 (Codex 8d905ee N3 and P3): a git copy of the harness, first WITHOUT vendor/, then with an
 *         EACCES injected on reading the decoder (fingerprint), then with attribution-rules.mjs broken
 *         (syntax error, missing export). In every case M-001, M-002, M-003 and M-004's agent reading run
 *         exactly as before; only M-004's two attribution rows become instrument errors.
 * Part 2 (first case): a copy of the harness WITHOUT vendor/: the M-001 shape (M-998 fixture, fake freee MCP,
 *         empty executor) and the M-002 shape (M-996 fixture, loopback catalog) dry-run exactly as
 *         before; the M-004 shape (M-994 attribution fixture, fake provider, loopback A/B/GitHub)
 *         still runs, its agent reading is unaffected, and ONLY its two attribution rows become
 *         instrument errors (→ U1/U2).
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
  expect("1 static graph never reaches exec-harness/vendor/", !rel.some((r) => r.startsWith("exec-harness/vendor/")));
  expect("1 attribution-labels.mjs is in the graph (marker-persist, renderer) and has no imports", rel.includes("exec-harness/lib/attribution-labels.mjs") && !/^\s*import\s/m.test(readFileSync(join(SRC, "exec-harness/lib/attribution-labels.mjs"), "utf-8")));
  expect("1 marker-targets.mjs loads attribution-rules.mjs only through a dynamic import", /await import\('\.\/attribution-rules\.mjs'\)/.test(readFileSync(join(SRC, "exec-harness/lib/marker-targets.mjs"), "utf-8")));
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

// loopback on 47331 (the port the M-996 fixture seal names): M-002 catalog + dead endpoints, M-004 A1/A2 + catalog + GitHub API
const REPO = "https://github.com/fake-vendor/fake-official-mcp-server";
const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const u = req.url || "";
    if (u === "/dead-404") { res.writeHead(404); return res.end(); }
    if (u === "/dead-410") { res.writeHead(410); return res.end(); }
    if (u === "/a1") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html><body>AI 活用</body></html>"); }
    if (u === "/a2") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<html><body><a href="${REPO}">公式 MCP</a></body></html>`); }
    if (u === "/mcp") {
      const rpc = JSON.parse(body || "{}"); const id = rpc.params?.arguments?.service_id;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const item = { service_id: id, name: "Fake", mcp_status: "official", freshness: { confidence: "medium" }, connection_guide: { steps: ["install"] } };
      return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(item) }] } })}\n\n`);
    }
    if (u === "/gh/repos/fake-vendor/fake-official-mcp-server") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ full_name: "fake-vendor/fake-official-mcp-server", private: false, archived: false })); }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>((r) => server.listen(47331, "127.0.0.1", () => r()));
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
try {
  // (2) no vendor/ at all
  {
    const { r4 } = await existingMarkersUnaffected("2 without vendor/:");
    const { A, B } = attrRows(r4);
    expect("2 M-004: ONLY the attribution rows are instrument errors (A and B, pass=false)", A?.observed.instrument_error === "other" && B?.observed.instrument_error === "other" && A?.observed.pass === false && B?.observed.pass === false, JSON.stringify([A?.observed, B?.observed]));
    expect("2 M-004: the attribution line says instrument", /attribution: A official docs=instrument B KanseiLINK catalog=instrument/.test(r4.out), r4.out.slice(-400));
    const harness = r4.bundle ? readFileSync(join(r4.bundle, "harness.jsonl"), "utf-8") : "";
    expect("2 M-004: the public log records attribution_failed only as an event (no message)", /"event":"attribution_failed","ok":false/.test(harness) && !/Cannot find|ERR_MODULE/.test(harness));
    expect("2 manifest: the absent optional parts are fingerprinted as null, the run still completes", r4.manifest?.executor?.libs?.["vendor/entities-8.1.0/decode.js"] === null && r4.manifest?.executor?.libs?.["vendor/entities-8.1.0/generated/decode-data-html.js"] === null);
  }
  // (3) control: vendor/ restored
  cpSync(join(SRC, "exec-harness", "vendor"), join(root, "exec-harness", "vendor"), { recursive: true });
  {
    const r2 = await runIn("fixtures/taskpack-m996.json");
    const a2 = r2.readings.find((x) => x.observed.method === "catalog_display_vs_sealed_expectation");
    expect("3 control: with vendor/ back, M-002 completes (done/pass) and all six decoder files are fingerprinted", r2.status === 0 && a2?.observed.pass === true && ["decode.js", "decode-codepoint.js", "generated/decode-data-html.js", "generated/decode-data-xml.js", "internal/bin-trie-flags.js", "internal/decode-shared.js"].every((f) => /^[0-9a-f]{64}$/.test(r2.manifest?.executor?.libs?.[`vendor/entities-8.1.0/${f}`] || "")), JSON.stringify(r2.manifest?.executor?.libs));
    const r4 = await runIn("fixtures/taskpack-m994-attribution.json");
    expect("3 control: with vendor/ back, A is read again (listed via A2)", attrRows(r4).A?.observed.pass === true && attrRows(r4).A?.observed.instrument_error === null, JSON.stringify(attrRows(r4).A?.observed));
  }
  // (3) EACCES while reading the decoder's bytes for the fingerprint (Codex 8d905ee N3)
  {
    const { r2, r4 } = await existingMarkersUnaffected("3 EACCES on the decoder fingerprint:", ["--import", pathToFileURL(preloadEacces).href]);
    expect("3 EACCES: M-002's manifest records the unreadable decoder as null and the bundle is complete", r2.manifest?.executor?.libs?.["vendor/entities-8.1.0/decode.js"] === null && Boolean(r2.metrics));
    const priv = r2.bundle ? JSON.parse(readFileSync(join(r2.bundle, "environment.private.json"), "utf-8")) : {};
    expect("3 EACCES: the private sidecar says which part could not be read", (priv.diagnostics || []).some((d: any) => d.event === "optional_part_unreadable" && d.part === "vendor/entities-8.1.0/decode.js" && d.code === "EACCES"), JSON.stringify(priv.diagnostics));
    const { A, B } = attrRows(r4);
    expect("3 EACCES: M-004 still writes both attribution rows (read, or instrument — never a crash)", Boolean(A && B) && [A, B].every((x: any) => x.observed.pass === true || x.observed.instrument_error === "other" || x.observed.pass === false));
  }
  // (4) a broken optional part: syntax error, then a missing export
  const rules = join(root, "exec-harness", "lib", "attribution-rules.mjs");
  const original = readFileSync(rules, "utf-8");
  for (const [tag, broken] of [["4 syntax error in attribution-rules.mjs:", "export const = ;\n"], ["4 export missing from attribution-rules.mjs:", "export const unrelated = 1;\n"]] as const) {
    writeFileSync(rules, broken);
    const { r4 } = await existingMarkersUnaffected(tag);
    const { A, B } = attrRows(r4);
    expect(`${tag} M-004's attribution rows become instrument errors (U1/U2) and nothing else`, A?.observed.instrument_error === "other" && B?.observed.instrument_error === "other", JSON.stringify([A?.observed, B?.observed]));
  }
  writeFileSync(rules, original);
} finally {
  server.close(); pages.close();
  try { rmSync(root, { recursive: true, force: true }); } catch { /* junction cleanup is best effort */ }
}

console.log(failures === 0 ? "\nmarker optional-parts smoke: ALL PASS" : `\nmarker optional-parts smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
