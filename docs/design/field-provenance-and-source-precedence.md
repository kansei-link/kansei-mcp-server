# Field provenance and source precedence

**Status:** proposal — nothing here is implemented
**Written:** 2026-09-20
**Why now:** the ENTIA investigation (see `fix/freshness-provenance`) found that a
Registry-sourced `description` can never be corrected after ingest. The obvious
fix — refresh descriptions from the Registry — is unsafe to write today, because
four different writers already compete for the same column with no order between
them. This document settles the order first.

---

## 1. What actually writes `services.description` today

| Writer | Source of the value | Guard | Effect |
|---|---|---|---|
| `sync-registry.ts:189` | official MCP Registry | `INSERT OR IGNORE` | new rows only — **never updates** |
| `refresh.ts` | GitHub repo description | `COALESCE(@description, description)` | overwrites **anything**, including an operator's approved text |
| `propose-update.ts:421` | operator / agent proposal, human-approved | bare `UPDATE services SET <field> = ?` | overwrites, records **no provenance** |
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
`INSERT OR IGNORE`. The seed path was fixed; the registry-sync path was not, and
nothing connected the two. So this proposal is not introducing a new principle —
it is finishing an application of one the project already committed to, and
generalising it from "the seeder" to "every writer".

## 2. Precedence is per field *class*, not per row

The instinct "the operator always wins" is wrong, because it would hand vendors
the ability to write their own grade. The rating integrity line
(`competitive-positioning.md`, no pay-for-grade) requires that measured fields
stay ours. So fields split into three classes with different rules.

### 2a. Descriptive fields — the vendor is authoritative
`description`, `name`, `namespace`, `category`, `tags`, `api_url`, guide
`docs_url`.

Precedence, highest first:

1. `operator` — the service's own operator, human-approved (運営者確認)
2. `registry` — the vendor's own published MCP Registry entry
3. `github` — the repo blurb: vendor-adjacent, but not where a vendor states product facts
4. `seed` / `crawl` — our snapshot of one of the above, possibly months old

The ENTIA case validates this ordering. Our stale text came from `registry`
(v3.6.0, correct when copied). GitHub's blurb was *more* accurate by the time we
looked. And the operator's own filing was the most accurate of all. Any rule that
let `github` outrank `registry` would have helped here by luck, not by design.

### 2b. Measured fields — KanseiLINK is authoritative, always
`trust_score`, `axr_score`, `axr_grade`, `axr_dims`, `success_rate`,
`mcp_status` when probe-derived, everything downstream of execution reports.

**No external source may write these, including an operator.** An operator may
file a *dispute*, which opens an inspection; it never mutates the value. This is
the rule that keeps a correction request from becoming a grade negotiation, and
it is why execution reports are not "another source" to be ranked — they live on
a different axis and simply do not touch descriptive fields at all.

### 2c. Connective fields — operator-stated, machine-confirmed
`mcp_endpoint`, `api_auth_method`.

An operator is authoritative for what the endpoint *is*, but the value is
displayed as verified only once a probe has reached it. Operator statement sets
the value; the probe sets its verification, using the columns
`fix/freshness-provenance` just added.

## 3. Proposed mechanism

A companion table, so no per-field columns sprawl across `services`:

```sql
CREATE TABLE service_field_provenance (
  service_id   TEXT NOT NULL REFERENCES services(id),
  field        TEXT NOT NULL,
  source       TEXT NOT NULL,   -- operator | registry | github | seed | crawl | measured
  source_rank  INTEGER NOT NULL,
  set_at       TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_url TEXT,            -- registry version URL, proposal id, probe run
  PRIMARY KEY (service_id, field)
);
```

**Write rule.** A writer carrying rank R may set a field whose current rank is
≥ R (lower number = stronger). A write from a weaker source does not overwrite
and does not fail silently: it records a row in `inspections` as a
`field_conflict`, carrying both values. That turns "our data disagrees with the
vendor's" from an invisible event into a queue someone can work.

**Staleness does not bypass rank.** ENTIA's own Registry entry regressed for two
days (v4.3.1 said "34 countries" again, v4.3.2 put it back). A rule that let a
newer weaker source win on age would have copied that regression. Age raises a
conflict for review; it does not grant authority.

## 4. Staged plan

- **Phase 0 — record, change nothing.** Every existing writer stamps provenance.
  Backfill: approved rows in `pending_updates` → `operator`; everything else →
  `seed` or `crawl`. Ships dark; no behavioural change; gives us the first honest
  picture of how much of the corpus is operator-touched.
- **Phase 1 — enforce on write.** Apply the rank rule. This alone fixes the
  GitHub-over-operator defect. Seed upsert becomes rank-aware, so an operator
  correction held locally survives an upgrade while everything else still tracks
  the shipped seed.
- **Phase 2 — turn on Registry description refresh.** Now safe, because it cannot
  outrank an operator. This is the change that would have caught ENTIA on
  2026-07-08, the day v4.3.0 was published, instead of 74 days later.
- **Phase 3 — surface conflicts** in `inspect`, so disagreement between our
  record and the vendor's becomes visible work rather than a silent overwrite.

Phases 0 and 1 are worth doing even if Phase 2 is never built: they close a live
defect. Phase 2 without Phase 1 would deepen the problem it means to solve.

## 5. Open questions for Michie

1. **Does `operator` outrank `registry` even when the Registry entry is newer?**
   This proposal says yes (rank beats age; age opens a review). The alternative —
   newest-wins among vendor-controlled sources — is simpler but would have copied
   ENTIA's own two-day regression into our data.
2. **Should an operator be able to set `category`?** It is descriptive, so this
   proposal says yes. But category drives ranking cohorts, which edges toward the
   measured class and the no-pay-for-grade line.
3. **What happens to a field an operator corrected when their Registry entry
   later contradicts it?** Proposed: keep the operator value, open a conflict,
   and tell the operator — their two published sources disagree, which is
   information they want.
