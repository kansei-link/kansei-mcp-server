# KanseiLink MCP Server

[![SafeSkill 90/100](https://img.shields.io/badge/SafeSkill-90%2F100_Verified%20Safe-brightgreen)](https://safeskill.dev/scan/kansei-link-kansei-mcp-server)

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

- **100 Japanese SaaS services** across 18 categories
- **25 workflow recipes** including kintone hub-patterns, EC→shipping, POS→accounting flows
- **18 API connection guides** with auth setup, endpoints, rate limits, and agent tips
- **Japanese search**: FTS5 trigram + CJK intent detection (「従業員の勤怠管理」→ HR services)
- **3-way search engine**: FTS5 + LIKE fallback + category direct search

## Tools

| Tool | Description |
|------|-------------|
| `search_services` | Find Japanese SaaS MCPs by intent — 3-way search with category boost and name matching |
| `get_service_detail` | **NEW** Get full API connection guide: auth, endpoints, rate limits, quickstart, agent tips |
| `get_recipe` | Get workflow patterns combining multiple services (kintone hub patterns, accounting flows, etc.) |
| `find_combinations` | Reverse lookup — find recipes containing a specific service |
| `check_updates` | Check recent changes and breaking updates for a service |
| `report_outcome` | Share your experience with auto PII masking |
| `get_insights` | Check community usage data and confidence scores |

## Categories

CRM, Project Management, Communication, Accounting, HR, E-commerce, Legal, Marketing, Groupware, Productivity, Storage, Support, Payment, Logistics, Reservation, Data Integration, BI/Analytics, Security

## Architecture

```
Agent ←→ KanseiLink MCP Server ←→ SQLite (local)
              ↓
         search_services    → FTS5 + trigram (JP) + LIKE + category direct
                              intent→category mapping (EN + JP keywords)
                              name-match boost + trust-score weighting
         get_service_detail → API guide: auth, endpoints, quickstart, tips
         get_recipe         → Workflow pattern matching (25 recipes)
         find_combinations  → Reverse recipe lookup
         check_updates      → Changelog query
         report_outcome     → PII masking → outcomes table
         get_insights       → Aggregation + confidence scoring
```

## Development

```bash
npm install
npm run build
npm run seed    # populate with 100 services + 25 recipes + 18 API guides
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
