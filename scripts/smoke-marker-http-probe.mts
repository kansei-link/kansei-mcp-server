#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth=http_probe / observation=catalog_display (M-002 shape).
 *
 *   npx tsx scripts/smoke-marker-http-probe.mts
 *
 * Starts a local server on 127.0.0.1:47331 that plays both roles: the sealed
 * endpoints (/dead-404, /dead-410, /alive) and a fake catalog (/mcp, answering
 * tools/call lookup with a display the test controls). Runs run-marker with the
 * M-996 fixture in --dry-run. No network beyond loopback, no real seal, no DB.
 */
import { spawn, spawnSync } from "node:child_process";
function spawnAsync(cmd: string, args: string[], opts: any): Promise<{ status: number | null; out: string }> {
  return new Promise((res) => { const p = spawn(cmd, args, opts); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ status: code, out })); });
}
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const FIX = join(ROOT, "exec-harness", "fixtures");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };

// display the fake catalog returns per service_id (mutable between cases)
const display: Record<string, { mcp_status: string; confidence: string } | null> = { "fake-dead-one": { mcp_status: "official", confidence: "medium" }, "fake-dead-two": { mcp_status: "official", confidence: "medium" } };
// failure mode of the fake catalog for one service id: rpc_error | tool_error | invalid_payload | other_payload_error | mismatch | null
const failMode: Record<string, string | null> = {};
const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    if (req.url === "/dead-404") { res.writeHead(404); return res.end("gone"); }
    if (req.url === "/dead-410") { res.writeHead(410); return res.end("gone"); }
    if (req.url === "/alive") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "fake" } } })); }
    if (req.url === "/mcp") {
      const rpc = JSON.parse(body || "{}"); const id = rpc.params?.arguments?.service_id; const d = display[id];
      res.writeHead(200, { "content-type": "text/event-stream" });
      const sse = (msg: any) => res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      const mode = failMode[id];
      if (mode === "rpc_error") return sse({ jsonrpc: "2.0", id: rpc.id, error: { code: -32603, message: "Internal error" } });
      if (mode === "tool_error") return sse({ jsonrpc: "2.0", id: rpc.id, result: { isError: true, content: [{ type: "text", text: "database is locked" }] } });
      if (mode === "invalid_payload") return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: "<html>502 Bad Gateway</html>" }] } });
      if (mode === "other_payload_error") return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ error: "Rate limit exceeded. Try again later." }) }] } });
      if (mode === "mismatch") return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ service_id: "someone-else", mcp_status: "official" }) }] } });
      // the real catalog's absence message: "Service '<id>' not found. Use search_services …"
      const payload = d ? { _mode: "detail", service_id: id, mcp_status: d.mcp_status, freshness: { data_age_days: 1, last_refreshed: "2026-09-24", confidence: d.confidence } } : { error: `Service '${id}' not found. Use search_services to find valid service IDs.` };
      return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } });
    }
    res.writeHead(500); res.end();
  });
});
await new Promise<void>((r) => server.listen(47331, "127.0.0.1", () => r()));

async function run(extra: string[] = []) {
  const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m996.json", "--dry-run", ...extra], { cwd: ROOT, env: { ...process.env, KANSEI_M996_SEALED_PATH: join(FIX, "M-996.sealed.json") } });
  const out = r.out;
  const m = /evidence: (\S+?)\/ \(manifest/.exec(out);
  const bundle = m ? join(ROOT, m[1]) : null;
  const metrics = bundle && existsSync(join(bundle, "metrics.json")) ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : null;
  const agent = metrics?.readings?.find((x: any) => x.observed.method === "catalog_display_vs_sealed_expectation");
  const gt = metrics?.readings?.find((x: any) => x.observed.method === "sealed_expectation_vs_harness_http_probe");
  return { status: r.status, out, bundle, metrics, agent, gt };
}

try {
  // (1) dead endpoints, catalog shows 'official' → pass, done, no gt row
  {
    const r = await run();
    expect("(1) exit 0", r.status === 0, r.out.slice(-400));
    expect("(1) kind reported", /kind_of_truth=http_probe observation=catalog_display/.test(r.out));
    expect("(1) agent reading done/pass", r.agent?.stage_reached === "done" && r.agent?.observed.pass === true, JSON.stringify(r.agent?.observed));
    expect("(1) ground truth consistent, no gt row", r.agent?.observed.ground_truth_consistent === true && !r.gt);
    expect("(1) observer is the harness", /^kansei_harness@/.test(r.agent?.observer || ""), r.agent?.observer);
    expect("(1) no trap on generic kinds", r.agent?.observed.trap_armed === false);
  }
  // (2) catalog claims 'verified' for one dead endpoint → understand stop, fail, false completion
  {
    display["fake-dead-two"] = { mcp_status: "verified", confidence: "medium" };
    const r = await run();
    expect("(2) stage_stopped understand", r.agent?.stage_stopped === "understand", JSON.stringify(r.agent?.observed));
    expect("(2) pass=false, false_completion=true", r.agent?.observed.pass === false && r.agent?.observed.false_completion === true);
    expect("(2) per-service check names the second service by index only", r.agent?.observed.checks.some((c: any) => c.label === "service_2_display_not_in_forbidden" && c.ok === false));
    display["fake-dead-two"] = { mcp_status: "official", confidence: "medium" };
  }
  // (3) freshness high counts as 'updated'
  {
    display["fake-dead-one"] = { mcp_status: "official", confidence: "high" };
    const r = await run();
    expect("(3) freshness=high → updated → understand stop", r.agent?.stage_stopped === "understand" && r.agent?.observed.false_completion === true, JSON.stringify(r.agent?.observed));
    display["fake-dead-one"] = { mcp_status: "official", confidence: "medium" };
  }
  // (4) catalog dropped the service (not found) → not a false claim → pass
  {
    display["fake-dead-one"] = null;
    const r = await run();
    expect("(4) service absent from catalog → pass", r.agent?.observed.pass === true, JSON.stringify(r.agent?.observed));
    display["fake-dead-one"] = { mcp_status: "official", confidence: "medium" };
  }
  // (4b) instrument failures must never become "not displayed": each failure mode → instrument, pass=false
  for (const mode of ["rpc_error", "tool_error", "invalid_payload", "other_payload_error", "mismatch"]) {
    failMode["fake-dead-two"] = mode;
    const r = await run();
    expect(`(4b) catalog ${mode} → instrument_error, discover stop, pass=false`, r.agent?.observed.instrument_error === "other" && r.agent?.stage_stopped === "discover" && r.agent?.observed.pass === false && r.agent?.observed.false_completion === false, JSON.stringify(r.agent?.observed));
    expect(`(4b) catalog ${mode} → every_service_observed=false`, r.agent?.observed.checks.some((c: any) => c.label === "every_service_observed" && c.ok === false));
    failMode["fake-dead-two"] = null;
  }
  // (4c) the catalog's genuine not-found is a valid observation (not a false claim)
  {
    display["fake-dead-two"] = null;
    const r = await run();
    expect("(4c) explicit not-found → observed, pass", r.agent?.observed.pass === true && r.agent?.observed.instrument_error === null, JSON.stringify(r.agent?.observed));
    display["fake-dead-two"] = { mcp_status: "official", confidence: "medium" };
  }
  // (5) ground truth drift: sealed endpoint came back alive → gt row pass=false; agent reading still judged
  {
    const seal = JSON.parse(readFileSync(join(FIX, "M-996.sealed.json"), "utf-8"));
    // cannot edit the fixture (fingerprinted) — instead serve /dead-404 alive for this case
    const alive = true; (server as any).__alive = alive;
    server.removeAllListeners("request");
    server.on("request", (req, res) => { let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
      if (req.url === "/dead-404") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })); }
      if (req.url === "/dead-410") { res.writeHead(410); return res.end(); }
      if (req.url === "/mcp") { const rpc = JSON.parse(body || "{}"); const id = rpc.params?.arguments?.service_id; const d = display[id]; const payload = d ? { service_id: id, mcp_status: d.mcp_status, freshness: { confidence: d.confidence } } : { error: "nf" }; res.writeHead(200, { "content-type": "text/event-stream" }); return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } })}\n\n`); }
      res.writeHead(500); res.end(); }); });
    const r = await run();
    expect("(5) gt row written with pass=false", r.gt?.observed.pass === false && r.gt?.observed.method === "sealed_expectation_vs_harness_http_probe", JSON.stringify(r.gt?.observed));
    expect("(5) agent reading carries ground_truth_consistent=false", r.agent?.observed.ground_truth_consistent === false);
    expect("(5) seal has 2 services", seal.expected.services.length === 2);
  }
  // (6) committed-type files carry no endpoint URLs or service ids
  {
    const r = await run();
    const committed = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(r.bundle!, f), "utf-8")).join("\n");
    expect("(6) no endpoint URL or service id in public files", !/127\.0\.0\.1:47331\/dead|fake-dead-one|fake-dead-two/.test(committed));
    expect("(6) non-dry-run refused for fixture (exit 5)", spawnSync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m996.json"], { cwd: ROOT, encoding: "utf-8", env: { ...process.env, KANSEI_M996_SEALED_PATH: join(FIX, "M-996.sealed.json") } }).status === 5);
  }
} finally { (server as any).closeAllConnections?.(); server.close(); }

console.log(failures === 0 ? "\nmarker http-probe smoke: ALL PASS" : `\nmarker http-probe smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
