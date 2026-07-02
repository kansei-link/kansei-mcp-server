#!/usr/bin/env node
/**
 * One-off remediation (audit 2026-06-16): inject a readiness/accuracy
 * disclaimer banner into every published insights HTML page.
 *
 * The published pages pair NAMED vendors with success-rate numbers that are
 * partly seed/eval/probe-derived (see src/utils/reliability-source.ts). The
 * banner reframes every number as a disclosed-methodology readiness heuristic,
 * NOT an asserted fact about a vendor's real-world performance, and invites
 * corrections — the standard mitigation for defamation / 信用毀損 exposure.
 *
 * Idempotent: re-running skips already-banner'd files.
 * After running, DEPLOY public/ for it to take effect on kansei-link.com.
 *
 *   node scripts/inject-insights-disclaimer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MARKER = 'kl-disclaimer-banner';

const STYLE =
  'background:#fff8e1;border-bottom:2px solid #f0c000;padding:12px 16px;' +
  'font-size:14px;line-height:1.6;color:#5a4a00;text-align:center;';

const BANNER_JA =
  `<div data-kl="${MARKER}" style="${STYLE}">⚠️ <strong>本レポートの数値の読み方</strong>：` +
  `AEOスコア・グレード・成功率は、接続方式の判定とKanseiLink内部の評価・初期データに基づく` +
  `<strong>「エージェント対応度の指標」</strong>であり、各サービスの実運用での性能・信頼性を測定・断定するものではありません。` +
  `数値には初期シード／自動評価由来のものが含まれます。最新は各サービス公式をご確認ください。` +
  `事実誤認のご指摘は <a href="mailto:contact@synapsearrows.com">contact@synapsearrows.com</a> へ。</div>`;

const BANNER_EN =
  `<div data-kl="${MARKER}" style="${STYLE}">⚠️ <strong>How to read these numbers</strong>: ` +
  `AEO scores, grades and success rates are a <strong>readiness heuristic</strong> derived from connection ` +
  `method and KanseiLink's internal eval/seed data — not a measurement or assertion of any vendor's real-world ` +
  `performance or reliability. Figures may include seed/auto-eval data. Please verify against each vendor's ` +
  `official sources. Report any inaccuracy to <a href="mailto:contact@synapsearrows.com">contact@synapsearrows.com</a>.</div>`;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && p.toLowerCase().endsWith('.html')) out.push(p);
  }
  return out;
}

const targets = [
  { dir: path.join(ROOT, 'public', 'en', 'insights'), banner: BANNER_EN },
  { dir: path.join(ROOT, 'public', 'insights'), banner: BANNER_JA },
].filter((t) => fs.existsSync(t.dir));

let touched = 0;
let skipped = 0;
const done = new Set();
for (const { dir, banner } of targets) {
  for (const file of walk(dir)) {
    if (done.has(file)) continue;
    done.add(file);
    let html = fs.readFileSync(file, 'utf8');
    if (html.includes(MARKER)) { skipped++; continue; }
    const m = html.match(/<body[^>]*>/i);
    if (!m) { skipped++; continue; }
    html = html.replace(m[0], m[0] + '\n' + banner);
    fs.writeFileSync(file, html, 'utf8');
    touched++;
  }
}
console.log(`disclaimer banner: injected into ${touched} file(s), skipped ${skipped} (already-banner'd or no <body>).`);
