// patch-service-jsonld-rating.mjs — 2026-07-02 Phase 0 #3
// services/*/index.html の JSON-LD から aggregateRating を除去し、
// 単一 critic Review (author=KanseiLink) に置換する。
// 理由: ratingCount に total_agent_calls(probe/seed込み)を入れており、
// ユーザーレビュー数の偽装 = Google構造化データポリシー違反リスク。
// ジェネレータ(generate-pseo-pages.mjs)は同日修正済み。冪等。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const servicesDir = resolve(__dirname, '..', 'public', 'services');

const AGG_RE = /"aggregateRating":\{"@type":"AggregateRating","ratingValue":"([\d.]+)","bestRating":"1\.00","worstRating":"0\.00","ratingCount":\d+\}/;

const reviewJson = (score) =>
  `"review":{"@type":"Review","author":{"@type":"Organization","name":"KanseiLink","url":"https://kansei-link.com"},` +
  `"reviewRating":{"@type":"Rating","ratingValue":"${score}","bestRating":"1.00","worstRating":"0.00"},` +
  `"reviewBody":"AEO (Agent Engine Optimization) readiness rating by KanseiLink, based on published methodology: MCP availability, API quality, documentation, and auth-guide clarity."}`;

const report = { patched: [], no_match: [] };

for (const slug of readdirSync(servicesDir)) {
  const p = join(servicesDir, slug, 'index.html');
  if (!existsSync(p)) continue;
  const html = readFileSync(p, 'utf8');
  const m = html.match(AGG_RE);
  if (!m) { report.no_match.push(slug); continue; }
  writeFileSync(p, html.replace(AGG_RE, reviewJson(m[1])));
  report.patched.push(slug);
}

console.log(JSON.stringify({ patched: report.patched.length, no_match: report.no_match }, null, 2));
