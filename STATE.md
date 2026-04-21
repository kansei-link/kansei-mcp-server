# KanseiLINK — Current State

> This file is Tier 1: **every agent session MUST read this first**,
> along with GOALS.md.
>
> Updated daily by the 朝ダイジェスト agent once it exists (May W2-3).
> Until then, manually updated at the end of each significant session.

Last updated: **2026-04-21 13:20 JST**  (manual — Claude + Michie)
Next expected update: 2026-04-21 evening after Reddit launch

---

## Production Health Snapshot

| Surface | Status | Detail |
|---|---|---|
| Railway API | 🟢 online | `kansei-link-mcp-production.up.railway.app` |
| `services_total` | 🟢 376 | 337 visible after infra filter |
| `recipes_total` | 🟢 188 | |
| `voices` (aggregated) | 🟢 37 | |
| `changelog` | 🟢 182 | last 180 days |
| Railway deploy | 🟢 synced | at commit 33622e3 |
| GitHub Pages (kansei-link.com) | 🟢 synced | at commit 33622e3 |
| Linksee Memory (local) | 🟢 | 11 memories added today (7 pinned) |
| Stripe Pro tier link | 🟡 not-yet-live | target: before 4/28 |
| Reddit r/ClaudeAI | ⚪ not-yet-posted | tonight 21:00 JST |

## AXR Grade Distribution (337 visible services)

| Grade | Count |
|---|---|
| AAA | 6 |
| AA | 8 |
| A | 28 |
| BBB | 53 |
| BB | 132 |
| D | 110 |

110 community entries graded D are awaiting evidence accumulation (total_calls ≥ 3 with success_rate ≥ 0.8 graduates to higher grades automatically via recompute-axr).

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
