# Anthropic Messages API — web_search_20250305 + web_fetch_20250910 (copy read 2026-10-02)

Sources (read 2026-10-02):
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
  (docs.anthropic.com/… redirects there)

## What the documentation says (the fields the harness depends on)

A response has `content` (array of blocks) and `stop_reason`. The request sets `max_tokens: 8000`. These pages document `"end_turn"` and
`"pause_turn"` ("The API can pause a long-running search turn and return `stop_reason: "pause_turn"`. To
continue, send the paused assistant message back unchanged in a new request.").

Blocks (from the documentation's examples, long values shortened):

```json
{ "type": "server_tool_use", "id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE", "name": "web_search", "input": { "query": "claude shannon birth date" } }
{ "type": "web_search_tool_result", "tool_use_id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
  "content": [ { "type": "web_search_result", "url": "https://en.wikipedia.org/wiki/Claude_Shannon", "title": "Claude Shannon - Wikipedia", "encrypted_content": "EqgfCioIARgB…", "page_age": "April 30, 2025" } ] }
{ "type": "text", "text": "Claude Shannon was born on April 30, 1916, in Petoskey, Michigan",
  "citations": [ { "type": "web_search_result_location", "url": "https://en.wikipedia.org/wiki/Claude_Shannon", "title": "Claude Shannon - Wikipedia", "encrypted_index": "Eo8BCioIAhgB…", "cited_text": "Claude Elwood Shannon (April 30, 1916 – …" } ] }
{ "type": "web_search_tool_result", "tool_use_id": "srvtoolu_a93jad", "content": { "type": "web_search_tool_result_error", "error_code": "max_uses_exceeded" } }
{ "type": "server_tool_use", "id": "srvtoolu_01234567890abcdef", "name": "web_fetch", "input": { "url": "https://example.com/article" } }
{ "type": "web_fetch_tool_result", "tool_use_id": "srvtoolu_01234567890abcdef",
  "content": { "type": "web_fetch_result", "url": "https://example.com/article", "content": { "type": "document", "source": { "…": "…" } }, "retrieved_at": "2025-08-25T10:30:00Z" } }
{ "type": "web_fetch_tool_result", "tool_use_id": "srvtoolu_a93jad", "content": { "type": "web_fetch_tool_result_error", "error_code": "url_not_accessible" } }
```

"On an error, `content` is a single error object rather than a list of result blocks. A search that succeeds
but matches no results returns an empty `content` list, not an error." Fetch citations (`char_location`) are
off unless enabled; the harness does not enable them.

## What the harness requires (SHAPES.anthropic, per turn)

| path | required | type / allowed |
|---|---|---|
| `stop_reason` | yes | `end_turn` / `max_tokens` / `stop_sequence` / `pause_turn`; every turn but the last must be `pause_turn`; a last `pause_turn` = instrument `budget` |
| `content` | yes | array of typed objects — never coerced: a missing or non-array `content` refuses the run (Codex 79e624d N2) |
| `content[text].text` | yes | string |
| `content[text].citations` | no | array of typed objects, or null; absent / null = this block cites nothing of its own |
| `citations[web_search_result_location].url`, `.cited_text` | yes | string |
| `content[server_tool_use].id` | yes | string, unique in the run |
| `content[server_tool_use].name` | yes | `web_search` / `web_fetch` |
| `content[server_tool_use].input` | yes | object; `query` string for web_search, `url` string for web_fetch (Codex 79e624d N3) |
| `content[web_search_tool_result].tool_use_id` | yes | string naming a web_search request of the run |
| `content[web_search_tool_result].content` | yes | a list of `{ type: "web_search_result", url, title }` (other typed items skipped) OR one `{ type: "web_search_tool_result_error", error_code }` |
| `content[web_fetch_tool_result].tool_use_id` | yes | string naming a web_fetch request of the run |
| `content[web_fetch_tool_result].content` | yes | `{ type: "web_fetch_result", url }` or `{ type: "web_fetch_tool_result_error", error_code }` |

The caller hands over every turn exactly as received (`raw.turns`); all turns are checked before any is read.
Read: `fetched` = every web_fetch request's `input.url` (ok when its result is a `web_fetch_result`; the
result's own `url` too when it differs); `candidates` = `web_search_result.url`; `cited` =
`web_search_result_location.url`; text = `text.text` (only to find the artifact's fenced block).
