# 双子統合 Step4-5: 選択移行 実行記録（2026-08-16）

- 方向: believable-vibrancy → canonical (stellar-wisdom / kansei-link-mcp-production.up.railway.app)
- バッチ: `mig-believable-20260816-01` / スクリプト: `scripts/migrate-believable-20260816.cjs`（コンテナ内実行・NODE_PATH=/app/node_modules）
- 事前バックアップ: `/data/backups/pre-migration-2026-08-16.db`（15,716,352 bytes・VACUUM INTO）
- 手順: PIIスキャン → dry-run（トランザクションrollback） → apply → idempotency再実行 → provenance隔離検証 → Stripe照合

## 結果（挿入1,233行・重複スキップ207・エラー0）

| テーブル | source | inserted | 備考 |
|---|---|---|---|
| ranking_leads | 51 | 51 | id保持。同意証跡=archives/consent-evidence-ranking-leads.md |
| subscriptions | 1 | 1 | **Stripe照合合格**: stripe=active / db=active / cancel_at_period_end=false / period_end=2026-09-12 |
| agent_feedback | 422 | 422 | PIIスキャン済（40hexはコミット/コンテンツハッシュ・シークレットなし） |
| outcomes | 303 | 303 | 全行provenance=legacy_unknown |
| model_service_stats | 213 | 213 | 複合キー(service_id\|model_name\|task_type)で台帳管理 |
| inspections / site_checks / infrastructure_tips / execution_attempts / service_events | 14/12/5/20/171 | 全件 | canonical側空でクリーン挿入 |
| agent_voice_responses | 228 | **21** | **内容ベース重複判定**（シード207件は環境ごとにタイムスタンプが異なるため、service_id×agent_type×question_id×choice×本文hashで判定）→オーガニック21件のみ移行 |

対象外（シード管理・移行不要）: services / recipes / service_changelog / service_api_guides

## 統制

- 全行に `source_system='believable-vibrancy'` / `migrated_at` / `migration_batch_id` タグ付与（ALTER TABLE ADD COLUMN）
- `migration_log` テーブル（UNIQUE(source_system, table_name, source_key)）で行単位監査。inserted=1,233 / skipped_duplicate=207
- **Idempotency実証**: apply再実行で全テーブルinserted=0
- **Provenance隔離検証**: publishable_outcomes / publishable_service_stats / publishable_service_rollup / publishable_model_service_stats = **すべて0件**（legacy_unknownは公開集計に一切混入せず・A-3再発防止条件充足）
- 事後: integrity_check=ok・/health正常・一時ファイルは両コンテナ+ローカルで削除済み

## Step6（参照棚卸）への引き継ぎ事項

1. **🔴 Stripe配線はbelievableのみ**: STRIPE系env 5本がbelievable側にだけ存在し、canonicalには無い。webhook宛先・Checkout成功URLの付け替えが**believable廃止のブロッカー**（付け替えまでsubscriptions更新イベントはbelievableに届き続ける）
2. believableドメイン(-b054)への参照残存確認（README/記事/フォーム/GH Actions/cron）
3. model_service_stats のprovenance再集計（P1-2・公開ビュー0件のまま運用に支障なし）
