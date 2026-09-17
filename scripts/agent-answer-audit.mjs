#!/usr/bin/env node
/**
 * agent-answer-audit — 条件 B: サブスク認証のエージェント CLI（Codex・Claude Code）に、検索・閲覧だけを許して質問する
 *
 * ai-answer-audit（条件 A・API 直呼び）とは別条件。API キーは使わない（環境変数から外して起動する）。
 * 守ること:
 *   - 1 質問 = 1 つの新しいセッション。セルごとに空の作業ディレクトリを作る。会話の持ち越しなし
 *   - 測定専用環境（--env-dir）だけを見せる: HOME / USERPROFILE / CODEX_HOME / CLAUDE_CONFIG_DIR をそこへ向ける。
 *     この PC の普段の環境には KanseiLINK を知っているスキル・記憶・MCP があり、それが見えると測定にならない
 *   - モデルは必ず明示指定（--codex-model / --claude-model）。指定が無ければ実行しない
 *   - 生の記録（JSONL）をセルごとに保存し、隔離の破れ・事前知識の混入を機械検査して、該当セルは無効にする
 *
 *   node scripts/agent-answer-audit.mjs <battery.json> --env-dir=C:/Users/HP/probe-env-b \
 *        --codex-model=<id> --claude-model=<id> [--agents=codex,claude] [--ids=a,b] [--limit=N] --tag=<label> [--out-dir=<dir>]
 *   node scripts/agent-answer-audit.mjs --preflight --env-dir=...      環境の中身を検査（ファイルだけ・CLI は呼ばない）
 *   node scripts/agent-answer-audit.mjs --canary --env-dir=... --codex-model=.. --claude-model=..   各 CLI に「見えている指示・スキル・記憶・MCP」を申告させる
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, mkdtempSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodexJsonl, parseClaudeJsonl, PRIOR_KNOWLEDGE } from "./lib/agent-record-parsers.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const flag = (k) => args.includes(`--${k}`);
const ENV_DIR = opt("env-dir") ? resolve(opt("env-dir")) : null;
if (!ENV_DIR || !existsSync(ENV_DIR)) { console.error("--env-dir=<測定専用環境> が必要（founder-ops の別紙 v2b 参照）"); process.exit(2); }
const P = { home: join(ENV_DIR, "home"), codex: join(ENV_DIR, "codex-home"), claude: join(ENV_DIR, "claude-home"), work: join(ENV_DIR, "work"), fixed: join(ENV_DIR, "fixed") };
const SYSTEM_PROMPT = "あなたは利用者の質問に日本語で答えるアシスタントです。必要ならWeb検索・ページ閲覧を使い、回答の根拠にしたページはURLを本文に明記してください。";
const TIMEOUT_MS = Number(opt("timeout-sec") ?? 600) * 1000;

// 子プロセスに渡す環境: API キー類を外し、ホームを測定専用環境へ向ける
function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/API_KEY|AUTH_TOKEN|^CLAUDE_CODE_|^CLAUDECODE$|^CODEX_(?!HOME)/i.test(k)) delete env[k];
  return { ...env, HOME: P.home, USERPROFILE: P.home, CODEX_HOME: P.codex, CLAUDE_CONFIG_DIR: P.claude };
}
const NPM = join(process.env.APPDATA ?? "", "npm", "node_modules");
const BIN = {
  codex: { cmd: process.execPath, pre: [join(NPM, "@openai", "codex", "bin", "codex.js")] },
  claude: { cmd: join(NPM, "@anthropic-ai", "claude-code", "bin", "claude.exe"), pre: [] },
};
// テスト用: PROBE_STUB_CLI=<stub.mjs> で両 CLI を偽物に差し替え、PROBE_HOST_HOME でホスト側ホームを差し替える
// （再開とスキル退避の復旧を、利用枠も本物のスキルフォルダも使わずに検査するため。本番では設定しない）
if (process.env.PROBE_STUB_CLI) for (const a of Object.keys(BIN)) BIN[a] = { cmd: process.execPath, pre: [process.env.PROBE_STUB_CLI, a] };
const HOST_HOME = process.env.PROBE_HOST_HOME || homedir();
const HOST_SKILLS = join(HOST_HOME, ".agents", "skills");
const PARKED = join(HOST_HOME, ".agents", "skills.parked-by-probe");
const restoreSkills = () => { if (existsSync(PARKED) && !existsSync(HOST_SKILLS)) { renameSync(PARKED, HOST_SKILLS); console.log(`  ホスト側スキルを戻した: ${HOST_SKILLS}`); return true; } return false; };
// 前回が異常終了（強制終了・電源断）して退避されたままなら、どのモードで起動しても最初に戻す
const restoredAtStart = restoreSkills();
if (flag("restore-host-skills")) { console.log(restoredAtStart ? "復旧した" : `戻すものは無い（${existsSync(HOST_SKILLS) ? "スキルは元の場所にある" : "スキルフォルダ自体が無い"}）`); process.exit(0); }
const cliArgs = {
  // ⚠️ HOME / USERPROFILE を向け替えても、Codex は OS のユーザーフォルダ（C:/Users/<user>/.agents/skills）からスキルを拾う（canary で検出）。
  //    開発中フラグ skip_host_skill_discovery を有効にしても変わらなかった（2026-09-17・0.153.4）。測定中はそのフォルダ自体を退避する必要がある
  // apps / plugins / memories: ChatGPT アカウントのコネクタ（Gmail・Drive 等）やプラグイン・記憶を見せない
  // web_search は "live" を明示して固定する（値は disabled / cached / indexed / live。--search も live の意味だが、既定値の変更に左右されないよう両方書く）
  codex: (model) => ["--search", "-c", 'web_search="live"', "--disable", "apps", "--disable", "plugins", "--disable", "memories", "exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "-m", model, "-"],
  claude: (model) => ["-p", "--output-format", "stream-json", "--verbose", "--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch,WebFetch", "--strict-mcp-config", "--mcp-config", join(P.fixed, "empty-mcp.json"), "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence", "--model", model, "--system-prompt", SYSTEM_PROMPT],
};

function runCli(agent, model, question) {
  return new Promise((done) => {
    const cwd = mkdtempSync(join(P.work, `${agent}-`)); // セルごとに空の作業ディレクトリ
    const child = spawn(BIN[agent].cmd, [...BIN[agent].pre, ...cliArgs[agent](model)], { cwd, env: childEnv(), windowsHide: true });
    let out = ""; let err = "";
    const started = Date.now();
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); done({ out, err: String(e), code: -1, ms: Date.now() - started }); });
    child.on("close", (code) => { clearTimeout(timer); done({ out, err, code, ms: Date.now() - started }); });
    child.stdin.end(question);
  });
}

// ─── preflight: 測定専用環境の中身（ファイルだけを見る）────────────────────────
function preflight() {
  const problems = []; const notes = []; let vendorCount = 0;
  const ls = (d) => { try { return readdirSync(d); } catch { return []; } }; // Windows が作る保護フォルダ（INetCache 等）は読めないので飛ばす
  const walk = (dir, depth = 0) => (depth > 8 || !existsSync(dir) ? [] : ls(dir).flatMap((f) => { const p = join(dir, f); let isDir = false; try { isDir = statSync(p).isDirectory(); } catch { /* 読めない */ } return isDir ? [p + "/", ...walk(p, depth + 1)] : [p]; }));
  for (const [name, dir] of Object.entries({ home: P.home, "codex-home": P.codex, "claude-home": P.claude })) {
    const files = walk(dir).map((p) => p.slice(dir.length + 1).replace(/\\/g, "/"));
    notes.push(`${name}: ${files.filter((f) => !f.endsWith("/")).length} ファイル（最上位: ${[...new Set(files.map((f) => f.split("/")[0]))].join(", ") || "空"}）`);
    for (const f of files) {
      // CLI 自身が初回起動で展開する同梱物（Codex の system skills・公式プラグインの目録）は誰の環境にもあるので許す。
      // ただし中身に自社関連語があれば問題にする。それ以外のスキル・記憶・プラグイン類は 1 つでも問題
      const vendor = /^(skills\/\.system\/|plugins\/cache\/openai-[^/]+\/|plugins\/known_marketplaces\.json$|plugins\/marketplaces\/claude-plugins-official\/|\.tmp\/)/.test(f);
      if (/(^|\/)(skills|memories|plugins|agents|commands|rules|prompts)\//i.test(f) && !f.endsWith("/")) {
        if (!vendor) problems.push(`${name}/${f}: スキル・記憶・プラグイン類のファイルがある`);
        else { vendorCount++; if (/\.(md|json|ya?ml|toml|txt)$/i.test(f) && PRIOR_KNOWLEDGE.test(readFileSync(join(dir, f), "utf8"))) problems.push(`${name}/${f}: CLI 同梱物の中に自社関連語`); }
      }
      if (!vendor && /(^|\/)(AGENTS(\.override)?\.md|CLAUDE\.md|config\.toml|settings(\.local)?\.json|hooks\.json)$/i.test(f)) { // 同梱の目録内の hooks.json は未インストールの見本（有効なプラグインが 0 であることは毎回 init イベントで検査）
        const body = readFileSync(join(dir, f), "utf8");
        if (/AGENTS|CLAUDE\.md$/i.test(f) || /mcp_servers|mcpServers|hooks|instructions/i.test(body) || PRIOR_KNOWLEDGE.test(body)) problems.push(`${name}/${f}: 指示・MCP・フックの設定がある`);
      }
    }
  }
  for (let d = ENV_DIR; ; d = dirname(d)) { for (const f of ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", ".claude/CLAUDE.md"]) if (existsSync(join(d, f))) problems.push(`上位ディレクトリに指示ファイル: ${join(d, f)}`); if (dirname(d) === d) break; }
  if (PRIOR_KNOWLEDGE.test(ENV_DIR)) problems.push("環境のパスに自社関連語がある（作業ディレクトリ名としてエージェントに見える）");
  notes.push(`CLI 同梱のスキル・プラグイン目録: ${vendorCount} ファイル（自社関連語の有無を検査済み）`);
  notes.push(`ログイン: codex ${existsSync(join(P.codex, "auth.json")) ? "あり" : "なし"} ／ claude ${existsSync(join(P.claude, ".credentials.json")) ? "あり" : "なし"}`);
  return { problems, notes };
}

mkdirSync(P.work, { recursive: true }); mkdirSync(P.fixed, { recursive: true });
writeFileSync(join(P.fixed, "empty-mcp.json"), JSON.stringify({ mcpServers: {} }));

if (flag("preflight")) {
  const { problems, notes } = preflight();
  notes.forEach((n) => console.log("  " + n));
  console.log(problems.length ? `❌ preflight: ${problems.length} 件\n  - ${problems.join("\n  - ")}` : "✅ preflight: 指示・スキル・記憶・MCP のファイルなし");
  process.exit(problems.length ? 1 : 0);
}

const MODELS = { codex: opt("codex-model"), claude: opt("claude-model") };
const agents = (opt("agents") ?? "codex,claude").split(",").filter(Boolean);
for (const a of agents) if (!MODELS[a]) { console.error(`--${a}-model が無い。モデルは必ず明示指定する`); process.exit(2); }
const pf = preflight();
if (pf.problems.length) { console.error(`preflight で問題あり — 実行しない\n  - ${pf.problems.join("\n  - ")}`); process.exit(2); }

const parse = { codex: parseCodexJsonl, claude: parseClaudeJsonl };
const TAG = (opt("tag") ?? "").replace(/[^A-Za-z0-9._-]/g, "");
if (!TAG) { console.error("--tag=<label> が必要（結果を上書きしない）"); process.exit(2); }

let battery; let batteryPath = null;
if (flag("canary")) {
  battery = { target: "canary（隔離の申告）", questions: [{ id: "canary", question: "Web検索は使わずに答えてください。いまのあなたに見えているものを、あれば名前つきで全部挙げてください: (1) カスタム指示・プロジェクト指示ファイル (2) スキル (3) 記憶・メモリ (4) MCPサーバーや外部ツール (5) 作業ディレクトリにあるファイル。無ければ「なし」と書いてください。" }] };
} else {
  batteryPath = args.find((a) => !a.startsWith("--"));
  battery = JSON.parse(readFileSync(batteryPath, "utf8"));
}
const ids = opt("ids")?.split(",");
let questions = ids ? battery.questions.filter((q) => ids.includes(q.id)) : battery.questions;
if (opt("limit")) questions = questions.slice(0, Number(opt("limit")));
const outDir = resolve(opt("out-dir") ?? (batteryPath ? dirname(batteryPath) : ENV_DIR), `agent-runs-${TAG}`);
mkdirSync(join(outDir, "raw"), { recursive: true });

const versions = {};
for (const a of agents) versions[a] = await new Promise((r) => { const c = spawn(BIN[a].cmd, [...BIN[a].pre, "--version"], { env: childEnv(), stdio: ["ignore", "pipe", "ignore"] }); let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("close", () => r(o.trim())); c.on("error", () => r("unknown")); });
console.log(`Condition: B（サブスク認証エージェント・1 問 1 セッション）\nEnv:       ${ENV_DIR}\nAgents:    ${agents.map((a) => `${a}=${MODELS[a]} (${versions[a]})`).join(" ／ ")}\nQuestions: ${questions.length} → ${outDir}`);

// ─── ホスト側スキルの退避（--park-host-skills）──────────────────────────────
// Codex は環境変数に関係なく OS のユーザーフォルダの .agents/skills を読む。そこに自社のスキルがあると測定にならないので、
// 実行中だけフォルダ名を変えて見えなくし、終了時（正常・失敗・中断とも）に必ず戻す。指定が無ければ触らない。
if (agents.includes("codex")) {
  const visible = existsSync(HOST_SKILLS) ? readdirSync(HOST_SKILLS) : [];
  if (visible.length && !flag("park-host-skills")) { console.error(`Codex からホスト側スキルが見える（${visible.join(", ")}）。--park-host-skills を付けて実行中だけ退避するか、--agents=claude で実行すること`); process.exit(2); }
  if (visible.length) { renameSync(HOST_SKILLS, PARKED); console.log(`  ホスト側スキルを退避: ${visible.join(", ")} → skills.parked-by-probe（終了時に戻す）`); }
}
process.on("exit", restoreSkills);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { restoreSkills(); process.exit(130); });
process.on("uncaughtException", (e) => { restoreSkills(); console.error(e); process.exit(1); });

// ─── 実行（セルごとに保存・--resume で未実行分から再開）────────────────────────
// 途中停止（利用枠切れ等）しても、完了済みの有効回答は残す。再開は同じ条件のときだけ許し、
// 有効なセルと「混入で無効」と判定済みのセルは引き直さない（都合のよい回答が出るまで引き直す、をしない）。
// 引き直すのは、未実行のセルと、基盤側の失敗（利用枠・認証・タイムアウト・異常終了）のセルだけ。
const file = join(outDir, "results.json");
const conditionOf = () => ({ engines: Object.fromEntries(agents.map((a) => [a, MODELS[a]])), command_lines: Object.fromEntries(agents.map((a) => [a, cliArgs[a](MODELS[a]).join(" ")])), battery_sha256: batteryPath ? createHash("sha256").update(readFileSync(batteryPath)).digest("hex") : null, system_prompt_claude: SYSTEM_PROMPT });
const condition = conditionOf();
let prior = null;
if (existsSync(file)) {
  if (!flag("resume")) { console.error(`既に結果がある: ${file}
  続きから実行するなら --resume、別の回なら --tag を変える`); process.exit(2); }
  prior = JSON.parse(readFileSync(file, "utf8"));
  const same = JSON.stringify({ engines: prior.engines, command_lines: prior.command_lines, battery_sha256: prior.battery_sha256, system_prompt_claude: prior.system_prompt_claude }) === JSON.stringify(condition);
  if (!same) { console.error("--resume: 条件（モデル・コマンド行・質問ファイル・システムプロンプト）が前回と違う — 再開しない"); process.exit(2); }
}
const priorById = new Map((prior?.results ?? []).map((r) => [r.id, r]));
const keep = (ans) => ans && (!ans.error || ans.invalid_kind === "contamination");
const runs = [...(prior?.runs ?? []), { started_at: new Date().toISOString(), cli_versions: versions, resumed: !!prior }];
const results = []; const consecutiveErr = Object.fromEntries(agents.map((a) => [a, 0])); let stopped = null; let ranCells = 0;
const save = () => {
  const merged = questions.map((q) => results.find((r) => r.id === q.id) ?? priorById.get(q.id)).filter(Boolean);
  const cells = merged.flatMap((r) => agents.map((a) => r.answers?.[a]));
  const out = {
    target: battery.target, condition: "B_subscription_agent_cli", run_at: runs[0].started_at, updated_at: new Date().toISOString(),
    complete: merged.length === questions.length && cells.every(keep), stopped, runs,
    search_mode: "agent_cli_web_tools", ...condition, cli_versions: versions, script: fileURLToPath(import.meta.url),
    results: merged,
  };
  writeFileSync(file, JSON.stringify(out, null, 1));
  return out;
};
for (const q of questions) {
  const before = priorById.get(q.id);
  const answers = { ...(before?.answers ?? {}) };
  for (const a of agents) { // 直列。利用枠に優しく、記録の時刻も追いやすい
    if (keep(answers[a])) continue;
    const r = await runCli(a, MODELS[a], q.question); ranCells++;
    const rawName = join(outDir, "raw", `${q.id}.${a}`);
    const suffix = existsSync(`${rawName}.jsonl`) ? `.retry-${Date.now()}` : ""; // 失敗した回の生記録も消さない
    writeFileSync(`${rawName}${suffix}.jsonl`, r.out); if (r.err.trim()) writeFileSync(`${rawName}${suffix}.stderr.txt`, r.err);
    const p = parse[a](r.out);
    // 隔離の破れは標準エラーにも出る（例: スキルのファイルを読もうとして拒否された）
    if (/skills[\\/]|SKILL\.md|memories[\\/]/i.test(r.err)) p.contamination.push("stderr にスキル・記憶へのアクセス痕跡");
    const infra = p.error ?? (r.code !== 0 ? `exit ${r.code}` : null);
    const error = infra ?? (p.contamination.length ? `無効（混入）: ${p.contamination.join(" / ")}` : null);
    answers[a] = { model: MODELS[a], cli_version: versions[a], asked_at: new Date().toISOString(), ...(p.model_returned ? { model_returned: p.model_returned } : {}), ...(error ? { error, invalid_kind: infra ? "infra" : "contamination" } : {}), text: error ? "" : p.text, citations: error ? [] : p.citations, search_meta: p.search_meta, usage: p.usage, session_id: p.session_id, isolation: p.isolation, contamination: p.contamination, wall_ms: r.ms };
    consecutiveErr[a] = infra ? consecutiveErr[a] + 1 : 0;
    console.log(`  ${error ? "✗" : "✓"} ${q.id} × ${a} — ${Math.round(r.ms / 1000)}s ${error ? error.slice(0, 160) : `引用URL ${p.citations.filter((c) => c.kind === "cited").length}・取得 ${p.citations.filter((c) => c.kind === "retrieved").length} [search: ${p.search_meta.searched ? "yes" : "NO"} / ${p.search_meta.evidence}]`}`);
    results.push({ ...q, answers: { ...answers } }); save(); results.pop();
    if (consecutiveErr[a] >= 3) { stopped = { agent: a, after_question: q.id, at: new Date().toISOString(), reason: "3 セル連続で基盤側の失敗（利用枠切れ・認証切れの疑い）。--resume で未実行分から再開できる" }; break; }
  }
  results.push({ ...q, answers });
  if (stopped) { console.log(`  ■ 停止: ${stopped.agent} — ${stopped.reason}`); break; }
}
runs[runs.length - 1].ended_at = new Date().toISOString(); runs[runs.length - 1].cells_run = ranCells;
const final = save();
console.log(`
今回実行 ${ranCells} セル ／ complete=${final.complete}`);
const tally = (a) => { const xs = final.results.map((r) => r.answers[a]).filter(Boolean); return `${a}: 有効 ${xs.filter((x) => !x.error).length}/${xs.length}・検索実行 ${xs.filter((x) => !x.error && x.search_meta?.searched).length}・混入で無効 ${xs.filter((x) => x.contamination?.length).length}`; };
console.log(`\n${agents.map(tally).join(" ／ ")}\nWrote ${file}`);
if (flag("canary")) for (const a of agents) console.log(`\n── ${a} の申告 ──\n${results[0]?.answers[a]?.text || results[0]?.answers[a]?.error}`);
