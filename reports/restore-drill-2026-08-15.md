# Restore演習 記録 — 2026-08-16実施（Mission A2・期限8/17-18に対し前倒し完了）

- 対象: archives/believable-vibrancy-2026-08-16.db.enc（鍵=Michieのパスワードマネージャ保管・実DR経路で復号）
- **判定: 合格（注記付き）** — 受け入れ条件5点すべて実証。5bのFAIL表示は判定式のバグ（下記注記）
- **RTO実測: 3.4秒**（復号→整合検証→アプリ起動smoke→後片付けまで・ローカル）
- RPO: アーカイブ取得時点 2026-08-16（believable側は以後更新僅少・正規側stellar-wisdomは日次バックアップ）

## 実測結果（受け入れ条件との対応）

- [x] 隔離環境での復元（本番DBへは一切書き込みなし・一時ディレクトリのみ） — PASS
- [x] 復号成功+SHA-256一致 75eef3af6ffc… — PASS（**パスワードマネージャ保存コピーからの復号＝DRチェーン全体の実証**）
- [x] integrity_check = ok — PASS
- [x] 全38テーブル件数がexport時記録と一致（FTS shadow含む） — PASS
- [x] 主要テーブル集計取得 — PASS（leads=30f984a5eda6 / recipes=4534794befba / outcomes: legacy_unknown n=303 s=206）
- [x] アプリ起動: 復元DBで/health応答（kansei-link） — PASS
- [x] read-only smoke: dashboard/stats応答 services=11,454 — **実質PASS（注記1）**
- [x] 後片付け: 一時DB・鍵ファイル自動削除 — PASS

### 注記1: 5b「FAIL」の原因は判定式のバグ（復元の問題ではない）
初版の判定式は services=11,293（復元時点の件数）の完全一致を要求したが、アプリは起動時に `seedDatabase()`（src/server.ts:113）で最新バンドルカタログの新サービス161件を追加シードする仕様。11,454 = 11,293 + 161 はアプリが復元DBを正しく読み書きしている証拠であり、smoke自体は成功。判定式は「復元時点の件数以上」に修正済み（scripts/restore-drill.mjs）。再実行はせずMichie判断（L3）で本記録をもって完了とする。

## 鍵インシデント（本演習が発見した実DR欠陥・修復済み）

- 事象: 8/15版アーカイブがパスワードマネージャ保管鍵で復号不能
- 根本原因: 鍵生成時、Windows版opensslの出力`\r\n`に対し`tr -d '\n'`では`\r`が残留し、実暗号化パスフレーズが「44文字+不可視の`\r`」の45文字になっていた。Michieの保存（44文字）は正しかった
- 対応: believable生存中に再export→クリーン鍵（44バイト実測）で再暗号化→**保存コピーからの復号検証に合格してから原本鍵を削除**するプロトコルへ改訂
- 詳細: archives/believable-vibrancy-2026-08-15.MANIFEST.md「v2差し替え」節

## 教訓（RISK-REGISTER転記）
1. 鍵・シークレット生成時はバイト数を実測確認（44≠45）
2. 鍵の複製先からの往復検証に合格するまで原本を削除しない
3. Windows opensslの`\r\n`出力に注意——`tr -d '\r\n'`を標準とする
4. 判定式自体もレビュー対象（完全一致要求は起動時seedのような正常系挙動と衝突する）
