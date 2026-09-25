#!/usr/bin/env tsx
/**
 * Smoke test for kind_of_truth=llm_answer (M-004a shape): the judgement is rules
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

// ── Part A: rules ────────────────────────────────────────────────────────
{
  const a = J("公式 MCP は https://github.com/fake-vendor/fake-official-mcp-server にあります。Web API の認証は OAuth 2.0（認可コード）です。");
  expect("A1 url + OAuth 2.0 → done/pass", a.reached === "done" && a.pass && a.stopped === null, JSON.stringify(a));
  const b = J("公式の MCP サーバーは確認できません。API 連携は REST で可能です。");
  expect("A2 denial → discover stop + false completion", b.stopped === "discover" && b.falseCompletion === true, JSON.stringify(b));
  const c = J("AgileWorks の連携には REST API を使います。認証は OAuth2 です。");
  expect("A3 no URL, no denial → discover stop, no false completion", c.stopped === "discover" && c.falseCompletion === false, JSON.stringify(c));
  const d = J("公式 MCP: https://github.com/fake-vendor/fake-official-mcp-server 。認証は Basic 認証（ユーザー名とパスワード）です。");
  expect("A4 url + Basic → understand stop + false completion", d.stopped === "understand" && d.falseCompletion === true, JSON.stringify(d));
  const e = J("https://github.com/fake-vendor/fake-official-mcp-server が公式です。認証方式はドキュメントを確認してください。");
  expect("A5 url + no auth statement → understand stop, no false completion", e.stopped === "understand" && e.falseCompletion === false, JSON.stringify(e));
  const f = J("See github.com/Fake-Vendor/Fake-Official-MCP-Server.git#readme — auth is OAuth2 bearer tokens; Basic auth is also selectable.");
  expect("A6 case/suffix-insensitive url, OAuth named alongside Basic → done", f.reached === "done" && f.pass, JSON.stringify(f));
  const g = J("https://github.com/fake-vendor/fake-official-mcp-server-v2 is the official MCP. OAuth 2.0.");
  expect("A7 similar-but-different repo path does not count", g.stopped === "discover", JSON.stringify(g));
  const h = J("", "HTTP 429");
  expect("A8 provider error → instrument provider_api", h.instrument === "provider_api" && h.pass === false, JSON.stringify(h));
  const i = J("The official MCP is not available. There is no official MCP server; use the REST API with an API key.");
  expect("A9 English denial → discover + false completion", i.stopped === "discover" && i.falseCompletion === true, JSON.stringify(i));
}

// ── Part B: end to end with fake provider ────────────────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), "fake-llm-"));
  const answersPath = join(tmp, "answers.json");
  writeFileSync(answersPath, JSON.stringify({ fake: "公式 MCP は https://github.com/fake-vendor/fake-official-mcp-server にあります。認証は OAuth 2.0 です。根拠: https://github.com/fake-vendor/fake-official-mcp-server#readme" }));
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
  }
  expect("B8 non-dry-run refused (fake provider is test machinery)", spawnSync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m994.json"], { cwd: ROOT, encoding: "utf-8", env }).status === 5);
}

console.log(failures === 0 ? "\nmarker llm-answer smoke: ALL PASS" : `\nmarker llm-answer smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
