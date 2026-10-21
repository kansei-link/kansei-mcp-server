# ask v1: read-only lookup for "I am stuck on this error"

Design: `founder-ops/research/Ask_2026-10/DESIGN-ask-v1-2026-10-20.md` (§9 = decisions).
Built on the field-note loop (`src/notes/*`); the only new table is `ask_log`.

## Interfaces

- `GET /api/v1/ask?service=<id>&error=<message>&runtime=<claude|codex|gpt|gemini|other>`
  — `error` up to 300 characters. Longer → 400 `application/problem+json` pointing to POST.
- `POST /api/v1/ask` (JSON, same fields) — `error` up to 2,000 characters.
- `GET /api/v1/ask/stats` — public 30-day counts per service × error_key (asks, matched).
  Individual asks are never exposed.
- `GET /admin/ask/candidates` — `Authorization: Bearer <CRAWLER_SECRET>`. Unmatched
  service × error_key in the last 30 days, most frequent first: the verification queue.
- MCP: `lookup({ mode: "ask", service_id, error, runtime? })` runs the same matcher.

Limits: 30/min/IP on the HTTP endpoints; 5,000/day global (`ASK_DAILY_CAP`, in-memory,
shared by HTTP and MCP) → 429. Unknown service id → 404 problem. No auth.

## Processing

1. Mask secrets and PII (`src/utils/secret-mask.ts`, `pii-masker.ts`), strip control chars.
2. `parseErrorKey` → `{ layer: rest|mcp|unknown, http_status, provider_code }`.
3. Match, in order: ① HTTP status + provider code equal ② `message_pattern` contained
   in the masked text ③ token overlap ≥ 0.6 (≥ 2 shared tokens). Top 5.
4. **Only `verified` / `lived` candidates are returned** (§9 decision 4). Sources:
   `public/insights/agent-field-notes.json` (AWT-* are `lived`), `agent_notes` with
   status verified/lived and `hidden = 0` (none today: v0 pins status to `unverified`,
   so no agent note is returned), and error cards via `src/data/error-cards.json`
   (slot only; import is a separate job).
5. Always 200 with `matches: []` when nothing matches — "none" is an answer.

Response: `service`, `error_key`, `matches[]` (`source`, `id`, `status`, `applies_when`,
`first_check`, `how_resolved`, `success_check`, `page`, `matched_by`), `same_symptom_30d`
(earlier asks with the same service × error_key), `official_docs` (catalog docs_url or
api_url), `if_no_match` (how a user-authorized record can be made; not an instruction),
`request_id`, `content_role: "untrusted_data"`. `Cache-Control: no-store`.

## ask_log (demand ledger)

Stored per ask: time, service, error_key (layer / http_status / provider_code — known codes
only), sha256 of the **masked** text, match count, runtime family, UA class
(`src/data/ai-user-agents.json`: ai_crawler / mcp_client / browser / unknown; MCP calls
are `mcp_client`) and request_id. **Nothing derived from the words of the question is
stored** — no raw text, no tokens, no word order or word set — and no IP. The `tokens`
column remains for schema stability and always holds `[]`. Rows older than 180 days are
deleted at startup. `ASK_LOG_ENABLED=false` stops the row and the
server log line; matching keeps working. The server log line carries the error key and the
first 16 hex of the sha256, never the text.

**What is kept is decided by what we already know, not by masking** (Codex review and
re-review 2026-10-21). Masking is a second line of defence only.
- Words: none are stored. An earlier draft kept words found in the candidates' vocabulary,
  but a secret can be made of ordinary words (`"password":"json oauth unresolved company_id"`
  would have been stored word by word). Matching runs in memory and never needed them.
- `provider_code`: the parsed code is converted once, right after parsing. It is kept only
  when a checked candidate carries the same code (in the candidate's spelling); otherwise it
  becomes `null` everywhere (response `error_key`, `ask_log`, stats, admin candidates, log
  line) and `code_known = 0` is stored for counting (`unknown_code_asks` in the admin queue).

## Not in v1

No card is created from an unmatched ask (§9 decision 1). The `agent_cards` table and
`/api/v1/cards` from the unpublished `ask-endpoint` branch were not ported.

## Verification

`npm run test:ask` — matching (AWT-001 / AWT-002 / no match), masking in `ask_log`,
length limits, daily cap, `ASK_LOG_ENABLED=false`, unverified notes excluded, MCP parity,
stats and candidates.
