#!/usr/bin/env node
/**
 * agent-wiki-demo — 「読んで役に立つか」のデモ: 同じタスクを、新しいセッションで Wiki の URL を渡す／渡さないで試す
 *
 * 定点測定（準実験・score-probe.cjs で採点する「見つけてもらえるか」）とは**完全に別の記録**。
 *   - URL を渡すのは介入そのもの。被引用率の集計に混ぜると準実験の比較が壊れる
 *   - 結果は `record_type: "agent_wiki_demo"`・`sessions[]` の形で書く（`results[]` を持たない＝score-probe.cjs は読めずに止まる）
 *   - 出力先が準実験のフォルダ（AgentWiki-Probe_*）や、定点測定の結果フォルダ名（agent-runs-*）なら実行しない
 *
 * 隔離・CLI の起動は、審査済みの条件 B の実行器 `agent-answer-audit.mjs` をそのまま使う（1 セッション＝1 質問の battery を渡して呼ぶ）。
 * ここで足すのは、組み合わせの順番・記録の集計（達成・時間・token・検索回数・Wiki の使われ方）だけ。
 * 例外は 1 つ: Wiki あり群では、プロンプトで渡した URL を開く／その名前で検索するのは正当なので、
 * 「最初の呼び出しに自社関連語」の混入判定だけを免除し、免除した事実を記録に残す。他の混入判定（許可外ツール・スキル・MCP 等）は両群とも同じ。
 *
 *   node scripts/agent-wiki-demo.mjs <tasks.json> --env-dir=C:/Users/HP/probe-env-b --agent=claude --model=claude-opus-5 \
 *        --reps=3 --tag=<label> --out-dir=<founder-ops/research/AgentWiki-Demo_…> [--tasks=square,colorme] [--park-host-skills] [--resume] [--dry-run]
 *   --dry-run: 実行順・プロンプト・呼び出すコマンド・保存先を表示するだけ（CLI も実行器も呼ばない）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodexJsonl, parseClaudeJsonl } from "./lib/agent-record-parsers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(HERE, "agent-answer-audit.mjs");
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const flag = (k) => args.includes(`--${k}`);
const die = (m) => { console.error(m); process.exit(2); };

const tasksPath = args.find((a) => !a.startsWith("--")) ?? die("tasks.json を指定する");
const tasksRaw = readFileSync(tasksPath);
const TASKS = JSON.parse(tasksRaw);
if (TASKS.record_type !== "agent_wiki_demo_tasks") die("tasks.json の record_type が agent_wiki_demo_tasks ではない");
const AGENT = opt("agent") ?? die("--agent=claude|codex が必要（1 回の実行で 1 エージェント）");
if (!["claude", "codex"].includes(AGENT)) die("--agent は claude か codex");
const MODEL = opt("model") ?? die("--model が必要（モデルは必ず明示指定）");
const REPS = Number(opt("reps") ?? 3); if (!(REPS >= 1)) die("--reps は 1 以上");
const TAG = (opt("tag") ?? "").replace(/[^A-Za-z0-9._-]/g, ""); if (!TAG) die("--tag=<label> が必要（結果を上書きしない）");
const ENV_DIR = opt("env-dir") ?? die("--env-dir=<測定専用環境> が必要");
const OUT_BASE = resolve(opt("out-dir") ?? die("--out-dir が必要（デモ専用のフォルダ）"));
const RUN_DIR = join(OUT_BASE, `demo-runs-${TAG}`);
// 定点測定との分離: 準実験のフォルダ・定点測定の結果フォルダには書かない
if (/AgentWiki-Probe/i.test(RUN_DIR) || /(^|[\\/])agent-runs-/i.test(RUN_DIR)) die(`出力先が定点測定の領域: ${RUN_DIR}（デモは別フォルダに置く）`);

const only = opt("tasks")?.split(",");
const tasks = TASKS.tasks.filter((t) => !only || only.includes(t.id));
if (only && tasks.length !== only.length) die(`--tasks に無い id: ${only.filter((i) => !tasks.some((t) => t.id === i)).join(",")}`);

// ── プロンプト: 2 群の差は「参考資料の 1 段落」だけ ────────────────────────
const promptOf = (t, arm) => arm === "with_wiki" ? `${t.prompt}\n\n${TASKS.wiki_hint.replace("{url}", t.wiki_url)}` : t.prompt;

// ── 実行順: 繰り返しごとに、タスクの中で Wiki あり／なしの先後を入れ替える（ABBA）。決め打ちで再現できる ──
const schedule = [];
for (let r = 1; r <= REPS; r++) tasks.forEach((t, i) => {
  const arms = (r + i) % 2 === 0 ? ["with_wiki", "without_wiki"] : ["without_wiki", "with_wiki"];
  for (const arm of arms) schedule.push({ session_id: `r${r}-${t.id}-${arm}`, rep: r, task_id: t.id, arm });
});

const auditArgs = (sessDir) => [AUDIT, join(sessDir, "battery.json"), `--env-dir=${ENV_DIR}`, `--agents=${AGENT}`, `--${AGENT}-model=${MODEL}`, "--tag=s", `--out-dir=${sessDir}`, ...(flag("park-host-skills") ? ["--park-host-skills"] : [])];

if (flag("dry-run")) {
  console.log(`[demo] DRY RUN（CLI も実行器も呼ばない）\n  agent=${AGENT} model=${MODEL} reps=${REPS} tasks=${tasks.map((t) => t.id).join(",")} sessions=${schedule.length}\n  保存先: ${RUN_DIR}/demo-results.json（定点測定とは別）`);
  schedule.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.session_id}`));
  const ex = tasks[0];
  for (const arm of ["without_wiki", "with_wiki"]) console.log(`\n── プロンプト例（${ex.id} / ${arm}）──\n${promptOf(ex, arm)}`);
  console.log(`\n── 1 セッションの呼び出し ──\nnode ${auditArgs(join(RUN_DIR, "_sessions", schedule[0].session_id)).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  process.exit(0);
}

// ── 記録の組み立て ───────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>"'`)\]}、。」】）]+/g;
const urlsIn = (s) => [...new Set((String(s ?? "").match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
const parseUrl = (u) => { try { return new URL(u); } catch { return null; } };
const WIKI_HOSTS = new Set(["kansei-link.com", "www.kansei-link.com"]);
const norm = (x) => String(x ?? "").toLowerCase().replace(/https?:\/\/(www\.)?/g, "").replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, "");
const isWiki = (u) => { const p = parseUrl(u); return !!p && WIKI_HOSTS.has(p.hostname.toLowerCase()) && p.pathname.startsWith("/agent-wiki/"); };

function runCheck(c, text) {
  const urls = urlsIn(text);
  if (c.type === "regex") { const m = String(text).match(new RegExp(c.pattern, c.flags ?? "i")); return { pass: !!m, evidence: m ? m[0].slice(0, 120) : null }; }
  if (c.type === "url") { // URL が本文にある（host 一致・path の前方一致）
    const hit = urls.find((u) => { const p = parseUrl(u); return p && p.hostname.toLowerCase().replace(/^www\./, "") === c.host.replace(/^www\./, "") && p.pathname.replace(/\/+$/, "").startsWith((c.path_prefix ?? "").replace(/\/+$/, "")); });
    return { pass: !!hit, evidence: hit ?? null };
  }
  if (c.type === "config_block") { // コードブロックの中に値がある（設定例を書いたか）
    const blocks = [...String(text).matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
    const hit = blocks.find((b) => b.includes(c.contains));
    return { pass: !!hit, evidence: hit ? hit.slice(0, 160) : null };
  }
  throw new Error(`未知の check type: ${c.type}`);
}

function toolCounts(agent, jsonl) {
  const ev = String(jsonl).split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const out = { web_searches: 0, pages_opened: 0, search_queries: [], opened_urls: [] };
  if (agent === "codex") {
    for (const e of ev) if (e.type === "item.completed" && e.item?.type === "web_search") {
      const a = e.item.action ?? {};
      if (a.type === "search" || (!a.url && (a.query || a.queries))) { out.web_searches++; out.search_queries.push(...(a.queries ?? [a.query ?? e.item.query])); }
      else { out.pages_opened++; out.opened_urls.push(...urlsIn(a.url ?? e.item.query)); }
    }
  } else {
    for (const e of ev) for (const b of (Array.isArray(e.message?.content) ? e.message.content : [])) if (e.type === "assistant" && b.type === "tool_use") {
      if (b.name === "WebSearch") { out.web_searches++; out.search_queries.push(b.input?.query ?? ""); }
      if (b.name === "WebFetch") { out.pages_opened++; out.opened_urls.push(b.input?.url ?? ""); }
    }
  }
  return out;
}

function normTokens(agent, usage) {
  if (!usage) return { input_tokens: null, cached_input_tokens: null, output_tokens: null };
  if (agent === "codex") return { input_tokens: usage.input_tokens ?? null, cached_input_tokens: usage.cached_input_tokens ?? null, output_tokens: usage.output_tokens ?? null };
  return { input_tokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0), cached_input_tokens: usage.cache_read_input_tokens ?? null, output_tokens: usage.output_tokens ?? null, turns: usage.num_turns ?? null };
}

// Wiki あり群だけ: 渡した URL・その名前による「最初の呼び出しに自社関連語」は免除（プロンプトが原因の正当な呼び出し）
const PROMPT_INDUCED = /^最初の(検索語|ツール呼び出し)に自社関連語/;

function buildSession(s, t, sessDir, auditExit) {
  const file = join(sessDir, "agent-runs-s", "results.json");
  if (!existsSync(file)) return null; // 実行器が始まる前に止まった（preflight・スキル可視など）→ 呼び出し側で全体を止める
  const R = JSON.parse(readFileSync(file, "utf8"));
  const a = R.results?.[0]?.answers?.[AGENT];
  const rawPath = join(sessDir, "agent-runs-s", "raw", `${t.id}.${AGENT}.jsonl`);
  const raw = existsSync(rawPath) ? readFileSync(rawPath, "utf8") : "";
  const p = (AGENT === "codex" ? parseCodexJsonl : parseClaudeJsonl)(raw);
  if (a?.contamination?.length) for (const c of a.contamination) if (!p.contamination.includes(c)) p.contamination.push(c); // stderr 由来の判定も引き継ぐ
  const waived = s.arm === "with_wiki" ? p.contamination.filter((c) => PROMPT_INDUCED.test(c)) : [];
  const contamination = p.contamination.filter((c) => !waived.includes(c));
  const infra = a?.invalid_kind === "infra" ? a.error : p.error;
  const status = infra ? "infra_error" : contamination.length ? "invalid_contamination" : "ok";
  const text = status === "ok" ? p.text : "";
  const checks = t.checks.map((c) => ({ id: c.id, label: c.label, ...runCheck(c, text) }));
  const tools = toolCounts(AGENT, raw);
  const wikiOpened = tools.opened_urls.filter(isWiki);
  const cited = urlsIn(text);
  return {
    session_id: s.session_id, task_id: t.id, service_id: t.service_id, arm: s.arm, rep: s.rep,
    agent: AGENT, model: MODEL, model_returned: p.model_returned ?? null, cli_version: a?.cli_version ?? null,
    asked_at: a?.asked_at ?? null, prompt_sha256: createHash("sha256").update(promptOf(t, s.arm)).digest("hex"), wiki_url_given: s.arm === "with_wiki" ? t.wiki_url : null,
    status, error: infra ?? (contamination.length ? contamination.join(" / ") : null), contamination_waived: waived, auditor_exit: auditExit,
    outcome: {
      auto_checks: checks, auto_pass: status === "ok" && checks.every((c) => c.pass),
      judge: { success: null, notes: "", missing_info: [], wiki_errors: [], judged_by: null, judged_at: null }, // 人が一次資料で確かめて埋める
      judge_only: t.judge_only ?? [],
    },
    cost: { wall_ms: a?.wall_ms ?? null, ...normTokens(AGENT, p.usage) },
    tool_use: tools,
    wiki: {
      opened: wikiOpened, opened_given_page: wikiOpened.some((u) => u.replace(/[?#].*$/, "") === t.wiki_url),
      cited: cited.filter(isWiki),
      confirmed_values_in_answer: (t.wiki_confirmed ?? []).map((f) => ({ field: f.field, value: f.value, appears: norm(text).includes(norm(f.value)) })), // 大文字小文字・記号・空白の違いは無視（oauth2 と OAuth 2.0）
    },
    answer_text: text,
    raw: { jsonl: rawPath, auditor_results: file },
  };
}

// ── 集計（数字の要約だけ。成否の最終判断は judge） ─────────────────────
const median = (xs) => { const v = xs.filter((x) => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
function summarize(sessions) {
  const rows = [];
  for (const t of tasks) for (const arm of ["without_wiki", "with_wiki"]) {
    const xs = sessions.filter((x) => x.task_id === t.id && x.arm === arm);
    const ok = xs.filter((x) => x.status === "ok");
    rows.push({ task_id: t.id, arm, sessions: xs.length, valid: ok.length, invalid: xs.filter((x) => x.status === "invalid_contamination").length, infra: xs.filter((x) => x.status === "infra_error").length,
      auto_pass: ok.filter((x) => x.outcome.auto_pass).length, judged_success: ok.filter((x) => x.outcome.judge.success === true).length, judged: ok.filter((x) => x.outcome.judge.success != null).length,
      median_wall_s: median(ok.map((x) => x.cost.wall_ms)) == null ? null : Math.round(median(ok.map((x) => x.cost.wall_ms)) / 1000),
      median_input_tokens: median(ok.map((x) => x.cost.input_tokens)), median_output_tokens: median(ok.map((x) => x.cost.output_tokens)),
      median_searches: median(ok.map((x) => x.tool_use.web_searches)), median_pages_opened: median(ok.map((x) => x.tool_use.pages_opened)),
      wiki_opened: ok.filter((x) => x.wiki.opened.length).length, wiki_not_used: ok.filter((x) => !x.wiki.opened.length).length });
  }
  return rows;
}

// ── 実行 ─────────────────────────────────────────────────────
mkdirSync(join(RUN_DIR, "_sessions"), { recursive: true });
const resultsFile = join(RUN_DIR, "demo-results.json");
const condition = { agent: AGENT, model: MODEL, reps: REPS, tasks: tasks.map((t) => t.id), tasks_sha256: createHash("sha256").update(tasksRaw).digest("hex"), wiki_hint: TASKS.wiki_hint, auditor: basename(AUDIT), auditor_sha256: createHash("sha256").update(readFileSync(AUDIT)).digest("hex"), env_dir: resolve(ENV_DIR) };
let prior = null;
if (existsSync(resultsFile)) {
  if (!flag("resume")) die(`既に結果がある: ${resultsFile}（続きなら --resume、別の回なら --tag を変える）`);
  prior = JSON.parse(readFileSync(resultsFile, "utf8"));
  if (JSON.stringify(prior.condition) !== JSON.stringify(condition)) die("--resume: 条件（エージェント・モデル・回数・タスク・ヒント文・実行器）が前回と違う — 再開しない");
}
const sessions = new Map((prior?.sessions ?? []).map((x) => [x.session_id, x]));
const runs = [...(prior?.runs ?? []), { started_at: new Date().toISOString() }];
const save = (stopped = null) => {
  const list = schedule.map((s) => sessions.get(s.session_id)).filter(Boolean);
  const out = {
    record_type: "agent_wiki_demo",
    separation: "デモ（Wiki の URL を渡す／渡さない）。定点測定（準実験・score-probe.cjs）の結果ではない。被引用率の集計に使わない",
    condition, schedule, runs, stopped, updated_at: new Date().toISOString(),
    complete: schedule.every((s) => ["ok", "invalid_contamination"].includes(sessions.get(s.session_id)?.status)),
    summary: summarize(list), sessions: list,
  };
  writeFileSync(resultsFile, JSON.stringify(out, null, 1));
  return out;
};

let infraStreak = 0; let stopped = null;
for (const s of schedule) {
  const t = tasks.find((x) => x.id === s.task_id);
  const done = sessions.get(s.session_id);
  if (done && done.status !== "infra_error") continue; // 有効・混入で無効は引き直さない（都合のよい結果が出るまで引き直さない）
  const sessDir = join(RUN_DIR, "_sessions", s.session_id);
  if (existsSync(sessDir)) renameSync(sessDir, `${sessDir}.failed-${Date.now()}`); // 失敗した回の記録も消さない
  mkdirSync(sessDir, { recursive: true });
  writeFileSync(join(sessDir, "battery.json"), JSON.stringify({ target: `agent-wiki-demo ${s.session_id}`, questions: [{ id: t.id, question: promptOf(t, s.arm) }] }, null, 1));
  const r = spawnSync(process.execPath, auditArgs(sessDir), { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(sessDir, "auditor.log"), `${r.stdout ?? ""}\n--- stderr ---\n${r.stderr ?? ""}`);
  const rec = buildSession(s, t, sessDir, r.status);
  if (!rec) { stopped = { at: new Date().toISOString(), session_id: s.session_id, reason: `実行器が開始前に停止（exit ${r.status}）: ${(r.stderr ?? "").trim().split("\n").slice(-3).join(" / ")}` }; break; }
  sessions.set(s.session_id, rec);
  console.log(`  ${rec.status === "ok" ? "✓" : "✗"} ${s.session_id} — ${rec.status}${rec.status === "ok" ? ` auto_pass=${rec.outcome.auto_pass} ${Math.round((rec.cost.wall_ms ?? 0) / 1000)}s 検索 ${rec.tool_use.web_searches}・開いた ${rec.tool_use.pages_opened}・Wiki ${rec.wiki.opened.length}` : ` ${String(rec.error).slice(0, 140)}`}`);
  save();
  infraStreak = rec.status === "infra_error" ? infraStreak + 1 : 0;
  if (infraStreak >= 3) { stopped = { at: new Date().toISOString(), session_id: s.session_id, reason: "3 セッション連続で基盤側の失敗（利用枠・認証の疑い）。--resume で再開できる" }; break; }
}
runs[runs.length - 1].ended_at = new Date().toISOString();
const final = save(stopped);
if (stopped) console.log(`  ■ 停止: ${stopped.reason}`);
console.log(`\ncomplete=${final.complete} ／ ${final.sessions.length}/${schedule.length} セッション記録 → ${resultsFile}`);
for (const row of final.summary) console.log(`  ${row.task_id.padEnd(13)} ${row.arm.padEnd(12)} 有効 ${row.valid}/${row.sessions}・自動判定 ${row.auto_pass}・時間中央 ${row.median_wall_s ?? "-"}s・入力token中央 ${row.median_input_tokens ?? "-"}・検索中央 ${row.median_searches ?? "-"}・Wiki を開いた ${row.wiki_opened}`);
process.exit(stopped && !final.sessions.length ? 2 : 0);
