# KanseiLINK — Decision Log

> Append-only. Most recent at top. Never edit past entries; correct with
> a new entry that references the old one.
>
> This file is Tier 2: read **when your task touches a past decision**.
> Agent session ritual: after reading GOALS.md + STATE.md, if any
> decision in here is relevant to your current task, read that entry.

Format per entry:
```
## YYYY-MM-DD — [short title]
CONTEXT: why a decision was needed
DECISION: what was decided
REASON: why this option over alternatives
REVERSIBILITY: High / Medium / Low
COMMITS: git SHAs (if applicable)
OPEN: unresolved follow-ups
```

---

## 2026-04-24 — 250-Test Audit + 6-Action Remediation
CONTEXT: Ran a 250-test quality/health audit of the service registry (150 endpoint health checks, 60 search-quality queries, 40 classification spot-checks). Audit found: endpoint health 98.7% live (strong), search quality 73% good (acceptable), classification 30% verifiably correct (weak). Surfaced 1 dead endpoint, 4 clearly-wrong classifications, 2 coverage gaps (翻訳/動画配信), JP-query ranking bias (Slack winning "ECサイト"), and 2 high-usage/low-success services (Chatwork, SmartHR).
DECISION: Execute all 6 audit recommendations as a cohesive remediation:
  (1) archive lofder-dsers-mcp-product (404), mark Zapier auth_required;
  (2) reclassify 4 community repos: Confluence → Knowledge & Docs, Bifrost/Trace → AI & LLM, LeanKG → Developer Tools;
  (3) harden classifier with confidence field + insufficient-signal → "Other" downgrade for AI & LLM / DeFi & Web3 (historical over-assignment);
  (4) add 5 coverage-gap services: DeepL, Google Translate, Vimeo, EDI-ACE, AWS Backup;
  (5) add JP-native boost (+1.2 to relevance_score) when query is CJK — backfill jp-native tag on 27 known JP SaaS;
  (6) deep-dive Chatwork/SmartHR outcomes: append 3 new SmartHR tips from real agent workarounds (v2 endpoint preference, OAuth expiry, department-scoped pagination).
REASON: Audit surfaced the evidence base. Each action tied 1-to-1 to a specific finding in the report, keeping remediation scope focused (no drive-by changes).
REVERSIBILITY: High on all six — all DB updates are reversible via single UPDATE statements; code changes toggle-able.
COMMITS: (this commit)
OPEN: Action 2 could go further — 11 "no-signal" entries from section D deserve a human pass. Action 5 needs monitoring — the +1.2 JP boost might need tuning if it over-promotes weak JP entries. Chatwork "search miss" failures (10/24) suggest KanseiLink's own search needs further tuning beyond the JP boost — follow-up investigation needed.

## 2026-04-21 — Drop Reddit from 4/28 Launch Plan
CONTEXT: Reddit account u/Worth_Growth5807 accumulated 5 spam removals + 1 Reddit content-policy violation on r/ClaudeAI between 2026-04-07 and 2026-04-21 across 6 product-post attempts. Account is functionally blocked at platform level for product content. New Reddit account would require 3-month karma warm-up before another attempt.
DECISION: Remove Reddit entirely from the 4/28 launch plan. Replace with Zenn JP + Dev.to EN same-day publication to backfill. 5-channel launch: Hacker News (Show HN) + Product Hunt + Zenn + Dev.to + X.
REASON: Further Reddit attempts would escalate the shadow-ban risk without upside. Reddit was 1 of 6 launch channels — losing it reduces surface area but PH + HN remain the primary traffic drivers.
REVERSIBILITY: Low for this account; Medium via fresh account in 3 months.
OPEN: If KanseiLink goes viral on HN, consider fresh Reddit account in 5-6月 for community seeding. Stronger signal from launch success would survive Reddit filters.

## 2026-04-21 — Adopt 4-File Structure (GOALS / DECISIONS / STATE / HEALTH)
CONTEXT: Single-agent (Claude) was becoming the bottleneck. Context drift across sessions caused hours of rework weekly — e.g. today's Railway 0.20.1 misdiagnosis (I trusted a hardcoded version string), missing SaaS derivative dedupe (freee/freee-mcp registered as separate from freee). Michie raised the "scaling law of development overhead" framing from an X post: linear-overhead designs hit a quadratic wall, log-overhead designs stay tractable.
DECISION: Adopt four mandatory-read files at repo root:
  - GOALS.md (Tier 1, read always)
  - STATE.md (Tier 1, read always)
  - DECISIONS.md (Tier 2, read when touching past decisions)
  - HEALTH.json (machine-readable baselines, read by health-check agent)
Every squad SKILL.md must include a preamble: "Read GOALS.md + STATE.md + recall('KanseiLINK') from Linksee Memory before acting."
REASON: Converts agent overhead from linear-in-decisions to log-in-decisions. Matches patterns converging overseas (Harper Reed's spec-driven, Geoffrey Litt's context-as-code, Anthropic's narrow-handoff protocols). Applies to both human co-founder and agent — Michie's observation that "what's easy for Claude is also easy for human" informed the design.
REVERSIBILITY: High — stop reading the files if the overhead isn't paying off. No code change needed.
COMMITS: (this commit)
OPEN: Need 朝ダイジェスト agent to maintain STATE.md daily. Target May W2-3. Until then STATE.md is manually updated at end of each significant session.

---

## 2026-04-21 — Fuzzy Same-SaaS Dedupe in Crawler
CONTEXT: New JP discovery sources (shipped same day, commit 790e93f) surface repos like `freee/freee-mcp`, `nulab/backlog-mcp-server`, `openbnb-org/mcp-server-airbnb`. Old dedupe did exact repo_full_name matching only, so each would register as a NEW service row despite the canonical vendor (freee, backlog, airbnb) already existing in the DB.
DECISION: Two-layer dedupe:
  1. Exact match against service id/name/namespace (unchanged)
  2. Fuzzy: strip MCP affixes (`-mcp`, `-mcp-server`, `mcp-server-`, `mcp-`) from repo name, then check whether owner OR stripped-name matches an existing service id/name/namespace (using dash/underscore/concat variants, min length 3).
Report fuzzy hits in crawl summary with explicit reasons (e.g. "owner 'freee' matches existing service 'freee'").
REASON: Prevents duplicate rows for the same SaaS. Test with 10 known-derivative candidates caught 8/8 real collapses; 2 genuinely-new candidates correctly left in fresh pile.
REVERSIBILITY: High — toggle fuzzyHit branch off.
COMMITS: 33622e3
OPEN: Short owner names (e.g. owner "line" vs service id "line-messaging") don't collapse. Alias-map future fix when needed.

---

## 2026-04-21 — JP Discovery Sources (3 new crawler sources)
CONTEXT: Global MCP Registry + awesome-mcp-servers lists systematically miss Japanese SaaS vendors. Dify Japan announced on X, not via GitHub topic. freee, SmartHR, Cybozu etc. don't tag repos with `mcp-server` even when the repo IS one.
DECISION: Add three new sources to the daily crawler, running alongside existing github-topics + awesome-lists:
  1. `src/data/jp-watchlist.txt` — hand-curated file where Michie (or any agent) drops `owner/repo` lines as candidates are spotted on X/PRTIMES
  2. `zenn-jp` — polls zenn.dev/api/articles?topicname={mcp,modelcontextprotocol,claude}&order=latest, fetches article bodies, extracts github.com repo links (90-day window, anthropic/modelcontextprotocol owners filtered)
  3. `github-jp-orgs` — searches `org:X mcp in:name,description` across 20 known JP vendor orgs (freee, cybozu, smarthr, moneyforward, Sansan-inc, chatwork, nulab, line, rakuten, DifyJapan, etc.)
REASON: Structural moat. If global English crawlers don't surface JP SaaS MCPs, KanseiLINK becomes the de facto JP MCP registry by doing the work they don't do. Smoke test found freee-mcp (416★), line-bot-mcp (575★), nulab-backlog-mcp (174★), chatwork-mcp — none would have been caught otherwise.
REVERSIBILITY: High — disable any source in run.ts.
COMMITS: 790e93f
OPEN: PR TIMES scraper (P2, May mid-month). LinkedIn watchlist for enterprise signal (P3, June). X manual-watchlist flow (Michie spots → I add to file).

---

## 2026-04-21 — Category Classifier Refinement Layer
CONTEXT: Claude LLM classifier (claude-sonnet-4-5-20250929) was lazily bucketing anything MCP-adjacent into "AI & LLM" even when the service itself was unrelated. Examples in DB pre-fix: Alibaba Cloud Ops (should be Developer Tools), Airbnb (Location & Travel), Twitter (Media & Content), Alibabacloud DMS (Developer Tools), Kubernetes (Developer Tools), Dbt (Data & Analytics).
DECISION: Add `refineCategory()` post-processor that runs AFTER the LLM classifies. Deterministic brand/keyword rules:
  - cloud providers (aws/gcp/azure/alibaba/aliyun/tencent/etc) → Developer Tools
  - databases (mysql/postgres/redis/clickhouse/etc) → Data & Analytics
  - travel (airbnb/booking/uber/etc) → Location & Travel
  - payments (stripe/paypal/etc) → Finance & Accounting
  - social (twitter/youtube/instagram/etc) → Media & Content
  - messaging (slack/discord/line/etc) → Communication
Also tightened LLM prompt with explicit disambiguation ("AI & LLM is for dedicated AI platforms only — MCP-ness alone doesn't imply AI & LLM").
Retroactively applied via `scripts/reclassify-community.mjs` — fixed 20 existing community entries in DB.
REASON: LLM output alone is unreliable for taxonomy. Deterministic post-processor catches common mistake patterns cheaply. Sharpened UX on dashboard immediately.
REVERSIBILITY: High — disable REFINE_RULES application.
COMMITS: 29a068a
OPEN: Some rule-ordering edge cases (e.g. "Alibabacloud DMS" triggers Developer Tools rule first, but DMS is arguably more Data & Analytics). Re-visit rule priority if similar edge cases accumulate.

---

## 2026-04-21 — agent_voice_responses Table Moved to schema.ts + trust proxy=1
CONTEXT: Seed.ts has prepared statements that reference agent_voice_responses (for voice upsert). That table was historically created lazily inside `src/tools/agent-voice.ts` on first tool call. On fresh Railway volume (after persistent-volume reset), seed runs BEFORE any tool invocation, so the table didn't exist → seed transaction rolled back with "no such table: agent_voice_responses" → DB stayed at 0 services. Railway served an empty DB silently for days before Michie noticed rankings count was wrong. Secondary: express-rate-limit was logging `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` on every request because Railway edge proxy sends X-Forwarded-For but trust-proxy was unset (default false).
DECISION: Move `CREATE TABLE IF NOT EXISTS agent_voice_responses ...` into `initializeDb()` in `src/db/schema.ts`. Set `app.set("trust proxy", 1)` in `src/http-server.ts`.
REASON: Any table seed references MUST exist at initializeDb time — lazy init for seed-accessed tables is a production-breaking anti-pattern. Trust-proxy=1 (exactly one hop) is the safe default for Railway — `true` would let clients forge IPs.
REVERSIBILITY: Low — if reverted, DB empties on any volume reset. Keep.
COMMITS: 181f29c
OPEN: Audit other lazily-created tables for the same anti-pattern. Candidate audits: snapshot tables, agent_feedback, outcomes (last-checked 2026-03, likely fine but confirm).

---

## 2026-04-21 — Post-Seed MCP Infrastructure Cleanup
CONTEXT: Language SDKs (Python MCP SDK, Go MCP SDK, etc.), meta-tools (MCPJungle, inspector, awesome-mcp-servers), IDE tools (chrome-devtools-mcp, XcodeBuildMCP), and local-only tools (bear-notes-mcp, apple-books-mcp) were leaking into the services table from crawler runs. KanseiLINK is a SaaS-integration registry — these infra entries pollute the ranking surface.
DECISION: Pattern-based post-seed cleanup in `src/db/seed.ts` that NULLs axr_score + axr_grade + zeroes trust_score for rows matching INFRASTRUCTURE_NAME_PATTERNS. Runs on every boot after seedAll() completes. Also mirrored patterns into `src/crawler/pipeline/score.ts` as short-circuit to tier='reject' for future crawler runs.
REASON: Two-layer defense. Crawler score.ts prevents future infra from getting tier=auto-accept. Seed.ts post-cleanup handles already-seeded rows and anything slipping through. Running on every seed ensures consistency even if infra entries re-enter via seed JSON.
REVERSIBILITY: High — pattern list can be edited.
COMMITS: 617a4a6, 8b8a97f
OPEN: Weekly review of what got hidden to catch false positives (e.g. if a legit SaaS has "mcp" in its name). Not currently scheduled — add to 構造チェック agent when built.

---

<!-- Add new decisions above this line. Never edit existing entries;
     correct with a new entry that references the old one by date. -->
