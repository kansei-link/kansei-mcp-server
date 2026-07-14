#!/usr/bin/env node
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
 *     "questions": [{ "id": "listed", "lang": "ja", "question": "...", "official_fact": "...", "risk_note": "..." }] }
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
import Anthropic from "@anthropic-ai/sdk";

const MAX_ANSWER_TOKENS = 1024;

// ─── Engine adapters ───────────────────────────────────────────────

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
      return res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
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
      return data.choices?.[0]?.message?.content ?? "";
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
      return (
        data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ?? ""
      );
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
      return data.choices?.[0]?.message?.content ?? "";
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
        const text = await eng.ask(q.question, model);
        answers[name] = { model, text };
        console.log(`  ✓ ${q.id} × ${name}`);
      } catch (err) {
        answers[name] = { model, error: String(err.message ?? err) };
        console.log(`  ✗ ${q.id} × ${name}: ${err.message}`);
      }
    })
  );
  results.push({ ...q, answers });
}

// ─── Write outputs ─────────────────────────────────────────────────

const base = batteryPath.replace(/\.json$/i, "");
const out = {
  target: battery.target,
  run_at: new Date().toISOString(),
  engines: Object.fromEntries(active.map((n) => [n, ENGINES[n].model()])),
  skipped_engines: skipped,
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
for (const r of results) {
  md.push(`## ${r.id}: ${r.question}`, ``);
  if (r.official_fact) md.push(`**公式情報:** ${r.official_fact}`, ``);
  if (r.risk_note) md.push(`**リスク観点:** ${r.risk_note}`, ``);
  for (const name of active) {
    const a = r.answers[name];
    md.push(`### ${name} (${a.model})`, ``);
    md.push(a.error ? `> ERROR: ${a.error}` : a.text.trim(), ``);
  }
  md.push(`---`, ``);
}
writeFileSync(`${base}-results.md`, md.join("\n"));

console.log(`\nWrote ${base}-results.json and ${base}-results.md`);
