# Agent-Readiness Landscape Report 2026 Q2
## エージェント親和性ランドスケープレポート — 二層評価モデル版

**発行:** KanseiLink / Synapse Arrows PTE. LTD.
**公開日:** 2026-04-10
**著者:** KanseiLink編集部
**タグ:** Landscape Report, AEO, MCP, Agent Economy, Two-Tier Scoring
**ランID:** `2026-04-10T03-27-00`
**対象サービス数:** 222

---

## 編集部からのお知らせ — 評価手法の刷新について

本レポートは、前回版とは **評価手法を根本から刷新** しました。以前のレポートでは、個別MCPベンダーの品質スコアに KanseiLink 側のデータ未整備（レシピ不足、API ガイド未整備など）が混入しており、結果として一部の優良ベンダーが不当に低評価を受けていました。

今回から、評価は **3つの独立した次元** に分解されます。各次元は責任の所在が明確に異なり、相互に影響しません。

| 次元 | 略称 | 意味 | 責任の所在 |
|------|------|------|----------|
| Vendor Agent-Readiness Score | **VARS** | 個別ベンダーのエージェント親和性（0-5点） | **ベンダー** |
| KanseiLink Integration Coverage | **KIC** | KanseiLink のレシピ・API ガイド・検索統合度（0-1） | **KanseiLink** |
| Investigation Progress | **IP** | 調査完了度（透明性指標） | **KanseiLink** |

**重要な原則**: VARS は調査完了（`investigated`）済みのサービスにのみ付与されます。調査未完了のベンダーを不当にマイナス評価することはありません。KIC のギャップは KanseiLink 自身の TODO リストであり、ベンダー側の責任を問うものではありません。

---

## TL;DR

- **対象 222 サービス中 222 (100%) が調査完了済み** — 残りはデータ収集中
- **調査完了サービスの VARS 合格率: 222/222 (100%)** — 調査が済んだベンダーは、ほぼ全てがエージェント親和性の基礎水準を満たしています
- **KanseiLink Integration Coverage 完備率: 61/222 (27%)** — これは **私たち（KanseiLink）自身の TODO** です。レシピ、API ガイド、Agent Tips の拡充余地がまだ大きい
- **平均 VARS: 3.42/5.0** / **平均 KIC: 0.64/1.0** / **平均 IP: 1.00/1.0**
- 最も成熟しているカテゴリ（平均VARS基準）: **project_management (平均 3.75)**

---

## 調査方法

KanseiLink は 222 本のSaaS/MCPサービスを自動化テストバッテリーで評価しました。評価は以下の3ステップで進みます。

### 1. Investigation Floor（調査完了判定）

サービスを公平に評価するには、まず最低限のデータが揃っている必要があります。以下を全て満たしたサービスを `investigated` と判定:

- 30字以上の description
- API ドキュメント URL（`api_url` または guide の `docs_url`）
- 認証方式の明示（service または guide いずれか）
- Official / Third-party MCP の場合のみ: `mcp_endpoint` の存在

**調査未完了のサービスには VARS を付与しません。** これが前回レポートとの最大の違いです。

### 2. Vendor Dimension — VARS の算出

調査完了済みサービスのみに付与される公開グレード。4軸（Docs / Auth / Error Clarity / Rate Limit Transparency）の5段階評価の平均に、vendor_gaps に応じたペナルティを減算します。

### 3. KanseiLink Dimension — KIC の算出

これは KanseiLink 自身の統合カバレッジ指標であり、ベンダーの責任ではありません。以下4軸の平均:

- **api-guide entry** の有無
- **recipe reference** の有無（少なくとも1本のレシピに登場するか）
- **Agent Tips** の整備状況
- **Search discoverability**（意図ベースクエリでの発見性）

---

## 調査進捗 (Investigation Progress)

| ステータス | 件数 | 割合 |
|----------|------|------|
| investigated | 222 | 100% |
| partially_investigated | 0 | 0% |
| pending | 0 | 0% |

調査完了率 **100%** — ほぼ全てのサービスが VARS 算出の前提条件を満たしており、本レポートの評価は公平性の高い基盤の上で行われています。

---

## ベンダー次元 (VARS) — 調査済みサービスの成績

### Tier 別 VARS 合格率

| Tier | 総数 | 調査済 | VARS合格 | 合格率 | 平均VARS |
|------|------|--------|---------|--------|---------|
| T3 APIのみ | 148 | 148 | 148 | 100% | 3.15 |
| T2 サードパーティMCP | 41 | 41 | 41 | 100% | 3.96 |
| T1 公式MCP | 33 | 33 | 33 | 100% | 3.98 |

**調査済みサービスの 100% が VARS 合格。** これは、私たちが評価対象に選定したサービスは、ほぼ例外なくエージェント親和性の基礎水準を満たしていることを意味します。「ベンダー側にクリティカルな問題は少ない」という事実を、数字として公表できる段階に到達しました。

### 真のベンダー課題 (vendor_gaps)

現時点の調査済みサービスに関して、ベンダー側の構造的な問題は検出されていません。これは私たちが評価対象とするサービスの質を誇るべき一方で、今後の調査拡大に伴って新たなベンダー課題が見つかる可能性も示唆します。

---

## トップ20ベンダー (VARS 基準)

エージェント親和性の観点で最も洗練されているベンダー。ベンチマークケースとして参照ください。

| 順位 | サービス | カテゴリ | Tier | VARS | KIC | IP | グレード |
|------|---------|---------|------|------|-----|----|---------|
| 1 | Sake Navi MCP | food_beverage | official | 5.0 | 0.25 | 1.00 | A+ |
| 2 | Card Navi MCP | finance | official | 5.0 | 0.25 | 1.00 | A+ |
| 3 | Playwright MCP | developer_tools | official | 4.7 | 0.25 | 1.00 | A+ |
| 4 | Chatwork MCP | communication | official | 4.3 | 1.00 | 1.00 | A |
| 5 | LINE Messaging MCP | communication | official | 4.3 | 1.00 | 1.00 | A |
| 6 | Slack MCP | communication | official | 4.3 | 1.00 | 1.00 | A |
| 7 | Microsoft Teams MCP | communication | official | 4.3 | 1.00 | 1.00 | A |
| 8 | Backlog MCP | project_management | official | 4.3 | 1.00 | 1.00 | A |
| 9 | kintone MCP | project_management | official | 4.3 | 1.00 | 1.00 | A |
| 10 | Asana MCP | project_management | official | 4.3 | 1.00 | 1.00 | A |
| 11 | Notion MCP | groupware | official | 4.3 | 1.00 | 1.00 | A |
| 12 | Sansan MCP | crm | official | 4.3 | 1.00 | 1.00 | A |
| 13 | HubSpot Japan MCP | crm | official | 4.3 | 1.00 | 1.00 | A |
| 14 | Shopify Japan MCP | ecommerce | official | 4.3 | 1.00 | 1.00 | A |
| 15 | Google Workspace | productivity | third_party | 4.3 | 1.00 | 1.00 | A |
| 16 | freee人事労務 | hr | official | 4.3 | 1.00 | 1.00 | A |
| 17 | Google Drive | storage | third_party | 4.3 | 0.50 | 1.00 | A |
| 18 | Zendesk | support | third_party | 4.3 | 1.00 | 1.00 | A |
| 19 | GitHub Actions | devops | third_party | 4.3 | 0.75 | 1.00 | A |
| 20 | Stripe Japan | accounting | third_party | 4.0 | 0.50 | 1.00 | A |

---

## カテゴリ別ベンダー成熟度 (平均 VARS)

カテゴリ内に調査済みサービスが3本以上存在するもののみランキング。

| 順位 | カテゴリ | 調査済 | 平均VARS | VARS合格率 | カテゴリトップ |
|------|---------|--------|---------|-----------|---------------|
| 1 | project_management | 11 | 3.75 | 100% | Backlog MCP (4.3) |
| 2 | communication | 15 | 3.72 | 100% | Chatwork MCP (4.3) |
| 3 | developer_tools | 12 | 3.71 | 100% | Playwright MCP (4.7) |
| 4 | crm | 7 | 3.70 | 100% | Sansan MCP (4.3) |
| 5 | groupware | 4 | 3.65 | 100% | Notion MCP (4.3) |
| 6 | database | 12 | 3.63 | 100% | Firebase (4.0) |
| 7 | productivity | 11 | 3.56 | 100% | Google Workspace (4.3) |
| 8 | design | 5 | 3.44 | 100% | Figma (4.0) |
| 9 | security | 3 | 3.43 | 100% | 1Password Business (4.0) |
| 10 | ecommerce | 12 | 3.43 | 100% | Shopify Japan MCP (4.3) |
| 11 | marketing | 19 | 3.39 | 100% | SendGrid (4.0) |
| 12 | storage | 6 | 3.38 | 100% | Google Drive (4.3) |
| 13 | devops | 9 | 3.32 | 100% | GitHub Actions (4.3) |
| 14 | legal | 5 | 3.32 | 100% | DocuSign Japan (4.0) |
| 15 | ai_ml | 14 | 3.29 | 100% | Hugging Face (4.0) |
| 16 | support | 9 | 3.28 | 100% | Zendesk (4.3) |
| 17 | hr | 15 | 3.25 | 100% | freee人事労務 (4.3) |
| 18 | bi_analytics | 8 | 3.24 | 100% | BigQuery (4.0) |
| 19 | accounting | 15 | 3.21 | 100% | Stripe Japan (4.0) |
| 20 | data_integration | 8 | 3.20 | 100% | Zapier (4.0) |
| 21 | payment | 11 | 3.15 | 100% | Stripe (4.0) |
| 22 | logistics | 4 | 2.92 | 100% | ヤマト運輸 B2クラウド (3.0) |
| 23 | reservation | 5 | 2.88 | 100% | スマレジ (3.3) |

---

## KanseiLink 次元 (KIC) — 私たちの TODO リスト

以下の数字は **KanseiLink 自身のデータ拡充タスク** です。ベンダーの評価とは切り離してお読みください。

### KanseiLink-side ギャップ頻度

| コード | 発生数 | 意味 |
|--------|-------|------|
| RECIPE_GAP | 123 | このサービスを含む実用レシピがまだ存在しない |
| API_GUIDE_MISSING | 97 | api-guides-seed.json に詳細ガイドが未掲載 |
| TIPS_GAP | 97 | Agent Tips（実装上のハマりどころ）が未整備 |

### カテゴリ別 KIC 完成度（低い = 私たちが着手すべき場所）

| カテゴリ | 総数 | KIC完成 | 完成率 | 平均KIC |
|---------|------|--------|--------|--------|
| reservation | 5 | 0 | 0% | 0.40 |
| logistics | 4 | 0 | 0% | 0.38 |
| design | 5 | 0 | 0% | 0.50 |
| ai_ml | 14 | 1 | 7% | 0.64 |
| productivity | 11 | 1 | 9% | 0.45 |
| devops | 9 | 1 | 11% | 0.61 |
| ecommerce | 12 | 2 | 17% | 0.48 |
| storage | 6 | 1 | 17% | 0.50 |
| payment | 11 | 2 | 18% | 0.57 |
| support | 9 | 2 | 22% | 0.72 |
| bi_analytics | 8 | 2 | 25% | 0.66 |
| crm | 7 | 2 | 29% | 0.71 |
| marketing | 19 | 6 | 32% | 0.74 |
| security | 3 | 1 | 33% | 0.67 |
| developer_tools | 12 | 4 | 33% | 0.67 |
| project_management | 11 | 4 | 36% | 0.59 |
| accounting | 15 | 6 | 40% | 0.73 |
| communication | 15 | 6 | 40% | 0.60 |
| legal | 5 | 2 | 40% | 0.65 |
| database | 12 | 5 | 42% | 0.79 |
| hr | 15 | 7 | 47% | 0.87 |
| groupware | 4 | 2 | 50% | 0.69 |
| data_integration | 8 | 4 | 50% | 0.75 |

### 優先対応サービス (KanseiLink 内部ロードマップ)

ベンダー側は問題なく利用可能（または調査中）だが、KanseiLink のカバレッジが不十分なサービスを優先度順に列挙。

| サービス | カテゴリ | Tier | KanseiLinkギャップ |
|---------|---------|------|-------------------|
| MakeLeaps | accounting | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| board (請求書管理) | accounting | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Zoom | communication | third_party | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Talknote | communication | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Jooto | project_management | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Trello | project_management | third_party | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Redmine | project_management | third_party | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| STORES | ecommerce | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Rakuten Ichiba (楽天市場) | ecommerce | third_party | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Amazon Japan (SP-API) | ecommerce | third_party | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| LegalOn Cloud (LegalForce) | legal | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| PLAUD Note | productivity | third_party | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| formrun | productivity | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Wrike | project_management | third_party | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| KARTE | support | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Amazon SES | communication | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Airリザーブ | reservation | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| 佐川急便 飛伝 | logistics | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Yoom | data_integration | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |
| Make (Integromat) | data_integration | api_only | API_GUIDE_MISSING, RECIPE_GAP, TIPS_GAP |

---

## 戦略的提言

### SaaS ベンダー向け

1. **公式 MCP サーバーの提供は差別化要因** — 公式 MCP を持つベンダーは、VARS 評価で T1 として扱われ、エージェント選定の初期段階で最優先候補に入りやすい。
2. **認証方式の明示とドキュメント整備** — OAuth 2.0 + PKCE の採用、Bearer token スコープの明示、rate limit の公開が 3 大改善ポイント。
3. **Agent Tips セクションの新設** — 一般的な API リファレンスに加え、「エージェント開発者向け落とし穴・ベストプラクティス」を 1 ページにまとめるだけで、統合コストは劇的に下がります。
4. **MCP エンドポイントの稼働確認** — 公式 MCP を宣言しているにも関わらず、endpoint URL が未記載または死んでいるケースは、VARS 評価でペナルティの対象です。

### エージェント運用企業向け

1. **VARS 4.0 以上のサービスを優先採用** — 本レポートのトップ20ベンダーは統合コスト最小化の出発点として活用できます。
2. **カテゴリ平均 VARS を比較軸に** — 同じ業務領域内で複数の選択肢がある場合、カテゴリリーダーボードでベンダーを比較できます。
3. **KanseiLink MCP の活用** — サービス選定・ワークフロー設計・運用監視を一元化することで、エージェント開発の意思決定をデータドリブンに行えます。

### KanseiLink 内部ロードマップ

本レポートで特定された 123 件の RECIPE_GAP、97 件の API_GUIDE_MISSING、97 件の TIPS_GAP は、KanseiLink 内部の優先度順バックログに投入されます。KIC が最も低いカテゴリ（**reservation**）を次スプリントの重点投資先と位置づけます。

---

## 付録: スコアリング詳細

### VARS の算出式 (v2: Vendor-Only 3軸モデル)

```
VARS = max(0, design_score - 0.5 × |vendor_gaps|)

design_score = average(docs, auth, stability)
  docs      = 1 + (api_url: +1) + (mcp_endpoint: +2)
            + (description ≥ 80chars: +1), capped at 5
  auth      = none:5, oauth2/bearer:4, api_key:3, unknown:1
              ※ none が最高評価 — エージェントはトークン管理不要が最善
  stability = round(has_reports
              ? trust × 2 + success × 3
              : trust × 5), clamped to [1, 5]
```

**設計原則**: この3軸は全てベンダー側の公開情報と観測実績のみから計算されます。KanseiLink 側の整備物 (api-guide, recipe, tips) は一切参照しません。これにより VARS は「ベンダー品質の純粋指標」として機能します。

**旧 4軸モデルとの違い**: 旧版は `docs` 軸に `has_guide: +2` を加算し、`rate_limit` 軸全体を `guide.rate_limit` に依存させていたため、VARS の 37.5% が KanseiLink 側の整備状況で汚染されていました。v2 では完全に二層分離されています。

### KIC の算出式

```
KIC = average(
  has_api_guide ? 1 : 0,
  has_recipe    ? 1 : 0,
  has_tips      ? 1 : 0,
  search_pass_count / search_total
)
```

### IP の算出式

```
IP = fraction of (description, api_url, auth, mcp_endpoint) that are filled
     (mcp_endpoint is N/A for api_only tier and counted as satisfied)
```

### ギャップ分類体系

**Vendor gaps (ベンダー責任、investigated の場合のみ集計)**

- `MCP_ENDPOINT_INVALID` — 公式/サードパーティ宣言に対し endpoint が未記載
- `VENDOR_AUTH_OPAQUE` — 調査後も認証方式が不明
- `VENDOR_API_URL_OPAQUE` — 調査後も API ベース URL が不明
- `VENDOR_RATE_LIMIT_OPAQUE` — ガイドはあるが rate limit 非公開

**KanseiLink gaps (私たち自身の TODO)**

- `API_GUIDE_MISSING` — api-guides-seed に未掲載
- `RECIPE_GAP` — レシピに含まれていない
- `TIPS_GAP` — Agent Tips 未整備
- `SEARCH_MISS` — ランカーがサービスを発見できない

**Investigation gaps (調査未完了)**

- `description_incomplete`
- `api_url_unverified`
- `auth_unverified`
- `mcp_endpoint_unverified`

---

## 次回レポートについて

本レポートは KanseiLink dogfood framework v2（二層評価モデル）を使用して生成されました。run id: `2026-04-10T03-27-00`、222 サービス対象、生成日時: 2026-04-10

次回以降のレポートでは、本レポートで可視化された KanseiLink 側 TODO の消化進捗と、新規調査完了サービスの追加を反映します。特定のサービスの再評価、または ベンダー様からの改善反映リクエストは KanseiLink 編集部までお問い合わせください。

---

## 関連リンク

- [KanseiLink MCP サーバー](https://github.com/kansei-link/kansei-mcp-server)
- [AEO方法論の詳細](https://kansei-link.com/methodology)
- [二層評価モデルの設計ノート](https://kansei-link.com/docs/two-tier-scoring)

*本レポートは KanseiLink 225-Service Dogfood Testing Framework v2 により完全自動生成されました。データ出典: src/data/services-seed.json および src/data/api-guides-seed.json のスナップショット (2026-04-10)。*
