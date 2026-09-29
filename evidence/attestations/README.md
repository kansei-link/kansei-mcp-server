# evidence/attestations — human confirmations of what a source says about the sealed repository

ATTRIBUTION-Rules v0.1 §4-2 (Michie 2026-09-29): columns A (official pages) and B (the KanseiLINK catalog
item) are decided by **people**. The instrument only detects change: every run it reads the three sources
fixed in the taskpack (A1, A2, B) and takes the sha256 of each body. A source's state comes only from a
valid file here for exactly that body — `verdict` **listed** or **not_listed**. Without one the source is
**未確定（本文に変化あり・要再確認）**, marked in the run's private sidecar (`environment.private.json`:
`attribution_source`, `attribution_needs_recheck`) and in the README rows. When a body changes, its sha256
changes, the file no longer matches and the source is marked for re-checking again (the attestation
expires by itself). The automatic reading of a body is only a private hint (手がかり) in the sidecar; it
never changes a row, a judgement or the sheet.

## The file

Name: `<marker_id>-<source_id>-<body sha256>.json`, e.g. `M-004-A1-<64 hex>.json`. Exactly these ten keys,
every value a string. After the Codex review of 5758e0a the fields that **decide** are bound to allowed
values or to values the harness computes — never screened by a list of forbidden words:

| key | allowed value |
|---|---|
| `attestation` | `kansei-attribution-attestation/v2` |
| `marker_id` | the run's marker, e.g. `M-004` |
| `expected_digest` | the seal's sha256 (binds the file to the sealed repository) |
| `source_id` | `A1`, `A2` (taskpack `attribution.official_docs[].id`) or `B` |
| `target` | the source exactly as the taskpack fixes it — A1/A2: the page URL; B: `kansei-catalog <display_api_url> service_id=<service_id> fields=<body_fields>` (`sourceTarget` in `exec-harness/lib/attribution-attest.mjs`) |
| `body_sha256` | sha256 of the body read that run — A: the raw HTTP body bytes (HTTP 200, received completely); B: `catalogBody` = the whole catalog item as canonical JSON (keys sorted, arrays in order, every leaf) minus exactly `_meta.attempt_id` (while a string) and `freshness.data_age_days` (while an integer ≥ 0) |
| `verdict` | `listed` or `not_listed` — nothing else. **Drafts have no verdict key**: a person writes it in |
| `observer` | one of the strings in **`observers.json` in this directory**, character for character (today `["human:synapse-arrows"]`) |
| `date` | a real calendar date `YYYY-MM-DD`, **not after today** (the harness's local date). An impossible date such as `2026-13-01` is `invalid:date` |
| `reason` | a **note** that decides nothing: non-empty after trimming, at most 200 characters, no control character and no line or paragraph separator (C0 incl. LF/CR/TAB, DEL, C1 incl. U+0085, U+2028, U+2029). Its words do not affect validity; a note that looks unfinished (TODO, TBD, `<…>`, `[…]`, `{…}`) is reported in the private sidecar as `attestation_cautions: ["reason_looks_unfinished"]` |

Any other key (a draft's `_draft_instructions`, for example), a missing key, or any field outside the table
makes the file invalid and the source stays 要再確認. The sidecar says why (`attestation: "invalid:<field>"`).

## observers.json

`evidence/attestations/observers.json` is a JSON array of strings: the observers whose attestations count.
Each entry is `human:` followed by a name with no leading or trailing space and no control character. The
repository's list is `["human:synapse-arrows"]` (the organisation; see below). If the file is missing,
unreadable, empty, or has any malformed entry, **no** attestation is valid. Changing the list is a commit
like any other and is reviewed as such.

## Signers

The person who signs is recorded ONLY in `founder-ops/ATTESTATION-SIGNERS.md` (outside this repository):
date, file name, and who read the body. The file here carries the organisation (`human:synapse-arrows`),
never a personal name.

## Drafts

The body sha256 a run saw, and the target it expects, are in that run's `environment.private.json`. Unsigned
drafts are kept outside this repository (`founder-ops/research/Marker-M004_2026-09-25/attestations-draft/`)
together with a copy of the exact body. A draft has **no `verdict`**, an empty `reason` and `date`, and the
`_draft_instructions` key — each of which makes it invalid. To sign: read the body copy, add `verdict`
(`listed` or `not_listed`), fill `date` (the day you read it) and `reason` (one line), remove
`_draft_instructions`, and put the file here under the same name.
