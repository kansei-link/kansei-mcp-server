// reindex-clean-pages.mjs — 2026-07-02 誠実性ゲート通過ページのnoindex解除
// 対象: %数値主張がゼロ(=グレードのみ+免責バナー)のページ、および
//       実名×成功率の記述を本日修正済みのページ。
// ハブ(index.html)は実名×数値のカード文言が多数残るため解除せず
// noindex,follow へ変更(クリーン記事へのクロールパスだけ開通)。
// 冪等・可逆。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');

// index,follow へ戻すページ（誠実性ゲート通過済み）
const REINDEX = [
  // triageで%主張ゼロ
  'insights/data-integration-saas-aeo-2026.html',
  'insights/notion-mcp-deep-dive-2026.html',
  'insights/reservation-saas-aeo-2026.html',
  'insights/talent-management-saas-aeo-2026.html',
  'en/insights/data-integration-saas-aeo-2026.html',
  'en/insights/notion-mcp-deep-dive-2026.html',
  'en/insights/reservation-saas-aeo-2026.html',
  'en/insights/talent-management-saas-aeo-2026.html',
  // 良性のみ(自己報告と明記/コード内コメント/URLエンコード誤検知/対応率=事実)
  'insights/design-saas-aeo-2026.html',
  'insights/github-mcp-deep-dive-2026.html',
  'insights/groupware-saas-aeo-2026.html',
  'insights/kintone-mcp-deep-dive-2026.html',
  'en/insights/design-saas-aeo-2026.html',
  'en/insights/github-mcp-deep-dive-2026.html',
  'en/insights/groupware-saas-aeo-2026.html',
  'en/insights/kintone-mcp-deep-dive-2026.html',
  // 2026-07-02 実名×成功率を修正済み
  'insights/logistics-saas-aeo-2026.html',
  'insights/linear-mcp-deep-dive-2026.html',
  'insights/stripe-mcp-deep-dive-2026.html',
  'insights/aeo-ranking-q2-2026.html',
  'en/insights/logistics-saas-aeo-2026.html',
  'en/insights/linear-mcp-deep-dive-2026.html',
  'en/insights/stripe-mcp-deep-dive-2026.html',
];

// noindex,follow へ（本文は非表示のままリンクだけ辿らせる）
const FOLLOW_ONLY = [
  'insights/index.html',
  'en/insights/index.html',
];

const NOINDEX_RE = /<meta\s+name=(["'])robots\1\s+content=(["'])noindex[^"']*\2\s*\/?>/i;
const report = { reindexed: [], follow_only: [], skipped: [] };

for (const rel of REINDEX) {
  const p = join(pub, rel);
  const html = readFileSync(p, 'utf8');
  if (!NOINDEX_RE.test(html)) { report.skipped.push(rel); continue; }
  writeFileSync(p, html.replace(NOINDEX_RE, '<meta name="robots" content="index, follow">'));
  report.reindexed.push(rel);
}

for (const rel of FOLLOW_ONLY) {
  const p = join(pub, rel);
  const html = readFileSync(p, 'utf8');
  if (!NOINDEX_RE.test(html)) { report.skipped.push(rel); continue; }
  writeFileSync(p, html.replace(NOINDEX_RE, '<meta name="robots" content="noindex, follow">'));
  report.follow_only.push(rel);
}

console.log(JSON.stringify(report, null, 2));
