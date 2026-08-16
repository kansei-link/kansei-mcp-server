# claim_domain canary20 独立検査レポート（Checker）

- 検査日: 2026-08-16
- 検査者: kl-integrity（Checker役・Makerと独立）
- 検査対象: `growth-mvp/claim-domain-canary20-candidate.json`（kl-data-maker作成・20行）
- 方法: Makerのsource_urlを鵜呑みにせず、**全20行のclaim_domainを検査者自身がWebフェッチ**して公式サイト到達・運営法人表記を再確認。直接フェッチ不可の3件は別経路（公式プレスリリース・複数権威ソース）で組織関係を裏取り。PSLは publicsuffix.org から実ファイルをダウンロード（16,409行）してローカルgrepで確定検査。

## 総合判定

**agree: 19 / disagree: 0 / needs_manual: 1（Jooto）**

claim_domainの選定自体に誤り（typosquat・偽ドメイン・法人取り違え）は**ゼロ**。Makerの仕事は高品質。ただし①Jootoのサービス終了告知（canary適格性）、②freee 3行の根拠URL不再現、③OneLoginのexception_reason内の所有者記述の陳腐化、④shop-pro.jpの共有サブドメイン構造に伴う検証設計上の注意——の4点を下記の通り指摘する。

---

## 行別判定

| # | service_id | claim_domain | 判定 | 検査者の独立確認結果 |
|---|---|---|---|---|
| 1 | AgileWorks | atled.jp | **agree** | 直接フェッチ再現。フッター「株式会社エイトレッド 東京都渋谷区渋谷2-15-1」+ AgileWorks製品ページを確認。一致 |
| 2 | DocuSign | docusign.com | **agree** | 直接フェッチ再現。フッター「(C) Docusign, Inc. 2026」確認。一致 |
| 3 | freee会計 | freee.co.jp | **agree**（根拠URLに提案差分あり） | claim_domainは正。ただしMaker notesの「corp.freee.co.jp/company/ のサービス一覧にfreee会計を確認」は**検査者フェッチで再現できず**（同ページに明示されていたのはfreee会社設立/サイン/販売/勤怠管理Plus等）。www.freee.co.jp 側でfreee会計・freee人事労務の掲載と「Copyright (C) 2012-2026 freee K.K.」を確認し、結論は同じ |
| 4 | freee人事労務 | freee.co.jp | **agree**（同上） | www.freee.co.jp で掲載確認。claim_domainは正 |
| 5 | freeeサイン | freee.co.jp | **agree** | 直接フェッチ再現。製品ページフッター「freee株式会社 東京都品川区大崎1-2-2」確認。旧サイトビジット経緯の注記も適切 |
| 6 | freee給与計算 | freee.co.jp | **agree**（同上#3） | www.freee.co.jp では給与計算はfreee人事労務の機能として表示。claim_domainは正（同一法人・同一eTLD+1のため影響なし） |
| 7 | Notion | notion.com | **agree** | 直接フェッチ再現。フッター「(C) 2026 Notion Labs, Inc.」確認。notion.com=現行正ドメインの判断も正 |
| 8 | Square | squareup.com | **agree** | squareup.com/jp/ja 公式到達を再現（タイトル・日本向けコンテンツ確認）。フッター法人表記は検査者のフェッチ範囲では非表示のため、Maker引用「(C) Square, Inc.」は未再現（軽微）。親会社Block, Inc.の関係記述は正 |
| 9 | Wrike | wrike.com | **agree** | 公式到達を再現。法人名フッター非表示はMaker自身がnotesで開示済みで整合 |
| 10 | Zoho CRM | zoho.com | **agree** | 直接フェッチ再現。sales@zohocorp.com 併記を確認、Maker記述と一致。ゾーホージャパン（zoho.co.jp）を販売子会社としてグローバルzoho.comを正とする判断も妥当 |
| 11 | カラーミーショップ | shop-pro.jp | **agree**（検証設計に注意事項P1） | 直接フェッチ再現。「カラーミーショップ by GMOペパボ」・GMOインターネットグループ表記確認。**追加発見**: 公式ヘルプで、テナントショップに `{任意文字列}.shop-pro.jp` のサブドメインが割り当てられる共有サブドメイン構造を確認（下記観点6） |
| 12 | OneLogin | onelogin.com | **agree**（medium維持妥当・exception_reasonに提案差分） | 検査者もonelogin.comはJSレンダリングで本文空を再現。One Identity公式プレス（2021-10-04買収完了）とonelogin.com/press-centerの実在で公式性を間接確認。**ただしexception_reasonの「Francisco Partners保有」は陳腐化**: Quest Softwareは2022年2月にFrancisco Partners→Clearlake Capitalへ売却完了済み |
| 13 | Chatwork | chatwork.com | **agree** | 直接フェッチ再現。フッター「(C) kubell」+ kubell.comへの会社概要リンク確認。一致 |
| 14 | Concur Expense | concur.com | **agree**（medium維持妥当） | concur.co.jpは検査者も403で再現。株式会社コンカー（2011年設立・2014年12月SAP統合完了・大手町）を複数ソースで確認。concur.com=SAP Concurグローバル正の判断、および「日本claim主体がconcur.co.jpになる可能性」の注記は妥当 |
| 15 | Domo | domo.com | **agree**（medium維持妥当） | domo.com/jpは検査者も405で再現。Domo, Inc.（American Fork, Utah・Nasdaq: DOMO・公式サイト=domo.com）をWikipedia/D&B/Yahoo Financeの三重で確認。実在性リスクは低い |
| 16 | fincode byGMO | fincode.jp | **agree** | 直接フェッチ再現。フッター「Copyright (C) 2002 GMO Epsilon, Inc.」確認。GMOイプシロンと同一法人の指摘・org統合L3課題の提起も正 |
| 17 | Freshdesk | freshworks.com | **agree** | 直接フェッチ再現。schema=Freshworks Inc、製品ページがfreshworks.com/freshdesk/配下に統合済みであることを確認。freshdesk.comでなく本社ドメイン採用の例外判断は妥当 |
| 18 | GMOイプシロン | epsilon.jp | **agree** | 直接フェッチ再現。「Copyright (C) 2002 GMO Epsilon, Inc.」+ 当社関連会社セクションにGMOペイメントゲートウェイ株式会社を確認。別法人分離の記述と整合 |
| 19 | GMOペイメントゲートウェイ | gmo-pg.com | **agree** | 直接フェッチ再現。「Copyright (C) 1995 GMO Payment Gateway, Inc.」+ Epsilon byGMOを別会社サービス（中小・個人事業主向け）として紹介する記載を確認。一致 |
| 20 | Jooto | jooto.com | **needs_manual**（ドメイン判定はagree） | 直接フェッチ再現。「produced by PR TIMES」（赤坂インターシティ8階）確認、claim_domain自体は正。**重大発見: 公式サイトに「2027年7月31日をもって一般提供を終了する」旨のサービス終了告知**。canary20の構成サービスとしての継続採否は人間判断（L3）が必要 |

---

## 観点別サマリ

### 1. homograph/IDN・typosquat — 問題なし
全17ユニークドメインのラベルはASCII小文字英数字とハイフンのみ。`xn--`ラベルなし、混同可能文字（キリル文字等）なし、punycode正規化で変化するものなし。全行についてclaim_domainそのもののURLをフェッチし、17件は実際の公式コンテンツへの到達を確認。ブロックされた3件（onelogin.com/concur.com/domo.com）も権威ソースで公式性を確認。`freee.co.jp`（eが3つ=正）、`gmo-pg.com`（.jpでなく.comが公式=直接確認済）を含めtyposquatの混入なし。

### 2. グループ会社/別法人 — 整合
- GMO系: GMOペイメントゲートウェイ（gmo-pg.com）とGMOイプシロン（epsilon.jp）の2法人分離、fincode=GMOイプシロン同一法人、カラーミーショップ=GMOペパボ（第3の法人）——いずれも検査者の直接確認と一致。JSONのexception_reasonの法人区分記述は正確。
- freee系: 4行すべて運営=freee株式会社本体で正（freeeサインの旧別法人経緯の処理も適切）。唯一の瑕疵は#3の根拠URL不再現（下記提案差分1）。

### 3. 買収関係 — 妥当（1件陳腐化）
- OneLogin: One Identityによる2021年10月買収を公式プレスで確認。製品ドメインonelogin.com存続も確認。**ただし最終親の記述が古い**（Francisco Partners→Clearlake Capital、2022年2月完了）→提案差分2。
- Concur: SAP傘下（2014年12月統合完了）・日本法人株式会社コンカー（concur.co.jp）の三層構造の記述は正確。
- Square: Block, Inc.親会社・サービスはsquareup.com統一の判断は実務上妥当。
- Freshdesk: freshworks.com/freshdesk/への統合を直接確認。本社ドメイン採用で正。

### 4. サービスドメイン≠法人ドメイン4件 — 方針は一貫、claim実務への影響あり
カラーミーショップ（shop-pro.jp/法人=pepabo.com）・Chatwork（chatwork.com/kubell.com）・Jooto（jooto.com/prtimes.co.jp）・Square（squareup.com/block.xyz）の4件とも「公式サービスサイトのeTLD+1を採用し、法人側代替をexception_reasonに明記」で**一貫している**。ただしClaim検証実務（企業担当者からの申請）では、申請者のメールドメインは法人側（@pepabo.com / @kubell.com / @prtimes.co.jp）である可能性が高く、claim_domain単一フィールドではメールドメイン照合が4件全てで不一致になり得る（Squareのみ@squareup.com慣行が残る可能性あり）。→ **L3提案**: claim_domainとは別に「claim申請者メールとして受理可能なドメインのリスト（法人ドメイン併記）」をスキーマに追加するか、組織単位claimに寄せるかをMichie判断に上げる。

### 5. medium 3件（OneLogin/Concur/Domo） — medium維持が正
3件とも検査者の手段でも直接フェッチ不可（空/403/405をそのまま再現。Makerの申告は正直）。間接確認は本検査で強化された（OneLogin=One Identity公式プレス、Concur=日本法人情報複数ソース、Domo=Wikipedia/D&B/Yahoo Finance三重）が、confidence定義「high=公式サイトを直接フェッチし運営法人表記を確認」を満たさないため**昇格は提案しない**。定義に「複数の独立権威ソースで確認した場合はhigh相当」を追加するかどうかはL3（定義変更はMakerの裁量外・Checkerの裁量外）。

### 6. PSL（eTLD+1妥当性） — 全件妥当、shop-pro.jpに設計注意
publicsuffix.org の実ファイル（16,409行）をダウンロードしてローカルgrepで検査。**17ドメインすべて本体・配下エントリともPSL非掲載**であり、.jp / .co.jp / .com の直下ラベルとしてeTLD+1として妥当。公共サフィックス・共有ホスティングサフィックスの誤採用はない。
**ただしshop-pro.jpは事実上の共有サブドメイン運用**（テナントショップが`{任意文字列}.shop-pro.jp`を取得可能、公式ヘルプで確認）でありPSLには載っていない。Claim検証実装で「サブドメインでのDNS TXT/ファイル設置証明」を受理する設計にした場合、**GMOペパボ以外の任意のテナント店舗がカラーミーショップのclaimを通せてしまう**。→ **P1: claim検証はeTLD+1のapexでの証明（またはapex管理者のみが設置できる手段）に限定するガードを実装要件に明記すること**（実装は実装レーンへ）。

---

## 提案差分（candidate.jsonは未改変・Maker判断で反映）

### 差分1: freee会計・freee人事労務・freee給与計算（3行）— 根拠の再現性
notesの「会社概要ページのサービス一覧に◯◯を確認」が再現できないため、根拠を実際に掲載が確認できるURLへ差し替え:
```
- "source_url": "https://corp.freee.co.jp/company/",
+ "source_url": "https://www.freee.co.jp/",
- "notes": "運営=freee株式会社（東京都品川区大崎）。会社概要ページのサービス一覧にfreee会計を確認。..."
+ "notes": "運営=freee株式会社（東京都品川区大崎、Copyright (C) 2012-2026 freee K.K.）。製品サイトwww.freee.co.jpにfreee会計の掲載を確認。コーポレート=corp.freee.co.jp（同一eTLD+1）"
```
（freee給与計算行は「現行サイトではfreee人事労務の機能として表示」の注記追加も推奨）

### 差分2: OneLogin — exception_reasonの所有者記述の更新
```
- "exception_reason": "2021年10月にOne Identity LLC（Quest Software傘下、Francisco Partners保有）が買収。..."
+ "exception_reason": "2021年10月にOne Identity LLC（Quest Software傘下。Quest本体は2022年2月にFrancisco PartnersからClearlake Capitalへ売却完了）が買収。..."
```

### 差分3: Jooto — サービス終了告知の追記（notes）
```
+ "notes": "...【2026-08-16 Checker追記】公式サイトに2027年7月31日をもって一般提供を終了する旨の告知あり。canary20としての継続採否はL3判断待ち"
```

### 差分4: カラーミーショップ — 共有サブドメイン注意の追記（notes）
```
+ "notes": "...【Checker追記】テナントショップに{文字列}.shop-pro.jpが割り当てられる共有サブドメイン構造（PSL非掲載）。claim検証はapex限定の証明手段に制限すること"
```

---

## Michie抜き取り確認 推薦5件（判断重要度・不確実性順）

1. **Jooto（#20）** — 公式にサービス終了告知（2027年7月31日一般提供終了）。claim_domainの問題ではなく**canary20の構成そのものの判断**。差し替えるか、EOLサービスの扱い方針（データに残すが公開面でどう表示するか）ごと決める必要がある。最優先。
2. **カラーミーショップ / shop-pro.jp（#11）** — 共有サブドメイン構造下でのclaim検証設計（apex限定ガード）＋法人ドメインpepabo.com併記のL3判断。誤設計なら第三者テナントによる**なりすましclaimが通る**リスクで、Verified表示の信頼性に直結。
3. **fincode byGMO × GMOイプシロン（#16/#18）** — 同一法人（GMO Epsilon, Inc.）に2つのorganization_id。Claim単位=組織の原則とのorg統合（またはepsilon.jpへの寄せ）はスキーマの根っこに関わるL3判断。
4. **OneLogin（#12）** — medium唯一の「claim主体自体が別会社（One Identity）になる可能性」案件。買収チェーン（One Identity→Quest→Clearlake）の中でどこをclaim主体と認めるかの前例になる。
5. **Concur Expense（#14）** — 日本市場のclaim主体をconcur.com（SAPグローバル）とconcur.co.jp（株式会社コンカー）のどちらにするか。日本法人が別法人格で実在するケースの前例判断。

（Chatwork/kubellとSquare/Blockは同型の論点だがMakerのexception_reason整理が正確で不確実性が低いため5件から除外。#2/#5の判断が自動的に前例として適用可能）

---

## Integrity所見（Qレーン観点）

- 公開データ汚染: 本JSONは内部candidate。公開ビューへの流入経路なし。問題なし。
- 機密混入: テナントID・実名研究データ・API key該当なし。問題なし。
- 実名リスク: 企業名は事実（公式サイトの運営法人表記・公表済み買収）のみ。断定的ネガティブ表現なし。Jooto終了告知は公式一次情報で時点付き。問題なし。
- 独立性: claim_domain判定に支払い・利益相反の結線なし。問題なし。

**公開ブロック宣言: なし**（P0該当なし。P1=shop-pro.jp claim検証ガード要件・Jooto canary採否はL3処理待ち）
