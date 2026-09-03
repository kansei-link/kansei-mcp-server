#!/usr/bin/env node
/**
 * 日本のSaaS 181ドメインへ、公開されている無料診断と同じAPIで一括スキャンする。
 *
 * 公開APIを使うのは意図的。誰でも同じツールで同じ数字を再現できる状態にしておくため
 * （内部関数を直接叩くと、公開されている診断と挙動が同じである保証がなくなる）。
 * 公開エンドポイントのレート制限は5回/分なので、それに合わせて13秒間隔で回す。
 *
 *   node scripts/scan-jp-saas-sample.mjs [--limit N]
 *
 * 出力: data/discoverability/jp-saas-scan-<日付>.json（研究データ＝非公開）
 * 集計と記事化は scripts/generate-jp-saas-stats.mjs が行う。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const API = 'https://kansei-link-mcp-production-b054.up.railway.app/api/site-check';
const SPACING_MS = 13_000; // 公開の制限は5回/分。余裕を持たせる
const DATE = new Date().toISOString().slice(0, 10);

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const tArg = process.argv.indexOf('--targets');
const TARGETS = tArg > -1 ? process.argv[tArg + 1] : 'targets.json';
const oArg = process.argv.indexOf('--out');
const OUT_NAME = oArg > -1 ? process.argv[oArg + 1] : `jp-saas-scan-${DATE}`;
const targets = JSON.parse(await readFile(resolve(root, TARGETS), 'utf8')).slice(0, LIMIT);
const out = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const [i, t] of targets.entries()) {
  const url = `https://${t.domain}`;
  let rec = { domain: t.domain, category: t.category, ok: false };
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (res.ok) {
      const d = await res.json();
      rec = {
        domain: t.domain,
        category: t.category,
        ok: true,
        final_url: d.final_url,
        score: d.score,
        grade: d.grade,
        // findingのidと合否だけ残す。ラベル文言は集計に使わない（表現が変わっても集計が壊れないように）
        findings: Object.fromEntries(d.findings.map(f => [f.id, { severity: f.severity, points: f.points, max: f.max }]))
      };
    } else {
      rec.error = `HTTP ${res.status}`;
    }
  } catch (e) {
    rec.error = String(e.message ?? e).slice(0, 120);
  }
  out.push(rec);
  console.log(`[${i + 1}/${targets.length}] ${t.domain} ${rec.ok ? `${rec.score} ${rec.grade}` : `FAIL ${rec.error}`}`);
  if (i < targets.length - 1) await sleep(SPACING_MS);
}

const dir = resolve(root, 'data/discoverability');
await mkdir(dir, { recursive: true });
const path = resolve(dir, `${OUT_NAME}.json`);
await writeFile(path, JSON.stringify({ scanned_at: DATE, api: API, total: out.length, results: out }, null, 1), 'utf8');
console.log(`\nWrote ${path}`);
console.log(`  成功 ${out.filter(r => r.ok).length} / ${out.length}`);
