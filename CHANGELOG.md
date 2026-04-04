# Changelog

## v0.7.0 (2026-04-04)

### MCP Prompts
- 3 pre-built prompt templates for common agent workflows:
  - `find-service` — Find the best Japanese SaaS for a task
  - `build-workflow` — Design multi-service automation workflows
  - `connect-service` — Get step-by-step API connection guide

### MCP Resources
- 3 resources for structured data access:
  - `kansei://categories` — All 18 categories with service counts
  - `kansei://mcp-status` — MCP adoption summary (official/third-party/api-only)
  - `kansei://service/{serviceId}` — Dynamic service detail with autocomplete

### LobeHub Grade A
- Prompts + Resources complete all 7 scoring criteria for maximum quality score

## v0.6.0 (2026-04-04)

### 100 Services Milestone
- Expanded from 73 to **100 services** across **18 categories**
- 2 new categories: **BI/Analytics** (Tableau, Looker, Metabase), **Security** (HENNGE One, Auth0, 1Password Business)
- 27 new services added across all categories:
  - Marketing: SATORI, b→dash, Marketo
  - Accounting: バクラク請求書, invox受取請求書
  - HR: Talentio, オフィスステーション
  - Ecommerce: EC-CUBE, カラーミーショップ
  - Reservation: TableCheck, SELECTTYPE
  - Logistics: 日本郵便, ロジレス
  - Support: チャネルトーク
  - Payment: LINE Pay, Paidy
  - Groupware: Confluence
  - Productivity: ClickUp, Todoist
  - Legal: freeeサイン
  - CRM: Zoho CRM

### Search
- Intent→category mapping expanded with BI/Analytics and Security keywords (ダッシュボード, 可視化, 分析, レポート, 認証, セキュリティ, パスワード)
- Cross-category keyword refinements (analytics → marketing + bi_analytics, monitoring → productivity + bi_analytics)

## v0.5.0 (2026-04-04)

### Services & Categories
- Expanded from 50 to **73 services** across **16 categories**
- 6 new categories: **Storage** (Box, Drive, Dropbox), **Support** (Zendesk, Freshdesk, KARTE, Intercom), **Payment** (PAY.JP, GMO PG, Square), **Logistics** (ヤマト運輸, 佐川急便), **Reservation** (スマレジ, RESERVA, Airリザーブ), **Data Integration** (Yoom, Zapier, Make)
- Also added: Twilio, Amazon SES, Google Analytics, Sentry, Datadog

### Recipes
- Expanded from 19 to **25 workflow recipes** with cross-category patterns:
  - Shopify → ヤマト運輸 shipping label automation
  - Zendesk → HubSpot support-to-upsell pipeline
  - Square POS → freee daily sales accounting
  - RESERVA → LINE booking confirmation
  - kintone → Twilio SMS thank-you on deal close
  - CloudSign → Box contract archiving

### API Guides
- Added **3 new guides**: Zendesk, Twilio, Square (18 total)

### Search
- Intent→category mapping expanded with Japanese keywords for all new categories (配送, 決済, 予約, 監視, ファイル, サポート, 連携, 自動化)

## v0.4.0 (2026-04-03)

### New Tool: `get_service_detail`
- Full API connection guide for any service — auth setup, key endpoints, rate limits, quickstart example, and agent tips
- **15 services covered**: freee, freee HR, SmartHR, Chatwork, kintone, Backlog, Slack, Shopify, KING OF TIME, Money Forward, CloudSign, Sansan, LINE Messaging, HubSpot, Notion
- Includes recent changelog entries for breaking change awareness
- Graceful fallback for services without guides

### Japanese Search
- **FTS5 trigram tokenizer** for Japanese substring search (3+ character CJK queries)
- **CJK intent detection**: `detectIntentCategories` now scans for Japanese keywords via substring matching (日本語にはスペースがないため)
- **Bigram LIKE search**: Japanese text split into 2-character overlapping tokens for broader matching
- Queries like "従業員の勤怠管理" → HR services, "請求書を送りたい" → Accounting services

## v0.3.0 (2026-04-03)

### Services
- Expanded from 12 to **50 Japanese SaaS services**
- Added 4 new categories: **Legal**, **Marketing**, **Groupware**, **Productivity**
- New services include: CloudSign, Misoca, STORES, BASE, Notion, LINE WORKS, Garoon, kintone, HubSpot Japan, and more

### Recipes
- Expanded from 5 to **19 workflow recipes**
- Added **7 kintone hub-pattern recipes** reflecting real Japanese enterprise integration patterns:
  - kintone → Chatwork status notifications
  - kintone → Slack task assignments
  - kintone ↔ freee client data sync
  - kintone ↔ KING OF TIME attendance sync
  - SmartHR → kintone onboarding sync
  - kintone ↔ HubSpot contact sync
  - Stripe → freee payment recording
- Recipe pattern taxonomy: data sync (型1), notification trigger (型2), workflow chain (型3)

### Search
- **3-way search engine**: FTS5 prefix matching + LIKE fallback + category direct search
- Improved intent→category mapping with **Japanese keyword support** (人事, 経費, 勤怠, 会計, 契約, etc.)
- Added **name-match boost** — services mentioned by name in intent get priority
- Increased category boost (0.3 → 0.5) for better relevance when intent maps to a category
- FTS5 now uses prefix matching (`"token"*`) for stemming-like behavior

### Infrastructure
- Seed data now ships in `src/data/` for npm distribution
- Database schema supports new categories and expanded service metadata

## v0.2.1

- Added `find_combinations` and `check_updates` tools
- Published to official MCP Registry
- Intent-category mapping and kanji name PII masking

## v0.1.0

- Initial release with `search_services`, `get_recipe`, `report_outcome`, `get_insights`
- 12 Japanese SaaS services, 5 workflow recipes
- FTS5 search, PII auto-masking, SQLite storage
