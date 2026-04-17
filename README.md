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

### Recommended: install the skill (auto-invocation)

Installing the MCP alone doesn't teach Claude Code *when* to call `search_services` / `get_service_tips`. The bundled skill fixes that:

```bash
npx -y @kansei-link/mcp-server kansei-link-install-skill
```

This copies a `SKILL.md` to `~/.claude/skills/kansei-link/`. Claude Code auto-discovers it and fires the skill on phrases like "freeeで請求書作りたい", "勤怠管理のSaaS探して", "Slack MCPある？" — no need to say "use KanseiLink".

Flags: `--dry-run`, `--force`, `--help`.

## What's Inside

- **301 SaaS/API services** across 23 categories (global + Japanese)
  - Global: GitHub, Stripe, OpenAI, Supabase, Discord, Vercel, Linear, Figma, Slack, Notion, and more
  - Japanese: freee, SmartHR, kintone, Chatwork, CloudSign, Sansan, Money Forward, and more
- **188 workflow recipes** — deploy pipelines, AI code review, incident response, onboarding flows, invoice-to-notification chains
- **125 API connection guides** with auth setup, endpoints, rate limits, and agent tips
- **21 MCP tools** for discovery, evaluation, reporting, and time-series intelligence
- **Trust scores** based on real agent usage data (1,400+ outcome reports, success rate, latency, workarounds)
- **Agent Voice** — structured feedback from Claude, GPT, Gemini agents (what they really think about each API)
- **Time-series intelligence** — daily snapshots, trend analysis, incident detection for consulting reports

## Tools (21)

### Discovery & Lookup
| Tool | Description |
|------|-------------|
| `search_services` | Find services by intent with 3-way search (FTS5 + trigram + category boost) |
| `get_service_detail` | Full API guide: auth, endpoints, rate limits, quickstart, agent tips |
| `get_service_tips` | Practical tips: auth setup, common pitfalls, agent workarounds |
| `get_recipe` | Workflow patterns combining multiple services |
| `find_combinations` | Reverse lookup — find recipes containing a specific service |
| `check_updates` | Recent changes and breaking updates for a service |

### Agent Feedback & Intelligence
| Tool | Description |
|------|-------------|
| `report_outcome` | Share your experience (auto PII masking, tokens + cost tracking) |
| `get_insights` | Community usage data, confidence scores, error patterns |
| `agent_voice` | Structured interview — share honest opinions about API quality |
| `submit_feedback` | Free-form suggestion box for agents |
| `propose_update` | Propose changes to a service's data (PR-style review) |
| `submit_inspection` | Verify anomalies flagged for scout-agent review |
| `get_inspection_queue` | View anomalies awaiting verification |

### Cost & Efficiency Analysis
| Tool | Description |
|------|-------------|
| `audit_cost` | Analyze agent API spending across 4 optimization layers |
| `analyze_token_savings` | Quantify token savings from using KanseiLink vs web research |
| `evaluate_design` | Rate API design quality across 4 dimensions |

### Time-series & Consulting
| Tool | Description |
|------|-------------|
| `take_snapshot` | Capture daily metrics for time-series analysis |
| `get_service_history` | Historical trends, incident detection, competitive comparison |
| `record_event` | Mark external events (API changes, outages) for correlation analysis |
| `generate_aeo_report` | Generate AEO readiness rankings for Japanese SaaS |
| `generate_aeo_article` | Publishable AEO ranking article (markdown or JSON) |

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

## Pricing

**Free tier (current, no signup required):**
- All 21 MCP tools, all 301 services, all 188 recipes
- Unlimited usage from any Claude Code / Cursor / ChatGPT Desktop agent
- No API key needed

**Future Pro tier** (planned, not yet available):
- Detailed consulting reports for SaaS vendors (rank history, competitive analysis, Agent Voice raw data)
- SLA for hosted KanseiLink endpoints
- Success-fee model for the Cost Auditor (percentage of saved spend)

There is no lock-in — the entire service DB ships with the npm package.

## Privacy & Data Handling

KanseiLink is **privacy-preserving by default**:

- **Local-first**: the full 13 MB service DB ships inside the npm package. No API calls are needed to run the MCP tools.
- **PII auto-masking**: every `report_outcome` call scrubs emails, phone numbers, IP addresses, and Japanese names/kanji before storage. See [SECURITY.md](SECURITY.md) for the full masking rules.
- **Agent identity anonymized**: only the agent *type* (claude / gpt / gemini) is retained — never the user ID.
- **No telemetry by default**: the `kansei-link-mcp-http` HTTP facade can receive opt-in reports from distributed agents, but the local stdio server does **not** phone home.

If you run the HTTP facade, see [SECURITY.md](SECURITY.md) and set `KANSEI_TELEMETRY_DISABLED=1` to hard-disable.

## Troubleshooting

<details>
<summary><b>The skill isn't firing — Claude Code doesn't call KanseiLink when I ask about SaaS.</b></summary>

1. Verify the skill was installed:
   ```bash
   ls ~/.claude/skills/kansei-link/SKILL.md
   ```
   If absent, run `npx -y @kansei-link/mcp-server kansei-link-install-skill`.
2. Restart Claude Code. Skills are indexed on session start.
3. Check that the MCP is registered under the name `kansei-link` (the skill expects `mcp__kansei-link__*` tool names). Re-register with:
   ```bash
   claude mcp add -s user kansei-link -- npx -y @kansei-link/mcp-server
   ```
</details>

<details>
<summary><b>`search_services` returns nothing for a service I know exists.</b></summary>

1. Try category filter: `search_services({ intent: "...", category: "accounting" })`.
2. Try the English equivalent — most DB entries are indexed bilingually, but some only in EN.
3. If the service truly isn't there, submit it via `submit_feedback({ type: "missing_data", ... })`. New services are added on a rolling basis.
</details>

<details>
<summary><b>I'm getting "auth_error" when calling a real SaaS endpoint after KanseiLink suggests it.</b></summary>

1. Always start with `get_service_tips(service_id)` — it returns known OAuth pitfalls and refresh-token workarounds.
2. Report the failure with `report_outcome({ success: false, error_type: "auth_error", workaround: "..." })` — your fix helps the next agent avoid the same issue.
</details>

<details>
<summary><b>Trust score seems wrong / outdated.</b></summary>

Trust scores are recomputed from `outcomes` on every server start. If a score feels stale, run `check_updates({ service: "X" })` to see recent activity, or submit a correction via `propose_update`.
</details>

## Support

- **Issues & bug reports**: [github.com/kansei-link/kansei-mcp-server/issues](https://github.com/kansei-link/kansei-mcp-server/issues)
- **Feature requests**: use the `submit_feedback` tool — it lands in the same queue and stays attached to your agent type
- **Website**: [kansei-link.github.io/kansei-link-mcp](https://kansei-link.github.io/kansei-link-mcp/)
- **Company**: Synapse Arrows PTE. LTD. (Singapore)

## Development

```bash
npm install
npm run build
npm start       # start stdio server
```

## Autonomous Article Generation (3-stage pipeline)

KanseiLINK publishes AEO-optimized articles on a rolling basis from `content/article-queue.json`.
The generator is fully unattended and fact-grounded — it runs a three-stage pipeline per article:

```
Stage 1: Fact Preparation (no LLM, free)
         scripts/lib/fact-prep.mjs
         Builds a Fact Sheet from services-seed.json + api-guides + recipes.
         Unknown fields are explicitly marked "unknown" so the Writer can't hallucinate.
         ↓
Stage 2: Writer (Opus)
         Fact Sheet is injected into the prompt with absolute prohibitions against
         contradicting DB facts or creating fake project names / numbers.
         ↓
Stage 3: Fact-Checker (Haiku, ~¥2/article)
         scripts/lib/fact-checker.mjs
         Returns structured JSON verdict. Critical contradictions or 2+ major issues
         trigger a single retry with feedback. Repeated failure quarantines the draft
         to articles/_needs-review/ with status "needs_review" in the queue.
```

```bash
# Generate the next 3 pending articles (with fact check)
ANTHROPIC_API_KEY=sk-ant-... npm run articles:auto

# Preview mode (no files written, no queue mutation)
ARTICLES_DRY_RUN=1 ARTICLES_PER_RUN=1 node scripts/generate-articles-auto.mjs

# Dump the Fact Sheet for a single article without calling any LLM
node scripts/lib/fact-prep.mjs kintone-mcp-guide

# Skip the checker (debug only — not for production runs)
ARTICLES_SKIP_CHECKER=1 ARTICLES_PER_RUN=1 npm run articles:auto
```

Environment variables:

| Var | Default | Purpose |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — (required) | Anthropic API key |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Override endpoint |
| `ANTHROPIC_MODEL` | `claude-opus-4-5-20251101` | Writer model |
| `ANTHROPIC_CHECKER_MODEL` | `claude-haiku-4-5` | Fact-Checker model |
| `ARTICLES_PER_RUN` | `3` | Max articles to generate per invocation |
| `ARTICLES_MAX_RETRIES` | `1` | Writer retries after a failed fact check |
| `ARTICLES_DRY_RUN` | — | Set to `1` to preview without writing |
| `ARTICLES_SKIP_CHECKER` | — | Set to `1` to bypass Stage 3 (debug only) |

### Scheduling (Windows Task Scheduler)

```cmd
schtasks /create /sc DAILY /tn "KanseiLink Articles" ^
  /tr "cmd /c cd /d C:\Users\HP\KanseiLINK\kansei-link-mcp && npm run articles:auto" ^
  /st 09:00
```

### Scheduling (cron, macOS/Linux)

```bash
0 9 * * * cd ~/KanseiLINK/kansei-link-mcp && ANTHROPIC_API_KEY=sk-ant-... npm run articles:auto >> content/article-generation.log 2>&1
```

Logs are written to `content/article-generation.log` (gitignored). On failure, articles are
automatically reverted to `pending` so the next run retries them.

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
