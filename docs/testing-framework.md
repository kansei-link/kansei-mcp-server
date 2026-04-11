# KanseiLink 225-Service Testing Framework

**Version:** v1 (2026-04-10)
**Status:** Active — Phase 1 scaffolding complete
**Owner:** KanseiLink editorial / engineering

---

## Purpose

Before real-world AI agents start exercising KanseiLink in production, we need
internal usage data to:

1. **Validate the 15 MCP tools end-to-end** against all 225 services (not just
   the 10-20 most popular).
2. **Generate realistic `outcomes` and `agent_voice` data** so the first
   consulting reports have ground truth to analyze — not an empty DB.
3. **Discover quality gaps** in services-seed.json before agents hit them:
   - Missing recipes
   - Missing API guides
   - Wrong categories
   - Incorrect `mcp_status` / `api_auth_method`
   - Services that never surface in search despite being relevant
4. **Find the weak and the strong** — surface the services with best / worst
   API quality, auth ergonomics, rate-limit clarity, and error messages.
5. **Dogfood** — catch bugs in KanseiLink's own tools (search ranking, recipe
   coverage, confidence scoring) before external agents do.

## Guiding principle

> "We are the first, hardest, and most honest agent KanseiLink will ever have."

No flattering test data. No synthetic success rates. If a service has a messy
auth flow, we record that. If `search_services` misses a query that should
obviously return X, we log it as a bug and fix the ranker.

---

## Service tiers

| Tier | `mcp_status` | Count | Test depth |
|------|--------------|-------|------------|
| T1 | `official`   | 33    | Full battery (7 tools × 3 intents each) |
| T2 | `third_party`| 41    | Reduced battery (5 tools × 2 intents) |
| T3 | `api_only`   | 148   | Minimal (search + detail only) |
| T4 | `none`       | 3     | Mark as known-gap; don't test |

Total tool invocations in a full pass ≈ **33 × 21 + 41 × 10 + 148 × 2 = 1,399 calls**.
All calls are local SQLite + in-memory logic — no external API traffic, no cost.

## Test battery per tier

### T1 — Official MCPs (33 services, full battery)

Each service runs through this sequence:

1. **Discovery test** — 3 intent queries that should surface the service via
   `search_services` (JP + EN + vague).
   - Pass: service appears in top 5.
   - Fail: service not in results. Logged as SEARCH_MISS.

2. **Detail test** — `get_service_detail(service_id)` returns:
   - `auth_method` matches DB's `api_auth_method`
   - `rate_limit` is non-empty
   - `mcp_endpoint` non-empty
   - `quickstart` non-empty
   Missing fields logged as DETAIL_GAP.

3. **Recipe test** — `find_combinations(service_id)` returns ≥ 1 recipe.
   Zero recipes logged as RECIPE_GAP.

4. **Tips test** — `get_service_tips(service_id)` returns ≥ 1 tip.
   Zero tips logged as TIPS_GAP.

5. **Design evaluation** — `evaluate_design` with 4-axis scoring based on
   fields available in services-seed.json:
   - docs quality (proxy: has api_url + auth_method + rate_limit)
   - auth ergonomics (proxy: oauth2 > api_key > none)
   - error clarity (default neutral, requires real API call)
   - rate limit transparency (proxy: rate_limit field non-empty)

6. **Synthetic outcome** — `report_outcome` with a realistic test scenario:
   ```
   context: "Dogfood test — {service_id} discovery and recipe integration"
   success: true (if all above passed) / false (if any T1 test failed)
   latency_ms: synthetic based on auth method complexity
   estimated_users: 1 (this is a single-agent test pass)
   ```

7. **Agent voice** — `agent_voice` entry for 3 question categories:
   - `selection_reason`
   - `biggest_frustration` (based on detected gaps)
   - `recommendation_confidence`
   Agent type: `claude`, marked as `dogfood_v1` for later filtering.

### T2 — Third-party MCPs (41 services, reduced battery)

Steps 1–5 from T1. Skips synthetic outcomes + voices (those are for services
we've "dogfooded deeply"). Logs same gap categories.

### T3 — API-only (148 services, minimal)

- Step 1 (Discovery): 1 intent query, expects service in top 10.
- Step 2 (Detail): sanity check that detail returns.

Designed to catch catastrophic DB issues (service missing from search, broken
category mapping) without flooding the outcomes table.

### T4 — Known-gap (`none`, 3 services)

Not tested. Logged for inclusion in the "not-yet-ready-for-agents" report.

---

## Output artifacts

Each test run writes to `content/dogfood-runs/{timestamp}/`:

```
{timestamp}/
├── run-meta.json              # run ID, start/end, config
├── results.jsonl              # one line per tool call
├── gaps.md                    # human-readable gap report
├── search-misses.md           # queries that failed to surface expected services
├── category-winners.md        # top 3 services per category by score
├── weak-services.md           # services with 3+ gaps
└── summary.md                 # executive summary
```

## Gap taxonomy

| Code | Meaning | Severity |
|------|---------|----------|
| `SEARCH_MISS`    | Service not in top-N for obvious query | critical |
| `DETAIL_GAP`     | get_service_detail missing required fields | major |
| `RECIPE_GAP`     | No recipes reference this service | major |
| `TIPS_GAP`       | No agent tips available | minor |
| `CATEGORY_MISMATCH` | DB category doesn't match intent-based clustering | major |
| `AUTH_INCONSISTENCY` | `api_auth_method` doesn't match api-guides-seed.json | major |
| `RATE_LIMIT_MISSING` | No rate limit data | minor |
| `MCP_ENDPOINT_INVALID` | `mcp_endpoint` field is malformed or empty for official | critical |

## Consulting report seed

After a full dogfood run, we can run `generate_aeo_report` or
`get_insights` against the accumulated test outcomes to produce the first
"225-service landscape report" — a consulting deliverable that answers:

- **Which categories have the best agent-ergonomic APIs?** (auth simplicity + docs + rate limits)
- **Which services have zero workflow presence?** (no recipes at all)
- **Which Japanese SaaS are ahead of their global competitors on MCP readiness?**
- **Where should KanseiLink invest next?** (missing guides, missing recipes)

This output doubles as:
1. Content — a publishable flagship article
2. Sales collateral — we show SaaS companies where they rank
3. Internal roadmap — prioritizes which services need content work

---

## Execution plan

### Phase 1 (this sprint, scaffolding)
- ✅ Design doc (this file)
- ⏳ `scripts/test-services-dogfood.mjs` — framework scaffold
  - Loads DB
  - Tier filtering
  - Runs discovery + detail + recipe + tips + eval for T1
  - Writes jsonl + summary
- ⏳ Dry-run on 5 T1 services (kintone, freee, slack, notion, stripe-global)
- ⏳ Validate gap taxonomy against real output

### Phase 2 (next sprint)
- Full T1 run (33 services)
- First gap report
- Fix top-5 gaps in services-seed.json / recipes
- Second T1 run to validate fixes

### Phase 3
- T2 + T3 runs
- First consulting report generated from dogfood data
- Publishable landscape article

### Phase 4
- Weekly automated dogfood run via Task Scheduler
- Trend detection: is the DB getting better or worse?
- Correlation with real agent outcomes (once they start flowing)

---

## Running a dogfood pass

```bash
# Full T1 pass
node scripts/test-services-dogfood.mjs --tier=1

# Quick sanity (5 services only)
node scripts/test-services-dogfood.mjs --tier=1 --limit=5

# Dry run (no DB writes)
node scripts/test-services-dogfood.mjs --tier=1 --dry-run

# All tiers
node scripts/test-services-dogfood.mjs --tier=all
```

Environment variables:
- `KANSEI_DB_PATH` — override DB location (default: `./kansei-link.db`)
- `DOGFOOD_AGENT_ID` — override agent identity (default: `dogfood-v1`)

---

## Open questions

1. **Should synthetic outcomes count toward confidence scores?** Pro: DB isn't
   empty on launch. Con: distorts real user perception. **Decision**: tag all
   dogfood outcomes with `source: "dogfood"` and filter them out of public
   stats by default.

2. **How do we measure "discovery intent" quality without bias?** We wrote the
   seed data AND the test intents. **Mitigation**: sample intents from
   real-world LLM user queries (Claude, GPT) via prompt templates.

3. **Multi-lingual coverage** — Japanese + English per service, or just one?
   **Decision**: T1 gets both languages, T2 gets primary language only.
