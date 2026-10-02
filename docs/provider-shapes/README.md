# Provider response shapes (M-006)

The shape table in `exec-harness/lib/natural-task-rules.mjs` (`SHAPES`) is written from these copies.
Each file says where it was read, when, and which fields the harness reads. A field that is not listed here
is not read. When a provider's documentation changes, update the copy (with the new date) and the table in
the same commit.

| file | what | read on |
|---|---|---|
| `openai-responses-web-search.md` | OpenAI Responses API with the `web_search` tool | 2026-10-02 |
| `anthropic-messages-web-tools.md` | Anthropic Messages API with `web_search_20250305` and `web_fetch_20250910` | 2026-10-02 |
| `agileworks-readme-forms.md` | the two official configuration forms in the sealed repository's README | 2026-10-02 (first read 2026-09-29) |
