# Field provenance and source precedence

**Status:** proposal — nothing here is implemented
**Written:** 2026-09-20 · **Revised:** 2026-09-20 with Michie's conditions (§6)
**Why now:** the ENTIA investigation (see `fix/freshness-provenance`) found that a
Registry-sourced `description` can never be corrected after ingest. The obvious
fix — refresh descriptions from the Registry — is unsafe to write today, because
four writers already compete for the same column with no order between them.
This document settles the order first.

---

## 1. What actually writes `services.description` today

| Writer | Source of the value | Guard | Effect |
|---|---|---|---|
| `sync-registry.ts:189` | official MCP Registry | `INSERT OR IGNORE` | new rows only — **never updates** |
| `refresh.ts` | GitHub repo description | `COALESCE(@description, description)` | overwrites **anything**, including an operator's approved text |
| `propose-update.ts:421` | proposal, human-approved | bare `UPDATE services SET <field> = ?` | overwrites, records **no provenance** |
| `seed.ts:264` | shipped seed JSON | `ON CONFLICT(id) DO UPDATE SET description = excluded.description` | overwrites on **every install and upgrade** |

Four writers, no precedence, no provenance. The value a user sees is whichever
writer ran last, and which one ran last is an accident of scheduling.

Two consequences are live defects, not hypotheticals:

- **An approved operator correction is overwritten by the next GitHub refresh.**
  `description` is in `ALLOWED_SERVICE_FIELDS`, so an operator can correct it and
  a human can approve it — and `refresh.ts` will then replace it with whatever
  the GitHub repo blurb says, silently, with no conflict recorded.
- **An operator correction applied to a deployed database is wiped by the next
  `npm run seed`.** This cuts both ways: it is also the mechanism by which the
  #32 / #33 corrections reach existing installs. The seed must stay authoritative
  for what we ship while not silently discarding what an operator fixed locally.

Adding a fifth writer (Registry → description) on top of this would make the
situation worse, not better. Hence: provenance before refresh.

### This lesson was already learned once, on a different path

Decision #14 (recorded, still in force) reads: *"KanseiLink's seed is done by
UPSERT. `INSERT OR IGNORE` is forbidden — category/tag/trust updates are never
applied to existing rows. This was a real bug and it was fixed."*

That is precisely the ENTIA failure mode, and `sync-registry.ts:189` still uses
the forbidden form. The seed path was fixed; the registry-sync path was not, and
nothing connected the two. So this proposal is not introducing a new principle —
it is finishing an application of one the project already committed to, and
generalising it from "the seeder" to "every writer".

## 2. Three sources that today collapse into one

`propose-update.ts` records nothing about where an approved value came from, so
three genuinely different acts are indistinguishable once written:

| Source | What it is | Example |
|---|---|---|
| `operator_claim` | the company itself asserting a fact about its own service, through 運営者確認 | a vendor completing their service page |
| `kansei_approved` | a correction **we** reviewed against primary sources and approved | #29: ENTIA reported a defect, we re-read the Registry and the live `tools/list` ourselves, and approved the change |
| `registry` | the vendor's own published MCP Registry entry, read by machine | `io.github.entia-systems-core/entity-verification` v4.4.0 |

These must be recorded separately. ENTIA makes the distinction concrete: ENTIA
*is* the operator, but they filed a GitHub PR rather than a Claim, and what
landed was our editorial act on evidence we checked — `kansei_approved`, not
`operator_claim`. Collapsing the two would let us describe an outside report as
the vendor's own word, which is the sort of thing a rating body must not do.

## 3. Precedence is per field *class*, not per row

The instinct "the company always wins" is right for descriptive facts and wrong
for everything else, because applied broadly it would hand vendors their own
grade. The rating integrity line (`competitive-positioning.md`, no pay-for-grade)
requires that measured fields stay ours. So fields split into classes.

### 3a. Descriptive fields — the company is authoritative

`description`, `name`, `namespace`, `tags`, `api_url`, and the guide prose fields.

Precedence, strongest first:

1. `operator_claim` — the company's own statement about its own service
2. `kansei_approved` — a correction we verified and approved
3. `registry` — the vendor's published Registry entry
4. `github` — the repo blurb: vendor-adjacent, not where product facts are stated
5. `seed` / `crawl` — our snapshot of one of the above, possibly months old

**A newer Registry entry does not override a company statement — it surfaces as
`pending_confirmation`, visibly.** When `registry` disagrees with a live
`operator_claim`, the claim stays the displayed value and the record carries the
conflicting Registry text, its version, and the date we noticed. It is shown to
the reading agent, not filed in an internal queue: our record and the vendor's
other published source disagree, and whoever is deciding whether to connect
deserves to know that before they find out the hard way.

This is why age does not beat rank. ENTIA's own Registry entry regressed for two
days — v4.3.1 (2026-07-11) went back to "34 countries", v4.3.2 (2026-07-13) put
it right. A newest-wins rule would have copied the regression as fact. Under
this rule it would have appeared as a pending confirmation and resolved itself.

A `kansei_approved` correction that contradicts a live `operator_claim` is also
a conflict, never a silent override. Overruling a company's statement about
itself is precisely the act that should leave a visible trace.

**Named risk:** precedence 1 means a company could state something false and sit
above correction. Three things hold that in check — the value is attributed as
their claim rather than as our finding, a contradicting Registry entry stays
visible beside it, and no claim reaches a measured field. If a claim is both
false and contradicted, that is a conversation with the operator, not a silent
database edit.

### 3b. Measured fields — KanseiLINK is authoritative, always

`trust_score`, `axr_score`, `axr_grade`, `axr_dims`, `success_rate`,
`mcp_status` when probe-derived, and everything downstream of execution reports.

**No external source writes these. Not the company, not an approved correction.**
An operator may file a *dispute*, which opens an inspection and never mutates
the value. This is the rule that stops a correction request becoming a grade
negotiation, and it is why execution reports are not "another source" to be
ranked — they sit on a different axis and never touch descriptive fields.

### 3c. Ranking-affecting fields — proposable, not writable

`category`, and any field that decides which cohort a service is ranked in.

A company may **propose** a category with a reason, and may see the proposal's
status. A company may **not** change it. Category determines who a service is
compared against, so a direct write would be self-selection into a favourable
cohort — a descriptive-looking field with measured-field consequences. It gets
its own class precisely because it looks like 3a and behaves like 3b.

This is a narrowing of today's behaviour: `category` currently sits in
`ALLOWED_SERVICE_FIELDS` and is applied straight to `services` on approval.

### 3d. Connective fields — company-stated, machine-confirmed

`mcp_endpoint`, `api_auth_method`.

The company is authoritative for what the endpoint *is*; it is displayed as
reachable only once a probe has reached it, using the check columns
`fix/freshness-provenance` added. Statement and confirmation stay separate — the
same separation that commit enforced between an attempt and a check.

## 4. Proposed mechanism

Companion tables, so per-field columns do not sprawl across `services`:

```sql
CREATE TABLE service_field_provenance (
  service_id   TEXT NOT NULL REFERENCES services(id),
  field        TEXT NOT NULL,        -- guide fields included
  source       TEXT NOT NULL,        -- operator_claim | kansei_approved | registry | github | npm | seed | crawl | measured
  source_rank  INTEGER NOT NULL,
  set_at       TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_url TEXT,                 -- registry version, pending_updates id, probe run
  PRIMARY KEY (service_id, field)
);

CREATE TABLE service_field_conflicts (
  service_id      TEXT NOT NULL REFERENCES services(id),
  field           TEXT NOT NULL,
  holding_value   TEXT NOT NULL,     -- what we display
  holding_source  TEXT NOT NULL,
  incoming_value  TEXT NOT NULL,     -- what disagreed
  incoming_source TEXT NOT NULL,
  noticed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL DEFAULT 'pending_confirmation',
  PRIMARY KEY (service_id, field, incoming_source)
);
```

**Write rule.** A writer carrying rank R may set a field whose current rank is
≥ R (lower number = stronger). A weaker write does not overwrite and does not
vanish: it lands in `service_field_conflicts` as `pending_confirmation` and is
surfaced on the record. Disagreement between our data and a vendor's becomes
something a reader can see and someone can work, instead of an invisible event.

## 5. Staged plan

### Phase 0 — record only. No behaviour change. (the next unit of work)

**In scope**

1. Create `service_field_provenance`. `service_field_conflicts` lands in the same
   migration but is written only by Phase 1 — so Phase 1 is a code change, not a
   migration.
2. Every existing writer stamps provenance as it writes, with no precedence check
   and nothing blocked:
   - `propose-update.ts` → `operator_claim` when the proposer is a verified
     operator of that service, otherwise `kansei_approved`. **This distinction
     does not exist in the data today and is the main thing Phase 0 buys.**
   - `refresh.ts` → `github` / `npm`
   - `sync-registry.ts` → `registry`
   - `seed.ts` → `seed`
   - AXR / probe / trust writers → `measured`
3. Backfill: approved rows in `pending_updates` → `kansei_approved` (we cannot
   retroactively tell which proposers were operators, and over-claiming "the
   company said this" is the worse error); everything else → `seed` or `crawl`.
4. Cover `service_api_guides` prose fields on the same footing. Their content has
   no verification record at all — `get_service_detail` currently returns
   `content_verified_at: null` for every guide, and this is where that gets a
   real answer.
5. A read-only report: how much of the corpus is operator-touched, how much is
   registry-derived, how much is nobody's in particular.

**Out of scope for Phase 0** — no precedence enforcement, no conflict rows
written, no tool output change, no Registry description refresh, and no change to
what `category` accepts. Phase 0 is deliberately inert: it can ship without a
release decision, because nothing a user sees moves.

**Exit criteria** — every write path stamps a source; the backfill report runs;
the operator-vs-approved split is visible in real numbers. Then Phase 1 has
something to enforce against.

### Phase 1 — enforce on write

Apply the rank rule; write conflict rows; surface `pending_confirmation` on the
record; move `category` from writable to proposable. Fixes both live defects on
its own: the GitHub-over-operator overwrite, and the seed upgrade wiping a
locally-held correction.

### Phase 2 — turn on Registry description refresh

Now safe, because it cannot outrank a company statement and cannot silently
replace an approved correction. This is the change that would have caught ENTIA
on 2026-07-08, the day v4.3.0 was published, rather than 74 days later.

### Phase 3 — surface conflicts in `inspect`

Make the queue workable, and close the loop back to the operator whose two
published sources disagree.

Phases 0 and 1 are worth doing even if Phase 2 is never built: they close a live
defect. Phase 2 without Phase 1 would deepen the problem it means to solve.

## 6. Settled by Michie, 2026-09-20

- A company statement outranks a newer Registry entry; the disagreement is shown
  as `pending_confirmation` rather than resolved silently either way.
- `operator_claim`, `kansei_approved` and `registry` are three separate sources,
  recorded separately.
- A company may propose a ranking-affecting category, and may not write one.

## 7. Still open

1. **Who counts as a verified operator** for `operator_claim`, mechanically?
   Phase 0 needs this to split claims from approvals at write time; the backfill
   sidesteps it by calling all history `kansei_approved`.
2. **How long does `pending_confirmation` stay visible** before it becomes a
   stronger signal? ENTIA's own contradiction resolved in two days; one standing
   for two months means something different.
3. **Does a company statement expire?** A claim made once and never revisited is
   exactly the shape of the record this whole investigation started from.
