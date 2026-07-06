# KanseiLink MCP Server

[![npm version](https://img.shields.io/npm/v/%40kansei-link%2Fmcp-server)](https://www.npmjs.com/package/@kansei-link/mcp-server) [![npm downloads](https://img.shields.io/npm/dm/%40kansei-link%2Fmcp-server)](https://www.npmjs.com/package/@kansei-link/mcp-server) [![GitHub stars](https://img.shields.io/github/stars/kansei-link/kansei-mcp-server?style=social)](https://github.com/kansei-link/kansei-mcp-server)

> Local-first MCP navigator for AI agents. Find, evaluate, and compose MCP tools -- 80% fewer tokens vs trial-and-error.

Your agent wastes thousands of tokens every time it hits a new MCP service: searching docs, guessing auth flows, recovering from errors. KanseiLink eliminates that loop with a local SQLite DB of pre-evaluated services, trust scores, and step-by-step recipes.

**Token savings: 89-97% measured across 7 services** (avg ~16,800 tokens without → ~950 with KanseiLink).

If KanseiLink saves your agent tokens, [give it a star ⭐](https://github.com/kansei-link/kansei-mcp-server) — 700+ developers install it from npm every month, and stars are how the next one finds it.

## Quick Start

```bash
npx @kansei-link/mcp-server
```

Works with **Claude Code, Cursor, Cline, Zed, Windsurf** -- any MCP client.

Add to your config (`claude_desktop_config.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "kansei-link": {
      "command": "npx",
      "args": ["-y", "@kansei-link/mcp-server"]
    }
  }
}
```

Or with Claude Code CLI:

```bash
claude mcp add -s user kansei-link -- npx -y @kansei-link/mcp-server
```

## What's Inside

| | Count | Description |
|---|---|---|
| Services | **11,000+** | MCP servers and SaaS APIs across 23 categories (2,257 MCP-verified via handshake) |
| Recipes | **200** | Multi-service workflow compositions (standup, PR review, incident response, onboarding...) |
| API Guides | **199** | Auth setup, endpoints, rate limits, pitfalls, and workarounds |
| Trust Scores | **Weekly** | Based on automated health probes + real agent usage data |

All data ships inside the npm package as a local SQLite DB. **Zero API calls needed.** No server dependency, no signup.

## Why Not Just Read the Docs?

| Without KanseiLink | With KanseiLink |
|---|---|
| `web_search` "freee API auth" | `search_services({ intent: "send invoice" })` |
| `web_fetch` docs landing page (SPA, mostly nav) | `lookup({ service_id: "freee" })` |
| `web_fetch` endpoint reference | Agent has auth flow, pitfalls, workarounds |
| `web_fetch` auth guide | in **~950 tokens** |
| Trial-and-error on wrong params | First try succeeds |
| **~16,800 tokens burned** | **89-97% saved** |

### Claude Code: install the skill (auto-invocation)

Installing the MCP alone doesn't teach Claude Code *when* to call KanseiLink. The bundled skill fixes that:

```bash
npx -y @kansei-link/mcp-server kansei-link-install-skill
```

This copies a `SKILL.md` to `~/.claude/skills/kansei-link/`. Claude Code auto-discovers it and fires the skill on phrases like "connect to Stripe", "Slack MCPある？", "send invoice via freee" -- no need to say "use KanseiLink".

### Optional: PostToolUse hook

Auto-capture success/failure after every MCP call (agents tend to forget reporting).

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "mcp__.*",
      "hooks": [{ "type": "command", "command": "npx -y @kansei-link/mcp-server kansei-link-report-hook" }]
    }]
  }
}
```

Disable anytime: `export KANSEI_REPORT_HOOK=off`

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

## Categories (23)

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

KanseiLink can generate intelligence reports showing how AI agents experience your API:
- Success rate, latency, error patterns over time
- Agent Voice: selection criteria, frustrations, recommendations
- Category ranking vs competitors
- Impact of API changes (before/after analysis)

Interested? See [kansei-link.com](https://kansei-link.com) or reach out.

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

## Contributing

```bash
git clone https://github.com/kansei-link/kansei-mcp-server.git
cd kansei-mcp-server
npm install
npm run build
npm start       # start stdio server
```

PRs welcome. If you find a service that's missing or has wrong info, the fastest path is:

```
report({ subject: "Fix: ServiceX auth is OAuth2 not API key", body: "..." })
```

## Links

- [npm](https://www.npmjs.com/package/@kansei-link/mcp-server)
- [Website](https://kansei-link.com)
- [MCP Registry](https://registry.modelcontextprotocol.io): `io.github.kansei-link/kansei-mcp-server`
- [Glama](https://glama.ai/mcp/servers/kansei-link/kansei-mcp-server)

## License

MIT -- [Synapse Arrows PTE. LTD.](https://kansei-link.com)
