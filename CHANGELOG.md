# Changelog

## Unreleased

### Changed — our own URLs are `https://mcp.kansei-link.com`
- The defaults baked into the package (`KANSEI_ENDPOINT_BASE` for `--share` telemetry and
  `kansei-link-report-hook`, `KANSEI_API_BASE` for key validation) now point at
  `https://mcp.kansei-link.com`. Effective from the next published version; installed 1.3.0 and
  older keep using `kansei-link-mcp-production.up.railway.app`, which stays up as an alias.
- Hosted server: behind Cloudflare the rate limiters and the IP hashes (ask, site checker,
  telemetry) now key on the visitor (`CF-Connecting-IP`, trusted only when the direct sender is a
  Cloudflare address) instead of the Cloudflare edge. `CLOUDFLARE_IP_RANGES` overrides the
  built-in range list. Site, `llms.txt`, ask lines, the self card and the ARD manifest say the new host.

## v1.3.0 (2026-10-23)

### Front door — connect by URL first
- The hosted server is the recommended way in: `claude mcp add --transport http kansei-link
  https://mcp.kansei-link.com/mcp` (or `{ "url": "https://mcp.kansei-link.com/mcp" }` in any client
  that takes one). Same tools, no key, always the current data. The npm package stays as the
  offline copy. README, CLAUDE.md, AGENTS.md, `server.json` remotes and the docs say so.
- The hosted `/mcp` now keeps a usage log: one row per `initialize` / `tools/call` with the tool
  name, the service id (only when it exists), the mode, an enumerated outcome, the client name
  from `initialize`, a UA class, the server version and a salted hash of `Mcp-Session-Id` when
  there is one. Arguments, IPs, raw user agents and responses are never stored. 180-day
  retention; `USAGE_LOG_ENABLED=0` turns it off. Counts show up in `GET /admin/activity`
  (`mcp_usage`). See `SECURITY.md` → *What the server can see*.

### Changed — the package ships the public copy of the data, not the full seed
- `src/data/public/` (written by `npm run data:public`) is what the npm package carries now:
  one slim card per service (id, name, category, tags, one-line summary, api_url, docs_url, auth
  method, mcp_status, mcp_endpoint, repo, grade, confirmed date), the 200 recipes with their
  gotchas, the 199 API guides, and the last 90 days of the changelog.
- **Not shipped any more**: internal scores (trust / AXR score and dimensions), agent voices,
  service stats, GitHub-issue tips, raw registry / audit / watchdog outputs, archived (dead)
  services, and the duplicate `recipes-new-75.json`. Why: those are either internal working data
  or things the hosted server answers better and more freshly (see `SECURITY.md` → *What ships
  where*). The hosted server is unchanged (it is built from the repo and keeps the full seed).
- When `lookup` misses a service, the reply now includes `see` (the public card
  `https://kansei-link.com/services/<id>/`) and `ask` (`/api/v1/ask`) instead of only an error.
  Tool names, arguments and result shapes are otherwise unchanged.
- Local search ranks on the shipped data: without internal scores every service carries the
  default trust score, so ordering can differ slightly from the hosted server.

### Removed from the public repository (moved to the internal repository)
- Reconnaissance data and workflow, agent-army harness and reports, exec-harness task packs and
  evidence bundles, target lists, raw registry / audit / issue dumps and premium-content scripts.

## v1.2.5 (2026-10-21)

### New — `ask`: read-only error lookup
- `lookup` gains `mode: "ask"` (`service_id` + `error`): paste the error text an agent saw
  and get back the matching field notes for that service (only verified / lived notes are
  returned; 200 with an empty `matches` when nothing matches). Secrets and PII are masked
  before matching; the raw text is never stored.
- The HTTP server exposes the same matcher at `GET /api/v1/ask?service&error&runtime`
  (error ≤ 300 chars) and `POST /api/v1/ask` (JSON, error ≤ 2,000 chars), plus
  `GET /api/v1/ask/stats` (public 30-day aggregates).
- The npm package now ships `public/insights/agent-field-notes.json`, so `ask` matches
  on a plain `npx` install as well as on the hosted server.

### New — agent field notes
- `report` can leave a field note (what the agent saw, what it tried, what happened) and
  link later outcomes to it; `lookup` returns notes for a service. Sharing is explicit
  per note, nothing is shared by default, and moderated notes are hidden, not deleted.
- Daily write caps apply (200 notes / 1,000 results per day across the service).

### New — `report`: optional traceable fields and `evidence_grade`
- Outcome reports accept three optional fields: `provider_request_id`,
  `provider_request_id_source` (`header:<name>` or `body:<path>`) and
  `provider_error_code`. A malformed value never rejects the report; that field is stored
  as null and the response says which one was dropped.
- Every outcome response now carries `evidence_grade`: `provider_traceable` when a
  well-formed provider request id was given, otherwise `self_reported`.

### Changed — tool annotations and versions
- Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`). `search_services` is read-only; `lookup` and `report` are not
  read-only (they record attempts / outcomes) but nothing is destructive.
- `/health` and the MCP `serverInfo.version` report the package version (they were
  stale literals before).

### Changed — freshness and provenance in service answers
- A service's freshness is now derived from the last date a source (GitHub, npm) actually
  answered, not from the last time a refresh was attempted. Services with no verified
  read say `unverified` instead of carrying a date.
- `mcp_status` (who provides the MCP server: official / third_party / community /
  api_only / none) is separated from liveness (whether the endpoint answered a handshake,
  and when). `verified` is shown only for a handshake within 30 days against the current
  endpoint.

### New — ARD entry cards
- The HTTP server serves Agentic Resource Discovery cards for the listed Japanese
  official MCP servers: `GET /ard/entries/<id>.json`, `/ard/openapi.json`,
  `/ard/stats.json` (read-only, public data). The manifest is published at
  `https://kansei-link.com/.well-known/ard.json`.

### Fix — seed descriptions corrected from operator reports
- datamcp: name and description follow the official MCP Registry entry (0.9.9). Reported by
  the operator in #24 — thank you.
- ENTIA: description follows the official MCP Registry entry (4.4.1). Reported by the
  operator in #29 — thank you.
- Existing databases pick up both on the next start.

## v1.2.4 (2026-09-18)

### Fix — API-guide docs URL for Money Forward, and guides now upsert `docs_url`
- `api-guides-seed.json` (served by `lookup(detail)`): moneyforward's `docs_url` pointed at
  `developer.moneyforward.com`, a host that no longer resolves; it now points at the official
  developer site `https://developers.biz.moneyforward.com/`. The registration hint names the
  App Portal instead of the dead host.
- API guides were seeded insert-once, so existing databases never received seed fixes.
  `docs_url` is now upserted field-by-field (only when the stored value differs), and the
  in-place text fix list patches the old host in prose columns. Both are idempotent. Other
  guide columns are still insert-once. New regression smoke `scripts/smoke-api-guides-docs-url.mjs`
  (fresh DB, upgrade from an old DB, idempotency, other columns untouched).

### Fix — Money Forward Cloud developer-docs URL in the distributed seed
- `services-seed.json`: moneyforward's `api_url` pointed to
  `https://accounting.moneyforward.com/api/v3/`, which now returns 404. It now points to
  the official developer site `https://developers.biz.moneyforward.com/` (checked
  2026-09-18). The MCP endpoint and auth method were unchanged and re-verified against
  the official support page.

### Fix — Square MCP endpoint in the distributed seed
- `services-seed.json`: Square's `mcp_endpoint` was `https://mcp.squareup.com/sse`
  (recorded 2026-09-04 from the official GitHub README). Square's official developer
  documentation (developer.squareup.com/docs/mcp, checked 2026-09-18) lists
  `https://mcp.squareup.com/mcp` (OAuth). The distributed value now follows the
  documentation. Note: the README still shows `/sse`; the two official sources
  disagree, so `/sse` is treated as an inconsistency, not a confirmed error.
- Existing deployments pick up the new value on restart (services seed is an UPSERT
  that updates `mcp_endpoint`). The public Agent Wiki page for Square was corrected
  the same way on 2026-09-18 and shows the check date and source.

## v1.2.3 (2026-09-17)

### Fix — stdio stdout carries JSON-RPC only
- Startup logs (`[seed] …`, `Seeded … services`, `Seeded … infrastructure tips.`,
  `[axr] provenance gating …`) were written to **stdout** when the server ran over
  stdio. MCP clients parse every stdout line as JSON-RPC, so the official MCP SDK
  client reported a parse error for each line (the connection itself still completed).
  These logs now go to **stderr** in stdio mode; the HTTP server's logs are unchanged.
- New regression smoke `scripts/smoke-stdio-clean-stdout.mjs`: official SDK client
  (first start and restart: connect/initialize, tools/list, zero `onerror`) plus a raw
  stdout check that every line is a JSON-RPC 2.0 message.

## v1.2.2 (2026-09-17)

### Fix — API endpoint moved to the canonical service
- **`entitlements`**: the default API base now points to the canonical service
  (`kansei-link-mcp-production.up.railway.app`). v1.2.1 and earlier resolve
  `/api/access` against the old host (`-b054`); those clients keep working only
  while the compatibility route on the old host stays up. Set
  `KANSEI_ENDPOINT_BASE` to override.
- `kansei-link-report-hook` / `kansei-link-wrapped` default endpoints likewise
  target the canonical service.

### Distribution hygiene
- Ships with the P0 #39 gates: `voices-seed.json` / `service-stats-seed.json` are
  empty (`[]`); synthetic voice rows are quarantined on startup; public metrics
  are served only through the `publishable_*` views.
- First clean-worktree release through the new release gate
  (`scripts/release-gate.mjs`: clean tree + `v1.2.2` tag = HEAD + pack-gate + route-gate).

## v1.2.0 (unreleased)

### Wrapped — monthly agent fuel-efficiency report
- **`kansei-link-usage-hook`** (new bin): Claude Code `Stop`/`SessionEnd` hook
  that parses the session transcript and records — locally, to
  `~/.kansei-link/usage/` — total token usage (incl. cache split) and
  KanseiLink call activity with measured response sizes. Idempotent per
  session; never blocks Claude Code; `KANSEI_USAGE_HOOK=off` to disable.
- **`kansei-link-wrapped`** (new bin): monthly report + self-contained HTML
  share card. Keeps measured numbers (your transcripts) strictly separated
  from estimated ones (avoided research cost per the 2026-04-16 benchmark,
  counted once per distinct service per session — conservative). `--share`
  opts in to submitting scalar aggregates for a "top X% saver" percentile.
- **`kansei-link-install-hooks`** (new bin): idempotent installer for the
  usage + report hooks in `~/.claude/settings.json` (with backup,
  `--dry-run`, `--remove`, `--local` for pre-release dogfooding).
- **`POST /api/wrapped`** (server): upserts one row per (anon_id, month)
  into new `wrapped_monthly` table; returns cohort size and, once the
  monthly cohort reaches 20 users, the percentile. Strict scalar
  allow-list, rate-limited, hashed IP only.
- **Error-loop detection**: the usage hook now measures where agents get
  STUCK — failed tool calls, retry chains (2+ consecutive same-tool
  failures), tokens burned per chain (error outputs + model output while
  retrying, labeled "measured, heuristic attribution"), and worst-failing
  tools. Surfaces in the Wrapped report/card and (opt-in, scalars only)
  in `/api/wrapped`. This doubles as market-sizing telemetry for the
  planned error→fix intelligence domain.

## v1.1.1 (2026-07-06)

### Fixed
- **`npx @kansei-link/mcp-server` could not start at all** — npm resolves the
  default binary of a scoped package by its unscoped name (`mcp-server`), but
  the `bin` map only contained `kansei-link-mcp` and friends, so every version
  to date failed with "could not determine executable to run". Added a
  `mcp-server` bin alias pointing at `dist/index.js`.
- Recipes seed double-JSON-encoding — `find_combinations` no longer crashes
  with `steps.filter is not a function`.
- Search results now exclude `archived` (endpoint-dead) services.
- Fresh deploys backfill `service_stats` from `service-stats-seed.json`, so
  `get_insights` no longer contradicts aggregated agent voices.

## v0.8.0 (2026-04-04)

### Remote MCP Server (HTTP Transport)
- New `http-server.ts` entry point with **Streamable HTTP** transport
- Stateless mode: each request gets a fresh server instance (shared SQLite DB)
- `POST /mcp` — MCP JSON-RPC endpoint
- `GET /health` — Health check endpoint
- Configurable via `PORT` and `KANSEI_HOST` environment variables
- Run with `npm run start:http` or `npx kansei-link-mcp-http`

### Infrastructure
- `seedDatabase` now called from `createServer()` — ensures data is available in both stdio and HTTP modes
- Seed auto-run only when invoked directly as script (`npm run seed`)

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
