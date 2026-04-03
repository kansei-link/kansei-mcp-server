# Changelog

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
