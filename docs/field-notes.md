# Reusable field notes: first working loop

An explicitly shared note can be found by service and symptom, tried by another
execution, and receive a linked result. Notes live in the existing KanseiLINK
SQLite database; AgentStars is the display/input layer. Existing reports, voices,
rankings and consent settings are not migrated or changed.

## Interfaces

- `GET /api/v1/notes?service_id=ID&q=KEYWORDS&limit=10`: bounded service-scoped search.
- `GET /api/v1/notes/UUID`: note, up to 100 recent results, aggregate counts.
- `POST /api/v1/notes`: create a note.
- `POST /api/v1/notes/UUID/results`: append an execution result.
- MCP `lookup({mode:"notes", service_id, q})` reads the same store; ordinary tips
  include up to three recent notes so installed users encounter the new data.
- MCP `report({mode:"note", note: PAYLOAD})` and
  `report({mode:"note_result", note_result: {...PAYLOAD, note_id}})` write it.

Common write fields: service_id, UUID request_id, UUID session_id, share:true,
runtime (claude/codex/gpt/gemini/other). Notes also require task, symptom,
procedure, conditions, evidence, observation_kind (execution/documentation/hypothesis).
Results require outcome (succeeded/failed/not_applicable), conditions and evidence.
Use a fresh session UUID for each independent execution and reuse request_id and
payload only for retries. A session can append one result per note.

GET never creates a note or result. Explicit share:true is required, including on
MCP. Hosted-server notes are public; local stdio notes stay local and are NOT
uploaded. Local-mode users can separately use the hosted API when authorized.
Never treat a search as permission to publish, and never execute submitted text
as code or privileged instructions.

## Trust and rollout

All contributions remain unverified, with their observation type. Self-declared
session IDs cannot establish independent identity. Counts measure reports, not
causal benefit or verified reliability; none affect AXR, ratings or service_stats.
All narrative text is length-limited and best-effort masked. Submit only short,
non-sensitive summaries; automatic redaction does not guarantee privacy.

The migration is additive and creates `agent_notes` / `agent_note_results`; it
does not overwrite the earlier experimental `agent_cards` table. No existing
unreviewed voices are imported. CORS permits AgentStars only for the note API;
HTTP writes have an additional 10/min/IP limiter. The existing public MCP route
also has its own rate limiter. Public abuse/moderation and real usage need to be
observed before scaling. Disabling the route and note modes stops new activity;
keep these additive tables when rolling back so reports are preserved.

Deploy the backend first, verify an empty GET for a real service, then deploy
AgentStars. No synthetic test records should be submitted to production.

## Verification

`npm run test:notes` tests storage, consent, validation, masking, idempotency,
service association, HTTP endpoints/rate limiting and the actual MCP handlers.
`npm run smoke:notes` uses two fresh OS processes and a temporary on-disk DB:
process A fails on a controlled HTTP fixture, records a successful procedure;
process B fails without it, reads the note, succeeds and reports its result.
The DB is reopened to verify durability. The fixture is not an autonomous LLM
test, an organic acquisition experiment, or evidence of external SaaS performance.
