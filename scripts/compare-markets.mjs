#!/usr/bin/env node
/**
 * 市場間比較。カテゴリ構成の違いが差として出てしまうのを避ける。
 *
 * 素朴に全体率を並べると「日本 vs グローバル」ではなく
 * 「業務SaaSの構成比の違い」を見てしまう。日本側は会計・人事が厚く、
 * グローバル側はマーケが厚い、というだけで差が出る。
 *
 * そこで2つ出す:
 *   1. カテゴリ別の率（両市場とも MIN_N 以上あるカテゴリのみ）
 *   2. カテゴリ率の単純平均（構成比の影響を外した値）
 * 全体率も参考として出すが、結論には使わない。
 *
 *   node scripts/compare-markets.mjs --jp <scan> --global <scan>[,<scan2>]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const MIN_N = 5; // これ未満のカテゴリは偶然の幅が大きすぎるので比較に使わない

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};

async function loadScans(paths) {
  const rows = [];
  for (const p of paths.split(',')) {
    const d = JSON.parse(await readFile(resolve(root, p.trim()), 'utf8'));
    rows.push(...d.results.filter(r => r.ok));
  }
  // 同一ドメインが複数ファイルに出たら1回だけ数える
  const seen = new Set();
  return rows.filter(r => (seen.has(r.domain) ? false : (seen.add(r.domain), true)));
}

const jp = await loadScans(arg('--jp', 'data/discoverability/jp-saas-scan-2026-09-03.json'));
const gl = await loadScans(arg('--global', 'data/discoverability/global-saas-scan-2026-09-03.json'));

// 日本側は日本語カテゴリ名、グローバル側はDBのカテゴリID。突き合わせる。
const CATEGORY_MAP = {
  '会計・経理・請求書': 'accounting',
  '人事・労務・勤怠・給与': 'hr',
  'CRM・SFA・営業支援': 'crm',
  '決済・POS・フィンテック': 'payment',
  'カスタマーサポート・CS': 'support',
  'プロジェクト管理・業務効率化': 'project_management',
  'マーケティング・MA・広告': 'marketing',
  'EC・コマース': 'ecommerce',
  '契約・リーガル': 'legal',
  'コミュニケーション・グループウェア': 'communication',
  'セキュリティ・ID管理': 'security',
  'BI・データ分析': 'bi_analytics',
  '経費精算・ワークフロー': 'expense_workflow',
  '物流・配送': 'logistics',
  '医療・ヘルスケア': 'healthcare',
  '教育・LMS': 'education',
  '予約・店舗管理': 'reservation',
  '建設・不動産': 'real_estate'
};
const LABEL = {
  accounting: '会計・請求', hr: '人事・勤怠', crm: 'CRM・営業', payment: '決済',
  support: 'カスタマーサポート', project_management: 'プロジェクト管理',
  marketing: 'マーケティング', ecommerce: 'EC', legal: '契約・リーガル',
  communication: 'コミュニケーション', security: 'セキュリティ', bi_analytics: 'BI・分析',
  expense_workflow: '経費・ワークフロー', logistics: '物流', healthcare: '医療',
  education: '教育', reservation: '予約', real_estate: '不動産',
  productivity: '生産性', design: 'デザイン', storage: 'ストレージ', groupware: 'グループウェア'
};
const norm = r => CATEGORY_MAP[r.category] ?? r.category;

const CHECKS = [
  ['ai_crawlers', 'AIクローラー拒否'],
  ['jsonld', '構造化データなし'],
  ['contact_info', '連絡先が機械可読でない'],
  ['sitemap', 'sitemapなし'],
  ['llms_txt', 'llms.txtなし']
];
const isFail = (r, id) => {
  const f = r.findings?.[id];
  return f && f.max > 0 && f.points === 0;
};

const group = rows => {
  const m = new Map();
  for (const r of rows) {
    const k = norm(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};
const gJp = group(jp), gGl = group(gl);
const shared = [...gJp.keys()].filter(k => gGl.has(k) && gJp.get(k).length >= MIN_N && gGl.get(k).length >= MIN_N);

const pct = (rows, id) => rows.length ? (rows.filter(r => isFail(r, id)).length / rows.length) * 100 : null;
const f1 = v => v === null ? '—' : `${v.toFixed(1)}%`;

console.log(`日本 n=${jp.length} ／ グローバル n=${gl.length}`);
console.log(`両市場で ${MIN_N}件以上あるカテゴリ: ${shared.length}（${shared.map(k => LABEL[k] ?? k).join('、')}）`);
console.log(`\n※ 結論にはカテゴリ別と、その単純平均を使う。全体率は構成比の影響を受けるため参考値。\n`);

for (const [id, label] of CHECKS) {
  console.log(`■ ${label}`);
  console.log(`  ${'カテゴリ'.padEnd(20)} ${'日本'.padStart(14)} ${'グローバル'.padStart(14)}`);
  const jpRates = [], glRates = [];
  for (const k of shared) {
    const a = pct(gJp.get(k), id), b = pct(gGl.get(k), id);
    jpRates.push(a); glRates.push(b);
    console.log(`  ${(LABEL[k] ?? k).padEnd(20)} ${(f1(a) + ` (n=${gJp.get(k).length})`).padStart(14)} ${(f1(b) + ` (n=${gGl.get(k).length})`).padStart(14)}`);
  }
  const avg = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  const aj = avg(jpRates), ag = avg(glRates);
  console.log(`  ${'カテゴリ率の平均'.padEnd(20)} ${f1(aj).padStart(14)} ${f1(ag).padStart(14)}   差 ${(ag - aj >= 0 ? '+' : '')}${(ag - aj).toFixed(1)}pt`);
  console.log(`  ${'（参考）全体率'.padEnd(20)} ${f1(pct(jp, id)).padStart(14)} ${f1(pct(gl, id)).padStart(14)}\n`);
}

const med = rows => {
  const s = rows.map(r => r.score).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
console.log(`スコア中央値: 日本 ${med(jp)} ／ グローバル ${med(gl)}`);
