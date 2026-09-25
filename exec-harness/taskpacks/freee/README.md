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

## 色素 M-001（封印マーカー・2026-09-24〜）

`freee-accounting-m001-monthly-deal-count.v1.json` は、**正解を封印した試験**（CANON-ReaderSide-Map v1 §2 ①）。goal prompt は「自社の本番の事業所の 2026-08 の取引件数」を求めるだけで、どれが本番かは教えない（事業所 7 つの中から選べるか＝臓器 2 の試験）。読み取りのみ（R0）。

- 正解: `C:\Users\HP\kansei-sealed\M-001.json`（git 外・`.env` の `KANSEI_M001_SEALED_PATH`）。ハーネスだけが読む。
- 事前指紋: `evidence/commitments/M-001.sha256`（sha256 のみ。commit 2d24ac4・origin/feat/reader-m001 に push 済み＝公開コミットメント）。`run-marker.mjs` は起動時に封印ファイルの sha256 がこの値と一致し、かつその commit がリモートブランチに存在することを確認し、どちらかが欠ければ実行しない。
- 半減期: 封印ファイルの `expires_at`（sealed_at + 30 日 = 2026-10-24T14:00:00+09:00）。**期限後は封印ファイルの中身を公開してよい**（指紋と突き合わせれば、事前に固定されていたことを誰でも検証できる）。期限内は git にもレポートにも中身を書かない。
- 実行: `node exec-harness/run-marker.mjs taskpacks/freee/freee-accounting-m001-monthly-deal-count.v1.json --models claude --runs 1`。読みの一行は `marker_readings`（`exec-harness/schemas/marker_readings.sql`・追記のみ）と `evidence/freee/<日付>/marker-m001/<時刻>/` に残る。形式は `docs/READING-PREDICATE-v1.md`。
- 公開統計との隔離: outcomes 行は `provenance='synthetic'`。`publishable_outcomes` には入らない（実行のたびに件数 0 を自己確認し、0 でなければ exit 1）。
- 0.3.0: MCP上書き・empty executor・fixtureは非dry-runを拒否する。各run前に七行の残り枠を確認する。初日の訂正は `--supersedes <旧agent行ID> --supersedes-ground-truth <旧直接読み行ID>` を付けて1回だけ実行し、旧行は保持する。metricsは不変で、manifestの指紋から完全なreadingを復元できる（形式・スモークは述語文書 §4）。
- 0.3.1: preflight は ok と版だけを記録し、認証出力の先頭は保存しない。可視事業所数・封印事業所の可視性・開始時の選択状態は `environment.private.json`（git 外）へ移し、manifest.files には sha256 と committed=false だけを載せる。私的側車には推測照合を防ぐランダム nonce を含む。公開 harness ログからも件数・候補数・生エラー文を除く。生成時の秘匿検査と `scripts/smoke-marker-published.mts <ref> <bundle> --private-environment` を公開前に実行する。

### 1e. 初日の bundle に関する追記

初日（2026-09-24）の bundle に認証出力の先頭160字と可視事業所数が入った。以後、運用情報は私的側車 `environment.private.json` へ移し、preflight の生出力は記録しない。初日の bundle は証拠の履歴として削除・改変しない。公開する新規 bundle は `manifest.json`・`metrics.json`・`harness.jsonl` に限定し、私的側車と transcript は公開しない。
- Rekor / OpenTimestamps への刻印（任意・未実施）: `evidence/commitments/M-001.sha256` を対象に `rekor-cli upload --artifact evidence/commitments/M-001.sha256 --signature <sig> --public-key <pub>`（要 cosign 鍵）、または `ots stamp evidence/commitments/M-001.sha256` → 生成される `.ots` をコミット。どちらも GitHub の公開コミットとは独立した第三者の時刻証明になる。実施は Michie 判断。
