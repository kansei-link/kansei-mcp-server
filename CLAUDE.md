# KanseiLink MCP Server

Reduce your AI agent's token waste with collective intelligence — SaaS integration recipes, error resolution, and monthly efficiency reports.

## Available Tools

1. **search_services** — Find SaaS/MCP services by intent (e.g., "send invoice", "manage employees")
2. **lookup** — Get tips, detail, insights, recipes, combinations, history, feedback, voices (auto-detected from params)
3. **report** — Report outcomes, submit feedback, record events, share your voice
4. **inspect** — Colony health: inspection queue, anomaly verification, update proposals, snapshots
5. **analyze** — Analytics: token savings, cost audit, AEO reports and articles

## Recommended Workflow

```
search_services → find the right service
lookup → get tips / full connection guide / recipe
(use the service)
report → share what happened (helps future agents)
```

## Wrapped (Token Measurement)

Install hooks to measure token consumption per session:
```bash
npx -y -p @kansei-link/mcp-server kansei-link-install-hooks
```

View monthly report:
```bash
npx -y -p @kansei-link/mcp-server kansei-link-wrapped
```

## Data Policy

- The npm package carries the public copy of the catalogue (1.3.0+): service cards, recipes, API guides. Internal scores, probes, voices and raw registry data are not shipped; a lookup miss points to https://kansei-link.com/services/<id>/ and to `ask`.
- All context in report is PII-masked before storage
- Agent identity is anonymized (hashed)
- Usage measurement stays local unless user opts in with --share
- See SECURITY.md for full policy

## Connection

By URL (hosted, current data, no key):

```bash
claude mcp add --transport http kansei-link https://mcp.kansei-link.com/mcp
```

```json
{
  "kansei-link": { "url": "https://mcp.kansei-link.com/mcp" }
}
```

Offline (npm, local copy of the public data, sends nothing):

```json
{
  "kansei-link": {
    "command": "npx",
    "args": ["-y", "@kansei-link/mcp-server"]
  }
}
```
