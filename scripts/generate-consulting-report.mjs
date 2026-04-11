#!/usr/bin/env node
/**
 * KanseiLink Consulting Report Generator — v2 (Two-Tier Scoring Model)
 *
 * Reads the most recent dogfood run JSONL and produces a publishable
 * "Agent-Readiness Landscape Report" that honestly distinguishes
 * vendor responsibility from KanseiLink's own coverage work.
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │ Three independent dimensions — never conflated:                │
 * │                                                                 │
 * │  1. VARS (Vendor Agent-Readiness Score, 0-5)                   │
 * │     Public vendor grade. Computed ONLY for services that       │
 * │     have passed the investigation floor. Missing data is       │
 * │     never counted against the vendor.                          │
 * │                                                                 │
 * │  2. KIC (KanseiLink Integration Coverage, 0-1)                 │
 * │     Our internal moat: do we have an api-guide, a recipe,      │
 * │     tips, and a working search path for this service?          │
 * │     Gaps here are KanseiLink's TODO list, NOT vendor failings. │
 * │                                                                 │
 * │  3. IP  (Investigation Progress, 0-1)                          │
 * │     Transparency metric: how thoroughly we've investigated     │
 * │     the service. Drives the "re-grade needed" queue.           │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   node scripts/generate-consulting-report.mjs              # latest run
 *   node scripts/generate-consulting-report.mjs --run=<id>   # specific run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT, 'content', 'dogfood-runs');
const REPORTS_DIR = path.join(ROOT, 'content', 'reports');
const DATA_DIR = path.join(ROOT, 'src', 'data');

// ────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────
function parseArgs() {
  const args = { run: null };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--run=')) args.run = a.slice(6);
  }
  return args;
}

function findLatestRun() {
  if (!fs.existsSync(RUNS_DIR)) {
    throw new Error(`No dogfood runs directory: ${RUNS_DIR}`);
  }
  const runs = fs
    .readdirSync(RUNS_DIR)
    .filter((d) => fs.statSync(path.join(RUNS_DIR, d)).isDirectory())
    .sort();
  if (runs.length === 0) throw new Error('No dogfood runs found');
  return runs[runs.length - 1];
}

function loadRun(runId) {
  const dir = path.join(RUNS_DIR, runId);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'run-meta.json'), 'utf8'));
  const jsonl = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8');
  const results = jsonl
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  return { runId, dir, meta, results };
}

function loadServices() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'services-seed.json'), 'utf8'));
}

// ────────────────────────────────────────────────────────────
// Analysis — two-tier model
// ────────────────────────────────────────────────────────────
function analyze(results, services) {
  const svcById = new Map(services.map((s) => [s.id, s]));
  const total = results.length;

  // Investigation status
  const investigated = results.filter((r) => r.investigation_status === 'investigated');
  const partiallyInvestigated = results.filter(
    (r) => r.investigation_status === 'partially_investigated'
  );
  const pending = results.filter((r) => r.investigation_status === 'pending');

  // Vendor dimension (only meaningful for investigated services)
  const vendorPass = investigated.filter((r) => r.vendor_pass === true);
  const vendorFail = investigated.filter((r) => r.vendor_pass === false);

  // KanseiLink coverage dimension
  const kicComplete = results.filter((r) => r.kansei_coverage_pass);

  // Average VARS (only for investigated)
  const vars = investigated.map((r) => r.vars_score).filter((v) => v != null);
  const avgVars = vars.length > 0 ? vars.reduce((a, b) => a + b, 0) / vars.length : 0;

  // Average KIC and IP across all services
  const kics = results.map((r) => r.kic_score || 0);
  const ips = results.map((r) => r.ip_score || 0);
  const avgKic = kics.reduce((a, b) => a + b, 0) / Math.max(1, kics.length);
  const avgIp = ips.reduce((a, b) => a + b, 0) / Math.max(1, ips.length);

  // By tier
  const byTier = {};
  for (const r of results) {
    const t = r.mcp_status || 'unknown';
    byTier[t] = byTier[t] || {
      total: 0,
      investigated: 0,
      vendor_pass: 0,
      vendor_fail: 0,
      kic_complete: 0,
      sum_vars: 0,
      count_vars: 0,
      sum_kic: 0,
    };
    const bt = byTier[t];
    bt.total++;
    if (r.investigation_status === 'investigated') {
      bt.investigated++;
      if (r.vendor_pass === true) bt.vendor_pass++;
      if (r.vendor_pass === false) bt.vendor_fail++;
      if (r.vars_score != null) {
        bt.sum_vars += r.vars_score;
        bt.count_vars++;
      }
    }
    if (r.kansei_coverage_pass) bt.kic_complete++;
    bt.sum_kic += r.kic_score || 0;
  }
  for (const bt of Object.values(byTier)) {
    bt.avg_vars = bt.count_vars > 0 ? bt.sum_vars / bt.count_vars : null;
    bt.avg_kic = bt.total > 0 ? bt.sum_kic / bt.total : 0;
    bt.vendor_pass_rate = bt.investigated > 0 ? bt.vendor_pass / bt.investigated : 0;
    bt.kic_pass_rate = bt.total > 0 ? bt.kic_complete / bt.total : 0;
  }

  // By category
  const byCategory = {};
  for (const r of results) {
    const c = r.category || 'uncategorized';
    byCategory[c] = byCategory[c] || {
      total: 0,
      investigated: 0,
      vendor_pass: 0,
      vendor_fail: 0,
      kic_complete: 0,
      sum_vars: 0,
      count_vars: 0,
      sum_kic: 0,
    };
    const bc = byCategory[c];
    bc.total++;
    if (r.investigation_status === 'investigated') {
      bc.investigated++;
      if (r.vendor_pass === true) bc.vendor_pass++;
      if (r.vendor_pass === false) bc.vendor_fail++;
      if (r.vars_score != null) {
        bc.sum_vars += r.vars_score;
        bc.count_vars++;
      }
    }
    if (r.kansei_coverage_pass) bc.kic_complete++;
    bc.sum_kic += r.kic_score || 0;
  }
  for (const bc of Object.values(byCategory)) {
    bc.avg_vars = bc.count_vars > 0 ? bc.sum_vars / bc.count_vars : null;
    bc.avg_kic = bc.total > 0 ? bc.sum_kic / bc.total : 0;
    bc.vendor_pass_rate = bc.investigated > 0 ? bc.vendor_pass / bc.investigated : 0;
    bc.kic_pass_rate = bc.total > 0 ? bc.kic_complete / bc.total : 0;
  }

  // KanseiLink gap frequency (our TODO list)
  const kanseiGapFreq = {};
  for (const r of results) {
    for (const g of r.kansei_gaps || []) {
      kanseiGapFreq[g] = (kanseiGapFreq[g] || 0) + 1;
    }
  }

  // Vendor gap frequency (real vendor issues, only after investigation)
  const vendorGapFreq = {};
  for (const r of investigated) {
    for (const g of r.vendor_gaps || []) {
      vendorGapFreq[g] = (vendorGapFreq[g] || 0) + 1;
    }
  }

  // Top VARS (best vendors, investigated only)
  const topVendors = investigated
    .filter((r) => r.vars_score != null)
    .sort((a, b) => (b.vars_score || 0) - (a.vars_score || 0))
    .slice(0, 20);

  // Best vendor by category (highest VARS)
  const bestByCategory = {};
  for (const r of investigated) {
    if (r.vars_score == null) continue;
    const c = r.category || 'uncategorized';
    if (!bestByCategory[c] || (r.vars_score || 0) > (bestByCategory[c].vars_score || 0)) {
      bestByCategory[c] = r;
    }
  }

  // Category leaderboard — ranked by avg VARS (investigated only)
  const categoryVarsLeaderboard = Object.entries(byCategory)
    .filter(([, v]) => v.investigated >= 3)
    .sort((a, b) => (b[1].avg_vars || 0) - (a[1].avg_vars || 0));

  // Category KIC leaderboard — where KanseiLink has the most debt
  const categoryKicLeaderboard = Object.entries(byCategory)
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => (a[1].kic_pass_rate || 0) - (b[1].kic_pass_rate || 0));

  // KanseiLink TODO queue: vendor good, coverage incomplete
  const kanseiTodo = results
    .filter((r) => r.vendor_pass !== false && !r.kansei_coverage_pass)
    .sort((a, b) => (b.kansei_gaps || []).length - (a.kansei_gaps || []).length);

  // Real vendor issues (if any)
  const realVendorIssues = vendorFail.sort(
    (a, b) => (b.vendor_gaps || []).length - (a.vendor_gaps || []).length
  );

  return {
    total,
    investigated_count: investigated.length,
    partially_investigated_count: partiallyInvestigated.length,
    pending_count: pending.length,
    vendor_pass_count: vendorPass.length,
    vendor_fail_count: vendorFail.length,
    kic_complete_count: kicComplete.length,
    investigation_rate: total > 0 ? investigated.length / total : 0,
    vendor_pass_rate: investigated.length > 0 ? vendorPass.length / investigated.length : 0,
    kic_complete_rate: total > 0 ? kicComplete.length / total : 0,
    avgVars,
    avgKic,
    avgIp,
    byTier,
    byCategory,
    kanseiGapFreq,
    vendorGapFreq,
    topVendors,
    bestByCategory,
    categoryVarsLeaderboard,
    categoryKicLeaderboard,
    kanseiTodo,
    realVendorIssues,
    partiallyInvestigated,
    pending,
  };
}

// ────────────────────────────────────────────────────────────
// Markdown rendering
// ────────────────────────────────────────────────────────────
function pct(n) {
  return `${Math.round((n || 0) * 100)}%`;
}

function gradeVars(score) {
  if (score == null) return '—';
  if (score >= 4.5) return 'A+';
  if (score >= 4.0) return 'A';
  if (score >= 3.5) return 'B';
  if (score >= 3.0) return 'C';
  if (score >= 2.5) return 'D';
  return 'F';
}

function renderMarkdown(runId, meta, analysis, services) {
  const svcById = new Map(services.map((s) => [s.id, s]));
  const today = new Date().toISOString().slice(0, 10);
  const a = analysis;

  const lines = [];
  lines.push(`# Agent-Readiness Landscape Report 2026 Q2`);
  lines.push(`## エージェント親和性ランドスケープレポート — 二層評価モデル版`);
  lines.push('');
  lines.push(`**発行:** KanseiLink / Synapse Arrows PTE. LTD.`);
  lines.push(`**公開日:** ${today}`);
  lines.push(`**著者:** KanseiLink編集部`);
  lines.push(`**タグ:** Landscape Report, AEO, MCP, Agent Economy, Two-Tier Scoring`);
  lines.push(`**ランID:** \`${runId}\``);
  lines.push(`**対象サービス数:** ${a.total}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Editorial note: why this report is different ───
  lines.push('## 編集部からのお知らせ — 評価手法の刷新について');
  lines.push('');
  lines.push(
    '本レポートは、前回版とは **評価手法を根本から刷新** しました。以前のレポートでは、個別MCPベンダーの品質スコアに KanseiLink 側のデータ未整備（レシピ不足、API ガイド未整備など）が混入しており、結果として一部の優良ベンダーが不当に低評価を受けていました。'
  );
  lines.push('');
  lines.push(
    '今回から、評価は **3つの独立した次元** に分解されます。各次元は責任の所在が明確に異なり、相互に影響しません。'
  );
  lines.push('');
  lines.push('| 次元 | 略称 | 意味 | 責任の所在 |');
  lines.push('|------|------|------|----------|');
  lines.push('| Vendor Agent-Readiness Score | **VARS** | 個別ベンダーのエージェント親和性（0-5点） | **ベンダー** |');
  lines.push('| KanseiLink Integration Coverage | **KIC** | KanseiLink のレシピ・API ガイド・検索統合度（0-1） | **KanseiLink** |');
  lines.push('| Investigation Progress | **IP** | 調査完了度（透明性指標） | **KanseiLink** |');
  lines.push('');
  lines.push(
    '**重要な原則**: VARS は調査完了（`investigated`）済みのサービスにのみ付与されます。調査未完了のベンダーを不当にマイナス評価することはありません。KIC のギャップは KanseiLink 自身の TODO リストであり、ベンダー側の責任を問うものではありません。'
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── TL;DR ───
  lines.push('## TL;DR');
  lines.push('');
  lines.push(
    `- **対象 ${a.total} サービス中 ${a.investigated_count} (${pct(a.investigation_rate)}) が調査完了済み** — 残りはデータ収集中`
  );
  lines.push(
    `- **調査完了サービスの VARS 合格率: ${a.vendor_pass_count}/${a.investigated_count} (${pct(a.vendor_pass_rate)})** — 調査が済んだベンダーは、ほぼ全てがエージェント親和性の基礎水準を満たしています`
  );
  lines.push(
    `- **KanseiLink Integration Coverage 完備率: ${a.kic_complete_count}/${a.total} (${pct(a.kic_complete_rate)})** — これは **私たち（KanseiLink）自身の TODO** です。レシピ、API ガイド、Agent Tips の拡充余地がまだ大きい`
  );
  lines.push(`- **平均 VARS: ${a.avgVars.toFixed(2)}/5.0** / **平均 KIC: ${a.avgKic.toFixed(2)}/1.0** / **平均 IP: ${a.avgIp.toFixed(2)}/1.0**`);
  const topVarsCat = a.categoryVarsLeaderboard[0];
  if (topVarsCat) {
    lines.push(
      `- 最も成熟しているカテゴリ（平均VARS基準）: **${topVarsCat[0]} (平均 ${topVarsCat[1].avg_vars?.toFixed(2) || '—'})**`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Methodology ───
  lines.push('## 調査方法');
  lines.push('');
  lines.push(
    `KanseiLink は ${a.total} 本のSaaS/MCPサービスを自動化テストバッテリーで評価しました。評価は以下の3ステップで進みます。`
  );
  lines.push('');
  lines.push('### 1. Investigation Floor（調査完了判定）');
  lines.push('');
  lines.push('サービスを公平に評価するには、まず最低限のデータが揃っている必要があります。以下を全て満たしたサービスを `investigated` と判定:');
  lines.push('');
  lines.push('- 30字以上の description');
  lines.push('- API ドキュメント URL（`api_url` または guide の `docs_url`）');
  lines.push('- 認証方式の明示（service または guide いずれか）');
  lines.push('- Official / Third-party MCP の場合のみ: `mcp_endpoint` の存在');
  lines.push('');
  lines.push('**調査未完了のサービスには VARS を付与しません。** これが前回レポートとの最大の違いです。');
  lines.push('');
  lines.push('### 2. Vendor Dimension — VARS の算出');
  lines.push('');
  lines.push('調査完了済みサービスのみに付与される公開グレード。4軸（Docs / Auth / Error Clarity / Rate Limit Transparency）の5段階評価の平均に、vendor_gaps に応じたペナルティを減算します。');
  lines.push('');
  lines.push('### 3. KanseiLink Dimension — KIC の算出');
  lines.push('');
  lines.push('これは KanseiLink 自身の統合カバレッジ指標であり、ベンダーの責任ではありません。以下4軸の平均:');
  lines.push('');
  lines.push('- **api-guide entry** の有無');
  lines.push('- **recipe reference** の有無（少なくとも1本のレシピに登場するか）');
  lines.push('- **Agent Tips** の整備状況');
  lines.push('- **Search discoverability**（意図ベースクエリでの発見性）');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Investigation progress ───
  lines.push('## 調査進捗 (Investigation Progress)');
  lines.push('');
  lines.push('| ステータス | 件数 | 割合 |');
  lines.push('|----------|------|------|');
  lines.push(
    `| investigated | ${a.investigated_count} | ${pct(a.investigated_count / a.total)} |`
  );
  lines.push(
    `| partially_investigated | ${a.partially_investigated_count} | ${pct(a.partially_investigated_count / a.total)} |`
  );
  lines.push(`| pending | ${a.pending_count} | ${pct(a.pending_count / a.total)} |`);
  lines.push('');
  if (a.investigation_rate >= 0.98) {
    lines.push(
      `調査完了率 **${pct(a.investigation_rate)}** — ほぼ全てのサービスが VARS 算出の前提条件を満たしており、本レポートの評価は公平性の高い基盤の上で行われています。`
    );
  } else if (a.investigation_rate >= 0.85) {
    lines.push(
      `調査完了率 **${pct(a.investigation_rate)}** — 大半のサービスについて VARS を付与できていますが、残り約${Math.round((1 - a.investigation_rate) * 100)}%は追加調査が必要です。`
    );
  } else {
    lines.push(
      `調査完了率 **${pct(a.investigation_rate)}** — 調査未完了サービスが多く、本レポートの VARS 分布は現時点のスナップショットとしてご理解ください。`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Vendor dimension: the real story ───
  lines.push('## ベンダー次元 (VARS) — 調査済みサービスの成績');
  lines.push('');
  lines.push('### Tier 別 VARS 合格率');
  lines.push('');
  lines.push('| Tier | 総数 | 調査済 | VARS合格 | 合格率 | 平均VARS |');
  lines.push('|------|------|--------|---------|--------|---------|');
  const tierLabels = {
    official: 'T1 公式MCP',
    third_party: 'T2 サードパーティMCP',
    api_only: 'T3 APIのみ',
    none: 'T4 API未整備',
  };
  for (const [tier, s] of Object.entries(a.byTier).sort((x, y) => y[1].total - x[1].total)) {
    const label = tierLabels[tier] || tier;
    lines.push(
      `| ${label} | ${s.total} | ${s.investigated} | ${s.vendor_pass} | ${pct(s.vendor_pass_rate)} | ${s.avg_vars != null ? s.avg_vars.toFixed(2) : '—'} |`
    );
  }
  lines.push('');
  if (a.vendor_pass_rate >= 0.95) {
    lines.push(
      `**調査済みサービスの ${pct(a.vendor_pass_rate)} が VARS 合格。** これは、私たちが評価対象に選定したサービスは、ほぼ例外なくエージェント親和性の基礎水準を満たしていることを意味します。「ベンダー側にクリティカルな問題は少ない」という事実を、数字として公表できる段階に到達しました。`
    );
  } else {
    lines.push(
      `**調査済みサービスの VARS 合格率は ${pct(a.vendor_pass_rate)}。** 合格できなかったベンダーの具体的な課題は、後述の「真のベンダー課題」セクションをご参照ください。`
    );
  }
  lines.push('');

  // Vendor gap frequency (real issues only)
  lines.push('### 真のベンダー課題 (vendor_gaps)');
  lines.push('');
  if (Object.keys(a.vendorGapFreq).length === 0) {
    lines.push(
      '現時点の調査済みサービスに関して、ベンダー側の構造的な問題は検出されていません。これは私たちが評価対象とするサービスの質を誇るべき一方で、今後の調査拡大に伴って新たなベンダー課題が見つかる可能性も示唆します。'
    );
  } else {
    lines.push('| コード | 発生数 | 意味 |');
    lines.push('|--------|-------|------|');
    const vendorGapMeaning = {
      MCP_ENDPOINT_INVALID: '公式/サードパーティMCP と宣言されているが、mcp_endpoint が未記載または無効',
      VENDOR_AUTH_OPAQUE: '調査後もベンダー側の認証フローが不明瞭',
      VENDOR_API_URL_OPAQUE: '調査後も API ベース URL が特定できない',
      VENDOR_RATE_LIMIT_OPAQUE: 'ガイドは存在するがレートリミットが非公開',
    };
    for (const [code, count] of Object.entries(a.vendorGapFreq).sort((x, y) => y[1] - x[1])) {
      lines.push(`| ${code} | ${count} | ${vendorGapMeaning[code] || '—'} |`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Top vendors by VARS ───
  lines.push('## トップ20ベンダー (VARS 基準)');
  lines.push('');
  lines.push(
    'エージェント親和性の観点で最も洗練されているベンダー。ベンチマークケースとして参照ください。'
  );
  lines.push('');
  lines.push('| 順位 | サービス | カテゴリ | Tier | VARS | KIC | IP | グレード |');
  lines.push('|------|---------|---------|------|------|-----|----|---------|');
  a.topVendors.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.service_name} | ${r.category || '-'} | ${r.mcp_status} | ${r.vars_score?.toFixed(1) ?? '—'} | ${r.kic_score?.toFixed(2) ?? '—'} | ${r.ip_score?.toFixed(2) ?? '—'} | ${gradeVars(r.vars_score)} |`
    );
  });
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Category VARS leaderboard ───
  lines.push('## カテゴリ別ベンダー成熟度 (平均 VARS)');
  lines.push('');
  lines.push('カテゴリ内に調査済みサービスが3本以上存在するもののみランキング。');
  lines.push('');
  lines.push('| 順位 | カテゴリ | 調査済 | 平均VARS | VARS合格率 | カテゴリトップ |');
  lines.push('|------|---------|--------|---------|-----------|---------------|');
  a.categoryVarsLeaderboard.forEach(([cat, s], i) => {
    const best = a.bestByCategory[cat];
    const bestStr = best ? `${best.service_name} (${best.vars_score?.toFixed(1) ?? '—'})` : '—';
    lines.push(
      `| ${i + 1} | ${cat} | ${s.investigated} | ${s.avg_vars != null ? s.avg_vars.toFixed(2) : '—'} | ${pct(s.vendor_pass_rate)} | ${bestStr} |`
    );
  });
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── KanseiLink Dimension ───
  lines.push('## KanseiLink 次元 (KIC) — 私たちの TODO リスト');
  lines.push('');
  lines.push(
    '以下の数字は **KanseiLink 自身のデータ拡充タスク** です。ベンダーの評価とは切り離してお読みください。'
  );
  lines.push('');

  lines.push('### KanseiLink-side ギャップ頻度');
  lines.push('');
  lines.push('| コード | 発生数 | 意味 |');
  lines.push('|--------|-------|------|');
  const kanseiGapMeaning = {
    RECIPE_GAP: 'このサービスを含む実用レシピがまだ存在しない',
    API_GUIDE_MISSING: 'api-guides-seed.json に詳細ガイドが未掲載',
    TIPS_GAP: 'Agent Tips（実装上のハマりどころ）が未整備',
    SEARCH_MISS: 'ランカーが意図クエリに対してサービスを上位に返せない',
  };
  for (const [code, count] of Object.entries(a.kanseiGapFreq).sort((x, y) => y[1] - x[1])) {
    lines.push(`| ${code} | ${count} | ${kanseiGapMeaning[code] || '—'} |`);
  }
  lines.push('');

  lines.push('### カテゴリ別 KIC 完成度（低い = 私たちが着手すべき場所）');
  lines.push('');
  lines.push('| カテゴリ | 総数 | KIC完成 | 完成率 | 平均KIC |');
  lines.push('|---------|------|--------|--------|--------|');
  for (const [cat, s] of a.categoryKicLeaderboard) {
    lines.push(
      `| ${cat} | ${s.total} | ${s.kic_complete} | ${pct(s.kic_pass_rate)} | ${s.avg_kic.toFixed(2)} |`
    );
  }
  lines.push('');

  // KanseiLink TODO — top priorities
  lines.push('### 優先対応サービス (KanseiLink 内部ロードマップ)');
  lines.push('');
  lines.push(
    'ベンダー側は問題なく利用可能（または調査中）だが、KanseiLink のカバレッジが不十分なサービスを優先度順に列挙。'
  );
  lines.push('');
  lines.push('| サービス | カテゴリ | Tier | KanseiLinkギャップ |');
  lines.push('|---------|---------|------|-------------------|');
  for (const r of a.kanseiTodo.slice(0, 20)) {
    lines.push(
      `| ${r.service_name} | ${r.category || '-'} | ${r.mcp_status} | ${(r.kansei_gaps || []).join(', ')} |`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Strategic recommendations ───
  lines.push('## 戦略的提言');
  lines.push('');
  lines.push('### SaaS ベンダー向け');
  lines.push('');
  lines.push(
    '1. **公式 MCP サーバーの提供は差別化要因** — 公式 MCP を持つベンダーは、VARS 評価で T1 として扱われ、エージェント選定の初期段階で最優先候補に入りやすい。'
  );
  lines.push(
    '2. **認証方式の明示とドキュメント整備** — OAuth 2.0 + PKCE の採用、Bearer token スコープの明示、rate limit の公開が 3 大改善ポイント。'
  );
  lines.push(
    '3. **Agent Tips セクションの新設** — 一般的な API リファレンスに加え、「エージェント開発者向け落とし穴・ベストプラクティス」を 1 ページにまとめるだけで、統合コストは劇的に下がります。'
  );
  lines.push(
    '4. **MCP エンドポイントの稼働確認** — 公式 MCP を宣言しているにも関わらず、endpoint URL が未記載または死んでいるケースは、VARS 評価でペナルティの対象です。'
  );
  lines.push('');
  lines.push('### エージェント運用企業向け');
  lines.push('');
  lines.push(
    '1. **VARS 4.0 以上のサービスを優先採用** — 本レポートのトップ20ベンダーは統合コスト最小化の出発点として活用できます。'
  );
  lines.push(
    '2. **カテゴリ平均 VARS を比較軸に** — 同じ業務領域内で複数の選択肢がある場合、カテゴリリーダーボードでベンダーを比較できます。'
  );
  lines.push(
    '3. **KanseiLink MCP の活用** — サービス選定・ワークフロー設計・運用監視を一元化することで、エージェント開発の意思決定をデータドリブンに行えます。'
  );
  lines.push('');
  lines.push('### KanseiLink 内部ロードマップ');
  lines.push('');
  lines.push(
    `本レポートで特定された ${a.kanseiGapFreq.RECIPE_GAP || 0} 件の RECIPE_GAP、${a.kanseiGapFreq.API_GUIDE_MISSING || 0} 件の API_GUIDE_MISSING、${a.kanseiGapFreq.TIPS_GAP || 0} 件の TIPS_GAP は、KanseiLink 内部の優先度順バックログに投入されます。KIC が最も低いカテゴリ（**${a.categoryKicLeaderboard[0]?.[0] || 'N/A'}**）を次スプリントの重点投資先と位置づけます。`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Appendix ───
  lines.push('## 付録: スコアリング詳細');
  lines.push('');
  lines.push('### VARS の算出式 (v2: Vendor-Only 3軸モデル)');
  lines.push('');
  lines.push('```');
  lines.push('VARS = max(0, design_score - 0.5 × |vendor_gaps|)');
  lines.push('');
  lines.push('design_score = average(docs, auth, stability)');
  lines.push('  docs      = 1 + (api_url: +1) + (mcp_endpoint: +2)');
  lines.push('            + (description ≥ 80chars: +1), capped at 5');
  lines.push('  auth      = none:5, oauth2/bearer:4, api_key:3, unknown:1');
  lines.push('              ※ none が最高評価 — エージェントはトークン管理不要が最善');
  lines.push('  stability = round(has_reports');
  lines.push('              ? trust × 2 + success × 3');
  lines.push('              : trust × 5), clamped to [1, 5]');
  lines.push('```');
  lines.push('');
  lines.push('**設計原則**: この3軸は全てベンダー側の公開情報と観測実績のみから計算されます。KanseiLink 側の整備物 (api-guide, recipe, tips) は一切参照しません。これにより VARS は「ベンダー品質の純粋指標」として機能します。');
  lines.push('');
  lines.push('**旧 4軸モデルとの違い**: 旧版は `docs` 軸に `has_guide: +2` を加算し、`rate_limit` 軸全体を `guide.rate_limit` に依存させていたため、VARS の 37.5% が KanseiLink 側の整備状況で汚染されていました。v2 では完全に二層分離されています。');
  lines.push('');
  lines.push('### KIC の算出式');
  lines.push('');
  lines.push('```');
  lines.push('KIC = average(');
  lines.push('  has_api_guide ? 1 : 0,');
  lines.push('  has_recipe    ? 1 : 0,');
  lines.push('  has_tips      ? 1 : 0,');
  lines.push('  search_pass_count / search_total');
  lines.push(')');
  lines.push('```');
  lines.push('');
  lines.push('### IP の算出式');
  lines.push('');
  lines.push('```');
  lines.push('IP = fraction of (description, api_url, auth, mcp_endpoint) that are filled');
  lines.push('     (mcp_endpoint is N/A for api_only tier and counted as satisfied)');
  lines.push('```');
  lines.push('');
  lines.push('### ギャップ分類体系');
  lines.push('');
  lines.push('**Vendor gaps (ベンダー責任、investigated の場合のみ集計)**');
  lines.push('');
  lines.push('- `MCP_ENDPOINT_INVALID` — 公式/サードパーティ宣言に対し endpoint が未記載');
  lines.push('- `VENDOR_AUTH_OPAQUE` — 調査後も認証方式が不明');
  lines.push('- `VENDOR_API_URL_OPAQUE` — 調査後も API ベース URL が不明');
  lines.push('- `VENDOR_RATE_LIMIT_OPAQUE` — ガイドはあるが rate limit 非公開');
  lines.push('');
  lines.push('**KanseiLink gaps (私たち自身の TODO)**');
  lines.push('');
  lines.push('- `API_GUIDE_MISSING` — api-guides-seed に未掲載');
  lines.push('- `RECIPE_GAP` — レシピに含まれていない');
  lines.push('- `TIPS_GAP` — Agent Tips 未整備');
  lines.push('- `SEARCH_MISS` — ランカーがサービスを発見できない');
  lines.push('');
  lines.push('**Investigation gaps (調査未完了)**');
  lines.push('');
  lines.push('- `description_incomplete`');
  lines.push('- `api_url_unverified`');
  lines.push('- `auth_unverified`');
  lines.push('- `mcp_endpoint_unverified`');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ─── Footer ───
  lines.push('## 次回レポートについて');
  lines.push('');
  lines.push(
    `本レポートは KanseiLink dogfood framework v2（二層評価モデル）を使用して生成されました。run id: \`${runId}\`、${a.total} サービス対象、生成日時: ${today}`
  );
  lines.push('');
  lines.push(
    '次回以降のレポートでは、本レポートで可視化された KanseiLink 側 TODO の消化進捗と、新規調査完了サービスの追加を反映します。特定のサービスの再評価、または ベンダー様からの改善反映リクエストは KanseiLink 編集部までお問い合わせください。'
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 関連リンク');
  lines.push('');
  lines.push('- [KanseiLink MCP サーバー](https://github.com/kansei-link/kansei-mcp-server)');
  lines.push('- [AEO方法論の詳細](https://kansei-link.com/methodology)');
  lines.push('- [二層評価モデルの設計ノート](https://kansei-link.com/docs/two-tier-scoring)');
  lines.push('');
  lines.push(
    `*本レポートは KanseiLink 225-Service Dogfood Testing Framework v2 により完全自動生成されました。データ出典: src/data/services-seed.json および src/data/api-guides-seed.json のスナップショット (${today})。*`
  );
  lines.push('');

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs();
  const runId = args.run || findLatestRun();
  console.log(`[consulting-report] using run: ${runId}`);

  const run = loadRun(runId);
  const services = loadServices();
  const analysis = analyze(run.results, services);

  console.log(
    `[consulting-report] ${analysis.investigated_count}/${analysis.total} investigated, ` +
      `${analysis.vendor_pass_count}/${analysis.investigated_count} vendor-pass (${pct(analysis.vendor_pass_rate)}), ` +
      `${analysis.kic_complete_count}/${analysis.total} KIC-complete (${pct(analysis.kic_complete_rate)})`
  );

  const markdown = renderMarkdown(runId, run.meta, analysis, services);

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const filename = 'agent-readiness-landscape-q2-2026.md';
  const outPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outPath, markdown, 'utf8');

  // Also save a data snapshot
  const dataPath = path.join(REPORTS_DIR, 'agent-readiness-landscape-q2-2026-data.json');
  fs.writeFileSync(
    dataPath,
    JSON.stringify({ run_id: runId, meta: run.meta, analysis }, null, 2),
    'utf8'
  );

  console.log(`[consulting-report] wrote ${outPath} (${markdown.length} chars)`);
  console.log(`[consulting-report] wrote ${dataPath}`);
}

main();
