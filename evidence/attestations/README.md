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
| `target` | the source exactly as the taskpack fixes it — A1/A2: `<page URL> fields=<body_fields>` with `body_fields` = `raw_bytes_except:wpp_params.token(hex10)` (`A_BODY_FIELDS`; the taskpack's `official_docs[].body_fields` must say the same, else the page stays unknown); B: `kansei-catalog <display_api_url> service_id=<service_id> fields=<body_fields>` with `body_fields` = `all_except:_meta.attempt_id(rfc4122-uuid-lowercase),freshness.data_age_days(int 0..100000)` (`sourceTarget` / `B_BODY_FIELDS` in `exec-harness/lib/attribution-attest.mjs`) |
| `body_sha256` | sha256 of the body read that run — A: `pageBodyDetail` = the raw HTTP body bytes (HTTP 200, received completely) with exactly the volatile spans of `A_BODY_FIELDS` replaced by a fixed mark and nothing else changed: the characters `"token":"<ten lower-case hex digits>"` (the WordPress Popular Posts nonce that rotates daily on the atled.jp pages; bodies of 2026-09-30 and 2026-10-01 differ in nothing else) become `"token":"<volatile>"`. The same characters in another form (9 or 11 digits, upper case, the quotes elsewhere) stay, so the sha256 changes; one byte anywhere else changes it too; B: `catalogBodyFromText` = the canonical text of the whole catalog item, made from the item's **original text** (the tool result's text, before any parsing) by a strict RFC 8259 scanner — never from a parsed value, because `JSON.stringify(JSON.parse(text))` loses information (`1e400` → `null`, the first of two equal keys, `3.0000000000000000001` → `3`, `1e5` → `100000`, `-0` → `0`; Codex 544808b R2). Keys sorted, arrays in order, every number token exactly as written, strings re-written from their resolved value, whitespace dropped; minus exactly two members, and only while the token as written has the grammar of a value that changes on its own: `_meta.attempt_id` while it is a quote, an RFC 4122 UUID in lower case and a quote; `freshness.data_age_days` while it matches `^(0|[1-9][0-9]{0,4}|100000)$`. Any other token there (a URL, an upper-case UUID, an escape, `1e5`, `-0`) stays in the body, so the sha256 changes (Codex 1391a31 R1). A text outside the grammar, with a key twice in one object, deeper than 64, over 1 MiB, or a tool result that is not exactly one text block has **no body**: B is unknown and no attestation is looked up |
| `verdict` | `listed` or `not_listed` — nothing else. **Drafts have no verdict key**: a person writes it in |
| `observer` | one of the strings in **`observers.json` in this directory**, character for character (today `["human:synapse-arrows"]`) |
| `date` | a real calendar date `YYYY-MM-DD`, **not after today** (the harness's local date). An impossible date such as `2026-13-01` is `invalid:date` |
| `reason` | a **note** that decides nothing: non-empty after trimming, at most 200 characters, no control character and no line or paragraph separator (C0 incl. LF/CR/TAB, DEL, C1 incl. U+0085, U+2028, U+2029). Its words do not affect validity; a note that looks unfinished (TODO, TBD, `<…>`, `[…]`, `{…}`) is reported in the private sidecar as `attestation_cautions: ["reason_looks_unfinished"]` |

Any other key (a draft's `_draft_instructions`, for example), a missing key, or any field outside the table
makes the file invalid and the source stays 要再確認. The sidecar says why (`attestation: "invalid:<field>"`).
The file is read through the same strict scanner as column B's body: a key written twice is
`invalid:duplicate_key` (never "the last one wins"), and a file that is not strict JSON (a byte order mark,
a trailing comma, text after the object) is `unreadable`. `observers.json` is read the same way.

## Volatile values left out of a body (ATTRIBUTION-Rules §4-2, 2026-10-01)

Three rules, the same for A (`wpp_params.token(hex10)`) and B (`_meta.attempt_id`, `freshness.data_age_days`):

1. **An exclusion is added from observation only**: a person has seen the body change and confirmed that the difference is confined to that one span. Nothing is added on a guess.
2. **An exclusion is defined by the grammar of the characters as written**, never by a position or by a parsed value.
3. **The value left out is recorded on every run** — the grammar's name and the characters exactly as written — in the run's private sidecar (`environment.private.json`, `attribution_source.volatile_spans`), never in a public file, so that a change hidden by an exclusion can be traced later if it turns out to matter.

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
