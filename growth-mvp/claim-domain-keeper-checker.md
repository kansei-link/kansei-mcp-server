# claim_domain Keeper（canary rev2繰り上げ）独立検査レポート（Checker）

- 検査日: 2026-08-16
- 検査者: kl-integrity（Checker役・Makerと独立）
- 検査対象: `growth-mvp/claim-domain-keeper-candidate.json`（kl-data-maker作成・1行）
- 方法: canary20検査と同一手順。Makerのsource_urlを鵜呑みにせず検査者自身がWebフェッチ（keepersecurity.com / keeper.io apex / docs.keeper.io）。PSLは publicsuffix.org 実ファイル（16,409行）を再ダウンロードしローカルgrepで確定検査。買収関係・日本法人は複数の独立ソースで裏取り。

## 総合判定

**agree**（claim_domain=keepersecurity.com、confidence=high維持）

Makerの判定に誤りなし。ただし notes の keeper.io の性格付け（「マーケ資産/ドキュメント用」）は**過小記述**であり、実態は本番プロダクトのログイン基盤ドメイン。alt allowlist候補としては**採用推奨**（下記見解）。

---

## 行別判定

| # | service_id | claim_domain | 判定 | 検査者の独立確認結果 |
|---|---|---|---|---|
| 1 | Keeper | keepersecurity.com | **agree**（notesに提案差分あり） | 直接フェッチ再現。フッター「© 2026 Keeper Security, Inc.」を検査者フェッチでも確認。製品=パスワード管理/PAM/シークレット管理のゼロトラスト統合プラットフォーム（selection-100.jsonの「セキュリティ/AA/公式MCP/API Key」と整合）。親会社・買収の表示なし |

---

## 観点別サマリ

### 1. 公式到達・運営法人 — 再現
keepersecurity.com を直接フェッチし、法人表記「© 2026 Keeper Security, Inc.」を再確認。Maker引用と完全一致。

### 2. homograph/IDN・typosquat — 問題なし（ただしブランド衝突に注意）
- `keepersecurity.com` / `keeper.io` ともASCII小文字英数字のみ。`xn--`なし、混同可能文字なし。
- **ブランド衝突（typosquatではないが実装注意）**: 「Keeper」は多義的な一般名詞で、無関係の同名・類似名サービスが実在する（米国の会計アプリKeeper=keeper.app / Keeper Tax、keeperhub.com=ブロックチェーン自動化MCP、keeper.sh=コミュニティMCP）。自社DB内にも `keeper.sh` / `keeperhub-mcp` / `SessionKeeper` / `contextkeeper` 等の別サービス行が複数ある（`public/js/services-data.js`、`src/data/services-seed.json`、`src/data/registry-diff.json`）。claimアンカーのバインドは service_id「Keeper」（org-keeper）1件に限定し、名称部分一致でのマッチングを実装に持ち込まないこと（P1・実装レーン向け要件）。

### 3. PSL（eTLD+1妥当性） — 妥当
PSL実ファイル16,409行をgrep。「keeper」を含むエントリは `is-a-bookkeeper.com`（無関係）のみで、`keepersecurity.com` / `keeper.io` とも本体・配下エントリのPSL掲載なし。.com / .io のICANN TLD直下ラベルとしてeTLD+1妥当。共有サフィックスの誤採用なし。

### 4. 買収関係 — 独立系で問題なし
Keeper Security, Inc. は創業者（Darren Guccione / Craig Lurey）主導の未上場企業。Insight Partners（2020年8月）とSummit Partners（2023年5月）は**いずれもマイノリティ出資であり買収ではない**ことを公式プレス（Summit Partners / PR Newswire / Insight Partners）で確認。2026年時点で親会社・所有権変更の情報なし。OneLogin型の「claim主体が別会社」問題は発生しない。

### 5. 日本法人 — Maker記述を裏取り
Keeper Security APAC株式会社（法人番号5010401167416、東京都港区虎ノ門4-1-13、2022年6月6日設立）をgBizINFO系の複数法人DBとPR Timesで確認。独自の製品ドメインは持たず（PR TimesもAPAC法人名義で本社ブランドを使用）、claim_domainを本社 keepersecurity.com に置くMaker判断は妥当。canary20のConcur前例（日本法人が別ドメインconcur.co.jpを持つケース）とは異なり、本件は日本側代替ドメインが存在しないため論点にならない。

### 6. keeper.io の実態 — Maker notesは過小記述（判定は不変）
検査者の独立フェッチで判明した事実:
- **keeper.io apexは404**（apexにWebサイトなし。サブドメインのみ稼働）。
- keepersecurity.com のサイト自身が `vault.keeper.io`（Web Vaultログイン）、`console.keeper.io`（管理コンソール）、`docs.keeper.io`（ドキュメント）、`help.keeper.io`（ナレッジベース、タイトル「Keeper Security, Inc Knowledge Base」）、`trust.keeper.io`、`statuspage.keeper.io`、`lms.keeper.io` へリンクしており、keeper.io は同社保有で間違いない。
- つまり keeper.io は「マーケ資産/ドキュメント用」ではなく、**本番プロダクトのログイン/運用基盤ドメイン**。docs/help/status/trust/学習まで運用系が集約されている。

---

## claim検証アンカーとしての見解（依頼事項への回答）

**1) keepersecurity.com をprimary claim_domainに採用 — 妥当（agree）**
- 公式サイト＝法人表記を直接確認できる唯一のドメインであり、confidence定義「high=公式サイトを直接フェッチし運営法人表記を確認」を満たすのは keepersecurity.com のみ。
- keeper.io はapex 404のため「公式サイト到達」の独立確認ができず、primaryにするとhigh定義を満たせない。企業側の対外的な正ドメイン（プレス・コーポレート・製品LP）も keepersecurity.com で一貫。

**2) keeper.io のalt allowlist候補化 — 推奨（採用すべき）**
- 同一法人（Keeper Security, Inc.）の管理下にあることを相互リンクとサブドメイン群（vault/console/docs/help/trust/statuspage/lms）で確認済み。DNS TXT/apexファイル設置いずれの証明手段でも、keeper.io を制御できるのは同社のみ。
- 実務上、技術担当者（claim申請の実行者になりやすい層）はdocs/console側=keeper.io系で作業しており、DNS権限がkeeper.ioゾーンで先に取れるケースは現実的にあり得る。
- **条件**: alt扱いはあくまで「claim検証の受理可能ドメイン」であり、公開Profileの表示上の公式サイト・provenance根拠は keepersecurity.com のまま。allowlistへの追加はスキーマ側にaltフィールドが入ってから（canary20検査の観点4で提起済みの「claim受理可能ドメインのリスト」L3判断と同じ箱で処理するのが整合的。Keeperは法人ドメイン併記型4件と違い**同一法人の第2ドメイン**という新パターンなので、L3判断の際の好例になる）。
- なお申請者メールドメインは@keepersecurity.com慣行の可能性が高いが未確認。メール照合を実装する場合はkeeper.ioも受理対象に含める前提で設計すること。

---

## 提案差分（candidate.jsonは未改変・Maker判断で反映）

### 差分1: notes の keeper.io 性格付けの修正
```
- "補足: 同社はマーケ資産/ドキュメント用にkeeper.io（docs.keeper.io等）も保有するが、サービス公式サイトはkeepersecurity.comであり claim検証にはkeepersecurity.comを使う"
+ "補足: 同社はkeeper.io（apexは404・サイトなし）をプロダクト運用ドメインとして保有し、vault.keeper.io（Web Vaultログイン）/console.keeper.io（管理コンソール）/docs.keeper.io/help.keeper.io/trust.keeper.io/statuspage.keeper.io が稼働（公式サイトからの相互リンクで同社帰属を確認）。公式サイト・法人表記の確認可能ドメインはkeepersecurity.comのためprimary claim_domainはkeepersecurity.com。keeper.ioはalt allowlist候補（L3のalt受理ドメイン設計待ち）"
```

### 差分2: 所有構造の追記（推奨・任意）
```
+ "notes追記: 買収なし・独立系（創業者主導）。Insight Partners 2020年8月/Summit Partners 2023年5月はいずれもマイノリティ出資（公式プレス確認・2026-08-16時点）"
```

---

## 追加発見（claim_domain判定外・P2）

- **org重複の疑い**: `src/data/services-seed.json` に `keeper-jp`（Keeper Security Japan、api_url=docs.keeper.io）が別行で存在し、`public/js/services-data.js` にも「Keeper」（AA/公式MCP）と「Keeper Security Japan」（BB/API Only）の2行が併存する。両者は同一組織（Keeper Security, Inc.系列）とみられ、org-keeper へのclaim紐付け時にどちらのサービス行が対象になるかが曖昧。fincode×GMOイプシロンで提起済みのorg統合L3課題と同型として同じキューに載せることを推奨。
- **データ連結の注意**: selection-100.jsonの「Keeper」（ari_rank 21）に対応する行がservices-seed.jsonに見当たらない（seed側はkeeper-jpのみ）。claim実装時にservice_id「Keeper」の解決先を明示すること（実装レーン確認事項）。

---

## Integrity所見（Qレーン観点）

- 公開データ汚染: 本JSONは内部candidate。公開ビューへの流入経路なし。問題なし。
- 機密混入: テナントID・実名研究データ・API key該当なし。問題なし。
- 実名リスク: 記載は公式一次情報（フッター法人表記・公式プレス・法人番号公開DB）のみで時点付き。ネガティブ表現なし。問題なし。
- 独立性: claim_domain判定に支払い・利益相反の結線なし。問題なし。

**公開ブロック宣言: なし**（P0該当なし。P1=名称部分一致マッチング禁止ガード〈観点2〉は実装レーン要件。P2=org重複・データ連結は上記のとおり）
