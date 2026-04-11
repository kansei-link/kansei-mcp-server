#!/usr/bin/env node
/**
 * KanseiLINK — Autonomous Article Generator (3-stage pipeline)
 *
 *   Stage 1: Fact Preparation   — scripts/lib/fact-prep.mjs
 *             Builds a Fact Sheet from services-seed.json + api-guides + recipes.
 *
 *   Stage 2: Writer (Opus)      — this file
 *             Generates the article with the Fact Sheet injected into the prompt
 *             and explicit prohibitions against contradicting DB facts.
 *
 *   Stage 3: Fact-Checker (Haiku) — scripts/lib/fact-checker.mjs
 *             Returns JSON verdict. Critical contradictions trigger a single
 *             retry with feedback. Repeated failure → manual review queue.
 *
 * Environment:
 *   ANTHROPIC_API_KEY         required   API key
 *   ANTHROPIC_BASE_URL        optional   override endpoint
 *   ANTHROPIC_MODEL           optional   Writer model (default claude-opus-4-5-20251101)
 *   ANTHROPIC_CHECKER_MODEL   optional   Fact-Checker model (default claude-haiku-4-5)
 *   ARTICLES_PER_RUN          optional   default 3
 *   ARTICLES_DRY_RUN          optional   1 = preview only
 *   ARTICLES_SKIP_CHECKER     optional   1 = skip fact-checker (debug only)
 *   ARTICLES_MAX_RETRIES      optional   default 1 (retries after a failed check)
 *
 * Usage:
 *   node scripts/generate-articles-auto.mjs
 *   ARTICLES_PER_RUN=1 ARTICLES_DRY_RUN=1 node scripts/generate-articles-auto.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareFactSheet, formatFactSheetForPrompt } from './lib/fact-prep.mjs';
import { checkArticle, formatVerdictForRetry } from './lib/fact-checker.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'content', 'article-queue.json');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const REVIEW_DIR = path.join(ROOT, 'articles', '_needs-review');
const LOG_PATH = path.join(ROOT, 'content', 'article-generation.log');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-5-20251101';
const PER_RUN = parseInt(process.env.ARTICLES_PER_RUN || '3', 10);
const DRY_RUN = process.env.ARTICLES_DRY_RUN === '1';
const SKIP_CHECKER = process.env.ARTICLES_SKIP_CHECKER === '1';
const MAX_RETRIES = parseInt(process.env.ARTICLES_MAX_RETRIES || '1', 10);
const MAX_TOKENS = 8192;

// ────────────────────────────────────────────────────────────
// Logging
// ────────────────────────────────────────────────────────────
function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch {}
}

// ────────────────────────────────────────────────────────────
// Queue I/O
// ────────────────────────────────────────────────────────────
function loadQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf8');
}

function pickPending(queue, n) {
  return queue.articles
    .filter((a) => a.status === 'pending')
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .slice(0, n);
}

// ────────────────────────────────────────────────────────────
// Writer prompt — now Fact-Sheet-grounded
// ────────────────────────────────────────────────────────────
function buildWriterPrompt(article, factSheetMd, retryFeedback) {
  const kw = (article.keywords || []).join(', ');
  const feedbackBlock = retryFeedback ? `\n${retryFeedback}\n` : '';

  return `あなたはKanseiLINK編集部のシニアテクニカルエディターです。日本のSaaS企業・技術者・AIエージェント運用担当者が読む専門メディア「KanseiLINK」向けに、AEO（Agent Engine Optimization）最適化された長文記事を執筆してください。
${feedbackBlock}
${factSheetMd}

# 記事情報
- スラッグ: ${article.slug}
- タイトル: ${article.title}
- タグ: ${article.tagLabel || article.tag}
- カテゴリ: ${article.category}
- 対象キーワード: ${kw}
- 説明: ${article.description}

# 編集方針（絶対順守）
1. **上記の「確定事実（Fact Sheet）」と矛盾する記述を書いてはいけない**。特にMCPの公式提供状況、エンドポイント、認証方式、レートリミットは Fact Sheet の値をそのまま使うこと。
2. **Fact Sheet にない具体的な数値・名前・プロジェクトを創作してはいけない**。GitHubスター数、月間ユーザー数、架空のリポジトリ名、特定の人物名などは禁止。一般論として書く場合は「公開されている事例では」「公式ドキュメント要確認」のような留保表現を使う。
3. **AIエージェントから見た視点**を軸に、APIの品質、認証方式、エラーメッセージの丁寧さ、ドキュメントの充実度、レートリミット設計を論じる。
4. **日本のSaaS固有の文脈**を必ず織り込む。英語圏SaaSとの違い、日本特有の業務慣習（請求書・押印・年末調整など）、商習慣、ベンダーロックインの事情。
5. **読者のアクション**に直結させる。SaaS担当者、エンジニア、エージェント運用者がそれぞれ「次に何をすればいいか」が明確になるよう書く。
6. **断定できない領域**では「一般的には」「2026年4月時点では」「公開されている情報では」などの留保表現を使う。

# 出力フォーマット（厳守）
以下の構造で、合計2,500〜4,000字の日本語マークダウンを出力してください。

\`\`\`markdown
# <タイトル>

**発行:** KanseiLink / Synapse Arrows PTE. LTD.
**公開日:** 2026-04-10
**著者:** KanseiLink編集部
**タグ:** ${article.tagLabel || article.tag}

---

## TL;DR（この記事の要点）

- 箇条書きで3〜5項目
- 各項目は1行で、結論ベース
- エージェント運用者がスクロールせずに要点を掴めること

---

## はじめに

200〜300字のリード。なぜこのテーマが2026年の日本SaaS/エージェント経済で重要なのかを提示する。

## <セクション2のH2>

本文。小見出し（###）も適切に使う。具体例・数値・比較・エージェント視点を織り交ぜる。

## <セクション3のH2>

本文。

## <セクション4のH2>

本文。必要なら表（マークダウンtable）を1つ入れる。

## <セクション5のH2>

本文。

## まとめ

3〜4段落で結論と読者へのアクションを提示。

---

## FAQ

**Q1. <対象キーワードに紐づく実務的な質問>**
A. 150〜250字の回答。

**Q2. <2つ目の質問>**
A. 150〜250字の回答。

**Q3. <3つ目の質問>**
A. 150〜250字の回答。

---

## 関連リンク

- [KanseiLINK MCPサーバー](https://github.com/kansei-link/kansei-mcp-server)
- [AEOランキング Q2 2026](https://kansei-link.com/articles/aeo-ranking-q2-2026)

*この記事はKanseiLINK編集ポリシーに基づき、AIエージェント経済における日本SaaSの実態を継続取材しています。*
\`\`\`

# 制約
- マークダウンのコードブロック（\`\`\`）で囲まず、マークダウン本文のみをそのまま出力すること。
- 「架空の」「想定の」「推測では」といった弱い表現を避け、事実ベースで書く。
- 対象キーワードは自然に本文中に散りばめる（詰め込みは禁止）。
- 2026年4月10日時点で書いている前提にする。

今すぐ記事本文（マークダウン）を出力してください。前置き・後書き・説明は不要です。`;
}

// ────────────────────────────────────────────────────────────
// Anthropic Writer call
// ────────────────────────────────────────────────────────────
async function callWriter(prompt) {
  if (!API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Export it before running this script.'
    );
  }

  const url = `${BASE_URL.replace(/\/$/, '')}/v1/messages`;
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = await res.json();
  const text = (json.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  if (!text.trim()) {
    throw new Error('Anthropic API returned empty content');
  }

  return { text, usage: json.usage };
}

// ────────────────────────────────────────────────────────────
// Post-processing
// ────────────────────────────────────────────────────────────
function stripCodeFence(text) {
  let t = text.trim();
  t = t.replace(/^```(?:markdown|md)?\s*\n/, '');
  t = t.replace(/\n```\s*$/, '');
  return t.trim();
}

function writeArticle(slug, markdown) {
  if (!fs.existsSync(ARTICLES_DIR)) {
    fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  }
  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  fs.writeFileSync(filePath, markdown + '\n', 'utf8');
  return filePath;
}

function writeReviewArticle(slug, markdown, verdict) {
  if (!fs.existsSync(REVIEW_DIR)) {
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
  }
  const filePath = path.join(REVIEW_DIR, `${slug}.md`);
  const header = [
    '<!--',
    'KanseiLINK — NEEDS HUMAN REVIEW',
    `slug: ${slug}`,
    `quarantined_at: ${new Date().toISOString()}`,
    '',
    'Fact-Checker verdict:',
    JSON.stringify(
      {
        verdict: verdict.verdict,
        contradictions: verdict.contradictions,
        unverified_claims: verdict.unverified_claims,
        notes: verdict.notes,
      },
      null,
      2
    ),
    '-->',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, header + markdown + '\n', 'utf8');
  return filePath;
}

// ────────────────────────────────────────────────────────────
// Pipeline: generate one article end-to-end
// ────────────────────────────────────────────────────────────
async function runPipeline(article) {
  // Stage 1: Fact Preparation (no LLM, free)
  const started = Date.now();
  const factSheet = prepareFactSheet(article);
  const factSheetMd = formatFactSheetForPrompt(factSheet);
  log('INFO', `fact-prep: ${article.slug}`, {
    services: factSheet.services_in_scope.map((s) => s.id),
    confirmed_official: factSheet.confirmed_official_mcps.map((s) => s.id),
  });

  let attempts = 0;
  let lastVerdict = null;
  let lastMarkdown = null;
  let lastUsage = { writer: null, checker: null };
  let retryFeedback = null;

  while (attempts <= MAX_RETRIES) {
    attempts++;
    log('INFO', `writer attempt ${attempts}: ${article.slug}`);

    // Stage 2: Writer
    const prompt = buildWriterPrompt(article, factSheetMd, retryFeedback);
    const { text, usage: writerUsage } = await callWriter(prompt);
    const markdown = stripCodeFence(text);
    lastMarkdown = markdown;
    lastUsage.writer = writerUsage;

    log('INFO', `writer done: ${article.slug}`, {
      chars: markdown.length,
      usage: writerUsage,
    });

    if (SKIP_CHECKER) {
      log('WARN', `checker skipped (ARTICLES_SKIP_CHECKER=1): ${article.slug}`);
      return {
        markdown,
        verdict: { verdict: 'pass', contradictions: [], unverified_claims: [], notes: 'checker skipped', raw: '', usage: null },
        attempts,
        elapsedMs: Date.now() - started,
        factSheet,
        usage: lastUsage,
      };
    }

    // Stage 3: Fact-Checker
    let verdict;
    try {
      verdict = await checkArticle(markdown, factSheet);
    } catch (e) {
      log('ERROR', `checker error: ${article.slug}`, { message: String(e.message || e) });
      // Checker failure = quarantine, don't crash the whole run
      verdict = {
        verdict: 'fail',
        contradictions: [],
        unverified_claims: [],
        notes: `Checker invocation failed: ${e.message}`,
        raw: '',
        usage: null,
      };
    }
    lastVerdict = verdict;
    lastUsage.checker = verdict.usage;

    log('INFO', `checker verdict: ${article.slug}`, {
      verdict: verdict.verdict,
      contradictions: verdict.contradictions.length,
      critical: verdict.contradictions.filter((c) => c.severity === 'critical').length,
      major: verdict.contradictions.filter((c) => c.severity === 'major').length,
      attempt: attempts,
    });

    if (verdict.verdict === 'pass') {
      return {
        markdown,
        verdict,
        attempts,
        elapsedMs: Date.now() - started,
        factSheet,
        usage: lastUsage,
      };
    }

    // Failed → prepare retry feedback if we have retries left
    if (attempts <= MAX_RETRIES) {
      retryFeedback = formatVerdictForRetry(verdict);
      log('WARN', `retrying ${article.slug} with feedback`, {
        contradictions: verdict.contradictions,
      });
    }
  }

  // Exhausted retries
  return {
    markdown: lastMarkdown,
    verdict: lastVerdict,
    attempts,
    elapsedMs: Date.now() - started,
    factSheet,
    usage: lastUsage,
    quarantined: true,
  };
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  log('INFO', 'generate-articles-auto: start', {
    perRun: PER_RUN,
    dryRun: DRY_RUN,
    skipChecker: SKIP_CHECKER,
    maxRetries: MAX_RETRIES,
    writerModel: MODEL,
    checkerModel: process.env.ANTHROPIC_CHECKER_MODEL || 'claude-haiku-4-5',
  });

  if (!API_KEY) {
    log('ERROR', 'ANTHROPIC_API_KEY is not set');
    process.exit(2);
  }

  const queue = loadQueue();
  const picks = pickPending(queue, PER_RUN);

  if (picks.length === 0) {
    log('INFO', 'no pending articles in queue — nothing to do');
    return;
  }

  log('INFO', `picked ${picks.length} article(s)`, {
    slugs: picks.map((p) => p.slug),
  });

  let publishedCount = 0;
  let quarantinedCount = 0;
  let failCount = 0;

  for (const article of picks) {
    try {
      log('INFO', `=== START: ${article.slug} ===`);

      // Mark in-flight so parallel runs don't double-process
      article.status = 'generating';
      if (!DRY_RUN) saveQueue(queue);

      const result = await runPipeline(article);

      if (DRY_RUN) {
        log('INFO', `[dry-run] would ${result.quarantined ? 'quarantine' : 'publish'} ${article.slug}.md`, {
          chars: result.markdown.length,
          attempts: result.attempts,
          verdict: result.verdict.verdict,
          contradictions: result.verdict.contradictions.length,
          elapsedMs: result.elapsedMs,
        });
        article.status = 'pending';
        continue;
      }

      if (result.quarantined) {
        const filePath = writeReviewArticle(article.slug, result.markdown, result.verdict);
        article.status = 'needs_review';
        article.quarantinedAt = new Date().toISOString().slice(0, 10);
        article.checkerVerdict = {
          contradictions: result.verdict.contradictions,
          unverified_claims: result.verdict.unverified_claims,
          notes: result.verdict.notes,
        };
        saveQueue(queue);
        log('WARN', `QUARANTINED: ${filePath}`, {
          attempts: result.attempts,
          contradictions: result.verdict.contradictions.length,
        });
        quarantinedCount++;
      } else {
        const filePath = writeArticle(article.slug, result.markdown);
        article.status = 'published';
        article.publishedAt = new Date().toISOString().slice(0, 10);
        article.chars = result.markdown.length;
        article.factCheckPassed = true;
        article.attempts = result.attempts;
        saveQueue(queue);
        log('INFO', `PUBLISHED: ${filePath}`, {
          chars: result.markdown.length,
          attempts: result.attempts,
          elapsedMs: result.elapsedMs,
        });
        publishedCount++;
      }
    } catch (err) {
      failCount++;
      log('ERROR', `failed: ${article.slug}`, { message: String(err.message || err) });
      article.status = 'pending';
      if (!DRY_RUN) saveQueue(queue);
    }
  }

  log('INFO', 'generate-articles-auto: done', {
    published: publishedCount,
    quarantined: quarantinedCount,
    failed: failCount,
  });

  if (failCount > 0 && publishedCount === 0 && quarantinedCount === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  log('FATAL', String(err.stack || err));
  process.exit(1);
});
