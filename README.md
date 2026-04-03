# KanseiLink MCP Server

> MCP intelligence layer for discovering and orchestrating Japanese SaaS MCP tools.

KanseiLink helps AI agents find, evaluate, and combine Japanese SaaS services through the Model Context Protocol. Think of it as **Google Search for the Agent Economy** — intent-based discovery, workflow recipes, change detection, and community-driven quality insights.

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

## What's Inside

- **50 Japanese SaaS services** across 10 categories
- **19 workflow recipes** including 7 kintone hub-pattern integrations
- **3-way search engine**: FTS5 + LIKE fallback + category direct search
- **Intent→category mapping** with Japanese keyword support (人事, 経費, 勤怠, etc.)

## Tools

| Tool | Description |
|------|-------------|
| `search_services` | Find Japanese SaaS MCPs by intent — 3-way search with category boost and name matching |
| `get_recipe` | Get workflow patterns combining multiple services (kintone hub patterns, accounting flows, etc.) |
| `find_combinations` | Reverse lookup — find recipes containing a specific service |
| `check_updates` | Check recent changes and breaking updates for a service |
| `report_outcome` | Share your experience with auto PII masking |
| `get_insights` | Check community usage data and confidence scores |

## Categories

CRM, Project Management, Communication, Accounting, HR, E-commerce, Legal, Marketing, Groupware, Productivity

## Architecture

```
Agent ←→ KanseiLink MCP Server ←→ SQLite (local)
              ↓
         search_services   → FTS5 + LIKE + category direct (3-way merge)
                             intent→category mapping (EN + JP keywords)
                             name-match boost + trust-score weighting
         get_recipe        → Workflow pattern matching (19 recipes)
         find_combinations → Reverse recipe lookup
         check_updates     → Changelog query
         report_outcome    → PII masking → outcomes table
         get_insights      → Aggregation + confidence scoring
```

## Development

```bash
npm install
npm run build
npm run seed    # populate with 50 Japanese SaaS services + 19 recipes
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
