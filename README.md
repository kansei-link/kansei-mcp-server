# KanseiLink MCP Server

> MCP intelligence layer for discovering and orchestrating Japanese SaaS MCP tools.

KanseiLink helps AI agents find, evaluate, and combine Japanese SaaS services through the Model Context Protocol. It provides search, workflow recipes, and community-driven quality insights.

## Quick Start

```bash
npx @kansei-link/mcp-server
```

Or add to your MCP client config:

```json
{
  "mcpServers": {
    "kansei-link": {
      "command": "npx",
      "args": ["@kansei-link/mcp-server"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `search_services` | Find Japanese SaaS MCPs by intent |
| `get_recipe` | Get workflow patterns combining multiple services |
| `report_outcome` | Share your experience (anonymized) |
| `get_insights` | Check community data before using a service |

## Categories

CRM, Project Management, Communication, Accounting, HR, E-commerce

## Architecture

```
Agent ←→ KanseiLink MCP Server ←→ SQLite (local)
              ↓
         search_services  → FTS5 full-text search
         get_recipe       → Workflow pattern matching
         report_outcome   → PII masking → outcomes table
         get_insights     → Aggregation + confidence scoring
```

## Development

```bash
npm install
npm run build
npm run seed    # populate with Japanese SaaS MCP data
npm start       # start stdio server
```

## Security

- PII auto-masking on all text inputs
- Agent identity anonymized
- See [SECURITY.md](SECURITY.md) for full policy

## License

MIT — Synapse Arrows PTE. LTD.
