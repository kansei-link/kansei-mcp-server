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
 * Part 2: a copy of the harness WITHOUT vendor/: the M-001 shape (M-998 fixture, fake freee MCP,
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
async function run(pack: string, extra: string[] = []) {
  const r = await spawnAsync(process.execPath, [join(root, "exec-harness", "run-marker.mjs"), pack, "--dry-run", ...extra], { cwd: root, env: baseEnv });
  const m = /evidence: (\S+?)\/ \(manifest/.exec(r.out);
  const bundle = m ? join(root, m[1]) : null;
  const metrics = bundle && existsSync(join(bundle, "metrics.json")) ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : null;
  return { ...r, bundle, metrics, readings: (metrics?.readings || []) as any[] };
}
try {
  // M-001 shape: the freee path (fake MCP, empty executor) — starts and writes its bundle as before
  {
    const r = await run("fixtures/taskpack-m998.json", ["--mcp", `node ${join(FIX, "fake-freee-mcp.mjs").replaceAll("\\", "/")}`, "--executor", "empty"]);
    expect("2 M-001 shape (M-998) starts and completes without vendor/", r.status === 0 && Boolean(r.bundle), r.out.slice(-600));
    expect("2 M-001 shape: no module-resolution error", !/ERR_MODULE_NOT_FOUND|Cannot find module/.test(r.out));
  }
  // M-002 shape: catalog display (the catalog shows 'official' for dead endpoints → pass)
  {
    const r = await run("fixtures/taskpack-m996.json");
    const agent = r.readings.find((x) => x.observed.method === "catalog_display_vs_sealed_expectation");
    expect("2 M-002 shape (M-996) completes without vendor/", r.status === 0 && Boolean(r.bundle), r.out.slice(-600));
    expect("2 M-002 shape: reading as before (done/pass, not an instrument error)", agent?.stage_reached === "done" && agent?.observed.pass === true && agent?.observed.instrument_error === null, JSON.stringify(agent?.observed));
  }
  // M-004 shape: the agent reading is unaffected; only the attribution rows turn into instrument errors
  {
    const r = await run("fixtures/taskpack-m994-attribution.json");
    const agent = r.readings.find((x) => x.observed.method === "llm_answer_rules_vs_sealed_expectation");
    const A = r.readings.find((x) => x.observed.method === "sealed_repo_vs_official_docs");
    const B = r.readings.find((x) => x.observed.method === "sealed_repo_vs_kansei_catalog");
    expect("2 M-004 shape (M-994 + attribution) completes without vendor/ (exit 0)", r.status === 0 && Boolean(r.bundle), r.out.slice(-600));
    expect("2 M-004: the agent reading is unaffected (done/pass by the judge)", agent?.stage_reached === "done" && agent?.observed.pass === true, JSON.stringify(agent?.observed));
    expect("2 M-004: ONLY the attribution rows are instrument errors (A and B, pass=false)", A?.observed.instrument_error === "other" && B?.observed.instrument_error === "other" && A?.observed.pass === false && B?.observed.pass === false, JSON.stringify([A?.observed, B?.observed]));
    expect("2 M-004: the attribution line says instrument", /attribution: A official docs=instrument B KanseiLINK catalog=instrument/.test(r.out), r.out.slice(-400));
    const harness = r.bundle ? readFileSync(join(r.bundle, "harness.jsonl"), "utf-8") : "";
    expect("2 M-004: the public log records attribution_failed only as an event (no message)", /"event":"attribution_failed","ok":false/.test(harness) && !/Cannot find|ERR_MODULE/.test(harness));
  }
  // control: with vendor/ restored the same copy reads A/B again
  {
    cpSync(join(SRC, "exec-harness", "vendor"), join(root, "exec-harness", "vendor"), { recursive: true });
    const r = await run("fixtures/taskpack-m994-attribution.json");
    const A = r.readings.find((x) => x.observed.method === "sealed_repo_vs_official_docs");
    expect("2 control: with vendor/ back, A is read again (listed via A2)", A?.observed.pass === true && A?.observed.instrument_error === null, JSON.stringify(A?.observed));
  }
} finally {
  server.close();
  try { rmSync(root, { recursive: true, force: true }); } catch { /* junction cleanup is best effort */ }
}

console.log(failures === 0 ? "\nmarker optional-parts smoke: ALL PASS" : `\nmarker optional-parts smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
