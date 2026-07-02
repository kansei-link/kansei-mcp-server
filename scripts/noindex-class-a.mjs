// noindex-class-a.mjs — 2026-06-18 止血(stop-the-bleeding)
// クラスA = データ層(total_calls:0)から切り離されたジェネレータが生成した
// 実名サービス×AEOグレード/成功率の比較主張ページ。実データgate実装まで再インデックス禁止。
// 冪等。可逆(来週の正直化でこれらは書き換えるため、戻すのは robots を index,follow に戻すだけ)。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// JA正本 + EN ミラー(public/en/insights) の両方を止血する
const insightsDirs = [
  resolve(__dirname, '..', 'public', 'insights'),
  resolve(__dirname, '..', 'public', 'en', 'insights'),
];

const robotsRe = /<meta\s+name=(["'])robots\1\s+content=(["'])[^"']*\2\s*\/?>/i;
const NEW = '<meta name="robots" content="noindex, nofollow">';

const report = { changed: [], already_noindex: [], inserted: [], no_anchor: [] };
let total_targets = 0;

for (const insightsDir of insightsDirs) {
  let all;
  try {
    all = readdirSync(insightsDir);
  } catch {
    continue; // ディレクトリが無ければスキップ
  }
  const categoryAeo = all.filter((f) => /-saas-aeo-2026\.html$/.test(f));
  const deepDive = all.filter((f) => /deep-dive-2026\.html$/.test(f));
  const extras = [
    'aeo-ranking-q2-2026.html',
    'aeo-readiness-by-industry-2026.html',
    'mcp-verified-vs-connectable-2026.html',
    'index.html',
  ].filter((f) => all.includes(f));

  const targets = [...new Set([...categoryAeo, ...deepDive, ...extras])].sort();
  total_targets += targets.length;

  for (const f of targets) {
    const tag = insightsDir.replace(/\\/g, '/').includes('/en/insights') ? 'en/' : '';
    const id = `${tag}${f}`;
    const p = join(insightsDir, f);
    let html = readFileSync(p, 'utf8');
    if (/name=["']robots["']\s+content=["']noindex/i.test(html)) {
      report.already_noindex.push(id);
      continue;
    }
    if (robotsRe.test(html)) {
      writeFileSync(p, html.replace(robotsRe, NEW));
      report.changed.push(id);
    } else if (/<meta\s+charset[^>]*>/i.test(html)) {
      writeFileSync(p, html.replace(/(<meta\s+charset[^>]*>)/i, `$1\n  ${NEW}`));
      report.inserted.push(id);
    } else {
      report.no_anchor.push(id);
    }
  }
}

console.log(
  JSON.stringify(
    {
      total_targets,
      counts: {
        changed: report.changed.length,
        inserted: report.inserted.length,
        already_noindex: report.already_noindex.length,
        no_anchor: report.no_anchor.length,
      },
      ...report,
    },
    null,
    2,
  ),
);
