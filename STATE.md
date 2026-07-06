# KanseiLINK — Current State

> This file is Tier 1: **every agent session MUST read this first**,
> along with GOALS.md.
>
> Updated daily by the 朝ダイジェスト agent once it exists (May W2-3).
> Until then, manually updated at the end of each significant session.
>
> **Remember the two-layer split**:
> - This 4-file structure = *"what & what changed"* (project-specific, structured)
> - Linksee Memory = *"why & the story"* (narrative, cross-session, cross-project)
> Read this file for the "結局何やるの？" answer;
> `recall("KanseiLINK")` from Linksee Memory for the "なぜ？" answer.

Last updated: **2026-07-06** (manual — Claude + Michie)
Next expected update: after Railway deploy of the sweep session's code + seed changes

> **2026-07-06 session A**: Added Site AEO Checker (URL-based scan) as SMB
> outreach lead device — `POST /api/site-check` + `public/site-checker/`.
> See DECISIONS.md 2026-07-06 entry. DEPLOYED (commit 4474847): Railway
> API live (verified: synapsearrows.com scores 90/AAA in production,
> report 17cb467fd8d6), page live at kansei-link.com/site-checker/.

> **2026-07-06 session B (11k liveness sweep)**: Probed all 11,081 services
> (POST-initialize / GitHub GraphQL / npm registry, 183s). Strict liveness
> 76.2%. Archived 1,154 endpoint-dead services (reversible via changelog),
> corrected 379 endpoints (306 GitHub renames, 25 moved transports, 48
> fabricated npx names incl. freee/slack/stripe-jp). Fixed: crawler
> un-archive clobber, search ignoring `archived`, recipes double-JSON
> (find_combinations crash), insights↔voices contradiction (stats seed),
> weekly probe stage 10/11. See DECISIONS.md 2026-07-06 sweep entry.
> **NOT yet deployed to Railway.**

---

## Production Health Snapshot (local DB, 2026-07-06 post-sweep)

| Surface | Status | Detail |
|---|---|---|
| Local DB (`kansei-link.db`) | 🟢 authoritative | 11,151 services / **9,997 active** / 1,154 archived |
| Endpoint liveness (measured 7/6) | 🟢 76.2% strict | POST-initialize verified; 84.7% counting auth-gated/406 |
| `recipes_total` | 🟢 200 | double-encoding repaired — find_combinations works again |
| `service_stats` seeded | 🟢 1,019 rows | service-stats-seed.json closes insights↔voices contradiction on fresh deploys |
| Weekly health probe | 🟢 wired | crawler stage 10/11, Sundays (`--probe` / `options.probe` to force) |
| Railway deploy | 🔴 **stale for sweep changes** | needs deploy: archived-filter search, probe stage, recipes/seed fixes |
| Daily crawler (local) | 🟢 running | run #34 on 7/6; refresh no longer un-archives |

## AXR Grade Distribution (9,997 active services, 2026-07-06)

| Grade | Count |
|---|---|
| AAA | 10 |
| AA | 23 |
| A | 60 |
| BBB | 1,129 |
| BB | 541 |
| B | 6,566 |
| D | 1,668 |

Archived rows (1,154) carry axr NULL / trust 0 and are excluded from search, rankings, and readiness counts as of session B.

---

## Squad Status

| Squad | Status | Next milestone |
|---|---|---|
| **企画** (Claude + Michie) | 🟢 ACTIVE | this session; weekly Friday review |
| **構造チェック** (daily health-check) | 🔴 not built | SKILL.md spec this week |
| **セキュリティー** (pre-push hook) | 🔴 not built | before 4/28 launch |
| **Reddit Agent** | 🔴 not built | May W2 (after Reddit launch data accumulates) |
| **Zenn Agent** | 🔴 not built | May W3 |
| **LinkedIn Agent** | 🔴 not built | June |
| **X Agent** | 🔴 not built | May W1 (first priority — existing daily-crawl data is fastest to feed) |
| **Note Agent** | 🔴 not built | June |
| **朝ダイジェスト** (coordinator) | 🔴 not built | May W2-3 (after first 2-3 squads give it something to aggregate) |

---

## Today's Commits (2026-04-21)

In chronological order:

1. **617a4a6** — post-seed MCP infrastructure cleanup
2. **181f29c** — agent_voice_responses → schema.ts + trust proxy=1
3. **29a068a** — classify.ts refineCategory() + 20-entry reclassification + D/C/F grade CSS
4. **790e93f** — crawler JP discovery sources (jp-watchlist + zenn-jp + github-jp-orgs)
5. **33622e3** — crawler fuzzy same-SaaS dedupe

See DECISIONS.md for context/reasoning/reversibility of each.

---

## Next 3 Actions

1. **(Claude, now)** — write GOALS.md / DECISIONS.md / STATE.md / HEALTH.json, commit as single unit
2. **(Michie, 17:00–19:00 JST)** — final review of Reddit Option B draft (karma check, repo URL confirmation, username set)
3. **(Michie, 21:00 JST)** — Reddit r/ClaudeAI post + 1-2h comment monitoring

## Open Questions (rolled daily)

- r/ClaudeAI karma requirement — Michie to verify before 20:30 JST tonight
- PH hunter pre-warm list — still need to compile 5 names (deadline 4/27)
- Stripe Pro tier link — hard deadline 4/27
- Should 朝ダイジェスト agent output go to Slack / Discord / Gmail / just file? No decision yet; will resolve when writing its SKILL.md
- LINE owner → line-messaging service alias map (minor dedupe edge case, not blocking)

## Rollover from Previous Session
*(Last session: 2026-04-20 evening — GTM plan drafted, 4 assets shipped)*

- ✅ Waitlist component live on linksee-site.vercel.app
- ✅ Resend audience + RESEND_API_KEY env vars confirmed working
- ✅ Discord KanseiLINK post complete
- ⏸ Discord announcement for Linksee Memory — waiting for Reddit spike
- ⏸ Final X handle consolidation (@ELLECraftsinga1) — already set

---

## How to use this file

**At session start**: read this → read GOALS.md → `recall("KanseiLINK")` from Linksee Memory → read relevant DECISIONS.md entries.
**During work**: update "Next 3 Actions" when priorities shift.
**At session end**: update the Production Health Snapshot if anything changed, and move completed items out of "Next 3 Actions".
