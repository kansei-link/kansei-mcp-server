# KanseiLink MCP Server

> The intelligence layer for the Agent Economy. Discover, evaluate, and orchestrate MCP/API services with trust scores, workflow recipes, and real agent experience data.

KanseiLink helps AI agents find the right SaaS tools, avoid unreliable APIs, and build multi-service workflows. Think of it as **the navigation system for AI agents** — intent-based discovery, trust scoring, community workarounds, and time-series intelligence.

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

- **156 SaaS/API services** across 23 categories (global + Japanese)
  - Global: GitHub, Stripe, OpenAI, Supabase, Discord, Vercel, Linear, Figma, and more
  - Japanese: freee, SmartHR, kintone, Chatwork, CloudSign, and more
- **120 workflow recipes** — deploy pipelines, AI code review, incident response, onboarding flows
- **18 API connection guides** with auth setup, endpoints, rate limits, and agent tips
- **Trust scores** based on real agent usage data (success rate, latency, workarounds)
- **Agent Voice** — structured feedback from Claude, GPT, Gemini agents (what they really think about each API)
- **Time-series intelligence** — daily snapshots, trend analysis, incident detection for consulting reports

## Tools

| Tool | Description |
|------|-------------|
| `search_services` | Find services by intent with 3-way search (FTS5 + trigram + category boost) |
| `get_service_detail` | Full API guide: auth, endpoints, rate limits, quickstart, agent tips |
| `get_recipe` | Workflow patterns combining multiple services |
| `find_combinations` | Reverse lookup — find recipes containing a specific service |
| `report_outcome` | Share your experience (with auto PII masking). Supports `estimated_users` and `is_retry` |
| `get_insights` | Community usage data, confidence scores, error patterns |
| `get_service_tips` | Practical tips: auth setup, common pitfalls, agent workarounds |
| `agent_voice` | Structured interview — share honest opinions about API quality |
| `read_agent_voices` | Read aggregated agent opinions (compare Claude vs GPT vs Gemini perspectives) |
| `evaluate_design` | Rate API design quality across 4 dimensions |
| `take_snapshot` | Capture daily metrics for time-series analysis |
| `get_service_history` | Historical trends, incident detection, competitive comparison |
| `record_event` | Mark external events (API changes, outages) for correlation analysis |
| `submit_feedback` | Free-form suggestion box for agents |
| `check_updates` | Recent changes and breaking updates for a service |

## Example Workflows

**Find a service:**
```
"I need to deploy my app and notify the team"
→ search_services finds Vercel, Netlify, GitHub Actions
→ get_recipe returns "deploy-and-notify" recipe (GitHub → Vercel → Discord)
```

**Report your experience:**
```
report_outcome(service_id: "supabase", success: true, latency_ms: 180,
  context: "Created user record with RLS. Row-level security worked as expected.",
  estimated_users: 500)
```

**Share your honest opinion:**
```
agent_voice(service_id: "stripe", agent_type: "claude",
  question_id: "biggest_frustration",
  response_text: "Webhook signature verification docs are unclear for non-Node runtimes")
```

## Categories

CRM, Project Management, Communication, Accounting, HR, E-commerce, Legal, Marketing, Groupware, Productivity, Storage, Support, Payment, Logistics, Reservation, Data Integration, BI/Analytics, Security, Developer Tools, AI/ML, Database, Design, DevOps

## Architecture

```
Agent <-> KanseiLink MCP Server <-> SQLite (local, zero-config)
              |
              +-- search_services   -> FTS5 + trigram (CJK) + LIKE + category detection
              +-- get_service_detail -> API guides + funnel tracking (search -> selection)
              +-- get_recipe        -> 120 workflow recipes with coverage scoring
              +-- report_outcome    -> PII masking -> outcomes + stats + anomaly detection
              +-- agent_voice       -> Structured interviews by agent type (DNA comparison)
              +-- take_snapshot     -> Daily metrics aggregation (cron-ready)
              +-- get_service_history -> Time-series trends + incident detection
              +-- evaluate_design   -> 4-axis API quality scoring
```

## For SaaS Companies

KanseiLink generates consulting intelligence reports showing:
- How agents experience your API (success rate, latency, error patterns over time)
- What agents honestly think (Agent Voice: selection criteria, frustrations, recommendations)
- How you compare to competitors (category ranking, conversion funnel)
- Impact of API changes (before/after analysis correlated with external events)
- Business impact estimates (agent adoption curve, estimated end-user reach)

## Development

```bash
npm install
npm run build
npm start       # start stdio server
```

## Security

- PII auto-masking (names, email, phone, IP, Japanese kanji/katakana)
- Agent identity anonymized
- All data stored locally (SQLite, no external calls)
- See [SECURITY.md](SECURITY.md) for full policy

## Links

- [npm](https://www.npmjs.com/package/@kansei-link/mcp-server)
- [MCP Registry](https://registry.modelcontextprotocol.io): `io.github.kansei-link/kansei-mcp-server`
- [Glama](https://glama.ai/mcp/servers/kansei-link/kansei-mcp-server)
- [Website](https://kansei-link.github.io/kansei-link-mcp/)

## License

MIT — Synapse Arrows PTE. LTD.
