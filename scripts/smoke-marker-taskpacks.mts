#!/usr/bin/env tsx
/**
 * Smoke test: every REAL taskpack (M-001 … M-004) produces readings that pass
 * reading.v1.schema.json, and its marker block is complete and selectable.
 * (Codex review 2 ①: "M-004a" violated the marker_id pattern and would have
 * failed at the harness's schema gate on the first real run.)
 *
 *   npx tsx scripts/smoke-marker-taskpacks.mts
 *
 * No network, no seal, no DB: readings are synthesised from each pack's marker
 * block the same way run-marker/marker-generic build them, then validated.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { validateReading, loadReadingSchema, newUlid, isoWithOffset } from "../exec-harness/lib/reading.mjs";
import { selectTarget } from "../exec-harness/lib/marker-targets.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PACKS_DIR = join(ROOT, "exec-harness", "taskpacks");
let failures = 0;
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; };

function walk(dir: string): string[] { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".json") ? [p] : []; }); }
const packs = walk(PACKS_DIR).map((p) => ({ path: p, rel: p.slice(ROOT.length + 1).replaceAll("\\", "/"), pack: JSON.parse(readFileSync(p, "utf-8")) })).filter((x) => x.pack.marker);
const schema = loadReadingSchema();
const ids = packs.map((x) => x.pack.marker.marker_id);
expect("four real marker packs found (M-001..M-004)", ["M-001", "M-002", "M-003", "M-004"].every((id) => ids.includes(id)), ids.join(","));
expect("marker ids unique", new Set(ids).size === ids.length);

const METHODS: Record<string, string> = { mcp_direct_read: "harness_direct_api_vs_sealed_expectation", "http_probe/catalog_display": "catalog_display_vs_sealed_expectation", "http_probe/fetch_check_summary": "agent_fetch_vs_sealed_body_digest", llm_answer: "llm_answer_rules_vs_sealed_expectation" };
const GT_METHODS: Record<string, string> = { mcp_direct_read: "sealed_expectation_vs_harness_direct_api", "http_probe/catalog_display": "sealed_expectation_vs_harness_http_probe", "http_probe/fetch_check_summary": "sealed_expectation_vs_harness_http_probe", llm_answer: "sealed_repo_vs_github_api" };

for (const { rel, pack } of packs) {
  const MK = pack.marker;
  const kind = MK.kind_of_truth || "mcp_direct_read";
  const key = kind === "http_probe" ? `${kind}/${MK.observation}` : kind;
  const tag = `${MK.marker_id} (${rel})`;

  // marker block completeness — what run-marker refuses without
  expect(`${tag}: marker block complete`, Boolean(MK.marker_id && MK.commitment_file && MK.sealed_path_env && MK.expected_digest && MK.claim), JSON.stringify(Object.keys(MK)));
  expect(`${tag}: marker_id matches schema pattern`, new RegExp(schema.properties.marker_id.pattern).test(MK.marker_id), MK.marker_id);
  expect(`${tag}: commitment_file path is evidence/commitments/<id>.sha256`, MK.commitment_file === `evidence/commitments/${MK.marker_id}.sha256`, MK.commitment_file);
  expect(`${tag}: sealed_path_env is KANSEI_<ID>_SEALED_PATH`, MK.sealed_path_env === `KANSEI_${MK.marker_id.replace("-", "")}_SEALED_PATH`, MK.sealed_path_env);
  expect(`${tag}: kind_of_truth/observation selectable`, (() => { try { const t = selectTarget(MK); return kind === "mcp_direct_read" ? t === null : Boolean(t && t.method === METHODS[key]); } catch { return false; } })(), key);
  expect(`${tag}: max_readings is a positive integer`, Number.isInteger(MK.max_readings) && MK.max_readings > 0, String(MK.max_readings));
  expect(`${tag}: service_id present`, typeof pack.service_id === "string" && pack.service_id.length > 0);
  if (kind === "llm_answer") expect(`${tag}: note declares the seal is the repo URL only and auth is a rule constant`, /ONLY THE OFFICIAL MCP REPOSITORY URL/.test(MK.note || "") && /AUTH_RULE/.test(MK.note || ""));
  // ATTRIBUTION-Rules v0.1 §2-1: A1/A2 fixed in the taskpack (public), B = the production catalog item, read only
  if (MK.marker_id === "M-004") {
    const at = MK.attribution || {};
    expect(`${tag}: attribution A1/A2 fixed exactly`, JSON.stringify((at.official_docs || []).map((p: any) => [p.id, p.url])) === JSON.stringify([["A1", "https://www.atled.jp/agileworks/functions/ai-use/"], ["A2", "https://www.atled.jp/news/20260727_01/"]]), JSON.stringify(at.official_docs));
    expect(`${tag}: attribution B reads the production catalog item agile-works`, at.catalog?.service_id === "agile-works" && at.catalog?.display_api_url === "https://kansei-link-mcp-production.up.railway.app/mcp");
    expect(`${tag}: rename detection on (verify_repo_via_github not false, default GitHub API)`, MK.verify_repo_via_github !== false && !MK.github_api_base);
    for (const [method, pass, inst] of [["sealed_repo_vs_official_docs", true, null], ["sealed_repo_vs_official_docs", false, null], ["sealed_repo_vs_official_docs", false, "other"], ["sealed_repo_vs_kansei_catalog", true, null], ["sealed_repo_vs_kansei_catalog", false, null], ["sealed_repo_vs_kansei_catalog", false, "other"]] as const) {
      const row = { reading_id: newUlid(), claim: "attribution column", marker_id: MK.marker_id, expected_digest: "0".repeat(64), target: { service_id: pack.service_id, model: "none", harness_version: "run-marker@0.4.0+0000000" }, stage_reached: "done", stage_stopped: null, observed: { pass, method, checks: [{ label: "A1_page_lists_sealed_repo", ok: pass }], ground_truth_consistent: true, instrument_error: inst }, evidence_ref: `evidence/x/m-004#sha256:${"a".repeat(64)}`, observer: "kansei_harness@run-marker@0.4.0", kind: "synthetic", observed_at: isoWithOffset(new Date()), supersedes: null };
      const e = validateReading(row, schema);
      expect(`${tag}: attribution row ${method} pass=${pass} instrument=${inst} passes reading.v1`, e.length === 0, e.join("; "));
    }
  }

  // synthesise the agent reading and the ground-truth reading exactly as the harness does
  const observers = kind === "http_probe" && MK.observation === "fetch_check_summary" ? (MK.observers || []).map((o: any) => `${o.id}@1.0.0`) : ["kansei_harness@run-marker@0.4.0"];
  for (const observer of observers) {
    // ⑤ every synthesised agent reading carries exactly one true value: pass (done), false_completion (understand), undetermined (discover)
    for (const stage of [["done", null, true, false, false], ["understand", "understand", false, true, false], ["discover", "discover", false, false, true]] as const) {
      const reading = {
        reading_id: newUlid(), claim: MK.claim, marker_id: MK.marker_id, expected_digest: "0".repeat(64),
        target: { service_id: pack.service_id, model: "model-x", harness_version: "run-marker@0.4.0+0000000" },
        stage_reached: stage[0], stage_stopped: stage[1],
        observed: { pass: stage[2], method: METHODS[key], checks: [{ label: "x", ok: stage[2] }], false_completion: stage[3], undetermined: stage[4], ground_truth_consistent: true, instrument_error: null, trap_armed: false },
        evidence_ref: `evidence/x/${MK.marker_id.toLowerCase()}#sha256:${"a".repeat(64)}`, observer, kind: "synthetic", observed_at: isoWithOffset(new Date()), supersedes: null,
      };
      const errs = validateReading(reading, schema);
      expect(`${tag}: agent reading (${observer}, ${stage[0]}) passes reading.v1`, errs.length === 0, errs.join("; "));
    }
  }
  const gt = {
    reading_id: newUlid(), claim: "ground truth claim", marker_id: MK.marker_id, expected_digest: "0".repeat(64),
    target: { service_id: pack.service_id, model: "none", harness_version: "run-marker@0.4.0+0000000" },
    stage_reached: "done", stage_stopped: null,
    observed: { pass: false, method: GT_METHODS[key], checks: [], ground_truth_consistent: false, instrument_error: null },
    evidence_ref: `evidence/x/${MK.marker_id.toLowerCase()}#sha256:${"a".repeat(64)}`, observer: "kansei_harness@run-marker@0.4.0", kind: "synthetic", observed_at: isoWithOffset(new Date()), supersedes: null,
  };
  const gerrs = validateReading(gt, schema);
  expect(`${tag}: ground-truth reading passes reading.v1`, gerrs.length === 0, gerrs.join("; "));
}

// negative control: the old id must be rejected by the same gate
{
  const bad = { reading_id: newUlid(), claim: "x".repeat(10), marker_id: "M-004a", expected_digest: "0".repeat(64), target: { service_id: "s", model: "m", harness_version: "h" }, stage_reached: "done", stage_stopped: null, observed: { pass: true, method: "llm_answer_rules_vs_sealed_expectation" }, evidence_ref: `e#sha256:${"a".repeat(64)}`, observer: "kansei_harness@x", kind: "synthetic", observed_at: isoWithOffset(new Date()), supersedes: null };
  expect("negative control: marker_id 'M-004a' is rejected by reading.v1", validateReading(bad, schema).some((e) => e.includes("marker_id")));
}

console.log(failures === 0 ? "\nmarker taskpacks smoke: ALL PASS" : `\nmarker taskpacks smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
