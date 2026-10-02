#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth=http_probe / observation=fetch_check_summary (M-003 shape).
 *
 *   npx tsx scripts/smoke-marker-fetch-check.mts
 *
 * Local server on 127.0.0.1:47332 (the port the M-995 fixture seal names; KANSEI_SMOKE_PORT_B moves it, see
 * smoke-loopback-ports.mjs) serves three fixed pages (digests sealed in the
 * M-995 fixture). A fake fetch-check summary JSON (same shape as
 * founder-ops/.../fetch-check/<date>.json) plays the two agents. --dry-run only.
 */
import { spawn, spawnSync } from "node:child_process";
function spawnAsync(cmd: string, args: string[], opts: any): Promise<{ status: number | null; out: string }> {
  return new Promise((res) => { const p = spawn(cmd, args, opts); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ status: code, out })); });
}
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { smokePorts } from "./smoke-loopback-ports.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PORTS = smokePorts();
const FIX = join(ROOT, "exec-harness", "fixtures");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };

const PAGES: Record<string, string> = {
  "/agent-wiki/": "<html><head><title>Fake Agent Wiki index</title></head><body>fixture</body></html>\n",
  "/agent-wiki/services/square.html": "<html><head><title>Fake Square guide</title></head><body>fixture</body></html>\n",
  "/insights/control.html": "<html><head><title>Fake control article</title></head><body>fixture</body></html>\n",
};
let mutateIndex = false;
const server = createServer((req, res) => {
  const body = PAGES[req.url || ""];
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(mutateIndex && req.url === "/agent-wiki/" ? body.replace("fixture", "edited") : body);
});
await new Promise<void>((r) => server.listen(PORTS.B, "127.0.0.1", () => r()));

const tmp = mkdtempSync(join(tmpdir(), "fetch-check-"));
const TODAY = new Date().toISOString().slice(0, 10);
function summary(cells: Record<string, Record<string, string | { status: string; date?: string }>>, cli: Record<string, string> = { claude: "9.9.9 (Claude Code)", codex: "codex-cli 0.0.1" }, date = TODAY, runAt?: string, agents: Record<string, string> = { claude: "claude-opus-5", codex: "gpt-6-astra" }) {
  const p = join(tmp, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  const checks: any = {};
  for (const [id, byAgent] of Object.entries(cells)) { checks[id] = {}; for (const [agent, v] of Object.entries(byAgent)) checks[id][agent] = typeof v === "string" ? { status: v, error: null, snippet: "…" } : { status: v.status, date: v.date, error: null, snippet: "…" }; }
  writeFileSync(p, JSON.stringify({ date, run_at: runAt ?? `${date}T00:00:01.000Z`, agents, cli_versions: cli, checks }));
  return p;
}
async function run(summaryPath: string, extra: string[] = []) {
  const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m995.json", "--dry-run", "--fetch-summary", summaryPath, ...extra], { cwd: ROOT, env: { ...process.env, KANSEI_M995_SEALED_PATH: join(FIX, "M-995.sealed.json"), ...PORTS.childEnv } });
  const out = r.out;
  const m = /evidence: (\S+?)\/ \(manifest/.exec(out);
  const bundle = m ? join(ROOT, m[1]) : null;
  const metrics = bundle && existsSync(join(bundle, "metrics.json")) ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : null;
  const manifest = bundle && existsSync(join(bundle, "manifest.json")) ? JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf-8")) : null;
  const by = (obs: string) => metrics?.readings?.find((x: any) => x.observer.startsWith(obs));
  return { status: r.status, out, bundle, metrics, manifest, claude: by("claude-code@"), codex: by("codex@"), gt: metrics?.readings?.find((x: any) => x.observed.method === "sealed_expectation_vs_harness_http_probe") };
}

try {
  // (1) both agents fetched everything → two readings, both done; digests match → no gt row
  {
    const r = await run(summary({ "fetch-index": { claude: "fetched", codex: "fetched" }, "fetch-square": { claude: "fetched", codex: "fetched" }, "fetch-control-insights": { claude: "fetched", codex: "fetched" } }));
    expect("(1) exit 0", r.status === 0, r.out.slice(-400));
    expect("(1) two agent readings", !!r.claude && !!r.codex, JSON.stringify(r.metrics?.readings?.map((x: any) => x.observer)));
    expect("(1) observer carries CLI version", r.claude?.observer === "claude-code@9.9.9" && r.codex?.observer === "codex@0.0.1", `${r.claude?.observer} ${r.codex?.observer}`);
    expect("(1) target.model from summary", r.claude?.target.model === "claude-opus-5");
    expect("(1) both done/pass", r.claude?.stage_reached === "done" && r.codex?.stage_reached === "done" && r.claude?.observed.pass && r.codex?.observed.pass);
    expect("(1) ground truth consistent, no gt row", r.claude?.observed.ground_truth_consistent === true && !r.gt);
  }
  // (1b) Codex review 3 of 79e624d, F6: the public model grammar of M-006 must not touch M-003. The model an agent
  //      reports is recorded as it is (85b768a): target.model, metrics.runs[].model, manifest.models and the outcome row's
  //      model_name (the same variable in marker-generic) — "Claude Sonnet 4" and "claude/sonnet-4" stay, never "none".
  {
    const all = { "fetch-index": { claude: "fetched", codex: "fetched" }, "fetch-square": { claude: "fetched", codex: "fetched" }, "fetch-control-insights": { claude: "fetched", codex: "fetched" } };
    const r = await run(summary(all, undefined, TODAY, undefined, { claude: "Claude Sonnet 4", codex: "claude/sonnet-4" }));
    expect("(1b) F6 exit 0", r.status === 0, r.out.slice(-400));
    expect("(1b) F6 target.model is the reported value as it is (85b768a): \"Claude Sonnet 4\" / \"claude/sonnet-4\"", r.claude?.target.model === "Claude Sonnet 4" && r.codex?.target.model === "claude/sonnet-4", `${r.claude?.target.model} ${r.codex?.target.model}`);
    expect("(1b) F6 metrics.runs[].model and manifest.models carry the same values", JSON.stringify(r.metrics?.runs?.map((x: any) => x.model)) === JSON.stringify(["Claude Sonnet 4", "claude/sonnet-4"]) && JSON.stringify(Object.values(r.manifest?.models || {})) === JSON.stringify(["Claude Sonnet 4", "claude/sonnet-4"]), JSON.stringify([r.metrics?.runs, r.manifest?.models]));
    expect("(1b) F6 no setup on M-003 rows; observer string and CLI version as before", !r.claude?.target.setup && r.claude?.observer === "claude-code@9.9.9" && r.codex?.observer === "codex@0.0.1");
    const gen = readFileSync(join(ROOT, "exec-harness", "lib", "marker-generic.mjs"), "utf-8");
    expect("(1b) F6 the outcome row's model_name is the same variable as target.model; the grammar applies only under observer.setup", ["model_name: model,", "target: { service_id: PACK.service_id, model,", "if (observer.setup) {", "const pm = publicModel(obs.model,", "model = obs.model || observer.model || observer.provider || 'none';"].every((s) => gen.includes(s)) && gen.indexOf("if (observer.setup) {") < gen.indexOf("const pm = publicModel(obs.model,"));
  }
  // (2) codex denied on wiki pages but fetched control → codex stops at discover; claude done
  {
    const r = await run(summary({ "fetch-index": { claude: "fetched", codex: "denied" }, "fetch-square": { claude: "fetched", codex: "denied" }, "fetch-control-insights": { claude: "fetched", codex: "fetched" } }));
    expect("(2) codex stage_stopped discover", r.codex?.stage_stopped === "discover" && r.codex?.observed.pass === false, JSON.stringify(r.codex?.observed));
    expect("(2) ⑤ denied is the agent's own undetermined (exclusive: not fc, not instrument)", r.codex?.observed.undetermined === true && r.codex?.observed.false_completion === false && r.codex?.observed.instrument_error === null);
    expect("(2) codex control page recorded as fetched", r.codex?.observed.checks.some((c: any) => c.label === "page_3_control_fetched" && c.ok === true));
    expect("(2) claude still done", r.claude?.stage_reached === "done");
  }
  // (3) unclear → understand; error → instrument
  {
    const r = await run(summary({ "fetch-index": { claude: "unclear", codex: "error" }, "fetch-square": { claude: "fetched", codex: "fetched" }, "fetch-control-insights": { claude: "fetched", codex: "fetched" } }));
    expect("(3) claude unclear → understand", r.claude?.stage_stopped === "understand", JSON.stringify(r.claude?.observed));
    expect("(3) codex error → instrument_error", r.codex?.observed.instrument_error === "other" && r.codex?.observed.pass === false, JSON.stringify(r.codex?.observed));
  }
  // (4) summary lacks codex cells (Michie did not run codex today) → only claude row
  {
    const r = await run(summary({ "fetch-index": { claude: "fetched" }, "fetch-square": { claude: "fetched" }, "fetch-control-insights": { claude: "fetched" } }));
    expect("(4) exit 0 with one reading", r.status === 0 && !!r.claude && !r.codex, JSON.stringify(r.metrics?.readings?.map((x: any) => x.observer)));
    expect("(4) skip logged", /\[SKIP\] codex/.test(r.out));
  }
  // (5) page changed since sealing → gt row pass=false; agent judged on fetch status only
  {
    mutateIndex = true;
    const r = await run(summary({ "fetch-index": { claude: "fetched" }, "fetch-square": { claude: "fetched" }, "fetch-control-insights": { claude: "fetched" } }));
    expect("(5) gt row inconsistent", r.gt?.observed.pass === false && r.gt?.observed.checks.some((c: any) => c.label === "page_1_body_matches_sealed_digest" && c.ok === false), JSON.stringify(r.gt?.observed));
    expect("(5) agent still done (page changed is not the agent's failure)", r.claude?.stage_reached === "done" && r.claude?.observed.ground_truth_consistent === false);
    mutateIndex = false;
  }
  // (5b) unknown status → instrument, never done (Codex P1)
  {
    const r = await run(summary({ "fetch-index": { claude: "failed" }, "fetch-square": { claude: "fetched" }, "fetch-control-insights": { claude: "fetched" } }));
    expect("(5b) unknown status 'failed' → instrument_error, discover, pass=false", r.claude?.observed.instrument_error === "other" && r.claude?.stage_stopped === "discover" && r.claude?.observed.pass === false, JSON.stringify(r.claude?.observed));
    expect("(5b) all_statuses_known check false", r.claude?.observed.checks.some((c: any) => c.label === "all_statuses_known" && c.ok === false));
  }
  // (5c) a summary from another day writes no row, even when passed explicitly (Codex P2)
  {
    const r = await run(summary({ "fetch-index": { claude: "fetched", codex: "fetched" }, "fetch-square": { claude: "fetched", codex: "fetched" }, "fetch-control-insights": { claude: "fetched", codex: "fetched" } }, undefined, "2026-01-01"));
    expect("(5c) stale summary → no readings, skip logged with the date", r.status === 0 && !r.claude && !r.codex && /summary date 2026-01-01 is not today/.test(r.out), r.out.slice(-300));
  }
  // (5d) F-cases (review-2 re-review): mixed dates inside one summary
  {
    // F1: date is today but run_at is yesterday → inconsistent summary, no rows
    const r1 = await run(summary({ "fetch-index": { claude: "fetched" }, "fetch-square": { claude: "fetched" }, "fetch-control-insights": { claude: "fetched" } }, undefined, TODAY, "2026-01-01T00:00:00.000Z"));
    expect("(5d) F1 run_at from another day → no readings", r1.status === 0 && !r1.claude && /run_at 2026-01-01 is not today/.test(r1.out), r1.out.slice(-300));
    // F2: one cell carries an old date → that page is missing → discover stop (never done)
    const r2 = await run(summary({ "fetch-index": { claude: { status: "fetched", date: "2026-01-01" } }, "fetch-square": { claude: "fetched" }, "fetch-control-insights": { claude: "fetched" } }));
    expect("(5d) F2 old-dated cell → missing → discover, pass=false", r2.claude?.stage_stopped === "discover" && r2.claude?.observed.pass === false, JSON.stringify(r2.claude?.observed));
    // F3: only the control page is today's; wiki cells old → discover (control never lifts the stage)
    const r3 = await run(summary({ "fetch-index": { claude: { status: "fetched", date: "2026-01-01" } }, "fetch-square": { claude: { status: "fetched", date: "2026-01-01" } }, "fetch-control-insights": { claude: "fetched" } }));
    expect("(5d) F3 wiki cells old, control today → discover, pass=false", r3.claude?.stage_stopped === "discover" && r3.claude?.observed.pass === false, JSON.stringify(r3.claude?.observed));
  }
  // (6) --observers filter and public files free of URLs
  {
    const r = await run(summary({ "fetch-index": { claude: "fetched", codex: "fetched" }, "fetch-square": { claude: "fetched", codex: "fetched" }, "fetch-control-insights": { claude: "fetched", codex: "fetched" } }), ["--observers", "codex"]);
    expect("(6) --observers codex → only codex row", !!r.codex && !r.claude);
    const committed = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(r.bundle!, f), "utf-8")).join("\n");
    expect("(6) no page URLs in public files", !/127\.0\.0\.1:47332\/agent-wiki/.test(committed));
  }
} finally { (server as any).closeAllConnections?.(); server.close(); }

console.log(failures === 0 ? "\nmarker fetch-check smoke: ALL PASS" : `\nmarker fetch-check smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
