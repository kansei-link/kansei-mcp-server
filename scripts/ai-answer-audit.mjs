#!/usr/bin/env node
/**
 * 実行正本は `kansei-ops-runtime`（OPS-RUNTIME-MANIFEST.md の固定commit）。
 * このファイルはその写しで、内容を同一に保つ。分岐させないこと。
 *
 * アドホックにバッテリーを回すときも worktree 側から起動する:
 *   cd kansei-ops-runtime
 *   node --env-file=../kansei-link-mcp/.env scripts/ai-answer-audit.mjs <battery.json> --engines ...
 *
 * 2026-09-07: main側が引用取得を持たない旧版のまま残っており、そちらを走らせて
 * 「引用が取れない＝計測装置に穴がある」と誤診した。マニフェストには同じ事故が
 * 2026-09-03の例として記録されていた。写しを正本と揃えて罠を消す。
 */
/**
 * AI Answer Audit — multi-engine question battery runner
 *
 * Asks the same consumer-style questions to multiple AI engines and collects
 * the raw answers side-by-side, for the 規制産業向け AEO・AI回答監査レポート
 * (see reports/ and DECISIONS.md 2026-07-06).
 *
 * Usage:
 *   node scripts/ai-answer-audit.mjs <battery.json> [--engines anthropic,openai,gemini,perplexity] [--limit N]
 *
 * Battery file format:
 *   { "target": "久光製薬 / Salonpas",
 *     "brand_patterns": ["kansei-?link"],   // optional — self-scores the run
 *     "questions": [{ "id": "listed", "lang": "ja", "question": "...", "official_fact": "...", "risk_note": "..." }] }
 *
 * Web-searching engines (perplexity, grounded gemini) also return the sources
 * they used; those are captured per answer and aggregated into a ranking of the
 * domains occupying each answer.
 *
 * Engines run only when their API key is present in the environment:
 *   ANTHROPIC_API_KEY  (model: ANTHROPIC_AUDIT_MODEL, default claude-opus-4-8)
 *   OPENAI_API_KEY     (model: OPENAI_AUDIT_MODEL,    default gpt-5)
 *   GEMINI_API_KEY     (model: GEMINI_AUDIT_MODEL,    default gemini-2.5-flash)
 *   PERPLEXITY_API_KEY (model: PERPLEXITY_AUDIT_MODEL, default sonar)
 *
 * Output: JSON + Markdown matrix next to the battery file
 * (<battery>-results.json / <battery>-results.md).
 *
 * Cost note: a 20-question battery on all 4 engines is well under $1 total.
 * Questions are sent verbatim with no system prompt — the point is to capture
 * the default answer a consumer would get.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

// Reasoning models (gpt-5.x, gemini flash thinking) spend this budget on hidden
// reasoning before emitting text — at 1024 they return an empty answer, which
// reads as "no data" when it is really a truncated measurement.
const MAX_ANSWER_TOKENS = Number(process.env.AUDIT_MAX_TOKENS ?? 4096);

// ─── Engine adapters ───────────────────────────────────────────────

// Engines that search the live web return the sources they used. Capturing them
// is the other half of the measurement: without it a run only tells us we were
// absent, not who occupied the answer instead.
const normCitations = (raw) =>
  (raw ?? [])
    .map((c) =>
      typeof c === "string"
        ? { url: c }
        : { url: c.url ?? c.link ?? c.web?.uri, title: c.title ?? c.web?.title }
    )
    .filter((c) => c.url);

const ENGINES = {
  anthropic: {
    keyEnv: "ANTHROPIC_API_KEY",
    model: () => process.env.ANTHROPIC_AUDIT_MODEL ?? "claude-opus-4-8",
    async ask(question, model) {
      const client = new Anthropic();
      const res = await client.messages.create({
        model,
        max_tokens: MAX_ANSWER_TOKENS,
        messages: [{ role: "user", content: question }],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { text, citations: [] };
    },
  },
  openai: {
    keyEnv: "OPENAI_API_KEY",
    model: () => process.env.OPENAI_AUDIT_MODEL ?? "gpt-5",
    async ask(question, model) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: MAX_ANSWER_TOKENS,
          messages: [{ role: "user", content: question }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      return { text: data.choices?.[0]?.message?.content ?? "", citations: [] };
    },
  },
  gemini: {
    keyEnv: "GEMINI_API_KEY",
    model: () => process.env.GEMINI_AUDIT_MODEL ?? "gemini-2.5-flash",
    async ask(question, model) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: question }] }],
            generationConfig: { maxOutputTokens: MAX_ANSWER_TOKENS },
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      const cand = data.candidates?.[0];
      return {
        text: cand?.content?.parts?.map((p) => p.text).join("\n") ?? "",
        // Only populated when the request is grounded; ungrounded runs return [].
        citations: normCitations(cand?.groundingMetadata?.groundingChunks),
      };
    },
  },
  perplexity: {
    keyEnv: "PERPLEXITY_API_KEY",
    model: () => process.env.PERPLEXITY_AUDIT_MODEL ?? "sonar",
    async ask(question, model) {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_ANSWER_TOKENS,
          messages: [{ role: "user", content: question }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        // search_results is the current field; citations is the legacy one.
        citations: normCitations(data.search_results ?? data.citations),
      };
    },
  },
};

// ─── CLI ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const batteryPath = args.find((a) => !a.startsWith("--"));
if (!batteryPath) {
  console.error("Usage: node scripts/ai-answer-audit.mjs <battery.json> [--engines a,b] [--limit N]");
  process.exit(1);
}
const engineArg = args.find((a) => a.startsWith("--engines"));
const requested = engineArg
  ? engineArg.split("=")[1]?.split(",") ?? args[args.indexOf(engineArg) + 1]?.split(",") ?? []
  : Object.keys(ENGINES);
const limitArg = args.find((a) => a.startsWith("--limit"));
const limit = limitArg
  ? parseInt(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1], 10)
  : Infinity;

const battery = JSON.parse(readFileSync(batteryPath, "utf8"));
const questions = battery.questions.slice(0, limit);

const active = [];
const skipped = [];
for (const name of requested) {
  const eng = ENGINES[name];
  if (!eng) {
    console.error(`Unknown engine: ${name}`);
    continue;
  }
  if (process.env[eng.keyEnv]) active.push(name);
  else skipped.push(`${name} (${eng.keyEnv} not set)`);
}

// 2026-09-09: どのコピーが走っているかを毎回名乗る。同名スクリプトが複数の worktree にあり、
// 引用元を保存しない旧版を走らせて「引用が取れない」と誤診した事故が2回起きている
// （2026-08-26 supply battery・2026-09-03 需要側監査）。OPS-RUNTIME-MANIFEST の回帰記録参照。
console.log(`Script:   ${fileURLToPath(import.meta.url)}`);
console.log(`Citations: yes（引用元を保存する版）`);
console.log(`Target:   ${battery.target}`);
console.log(`Battery:  ${questions.length} questions`);
console.log(`Engines:  ${active.join(", ") || "(none)"}`);
if (skipped.length) console.log(`Skipped:  ${skipped.join(", ")}`);
if (active.length === 0) {
  console.error("No engine keys available — nothing to do.");
  process.exit(1);
}

// ─── Run ───────────────────────────────────────────────────────────

const results = [];
for (const q of questions) {
  const answers = {};
  await Promise.all(
    active.map(async (name) => {
      const eng = ENGINES[name];
      const model = eng.model();
      try {
        const { text, citations } = await eng.ask(q.question, model);
        answers[name] = { model, text, citations };
        const src = citations.length ? ` — ${citations.length} sources` : "";
        console.log(`  ✓ ${q.id} × ${name}${src}`);
      } catch (err) {
        answers[name] = { model, error: String(err.message ?? err) };
        console.log(`  ✗ ${q.id} × ${name}: ${err.message}`);
      }
    })
  );
  results.push({ ...q, answers });
}

// ─── Brand scoring ─────────────────────────────────────────────────

// A battery may declare brand_patterns (regex strings) to self-score. Answer
// hits and source hits are counted separately: being named in the prose and
// being one of the sources the engine actually retrieved are different wins,
// and the second is the one that predicts the first.
const brandRe = battery.brand_patterns?.length
  ? new RegExp(battery.brand_patterns.join("|"), "gi")
  : null;

const brandSummary = brandRe
  ? (() => {
      const per = {};
      let measured = 0;
      for (const r of results) {
        for (const name of active) {
          const a = r.answers[name];
          if (a.error) continue;
          measured++;
          per[name] ??= { answered: 0, answer_hits: 0, source_hits: 0, hit_ids: [] };
          per[name].answered++;
          if (brandRe.test(a.text ?? "")) {
            per[name].answer_hits++;
            per[name].hit_ids.push(r.id);
          }
          brandRe.lastIndex = 0;
          if ((a.citations ?? []).some((c) => brandRe.test(c.url))) {
            per[name].source_hits++;
          }
          brandRe.lastIndex = 0;
        }
      }
      const answer_hits = Object.values(per).reduce((s, p) => s + p.answer_hits, 0);
      const source_hits = Object.values(per).reduce((s, p) => s + p.source_hits, 0);
      return { patterns: battery.brand_patterns, measured, answer_hits, source_hits, per_engine: per };
    })()
  : null;

// Who occupied the answers instead — ranked by how many answers cited them.
const domainCounts = {};
for (const r of results) {
  for (const name of active) {
    for (const c of r.answers[name].citations ?? []) {
      try {
        const d = new URL(c.url).hostname.replace(/^www\./, "");
        domainCounts[d] = (domainCounts[d] ?? 0) + 1;
      } catch {}
    }
  }
}
const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);

// ─── Write outputs ─────────────────────────────────────────────────

const base = batteryPath.replace(/\.json$/i, "");
const out = {
  target: battery.target,
  run_at: new Date().toISOString(),
  engines: Object.fromEntries(active.map((n) => [n, ENGINES[n].model()])),
  skipped_engines: skipped,
  brand_summary: brandSummary,
  top_cited_domains: Object.fromEntries(topDomains),
  results,
};
writeFileSync(`${base}-results.json`, JSON.stringify(out, null, 2));

const md = [
  `# AI回答監査 — ${battery.target}`,
  ``,
  `実行日時: ${out.run_at} ／ エンジン: ${active.map((n) => `${n} (${out.engines[n]})`).join(", ")}`,
  skipped.length ? `未実行: ${skipped.join(", ")}` : ``,
  ``,
];
if (brandSummary) {
  md.push(
    `## ブランド引用サマリ`,
    ``,
    `判定パターン: \`${brandSummary.patterns.join(" | ")}\``,
    ``,
    `| エンジン | 測定 | 本文で言及 | 出典に採用 |`,
    `|---|---:|---:|---:|`,
    ...active.map((n) => {
      const p = brandSummary.per_engine[n];
      if (!p) return `| ${n} | 0 | — | — |`;
      return `| ${n} | ${p.answered} | ${p.answer_hits} | ${p.source_hits} |`;
    }),
    `| **合計** | **${brandSummary.measured}** | **${brandSummary.answer_hits}** | **${brandSummary.source_hits}** |`,
    ``
  );
}
if (topDomains.length) {
  md.push(
    `## 出典を占有しているドメイン（上位20）`,
    ``,
    ...topDomains.slice(0, 20).map(([d, n], i) => `${i + 1}. \`${d}\` — ${n}回`),
    ``
  );
}
md.push(`---`, ``);

for (const r of results) {
  md.push(`## ${r.id}: ${r.question}`, ``);
  if (r.official_fact) md.push(`**公式情報:** ${r.official_fact}`, ``);
  if (r.risk_note) md.push(`**リスク観点:** ${r.risk_note}`, ``);
  for (const name of active) {
    const a = r.answers[name];
    md.push(`### ${name} (${a.model})`, ``);
    md.push(a.error ? `> ERROR: ${a.error}` : a.text.trim(), ``);
    if (a.citations?.length) {
      md.push(`**出典 (${a.citations.length}):**`, ``);
      a.citations.forEach((c, i) =>
        md.push(`${i + 1}. ${c.title ? `${c.title} — ` : ""}${c.url}`)
      );
      md.push(``);
    }
  }
  md.push(`---`, ``);
}
writeFileSync(`${base}-results.md`, md.join("\n"));

if (brandSummary) {
  console.log(
    `\nBrand: ${brandSummary.answer_hits}/${brandSummary.measured} answers mention, ` +
      `${brandSummary.source_hits}/${brandSummary.measured} cite us as a source`
  );
}
if (topDomains.length) {
  console.log(`Top cited: ${topDomains.slice(0, 5).map(([d, n]) => `${d}(${n})`).join(", ")}`);
}
console.log(`\nWrote ${base}-results.json and ${base}-results.md`);

// ---- 計器の健全性チェック（2026-09-09・週次プローブから移設して常時化） ----
// perplexity が答えているのに引用元が1件も無い＝引用元を保存しない旧版が走っている疑い。
// ガードは weekly-citation-probe.mjs 側だけにあり、アドホック実行は無防備だった。
// 結果ファイルは証拠として残す。落とすのは「使ってよい」という判定の方。
if (active.includes("perplexity")) {
  const answered = results.filter((q) => q.answers?.perplexity && !q.answers.perplexity.error).length;
  const cited = results.reduce(
    (n, q) => n + ((q.answers?.perplexity?.citations || q.answers?.perplexity?.sources || []).length), 0);
  if (answered > 0 && cited === 0) {
    console.error(
      `\nFATAL: perplexity が ${answered} 問に答えているのに引用元が0件です。` +
      `\n  引用元を保存しない旧版が走っている疑い（実行正本は kansei-ops-runtime・OPS-RUNTIME-MANIFEST.md）。` +
      `\n  この結果を判定・記事・trend系列に使わないこと。結果ファイルは証拠として残しています。`);
    process.exit(2);
  }
}
