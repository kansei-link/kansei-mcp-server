#!/usr/bin/env tsx
/**
 * Smoke test for exec-harness/run-marker.mjs control paths that must never be
 * exercised against the real sealed marker:
 *
 *   (a) expires_at default stop, and --allow-expired continuing
 *   (b) --arm-trap with the empty executor: the process_end `finally` restores
 *       the original current company (restore_current_company changed:true ok:true)
 *
 *   npx tsx scripts/smoke-run-marker.mts
 *
 * Uses exec-harness/fixtures/* (fake sealed files, fake commitments, fake taskpacks)
 * and exec-harness/fixtures/fake-freee-mcp.mjs. No network, no real freee-mcp,
 * no real sealed file, no DB/README writes (--dry-run). Bundles land under
 * evidence/_dryrun/ (git-ignored).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const FIX = join(ROOT, "exec-harness", "fixtures");
const FAKE_MCP = `node ${join(FIX, "fake-freee-mcp.mjs").replaceAll("\\", "/")}`;

let failures = 0;
function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures++;
}

interface Run { status: number | null; out: string; bundle: string | null }
function runMarker(pack: string, extra: string[], env: Record<string, string>): Run {
  const r = spawnSync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), pack, "--dry-run", "--mcp", FAKE_MCP, ...extra], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = /evidence: (\S+?)\/ \(manifest/.exec(out);
  return { status: r.status, out, bundle: m ? join(ROOT, m[1]) : null };
}
const events = (bundle: string) => readFileSync(join(bundle, "harness.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));

const stateFile = join(mkdtempSync(join(tmpdir(), "fake-freee-")), "state.json");
const envBase = { KANSEI_M998_SEALED_PATH: join(FIX, "M-998.sealed.json"), KANSEI_M999_SEALED_PATH: join(FIX, "M-999.sealed.json"), FAKE_FREEE_STATE_FILE: stateFile };

// ── (a1) expired fixture, no flag → stops by default, nothing written ──────
{
  const r = runMarker("fixtures/taskpack-m999.json", ["--executor", "empty"], envBase);
  expect("(a1) expired: exit 0", r.status === 0, `status=${r.status}`);
  expect("(a1) expired: says it stops by default", /past expires_at .* stops by default/.test(r.out), r.out.slice(-300));
  expect("(a1) expired: no bundle written", r.bundle === null);
  expect("(a1) expired: fake mcp never started (no override line)", !/mcp: .*\(override\)/.test(r.out));
}

// ── (a2) expired fixture, --allow-expired → continues, flagged in manifest ─
{
  const r = runMarker("fixtures/taskpack-m999.json", ["--executor", "empty", "--allow-expired"], envBase);
  expect("(a2) allow-expired: exit 0", r.status === 0, `status=${r.status}`);
  expect("(a2) allow-expired: warns and continues", /\[warn\] sealed marker is past expires_at .*--allow-expired/.test(r.out), r.out.slice(-400));
  expect("(a2) allow-expired: bundle written", !!r.bundle && existsSync(join(r.bundle!, "manifest.json")), r.bundle ?? "no bundle");
  if (r.bundle) {
    const mf = JSON.parse(readFileSync(join(r.bundle, "manifest.json"), "utf-8"));
    expect("(a2) manifest.marker.expired_at_run === true", mf.marker.expired_at_run === true);
    expect("(a2) manifest.environment.allow_expired === true", mf.environment.allow_expired === true);
    expect("(a2) sealed key resolved via company_number", mf.marker.sealed_key_kind === "company_number", mf.marker.sealed_key_kind);
    expect("(a2) ground truth consistent with fixture expectation", mf.marker.ground_truth_consistent === true);
  }
}

// ── (b) valid fixture, --arm-trap + empty executor → process_end restores ──
{
  const r = runMarker("fixtures/taskpack-m998.json", ["--executor", "empty", "--arm-trap"], envBase);
  expect("(b) trap+empty: exit 0", r.status === 0, `status=${r.status}`);
  expect("(b) trap+empty: bundle written", !!r.bundle, r.out.slice(-300));
  if (r.bundle) {
    const ev = events(r.bundle);
    const trap = ev.find((e) => e.event === "trap_armed");
    const restores = ev.filter((e) => e.event === "restore_current_company");
    expect("(b) trap armed by harness switch", trap?.ok === true && trap?.how === "harness_switched_to_random_test_company", JSON.stringify(trap));
    expect("(b) no per-run restore (no runs)", !restores.some((e) => String(e.where).startsWith("after_run")), JSON.stringify(restores));
    const pe = restores.find((e) => e.where === "process_end");
    expect("(b) process_end restore changed:true ok:true", pe?.changed === true && pe?.ok === true, JSON.stringify(pe));
    expect("(b) executor_empty event present", ev.some((e) => e.event === "executor_empty" && e.trap_armed === true));
    const st = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect("(b) fake mcp ended on the original (production) company", st.currentCompanyId === 1000001, JSON.stringify(st));
    expect("(b) fake mcp saw exactly two switches (trap, restore)", st.switches.length === 2 && st.switches[0] !== 1000001 && st.switches[1] === 1000001, JSON.stringify(st.switches));
    const mf = JSON.parse(readFileSync(join(r.bundle, "manifest.json"), "utf-8"));
    expect("(b) manifest environment.arm_trap === true", mf.environment.arm_trap === true);
    expect("(b) manifest records MCP command", mf.environment.mcp_command.join(" ") === FAKE_MCP);
    expect("(b) manifest records empty executor", mf.environment.executor === "empty");
    const committed = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(r.bundle!, f), "utf-8")).join("\n");
    expect("(b) no fake tenant ids in committed-type files", !/100000[123]|10000000[123]/.test(committed));
  }
}

// ── (c) valid fixture, empty executor, no trap → process_end restore is a no-op ─
{
  const r = runMarker("fixtures/taskpack-m998.json", ["--executor", "empty"], envBase);
  expect("(c) no trap: exit 0", r.status === 0, `status=${r.status}`);
  if (r.bundle) {
    const pe = events(r.bundle).find((e) => e.event === "restore_current_company" && e.where === "process_end");
    expect("(c) process_end restore changed:false ok:true", pe?.changed === false && pe?.ok === true, JSON.stringify(pe));
  }
}

console.log(failures === 0 ? "\nrun-marker smoke: ALL PASS" : `\nrun-marker smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
