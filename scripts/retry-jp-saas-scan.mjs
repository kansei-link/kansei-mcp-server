#!/usr/bin/env node
/**
 * 一括スキャンで失敗したドメインを www. 付きで再試行する。
 *
 * 初回の失敗42件を調べたところ、大半は「サイトがAIに読めない」のではなく
 * 対象リストがapexドメインを使っていたことによるもの（kuronekoyamato.co.jp は
 * DNSが引けず、実体は www.kuronekoyamato.co.jp）。
 * 除外したまま集計すると、こちらのリスト品質の問題を市場の傾向として
 * 公表してしまうので、先に潰す。
 *
 *   node scripts/retry-jp-saas-scan.mjs --scan data/discoverability/jp-saas-scan-<日付>.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const API = 'https://kansei-link-mcp-production-b054.up.railway.app/api/site-check';
const SPACING_MS = 13_000;

const i = process.argv.indexOf('--scan');
const scanPath = i > -1 ? process.argv[i + 1] : 'data/discoverability/jp-saas-scan-2026-09-03.json';
const full = resolve(root, scanPath);
const scan = JSON.parse(await readFile(full, 'utf8'));
const failed = scan.results.filter(r => !r.ok);
console.log(`再試行対象: ${failed.length}件`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fixed = 0;

for (const [n, rec] of failed.entries()) {
  const url = `https://www.${rec.domain}`;
  try {
    const res = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (res.ok) {
      const d = await res.json();
      Object.assign(rec, {
        ok: true, retried_with_www: true, final_url: d.final_url,
        score: d.score, grade: d.grade,
        findings: Object.fromEntries(d.findings.map(f => [f.id, { severity: f.severity, points: f.points, max: f.max }]))
      });
      delete rec.error;
      fixed++;
      console.log(`[${n + 1}/${failed.length}] www.${rec.domain} ${d.score} ${d.grade}`);
    } else {
      const body = await res.json().catch(() => ({}));
      rec.error = `${rec.error} / www: ${body.code ?? `HTTP ${res.status}`}`;
      console.log(`[${n + 1}/${failed.length}] www.${rec.domain} なお失敗 (${body.code ?? res.status})`);
    }
  } catch (e) {
    rec.error = `${rec.error} / www: ${String(e.message ?? e).slice(0, 60)}`;
    console.log(`[${n + 1}/${failed.length}] www.${rec.domain} 例外`);
  }
  if (n < failed.length - 1) await sleep(SPACING_MS);
}

scan.retry_note = `初回失敗${failed.length}件を www. 付きで再試行し、${fixed}件が成功。残りは集計から除外。`;
await writeFile(full, JSON.stringify(scan, null, 1), 'utf8');
console.log(`\n回収 ${fixed} / ${failed.length}`);
console.log(`成功合計 ${scan.results.filter(r => r.ok).length} / ${scan.total}`);
