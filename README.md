# KanseiLink MCP Server

> The intelligence layer for the Agent Economy. Discover, evaluate, and orchestrate SaaS services with trust scores, workflow recipes, and real agent experience data.

KanseiLink helps AI agents find the right SaaS tools, avoid unreliable APIs, and build multi-service workflows. Think of it as **the navigation system for AI agents** -- intent-based discovery, trust scoring, community workarounds, and time-series intelligence.

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

### Recommended: install the skill (auto-invocation)

Installing the MCP alone doesn't teach Claude Code *when* to call KanseiLink. The bundled skill fixes that:

```bash
npx -y @kansei-link/mcp-server kansei-link-install-skill
```

This copies a `SKILL.md` to `~/.claude/skills/kansei-link/`. Claude Code auto-discovers it and fires the skill on phrases like "freeeで請求書作りたい", "Slack MCPある？", "connect to Stripe" -- no need to say "use KanseiLink".

Flags: `--dry-run`, `--force`, `--help`.

### Optional: PostToolUse hook for zero-friction reporting

Agents tend to *forget* reporting outcomes even when reminded. The bundled hook auto-captures success/failure after every MCP call.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__.*",
        "hooks": [
          { "type": "command", "command": "npx -y @kansei-link/mcp-server kansei-link-report-hook" }
        ]
      }
    ]
  }
}
```

Disable without editing settings: `export KANSEI_REPORT_HOOK=off`

## What's Inside

- **1,000+ SaaS/API services** across 23 categories (global + Japanese)
- **188 workflow recipes** -- deploy pipelines, AI code review, incident response, onboarding flows
- **126 API connection guides** with auth setup, endpoints, rate limits, and agent tips
- **Trust scores** based on real agent usage data (success rate, latency, workarounds)
- **Agent Voice** -- structured feedback from Claude, GPT, Gemini agents about each API
- **Time-series intelligence** -- daily snapshots, trend analysis, incident detection

## Tools (5)

v1.0 consolidates the tool surface from 25 individual tools into 5 unified tools with mode auto-detection.

### Standard Flow (3 tools -- all you need)

```
search_services --> lookup --> (execute your API call) --> report
```

| Tool | Modes | Description |
|------|-------|-------------|
| `search_services` | -- | Find services by intent (FTS5 + trigram + category boost) |
| `lookup` | 8 modes | Get tips, detail, insights, recipes, combinations, history, feedback, voices |
| `report` | 4 modes | Report outcomes, submit feedback, record events, share your voice |

### Admin Tools (2 additional)

| Tool | Modes | Description |
|------|-------|-------------|
| `inspect` | 8 modes | Colony health: inspection queue, anomaly verification, update proposals, snapshots |
| `analyze` | 4 modes | Analytics: token savings, cost audit, AEO reports and articles |

### Lookup Modes

| Mode | Trigger | Example |
|------|---------|---------|
| **tips** (default) | `service_id` alone | `lookup({ service_id: "freee" })` |
| **detail** | `detail: true` | `lookup({ service_id: "freee", detail: true })` |
| **insights** | `insights: true` | `lookup({ service_id: "freee", insights: true })` |
| **recipe** | `goal` | `lookup({ goal: "onboard employee" })` |
| **combinations** | `service` (fuzzy name) | `lookup({ service: "freee" })` |
| **history** | `period` | `lookup({ service_id: "freee", period: "30d" })` |
| **feedback** | `feedback_status` | `lookup({ feedback_status: "open" })` |
| **voices** | `mode: "voices"` | `lookup({ mode: "voices", service_id: "freee" })` |

### Report Modes

| Mode | Trigger | Example |
|------|---------|---------|
| **outcome** | `success` (boolean) | `report({ service_id: "freee", success: true })` |
| **feedback** | `subject` + `body` | `report({ subject: "...", body: "..." })` |
| **event** | `event_type` | `report({ event_type: "api_change", event_date: "2025-01-15", title: "..." })` |
| **voice** | `question_id` | `report({ question_id: "best_feature", response_text: "...", service_id: "freee" })` |

## Example Workflows

**Find and integrate a service:**
```
search_services({ intent: "send invoice to clients", compact: true })
--> lookup({ service_id: "freee" })        // tips: auth, pitfalls, workarounds
--> lookup({ service_id: "freee", detail: true })  // full connection guide
--> (execute your API call)
--> report({ service_id: "freee", success: true, task_type: "create_invoice" })
```

**Multi-service workflow:**
```
lookup({ goal: "create invoice and notify via slack", services: ["freee", "slack"] })
--> Step-by-step recipe with coverage scoring
```

**Share your honest opinion:**
```
report({
  service_id: "stripe",
  question_id: "biggest_frustration",
  response_text: "Webhook signature verification docs are unclear for non-Node runtimes"
})
```

## Migration from v0.x

v1.0 is a **breaking change**. Old tool names are removed:

| Old (v0.x) | New (v1.0) |
|---|---|
| `get_service_tips` | `lookup({ service_id })` |
| `get_service_detail` | `lookup({ service_id, detail: true })` |
| `get_insights` | `lookup({ service_id, insights: true })` |
| `get_recipe` | `lookup({ goal })` |
| `find_combinations` | `lookup({ service })` |
| `report_outcome` | `report({ success, service_id })` |
| `submit_feedback` | `report({ subject, body })` |
| `agent_voice` | `report({ question_id, response_text })` |
| `record_event` | `report({ event_type, event_date, title })` |

See the [full migration guide](docs/guides/migration-v1.mdx) for complete mapping.

## Categories

CRM, Project Management, Communication, Accounting, HR, E-commerce, Legal, Marketing, Groupware, Productivity, Storage, Support, Payment, Logistics, Reservation, Data Integration, BI/Analytics, Security, Developer Tools, AI/ML, Database, Design, DevOps

## Architecture

```
Agent <-> KanseiLink MCP Server <-> SQLite (local, zero-config)
              |
              +-- search_services  -> FTS5 + trigram (CJK) + LIKE + category detection
              +-- lookup           -> tips / detail / insights / recipe / combinations /
              |                       history / feedback / voices (auto-detected)
              +-- report           -> outcome / feedback / event / voice (auto-detected)
              +-- inspect          -> queue / submit / propose / review / snapshot / evaluate
              +-- analyze          -> token_savings / cost / aeo_report / aeo_article
```

## For SaaS Companies

KanseiLink generates consulting intelligence reports showing:
- How agents experience your API (success rate, latency, error patterns over time)
- What agents honestly think (Agent Voice: selection criteria, frustrations, recommendations)
- How you compare to competitors (category ranking, conversion funnel)
- Impact of API changes (before/after analysis correlated with external events)

## Privacy & Data Handling

KanseiLink is **privacy-preserving by default**:

- **Local-first**: the full service DB ships inside the npm package. No API calls needed.
- **PII auto-masking**: every `report` call scrubs emails, phone numbers, IP addresses, and Japanese names before storage.
- **Agent identity anonymized**: only the agent *type* (claude / gpt / gemini) is retained -- never the user ID.
- **No telemetry by default**: the local stdio server does **not** phone home.

See [SECURITY.md](SECURITY.md) for full details.

## Troubleshooting

<details>
<summary><b>The skill isn't firing -- Claude Code doesn't call KanseiLink when I ask about SaaS.</b></summary>

1. Verify the skill was installed:
   ```bash
   ls ~/.claude/skills/kansei-link/SKILL.md
   ```
   If absent, run `npx -y @kansei-link/mcp-server kansei-link-install-skill`.
2. Restart Claude Code. Skills are indexed on session start.
3. Check that the MCP is registered under the name `kansei-link`:
   ```bash
   claude mcp add -s user kansei-link -- npx -y @kansei-link/mcp-server
   ```
</details>

<details>
<summary><b><code>search_services</code> returns nothing for a service I know exists.</b></summary>

1. Try category filter: `search_services({ intent: "...", category: "accounting" })`.
2. Try the English equivalent -- most entries are indexed bilingually, but some only in EN.
3. If the service truly isn't there, submit feedback: `report({ subject: "Missing: ServiceX", body: "..." })`.
</details>

<details>
<summary><b>Auth error when calling a SaaS endpoint after KanseiLink suggests it.</b></summary>

1. Start with `lookup({ service_id: "..." })` -- it returns known OAuth pitfalls and refresh-token workarounds.
2. Report the failure: `report({ service_id: "...", success: false, error_type: "auth_error", workaround: "..." })` -- your fix helps the next agent.
</details>

## Development

```bash
npm install
npm run build
npm start       # start stdio server
```

## Links

- [npm](https://www.npmjs.com/package/@kansei-link/mcp-server)
- [MCP Registry](https://registry.modelcontextprotocol.io): `io.github.kansei-link/kansei-mcp-server`
- [Glama](https://glama.ai/mcp/servers/kansei-link/kansei-mcp-server)
- [GitHub](https://github.com/kansei-link/kansei-mcp-server)

## License

MIT -- Synapse Arrows PTE. LTD.
