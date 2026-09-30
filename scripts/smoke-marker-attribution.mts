#!/usr/bin/env tsx
/**
 * Smoke test for the attribution columns A/B and rename detection (ATTRIBUTION-Rules v0.1 §4-2, M-004).
 *
 *   npx tsx scripts/smoke-marker-attribution.mts
 *
 * §4-2 (Michie 2026-09-29, after Codex review of 7e9a3e2): A and B are decided by PEOPLE. The instrument
 * reads each source fixed in the taskpack (A1, A2, B), takes the body's sha256 and looks for a human
 * attestation of exactly that body (verdict listed or not_listed); without one the source is
 * 未確定（本文に変化あり・要再確認）. The automatic reading (classifySource) is a private hint only.
 *
 * Part A:  the cells (from the rows' attestation checks only), the truth table (#1–#8), U0–U4 and precedence.
 * Part A2: the HINT reader (classifySource / sourceListsRepo) — unchanged, private, decides nothing.
 * Part A3: attribution-attest.mjs — column B's body (two volatile leaves only), the source targets, the
 *          attestation validator (exact keys, placeholders, target, seal, body, verdict listed/not_listed).
 * Part B:  run-marker end to end in --dry-run with the M-994 fixture seal, provider 'fake', and a loopback
 *          server (127.0.0.1:47336) playing A1/A2, the KanseiLINK catalog and the GitHub API.
 * Part C:  the sheet drawn from Part B's readings (三列 + 判断（規則 v0.1）).
 * Part D/E: Codex's earlier independent cases (110 of 185d63d, 93 of 8d905ee) — hint cases replayed on the
 *          hint reader, judgement and ground-truth cases as before, loopback cases by smoke label.
 * Part F:  Codex's 94 independent cases of 7e9a3e2 (fixtures/attribution-cases-7e9a3e2.json).
 * Part H:  Codex's 88 independent cases of 1391a31 (fixtures/attribution-cases-1391a31.json) — Codex's runner ported;
 *          R1: a volatile leaf is outside the body only while its value has the exact grammar (lower-case UUID,
 *          integer 0..100000); a URL, an upper-case UUID or an odd number in it changes the body.
 * Part G:  Codex's 112 independent cases of 5758e0a (fixtures/attribution-cases-5758e0a.json) — Codex's runner ported:
 *          in-process attribution and runGenericMarker on loopback; the allow-list policy (observers.json, verdict,
 *          date not after today; reason a note that decides nothing).
 * No network beyond loopback, no real seal, no DB.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { columnA, columnB, columnC, judgeAttribution, attributionLines, gtLabel, ATTR_METHODS, AGENT_METHOD, RECHECK_TEXT, sourceRepoKey, sourceListsRepo, decodeHtmlCharRefs, classifySource, catalogBody, sha256Hex, validateAttestation, findAttestation, sourceState, sourceTarget, ATTESTATION_KIND, B_BODY_FIELDS, reasonCautions, loadObservers, localToday } from "../exec-harness/lib/attribution-rules.mjs";
import { renderSheet } from "../exec-harness/render-reading-sheet.mjs";
import { validateReading, loadReadingSchema } from "../exec-harness/lib/reading.mjs";
import { readmeRows } from "../exec-harness/lib/marker-persist.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FIX = join(ROOT, "exec-harness", "fixtures");
let failures = 0;
const passed: string[] = [];
const expect = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`); if (!ok) failures++; else passed.push(label); };
const spawnAsync = (cmd: string, args: string[], opts: any): Promise<{ status: number | null; out: string }> => new Promise((res) => { const p = spawn(cmd, args, opts); let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d)); p.on("close", (code) => res({ status: code, out })); });

// ── Part A: cells, truth table and precedence ────────────────────────────
{
  const A = { listed: { state: "listed", text: "" }, not: { state: "not_listed", text: "" }, unk: { state: "unknown", text: "" } } as const;
  const B = { ok: { state: "correct", text: "" }, bad: { state: "wrong", text: "" }, unk: { state: "unknown", text: "" } } as const;
  const C = { pass: { state: "pass", text: "" }, miss: { state: "miss", text: "" }, fmt: { state: "format", text: "" }, inst: { state: "instrument", text: "" } } as const;
  const table: Array<[any, any, any, string]> = [
    [A.listed, B.ok, C.pass, "#1"], [A.listed, B.ok, C.miss, "#2"], [A.listed, B.bad, C.pass, "#3"], [A.listed, B.bad, C.miss, "#4"],
    [A.not, B.ok, C.pass, "#5"], [A.not, B.ok, C.miss, "#6"], [A.not, B.bad, C.pass, "#7"], [A.not, B.bad, C.miss, "#8"],
  ];
  for (const [a, b, c, code] of table) {
    const j = judgeAttribution({ a, b, c, gtConsistent: true });
    expect(`A ${code}: A=${a.state} B=${b.state} C=${c.state}`, j.code === code && j.text.startsWith(code) && j.counted === true, JSON.stringify(j));
  }
  expect("A truth table covers #1–#8 once each", new Set(table.map((t) => judgeAttribution({ a: t[0], b: t[1], c: t[2], gtConsistent: true }).code)).size === 8);
  const U = (o: any) => judgeAttribution({ a: A.listed, b: B.ok, c: C.pass, gtConsistent: true, ...o });
  expect("A U0 ground truth moved → 未確定（計器）, not counted", U({ gtConsistent: false }).code === "U0" && U({ gtConsistent: false }).text === "未確定（計器）" && U({ gtConsistent: false }).counted === false);
  expect("A U0 wins over everything (A/B unknown, C format)", judgeAttribution({ a: A.unk, b: B.unk, c: C.fmt, gtConsistent: false }).code === "U0");
  expect("A U1 A unknown → 未確定（計器）", U({ a: A.unk }).code === "U1" && U({ a: A.unk }).text === "未確定（計器）");
  expect("A U1 wins over U2/U3", judgeAttribution({ a: A.unk, b: B.unk, c: C.fmt, gtConsistent: true }).code === "U1");
  expect("A U2 B unknown → 未確定（計器）", U({ b: B.unk }).code === "U2");
  expect("A U4 AI instrument → 未確定（計器）", U({ c: C.inst }).code === "U4" && U({ c: C.inst }).text === "未確定（計器）");
  expect("A U3 format violation → 未確定（回答形式）", U({ c: C.fmt }).code === "U3" && U({ c: C.fmt }).text === "未確定（回答形式）");
  expect("A gtConsistent null (not checked) does not block a judgement", U({ gtConsistent: null }).code === "#1");
  // A cells: per page [fetched, attested listed, attested not listed]; the row's own pass/instrument/aggregate checks
  type P = [boolean, boolean, boolean];
  const aObs = (a1: P, a2: P, pass: boolean, inst: string | null, aggListed: boolean, aggNot: boolean) => ({ method: ATTR_METHODS.A, pass, instrument_error: inst, checks: [
    ...([["A1", a1], ["A2", a2]] as const).flatMap(([id, [f, l, n]]) => [{ label: `${id}_page_fetched`, ok: f }, { label: `${id}_attested_listed`, ok: l }, { label: `${id}_attested_not_listed`, ok: n }, { label: `${id}_needs_recheck`, ok: f && !l && !n }]),
    { label: "official_docs_attested_listed", ok: aggListed }, { label: "official_docs_attested_not_listed", ok: aggNot }] });
  const cA = (...x: Parameters<typeof aObs>) => columnA(aObs(...x));
  expect("A cell: A2 attested listed, A1 needs recheck → listed", cA([true, false, false], [true, true, false], true, null, true, false).state === "listed" && cA([true, false, false], [true, true, false], true, null, true, false).text === "載っている・人の確認（A1 要再確認・A2 あり（人の確認））", cA([true, false, false], [true, true, false], true, null, true, false).text);
  expect("A cell: both attested not listed → not listed", cA([true, false, true], [true, false, true], false, null, false, true).state === "not_listed" && cA([true, false, true], [true, false, true], false, null, false, true).text === "載っていない・人の確認（A1 なし（人の確認）・A2 なし（人の確認））");
  expect("A cell: no attestation → 未確定（本文に変化あり・要再確認）", cA([true, false, false], [true, false, false], false, "other", false, false).text === `${RECHECK_TEXT}（A1 要再確認・A2 要再確認）` && cA([true, false, false], [true, false, false], false, "other", false, false).state === "unknown");
  expect("A cell: one attested not listed, the other needs recheck → unknown with the mark", cA([true, false, true], [true, false, false], false, "other", false, false).text === `${RECHECK_TEXT}（A1 なし（人の確認）・A2 要再確認）`);
  expect("A cell: fetch failures only → 未確定（取得失敗）", cA([false, false, false], [false, false, false], false, "other", false, false).text === "未確定（取得失敗）（A1 取得失敗・A2 取得失敗）");
  expect("A cell: a row saying pass WITHOUT the attestation checks is unknown (whatever produced it)", columnA({ method: ATTR_METHODS.A, pass: true, instrument_error: null, checks: [{ label: "A1_page_fetched", ok: true }, { label: "A1_page_lists_sealed_repo", ok: true }, { label: "official_docs_list_sealed_repo", ok: true }] }).state === "unknown");
  expect("A cell: pass=false without the not-listed attestation checks is unknown", columnA({ method: ATTR_METHODS.A, pass: false, instrument_error: null, checks: [{ label: "A1_page_fetched", ok: true }] }).state === "unknown");
  expect("A cell: aggregate says listed but no page is attested listed → unknown", cA([true, false, false], [true, false, false], true, null, true, false).state === "unknown");
  expect("A cell: aggregate says not listed but a page is not attested → unknown", cA([true, false, true], [true, false, false], false, null, false, true).state === "unknown");
  expect("A cell: missing row / row without checks = unknown", columnA(undefined).state === "unknown" && columnA({ method: ATTR_METHODS.A, pass: false, instrument_error: "other", checks: [] }).text === "未確定（計器）");
  const bObs = (pass: boolean, inst: string | null, c: Record<string, boolean>) => ({ method: ATTR_METHODS.B, pass, instrument_error: inst, checks: Object.entries({ catalog_item_observed: true, catalog_body_fields_fixed: true, catalog_item_present: true, catalog_item_attested_listed: false, catalog_item_attested_not_listed: false, catalog_item_needs_recheck: false, ...c }).map(([label, ok]) => ({ label, ok })) });
  expect("B cell: attested listed → 正しい・人の確認", columnB(bObs(true, null, { catalog_item_attested_listed: true })).state === "correct" && columnB(bObs(true, null, { catalog_item_attested_listed: true })).text === "正しい・人の確認");
  expect("B cell: attested not listed, item present → 誤り・人の確認（欠落）", columnB(bObs(false, null, { catalog_item_attested_not_listed: true })).text === "誤り・人の確認（欠落）");
  expect("B cell: attested not listed, no item → 誤り・人の確認（項なし）", columnB(bObs(false, null, { catalog_item_present: false, catalog_item_attested_not_listed: true })).text === "誤り・人の確認（項なし）");
  expect("B cell: no attestation → 未確定（本文に変化あり・要再確認）", columnB(bObs(false, "other", { catalog_item_needs_recheck: true })).text === RECHECK_TEXT && columnB(bObs(false, "other", { catalog_item_needs_recheck: true })).state === "unknown");
  expect("B cell: unobservable → 未確定（観測できない）", columnB(bObs(false, "other", { catalog_item_observed: false })).text === "未確定（観測できない）");
  expect("B cell: body fields not fixed in the taskpack → unknown", columnB(bObs(false, "other", { catalog_body_fields_fixed: false })).state === "unknown");
  expect("B cell: pass WITHOUT the attestation check is unknown (whatever produced it)", columnB({ method: ATTR_METHODS.B, pass: true, instrument_error: null, checks: [{ label: "catalog_field_lists_sealed_repo:connection_guide.repository", ok: true }] }).state === "unknown");
  expect("B cell: pass=false without the attestation check is unknown", columnB({ method: ATTR_METHODS.B, pass: false, instrument_error: null, checks: [] }).state === "unknown");
  const cObs = (checks: Array<[string, boolean]>, inst: string | null = null) => ({ method: AGENT_METHOD, instrument_error: inst, checks: checks.map(([label, ok]) => ({ label, ok })) });
  expect("C cell: pass", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", true], ["repo_value_is_not_none", true]])).state === "pass");
  expect("C cell: none", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", false], ["repo_value_is_not_none", false]])).text === "外した（none）");
  expect("C cell: other URL", columnC(cObs([["answer_region_in_form", true], ["repo_value_equals_sealed_repo", false], ["repo_value_is_not_none", true]])).text === "外した（別 URL）");
  expect("C cell: format", columnC(cObs([["answer_region_in_form", false]])).state === "format");
  expect("C cell: instrument", columnC(cObs([], "provider_api")).state === "instrument");
  expect("gtLabel carries the 要再確認 mark (README rows)", gtLabel(aObs([true, false, false], [true, false, false], false, "other", false, false)) === `A 公式情報: ${RECHECK_TEXT}（A1 要再確認・A2 要再確認）` && gtLabel(bObs(false, "other", { catalog_item_needs_recheck: true })) === `B KanseiLINK: ${RECHECK_TEXT}` && gtLabel(bObs(false, null, { catalog_item_attested_not_listed: true })) === "B KanseiLINK: 誤り・人の確認（欠落）" && gtLabel({ method: "sealed_repo_vs_github_api", pass: false }) === "不一致");
}

// ── Part A2: the HINT reader (private, decides nothing; unchanged since 7e9a3e2) ──
{
  const K = "github.com/fake-vendor/fake-official-mcp-server";
  const U0 = "https://github.com/fake-vendor/fake-official-mcp-server";
  const pos = [U0, U0 + "/", U0 + ".git", U0 + ".git/", U0 + "/tree/main", U0 + "/blob/main/README.md", U0 + "#readme", U0 + "?tab=readme-ov-file", U0 + "/tree/main?x=1#y", U0.toUpperCase().replace("HTTPS", "https"), U0 + "/issues/1",
    "http://github.com/fake-vendor/fake-official-mcp-server", "https://www.github.com/fake-vendor/fake-official-mcp-server", "http://www.github.com/fake-vendor/fake-official-mcp-server/tree/main", "github.com/fake-vendor/fake-official-mcp-server", "www.github.com/fake-vendor/fake-official-mcp-server#readme", "//github.com/fake-vendor/fake-official-mcp-server", "https://github.com:443/fake-vendor/fake-official-mcp-server", "github.com:443/fake-vendor/fake-official-mcp-server/blob/main/README.md", "HTTP://WWW.GITHUB.COM/FAKE-VENDOR/FAKE-OFFICIAL-MCP-SERVER"];
  const neg = ["https://evilgithub.com/fake-vendor/fake-official-mcp-server", "https://github.com.evil.example/fake-vendor/fake-official-mcp-server", "https://u@github.com/fake-vendor/fake-official-mcp-server", "https://github.com:8443/fake-vendor/fake-official-mcp-server", "http://github.com:80/fake-vendor/fake-official-mcp-server", "https://github.com:/fake-vendor/fake-official-mcp-server", "https://gist.github.com/fake-vendor/fake-official-mcp-server", "https://api.github.com/repos/fake-vendor/fake-official-mcp-server", "https://www2.github.com/fake-vendor/fake-official-mcp-server", "https://www.gitlab.com/fake-vendor/fake-official-mcp-server", "https:github.com/fake-vendor/fake-official-mcp-server", "https://github.com./fake-vendor/fake-official-mcp-server", "https://github.com:443@evil.example/fake-vendor/fake-official-mcp-server",
    "https://github.com/other-vendor/fake-official-mcp-server", "https://github.com/fake-vendor/other-repo", U0 + "-v2", U0 + "/../../other/other", U0 + "/%2e%2e/other/other", U0 + "\..\other", "https://github.com/fake-vendor", "https://github.com/fake-vendor/.git", "mygithub.com/fake-vendor/fake-official-mcp-server", "github.com.evil.example/fake-vendor/fake-official-mcp-server"];
  for (const u of pos) expect(`A2 (+) source key matches: ${u.slice(19)}`, sourceRepoKey(u) === K, String(sourceRepoKey(u)));
  for (const u of neg) expect(`A2 (−) source key does not match: ${u}`, sourceRepoKey(u) !== K, String(sourceRepoKey(u)));
  expect("A2 decode &amp; &#x2F; &#47; &quot;", decodeHtmlCharRefs("a&amp;b&#x2F;c&#47;d&quot;e") === 'a&b/c/d"e');
  expect("A2 decode once (no double decoding)", decodeHtmlCharRefs("&amp;amp;") === "&amp;");
  expect("A2 decoder is the WHATWG one: unknown names stay, bad code points become U+FFFD, &hyphen; is U+2010", decodeHtmlCharRefs("&bogus; &#0; &#xD800;") === "&bogus; � �" && decodeHtmlCharRefs("&hyphen;&dash;") === "‐‐");
  expect("A2 page with &amp; in the href lists the repo", sourceListsRepo(`<a href="${U0}?a=1&amp;b=2">x</a>`, K, { html: true }));
  expect("A2 page with &#x2F; in the href lists the repo only after decoding", sourceListsRepo(`<a href="https:&#x2F;&#x2F;github.com&#x2F;fake-vendor&#x2F;fake-official-mcp-server">x</a>`, K, { html: true }) && !sourceListsRepo(`<a href="https:&#x2F;&#x2F;github.com&#x2F;fake-vendor&#x2F;fake-official-mcp-server">x</a>`, K));
  expect("A2 a URL inside another URL's query is not the page pointing at the repo", !sourceListsRepo(`<a href="https://evil.example/r?to=${U0}">x</a>`, K, { html: true }));
  // Codex 8d905ee N1: any scheme other than http/https makes the rest (to the next whitespace) opaque
  for (const t of [`data:text/plain,${U0}`, `mailto:a@example.invalid?body=${U0}`, `javascript:open('${U0}')`, `urn:example:${U0}`, `urn://x/${U0}`, `custom-scheme:${U0}`, `Repo:${U0}`])
    expect(`A2 (−) N1 opaque non-http scheme: ${t.slice(0, 28)}…`, !sourceListsRepo(t, K, { html: true }));
  expect("A2 (+) N1 a non-http scheme only hides text up to the next whitespace", sourceListsRepo(`data:text/plain,x ${U0}`, K, { html: true }));
  expect("A2 (+) N1 host:443 is a port, not a scheme", sourceListsRepo("see github.com:443/fake-vendor/fake-official-mcp-server", K));
  expect("A2 (+) N1 an https URL inside is not re-scanned for schemes (query mailto: stays part of it)", sourceListsRepo(`${U0}?next=mailto:x`, K));
  for (const [t, want] of [
    ["公式リポジトリ: github.com/fake-vendor/fake-official-mcp-server を参照", true], ["<a href=\"//github.com/fake-vendor/fake-official-mcp-server\">x</a>", true], ["<a href=//www.github.com/fake-vendor/fake-official-mcp-server>x</a>", true], ["<img src=//github.com/fake-vendor/fake-official-mcp-server/raw/main/x.png>", true],
    ["evil.example/?to=github.com/fake-vendor/fake-official-mcp-server", false], ["evil.example/?to=//github.com/fake-vendor/fake-official-mcp-server", false], ["<a href=\"evil.example/r?to=//github.com/fake-vendor/fake-official-mcp-server\">", false], ["a?to=x&href=//github.com/fake-vendor/fake-official-mcp-server", false],
    ["https://evil.example/github.com/fake-vendor/fake-official-mcp-server", false], ["//evil.example/?to=//github.com/fake-vendor/fake-official-mcp-server", false], ["foo.github.com/fake-vendor/fake-official-mcp-server", false], ["github.com:8443/fake-vendor/fake-official-mcp-server", false],
  ] as const) expect(`A2 text ${want ? "(+)" : "(−)"} ${t.replace("fake-vendor/fake-official-mcp-server", "…")}`, sourceListsRepo(t, K, { html: true }) === want);
}

// ── Part A3: attribution-attest.mjs (bodies, targets, the attestation validator) ──
const SEAL_DIGEST = JSON.parse(readFileSync(join(FIX, "taskpack-m994-attribution.json"), "utf-8")).marker.expected_digest;
{
  // column B's body: the whole item, minus exactly _meta.attempt_id (string) and freshness.data_age_days (integer ≥ 0)
  const item = (o: any = {}) => ({ service_id: "s", name: "N", mcp_status: "official", trust_score: 0.5, tags: ["x", "y"], connection_guide: null, freshness: { confidence: "medium", data_age_days: 3, last_refreshed: "2026-09-04 17:10:55" }, _meta: { source: "kansei-link", attempt_id: "0901886c-9053-494f-af18-a38d280f63ab", kansei_link: { intent: "service_profile" } }, ...o });
  const UUID2 = "11111111-2222-4333-8444-555555555555";
  const base = sha256Hex(catalogBody(item()));
  const withMeta = (m: any) => item({ _meta: { ...item()._meta, ...m } });
  const withFresh = (f: any) => item({ freshness: { ...item().freshness, ...f } });
  expect("A3 body: a new lower-case UUID attempt_id keeps the sha256 (no needless expiry)", sha256Hex(catalogBody(withMeta({ attempt_id: UUID2 }))) === base);
  expect("A3 body: data_age_days 0 and 100000 keep the sha256", sha256Hex(catalogBody(withFresh({ data_age_days: 0 }))) === base && sha256Hex(catalogBody(withFresh({ data_age_days: 100000 }))) === base);
  expect("A3 body: a new data_age_days keeps the sha256", sha256Hex(catalogBody(withFresh({ data_age_days: 4 }))) === base);
  expect("A3 body: key order does not matter (canonical JSON)", sha256Hex(catalogBody(JSON.parse(JSON.stringify({ ...item(), service_id: "s" }).replace('"service_id":"s",', "")))) !== "" && catalogBody({ b: 1, a: { d: 1, c: 2 } }) === catalogBody({ a: { c: 2, d: 1 }, b: 1 }));
  for (const [what, it] of [
    ["_repository added (Codex ① case 1)", item({ _repository: "https://github.com/x/y" })],
    ["_meta.repository added (case 2)", withMeta({ repository: "https://github.com/x/y" })],
    ["freshness.repository added (case 3)", withFresh({ repository: "https://github.com/x/y" })],
    ["freshness.confidence changed (case 4)", withFresh({ confidence: "https://github.com/x/y" })],
    ["freshness.last_refreshed changed", withFresh({ last_refreshed: "2026-09-05 00:00:00" })],
    ["_meta.source changed", withMeta({ source: "other" })],
    ["a number changed (trust_score)", item({ trust_score: 0.6 })],
    ["null became a value (connection_guide)", item({ connection_guide: { repository: "https://github.com/x/y" } })],
    ["array order changed", item({ tags: ["y", "x"] })],
    ["attempt_id of an unexpected type (object) stays in the body", withMeta({ attempt_id: { repository: "https://github.com/x/y" } })],
    ["Codex 1391a31 R1: attempt_id that is a URL stays in the body", withMeta({ attempt_id: "https://github.com/x/y" })],
    ["Codex 1391a31 R1: attempt_id in UPPER case stays in the body", withMeta({ attempt_id: "0901886C-9053-494F-AF18-A38D280F63AB" })],
    ["Codex 1391a31 R1: attempt_id that is not a UUID (attempt-one) stays in the body", withMeta({ attempt_id: "attempt-one" })],
    ["Codex 1391a31 R1: empty attempt_id stays in the body", withMeta({ attempt_id: "" })],
    ["Codex 1391a31 R1: a UUID with a trailing character stays in the body", withMeta({ attempt_id: `${UUID2}x` })],
    ["Codex 1391a31 R1: data_age_days 100001 stays in the body", withFresh({ data_age_days: 100001 })],
    ["Codex 1391a31 R1: data_age_days 1e9 stays in the body", withFresh({ data_age_days: 1000000000 })],
    ["data_age_days of an unexpected type (string) stays in the body", withFresh({ data_age_days: "https://github.com/x/y" })],
    ["data_age_days negative stays in the body", withFresh({ data_age_days: -1 })],
    ["a new top-level key", item({ repository: "https://github.com/x/y" })],
  ] as const) expect(`A3 body changes when: ${what}`, sha256Hex(catalogBody(it)) !== base);
  expect("A3 body: the not-found payload has a body too", /^[0-9a-f]{64}$/.test(sha256Hex(catalogBody({ error: "Service 'x' not found." }))));
  // targets fixed by the taskpack
  const cfg = { official_docs: [{ id: "A1", url: "https://example.invalid/a1" }, { id: "A2", url: "https://example.invalid/a2" }], catalog: { display_api_url: "https://example.invalid/mcp", service_id: "svc", body_fields: B_BODY_FIELDS } };
  expect("A3 target A1/A2 = the URL fixed in the taskpack", sourceTarget(cfg, "A1") === "https://example.invalid/a1" && sourceTarget(cfg, "A2") === "https://example.invalid/a2");
  expect("A3 target B = catalog endpoint + service_id + field spec", sourceTarget(cfg, "B") === `kansei-catalog https://example.invalid/mcp service_id=svc fields=${B_BODY_FIELDS}`);
  expect("A3 the field spec names the exclusion grammar (Codex 1391a31 R1)", B_BODY_FIELDS === "all_except:_meta.attempt_id(rfc4122-uuid-lowercase),freshness.data_age_days(int 0..100000)");
  expect("A3 target of an unknown source = null", sourceTarget(cfg, "A9") === null);
  // the validator (allow-lists, Codex review of 5758e0a): deciding fields are bound to allowed values; reason is a note
  const sha = "c".repeat(64);
  const ctx = { markerId: "M-994", expectedDigest: SEAL_DIGEST, sourceId: "B", target: sourceTarget(cfg, "B"), bodySha: sha, observers: ["human:synapse-arrows"], today: "2026-09-29" };
  const good = (o: any = {}) => ({ attestation: ATTESTATION_KIND, marker_id: "M-994", expected_digest: SEAL_DIGEST, source_id: "B", target: ctx.target, body_sha256: sha, verdict: "not_listed", observer: "human:synapse-arrows", date: "2026-09-29", reason: "read the whole item; no link to the sealed repository", ...o });
  const ch = (n: number) => String.fromCharCode(n);
  expect("A3 valid: verdict not_listed", validateAttestation(good(), ctx) === null, String(validateAttestation(good(), ctx)));
  expect("A3 valid: verdict listed", validateAttestation(good({ verdict: "listed", reason: "connection_guide names the repository" }), ctx) === null);
  expect("A3 valid: date earlier than today", validateAttestation(good({ date: "2026-09-28" }), ctx) === null);
  expect("A3 valid: an observer listed in observers.json (with a space)", validateAttestation(good({ observer: "human:Audit Fixture Reviewer" }), { ...ctx, observers: ["human:synapse-arrows", "human:Audit Fixture Reviewer"] }) === null);
  // reason is a note: its words never decide, they only raise a private caution
  for (const r of ["TODO", "todo", "TBD", "TODOreview", "reviewTODO", "TBDpending", "reviewTBD", "<名前>", "[name]", "{name}", " Pending ", "read it TODO later", "todos los campos leídos"]) {
    const why = validateAttestation(good({ reason: r }), ctx);
    expect(`A3 valid: reason ${JSON.stringify(r)} is only a note (does not decide)`, why === null, String(why));
  }
  expect("A3 reasonCautions: TODOreview / TBD / <…> / […] / {…} → reason_looks_unfinished; a plain note → none", ["TODOreview", "reviewTBD", "<x>", "[x]", "{x}"].every((r) => JSON.stringify(reasonCautions({ reason: r })) === '["reason_looks_unfinished"]') && reasonCautions({ reason: "read the whole page" }).length === 0);
  const bad: Array<[string, any, string, any?]> = [
    ["an extra key", good({ extra: "x" }), "keys"], ["_draft_instructions (unsigned draft)", good({ _draft_instructions: "sign" }), "keys"],
    ["the v1 kind", good({ attestation: "kansei-attribution-not-listed/v1" }), "kind"], ["another marker", good({ marker_id: "M-004" }), "marker_id"],
    ["another seal", good({ expected_digest: "f".repeat(64) }), "expected_digest"], ["another source", good({ source_id: "A1" }), "source_id"],
    ["another body", good({ body_sha256: "d".repeat(64) }), "body_sha256"],
    ["verdict unknown", good({ verdict: "unknown" }), "verdict"], ["verdict Listed (case)", good({ verdict: "Listed" }), "verdict"], ["verdict TODO", good({ verdict: "TODO" }), "verdict"], ["verdict empty", good({ verdict: "" }), "verdict"],
    ["observer not in observers.json (human:someone-else)", good({ observer: "human:someone-else" }), "observer"], ["observer human:TODO", good({ observer: "human:TODO" }), "observer"], ["observer human:<名前>", good({ observer: "human:<名前>" }), "observer"],
    ["observer claude", good({ observer: "claude" }), "observer"], ["observer agent:test", good({ observer: "agent:test" }), "observer"], ["observer with a trailing space", good({ observer: "human:synapse-arrows " }), "observer"], ["observer in another case", good({ observer: "human:Synapse-Arrows" }), "observer"],
    ["observers.json empty → nobody", good(), "observer", { observers: [] }], ["observers.json missing → nobody", good(), "observer", { observers: undefined }],
    ["date 2026-02-30", good({ date: "2026-02-30" }), "date"], ["date 2026-13-01 (no exception)", good({ date: "2026-13-01" }), "date"], ["date YYYY-MM-DD", good({ date: "YYYY-MM-DD" }), "date"], ["date TODO", good({ date: "TODO" }), "date"], ["date 2026-9-29", good({ date: "2026-9-29" }), "date"],
    ["date after today", good({ date: "2026-09-30" }), "date_after_today"], ["today unknown", good(), "date_after_today", { today: undefined }],
    ["reason empty", good({ reason: "" }), "reason"], ["reason blank", good({ reason: "   " }), "reason"], ["reason over 200", good({ reason: "x".repeat(201) }), "reason"],
    ["reason with LF", good({ reason: "a\nb" }), "reason"], ["reason with CR", good({ reason: "a\rb" }), "reason"], ["reason with TAB", good({ reason: "a\tb" }), "reason"], ["reason with NUL", good({ reason: `a${ch(0)}b` }), "reason"],
    ["reason with DEL", good({ reason: `a${ch(0x7f)}b` }), "reason"], ["reason with U+0085", good({ reason: `a${ch(0x85)}b` }), "reason"], ["reason with U+2028", good({ reason: `a${ch(0x2028)}b` }), "reason"], ["reason with U+2029", good({ reason: `a${ch(0x2029)}b` }), "reason"],
    ["target: the service_id alone", good({ target: "fake-subject" }), "target"], ["target TODO", good({ target: "TODO" }), "target"], ["target: another service_id", good({ target: ctx.target.replace("service_id=svc", "service_id=other") }), "target"],
    ["target: other fields", good({ target: ctx.target.replace("freshness.data_age_days", "freshness") }), "target"], ["target: trailing space", good({ target: `${ctx.target} ` }), "target"],
    ["verdict null (not a string)", good({ verdict: null }), "not_a_string:verdict"], ["reason a number", good({ reason: 1 }), "not_a_string:reason"],
  ];
  for (const k of ["attestation", "marker_id", "expected_digest", "source_id", "target", "body_sha256", "verdict", "observer", "date", "reason"]) {
    const o = good(); delete (o as any)[k]; bad.push([`missing ${k}`, o, "keys"]);
  }
  // the draft form: no verdict (a person writes it in) and the draft mark
  const { verdict: _v, ...noVerdict } = good();
  bad.push(["draft form: no verdict + _draft_instructions", { ...noVerdict, _draft_instructions: "sign" }, "keys"], ["draft form: no verdict", noVerdict, "keys"]);
  for (const [why, a, code, over] of bad) { const got = validateAttestation(a, { ...ctx, ...(over || {}) }); expect(`A3 invalid: ${why} → ${code}`, got === code, String(got)); }
  // observers.json: exact list of "human:…" strings, else nobody
  const od = mkdtempSync(join(tmpdir(), "att-observers-"));
  expect("A3 loadObservers: no file → []", loadObservers(od).length === 0 && loadObservers("").length === 0);
  for (const [content, want] of [['["human:synapse-arrows"]', ["human:synapse-arrows"]], ["[]", []], ['["agent:x"]', []], ['["human:a", 1]', []], ['{"human:a":true}', []], ['"human:a"', []], ["not json", []], ['["human:Audit Fixture Reviewer"]', ["human:Audit Fixture Reviewer"]], ['["human: leading"]', []], ['["human:trailing "]', []], ['["human:"]', []], ['["human:a\\tb"]', []]] as const) {
    writeFileSync(join(od, "observers.json"), content);
    expect(`A3 loadObservers(${content}) → ${JSON.stringify(want)}`, JSON.stringify(loadObservers(od)) === JSON.stringify(want));
  }
  rmSync(od, { recursive: true, force: true });
  expect("A3 the repository's observers.json is exactly [\"human:synapse-arrows\"]", JSON.stringify(loadObservers(join(ROOT, "evidence", "attestations"))) === '["human:synapse-arrows"]');
  expect("A3 localToday is the local calendar date", localToday(new Date(2026, 8, 29, 0, 30)) === "2026-09-29" && localToday(new Date(2026, 0, 1, 23, 59)) === "2026-01-01");
  // findAttestation / sourceState read at most two files (observers.json + one attestation), never throw
  const d = mkdtempSync(join(tmpdir(), "att-unit-"));
  writeFileSync(join(d, "observers.json"), '["human:synapse-arrows"]');
  const { observers: _o, today: _t, ...ctxFile } = ctx; // findAttestation reads observers.json and today itself
  writeFileSync(join(d, `M-994-B-${sha}.json`), JSON.stringify(good({ verdict: "listed", reason: "the item names the repository" })));
  expect("A3 findAttestation: valid listed (observers.json read from the directory)", JSON.stringify(findAttestation(d, ctxFile)) === JSON.stringify({ verdict: "listed", why: "valid", cautions: [] }), JSON.stringify(findAttestation(d, ctxFile)));
  writeFileSync(join(d, `M-994-B-${sha}.json`), JSON.stringify(good({ verdict: "listed", reason: "TODOreview" })));
  expect("A3 findAttestation: an unfinished-looking note is valid with a caution", JSON.stringify(findAttestation(d, ctxFile)) === JSON.stringify({ verdict: "listed", why: "valid", cautions: ["reason_looks_unfinished"] }));
  writeFileSync(join(d, `M-994-B-${sha}.json`), JSON.stringify(good({ date: "2026-13-01" })));
  expect("A3 findAttestation: 2026-13-01 → invalid:date (not unreadable)", findAttestation(d, ctxFile).why === "invalid:date");
  writeFileSync(join(d, `M-994-B-${sha}.json`), JSON.stringify(good({ date: "2999-01-01" })));
  expect("A3 findAttestation: a date after today → invalid:date_after_today", findAttestation(d, ctxFile).why === "invalid:date_after_today");
  writeFileSync(join(d, `M-994-B-${sha}.json`), JSON.stringify(good({ verdict: "listed" })));
  expect("A3 sourceState: attested listed / recheck (other body) / unread", sourceState({ fetched: true, bodySha: sha, dir: d, ctx: ctxFile }).state === "listed" && sourceState({ fetched: true, bodySha: "e".repeat(64), dir: d, ctx: ctxFile }).state === "recheck" && sourceState({ fetched: false, bodySha: null, dir: d, ctx: ctxFile }).state === "unread");
  rmSync(join(d, "observers.json"));
  expect("A3 findAttestation: observers.json removed → invalid:observer (nobody may sign)", findAttestation(d, ctxFile).why === "invalid:observer");
  writeFileSync(join(d, `M-994-B-${sha}.json`), "{not json");
  expect("A3 findAttestation: unreadable file → recheck, no throw", sourceState({ fetched: true, bodySha: sha, dir: d, ctx: ctxFile }).state === "recheck" && findAttestation(d, ctxFile).why === "unreadable");
  expect("A3 findAttestation: no dir / bad sha → no verdict", findAttestation("", ctxFile).verdict === null && findAttestation(d, { ...ctxFile, bodySha: "../x" }).why === "no_body");
  rmSync(d, { recursive: true, force: true });
}

// ── Part B: end to end on loopback ───────────────────────────────────────
const REPO = "https://github.com/fake-vendor/fake-official-mcp-server";
const mode: Record<string, string> = { a1: "none", a2: "listed", catalog: "no_repo", gh: "ok" };
const page = (m: string) => m === "listed" ? `<html><body><a href="${REPO}">公式 MCP</a></body></html>`
  : m === "other_repo" ? `<html><body><a href="https://github.com/other/other">x</a></body></html>`
  : m === "dot_tail" ? `<html><body><a href="${REPO}/..">x</a></body></html>`
  : m === "nested_data" ? `<html><body><a href="data:text/plain,${REPO}">PAGE_CANARY_PRIVATE</a></body></html>`
  : m === "percent_names" ? `<html><body><a href="https://github.com/%66%61%6b%65-vendor/%66%61%6b%65-official-mcp-server">PAGE_CANARY_PRIVATE</a></body></html>`
  : m === "entity_hyphen" ? `<html><body><a href="https://github.com/fake&hyphen;vendor/fake-official-mcp-server">x</a></body></html>` : "<html><body>AI 活用</body></html>";
// the fake catalog item; _meta.attempt_id and freshness.data_age_days move on every call, like the real ones
const catalogItem = (id: string, m = mode.catalog): any => {
  const item: any = { service_id: id, name: "Fake", mcp_endpoint: "https://<your-host>/mcp", mcp_status: "official", api_auth_method: "oauth2", freshness: { confidence: "medium", data_age_days: Math.floor(Math.random() * 99) }, _meta: { attempt_id: randomUUID() }, connection_guide: { steps: ["install"] } };
  if (m === "attempt_url") item._meta.attempt_id = REPO;
  if (m === "attempt_upper") item._meta.attempt_id = "0901886C-9053-494F-AF18-A38D280F63AB";
  if (m === "age_negative") item.freshness.data_age_days = -1;
  if (m === "age_huge") item.freshness.data_age_days = 1000000000;
  if (m === "repo_in_guide") item.connection_guide.repository = REPO;
  if (m === "bracket_relative") item.connection_guide.repository = "[//github.com/fake-vendor/fake-official-mcp-server]";
  if (m === "repo_in_meta") item._meta.repository = REPO;
  if (m === "repo_in_freshness") item.freshness.repository = REPO;
  if (m === "nested_data") item.description = `CATALOG_CANARY_PRIVATE data:text/plain,${REPO}`;
  if (m === "percent_names") item.description = "CATALOG_CANARY_PRIVATE https://github.com/%66%61%6b%65-vendor/%66%61%6b%65-official-mcp-server";
  return item;
};
const ABSENT = (id: string) => ({ error: `Service '${id}' not found. Use search_services to find valid service IDs.` });
const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const u = req.url || "";
    if (u === "/a1" || u === "/a2") {
      const m = mode[u.slice(1)];
      if (m === "500") { res.writeHead(500); return res.end(); }
      if (m === "404") { res.writeHead(404); return res.end(); }
      // Codex R1: HTTP 200 and the start of a body, then the connection is cut before Content-Length is reached
      if (m === "body_reset") { res.writeHead(200, { "content-type": "text/html", "content-length": "5000" }); res.write("<html><body>AI 活用"); return setTimeout(() => res.destroy(), 50); }
      res.writeHead(200, { "content-type": "text/html" }); return res.end(page(m));
    }
    if (u === "/mcp") {
      const rpc = JSON.parse(body || "{}"); const id = rpc.params?.arguments?.service_id;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const sse = (msg: any) => res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      if (mode.catalog === "rpc_error") return sse({ jsonrpc: "2.0", id: rpc.id, error: { code: -32603, message: "Internal error" } });
      if (mode.catalog === "absent") return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(ABSENT(id)) }] } });
      return sse({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(catalogItem(id)) }] } });
    }
    if (u === "/gh/repos/fake-vendor/fake-official-mcp-server") {
      if (mode.gh === "404") { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
      if (mode.gh === "hang") return; // never answers: the harness's GitHub timeout must end it (→ U0)
      const d: any = { full_name: "fake-vendor/fake-official-mcp-server", private: false, archived: false };
      if (mode.gh === "renamed") d.full_name = "fake-vendor/fake-mcp-server-v2";
      if (mode.gh === "archived") d.archived = true;
      if (mode.gh === "case") d.full_name = "Fake-Vendor/Fake-Official-MCP-Server";
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(d));
    }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>((r) => server.listen(47336, "127.0.0.1", () => r()));
const tmp = mkdtempSync(join(tmpdir(), "fake-attr-"));
const answersPath = join(tmp, "answers.json");
writeFileSync(answersPath, JSON.stringify({ fake: `説明。\nREPO: ${REPO}\nAUTH: OAuth 2.0` }));
const attDir = join(tmp, "attestations"); mkdirSync(attDir, { recursive: true });
writeFileSync(join(attDir, "observers.json"), JSON.stringify(["human:smoke-tester"])); // the fixture's allow-list of observers
const BASE = "http://127.0.0.1:47336";
const env = { ...process.env, KANSEI_M994_SEALED_PATH: join(FIX, "M-994.sealed.json"), KANSEI_FAKE_LLM_ANSWERS_FILE: answersPath, KANSEI_FAKE_ATTR_BASE: BASE, KANSEI_FAKE_ATTESTATIONS_DIR: attDir };
const PACK_ATTR = JSON.parse(JSON.stringify(JSON.parse(readFileSync(join(FIX, "taskpack-m994-attribution.json"), "utf-8")).marker.attribution).replaceAll("${ENV:KANSEI_FAKE_ATTR_BASE}", BASE));
const pageSha = (m: string) => sha256Hex(Buffer.from(page(m), "utf8"));
const bSha = (payload: any) => sha256Hex(catalogBody(payload));
// write a (valid unless overridden) human attestation for one source and body
function attest(sourceId: string, bodySha: string, verdict: "listed" | "not_listed", over: Record<string, any> = {}, fileSha = bodySha) {
  const a: any = { attestation: ATTESTATION_KIND, marker_id: "M-994", expected_digest: SEAL_DIGEST, source_id: sourceId, target: sourceTarget(PACK_ATTR, sourceId), body_sha256: bodySha, verdict, observer: "human:smoke-tester", date: "2026-09-29", reason: "read the whole body", ...over };
  for (const k of Object.keys(over)) if (over[k] === undefined) delete a[k];
  writeFileSync(join(attDir, `M-994-${sourceId}-${fileSha}.json`), JSON.stringify(a));
}
const clearAtt = () => { for (const f of readdirSync(attDir)) if (f !== "observers.json") rmSync(join(attDir, f)); };
const schema = loadReadingSchema();
async function run(extra: string[] = []) {
  const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m994-attribution.json", "--dry-run", ...extra], { cwd: ROOT, env });
  const m = /evidence: (\S+?)\/ \(manifest/.exec(r.out);
  const bundle = m ? join(ROOT, m[1]) : null;
  const metrics = bundle && existsSync(join(bundle, "metrics.json")) ? JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8")) : null;
  const priv = bundle && existsSync(join(bundle, "environment.private.json")) ? JSON.parse(readFileSync(join(bundle, "environment.private.json"), "utf-8")) : { diagnostics: [] };
  const pub = bundle ? ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(bundle, f), "utf-8")).join("\n") : "";
  const rel = bundle ? bundle.slice(ROOT.length + 1).replaceAll("\\", "/") : "none";
  const full = (x: any) => ({ ...x, evidence_ref: `${rel}#sha256:${"a".repeat(64)}` });
  const by = (method: string) => (metrics?.readings || []).filter((x: any) => x.observed.method === method).map(full);
  const diag = (id: string) => priv.diagnostics.find((d: any) => d.event === "attribution_source" && d.source_id === id);
  return { ...r, bundle, metrics, priv, pub, diag, A: by(ATTR_METHODS.A)[0], B: by(ATTR_METHODS.B)[0], agent: by(AGENT_METHOD)[0], gt: by("sealed_repo_vs_github_api")[0] };
}
const ok = (o: any, label: string) => (o?.checks || []).find((c: any) => c.label === label)?.ok;
// row encoding: pass = listed; instrument_error = unknown; otherwise not listed — both only by human attestation (§4-2)
const stateOf = (o: any) => (!o ? "missing" : o.pass ? "listed" : o.instrument_error ? "unknown" : "not_listed");
// the judgement (規則 v0.1) of one loopback run, as the sheet would print it
const judgeOf = (r: any) => attributionLines([r.A, r.B, r.agent, r.gt].filter(Boolean).map((x: any) => ({ ...x, outcome_id: x.observed.method === AGENT_METHOD ? 1 : null })))[0]?.judgement.code;
let day1: any = null, renamedRun: any = null, recheckRun: any = null;
try {
  // (1) the real day-one shape: A1 without, A2 with, catalog item without the repo, repo unchanged
  {
    const r = await run(); recheckRun = r;
    expect("B1 exit 0", r.status === 0, r.out.slice(-500));
    expect("B1 attribution line printed (no attestation: A and B unknown, 要再確認=A1,A2,B)", /attribution: A official docs=unknown B KanseiLINK catalog=unknown 要再確認=A1,A2,B/.test(r.out), r.out.slice(-400));
    expect("B1 no attestation: A unknown even though A2 links the repo (the automatic reading decides nothing)", stateOf(r.A?.observed) === "unknown" && ok(r.A?.observed, "A2_needs_recheck") === true && ok(r.A?.observed, "A1_needs_recheck") === true && ok(r.A?.observed, "A2_attested_listed") === false, JSON.stringify(r.A?.observed));
    expect("B1 no attestation: B unknown, needs recheck, item present", stateOf(r.B?.observed) === "unknown" && ok(r.B?.observed, "catalog_item_needs_recheck") === true && ok(r.B?.observed, "catalog_item_present") === true && ok(r.B?.observed, "catalog_body_fields_fixed") === true, JSON.stringify(r.B?.observed));
    expect("B1 judgement without attestations = U1 (nobody is blamed, nobody is credited)", judgeOf(r) === "U1", judgeOf(r));
    expect("B1 the private sidecar records each body sha256, 要再確認, and the hint", r.diag("A1")?.body_sha256 === pageSha("none") && r.diag("A2")?.body_sha256 === pageSha("listed") && r.diag("B")?.body_sha256 === bSha(catalogItem("fake-subject")) && [r.diag("A1"), r.diag("A2"), r.diag("B")].every((d: any) => d.needs_recheck === true && d.state === "recheck" && d.attestation === "none_for_this_body") && r.priv.diagnostics.some((d: any) => d.event === "attribution_needs_recheck" && JSON.stringify(d.sources) === '["A1","A2","B"]'), JSON.stringify(r.priv.diagnostics));
    expect("B1 the private sidecar names each source's target (what a person attests)", r.diag("A1")?.target === `${BASE}/a1` && r.diag("B")?.target === sourceTarget(PACK_ATTR, "B"));
    expect("B1 the hint stays private: A2 hint listed, A1 hint unknown, B hint unknown", r.diag("A2")?.hint?.state === "listed" && r.diag("A1")?.hint?.state === "unknown" && r.diag("B")?.hint?.state === "unknown" && /判断に使わない/.test(r.diag("B")?.hint?.note || ""), JSON.stringify([r.diag("A2")?.hint, r.diag("B")?.hint]));
    expect("B1 no hint, no body sha256, no repository value in the public files", !/hint|手がかり|fake-official-mcp-server/.test(r.pub) && ![pageSha("none"), pageSha("listed"), bSha(catalogItem("fake-subject"))].some((s) => r.pub.includes(s)));
    expect("B1 the public log marks 要再確認 by source id only", /"event":"attribution","column":"A","listed":false,"not_listed":false,"instrument":"other","needs_recheck":\["A1","A2"\]/.test(r.pub) && /"column":"B","listed":false,"not_listed":false,"instrument":"other","needs_recheck":true/.test(r.pub), r.pub.split("\n").filter((l) => l.includes("attribution")).join(" | "));
    const rr = readmeRows(r.metrics.readings.map((x: any) => ({ ...x, _outcome: x.observed.method === AGENT_METHOD ? {} : null })));
    expect("B1 README rows carry the 要再確認 mark for A and B", rr.gtRows.includes(`A 公式情報: ${RECHECK_TEXT}（A1 要再確認・A2 要再確認）`) && rr.gtRows.includes(`B KanseiLINK: ${RECHECK_TEXT}`), rr.gtRows);
    // a person attests: A2 listed, B not listed (for exactly these bodies)
    attest("A2", pageSha("listed"), "listed"); attest("B", bSha(catalogItem("fake-subject")), "not_listed");
    const ra = await run(); day1 = ra;
    expect("B1 attested A2 listed + B not listed → A listed, B not listed, judgement #3 KanseiLINK 側の穴", stateOf(ra.A?.observed) === "listed" && stateOf(ra.B?.observed) === "not_listed" && judgeOf(ra) === "#3" && [ra.A, ra.B].every((x: any) => validateReading(x, schema).length === 0), `${judgeOf(ra)} ${JSON.stringify([ra.A?.observed, ra.B?.observed])}`);
    expect("B1 with A2 attested, A1 still needs recheck (marked, but A is listed)", ok(ra.A?.observed, "A1_needs_recheck") === true && /要再確認=A1\b/.test(ra.out) && !/要再確認=.*B/.test(ra.out), ra.out.slice(-300));
    expect("B1 the volatile fields (_meta.attempt_id, freshness.data_age_days) move on every call yet the attestation holds", catalogItem("fake-subject")._meta.attempt_id !== catalogItem("fake-subject")._meta.attempt_id && bSha(catalogItem("fake-subject")) === bSha(catalogItem("fake-subject")));
    // the person decides against the automatic reading, both ways
    clearAtt(); attest("A1", pageSha("none"), "listed", { reason: "the page names the repository in an image caption" }); attest("A2", pageSha("listed"), "not_listed", { reason: "the link is to an unrelated mirror" }); attest("B", bSha(catalogItem("fake-subject")), "listed", { reason: "the item names the repository" });
    const rh = await run();
    expect("B1 a person's verdict wins over the hint both ways (A1 attested listed with hint unknown, A2 attested not listed with hint listed)", ok(rh.A?.observed, "A1_attested_listed") === true && ok(rh.A?.observed, "A2_attested_not_listed") === true && stateOf(rh.A?.observed) === "listed" && stateOf(rh.B?.observed) === "listed" && judgeOf(rh) === "#1" && rh.diag("A2")?.hint?.state === "listed", `${judgeOf(rh)} ${JSON.stringify(rh.A?.observed.checks)}`);
    clearAtt(); attest("A1", pageSha("none"), "not_listed"); attest("A2", pageSha("listed"), "not_listed"); attest("B", bSha(catalogItem("fake-subject")), "not_listed");
    const r7 = await run();
    expect("B1 every source attested not listed → A not listed, B not listed, #7", stateOf(r7.A?.observed) === "not_listed" && ok(r7.A?.observed, "official_docs_attested_not_listed") === true && stateOf(r7.B?.observed) === "not_listed" && judgeOf(r7) === "#7", judgeOf(r7));
    // an attestation that does not match exactly is ignored → 要再確認
    const B0 = bSha(catalogItem("fake-subject"));
    for (const [why, over, fileSha] of [
      ["another body (file named for another sha)", {}, "0".repeat(64)],
      ["another seal", { expected_digest: "f".repeat(64) }, undefined],
      ["unsigned draft (extra _draft_instructions key)", { _draft_instructions: "sign me" }, undefined],
      ["placeholder observer", { observer: "human:<名前>" }, undefined],
      ["observer human:TODO", { observer: "human:TODO" }, undefined],
      ["observer not in observers.json", { observer: "human:someone-else" }, undefined],
      ["date after today", { date: "2999-01-01" }, undefined],
      ["reason with U+2028", { reason: `a${String.fromCharCode(0x2028)}b` }, undefined],
      ["draft form (no verdict, draft mark)", { verdict: undefined, _draft_instructions: "sign" }, undefined],
      ["target TODO", { target: "TODO" }, undefined],
      ["target = the service_id alone", { target: "fake-subject" }, undefined],
      ["observer not human", { observer: "claude" }, undefined],
      ["verdict unknown", { verdict: "unknown" }, undefined],
      ["verdict TODO", { verdict: "TODO" }, undefined],
      ["missing reason", { reason: undefined }, undefined],
      ["placeholder date", { date: "YYYY-MM-DD" }, undefined],
      ["another source id", { source_id: "A1" }, undefined],
      ["the v1 kind", { attestation: "kansei-attribution-not-listed/v1" }, undefined],
    ] as const) {
      clearAtt(); attest("B", B0, "not_listed", over as any, (fileSha as any) ?? B0);
      const rx = await run();
      expect(`B1 invalid attestation (${why}) is ignored → B unknown, 要再確認`, stateOf(rx.B?.observed) === "unknown" && ok(rx.B?.observed, "catalog_item_needs_recheck") === true && String(rx.diag("B")?.attestation).startsWith(fileSha ? "none_for_this_body" : "invalid:"), `${JSON.stringify(rx.B?.observed.checks)} ${rx.diag("B")?.attestation}`);
    }
    for (const note of ["TBD", "[reason]", "TODOreview"]) {
      clearAtt(); attest("B", B0, "not_listed", { reason: note });
      const rn = await run();
      expect(`B1 reason ${JSON.stringify(note)} is only a note: the person's verdict stands (B not listed) and the private sidecar carries a caution`, stateOf(rn.B?.observed) === "not_listed" && JSON.stringify(rn.diag("B")?.attestation_cautions) === '["reason_looks_unfinished"]' && !/reason_looks_unfinished/.test(rn.pub), JSON.stringify(rn.diag("B")));
    }
    clearAtt();
    expect("B1 attribution rows are ground-truth side (model none, done, sealed_ method)", [r.A, r.B].every((x: any) => x?.target.model === "none" && x?.stage_reached === "done" && x?.observed.method.startsWith("sealed_")));
    expect("B1 attribution rows pass reading.v1", [r.A, r.B].every((x: any) => validateReading(x, schema).length === 0), JSON.stringify([r.A, r.B].map((x: any) => validateReading(x, schema))));
    expect("B1 ground truth consistent, no GT row, agent pass", r.agent?.observed.ground_truth_consistent === true && !r.gt && r.agent?.observed.pass === true);
    expect("B1 one agent reading + two attribution rows", r.metrics?.readings?.length === 3, String(r.metrics?.readings?.length));
    expect("B1 manifest fingerprints attribution-attest, attribution-rules and all six vendored decoder files", ["lib/attribution-attest.mjs", "lib/attribution-rules.mjs", "vendor/entities-8.1.0/decode.js", "vendor/entities-8.1.0/decode-codepoint.js", "vendor/entities-8.1.0/generated/decode-data-html.js", "vendor/entities-8.1.0/generated/decode-data-xml.js", "vendor/entities-8.1.0/internal/bin-trie-flags.js", "vendor/entities-8.1.0/internal/decode-shared.js"].every((k) => /^[0-9a-f]{64}$/.test(JSON.parse(readFileSync(join(r.bundle!, "manifest.json"), "utf-8")).executor.libs[k] || "")));
    expect("B1 no repository value in public files", !/fake-official-mcp-server/.test(r.pub));
  }
  // (2) catalog variants
  {
    mode.catalog = "repo_in_guide";
    const r = await run();
    expect("B2 catalog names the repo, no attestation → B unknown (hint listed, private, with the field name)", stateOf(r.B?.observed) === "unknown" && r.diag("B")?.hint?.state === "listed" && JSON.stringify(r.diag("B")?.hint?.fields) === '["connection_guide.repository"]' && !/connection_guide\.repository/.test(r.pub), JSON.stringify(r.diag("B")));
    attest("B", bSha(catalogItem("fake-subject")), "listed");
    const rl = await run();
    expect("B2 catalog names the repo, attested listed → B correct", stateOf(rl.B?.observed) === "listed" && columnB(rl.B?.observed).text === "正しい・人の確認");
    clearAtt();
    {
      const { readCatalogDisplay } = await import("../exec-harness/lib/marker-targets.mjs");
      const d0 = await readCatalogDisplay(`${BASE}/mcp`, "fake-subject");
      const d1 = await readCatalogDisplay(`${BASE}/mcp`, "fake-subject", 20000, { keepPayload: true });
      const { payload, freshness: _f1, ...rest } = d1 as any; const { freshness: _f0, ...rest0 } = d0 as any; // the fake item's freshness moves on every call, like the real one
      expect("B2 keepPayload: default off returns no payload (M-002 unchanged), on returns it, other fields identical", !("payload" in d0) && typeof payload === "object" && JSON.stringify(rest) === JSON.stringify(rest0));
    }
    // Codex 7e9a3e2 ①: a link added to a field that used to be excluded changes the body and expires the old "not listed"
    mode.catalog = "no_repo";
    const noRepoSha = bSha(catalogItem("fake-subject"));
    attest("B", noRepoSha, "not_listed"); attest("A2", pageSha("listed"), "listed");
    for (const m of ["repo_in_meta", "repo_in_freshness"]) {
      mode.catalog = m;
      const rx = await run();
      expect(`B2 Codex ① ${m}: the body sha256 changes, the old "not listed" expires → B 未確定（要再確認）, U2, never #3`, stateOf(rx.B?.observed) === "unknown" && rx.diag("B")?.body_sha256 !== noRepoSha && judgeOf(rx) === "U2" && columnB(rx.B?.observed).text === RECHECK_TEXT, `${judgeOf(rx)} ${rx.diag("B")?.body_sha256}`);
    }
    // Codex 1391a31 R1 (Michie 2026-09-30): only the exact grammar of a self-changing value is outside the body
    for (const [why, from, to] of [["(a) attempt_id UUID → a URL to the sealed repo", "no_repo", "attempt_url"], ["(b) attempt_id URL → a UUID", "attempt_url", "no_repo"], ["(c) attempt_id UUID → UPPER-case UUID", "no_repo", "attempt_upper"], ["(d) data_age_days → negative", "no_repo", "age_negative"], ["(d') data_age_days → huge", "no_repo", "age_huge"]] as const) {
      clearAtt(); mode.catalog = from;
      const before = bSha(catalogItem("fake-subject", from));
      attest("B", before, "not_listed"); attest("A2", pageSha("listed"), "listed");
      mode.catalog = to;
      const rx = await run();
      expect(`B2 Codex 1391a31 R1 ${why}: body sha256 changes, the attestation is not found, B unknown, U2`, rx.diag("B")?.body_sha256 !== before && rx.diag("B")?.attestation === "none_for_this_body" && stateOf(rx.B?.observed) === "unknown" && judgeOf(rx) === "U2", `${judgeOf(rx)} ${rx.diag("B")?.attestation}`);
    }
    clearAtt(); mode.catalog = "no_repo";
    expect("B2 a fresh lower-case UUID attempt_id on every call does not change the body (the real catalog)", bSha(catalogItem("fake-subject")) === bSha(catalogItem("fake-subject")) && catalogItem("fake-subject")._meta.attempt_id !== catalogItem("fake-subject")._meta.attempt_id);
    clearAtt();
    mode.catalog = "bracket_relative";
    attest("A2", pageSha("listed"), "listed"); attest("B", bSha(catalogItem("fake-subject")), "listed");
    const rbr = await run();
    expect("B2 (+) Codex R4: catalog field [//github.com/owner/repo] attested listed by a person → B correct, judgement #1 (hint listed)", stateOf(rbr.B?.observed) === "listed" && judgeOf(rbr) === "#1" && rbr.diag("B")?.hint?.state === "listed", `${judgeOf(rbr)} ${JSON.stringify(rbr.B?.observed.checks)}`);
    clearAtt();
    mode.catalog = "absent";
    const r3 = await run();
    expect("B2 catalog has no item, no attestation → B unknown, catalog_item_present false", stateOf(r3.B?.observed) === "unknown" && ok(r3.B?.observed, "catalog_item_present") === false, JSON.stringify(r3.B?.observed));
    attest("B", bSha(ABSENT("fake-subject")), "not_listed");
    const r3a = await run();
    expect("B2 catalog has no item, attested → B not listed (項なし)", stateOf(r3a.B?.observed) === "not_listed" && columnB(r3a.B?.observed).text === "誤り・人の確認（項なし）", JSON.stringify(r3a.B?.observed));
    clearAtt();
    mode.catalog = "rpc_error";
    const r4 = await run();
    expect("B2 catalog unobservable → B unknown (観測できない), not 要再確認", r4.B?.observed.instrument_error === "other" && r4.B?.observed.pass === false && ok(r4.B?.observed, "catalog_item_needs_recheck") === false && columnB(r4.B?.observed).text === "未確定（観測できない）" && validateReading(r4.B, schema).length === 0);
    mode.catalog = "no_repo";
    // the taskpack must fix the body's fields; another spec (or none) → B unknown whatever is attested
    {
      const { TARGETS } = await import("../exec-harness/lib/marker-targets.mjs");
      attest("B", bSha(catalogItem("fake-subject")), "not_listed");
      const sealed = { repo: "github.com/fake-vendor/fake-official-mcp-server", owner: "fake-vendor", name: "fake-official-mcp-server" };
      const call = (catalog: any) => TARGETS.llmAnswer.attribution({ MK: { attribution: { ...PACK_ATTR, attestations_dir: attDir, catalog } }, sealed, harnessLog: () => {}, attestationsDir: attDir, expectedDigest: SEAL_DIGEST, markerId: "M-994" });
      const good = await call(PACK_ATTR.catalog);
      const { body_fields: _drop, ...noFields } = PACK_ATTR.catalog;
      const none = await call(noFields);
      const other = await call({ ...PACK_ATTR.catalog, body_fields: "all" });
      expect("B2 body_fields fixed as the rule says → the attestation applies (not listed)", stateOf(good[1]) === "not_listed");
      expect("B2 body_fields missing or different in the taskpack → B unknown, catalog_body_fields_fixed false", [none[1], other[1]].every((x: any) => stateOf(x) === "unknown" && ok(x, "catalog_body_fields_fixed") === false));
      clearAtt();
    }
  }
  // (3) A variants
  {
    mode.a2 = "none";
    attest("A1", pageSha("none"), "not_listed");
    const rOne = await run();
    expect("B3 only A1 attested not listed (A2 not) → A still unknown, A2 要再確認", stateOf(rOne.A?.observed) === "unknown" && ok(rOne.A?.observed, "A1_attested_not_listed") === true && ok(rOne.A?.observed, "A2_needs_recheck") === true);
    attest("A2", pageSha("none"), "not_listed");
    const rBoth = await run();
    expect("B3 both pages attested not listed for today's bodies → A not listed (人の確認)", stateOf(rBoth.A?.observed) === "not_listed" && columnA(rBoth.A?.observed).text === "載っていない・人の確認（A1 なし（人の確認）・A2 なし（人の確認））", columnA(rBoth.A?.observed).text);
    mode.a2 = "other_repo";
    const rChanged = await run();
    expect("B3 A2's body changed → its attestation no longer matches → A unknown again, A2 要再確認", stateOf(rChanged.A?.observed) === "unknown" && ok(rChanged.A?.observed, "A2_needs_recheck") === true);
    mode.a2 = "none"; clearAtt();
    // Codex review of 185d63d, the fatal cases (B attested correct so that only A decides the judgement)
    const attestB = () => attest("B", bSha(catalogItem("fake-subject")), "listed");
    attestB();
    mode.a1 = "body_reset";
    const rbody = await run();
    expect("B3 Codex R1: A1 HTTP 200 but the body is cut off → A1 not fetched (取得失敗), A unknown, judgement U1", stateOf(rbody.A?.observed) === "unknown" && ok(rbody.A?.observed, "A1_page_fetched") === false && ok(rbody.A?.observed, "A1_needs_recheck") === false && rbody.status === 0 && judgeOf(rbody) === "U1" && rbody.diag("A1")?.body_sha256 === null, `${judgeOf(rbody)} ${JSON.stringify(rbody.A?.observed.checks)}`);
    mode.a1 = "404";
    const r404 = await run();
    expect("B3 A1 HTTP 404 → A1 not fetched, A unknown", stateOf(r404.A?.observed) === "unknown" && ok(r404.A?.observed, "A1_page_fetched") === false);
    mode.a1 = "dot_tail";
    const rdot = await run();
    expect("B3 Codex R2: a link ending in /.. (no attestation) → A unknown, judgement U1", stateOf(rdot.A?.observed) === "unknown" && judgeOf(rdot) === "U1", `${judgeOf(rdot)} ${JSON.stringify(rdot.A?.observed.checks)}`);
    mode.a1 = "entity_hyphen";
    const rhy = await run();
    expect("B3 Codex R3: fake&hyphen;vendor (no attestation) → A unknown, judgement U1", stateOf(rhy.A?.observed) === "unknown" && judgeOf(rhy) === "U1", `${judgeOf(rhy)} ${JSON.stringify(rhy.A?.observed.checks)}`);
    mode.a1 = "500"; mode.a2 = "listed"; attest("A2", pageSha("listed"), "listed");
    const r2 = await run();
    expect("B3 A1 fails but A2 is attested listed → A listed, A1 fetched=false", r2.A?.observed.pass === true && r2.A?.observed.instrument_error === null && ok(r2.A?.observed, "A1_page_fetched") === false);
    mode.a2 = "none";
    const r3 = await run();
    expect("B3 A1 fails and A2 has no attestation for its body → A unknown", r3.A?.observed.instrument_error === "other" && r3.A?.observed.pass === false && validateReading(r3.A, schema).length === 0);
    mode.a1 = "none"; mode.a2 = "listed"; clearAtt();
  }
  // (4) rename detection
  {
    attest("A2", pageSha("listed"), "listed"); attest("B", bSha(catalogItem("fake-subject")), "not_listed");
    mode.gh = "renamed";
    const r = await run(); renamedRun = r;
    expect("B4 renamed (full_name differs) → ground truth inconsistent, GT row written", r.agent?.observed.ground_truth_consistent === false && r.gt?.observed.pass === false && ok(r.gt?.observed, "sealed_repo_full_name_unchanged") === false, JSON.stringify(r.gt?.observed));
    expect("B4 renamed: attribution rows still written for the run", Boolean(r.A && r.B));
    mode.gh = "archived";
    const ra = await run();
    expect("B4 archived → inconsistent, check sealed_repo_not_archived false", ra.agent?.observed.ground_truth_consistent === false && ok(ra.gt?.observed, "sealed_repo_not_archived") === false);
    mode.gh = "404";
    const rn = await run();
    expect("B4 gone (404) → inconsistent", rn.agent?.observed.ground_truth_consistent === false && ok(rn.gt?.observed, "sealed_repo_exists_public_on_github") === false);
    mode.gh = "hang";
    const t0h = Date.now();
    const rh = await run();
    expect("B4 GitHub API never answers → timeout ends it, inconsistent (U0), run completes", rh.status === 0 && rh.agent?.observed.ground_truth_consistent === false && Date.now() - t0h < 60000, `${rh.status} ${Date.now() - t0h}ms`);
    mode.gh = "case";
    const rc = await run();
    expect("B4 full_name differing only in ASCII case is the same repo → consistent", rc.agent?.observed.ground_truth_consistent === true && !rc.gt);
    mode.gh = "ok"; clearAtt();
  }
  // (6) Codex 8d905ee end-to-end: N1 (a URL inside a data: URL) and N2 (percent-encoded owner/repo) → A and B unknown, U1
  for (const [m, id] of [["nested_data", "e2e-nested-data"], ["percent_names", "e2e-percent-names"]] as const) {
    mode.a1 = m; mode.a2 = "none"; mode.catalog = m;
    const r = await run();
    expect(`B6 Codex 8d905ee ${id}: A unknown, B unknown, judgement U1`, stateOf(r.A?.observed) === "unknown" && stateOf(r.B?.observed) === "unknown" && judgeOf(r) === "U1", `${stateOf(r.A?.observed)} ${stateOf(r.B?.observed)} ${judgeOf(r)}`);
    expect(`B6 Codex 8d905ee ${id}: no page/catalog/answer value in public files`, !/PAGE_CANARY_PRIVATE|CATALOG_CANARY_PRIVATE|fake-official-mcp-server|%66%61%6b%65/.test(r.pub));
    expect(`B6 Codex 8d905ee ${id}: rows pass reading.v1`, [r.A, r.B, r.agent].every((x: any) => x && validateReading(x, schema).length === 0));
  }
  mode.a1 = "none"; mode.a2 = "listed"; mode.catalog = "no_repo";
  // (5) the empty executor writes no attribution rows (correction runs are refused in --dry-run, so that gate is checked by reading marker-generic)
  {
    const r = await run(["--executor", "empty"]);
    expect("B5 executor=empty → no attribution rows", !r.A && !r.B, r.out.slice(-300));
  }
} finally { server.close(); }

// ── Part C: the sheet from Part B's readings ─────────────────────────────
{
  const toRow = (x: any) => ({ ...x, outcome_id: x.observed.method === AGENT_METHOD ? 1 : null, target_json: JSON.stringify(x.target), observed_json: JSON.stringify(x.observed) });
  const rows = [recheckRun, day1, renamedRun].flatMap((r: any) => [r?.A, r?.B, r?.agent, r?.gt].filter(Boolean)).map(toRow).sort((a: any, b: any) => a.observed_at.localeCompare(b.observed_at));
  const lines = attributionLines(rows);
  expect("C1 three agent readings joined with their own run's A/B rows", lines.length === 3, String(lines.length));
  expect("C1 no-attestation run = U1 with the 要再確認 cells", lines[0]?.judgement.code === "U1" && lines[0]?.a.text === `${RECHECK_TEXT}（A1 要再確認・A2 要再確認）` && lines[0]?.b.text === RECHECK_TEXT, JSON.stringify(lines[0]));
  expect("C1 attested run = #3 KanseiLINK 側の穴", lines[1]?.judgement.code === "#3" && lines[1]?.a.text === "載っている・人の確認（A1 要再確認・A2 あり（人の確認））" && lines[1]?.b.text === "誤り・人の確認（欠落）" && lines[1]?.c.text === "通過", JSON.stringify(lines[1]));
  expect("C1 renamed run = 未確定（計器）, C not counted", lines[2]?.judgement.code === "U0" && /数えない/.test(lines[2]?.c.text || ""), JSON.stringify(lines[2]));
  const md = renderSheet(rows as any, { markerId: "M-994", now: new Date() });
  expect("C2 sheet has the three columns and the judgement label", md.includes("## 三列と判断（規則 v0.1・臓器1 発見）") && md.includes("| A 公式情報 | B KanseiLINK | C AI（REPO 行） | 判断（規則 v0.1） |"));
  expect("C2 sheet explains that A/B come from people only", md.includes("A・B の状態は人の確認だけから取る（規則 v0.1 §4-2）"));
  expect("C2 sheet row for the no-attestation run shows 要再確認", md.includes(`| ${RECHECK_TEXT}（A1 要再確認・A2 要再確認） | ${RECHECK_TEXT} | 通過 | 未確定（計器） |`));
  expect("C2 sheet row for the attested run", md.includes("| 載っている・人の確認（A1 要再確認・A2 あり（人の確認）） | 誤り・人の確認（欠落） | 通過 | #3 KanseiLINK 側の穴（AI は KanseiLINK 以外から到達） |"));
  expect("C2 sheet row for the renamed run prints only 未確定（計器）", /通過（正解側のずれ・数えない） \| 未確定（計器） \|$/m.test(md));
  expect("C2 period tally by observer", md.includes("### 観測者ごとの集計（期間通し・判断（規則 v0.1））") && /\| harness→fake-model \| #3 KanseiLINK 側の穴（AI は KanseiLINK 以外から到達） \| 1 \|/.test(md));
  expect("C2 ground-truth table labels the attribution rows (with the 要再確認 mark)", md.includes("| A 公式情報: 載っている・人の確認（A1 要再確認・A2 あり（人の確認）） |") && md.includes("| B KanseiLINK: 誤り・人の確認（欠落） |") && md.includes(`| B KanseiLINK: ${RECHECK_TEXT} |`));
  expect("C2 no repository value, hint or body sha256 in the sheet", !/fake-official-mcp-server|手がかり/.test(md) && !/[0-9a-f]{64}/.test(md.replace(/`[0-9a-f]{64}`/, "")));
  const plain = renderSheet(rows.filter((r: any) => r.outcome_id != null || r.observed.method === "sealed_repo_vs_github_api") as any, { markerId: "M-994" });
  expect("C3 no attribution rows → no attribution section", !plain.includes("三列と判断"));
}

// ── Part D: Codex's 110 independent cases of 185d63d (fixtures/attribution-cases.json) ──
// source_text / source_key / decoder are the HINT reader now (unchanged functions); truth tables and joins as before.
{
  const fx = JSON.parse(readFileSync(join(FIX, "attribution-cases.json"), "utf-8"));
  const S = fx.sealed_fixture;
  expect("D0 110 cases, each with an expectation", fx.cases.length === 110 && fx.cases.every((c: any) => c.expect_state || c.expect_key === null || c.expect_text || c.expect_code || c.expect_codes || c.expect !== undefined));
  for (const c of fx.cases) {
    if (c.kind === "source_text") { const got = classifySource(c.input.text, S, { html: c.input.html }).state; expect(`D ${c.id} (hint) → ${c.expect_state}`, got === c.expect_state, got); }
    else if (c.kind === "source_key") expect(`D ${c.id} (hint) → no key`, sourceRepoKey(c.input.url) === c.expect_key);
    else if (c.kind === "decoder") expect(`D ${c.id} → WHATWG decoding`, decodeHtmlCharRefs(c.input.text) === c.expect_text);
    else if (c.kind === "truth_table") { const j = judgeAttribution(c.input); expect(`D ${c.id} → ${c.expect_code}`, j.code === c.expect_code, j.code); }
    else if (c.kind === "bundle_join") {
      const got = attributionLines(c.input).map((l: any) => l.judgement.code); expect(`D ${c.id} → ${c.expect_codes.join(",")}`, JSON.stringify(got) === JSON.stringify(c.expect_codes), JSON.stringify(got));
      if (c.expect_codes_attested) {
        // the same rows with the human-attestation checks a run would carry (pass = attested listed, pass=false = attested not listed)
        const withAtt = (r: any) => {
          const o = r.observed; if (r.outcome_id != null || o.instrument_error) return r;
          const extra = o.method === ATTR_METHODS.A
            ? (o.pass ? [["A1_page_fetched", true], ["A1_attested_listed", true], ["official_docs_attested_listed", true]] : [["A1_page_fetched", true], ["A1_attested_not_listed", true], ["official_docs_attested_not_listed", true]])
            : (o.pass ? [["catalog_item_observed", true], ["catalog_item_attested_listed", true]] : [["catalog_item_observed", true], ["catalog_item_present", true], ["catalog_item_attested_not_listed", true]]);
          return { ...r, observed: { ...o, checks: [...o.checks, ...extra.map(([label, ok]) => ({ label, ok }))] } };
        };
        const got2 = attributionLines(c.input.map(withAtt)).map((l: any) => l.judgement.code);
        expect(`D ${c.id} with attestation checks → ${c.expect_codes_attested.join(",")}`, JSON.stringify(got2) === JSON.stringify(c.expect_codes_attested), JSON.stringify(got2));
      }
    }
    else if (c.kind === "loopback_equivalent") { const named = c.smoke_case.startsWith("("); expect(`D ${c.id} replayed by "${c.smoke_case}"`, named || passed.some((l) => l.startsWith(c.smoke_case))); }
  }
}

// ── Part E: Codex's 93 independent cases of 8d905ee (fixtures/attribution-cases-8d905ee.json) ──
{
  const fx = JSON.parse(readFileSync(join(FIX, "attribution-cases-8d905ee.json"), "utf-8"));
  const S = fx.sealed;
  expect("E0 93 cases, each with an expectation, verbatim evidence present", fx.cases.length === 93 && fx.cases.every((c: any) => c.expect !== undefined) && existsSync(join(FIX, "evidence", "codex-8d905ee-independent-cases.json")));
  const { TARGETS } = await import("../exec-harness/lib/marker-targets.mjs");
  let ghBody: any = {}; let ghHang = false;
  const gh = createServer((req, res) => { if (ghHang) return; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(ghBody)); });
  await new Promise<void>((r) => gh.listen(47338, "127.0.0.1", () => r()));
  const toState = (c: any) => c.state === "listed" ? "listed" : "unknown";
  const col = (x: string) => ({ state: x });
  const emptyDir = mkdtempSync(join(tmpdir(), "att-none-"));
  try {
    for (const c of fx.cases) {
      if (c.kind === "source_text") { const got = classifySource(c.input.text, c.input.sealed, { html: c.input.html }).state; expect(`E ${c.id} (hint) → ${c.expect}`, got === c.expect, got); }
      else if (c.kind === "source_page") { const got = toState(classifySource(c.input.page, S, { html: true })); expect(`E ${c.id} (hint) → ${c.expect}`, got === c.expect, got); }
      else if (c.kind === "source_catalog_field") { const got = toState(classifySource(c.input.description, S)); expect(`E ${c.id} (hint) → ${c.expect}`, got === c.expect, got); }
      else if (c.kind === "decoder") expect(`E ${c.id} → WHATWG decoding`, decodeHtmlCharRefs(c.input) === c.expect);
      else if (c.kind === "truth_table") { const i = c.input; const j = judgeAttribution({ a: col(i.a), b: col(i.b), c: col(i.c), gtConsistent: i.gt === undefined ? true : i.gt }); expect(`E ${c.id} → ${c.expect}`, j.code === c.expect, j.code); }
      else if (c.kind === "bundle_join") { const got = attributionLines(c.input).map((l: any) => l.judgement.code); expect(`E ${c.id} → ${c.expect}`, got.length === 1 && got[0] === c.expect, JSON.stringify(got)); }
      else if (c.kind === "ground_truth") {
        ghBody = c.input; ghHang = c.codex_id === "gt-timeout";
        const t = await TARGETS.llmAnswer.groundTruth({ MK: { github_api_base: "http://127.0.0.1:47338", github_timeout_ms: 1500 }, sealed: { owner: "acme", name: "widget" }, harnessLog: () => {} });
        expect(`E ${c.id} → consistent=${c.expect}`, t.consistent === c.expect, JSON.stringify(t.checks));
      }
      else if (c.kind === "judgement_from_sources") {
        // §4-2 (7e9a3e2): the public state of each source comes from attestations only — none here → unknown
        const ctx = (sourceId: string) => ({ markerId: "M-994", expectedDigest: SEAL_DIGEST, sourceId, target: "x" });
        const a = sourceState({ fetched: true, bodySha: sha256Hex(Buffer.from(c.input.page, "utf8")), dir: emptyDir, ctx: ctx("A1") }).state;
        const b = sourceState({ fetched: true, bodySha: sha256Hex(c.input.description), dir: emptyDir, ctx: ctx("B") }).state;
        const j = judgeAttribution({ a: col(a === "listed" ? "listed" : a === "not_listed" ? "not_listed" : "unknown"), b: col(b === "listed" ? "correct" : b === "not_listed" ? "wrong" : "unknown"), c: col("pass"), gtConsistent: true });
        expect(`E ${c.id} → ${c.expect}`, j.code === c.expect, j.code);
      }
      else if (c.kind === "loopback_equivalent") {
        const [file, label] = c.smoke_case.split(": ");
        const ok2 = file.endsWith("smoke-marker-attribution.mts") ? passed.some((l) => l.startsWith(c.smoke_case.slice(file.length + 2))) : readFileSync(join(ROOT, file), "utf-8").includes(label);
        expect(`E ${c.id} replayed by "${c.smoke_case}"`, ok2);
      }
    }
  } finally { gh.close(); rmSync(emptyDir, { recursive: true, force: true }); }
}

// ── Part F: Codex's 94 independent cases of 7e9a3e2 (fixtures/attribution-cases-7e9a3e2.json) ──
{
  const { TARGETS } = await import("../exec-harness/lib/marker-targets.mjs");
  const fx = JSON.parse(readFileSync(join(FIX, "attribution-cases-7e9a3e2.json"), "utf-8"));
  const verbatim = JSON.parse(readFileSync(join(FIX, "evidence", "codex-7e9a3e2-independent-cases.json"), "utf-8"));
  expect("F0 94 cases; ids, inputs and Codex's expectations equal the verbatim evidence", fx.cases.length === 94 && verbatim.cases.length === 94 && fx.cases.every((c: any, i: number) => c.id === verbatim.cases[i].id && JSON.stringify(c.input) === JSON.stringify(verbatim.cases[i].input) && JSON.stringify(c.codex_expected) === JSON.stringify(verbatim.cases[i].expected)));
  expect("F0 every revised expectation says why", fx.cases.every((c: any) => c.expect !== undefined && (JSON.stringify(c.expect) === JSON.stringify(c.codex_expected) || typeof c.revised === "string" || c.kind === "token" || c.kind === "attestation")));
  const byId = (id: string) => fx.cases.find((c: any) => c.id === id);
  const sealed = { repo: "github.com/fake-vendor/fake-official-mcp-server", owner: "fake-vendor", name: "fake-official-mcp-server" };
  const repo = REPO;
  // Codex's loopback shape: /a1 and /a2 serve the same page, /mcp answers plain JSON, GitHub normal
  let fpage = repo; let fpayload: any = null; let fgh = "normal";
  const fserver = createServer((req, res) => {
    const url = req.url || "";
    if (url === "/a1" || url === "/a2") { res.writeHead(200, { "content-type": "text/html" }); return res.end(fpage); }
    if (url === "/mcp") { req.resume(); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(fpayload) }] } })); }
    if (url.startsWith("/gh/")) {
      if (fgh === "timeout") return;
      if (fgh === "missing") { res.writeHead(404); return res.end("{}"); }
      const d = { private: fgh === "private", archived: fgh === "archived", full_name: fgh === "renamed" ? "fake-vendor/new-name" : fgh === "moved" ? "new-owner/fake-official-mcp-server" : "fake-vendor/fake-official-mcp-server" };
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(d));
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => fserver.listen(47339, "127.0.0.1", () => r()));
  const FB = "http://127.0.0.1:47339";
  const fdir = mkdtempSync(join(tmpdir(), "codex-7e9a3e2-"));
  const fatt = join(fdir, "attestations"); mkdirSync(fatt, { recursive: true });
  writeFileSync(join(fatt, "observers.json"), JSON.stringify(["human:Audit Fixture Reviewer"]));
  const fans = join(fdir, "answers.json"); writeFileSync(fans, JSON.stringify({ fake: `ANSWER_VALUE_CANARY\nREPO: ${repo}\nAUTH: OAuth 2.0` }));
  const fenv = { ...process.env, KANSEI_M994_SEALED_PATH: join(FIX, "M-994.sealed.json"), KANSEI_FAKE_LLM_ANSWERS_FILE: fans, KANSEI_FAKE_ATTR_BASE: FB, KANSEI_FAKE_ATTESTATIONS_DIR: fatt };
  const fcfg = JSON.parse(JSON.stringify(JSON.parse(readFileSync(join(FIX, "taskpack-m994-attribution.json"), "utf-8")).marker.attribution).replaceAll("${ENV:KANSEI_FAKE_ATTR_BASE}", FB));
  const v2 = (source: string, bodySha: string, verdict: string, over: any = {}) => ({ attestation: ATTESTATION_KIND, marker_id: "M-994", expected_digest: SEAL_DIGEST, source_id: source, target: sourceTarget(fcfg, source), body_sha256: bodySha, verdict, observer: "human:Audit Fixture Reviewer", date: "2026-09-29", reason: "Fixture reviewer inspected the complete source; no repository link.", ...over });
  const put = (a: any) => writeFileSync(join(fatt, `${a.marker_id}-${a.source_id}-${a.body_sha256}.json`), JSON.stringify(a));
  const clearF = () => { for (const f of readdirSync(fatt)) if (f !== "observers.json") rmSync(join(fatt, f)); };
  const pageShaF = () => sha256Hex(Buffer.from(fpage, "utf8"));
  async function frun(id: string) {
    const r = await spawnAsync(process.execPath, [join(ROOT, "exec-harness", "run-marker.mjs"), "fixtures/taskpack-m994-attribution.json", "--dry-run"], { cwd: ROOT, env: fenv });
    const m = /evidence: (\S+?)\/ \(manifest/.exec(r.out);
    const bundle = join(ROOT, m![1]); const rel = m![1];
    const metrics = JSON.parse(readFileSync(join(bundle, "metrics.json"), "utf-8"));
    const priv = JSON.parse(readFileSync(join(bundle, "environment.private.json"), "utf-8"));
    const rows = metrics.readings.map((x: any) => ({ ...x, evidence_ref: `${rel}#sha256:${sha256Hex(readFileSync(join(bundle, "manifest.json")))}`, outcome_id: x.observed.method === AGENT_METHOD ? 1 : null }));
    const A = rows.find((x: any) => x.observed.method === ATTR_METHODS.A).observed; const B = rows.find((x: any) => x.observed.method === ATTR_METHODS.B).observed;
    const line = attributionLines(rows)[0]; const sheet = renderSheet(rows, { markerId: "M-994" });
    const pub = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(bundle, f), "utf-8")).join("\n") + sheet;
    const bDiag = priv.diagnostics.find((d: any) => d.event === "attribution_source" && d.source_id === "B");
    return { status: r.status, A: stateOf(A), B: stateOf(B), judgement: line.judgement.code, bSha: bDiag?.body_sha256, hintB: bDiag?.hint?.state, schemaValid: rows.every(({ outcome_id, ...row }: any) => validateReading(row, schema).length === 0), leaked: /CATALOG_VALUE_CANARY|PAGE_VALUE_CANARY|ANSWER_VALUE_CANARY/.test(pub) };
  }
  const aux = (id: string, r: any) => {
    const s = byId(`${id}-schema`), p = byId(`${id}-privacy`);
    if (s) expect(`F ${s.id} → valid`, r.schemaValid === s.expect.valid);
    if (p) expect(`F ${p.id} → not leaked`, r.leaked === p.expect.leaked);
  };
  const basePayload = () => ({ service_id: "fake-subject", name: "Fake", mcp_status: "official", freshness: { confidence: "medium", data_age_days: 1 }, _meta: { attempt_id: "one" }, description: "CATALOG_VALUE_CANARY" });
  try {
    for (const c of fx.cases) {
      if (c.kind === "token") {
        const emptyDir = fatt; clearF();
        const st = sourceState({ fetched: true, bodySha: sha256Hex(Buffer.from(c.input.text, "utf8")), dir: emptyDir, ctx: { markerId: "M-994", expectedDigest: SEAL_DIGEST, sourceId: c.id.endsWith("-A") ? "A1" : "B", target: "x" } });
        const pub = st.state === "listed" ? "listed" : st.state === "not_listed" ? "not_listed" : "unknown";
        const hint = classifySource(c.input.text, sealed, { html: c.input.html }).state;
        expect(`F ${c.id} → public ${c.expect.public}${c.expect.hint ? `, hint ${c.expect.hint}` : " (hint not asserted)"}`, pub === c.expect.public && (c.expect.hint === null || hint === c.expect.hint), `${pub} ${hint}`);
      } else if (c.kind === "ground_truth") {
        fgh = c.input.mode;
        const t = await TARGETS.llmAnswer.groundTruth({ MK: { github_api_base: `${FB}/gh`, github_timeout_ms: 80 }, sealed, harnessLog: () => {} });
        expect(`F ${c.id} → consistent=${c.expect.consistent}`, t.consistent === c.expect.consistent);
        fgh = "normal";
      } else if (c.kind === "truth_table") {
        const i = c.input;
        const j = "code" in c.expect && c.id.startsWith("truth-table-")
          ? judgeAttribution({ a: { state: i.A }, b: { state: i.B === "listed" ? "correct" : "wrong" }, c: { state: i.C ? "pass" : "miss" }, gtConsistent: true })
          : judgeAttribution({ a: { state: i.a }, b: { state: i.b }, c: { state: i.c }, gtConsistent: i.gt });
        expect(`F ${c.id} → ${c.expect.code}`, j.code === c.expect.code, j.code);
      } else if (c.kind === "bundle_join") {
        const ar = { pass: true, method: ATTR_METHODS.A, checks: [], instrument_error: null }; const br = { ...ar, method: ATTR_METHODS.B }; const cr = { pass: true, method: AGENT_METHOD, checks: [{ label: "repo_value_equals_sealed_repo", ok: true }], ground_truth_consistent: true };
        const verbatimJoin = attributionLines([{ outcome_id: null, evidence_ref: "run-one#sha256:a", observed: ar }, { outcome_id: null, evidence_ref: "run-one#sha256:a", observed: br }, { outcome_id: 1, evidence_ref: "run-two#sha256:b", observed: cr }] as any)[0].judgement.code;
        // the same with fully attested A/B rows: still another run's rows → U1
        const arA = { ...ar, checks: [{ label: "A1_page_fetched", ok: true }, { label: "A1_attested_listed", ok: true }, { label: "official_docs_attested_listed", ok: true }] }; const brA = { ...br, checks: [{ label: "catalog_item_observed", ok: true }, { label: "catalog_item_attested_listed", ok: true }] };
        const attestedJoin = attributionLines([{ outcome_id: null, evidence_ref: "run-one#sha256:a", observed: arA }, { outcome_id: null, evidence_ref: "run-one#sha256:a", observed: brA }, { outcome_id: 1, evidence_ref: "run-two#sha256:b", observed: cr }] as any)[0].judgement.code;
        expect(`F ${c.id} → ${c.expect.code} (verbatim rows and attested rows)`, verbatimJoin === c.expect.code && attestedJoin === c.expect.code, `${verbatimJoin} ${attestedJoin}`);
      } else if (c.kind === "attestation") {
        const baseline = byId("valid-baseline").input.valid_human_attestation;
        const ctx = { markerId: "M-994", expectedDigest: SEAL_DIGEST, sourceId: "B", target: sourceTarget(fcfg, "B"), bodySha: baseline.body_sha256, observers: ["human:Audit Fixture Reviewer"], today: "2026-09-29" };
        const verbatimValid = validateAttestation(c.input.attestation, ctx) === null;
        // rebase: apply Codex's change (the difference from its valid baseline) to a valid v2 attestation
        const good = v2("B", baseline.body_sha256, "not_listed");
        expect(`F ${c.id} (rebase baseline is valid)`, validateAttestation(good, ctx) === null);
        const rebased: any = { ...good };
        for (const k of Object.keys(baseline)) if (!(k in c.input.attestation)) delete rebased[k];
        for (const [k, v] of Object.entries(c.input.attestation)) if (JSON.stringify(v) !== JSON.stringify((baseline as any)[k])) rebased[k] = v;
        const rebasedWhy = validateAttestation(rebased, ctx);
        expect(`F ${c.id} → verbatim invalid, rebased invalid (${rebasedWhy})`, verbatimValid === c.expect.verbatim_valid && (rebasedWhy === null) === c.expect.rebased_valid && rebasedWhy !== "kind", `${verbatimValid} ${rebasedWhy}`);
      } else if (c.kind === "e2e") {
        clearF(); fgh = "normal";
        if (c.id === "e2e-numeric-scheme" || c.id === "e2e-nested-in-bare") {
          fpage = c.input.page; fpayload = c.input.catalog;
          const r = await frun(c.id);
          expect(`F ${c.id} → A ${c.expect.A}, B ${c.expect.B}, ${c.expect.judgement}`, r.A === c.expect.A && r.B === c.expect.B && r.judgement === c.expect.judgement, JSON.stringify(r));
          aux(c.id, r);
        } else if (c.id === "valid-baseline") {
          fpage = repo; fpayload = c.input.catalog;
          put(v2("A1", pageShaF(), "listed", { reason: "Fixture reviewer: the page links the repository." }));
          put(v2("B", sha256Hex(catalogBody(fpayload)), "not_listed"));
          const r = await frun(c.id);
          expect(`F ${c.id} → A ${c.expect.A}, B ${c.expect.B}, ${c.expect.judgement}`, r.A === c.expect.A && r.B === c.expect.B && r.judgement === c.expect.judgement, JSON.stringify(r));
          aux(c.id, r);
        } else if (c.id.startsWith("excluded-field-")) {
          const n = ["_repository", "_meta.repository", "freshness.repository", "freshness.confidence"].indexOf(c.id.slice("excluded-field-".length)) + 1;
          fpage = repo; fpayload = c.input.catalog;
          const prior = byId("valid-baseline").input.valid_human_attestation;
          put(v2("A1", pageShaF(), "listed", { reason: "Fixture reviewer: the page links the repository." }));
          put(v2("B", prior.body_sha256, "not_listed")); // the prior "not listed" of the baseline body, now in the v2 form
          const r = await frun(c.id);
          expect(`F ${c.id} → A ${c.expect.A}, B ${c.expect.B}, ${c.expect.judgement}, body changed, hint B ${c.expect.hint_B} (never #3)`, r.A === c.expect.A && r.B === c.expect.B && r.judgement === c.expect.judgement && (r.bSha !== prior.body_sha256) === c.expect.body_changed && r.hintB === c.expect.hint_B, JSON.stringify(r));
          aux(`excluded-${n}`, r);
        } else if (c.id === "included-link") {
          fpage = repo; fpayload = c.input.catalog;
          put(v2("A1", pageShaF(), "listed", { reason: "Fixture reviewer: the page links the repository." }));
          const r = await frun(c.id);
          put(v2("B", sha256Hex(catalogBody(fpayload)), "listed", { reason: "Fixture reviewer: the item names the repository." }));
          const r2 = await frun(`${c.id}-attested`);
          expect(`F ${c.id} → without attestation B ${c.expect.B} ${c.expect.judgement} (hint ${c.expect.hint_B}); attested listed → ${c.expect.with_listed_attestation}`, r.B === c.expect.B && r.judgement === c.expect.judgement && r.hintB === c.expect.hint_B && r2.judgement === c.expect.with_listed_attestation, `${JSON.stringify(r)} ${JSON.stringify(r2)}`);
          aux(c.id, r);
        } else if (c.id === "changed-body") {
          fpage = repo; fpayload = c.input.catalog;
          const prior = byId("valid-baseline").input.valid_human_attestation;
          put(v2("A1", pageShaF(), "listed", { reason: "Fixture reviewer: the page links the repository." }));
          put(v2("B", prior.body_sha256, "not_listed"));
          const r = await frun(c.id);
          expect(`F ${c.id} → B ${c.expect.B}, ${c.expect.judgement}`, r.B === c.expect.B && r.judgement === c.expect.judgement, JSON.stringify(r));
          aux(c.id, r);
        } else if (c.id === "placeholder-e2e") {
          fpage = "PAGE_VALUE_CANARY"; fpayload = basePayload();
          for (const s of ["A1", "A2", "B"]) put(v2(s, s === "B" ? sha256Hex(catalogBody(fpayload)) : pageShaF(), "not_listed", { observer: "human:TODO", reason: "TODO", target: "TODO" }));
          const r = await frun("placeholder");
          expect(`F ${c.id} → A ${c.expect.A}, B ${c.expect.B}, ${c.expect.judgement}`, r.A === c.expect.A && r.B === c.expect.B && r.judgement === c.expect.judgement, JSON.stringify(r));
          aux("placeholder", r);
        } else expect(`F ${c.id} has a replay`, false);
      }
    }
  } finally { fserver.close(); rmSync(fdir, { recursive: true, force: true }); }
  const replayed = passed.filter((l) => l.startsWith("F ")).length;
  expect("F every one of the 94 cases was asserted", fx.cases.every((c: any) => passed.some((l) => l.startsWith(`F ${c.id} `)) || failures > 0), String(replayed));
}

// ── Part G: Codex's 112 independent cases of 5758e0a (fixtures/attribution-cases-5758e0a.json) ──
// Codex's runner (outputs/reproduction/work/independent.mjs) ported: in-process attribution on a loopback
// server and one in-process runGenericMarker; observer human:offline-review is in the fixture's observers.json.
{
  const fx = JSON.parse(readFileSync(join(FIX, "attribution-cases-5758e0a.json"), "utf-8"));
  const verbatim = JSON.parse(readFileSync(join(FIX, "evidence", "codex-5758e0a-independent-cases.json"), "utf-8"));
  expect("G0 112 cases; ids, inputs and Codex's expectations equal the verbatim evidence", fx.cases.length === 112 && verbatim.cases.length === 112 && fx.cases.every((c: any, i: number) => c.id === verbatim.cases[i].id && JSON.stringify(c.input) === JSON.stringify(verbatim.cases[i].input) && JSON.stringify(c.codex_expected) === JSON.stringify(verbatim.cases[i].expected)));
  expect("G0 every expectation that differs from Codex's says why", fx.cases.every((c: any) => JSON.stringify(c.expect) === JSON.stringify(c.codex_expected) || typeof c.revised === "string"));
  const { TARGETS } = await import("../exec-harness/lib/marker-targets.mjs");
  const { runGenericMarker } = await import("../exec-harness/lib/marker-generic.mjs");
  const gout = mkdtempSync(join(tmpdir(), "codex-5758e0a-"));
  const attdir = join(gout, "attestations");
  const packPath = join(FIX, "taskpack-m994-attribution.json");
  const pack = JSON.parse(readFileSync(packPath, "utf-8"));
  const sealBytes = readFileSync(join(FIX, "M-994.sealed.json"));
  const sealJson = JSON.parse(sealBytes.toString("utf-8")), digest = sha256Hex(sealBytes);
  const sealed = TARGETS.llmAnswer.parseSealed(sealJson);
  const link = sealJson.expected.official_mcp_repo_url;
  const baseItem = (): any => ({ service_id: "fake-subject", mcp_status: "official", freshness: { confidence: "medium", data_age_days: 0 }, _meta: { attempt_id: "run-one" }, description: "CATALOG_PRIVATE_CANARY" });
  let item = baseItem(), a1 = "PAGE_PRIVATE_CANARY one", a2 = "PAGE_PRIVATE_CANARY two", httpStatus = 200;
  let gh: any = { full_name: `${sealed.owner}/${sealed.name}`, private: false, archived: false }, ghMode = "normal";
  const gserver = createServer((req, res) => {
    if (req.url === "/a1" || req.url === "/a2") { res.writeHead(httpStatus); return res.end(req.url === "/a1" ? a1 : a2); }
    if (req.url === "/mcp") { req.resume(); return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(item) }] } })); }
    if ((req.url || "").startsWith("/gh/")) { if (ghMode === "timeout") return; res.writeHead(ghMode === "404" ? 404 : 200); return res.end(JSON.stringify(gh)); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => gserver.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(gserver.address() as any).port}`;
  const cfg = { official_docs: [{ id: "A1", url: `${base}/a1` }, { id: "A2", url: `${base}/a2` }], catalog: { display_api_url: `${base}/mcp`, service_id: "fake-subject", body_fields: B_BODY_FIELDS }, attestations_dir: attdir };
  const MK = { ...pack.marker, attribution: cfg, github_api_base: `${base}/gh`, github_timeout_ms: 80 };
  const OBS = "human:offline-review";
  const actual = new Map<string, any>();
  const put2 = (id: string, v: any) => actual.set(id, v);
  const stateB = (b: any) => (({ correct: "listed", wrong: "not_listed", unknown: "unknown" }) as any)[b.state];
  const resetAtt = () => { rmSync(attdir, { recursive: true, force: true }); mkdirSync(attdir, { recursive: true }); writeFileSync(join(attdir, "observers.json"), JSON.stringify([OBS])); };
  function attestG(source: string, verdict: string, patch: any = {}) {
    const body = source === "A1" ? a1 : source === "A2" ? a2 : catalogBody(item);
    const bodySha = sha256Hex(body);
    const a = { attestation: ATTESTATION_KIND, marker_id: "M-994", expected_digest: digest, source_id: source, target: sourceTarget(cfg, source), body_sha256: bodySha, verdict, observer: OBS, date: "2026-09-29", reason: "Read the complete synthetic source and confirmed the verdict.", ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete (a as any)[k];
    writeFileSync(join(attdir, `M-994-${source}-${bodySha}.json`), JSON.stringify(a));
    return a;
  }
  async function columns() {
    const rows: any = await TARGETS.llmAnswer.attribution({ MK, sealed, harnessLog: () => {}, attestationsDir: attdir, expectedDigest: digest, markerId: "M-994" });
    return { rows, a: columnA(rows[0]), b: columnB(rows[1]), diag: rows.diagnostics as any[] };
  }
  try {
    for (const verdict of ["listed", "not_listed"]) {
      resetAtt(); const a = attestG("B", verdict);
      const ctx = { markerId: "M-994", sourceId: "B", expectedDigest: digest, bodySha: a.body_sha256, target: a.target, observers: [OBS], today: "2026-09-29" };
      put2(`validator-valid-${verdict}`, validateAttestation(a, ctx));
      const mutations: Record<string, any> = { extra: { extra: "x" }, marker: { marker_id: "M-995" }, seal: { expected_digest: "b".repeat(64) }, body: { body_sha256: "c".repeat(64) }, source: { source_id: "A1" }, target: { target: `${base}/elsewhere` }, observer: { observer: "agent:review" }, draft: { _draft_instructions: "unsigned" }, kind: { attestation: "kansei-attribution-attestation/v1" }, date: { date: "2026-02-30" }, empty: { reason: "" }, whitespace: { reason: " Pending " }, todo: { reason: "TODO" }, tbd: { reason: "TBD" }, angle: { reason: "<fill>" }, square: { reason: "[fill]" }, curly: { reason: "{fill}" }, lf: { reason: "First\nsecond" } };
      for (const [name, patch] of Object.entries(mutations)) put2(`validator-${verdict}-${name}`, validateAttestation({ ...a, ...patch }, ctx) !== null);
      for (const key of Object.keys(a)) { const b: any = { ...a }; delete b[key]; put2(`validator-${verdict}-missing-${key}`, validateAttestation(b, ctx) !== null); }
      for (const reason of ["TODOreview", "reviewTODO", "TBDpending", "reviewTBD", `first${String.fromCharCode(0x2028)}second`, `first${String.fromCharCode(0x2029)}second`]) put2(`validator-${verdict}-placeholder-${JSON.stringify(reason)}`, validateAttestation({ ...a, reason }, ctx) !== null);
    }
    resetAtt(); let r = await columns(); put2("no-attestations", { A: r.a.state, B: stateB(r.b) });
    const oldA1 = a1, oldA2 = a2;
    a1 = `data:123/${link}`; a2 = `outer.invalid/?next=${link}`; item.connection_guide = a1;
    r = await columns(); put2("known-fallible-hints-isolated", { A: r.a.state, B: stateB(r.b) });
    a1 = oldA1; a2 = oldA2; item = baseItem();
    resetAtt(); attestG("A1", "not_listed"); attestG("A2", "not_listed"); a2 += " changed"; r = await columns(); put2("A-one-page-body-changed", r.a.state); a2 = oldA2;
    resetAtt(); attestG("A1", "listed"); attestG("A2", "listed"); httpStatus = 503; r = await columns(); put2("A-fetch-failure-with-old-attestations", r.a.state); httpStatus = 200;
    resetAtt(); attestG("B", "not_listed", { date: "2026-13-01" }); r = await columns(); put2("invalid-date-production-fails-closed", stateB(r.b));
    expect("G invalid-date-production-fails-closed: the sidecar says invalid:date (P3, not unreadable)", r.diag.find((d: any) => d.source_id === "B")?.attestation === "invalid:date", JSON.stringify(r.diag.find((d: any) => d.source_id === "B")));
    for (const av of ["listed", "not_listed"]) for (const bv of ["listed", "not_listed"]) for (const pass of [true, false]) {
      resetAtt(); attestG("A1", av); attestG("A2", av); attestG("B", bv); r = await columns();
      const code = `#${1 + (av === "not_listed" ? 4 : 0) + (bv === "not_listed" ? 2 : 0) + (pass ? 0 : 1)}`;
      put2(`truth-table-${code}`, { A: r.a.state, B: stateB(r.b), code: judgeAttribution({ a: r.a, b: r.b, c: { state: pass ? "pass" : "miss" }, gtConsistent: true }).code });
    }
    const good = r;
    for (const [id, changes] of [["U0", { gtConsistent: false }], ["U1", { a: { state: "unknown" } }], ["U2", { b: { state: "unknown" } }], ["U3", { c: { state: "format" } }], ["U4", { c: { state: "instrument" } }]] as const) put2(id, judgeAttribution({ a: good.a, b: good.b, c: { state: "pass" }, gtConsistent: true, ...(changes as any) }).code);
    for (const [id, mutate] of Object.entries({ metadata_repository: (x: any) => (x._meta.repository = link), freshness_repository: (x: any) => (x.freshness.repository = link), new_root: (x: any) => (x._repository = link), ordered_array: (x: any) => (x.links = [link, false]), attempt_object: (x: any) => (x._meta.attempt_id = { repository: link }), age_string: (x: any) => (x.freshness.data_age_days = link), age_negative: (x: any) => (x.freshness.data_age_days = -1), age_fraction: (x: any) => (x.freshness.data_age_days = 0.5) })) {
      item = baseItem(); resetAtt(); attestG("B", "not_listed"); mutate(item); r = await columns(); put2(`catalog-invalidates-${id}`, stateB(r.b));
    }
    item = baseItem(); resetAtt(); attestG("B", "not_listed"); item._meta.attempt_id = "run-two"; item.freshness.data_age_days = 123; r = await columns(); put2("catalog-two-volatile-leaves", stateB(r.b));
    // the same with real-shaped ids (lower-case UUIDs): the attestation holds
    item = { ...baseItem(), _meta: { attempt_id: "0901886c-9053-494f-af18-a38d280f63ab" } }; resetAtt(); attestG("B", "not_listed"); item._meta.attempt_id = "11111111-2222-4333-8444-555555555555"; item.freshness.data_age_days = 123; r = await columns();
    expect("G catalog-two-volatile-leaves with lower-case UUID attempt ids → the attestation holds (not_listed)", stateB(r.b) === "not_listed", stateB(r.b));
    put2("canonical-key-order", catalogBody({ z: 1, a: 2 }) === catalogBody({ a: 2, z: 1 }));
    put2("canonical-array-order", catalogBody([1, 2]) !== catalogBody([2, 1]));
    for (const name of ["rename", "move", "archive", "private", "404", "timeout"]) {
      gh = { full_name: `${sealed.owner}/${sealed.name}`, private: false, archived: false }; ghMode = "normal";
      if (name === "rename") gh.full_name = `${sealed.owner}/renamed`; if (name === "move") gh.full_name = `moved/${sealed.name}`;
      if (name === "archive") gh.archived = true; if (name === "private") gh.private = true; if (["404", "timeout"].includes(name)) ghMode = name;
      const truth = await TARGETS.llmAnswer.groundTruth({ MK, sealed, harnessLog: () => {} }); put2(`ground-truth-${name}`, truth.consistent);
    }
    ghMode = "normal"; gh = { full_name: `${sealed.owner}/${sealed.name}`, private: false, archived: false };
    for (const verdict of ["listed", "not_listed"]) {
      item = baseItem(); resetAtt(); for (const s of ["A1", "A2", "B"]) attestG(s, verdict, { reason: "TODOreview" });
      r = await columns(); put2(`N1-loopback-${verdict}`, { A: r.a.state, B: stateB(r.b) });
      expect(`G N1-loopback-${verdict}: the sidecar carries reason_looks_unfinished for A1, A2 and B`, ["A1", "A2", "B"].every((s) => JSON.stringify(r.diag.find((d: any) => d.source_id === s)?.attestation_cautions) === '["reason_looks_unfinished"]'));
      // the unfinished DRAFT form this case was guarding: no verdict + the draft mark → nothing is decided
      resetAtt(); for (const s of ["A1", "A2", "B"]) attestG(s, verdict, { verdict: undefined, _draft_instructions: "sign after reading", reason: "TODOreview" });
      const rd = await columns();
      expect(`G draft form (no verdict, draft mark) for A1, A2, B → A unknown, B unknown, U1`, rd.a.state === "unknown" && stateB(rd.b) === "unknown" && judgeAttribution({ a: rd.a, b: rd.b, c: { state: "pass" }, gtConsistent: true }).code === "U1");
    }
    // the public judgement through runGenericMarker (not_listed attestations with the note "TODOreview")
    item = baseItem(); resetAtt(); for (const s of ["A1", "A2", "B"]) attestG(s, "not_listed", { reason: "TODOreview" });
    const fakeAnswers = join(gout, "answers.json"); writeFileSync(fakeAnswers, JSON.stringify({ fake: `ANSWER_PRIVATE_CANARY\nREPO: ${link}\nAUTH: OAuth 2.0` }));
    const prevAnswers = process.env.KANSEI_FAKE_LLM_ANSWERS_FILE; process.env.KANSEI_FAKE_LLM_ANSWERS_FILE = fakeAnswers;
    let runG: any;
    try {
      runG = await runGenericMarker({ target: TARGETS.llmAnswer, PACK: { ...pack, marker: MK }, MK, packPath, ROOT: gout, KANSEI_ROOT: gout, flags: { dry: true, executor: "scripted", maxReadings: 20, lang: "en" }, sealedCommon: { json: sealJson, digest, commitSha: "0".repeat(40), remoteBranches: ["origin/smoke"], sealedAt: sealJson.sealed_at, expiresAt: sealJson.expires_at, expired: false }, db: null, libDir: join(ROOT, "exec-harness", "lib"), VERSION: "smoke", HARNESS_VERSION: "0.4+smoke", OBSERVER: "kansei_harness@smoke" });
    } finally { if (prevAnswers === undefined) delete process.env.KANSEI_FAKE_LLM_ANSWERS_FILE; else process.env.KANSEI_FAKE_LLM_ANSWERS_FILE = prevAnswers; }
    const gschema = loadReadingSchema(); put2("reading-schema", runG.readings.flatMap(({ _outcome, ...x }: any) => validateReading(x, gschema)));
    const renderRows = runG.readings.map((x: any, i: number) => ({ ...x, outcome_id: x._outcome ? i + 1 : null }));
    const glines = attributionLines(renderRows); const gsheet = renderSheet(renderRows, { markerId: "M-994" });
    put2("N1-public-judgement", { A: glines[0].a.state, B: stateB(glines[0].b), code: glines[0].judgement.code });
    const otherRun = renderRows.map((x: any) => (x.outcome_id ? { ...x, evidence_ref: `other-run#sha256:${"d".repeat(64)}` } : x));
    put2("cross-run-join", attributionLines(otherRun)[0].judgement.code);
    const gbundle = join(gout, runG.bundleRel);
    const publicText = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(gbundle, f), "utf-8")).join("\n") + gsheet;
    const sidecar = JSON.parse(readFileSync(join(gbundle, "environment.private.json"), "utf-8"));
    const bodyShas = sidecar.diagnostics.filter((d: any) => d.event === "attribution_source").map((d: any) => d.body_sha256);
    put2("public-non-leakage", ["PAGE_PRIVATE_CANARY", "CATALOG_PRIVATE_CANARY", "ANSWER_PRIVATE_CANARY", ...bodyShas].some((x) => publicText.includes(x)));
    put2("sidecar-hints-present", sidecar.diagnostics.some((d: any) => d.event === "attribution_source" && d.hint));
    expect("G the caution stays private (no reason_looks_unfinished and no reason text in the public files or the sheet)", !/reason_looks_unfinished|TODOreview/.test(publicText));
  } finally { gserver.closeAllConnections(); await new Promise<void>((r) => gserver.close(() => r())); rmSync(gout, { recursive: true, force: true }); }
  for (const c of fx.cases) {
    const got = actual.get(c.id);
    expect(`G ${c.id} → ${JSON.stringify(c.expect)}${c.revised ? " (revised)" : ""}`, actual.has(c.id) && JSON.stringify(got) === JSON.stringify(c.expect), JSON.stringify(got));
  }
  expect("G every one of the 112 cases was replayed", fx.cases.every((c: any) => actual.has(c.id)) && actual.size === 112, String(actual.size));
}

// ── Part H: Codex's 88 independent cases of 1391a31 (fixtures/attribution-cases-1391a31.json) ──
// Codex's runner (outputs/audit-evidence-1391a31.zip work/independent-audit.mjs) ported: in-process attribution on a
// loopback server, observer "human:Independent fixture" in the fixture's observers.json, non-UUID attempt ids as Codex wrote them.
{
  const fx = JSON.parse(readFileSync(join(FIX, "attribution-cases-1391a31.json"), "utf-8"));
  const verbatim = JSON.parse(readFileSync(join(FIX, "evidence", "codex-1391a31-independent-cases.json"), "utf-8"));
  expect("H0 88 cases; ids, inputs and Codex's expectations equal the verbatim evidence", fx.cases.length === 88 && verbatim.cases.length === 88 && fx.cases.every((c: any, i: number) => c.id === verbatim.cases[i].id && JSON.stringify(c.input) === JSON.stringify(verbatim.cases[i].input) && JSON.stringify(c.codex_expected) === JSON.stringify(verbatim.cases[i].expected)));
  expect("H0 every expectation that differs from Codex's says why", fx.cases.every((c: any) => JSON.stringify(c.expect) === JSON.stringify(c.codex_expected) || typeof c.revised === "string"));
  const { TARGETS } = await import("../exec-harness/lib/marker-targets.mjs");
  const { runGenericMarker } = await import("../exec-harness/lib/marker-generic.mjs");
  const { readmeRows } = await import("../exec-harness/lib/marker-persist.mjs");
  const work = mkdtempSync(join(tmpdir(), "codex-1391a31-"));
  const hdir = join(work, "attestations"); mkdirSync(hdir, { recursive: true });
  const actual = new Map<string, any>();
  const add = (id: string, v: any) => actual.set(id, v);
  const repo = "https://github.com/audit-fixture/repo";
  const sealedH = { repo: "github.com/audit-fixture/repo", owner: "audit-fixture", name: "repo" };
  const sealJsonH = { expected: { official_mcp_repo_url: repo } };
  const digestH = sha256Hex(JSON.stringify(sealJsonH));
  const baseItemH = (): any => ({ service_id: "audit-fixture", mcp_status: "official", freshness: { confidence: "medium", data_age_days: 2 }, _meta: { attempt_id: "attempt-one" }, description: "CATALOG_PRIVATE_CANARY" });
  let pagesH: any, payloadH: any, ghH: string, pageStatus: number, rpcError: boolean;
  const OBS_H = "human:Independent fixture";
  const resetH = () => { pagesH = { A1: "PAGE_PRIVATE_CANARY no link", A2: "PAGE_PRIVATE_CANARY no link" }; payloadH = baseItemH(); ghH = "normal"; pageStatus = 200; rpcError = false; for (const f of readdirSync(hdir)) rmSync(join(hdir, f)); writeFileSync(join(hdir, "observers.json"), JSON.stringify([OBS_H])); };
  const hserver = createServer((req, res) => {
    req.resume(); const u = req.url || "";
    if (u === "/a1" || u === "/a2") { res.writeHead(pageStatus); return res.end(pagesH[u === "/a1" ? "A1" : "A2"]); }
    if (u === "/mcp") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(rpcError ? { jsonrpc: "2.0", id: 1, error: { code: -1, message: "failure" } } : { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payloadH) }] } })); }
    if (u.startsWith("/gh/")) {
      if (ghH === "timeout") return;
      if (ghH === "missing") { res.writeHead(404); return res.end("{}"); }
      if (ghH === "redirect" && !u.endsWith("/new")) { res.writeHead(301, { location: "/gh/new" }); return res.end(); }
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ full_name: ghH === "renamed" || ghH === "redirect" ? "audit-fixture/new" : ghH === "moved" ? "other/repo" : "audit-fixture/repo", private: ghH === "private", archived: ghH === "archived" }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => hserver.listen(0, "127.0.0.1", () => r()));
  const baseH = `http://127.0.0.1:${(hserver.address() as any).port}`;
  const cfgH = { official_docs: [{ id: "A1", url: `${baseH}/a1` }, { id: "A2", url: `${baseH}/a2` }], catalog: { display_api_url: `${baseH}/mcp`, service_id: "audit-fixture", body_fields: B_BODY_FIELDS }, attestations_dir: hdir };
  const MKH: any = { marker_id: "M-994", kind_of_truth: "llm_answer", claim: "Independent loopback attribution audit", providers: ["fake"], github_api_base: `${baseH}/gh`, github_timeout_ms: 40, verify_repo_via_github: true, attribution: cfgH };
  const attH = (source: string, verdict: string, over: any = {}) => ({ attestation: ATTESTATION_KIND, marker_id: MKH.marker_id, expected_digest: digestH, source_id: source, target: sourceTarget(cfgH, source), body_sha256: sha256Hex(source === "B" ? catalogBody(payloadH) : pagesH[source]), verdict, observer: OBS_H, date: localToday(), reason: "Fixture human reviewed the complete current body.", ...over });
  const putH = (a: any, source = a.source_id, body = a.body_sha256) => writeFileSync(join(hdir, `${MKH.marker_id}-${source}-${body}.json`), JSON.stringify(a));
  const normB = (b: any) => (b.state === "correct" ? "listed" : b.state === "wrong" ? "not_listed" : "unknown");
  async function readH() {
    const events: any[] = [];
    const rows: any = await TARGETS.llmAnswer.attribution({ MK: MKH, sealed: sealedH, harnessLog: (e: any) => events.push(e), attestationsDir: hdir, expectedDigest: digestH, markerId: MKH.marker_id });
    const a = columnA(rows[0]), b = columnB(rows[1]);
    return { A: a.state, B: normB(b), judgement: judgeAttribution({ a, b, c: { state: "pass" }, gtConsistent: true }).code, rows, events };
  }
  const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  try {
    resetH(); pagesH.A1 = repo; payloadH.repository = repo;
    add("unsigned-body-containing-link", pick(await readH(), ["A", "B", "judgement"]));
    let n = 1;
    for (const text of [`data:123/${repo}`, `wrapper.invalid/path/${repo}`, `https://wrapper.invalid/?next=${repo}`, `<a href="https:&#00000047;&#00000047;github.com/audit-fixture/repo">link</a>`]) {
      resetH(); pagesH.A1 = text; pagesH.A2 = text; payloadH.repository = text;
      add(`hint-quarantine-${n++}`, pick(await readH(), ["A", "B", "judgement"]));
    }
    n = 5;
    for (const bad of [{ code: "not_found", service_id: "someone-else" }, { code: "not_found", service_id: "audit-fixture", mcp_status: "official" }, { service_id: "audit-fixture" }, null]) {
      resetH(); payloadH = bad; add(`invalid-catalog-${n++}`, pick(await readH(), ["B"]));
    }
    for (const av of ["listed", "not_listed"]) for (const bv of ["listed", "not_listed"]) {
      resetH(); if (av === "listed") pagesH.A1 = repo; if (bv === "listed") payloadH.repository = repo;
      [attH("A1", av), attH("A2", "not_listed"), attH("B", bv)].forEach((a) => putH(a));
      const rr = await readH();
      for (const pass of [true, false]) add(`table-${av}-${bv}-${pass}`, { A: rr.A, B: rr.B, judgement: judgeAttribution({ a: columnA(rr.rows[0]), b: columnB(rr.rows[1]), c: { state: pass ? "pass" : "miss" }, gtConsistent: true }).code });
    }
    const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
    for (const [id, over] of [["verdict-TODO", { verdict: "TODOlisted" }], ["verdict-case", { verdict: "LISTED" }], ["unknown-observer", { observer: "human:Unlisted" }], ["kind-v1", { attestation: "kansei-attribution-attestation/v1" }], ["future", { date: "9999-01-01" }], ["month-13", { date: "2026-13-01" }], ["non-leap", { date: "2025-02-29" }], ["day-overflow", { date: "2026-04-31" }], ["wrong-target", { target: `${baseH}/other` }], ["wrong-marker", { marker_id: "M-993" }], ["wrong-source", { source_id: "A1" }], ["wrong-digest", { expected_digest: "0".repeat(64) }], ["wrong-body", { body_sha256: "0".repeat(64) }], ["draft-instructions", { _draft_instructions: "review" }], ["extra-key", { extra: "x" }], ["reason-empty", { reason: " " }], ["reason-201", { reason: "x".repeat(201) }], ["reason-LF", { reason: "read\nbody" }], ["reason-CR", { reason: "read\rbody" }], ["reason-TAB", { reason: "read\tbody" }], ["reason-DEL", { reason: `read${String.fromCharCode(0x7f)}body` }], ["reason-NEL", { reason: `read${String.fromCharCode(0x85)}body` }], ["reason-LS", { reason: `read${LS}body` }], ["reason-PS", { reason: `read${PS}body` }]] as const) {
      resetH(); const a = attH("B", "not_listed", over as any); putH(a, "B", sha256Hex(catalogBody(payloadH))); add(id, pick(await readH(), ["B"]));
    }
    for (const key of Object.keys(attH("B", "not_listed"))) { resetH(); const a: any = attH("B", "not_listed"); delete a[key]; putH(a, "B", sha256Hex(catalogBody(payloadH))); add(`missing-${key}`, pick(await readH(), ["B"])); }
    n = 51;
    for (const observers of [null, [], [OBS_H, 5], [OBS_H, "human: "], [OBS_H, `human:x${LS}y`], {}]) {
      resetH(); const a = attH("B", "not_listed"); putH(a);
      if (observers === null) rmSync(join(hdir, "observers.json")); else writeFileSync(join(hdir, "observers.json"), JSON.stringify(observers));
      add(`observer-list-${n++}`, pick(await readH(), ["B"]));
    }
    for (const reason of ["TODOreview", "reviewTODO", "TBDpending", "reviewTBD", "x".repeat(200)]) {
      resetH(); const a = attH("B", "not_listed", { reason }); putH(a);
      const rr = await readH(); const d = rr.rows.diagnostics.find((x: any) => x.source_id === "B");
      add(`note-${reason.slice(0, 15)}`, { B: rr.B, caution: d.attestation_cautions.includes("reason_looks_unfinished"), public_caution: JSON.stringify([rr.rows, rr.events]).includes("reason_looks_unfinished") });
    }
    for (const path of ["_repository", "_meta.repository", "freshness.repository", "freshness.confidence", "_meta.attempt_id"]) {
      resetH(); const a = attH("B", "not_listed"); putH(a); const parts = path.split(".");
      if (parts.length === 1) payloadH[path] = repo; else payloadH[parts[0]][parts[1]] = repo;
      const rr = await readH(); add(`link-added-${path}`, { B: rr.B, body_changed: sha256Hex(catalogBody(payloadH)) !== a.body_sha256 });
    }
    resetH(); payloadH._meta.attempt_id = repo; const oldListed = attH("B", "listed"); putH(oldListed); payloadH._meta.attempt_id = "attempt-two";
    { const rr = await readH(); add("link-removed-attempt-id", { B: rr.B, body_changed: sha256Hex(catalogBody(payloadH)) !== oldListed.body_sha256 }); }
    for (const mode of ["normal", "renamed", "moved", "redirect", "archived", "private", "missing", "timeout"]) {
      resetH(); ghH = mode; const t = await TARGETS.llmAnswer.groundTruth({ MK: MKH, sealed: sealedH, harnessLog: () => {} }); add(`ground-truth-${mode}`, { consistent: t.consistent });
    }
    for (const id of ["A1", "A2", "B"]) {
      resetH(); const a = attH(id, "not_listed"); putH(a); if (id === "B") payloadH.description += " changed"; else pagesH[id] += " changed";
      const rr = await readH(); add(`body-change-${id}`, id === "B" ? { B: rr.B } : { A: rr.A });
    }
    const schemaH = loadReadingSchema();
    for (const mode of ["unsigned", "valid-not-listed", "stale-negative-link-added", "stale-positive-link-removed", "reason-caution", "repo-moved", "no-A-attestation", "agent-format", "agent-instrument"]) {
      resetH();
      pagesH.A1 = repo; putH(attH("A1", "listed")); putH(attH("A2", "not_listed"));
      if (mode === "stale-positive-link-removed") payloadH._meta.attempt_id = repo;
      if (mode !== "unsigned") putH(attH("B", mode === "stale-positive-link-removed" ? "listed" : "not_listed", mode === "reason-caution" ? { reason: "TODOreview" } : {}));
      if (mode === "stale-negative-link-added") payloadH._meta.attempt_id = repo;
      if (mode === "stale-positive-link-removed") payloadH._meta.attempt_id = "attempt-new";
      if (mode === "repo-moved") ghH = "moved";
      if (mode === "no-A-attestation") for (const f of readdirSync(hdir)) if (f.includes("-A1-") || f.includes("-A2-")) rmSync(join(hdir, f));
      const PACK = { id: "independent-loopback-audit", version: 1, service_id: "audit-fixture", marker: MKH, budgets: { timeout_s: 5 }, goal_prompt: { ja: "fixture" } };
      const packPath = join(work, "pack.json"); writeFileSync(packPath, JSON.stringify(PACK));
      const target = { ...TARGETS.llmAnswer, observe: async () => ({ text: mode === "agent-format" ? "malformed answer" : `ANSWER_PRIVATE_CANARY\nREPO: ${repo}\nAUTH: OAuth 2.0`, error: mode === "agent-instrument" ? "fixture provider failure" : null, model: "fixture-model" }) };
      const rg: any = await runGenericMarker({ target, PACK, MK: MKH, packPath, ROOT: work, KANSEI_ROOT: work, flags: { dry: true, executor: "scripted", maxReadings: 50, lang: "ja" }, sealedCommon: { json: sealJsonH, digest: digestH, commitSha: "fixture", remoteBranches: [], sealedAt: "2026-01-01", expiresAt: "2099-01-01", expired: false }, db: null, libDir: join(ROOT, "exec-harness", "lib"), VERSION: "0.0.0", HARNESS_VERSION: "smoke+1391a31", OBSERVER: "kansei_harness@independent" });
      const bundle = join(work, rg.bundleRel); const rows = rg.readings.map(({ _outcome, ...x }: any) => ({ ...x, outcome_id: _outcome ? 1 : null }));
      const line = attributionLines(rows)[0]; const sheet = renderSheet(rows, { markerId: MKH.marker_id });
      const pub = ["metrics.json", "manifest.json", "harness.jsonl"].map((f) => readFileSync(join(bundle, f), "utf-8")).join("\n") + sheet + readmeRows(rg.readings).gtRows;
      const priv = JSON.parse(readFileSync(join(bundle, "environment.private.json"), "utf-8"));
      const bodyShas = priv.diagnostics.filter((x: any) => x.event === "attribution_source").map((x: any) => x.body_sha256).filter(Boolean);
      add(`bundle-${mode}`, { A: line.a.state, B: normB(line.b), judgement: line.judgement.code, schema_valid: rg.readings.every(({ _outcome, ...x }: any) => validateReading(x, schemaH).length === 0), leaked: /PAGE_PRIVATE_CANARY|CATALOG_PRIVATE_CANARY|ANSWER_PRIVATE_CANARY|reason_looks_unfinished|body_sha256/.test(pub) || bodyShas.some((x: string) => pub.includes(x)) });
    }
  } finally { hserver.closeAllConnections(); await new Promise<void>((r) => hserver.close(() => r())); rmSync(work, { recursive: true, force: true }); }
  for (const c of fx.cases) {
    const got = actual.get(c.id);
    const okH = actual.has(c.id) && Object.entries(c.expect).every(([k, v]) => JSON.stringify(got?.[k]) === JSON.stringify(v));
    expect(`H ${c.id} → ${JSON.stringify(c.expect)}${c.revised ? " (revised)" : ""}`, okH, JSON.stringify(got));
  }
  expect("H every one of the 88 cases was replayed", fx.cases.every((c: any) => actual.has(c.id)) && actual.size === 88, String(actual.size));
}

console.log(failures === 0 ? "\nmarker attribution smoke: ALL PASS" : `\nmarker attribution smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
