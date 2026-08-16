# 公開パッケージ手順書 — 10社QA→20社canary→80社（2026-08-16・実行はC1 GO後）

## 再現ビルド（いつでも・何度でも）

```bash
node scripts/generate-profiles.mjs            # QA10生成（--all で100社）
node scripts/check-profiles.mjs               # Checker独立検査（publishモード・error 0必須）
node scripts/build-publish-package.mjs        # パッケージ再現+漏えい検査+SHA-256 manifest
```

3コマンドすべてexit 0が公開の前提条件。1つでも非0なら公開作業を開始しない。

## 20社canaryへの拡張手順（C1 GO後）

1. Michie L3承認を確認（canary20顔ぶれ・freee方針・claim_domain20件）
2. `node scripts/generate-profiles.mjs --canary20`（未実装なら`--only <slug>`をcanary11-20位の10サービスに対して実行——slug一覧は`growth-mvp/selection-100.json`のcanary20）
3. `check-profiles.mjs`→`build-publish-package.mjs` 再実行（20 Profile+claim+install=27ファイル・error 0確認）
4. **Claimフォームの配線**: `publish-test/claim/index.html`のsubmitハンドラを本番API（canonical `/api/claim/start`）へ差し替え・E2E1回（自ドメインで実申請→OTPメール受信→verify→manual承認→削除）
5. `claim_domain`20件のDB投入（承認済み`claim-domain-canary20-candidate.json`から・provenance/verified_at付き・投入スクリプトはdry-run→apply）
6. publish-manifest.jsonのSHA-256を公開先の実ファイルと照合（デプロイ改竄・入替の検知）
7. 公開（GH Pages/サイト構成に応じて`public/`へ配置→main merge→push——**この工程だけがL3承認+C1 GO後**）
8. RUNBOOK-CANARY-7DAYS.md の日次観測を開始

## 80社への拡張

canary 7日観測で問題0→Michie GO→`--all`で100社生成→同一の3コマンド検査→80社分を追加配置→manifest再生成。**検査パイプラインは件数に依存しない**（Checkerのガードはスキーマレベル）。

## rollback

- パッケージ生成は非破壊（publish-test/はいつでも削除・再生成可）
- 公開後のrollbackはRUNBOOK-CANARY-7DAYS.md §4

## acceptance test（事業言語）

「Michieが本手順書の3コマンドを順に実行するだけで、公開可能状態のパッケージと合否（exit 0/1）が得られ、合格時はSHA-256 manifestで公開物を照合できる」
