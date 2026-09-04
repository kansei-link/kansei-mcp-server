#!/usr/bin/env node
/**
 * 無料診断（/site-checker/）の分岐CTA用に、ドメイン→評価済みサービスの対応表を作る。
 *
 * 診断したドメインがDBの評価対象と一致するかで、出す案内が変わる:
 *   一致   = 事業者ルート（そのサービスの格付けへ誘導＋運営者確認の受付案内）
 *   不一致 = 個人・未掲載ルート（学ぶ導線＋掲載リクエスト）
 *
 * 静的JSONにするのはAPI変更なしでGitHub Pagesに載せるため。照合はブラウザ側で行う。
 * ここでの一致は「案内の出し分け」にしか使わない。運営者確認そのものの認可は
 * src/claim/domain-verify.ts の nonce/TXT/PSL/IDN 検証が別途行う（PLAN-Profile-Claim-MVP §4.1）。
 *
 *   node scripts/generate-domain-map.mjs
 */
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '..');
const DB = process.env.KANSEI_DB_PATH ?? resolve(root, '..', 'kansei-link-mcp', 'kansei-link.db');
const OUT = resolve(root, 'public/site-checker/domain-map.json');

// 共有ホスティング・コード置き場。ここで一致させると無関係なサイトを
// 「評価対象です」と誤って案内してしまう。api_url の大半(8,660件)がGitHubなので必須。
const SHARED = new Set([
  'github.com', 'github.io', 'githubusercontent.com', 'gitlab.com', 'bitbucket.org',
  'herokuapp.com', 'vercel.app', 'netlify.app', 'netlify.com', 'railway.app', 'render.com',
  'fly.dev', 'pages.dev', 'workers.dev', 'firebaseapp.com', 'web.app', 'glitch.me',
  'replit.app', 'repl.co', 'readthedocs.io', 'readthedocs.org', 'gitbook.io', 'gitbook.com',
  'notion.site', 'notion.so', 'medium.com', 'wordpress.com', 'blogspot.com', 'hatenablog.com',
  'npmjs.com', 'pypi.org', 'docker.com', 'amazonaws.com', 'azurewebsites.net',
  'googleapis.com', 'googleusercontent.com', 'cloudfunctions.net', 'appspot.com',
  'localhost', 'example.com', 'unknown',
  // 共有MCPホスティング（*.run.mcp.com.ai 等）。個社のドメインではない。
  'com.ai', 'smithery.ai', 'mcp.run', 'modelcontextprotocol.io'
]);

// eTLD+1 判定。完全なPublic Suffix Listは持ち込まず、日本語圏で実際に出る多段TLDだけを扱う。
const MULTI_PART_TLD = new Set([
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'gr.jp', 'ed.jp', 'lg.jp',
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'com.br', 'co.kr', 'com.cn',
  'com.tw', 'co.nz', 'com.sg', 'co.id', 'com.hk', 'co.th', 'com.my', 'co.in'
]);

export function registrableDomain(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith('www.')) host = host.slice(4);
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) return null; // IDN/IPは対象外
  const parts = host.split('.');
  const last2 = parts.slice(-2).join('.');
  const domain = (parts.length >= 3 && MULTI_PART_TLD.has(last2))
    ? parts.slice(-3).join('.')
    : last2;
  if (domain.split('.').some(p => p.length === 0)) return null;
  return domain;
}

const db = new DatabaseSync(DB, { readOnly: true });

// 1サービスにつき複数の出所（api_url / docs_url / base_url）を突き合わせる。
const rows = [
  ...db.prepare("SELECT id AS sid, api_url AS url FROM services WHERE api_url LIKE 'http%'").all(),
  ...db.prepare("SELECT service_id AS sid, docs_url AS url FROM service_api_guides WHERE docs_url LIKE 'http%'").all(),
  ...db.prepare("SELECT service_id AS sid, base_url AS url FROM service_api_guides WHERE base_url LIKE 'http%'").all()
];

const meta = new Map(
  db.prepare('SELECT id, name, category FROM services').all()
    .map(r => [r.id, r])
);

// Award の格付けは DB に入っていない（掲載ページが唯一の正本だった）。
// 抽出済みJSONをサービス名で突き合わせる。名寄せは正規化した完全一致だけ——
// 部分一致にすると「freee会計」と「freee人事労務」を取り違える。
// Award の格付け。公開しているのはA以上だけなので、それ以外は
// 「採点済み」であることだけを持ち、グレードは出さない
const PUBLISHED = new Set(['AAA', 'AA', 'A']);
const awardById = new Map();
{
  const a = JSON.parse(readFileSync(resolve(root, 'data/ari-award-2026-summer.json'), 'utf8'));
  for (const r of a.services) if (PUBLISHED.has(r.grade)) awardById.set(r.service_id, r.grade);
}

const byDomain = new Map();
for (const { sid, url } of rows) {
  const domain = registrableDomain(url);
  if (!domain || SHARED.has(domain)) continue;
  if (!meta.has(sid)) continue;
  if (!byDomain.has(domain)) byDomain.set(domain, new Set());
  byDomain.get(domain).add(sid);
}

const domains = {};
for (const [domain, ids] of [...byDomain.entries()].sort()) {
  domains[domain] = [...ids].sort().map(id => {
    const m = meta.get(id);
    // axr_grade は出さない。419件中291件が一度も採点されていない既定値（50/BB）で、
    // それを格付けとして出していたためAAA認定のサービスがBBと表示されていた
    return {
      id, name: m.name, category: m.category ?? null,
      // 採点済みかどうかは出さない。この対応表は公開ファイルなので、
      // 「採点済みだが格付けが載っていない」= A未満 と逆算されてしまう
      award_grade: awardById.get(id) ?? null
    };
  });
}

const payload = {
  generated_at: new Date().toISOString().slice(0, 10),
  note: '診断ドメインの案内を出し分けるためだけの対応表。運営者確認の認可はサーバー側のドメイン検証が別に行う。',
  domain_count: Object.keys(domains).length,
  service_count: new Set(Object.values(domains).flat().map(s => s.id)).size,
  domains
};

await writeFile(OUT, JSON.stringify(payload), 'utf8');
console.log(`Wrote ${OUT}`);
console.log(`  ${payload.domain_count} domains -> ${payload.service_count} services`);
for (const probe of ['freee.co.jp', 'smarthr.jp', 'sansan.com', 'moneyforward.com']) {
  console.log(`  ${probe}: ${(domains[probe] ?? []).map(s => s.name).join(', ') || '(no match)'}`);
}
