# freee Test Pack

Level 1測定基盤のfreee会計Adapter。最初はR0（read-only）のScripted検証から始め、緑を確認した後だけAgentic実行へ進む。

## 実行ゲート

- `freee_server_info`でtransportとversionを記録する
- `freee_auth_status`が有効であること
- `freee_get_current_company`で事業所を明示する
- `company_id`を推測・ハードコードしない
- R1以上はsandbox／自社テナントと明示的許可が揃うまで実行しない
- API token、refresh token、事業所名、個人データはEvidence Bundleへ平文保存しない

## αタスク

`freee-accounting-t1-account-item-detail.v1.json`は、勘定科目一覧から1件を選び、ID指定で詳細を読み戻すT1 Read連鎖。書き込み・副作用はない。

実行順:

1. Scripted N=1でAPIレールを確認
2. 同一fixtureでAgentic N=3（Pilot診断）
3. 公開根拠に使う場合のみN=5＋成果物アサーション

2026-08-12にScripted N=1を実行し、一覧取得→ID指定の詳細取得→ID・名称照合までPASSした。結果は`evidence/freee/2026-08-12/alpha-r0/manifest.json`に、事業所・業務データを保存しない形で記録している。この結果はAPIレールのE1確認であり、Agentic成功率やPublic Verifiedの根拠には数えない。
