# OpenAI Responses API — web_search (copy read 2026-10-02)

Sources (read 2026-10-02):
- https://developers.openai.com/api/reference/resources/responses/methods/create (Response object)
- https://developers.openai.com/api/docs/guides/tools-web-search (web search guide; redirected from platform.openai.com/docs/guides/tools-web-search)

## What the documentation says (the fields the harness depends on)

Response object (top level):
- `status`: `"in_progress"` | `"completed"` | `"incomplete"`
- `error`: nullable object `{ code, message }`
- `output`: array of output items
- also `id`, `object`, `created_at`, `model`, `incomplete_details`, `usage` (not read for the judgement)

Output item `web_search_call`: `id`, `type: "web_search_call"`, `status` (`"in_progress"`, `"searching"`, `"completed"`, `"failed"`, `"incomplete"`), `action`, one of:
- `{ type: "search", query?: string, queries?: string[], sources?: [{ type: "url", url }] }` — `sources` only with `include: ["web_search_call.action.sources"]`
- `{ type: "open_page", url?: string | null }` — reasoning models only
- `{ type: "find_in_page", url: string, pattern: string }` — reasoning models only

Output item `message`: `id`, `role: "assistant"`, `status`, `content[]` of
- `{ type: "output_text", text: string, annotations: [ { type: "url_citation", url, title, start_index, end_index } ] }`
- `{ type: "refusal", refusal: string }`

Guide example (verbatim, ids shortened):

```json
[
  { "type": "web_search_call", "id": "ws_67c9…", "status": "completed",
    "action": { "type": "search", "query": "latest news about AI" } },
  { "id": "msg_67c9…", "type": "message", "status": "completed", "role": "assistant",
    "content": [ { "type": "output_text", "text": "On March 6, 2025, several news...",
      "annotations": [ { "type": "url_citation", "start_index": 2606, "end_index": 2758, "url": "https://...", "title": "Title..." } ] } ] }
]
```

## What the harness requires (SHAPES.openai)

| path | required | type / allowed |
|---|---|---|
| `status` | yes | `"completed"` only (anything else refuses the response — Codex 79e624d N4) |
| `error` | no | absent or `null` (an error object refuses the response) |
| `output` | yes | array; every item an object with a string `type` |
| `output[web_search_call].id` | yes | string |
| `output[web_search_call].status` | yes | one of the documented values |
| `output[web_search_call].action` | yes | object with a string `type` |
| `action[search].query` | no | string |
| `action[search].queries` | no | array of strings |
| `action[search].sources` | no | array of `{ type: "url", url: string }` (other typed items skipped) |
| `action[open_page].url` | **yes (key)** | string or null — stricter than the reference, which marks it optional: a missing key refuses the response (Codex 79e624d N3) |
| `action[find_in_page].url`, `.pattern` | yes | string |
| `output[message].role` | yes | `"assistant"` |
| `output[message].content` | yes | array of typed objects |
| `content[output_text].text` | yes | string |
| `content[output_text].annotations` | no | array of typed objects; absent = this block cites nothing of its own |
| `annotations[url_citation].url` | yes | string |
| `annotations[url_citation].start_index`, `.end_index` | yes | number |
| `content[refusal].refusal` | yes | string |

Read: `fetched` = `open_page` / `find_in_page` `url` (null kept as a request without a URL); `candidates` =
`search.sources[].url`; `cited` = `url_citation.url`; text = `output_text.text` (only to find the artifact's
fenced block). Unknown item / action / content / annotation types that are well-formed typed objects are skipped
(their type names are kept privately).
