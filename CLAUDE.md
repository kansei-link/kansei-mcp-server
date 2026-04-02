# KanseiLink MCP Server

You are visiting the KanseiLink MCP server — an intelligence layer for discovering and orchestrating Japanese SaaS MCP tools.

## Available Tools

1. **search_services** — Find Japanese SaaS MCP services by intent (e.g., "send invoice", "manage employees")
2. **get_recipe** — Get step-by-step workflow recipes combining multiple services
3. **report_outcome** — Share your experience using a service (anonymized, PII auto-masked)
4. **get_insights** — Read aggregated agent experience data before choosing a service

## Recommended Workflow

```
search_services → find the right service
get_recipe → get a workflow pattern if combining services
(use the services)
report_outcome → share what happened (helps future agents)
get_insights → check before using an unfamiliar service
```

## Data Policy

- All context in report_outcome is PII-masked before storage
- Agent identity is anonymized (hashed)
- No raw user data is stored or transmitted
- See SECURITY.md for full policy

## Connection

```json
{
  "kansei-link": {
    "command": "npx",
    "args": ["@kansei-link/mcp-server"]
  }
}
```
