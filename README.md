# KanseiLink MCP Server

[![npm version](https://img.shields.io/npm/v/%40kansei-link%2Fmcp-server)](https://www.npmjs.com/package/@kansei-link/mcp-server) [![npm downloads](https://img.shields.io/npm/dm/%40kansei-link%2Fmcp-server)](https://www.npmjs.com/package/@kansei-link/mcp-server) [![GitHub stars](https://img.shields.io/github/stars/kansei-link/kansei-mcp-server?style=social)](https://github.com/kansei-link/kansei-mcp-server)

> Reduce your AI agent's token waste with collective intelligence.

Your agent burns tokens on three things: **searching** for SaaS docs it could look up locally, **retrying** errors other agents already solved, and **re-reading** context it already processed. KanseiLink tackles the first two — and measures all three so you know exactly where your tokens go.

**Measured savings: 89–97% on SaaS integration research** (avg ~16,800 tokens without → ~950 with KanseiLink, across 7 services).

## How It Works

```
Install MCP → agent wastes fewer tokens (lookup + collective intelligence)
                    ↓
            usage data stays local (opt-in: anonymous scalars only)
                    ↓
            collective intelligence grows → everyone's agent gets smarter
```

1. **Measure** — auto-installed hooks track every session: total tokens, cache split, error loops, stuck time. Nothing leaves your machine.
2. **Reduce** — SaaS lookup eliminates trial-and-error on API integrations. Error-resolution intelligence (coming soon) prevents repeat failures across the community.
3. **Compare** — opt-in monthly "Wrapped" report shows where your tokens went and how you rank among measured users.

If KanseiLink saves your agent tokens, [give it a star ⭐](https://github.com/kansei-link/kansei-mcp-server) — 700+ developers install it from npm every month, and stars are how the next one finds it.

## Quick Start

```bash
npx @kansei-link/mcp-server
```

Works with **Claude Code, Cursor, Cline, Zed, Windsurf** — any MCP client.

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

## Wrapped: Your Monthly Agent Fuel-Efficiency Report

KanseiLink measures — locally, on your machine — how many tokens your
agent sessions consume and how much of that KanseiLink saved you, then
renders a monthly "Wrapped" share card.

**1. Install the measurement hooks** (one command, idempotent, backs up
your settings first):

```bash
npx -y @kansei-link/mcp-server kansei-link-install-hooks
```

This adds a `Stop`/`SessionEnd` hook that parses each session transcript
and writes token totals + KanseiLink call stats to
`~/.kansei-link/usage/`. **Nothing is uploaded.**

**2. See your report** any time:

```bash
npx -y @kansei-link/mcp-server kansei-link-wrapped            # current month (JA)
npx -y @kansei-link/mcp-server kansei-link-wrapped --lang en  # English
npx -y @kansei-link/mcp-server kansei-link-wrapped --share    # opt-in: get your rank
```

The report separates **measured** numbers (your total tokens, KanseiLink
call counts and response sizes — parsed from your own transcripts) from
**estimated** ones (the avoided web-research cost, based on the 2026-04-16
freee/kintone/smarthr benchmark) — labels shown on every surface.

It also shows where your agent got **stuck**: failed tool calls, retry
chains (2+ consecutive failures of the same tool), the tokens burned
while stuck, and your worst-failing tools.

`--share` submits only scalar monthly aggregates (anonymous id + token
counts, never content) and returns how you rank among measured users
("top X% saver"). Below 20 measured users for the month, you get the
cohort size instead of a rank.

Disable measurement anytime: `export KANSEI_USAGE_HOOK=off`, or
`kansei-link-install-hooks --remove`.

## SaaS Integration Intelligence

The core reason agents waste tokens on SaaS APIs: they search docs, guess auth flows, and recover from errors — every single time. KanseiLink ships a local SQLite DB so your agent gets the answer on the first try.

| | Count | Description |
|---|---|---|
| Services | **11,000+** | MCP servers and SaaS APIs across 23 categories (2,257 MCP-verified via handshake) |
| Recipes | **200** | Multi-service workflow compositions (standup, PR review, incident response, onboarding...) |
| API Guides | **199** | Auth setup, endpoints, rate limits, pitfalls, and workarounds |
| Trust Scores | **Weekly** | Based on automated health probes + real agent usage data |

All data ships inside the npm package as a local SQLite DB. **Zero API calls needed.** No server dependency, no signup.

### Without vs. With KanseiLink

| Without KanseiLink | With KanseiLink |
|---|---|
| `web_search` "freee API auth" | `search_services({ intent: "send invoice" })` |
| `web_fetch` docs landing page (SPA, mostly nav) | `lookup({ service_id: "freee" })` |
| `web_fetch` endpoint reference | Agent has auth flow, pitfalls, workarounds |
| `web_fetch` auth guide | in **~950 tokens** |
| Trial-and-error on wrong params | First try succeeds |
| **~16,800 tokens burned** | **89–97% saved** |

### Claude Code: install the skill (auto-invocation)

Installing the MCP alone doesn't teach Claude Code *when* to call KanseiLink. The bundled skill fixes that:

```bash
npx -y @kansei-link/mcp-server kansei-link-install-skill
```

This copies a `SKILL.md` to `~/.claude/skills/kansei-link/`. Claude Code auto-discovers it and fires the skill on phrases like "connect to Stripe", "Slack MCPある？", "send invoice via freee" — no need to say "use KanseiLink".

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

### Standard Flow (3 tools — all you need)

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

KanseiLink doubles as an **Agent Readiness Index (ARI)** evaluation platform. Real agents using real APIs generate objective telemetry — success rates, latency, error patterns, and resolution paths — that no survey or benchmark can replicate.

What we can show you:
- **Agent success rate** for your API over time
- **Error patterns** and how agents work around them
- **Agent Voice**: why agents choose (or avoid) your service
- **Category ranking** vs competitors
- **Impact of API changes** (before/after analysis)

This data comes from the same MCP that saves individual developers tokens — the collective intelligence that helps agents is the same signal that evaluates services.

See [kansei-link.com](https://kansei-link.com) or reach out.

## Privacy & Data Handling

KanseiLink is **privacy-preserving by default**:

- **Local-first**: the full service DB ships inside the npm package. No API calls needed.
- **Measurement stays local**: the usage hook writes to `~/.kansei-link/usage/` on your machine. Nothing is uploaded unless you opt in with `--share`, which sends only scalar aggregates (token counts), never content.
- **PII auto-masking**: every `report` call scrubs emails, phone numbers, IP addresses, and Japanese names before storage.
- **Agent identity anonymized**: only the agent *type* (claude / gpt / gemini) is retained — never the user ID.
- **No telemetry by default**: the local stdio server does **not** phone home.

See [SECURITY.md](SECURITY.md) for full details.

## Troubleshooting

<details>
<summary><b>The skill isn't firing — Claude Code doesn't call KanseiLink when I ask about SaaS.</b></summary>

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
2. Try the English equivalent — most entries are indexed bilingually, but some only in EN.
3. If the service truly isn't there, submit feedback: `report({ subject: "Missing: ServiceX", body: "..." })`.
</details>

<details>
<summary><b>Auth error when calling a SaaS endpoint after KanseiLink suggests it.</b></summary>

1. Start with `lookup({ service_id: "..." })` — it returns known OAuth pitfalls and refresh-token workarounds.
2. Report the failure: `report({ service_id: "...", success: false, error_type: "auth_error", workaround: "..." })` — your fix helps the next agent.
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

MIT — [Synapse Arrows PTE. LTD.](https://kansei-link.com)
