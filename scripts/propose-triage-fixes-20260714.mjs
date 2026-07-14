#!/usr/bin/env node
// One-shot: register 2026-07-14 discoverability triage results as pending_updates proposals.
// 8 api_url fixes (stale DB URLs, replacement probe-verified 200) + 24 archive proposals
// (GitHub repo gone/private per api.github.com). Review via inspect tool / ops-cycle.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const db = new Database('kansei-link.db');
const AGENT = 'claude-discoverability-triage-20260714';
const ins = db.prepare(`INSERT INTO pending_updates
  (service_id, proposer_agent_id, change_type, field_changes, reason, evidence_url)
  VALUES (?,?,?,?,?,?)`);

// guard: don't double-insert on rerun
const already = db.prepare(`SELECT count(*) n FROM pending_updates WHERE proposer_agent_id=?`).get(AGENT).n;
if (already > 0) { console.log(`already inserted (${already} rows) — aborting`); process.exit(0); }

const URL_FIXES = {
  moneyforward: ['https://developers.biz.moneyforward.com/docs/', '旧api_url(accounting.moneyforward.com/api/v3/)は404。公式開発者サイトはdevelopers.biz.moneyforward.comへ移転(MCP情報も掲載)。なおbiz.moneyforward.com/api/はスキャナーUAに403'],
  elevenlabs: ['https://elevenlabs.io/docs/api-reference/introduction', '旧api_url(api.elevenlabs.io/v1/)はAPIベースでGET 404。公式docsに差し替え'],
  langfuse: ['https://langfuse.com/docs/api-and-data-platform/features/public-api', '旧api_url(cloud.langfuse.com/api/public/)はAPIベースでGET 404。公式docsに差し替え'],
  looker: ['https://cloud.google.com/looker/docs/api-intro', '旧api_url(looker-api参照ページ)は404。現行のAPI introへ差し替え(docs.cloud.google.comへリダイレクト)'],
  firecrawl: ['https://docs.firecrawl.dev/api-reference/introduction', '旧api_url(api.firecrawl.dev/v1/)はAPIベースでGET 404。公式docsに差し替え'],
  hrmos: ['https://ieyasu.co/docs/api.html', '旧api_url(ieyasu.co/docs/api/)は404。現行はapi.html'],
  'freee-sign': ['https://developer.freee.co.jp/', '旧api_url(sign.freee.co.jp/)はルート404。サインAPIはfreee開発者ポータル配下(個別リファレンスパスは要人力確認: /reference/signは404)'],
  paidy: ['https://paidy.com/docs/en/', '旧api_url(paidy.com/docs/)は404。現行は/docs/en/'],
};

const triage = JSON.parse(readFileSync('data/discoverability/triage-2026-07-14.json', 'utf-8'));
const gone = triage.github.filter((g) => g.verdict === 'gone-or-private');

const tx = db.transaction(() => {
  let n = 0;
  for (const [sid, [url, reason]] of Object.entries(URL_FIXES)) {
    ins.run(sid, AGENT, 'update', JSON.stringify({ api_url: url }),
      `${reason}（出所: Discoverabilityスキャン2026-07-14→triage、差し替え先はプローブ実測200確認済）`, url);
    n++;
  }
  for (const g of gone) {
    ins.run(g.service_id, AGENT, 'archive', JSON.stringify({ archived: 1 }),
      `GitHubリポジトリ ${g.repo} がapi.github.comで404（削除または非公開化）。2026-07-06全量スイープと同じ死活セマンティクス（エンドポイント死=archive）。復活確認できれば解除可`,
      `https://api.github.com/repos/${g.repo}`);
    n++;
  }
  return n;
});
console.log(`inserted ${tx()} proposals as ${AGENT}`);
db.close();
