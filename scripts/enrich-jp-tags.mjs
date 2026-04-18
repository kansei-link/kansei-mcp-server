// Enrich Japanese tags for services that fall out of search_services
// for native Japanese queries. Derived from inspection findings 13/14/15/18/20/21
// where multiple services had confirmed "search_miss" anomalies caused by
// missing Japanese synonyms in their tags field.
//
// Principle: add common JP query terms agents actually use, without touching
// the existing English tags (we need both audiences).

import Database from 'better-sqlite3';
const db = new Database('./kansei-link.db');

// Service ID → JP tags to ADD (merged with existing via comma-join, dedupe)
const ENRICHMENTS = {
  // ── Cases tracked in the inspection queue ──────────────────────────
  zapier: '連携,統合,自動化,ワークフロー,iPaaS,データ連携,API統合',
  talentio: '採用管理,採用システム,ATS,応募者管理,採用,候補者,スカウト',
  'salesforce-jp': 'CRM,顧客管理,問い合わせ管理,ケース管理,自動起票,パイプライン',
  zendesk: 'サポート,問い合わせ管理,サポートチケット,カスタマーサポート,FAQ,ヘルプデスク',
  'hubspot-jp': 'CRM,マーケティング,リード管理,顧客管理,営業支援',

  // ── Preemptive additions (likely hit soon) ─────────────────────────
  asana: 'タスク管理,プロジェクト管理,チーム管理,業務管理,Todo',
  notion: 'ドキュメント管理,ナレッジベース,Wiki,メモ,データベース',
  github: 'バージョン管理,リポジトリ,コード管理,開発ツール,CI/CD',
  jira: 'プロジェクト管理,課題管理,バグ管理,スクラム,アジャイル',
  'google-drive': 'ストレージ,ファイル管理,ドキュメント共有,クラウドストレージ',
  dropbox: 'ストレージ,ファイル共有,バックアップ,クラウドストレージ',
  stripe: '決済,支払い,サブスク,課金,決済処理,クレジットカード',
  'stripe-global': '決済,支払い,サブスク,課金,決済処理,クレジットカード',

  // ── Japanese-native services missing their own JP keywords ─────────
  sansan: '名刺管理,名刺,営業支援,顧客管理,人脈管理',
  cloudsign: '電子契約,電子署名,契約書,契約管理,ハンコ',
  'freee-sign': '電子契約,電子署名,契約書,契約管理',
  freshdesk: 'サポート,問い合わせ管理,ヘルプデスク,カスタマーサポート',
  kintone: '業務アプリ,データベース,ワークフロー,社内システム,サイボウズ',
  chatwork: 'ビジネスチャット,社内チャット,チーム連携,コミュニケーション',
  slack: 'ビジネスチャット,チームコミュニケーション,チャット',
};

function mergeTags(existing, additions) {
  const set = new Set();
  for (const t of (existing || '').split(',').map((s) => s.trim()).filter(Boolean)) set.add(t);
  for (const t of additions.split(',').map((s) => s.trim()).filter(Boolean)) set.add(t);
  return [...set].join(',');
}

const select = db.prepare('SELECT id, tags FROM services WHERE id = ?');
const update = db.prepare('UPDATE services SET tags = ? WHERE id = ?');

console.log('Enriching JP tags...\n');
let updated = 0, notFound = 0, unchanged = 0;
for (const [id, additions] of Object.entries(ENRICHMENTS)) {
  const row = select.get(id);
  if (!row) {
    console.log(`  ⚠️  ${id}: service not found in DB`);
    notFound++;
    continue;
  }
  const merged = mergeTags(row.tags, additions);
  if (merged === row.tags) {
    console.log(`  =  ${id}: no new tags to add`);
    unchanged++;
    continue;
  }
  update.run(merged, id);
  const newCount = merged.split(',').length;
  const oldCount = (row.tags || '').split(',').filter(Boolean).length;
  console.log(`  ✅ ${id}: ${oldCount} → ${newCount} tags`);
  updated++;
}

console.log();
console.log(`Summary: ${updated} updated, ${unchanged} unchanged, ${notFound} not found`);

// ── Rebuild FTS5 index so the enriched tags become searchable ──────────
console.log('\nRebuilding FTS5 index...');
try {
  db.exec("INSERT INTO services_fts(services_fts) VALUES('rebuild')");
  console.log('  ✅ FTS5 rebuild complete');
} catch (e) {
  console.log('  ⚠️  FTS5 rebuild skipped:', e.message);
}

db.close();
