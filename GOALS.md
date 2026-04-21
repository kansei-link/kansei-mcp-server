# KanseiLINK — Goals

> This file is Tier 1: **every agent session MUST read this first**,
> along with STATE.md and relevant DECISIONS.md entries.
> Other projects (Linksee Memory, CardWize, ScaNavi) have their own
> GOALS.md at their respective repo roots — do not mix goals across
> projects.

Last reviewed: 2026-04-21
Owned by: 企画部隊 (Michie + Claude co-founder agent)

---

## North Star
*Reviewed every 6 months. Changing this is a founder-level decision.*

Become the **Bloomberg for the agent economy**.

- **KanseiLINK** — *what agents choose* (SaaS discovery + AXR credit rating)
- **Linksee Memory** — *how agents remember* (paired product)

Two products, one funnel, one master brand: **Synapse Arrows PTE. LTD.**

---

## 2026 Q2 OKR
*Target close: 2026-07-20. Reviewed weekly, changed monthly only.*

**Objective**: Reach ¥1,000,000 MRR (≈ USD 6,666)

| KR | Target | Unit price | MRR |
|---|---|---|---|
| KR1 | 2 Enterprise deals signed | $2,990/mo | $5,980 |
| KR2 | 20 Pro tier subscribers | $19/mo | $380 |
| KR3 | 2 Team tier subscribers | $149/mo | $298 |
| **Total** | | | **$6,658 ≈ ¥998K** |

2 Enterprise deals carry ~90% of the target. Everything else is signal + optionality.

---

## This Week — 2026-04-21 → 2026-04-27
*Reviewed Friday evening. Uncompleted items roll to next week with explicit reason.*

- [ ] **Tonight 21:00 JST** — Reddit r/ClaudeAI launch (Option B, Linksee Memory)
- [ ] **構造チェック部隊** SKILL.md draft (prevents silent failures like today's Railway incident)
- [ ] **セキュリティー pre-push hook** (runs security-review on staged diffs before 4/28)
- [ ] **PH pre-warm** — reach out to 5 hunters
- [ ] **Stripe Pro tier** link live (deadline 4/27)
- [ ] **Zenn JP launch article** draft (publish 4/29 morning)
- [ ] **4 LinkedIn connect** requests to JP SaaS PMs

## This Month — 2026-04-21 → 2026-05-18 "Ignite"

Week 1 (this week): Reddit seed + infrastructure squads
Week 2 (4/28–5/3): **BIG LAUNCH Tue 4/28** — PH + HN + 4 Reddit subs simultaneous. Dev.to EN article. Enterprise outreach batch #1.
Week 3 (5/4–5/10): PR TIMES release. 4 long-form AEO articles published. Pro tier soft launch.
Week 4 (5/11–5/18): Mid-month review. First Enterprise demos (5 booked). Webinar #1.

**Month 1 KPIs**: 1,000 Linksee Memory npm installs · 500 X followers · 1,000 kansei-link.com visits/week · 50 newsletter subs · 5 Enterprise discovery calls · 10 Pro sign-ups (~$190 MRR)

---

## Trigger Rules (remove emotion from decisions)

These rules pre-commit Michie to an action based on data, not feeling.

### 4/28 Launch Verdict (evaluated 4/30)
- **Reddit 3-post combined ≥200 upvotes AND PH Day-1 ≥500 upvotes**
  → Stay all-in solo. Continue to Month 2 "Convert" phase.
- **Either threshold missed**
  → Activate bridge consulting (¥150-300k/day × 2 days/week agent-strategy consulting). 3 days/week remains on KanseiLINK.

### Enterprise Pipeline
- First Enterprise deal >90 days from first touch → restart outreach with different angle.
- Second Enterprise deal not closing by 2026-06-30 → pivot Enterprise pitch (Agent Cost Optimizer as lead magnet).

### Brand Risk
- Any SaaS vendor named negatively in public content → immediate correction + note in DECISIONS.md
- Any data source (X, Zenn, PR TIMES) cited wrongly → public correction within 24h

---

## Guardrails (never do)

1. **No negative framing of any SaaS vendor** — always positive / constructive. Contradicts brand voice + burns partnerships.
2. **No paid ads in Month 1** — organic must prove itself first. Revisit Month 2 only if organic KPIs green.
3. **No feature expansion on Linksee Memory MVP until 1K installs** — polish the 5 tools.
4. **No selling raw data** — only aggregate + anonymized insights.
5. **No unvetted content goes public** — all blog/social posts pass brand-voice skill review.
6. **No MCP vendor removal without explicit Michie review** — community entries can be hidden (axr_score=NULL) but not deleted.

---

## Relationship to Other Projects

| Project | Positioning | Audience | Separate GOALS.md |
|---|---|---|---|
| **KanseiLINK** (this) | ToB — SaaS PMs, Enterprise Agent Ops | Purchase decision makers | this file |
| **Linksee Memory** | Half ToB / half ToC | Indie devs + Enterprise agent teams | `C:\Users\HP\linksee-memory\GOALS.md` (to create) |
| **CardWize** | ToC first → ToB later | JP consumers → card issuers | `C:\Users\HP\Card_Navi\GOALS.md` (to create) |
| **ScaNavi** | ToC first → ToB later | JP health-conscious consumers → pharma/supplement brands | separate (to create) |

When working on a task that spans projects, read the relevant GOALS.md for each. Do not assume decisions in one carry to another.

---

## How to use this file

**Before acting**: read this file, then STATE.md, then relevant DECISIONS.md entries.
**When finishing**: if the work changes anything here, update this file + log the change in DECISIONS.md.
**Weekly review (Friday evening)**: mark completed items, reassess next week's list.
**Monthly review (last Friday)**: reassess Q2 OKR — are the KRs still the right ones?
