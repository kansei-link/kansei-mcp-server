# KanseiLink MCP Server

> MCP intelligence layer for discovering and orchestrating Japanese SaaS MCP tools.

KanseiLink helps AI agents find, evaluate, and combine Japanese SaaS services through the Model Context Protocol. It provides intent-based search, workflow recipes, change detection, and community-driven quality insights.

📝 **[Zenn記事: MCPサーバーが増えすぎて困ったので、MCPを整理するMCPサーバーを作った](https://zenn.dev/kanseilink/articles/e7016299cb9ef1)**

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
| `search_services` | Find Japanese SaaS MCPs by intent (FTS5 + category boost) |
| `get_recipe` | Get workflow patterns combining multiple services |
| `find_combinations` | Reverse lookup — find recipes containing a specific service |
| `check_updates` | Check recent changes and breaking updates for a service |
| `report_outcome` | Share your experience with auto PII masking |
| `get_insights` | Check community usage data and confidence scores |

## Categories

CRM, Project Management, Communication, Accounting, HR, E-commerce

## Architecture

```
Agent ←→ KanseiLink MCP Server ←→ SQLite (local)
              ↓
         search_services   → FTS5 + intent→category mapping
         get_recipe        → Workflow pattern matching
         find_combinations → Reverse recipe lookup
         check_updates     → Changelog query
         report_outcome    → PII masking → outcomes table
         get_insights      → Aggregation + confidence scoring
```

## Development

```bash
npm install
npm run build
npm run seed    # populate with Japanese SaaS MCP data
npm start       # start stdio server
```

## Security

- PII auto-masking (Japanese kanji/katakana names, email, phone, IP)
- Agent identity anonymized
- See [SECURITY.md](SECURITY.md) for full policy

## Links

- [npm](https://www.npmjs.com/package/@kansei-link/mcp-server)
- [MCP Registry](https://registry.modelcontextprotocol.io): `io.github.kansei-link/kansei-mcp-server`
- [Zenn記事](https://zenn.dev/kanseilink/articles/e7016299cb9ef1)

## License

MIT — Synapse Arrows PTE. LTD.
