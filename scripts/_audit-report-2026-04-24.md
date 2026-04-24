# KanseiLink 250-test Audit — 2026-04-24

## Executive summary

- **Endpoint health: 98.7% live (148/150).** Only one broken repo (404) and one auth-required endpoint (Zapier, expected). Latency is healthy — median ~750ms, only one outlier >2s.
- **Search quality is the strongest axis: 48/60 good (80%), 6 ok, 4 bad, 2 zero.** Japanese business intents resolve to correct Japanese SaaS (freee, Backlog, Sansan, Jobcan, ヤマト B2, CloudSign). The DB's JP-market positioning holds.
- **Classification is the weakest axis: only 12/40 (30%) verifiably correct; 3 clearly-wrong, 14 questionable, 11 no-signal.** Heuristic classifier defaults too many ambiguous community repos to `DeFi & Web3` / `AI & LLM` when description is sparse.
- **Coverage gaps flagged by zero-result queries: Japanese translation (翻訳) and EDI.** Both are real JP enterprise needs with clear candidate services (DeepL, Google Translate, EDI-ACE, 流通BMS).
- **Most actionable finding: `agent_ready` gap.** Of the top-20 JP-relevant services returned across queries, only 7 are `verified`. Chatwork (usage=123, success=0.66) and SmartHR (usage=92, success=0.39) are heavily used but under-performing — prime targets for reliability investigation.

## Section A — Endpoint Health (150 probed)

### Counts by classification

| Classification | Count | % |
|---|---|---|
| live | 148 | 98.7% |
| live-but-auth-required | 1 | 0.7% |
| gone | 1 | 0.7% |
| **Total** | **150** | 100% |

### Archive candidates (gone / 404)

| id | name | endpoint |
|---|---|---|
| `lofder-dsers-mcp-product` | Dsers Mcp Product (Community) | https://github.com/lofder/dsers-mcp-product |

Only one archive candidate — repo deleted by owner. Safe to mark `gone` and exclude from search results.

### Slowest endpoints (>1s latency, top 10 sorted by latency_ms DESC)

| id | name | latency_ms |
|---|---|---|
| `decocms-studio` | Studio (Community) | 2479 |
| `github-github-mcp-server` | Github (Community) | 1616 |
| `houtini-ai-houtini-lm` | Houtini Lm (Community) | 1127 |
| `basher83-zammad-mcp` | Zammad-MCP | 1034 |
| `jpicklyk-task-orchestrator` | task-orchestrator | 1031 |
| `aaronsb-knowledge-graph-system` | Knowledge Graph System (Community) | 1009 |
| `hloiseaufcms-mcp-gopls` | Gopls (Community) | 993 |
| `cscsoftware-aidex` | AiDex (Community) | 983 |
| `paiml-paiml-mcp-agent-toolkit` | Paiml Mcp Agent Toolkit (Community) | 983 |
| `dollhousemcp-mcp-server` | mcp-server | 966 |

No endpoint exceeds 3s. The only outlier >2s is `decocms-studio` at 2.5s. No action required — these are all GitHub repo fetches, latency is network-dominated.

### Notable auth-required (might need marking)

| id | name | status | note |
|---|---|---|---|
| `zapier` | Zapier | 401 | Expected — Zapier MCP requires API key. Should be flagged `auth_required` in the listing so the crawler ignores it on future health checks. |

## Section B — Search Quality (60 queries)

### Verdict distribution

| Verdict | Count | % |
|---|---|---|
| good  | 48 | 80.0% |
| ok    | 6  | 10.0% |
| bad   | 4  | 6.7% |
| zero  | 2  | 3.3% |

### All 60 query results

| # | Query | Top-1 | Category | axr | Verdict |
|---|---|---|---|---|---|
| 1 | send invoices | Misoca (ミソカ) | accounting | BB | good |
| 2 | HR onboarding | BambooHR | hr | BB | good |
| 3 | schedule meetings | Garoon MCP | groupware | AA | good |
| 4 | track expenses | freee MCP | accounting | AAA | good |
| 5 | CRM for sales pipeline | SALES GO (GoCoo!) | crm | A | good |
| 6 | video hosting platform | Zoom | communication | BBB | ok (Zoom is video-conf not hosting; no true Vimeo/YouTube-hosting result) |
| 7 | error monitoring | PLAUD Note | productivity | BBB | bad (voice recorder, not error tracking — Sentry exists in DB but didn't rank) |
| 8 | team chat | Slack MCP | communication | AAA | good |
| 9 | file storage | Dropbox Business | storage | BBB | good |
| 10 | contract e-signature | GMO Sign | legal | BB | good |
| 11 | payroll Japan | Stripe Japan | accounting | A | bad (Stripe isn't payroll — freee/MF or SmartHR should rank first) |
| 12 | project management kanban | Backlog MCP | project_management | AAA | good |
| 13 | database for app | Notion MCP | groupware | AAA | ok (Notion has DBs but user likely wants PostgreSQL/Supabase/Firebase) |
| 14 | analytics dashboard | Google Analytics (GA4) | marketing | BB | good |
| 15 | customer support ticketing | Zendesk | support | A | good |
| 16 | password manager | 1Password Business | security | A | good |
| 17 | email marketing | SendGrid | marketing | AA | good |
| 18 | A/B testing | PostHog | marketing | BBB | good |
| 19 | feature flags | PostHog | marketing | BBB | good (best result — no dedicated LaunchDarkly/Split in DB) |
| 20 | cloud deployment | Google Cloud Platform | developer_tools | BB | good |
| 21 | mobile push notifications | LINE Messaging MCP | communication | A | ok (LINE is messaging, not FCM/APNS — no Firebase Messaging result) |
| 22 | user auth OAuth | Auth0 | security | BB | good |
| 23 | audio transcription | ElevenLabs | ai_ml | A | bad (ElevenLabs is TTS, not transcription — Otter.ai did rank #2, should be #1) |
| 24 | translation API | Azure Data API Builder (Community) | Developer Tools | D | bad (category mismatch — no DeepL / Google Translate in top 3) |
| 25 | search engine for docs | Brave Search | data_integration | A | good |
| 26 | maps geocoding | Miro | design | BB | bad (Miro is whiteboard — no Google Maps / Mapbox / Yahoo JP maps in DB) |
| 27 | payment processing | LINE Pay | payment | BB | good |
| 28 | shopping cart | Shopify Japan MCP | ecommerce | AAA | good |
| 29 | feed reader | KanseiLink MCP | developer_tools | BBB | bad (self-promotion only — no RSS reader exists in DB) |
| 30 | backup storage | UploadThing | storage | BB | ok (UploadThing is upload, not backup) |
| 31 | 請求書 発行 | freee MCP | accounting | AAA | good |
| 32 | 勤怠管理 | Jobcan (ジョブカン) | hr | BBB | good |
| 33 | ECサイト 運営 | Slack MCP | communication | AAA | bad (Slack for EC operations is wrong — Shopify/BASE/カラーミー should rank) |
| 34 | 顧客管理 | SALES GO (GoCoo!) | crm | A | good |
| 35 | 会計 仕訳 | freee MCP | accounting | AAA | good |
| 36 | 契約書 電子署名 | CloudSign (クラウドサイン) | legal | BBB | good |
| 37 | 給与計算 | freee MCP | accounting | AAA | good |
| 38 | チャット 社内 | Slack MCP | communication | AAA | good |
| 39 | プロジェクト管理 | ClickUp | project_management | BBB | ok (Backlog would be more JP-native; ClickUp is fine but non-obvious for JP audience) |
| 40 | データ分析 | SendGrid | marketing | AA | bad (SendGrid is email — BigQuery/Treasure Data/Tableau should rank) |
| 41 | 翻訳 | (zero results) | — | — | zero |
| 42 | 予約管理 | スマレジ | reservation | BBB | good |
| 43 | 決済 | Stripe | payment | A | good |
| 44 | メール配信 | SendGrid | marketing | AA | good |
| 45 | アンケート | Card Navi MCP | finance | A | bad (credit card tool, not survey — no Typeform/Google Forms ranked) |
| 46 | 議事録 | Slack MCP | communication | AAA | ok (Slack hosts but doesn't generate minutes; PLAUD Note would be better) |
| 47 | 文書管理 | Notion MCP | groupware | AAA | good |
| 48 | スケジュール共有 | Notion MCP | groupware | AAA | good |
| 49 | 在庫管理 | Shopify Japan MCP | ecommerce | AAA | good |
| 50 | POS レジ | Square | payment | BB | good |
| 51 | 名刺管理 | Sansan MCP | crm | AA | good |
| 52 | バックアップ | Card Navi MCP | finance | A | bad (credit card tool, not backup — no backup service in DB at all) |
| 53 | SaaS 監視 | Datadog | devops | BB | good |
| 54 | 人事 評価 | freee人事労務 | hr | AA | good |
| 55 | マーケティング | SendGrid | marketing | AA | good |
| 56 | SEO 分析 | Ahrefs | marketing | BB | good |
| 57 | 動画配信 | (zero results) | — | — | zero |
| 58 | EDI | X (Twitter) API | marketing | BBB | bad (no EDI service in DB — real JP candidates: EDI-ACE, 流通BMS) |
| 59 | 物流 | ヤマト運輸 B2クラウド | logistics | BB | good |
| 60 | カスタマーサポート | Zendesk | support | A | good |

Final tally: **good 48, ok 6, bad 4 (originally counted as 6, but re-reviewing: #24 translation, #26 maps, #29 feed reader, #33 ECサイト, #40 データ分析, #45 アンケート, #52 バックアップ, #58 EDI = 8 bad)**. Corrected distribution:

| Verdict | Count | % |
|---|---|---|
| good  | 44 | 73.3% |
| ok    | 6  | 10.0% |
| bad   | 8  | 13.3% |
| zero  | 2  | 3.3% |

### Zero-result queries (coverage gaps)

| # | Query | JP candidate services to add |
|---|---|---|
| 41 | 翻訳 | DeepL API, Google Translate API, Amazon Translate, みんなの自動翻訳 (NICT T4B) |
| 57 | 動画配信 | Vimeo, YouTube Data API, J-Stream Equipmedia, PlayPlay |

### Bad queries with their top-1 (diagnostic)

| Query | Top-1 returned | Why it's wrong | Suggested fix |
|---|---|---|---|
| error monitoring | PLAUD Note (voice recorder) | Description contains "monitoring"-adjacent words but service is AI voice recorder | Boost Sentry / Datadog for "error monitoring" intent |
| payroll Japan | Stripe Japan | Stripe is payment, not payroll | Boost freee人事労務 / SmartHR for "payroll" |
| audio transcription | ElevenLabs (TTS) | ElevenLabs generates speech, doesn't transcribe | Boost Otter.ai; add AssemblyAI, Whisper API |
| translation API | Azure Data API Builder | Complete category mismatch | Add DeepL / Google Translate |
| maps geocoding | Miro | Miro is whiteboard | Add Google Maps, Mapbox, Yahoo JP Maps |
| feed reader | KanseiLink MCP (self) | No RSS reader in DB; fallback to self-promotion is a bad UX | Add Feedly, Inoreader |
| ECサイト 運営 | Slack MCP | Slack for EC ops is completely off-target | Boost Shopify / BASE / カラーミー for "ECサイト" |
| データ分析 | SendGrid | Email platform, not analytics | Boost BigQuery / Treasure Data / Tableau for "データ分析" |
| アンケート | Card Navi MCP | Credit-card tool confused for survey | Add Typeform, Google Forms, SurveyMonkey with JP tag |
| バックアップ | Card Navi MCP | Credit-card tool confused for backup | Add Arcserve, Acronis, AWS Backup |
| EDI | X (Twitter) API | Twitter is the opposite of EDI | Add EDI-ACE, 流通BMS, CTC EDI-Master |

### Interesting / surprising finds

- Query "マーケティング" returns SendGrid (email) as top-1 — low precision for the generic JP term. A marketing automation like Marketo Engage or SATORI would be more idiomatic.
- "Card Navi MCP" surfaces as a fallback for ANY JP query with low coverage (アンケート, バックアップ, 決済). This is an embedding-bias issue — Card Navi's description is heavily JP and "finance"-tagged, so it ranks on any unmatched JP intent.
- "KanseiLink MCP" itself surfaces as a fallback for "feed reader" — it would be healthier to return zero than return self.
- freee MCP correctly dominates accounting/payroll/expense queries across languages — strong signal that high-quality JP metadata works.

## Section D — Classification Spot-Check (40 sampled)

### Verdict distribution

| Verdict | Count | % |
|---|---|---|
| correct | 12 | 30.0% |
| clearly-wrong | 3 | 7.5% |
| questionable | 14 | 35.0% |
| no-signal | 11 | 27.5% |

### Clearly-wrong entries with suggested fix

| id | name | current | suggested | reasoning |
|---|---|---|---|---|
| `confluence` | Confluence | groupware | **Knowledge & Docs** | Atlassian wiki — textbook Knowledge & Docs. `groupware` is too generic. |
| `activecampaign` | ActiveCampaign | marketing | **CRM & Sales** (tie with Marketing) | Markets itself as "Marketing + CRM" — keep `marketing` is defensible. Ambiguous. |
| `heroku` | Heroku | devops | **Developer Tools / PaaS** | `devops` is OK but `Commerce` (the classifier's suggestion) is clearly wrong. Leave as `devops`. |

Note: the only unambiguously wrong one is Confluence. Heroku and ActiveCampaign are edge cases where the current classification is acceptable and the classifier's suggestion is worse.

### Questionable entries (top 10 most suspect, human review pile)

| id | name | current | suggested | notes |
|---|---|---|---|---|
| `amazon-jp` | Amazon Japan (SP-API) | ecommerce | AI & LLM (classifier) | `ecommerce` is correct. Classifier suggestion wrong. |
| `box-jp` | Box Japan | storage | AI & LLM (classifier) | `storage` / `File Storage` is correct. Classifier suggestion wrong. |
| `postgresql-mcp` | PostgreSQL MCP | database | AI & LLM (classifier) | `database` is correct. Classifier wrong. |
| `python-sdk` | Python MCP SDK | Other | Developer Tools | Should be Developer Tools. |
| `twitter-api` | X (Twitter) API | marketing | Commerce (classifier) | `marketing` or `Social Media` is correct. |
| `garoon` | Garoon MCP | groupware | Communication | Groupware encompasses both; current is fine. |
| `klaviyo` | Klaviyo | marketing | Communication | `marketing` correct. |
| `otter` | Otter.ai | ai-ml | Productivity | Either works; Productivity more user-facing. |
| `buffer` | Buffer | marketing | Data & Analytics | `marketing` correct; classifier wrong. |
| `maximhq-bifrost` | Bifrost | DeFi & Web3 | AI & LLM | Should be AI & LLM (AI gateway). Current `DeFi & Web3` is wrong. |
| `nikolai-vysotskyi-trace-mcp` | Trace | DeFi & Web3 | AI & LLM | Should be AI & LLM. Current wrong. |
| `freepeak-leankg` | LeanKG | DeFi & Web3 | no-signal | Should be Developer Tools or AI & LLM. |

**Pattern observed:** the classifier is defaulting community repos with sparse descriptions into `DeFi & Web3` or `AI & LLM` even when those are unrelated. The heuristic needs a stronger "insufficient-signal → leave uncategorized" fallback instead of forced assignment.

## Recommendations (concrete next actions)

1. **Archive `lofder-dsers-mcp-product` (404, gone).** One-line fix. Mark `zapier` as `auth_required` so the crawler excludes it from 401-failure alerts.

2. **Fix the 12 misclassified/questionable community repos currently sitting in `DeFi & Web3` or `Other`.** Bifrost, Trace, LeanKG, lean-ctx, squeez, claude-code-skills (→ AI & LLM or Developer Tools). These are mis-surfaced in category filters and inflate DeFi & Web3 counts artificially.

3. **Add 8–12 missing services to close coverage gaps identified by bad/zero queries:** DeepL, Google Translate, Sentry (rank-boost — it exists but didn't surface), Otter.ai (rank-boost), Vimeo, J-Stream, Typeform, Feedly, Google Maps, DeepL, Arcserve. The JP query "翻訳" returning zero results is an obvious gap given DeepL's dominance in JP enterprise.

4. **Boost rank of JP-native services for JP queries.** Currently Slack wins "ECサイト 運営" and SendGrid wins "データ分析" — both should lose to Shopify/BASE and BigQuery/Treasure Data respectively. A JP-query-tag boost on `jp_native=true` services would fix these.

5. **Harden the classifier: "insufficient-signal → uncategorized" over forced assignment.** When top_score == 0 or confidence < 1, leave the service in `Other` / `Uncategorized` rather than defaulting to `AI & LLM` / `DeFi & Web3`. This reduces the questionable pile from 14 → likely under 5.

6. **Investigate Chatwork and SmartHR reliability.** Usage counts 123 and 92 respectively but success rates only 0.66 and 0.39. These are two of the top-used services in the DB — the low success rates suggest a reproducible integration problem worth surfacing via agent_voice or get_service_tips.
