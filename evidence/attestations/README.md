# evidence/attestations — human confirmations of what a source says about the sealed repository

ATTRIBUTION-Rules v0.1 §4-2 (Michie 2026-09-29, after the Codex review of 7e9a3e2): columns A (official
pages) and B (the KanseiLINK catalog item) are decided by **people**. The instrument only detects change:
every run it reads the three sources fixed in the taskpack (A1, A2, B) and takes the sha256 of each body.
A source's state comes only from a valid file here for exactly that body — `verdict` **listed** or
**not_listed**. Without one the source is **未確定（本文に変化あり・要再確認）**, marked in the run's private
sidecar (`environment.private.json`: `attribution_source`, `attribution_needs_recheck`) and in the README
rows. When a body changes, its sha256 changes, the file no longer matches and the source is marked for
re-checking again (the attestation expires by itself). The automatic reading of a body is only a private
hint (手がかり) in the sidecar; it never changes a row, a judgement or the sheet.

File name: `<marker_id>-<source_id>-<body sha256>.json`, e.g. `M-004-A1-<64 hex>.json`.
Exactly these ten keys; every value a non-empty string with no leading or trailing space:

| key | value |
|---|---|
| `attestation` | `kansei-attribution-attestation/v2` |
| `marker_id` | the marker, e.g. `M-004` |
| `expected_digest` | the seal's sha256 (binds the file to the sealed repository) |
| `source_id` | `A1`, `A2` (taskpack `attribution.official_docs[].id`) or `B` |
| `target` | the source exactly as the taskpack fixes it — A1/A2: the page URL; B: `kansei-catalog <display_api_url> service_id=<service_id> fields=<body_fields>` (`sourceTarget` in `exec-harness/lib/attribution-attest.mjs`) |
| `body_sha256` | sha256 of the body read that run — A: the raw HTTP body bytes (HTTP 200, received completely); B: `catalogBody` = the whole catalog item as canonical JSON (keys sorted, arrays in order, every leaf) minus exactly `_meta.attempt_id` (while a string) and `freshness.data_age_days` (while an integer ≥ 0) |
| `verdict` | `listed` or `not_listed` |
| `observer` | `human:<name>` — use the organisation, `human:synapse-arrows` |
| `date` | `YYYY-MM-DD`, a real date |
| `reason` | one line (≤ 200 characters): what was read and what was (or was not) there |

A file is ignored (the source stays 要再確認) when a key is missing or extra, when any value contains TODO,
TBD, `<…>`, `[…]`, `{…}` or a line break, when a value is empty, or when `target`, `marker_id`,
`expected_digest`, `source_id` or `body_sha256` does not match the run.

**Signers.** The person who signs is recorded ONLY in `founder-ops/ATTESTATION-SIGNERS.md` (outside this
repository): date, file name, and who read the body. The file here carries the organisation
(`human:synapse-arrows`), never a personal name.

The body sha256 a run saw, and the target it expects, are in that run's `environment.private.json`.
Unsigned drafts are kept outside this repository (`founder-ops/research/Marker-M004_2026-09-25/attestations-draft/`)
and carry `_draft_instructions` plus TODO values, which make them invalid until a person reads the body,
chooses the verdict, fills `date` and `reason`, and removes `_draft_instructions`.
