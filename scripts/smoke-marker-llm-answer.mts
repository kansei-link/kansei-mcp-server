#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth=llm_answer (M-004 shape): the judgement is rules
 * on the answer text, never a model grading a model.
 *
 *   npx tsx scripts/smoke-marker-llm-answer.mts
 *
 * Part A: judge() unit cases with canned answers (no process spawn).
 * Part B: run-marker end to end with the M-994 fixture and provider 'fake'
 *         (answers from KANSEI_FAKE_LLM_ANSWERS_FILE). --dry-run only, no network.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { TARGETS } from "../exec-harness/lib/marker-targets.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FIX = join(ROOT, "exec-harness", "fixtures");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };

const sealed = TARGETS.llmAnswer.parseSealed(JSON.parse(readFileSync(join(FIX, "M-994.sealed.json"), "utf-8")));
const J = (text: string, error: string | null = null) => TARGETS.llmAnswer.judge({ obs: { text, error, citations: [] }, sealed, truth: { consistent: true } });

// ── Part A: rules, every case in exec-harness/fixtures/llm-answer-cases.json ─
// (Codex review-2 answers C01–C11, the original A cases under the closed policy, edge cases X*)
{
  const cases = JSON.parse(readFileSync(join(FIX, "llm-answer-cases.json"), "utf-8")).cases as Array<{ id: string; text: string; error?: string; expect: { stopped: string | null; pass: boolean; false_completion: boolean; undetermined: boolean; instrument?: string; outcome: string } }>;
  expect("A0 every case has an exclusive expectation (exactly one of pass/fc/undetermined/instrument)", cases.every((c) => [c.expect.pass, c.expect.false_completion, c.expect.undetermined, Boolean(c.expect.instrument)].filter(Boolean).length === 1));
  for (const c of cases) {
    const r = J(c.text, c.error ?? null);
    const exclusive = [r.pass, r.falseCompletion, Boolean(r.undetermined), Boolean(r.instrument)].filter(Boolean).length === 1;
    const ok = exclusive && r.stopped === c.expect.stopped && r.pass === c.expect.pass && r.falseCompletion === c.expect.false_completion && Boolean(r.undetermined) === c.expect.undetermined && (c.expect.instrument === undefined || r.instrument === c.expect.instrument) && r.outcome === c.expect.outcome && (c.expect.stopped !== null || r.reached === "done");
    expect(`${c.id} ${c.text.replace(/\s+/g, " ").slice(0, 60)}${c.error ? ` [error ${c.error}]` : ""}`, ok, `got stopped=${r.stopped} pass=${r.pass} fc=${r.falseCompletion} und=${r.undetermined} inst=${r.instrument} outcome=${r.outcome}; want ${JSON.stringify(c.expect)}`);
  }
  console.log(`A: ${cases.length} two-line cases in fixtures`);
  // P2: the answer region is the last two lines only — any prefix (explanations, code quotes that look
  // like the two lines, URLs inside URLs) must leave the verdict unchanged. Prefixes from Codex's evidence.
  const ev = JSON.parse(readFileSync(join(FIX, "evidence", "codex-e4955ec-independent-evidence.json"), "utf-8"));
  const base = "REPO: https://github.com/fake-vendor/fake-official-mcp-server\nAUTH: OAuth 2.0";
  const baseOutcome = J(base).outcome;
  for (const pc of ev.prefixChecks as Array<{ prefix: string }>) {
    const r = J(pc.prefix + base);
    expect(`P2 prefix does not change the verdict: ${JSON.stringify(pc.prefix.slice(0, 40))}`, r.outcome === baseOutcome && r.pass === true, `got ${r.outcome}`);
  }
  // ① URL tokens: the inside of a scheme URL is never re-scanned; scheme-less only outside
  const { extractUrlTokens } = await import("../exec-harness/lib/llm-answer-rules.mjs");
  const toks = extractUrlTokens("see https://evil.example/r?to=https://github.com/a/b and github.com/c/d and https://github.com/e/f");
  expect("① scheme URL containing another URL yields one token; bare host outside is separate", toks.length === 3 && toks[0].raw.startsWith("https://evil.example") && toks[1].raw === "github.com/c/d" && toks[2].raw === "https://github.com/e/f", JSON.stringify(toks.map((t) => t.raw)));
}

// ── Part B: end to end with fake provider ────────────────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), "fake-llm-"));
  const answersPath = join(tmp, "answers.json");
  writeFileSync(answersPath, JSON.stringify({ fake: "公式 MCP は GitHub にあります。認証は OAuth 2.0 です。根拠: https://github.com/fake-vendor/fake-official-mcp-server#readme\nREPO: https://github.com/fake-vendor/fake-official-mcp-server\nAUTH: OAuth 2.0" }));
  const env = { ...process.env, KANSEI_M994_SEALED_PATH: join(FIX, "M-994.sealed.json"), KANSEI_FAKE_LLM_ANSWERS_FILE: answersPath };
  const r = spawnSync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m994.json", "--dry-run"], { cwd: ROOT, encoding: "utf-8", env });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = /evidence: (\S+?)\/ \(manifest/.exec(out);
  const bundle = m ? join(ROOT, m[1]) : null;
  expect("B1 exit 0 and bundle", r.status === 0 && !!bundle, out.slice(-400));
  if (bundle) {
    const metrics = JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8"));
    const rd = metrics.readings.find((x: any) => x.observed.method === "llm_answer_rules_vs_sealed_expectation");
    expect("B2 one reading for provider fake, model recorded", !!rd && rd.target.model === "fake-model", JSON.stringify(rd?.target));
    expect("B3 done/pass by rules", rd?.stage_reached === "done" && rd?.observed.pass === true, JSON.stringify(rd?.observed));
    expect("B4 ground truth skipped by pack (no network)", rd?.observed.ground_truth_consistent === true && metrics.readings.length === 1);
    const committed = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(bundle, f), "utf-8")).join("\n");
    expect("B5 answer text absent from public files", !/OAuth 2\.0 です|fake-official-mcp-server/.test(committed));
    expect("B6 transcript (private) holds the answer", /fake-official-mcp-server/.test(readFileSync(join(bundle, "fake", "transcript.jsonl"), "utf-8")));
    const mf = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf-8"));
    expect("B7 manifest lists providers and kind", mf.marker.kind_of_truth === "llm_answer" && mf.environment.providers?.[0] === "fake");
    expect("B7b manifest records the size of the guidance (two-line form, AUTH options listed)", mf.prompt_guidance?.form === "two_lines_REPO_AUTH" && mf.prompt_guidance.lines === 2 && Array.isArray(mf.prompt_guidance.auth_options_listed) && mf.prompt_guidance.leaks_expected_auth_method === true);
    expect("B7c manifest libs include llm-answer-rules.mjs fingerprint", typeof mf.executor.libs["lib/llm-answer-rules.mjs"] === "string" && /^[0-9a-f]{64}$/.test(mf.executor.libs["lib/llm-answer-rules.mjs"]));
    expect("B7d reading is exclusive (pass only)", rd?.observed.pass === true && rd?.observed.false_completion === false && rd?.observed.undetermined === false && rd?.observed.instrument_error === null);
    const sent = readFileSync(join(bundle, "fake", "transcript.jsonl"), "utf-8");
    expect("B7e transcript keeps the explanation as evidence", /公式 MCP は GitHub にあります/.test(sent));
  }
  expect("B8 non-dry-run refused (fake provider is test machinery)", spawnSync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m994.json"], { cwd: ROOT, encoding: "utf-8", env }).status === 5);
}

console.log(failures === 0 ? "\nmarker llm-answer smoke: ALL PASS" : `\nmarker llm-answer smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
