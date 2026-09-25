#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth=http_probe / observation=fetch_check_summary (M-003 shape).
 *
 *   npx tsx scripts/smoke-marker-fetch-check.mts
 *
 * Local server on 127.0.0.1:47332 serves three fixed pages (digests sealed in the
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

const ROOT = resolve(import.meta.dirname, "..");
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
await new Promise<void>((r) => server.listen(47332, "127.0.0.1", () => r()));

const tmp = mkdtempSync(join(tmpdir(), "fetch-check-"));
const TODAY = new Date().toISOString().slice(0, 10);
function summary(cells: Record<string, Record<string, string>>, cli: Record<string, string> = { claude: "9.9.9 (Claude Code)", codex: "codex-cli 0.0.1" }, date = TODAY) {
  const p = join(tmp, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  const checks: any = {};
  for (const [id, byAgent] of Object.entries(cells)) { checks[id] = {}; for (const [agent, status] of Object.entries(byAgent)) checks[id][agent] = { status, error: null, snippet: "…" }; }
  writeFileSync(p, JSON.stringify({ date, agents: { claude: "claude-opus-5", codex: "gpt-6-astra" }, cli_versions: cli, checks }));
  return p;
}
async function run(summaryPath: string, extra: string[] = []) {
  const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m995.json", "--dry-run", "--fetch-summary", summaryPath, ...extra], { cwd: ROOT, env: { ...process.env, KANSEI_M995_SEALED_PATH: join(FIX, "M-995.sealed.json") } });
  const out = r.out;
  const m = /evidence: (\S+?)\/ \(manifest/.exec(out);
  const bundle = m ? join(ROOT, m[1]) : null;
  const metrics = bundle && existsSync(join(bundle, "metrics.json")) ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : null;
  const by = (obs: string) => metrics?.readings?.find((x: any) => x.observer.startsWith(obs));
  return { status: r.status, out, bundle, metrics, claude: by("claude-code@"), codex: by("codex@"), gt: metrics?.readings?.find((x: any) => x.observed.method === "sealed_expectation_vs_harness_http_probe") };
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
  // (2) codex denied on wiki pages but fetched control → codex stops at discover; claude done
  {
    const r = await run(summary({ "fetch-index": { claude: "fetched", codex: "denied" }, "fetch-square": { claude: "fetched", codex: "denied" }, "fetch-control-insights": { claude: "fetched", codex: "fetched" } }));
    expect("(2) codex stage_stopped discover", r.codex?.stage_stopped === "discover" && r.codex?.observed.pass === false, JSON.stringify(r.codex?.observed));
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
