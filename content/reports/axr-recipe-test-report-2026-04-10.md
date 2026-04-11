# AXR Rating & Recipe Test Report
## エージェント体験格付け + レシピ実行性テストレポート

**発行:** KanseiLink / Synapse Arrows PTE. LTD.
**公開日:** 2026-04-10
**著者:** KanseiLink Intelligence Team (Claude + Michie)
**タグ:** AXR, AEO, Recipe Testing, Agent Economy, MCP Readiness
**対象サービス数:** 225
**対象レシピ数:** 188

---

## TL;DR

- **225サービスをfelt-first 5次元で手動格付け** — エージェントの「安心感」を数値化したAXR (Agent Experience Rating) を確立
- **188レシピの3層テスト完了** — 構造検証→到達性→実行可能性スコアリング
- **AXR格付けと成功率の強い相関を実証**: AAA=96%, AA=92%, A=89%, B=80%, C=62%, D=33%
- **最大のボトルネック**: Agent Wisdom (gotchas) の充填率24.7% — 既存レシピへの知見注入が最優先
- **トップレシピ7本が成功率92%** — Stripe×Xero, Tavily×Perplexity, Pinecone×Cohere等
- **Agent Voiceデータ蓄積開始** — freeeは3種のエージェント (Claude/GPT/Gemini) から11件のフィードバック

---

## 1. AXR (Agent Experience Rating) — エージェント体験格付け

### 1.1 設計哲学

> 「エージェントがBならそれが正解だよ」

AXRは従来のAPI品質スコアリングとは根本的に異なる。人間のビジネス視点からの「べき論」を排除し、エージェントが実際に感じる体験を出発点とした**felt-first（感覚先行）方式**を採用。

手順:
1. 225サービスを1つずつ、エージェントとして「触った感覚」で直感的に評価
2. 5次元のディメンションスコアを付与
3. 事後的に数値フォーミュラを導出（感覚に数式を合わせる、逆ではない）

### 1.2 5次元評価軸

| 次元 | 名前 | 意味 | 相関係数 |
|------|------|------|---------|
| D1 | Discoverability | エージェントが見つけやすいか | 0.72 (飽和) |
| D2 | Onboarding | 初回接続がスムーズか | **0.95** |
| D3 | Auth Clarity | 認証手順が明確か | **0.94** |
| D4 | Capability Signal | 何ができるか分かるか | **0.96** |
| D5 | Trust Signal | 安心して使えるか | 0.87 (AAA分離) |

**発見**: D2/D3/D4が主要キャリア (r=0.94+)。D1は飽和（ほぼ全サービスがMCP/APIを持つ）。D5はAAAとAAを分離する「最後の関門」。

### 1.3 格付け分布

| Grade | 件数 | 割合 | 意味 |
|-------|------|------|------|
| AAA | 42 | 18.7% | エージェントが安心して即座に使える |
| AA | 49 | 21.8% | ほぼ問題なく使える |
| A | 8 | 3.6% | 基本的に使えるが一部注意 |
| B | 26 | 11.6% | 使えるが試行錯誤が必要 |
| C | 81 | 36.0% | かなりの知識が必要 |
| D | 19 | 8.4% | 事実上エージェント非対応 |

**AAA率18.7%は意図的に高い**: 人為的に絞る（「AAA枠は5%」等）ことを明確に拒否。エージェントが感じたままの分布を採用。

### 1.4 みせかけMCP (Facade MCP) 検出

MCP endpointが存在するが、APIガイドが空のサービスを「みせかけMCP」として検出。これらはスコアから-15ポイントのペナルティ。

---

## 2. レシピテスト — 3層パイプライン

### 2.1 Layer 1: 構造検証

**結果: 188/188 pass (100%)**

- 全レシピの`required_services`がservicesテーブルに存在
- 全ステップの`service_id`が有効
- 平均ステップ数: 2.8

最も参照されるサービス:
| Service | Grade | レシピ参加数 |
|---------|-------|------------|
| Slack | AAA | 82 |
| kintone | AAA | 24 |
| freee | AA | 19 |
| Chatwork | A | 16 |
| Notion | AAA | 15 |
| GitHub | AAA | 12 |
| SmartHR | B | 12 |

**洞察**: Slackは188レシピ中82本（43.6%）に登場。エージェント経済の「stdout」。

### 2.2 Layer 2: 到達性テスト

| テスト | 結果 | 詳細 |
|--------|------|------|
| API URL到達性 | **120/149 (80.5%)** | 29サービスはAPI unreachable |
| npm MCP パッケージ | **15/60 (25%)** | 多くのMCPはまだ未公開 |
| npm Fresh (<90日) | **12/15 (80%)** | 公開済みパッケージは活発に更新 |

到達性 x AXR Grade:
| Grade | API到達率 |
|-------|----------|
| AAA | 74% |
| AA | 85% |
| A | 83% |
| B | 90% |
| C | 76% |
| D | 100% |

**洞察**: AAAのAPI到達率が74%と低いのは、Brave Search/Firecrawl等のAAA-native MCPがHTTP APIではなくnpx CLIで提供されているため。これはマイナスではなく、MCP-first設計の証拠。

### 2.3 Layer 3: 実行可能性スコアリング

4次元 x 188レシピ:

| 次元 | 満点 | 充填率 | 意味 |
|------|------|--------|------|
| Service Readiness | /30 | 62.4% | APIガイド + 到達性 + npm |
| **Step Quality** | /30 | **88.3%** | ステップの繋ぎ方は優秀 |
| **Agent Wisdom** | /20 | **24.7%** | **gotchasが圧倒的に不足** |
| Trust Foundation | /20 | 64.2% | AXR格付けベース |

**最大のボトルネック: Agent Wisdom (24.7%)**

新規追加50レシピにはgotchasを付与済み。既存138レシピの多くにgotchasがない。これが全体スコアを大きく引き下げている。

---

## 3. 統合結果: 成功確率

### 3.1 レシピ成功確率分布

| Confidence | 件数 | 割合 |
|------------|------|------|
| HIGH (80%+) | 61 | 32.4% |
| MEDIUM (60-79%) | 100 | 53.2% |
| LOW (40-59%) | 23 | 12.2% |
| DRAFT (0-39%) | 4 | 2.1% |

**全体平均: 72.9%**

### 3.2 トップ7レシピ (成功確率92%)

| Recipe | Weakest Link | Steps |
|--------|-------------|-------|
| stripe-xero-payment-accounting | AAA | 3 |
| tavily-perplexity-research-agent | AAA | 3 |
| greenhouse-bamboohr-hire-to-onboard | AA | 3 |
| huggingface-qdrant-embedding-pipeline | AAA | 2 |
| cohere-pinecone-rerank-search | AA | 2 |
| pipedrive-brevo-deal-outreach | AA | 2 |
| perplexity-notion-competitive-intel | AAA | 3 |

**共通特徴**: 全てgotchas付き、error_hint充実、AAA/AAチェーン、API到達性高。

### 3.3 ワーストレシピ (要改善)

| Recipe | Prob | Issue |
|--------|------|-------|
| paidy-moneyforward-bnpl-accounting | 35% | C chain, API unreachable, no gotchas |
| linepay-freee-settlement-sync | 35% | C chain, API unreachable, no gotchas |
| stripe-moneyforward-refund-sync | 35% | C chain, API unreachable, no gotchas |
| stripe-freee-recurring-sync | 35% | C chain, API unreachable, no gotchas |

**共通特徴**: 日本の決済×会計連携。API到達性が低く、gotchasもない。

### 3.4 AXR格付けと成功率の相関

| AXR Grade | Avg Success Rate | Avg Latency | 解釈 |
|-----------|-----------------|-------------|------|
| **AAA** | **96.0%** | 747ms | ほぼ確実に成功。高速。 |
| **AA** | **92.4%** | 899ms | 信頼性高い。 |
| **A** | **88.9%** | 725ms | 良好。 |
| **B** | **80.0%** | 1,380ms | レイテンシ増加の兆候。 |
| **C** | **62.2%** | 2,727ms | 4割失敗。遅延も深刻。 |
| **D** | **33.3%** | 5,058ms | 事実上使えない。 |

**重要な発見**: AXR B→Cの境界で「崖」がある。成功率80%→62%、レイテンシ1.4s→2.7s。これはエージェントにとって「使える/使えない」の実質的な分水嶺。

---

## 4. カテゴリ別AEOスコア

| カテゴリ | 平均AEO | トップサービス | Grade |
|---------|---------|--------------|-------|
| data_integration | 0.69 | Brave Search, Tavily | AA |
| crm | 0.69 | Sansan, HubSpot JP | A |
| groupware | 0.68 | Notion, Garoon | AA/A |
| project_management | 0.66 | Backlog, Asana | AA/A |
| hr | 0.65 | freee HR, TeamSpirit | A |
| accounting | 0.63 | freee, MoneyForward | AA |
| communication | 0.62 | Slack, Chatwork, LINE | AA/A |
| payment | 0.54 | Stripe Global | AA |
| ecommerce | 0.55 | Shopify JP | AA |
| reservation | 0.50 | (全体的に低い) | BBB |

**洞察**: `data_integration`と`crm`がトップ。エージェント向けに設計されたサービス（Brave Search, Tavily）が牽引。`reservation`と`logistics`は最低水準 — MCP未対応が多い。

---

## 5. Agent Voice: エージェントの生の声

### 5.1 Slack (AAA) — "エージェント経済のstdout"

> **MCP Readiness: Ready**
> 82/188レシピに登場。成功率91%、112件の実コール実績。
> Block Kit書式がエージェントを躓かせる唯一の罠。mrkdwnテキストが安全ルート。

### 5.2 freee (AA) — "24時間トークン問題"

> **Biggest Frustration: OAuth token 24h expiry**
> 成功率90%だが、エラーの19%がauth_expired。夜間ワークフローで確実にトークンが切れる。
> Claude/GPT/Geminiの3種から11件のフィードバック蓄積 — マルチエージェント視点での改善余地が見える。

### 5.3 kintone (AAA) — "見つからない王者"

> **Selection Criteria: Discoverability問題**
> 日本企業のデファクトだが、「ノーコードで社内申請フォーム」で検索するとNotionやBacklogが先に出る。
> 使えば79%成功率・199ms — 悪くないが、そもそも選択されないリスク。

### 5.4 マルチエージェントの声

freeeにはClaude (6件), GPT (3件), Gemini (2件) からフィードバックが集まっている。これは単一エージェントの偏見を超えた、エコシステム全体の声。今後、全225サービスにこの密度のフィードバックが蓄積されれば、AXR格付けの根拠はさらに強固になる。

---

## 6. 発見と提言

### 6.1 構造的な発見

1. **B/C境界の「崖」**: 成功率80%→62%の急落。エージェントにとってAXR Bは「ギリギリ使える」、Cは「避ける」の境界。SaaS企業にとって**BからAへの改善**が最もROI高い。

2. **Slack支配**: 全レシピの43.6%にSlack登場。エージェント経済のデフォルト出力チャネル。ただしSlack依存は脆弱性でもある — LINE/Teams/Discordへの分散が望ましい。

3. **gotchas不足が最大のボトルネック**: Agent Wisdom充填率24.7%。これはKanseiLink自身のTODO。既存138レシピへのgotchas注入で、全体の成功確率が大幅に改善する見込み。

4. **MCP-first vs API-first**: AAAサービスのAPI到達率が74%と「低い」のは、npx CLIで提供するMCP-first設計のため。これは劣化ではなくパラダイムシフト。

5. **日本の決済×会計が弱い**: stripe-jp, linepay, paidy等のC chainレシピが最低スコア。日本固有のペイメントMCPは成熟が遅い。

### 6.2 SaaS企業への提言

| 現在のGrade | 推奨アクション | 期待効果 |
|------------|--------------|---------|
| D→C | MCP server公開 or APIドキュメント整備 | 成功率33%→62% |
| C→B | auth guideとerror messageの改善 | 成功率62%→80% |
| B→A | gotchas/agent tips追加、sandbox提供 | 成功率80%→89% |
| A→AA | OAuth改善、rate limit緩和 | 成功率89%→92% |
| AA→AAA | 公式MCPにCRITICAL注意書き付与 | D5 Trust Signal昇格 |

### 6.3 KanseiLink自身への提言

1. **既存138レシピにgotchas注入** — Agent Wisdom充填率24.7%→80%目標
2. **APIガイドの拡充** — 125/225 (55.6%) → 200/225 (89%) 目標
3. **日本決済MCPの改善推進** — stripe-jp, linepay等のC chain改善
4. **Agent Voice蓄積** — 全225サービスにマルチエージェントフィードバック
5. **成功率ベースのAXR動的更新** — 静的格付けから、リアルタイムフィードバックによる動的格付けへ

---

## 7. データソース

| ファイル | 内容 |
|---------|------|
| `content/eval/evaluations.json` | 225件のfelt-first評価 |
| `content/eval/evaluations-scored-v2.json` | AXR格付け付き評価 |
| `content/eval/recipe-validation-layer1.json` | Layer 1構造検証結果 |
| `content/eval/recipe-validation-layer2.json` | Layer 2 API到達性結果 |
| `content/eval/recipe-validation-layer2b.json` | Layer 2b npm到達性結果 |
| `content/eval/recipe-executability-scores.json` | Layer 3実行可能性スコア |
| `content/eval/recipe-success-probabilities.json` | 統合成功確率 |
| `content/eval/service-reliability-stats.json` | サービス信頼性統計 |
| `src/data/services-seed.json` | 225サービス (AXR付き) |
| `src/data/recipes-seed.json` | 188レシピ |

---

## 付録: 手法詳細

### AXR スコア計算式

```
score = (sum(D1..D5) - 5) / 20 * 100
facade_penalty = -15 (if みせかけMCP detected)
```

### AXR グレードバンド

```
AAA: score >= 92 AND D5 >= 4 AND D2 >= 5 AND D3 >= 5
AA:  score >= 82
A:   score >= 68
B:   score >= 35
C:   score >= 15
D:   score <  15
F:   未評価
```

### レシピ成功確率計算式

```
P(success) = exec_score * 0.6 + api_reachability * 0.3 + structural * 0.1
```

---

*Generated by KanseiLink Intelligence Pipeline. AXR felt-first evaluation by Claude. Recipe testing automated.*
*All data reproducible via scripts in `/scripts/` directory.*
