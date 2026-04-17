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
