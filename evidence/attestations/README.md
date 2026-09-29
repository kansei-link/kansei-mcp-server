# evidence/attestations — human confirmations that a source does NOT list the sealed repository

ATTRIBUTION-Rules v0.1 §4-2 (2026-09-29): the automatic reading of columns A (official pages) and B
(the KanseiLINK catalog item) returns only **listed** or **unknown**. "Not listed" blames the company or
KanseiLINK, so it is recorded only when a person has read the exact body the harness read that day and
signed a file here. When the body changes, its sha256 changes, the file no longer matches, and the
source is unknown again (the attestation expires by itself).

File name: `<marker_id>-<source_id>-<body sha256>.json`, e.g. `M-004-A1-<64 hex>.json`.
Exactly these keys (anything else, a placeholder, or another seal or body makes the file ignored):

| key | value |
|---|---|
| `attestation` | `kansei-attribution-not-listed/v1` |
| `marker_id` | the marker, e.g. `M-004` |
| `expected_digest` | the seal's sha256 (binds the file to the sealed repository) |
| `source_id` | `A1`, `A2`, … (taskpack `attribution.official_docs[].id`) or `B` |
| `target` | the URL, or the catalog item and fields that were read |
| `body_sha256` | sha256 of the body read that day — A: the raw HTTP body bytes; B: the JSON of `[path, value]` pairs of every string field, sorted, without the top-level `_*` keys and `freshness` (`catalogBody` in `exec-harness/lib/attribution-rules.mjs`) |
| `verdict` | `not_listed` |
| `observer` | `human:<name>` |
| `date` | `YYYY-MM-DD` |
| `reason` | one line: what was read and what was absent |

The body sha256 a run saw is in that run's `environment.private.json` (`attribution_source` diagnostics).
Unsigned drafts are kept outside this repository (founder-ops) and carry `_draft_instructions`, which
makes them invalid until a person removes it and fills `observer`, `date` and `reason`.
