---
title: OpenClaw Plugin
description: "Use KanseiLink as a cross-model observability plugin inside OpenClaw"
---

# OpenClaw Plugin

KanseiLink ships as an **OpenClaw plugin** that turns every tool call into telemetry — across Claude, GPT, Gemini, or any model running inside OpenClaw.

> **Package:** `@kansei-link/openclaw-plugin` (v0.1.0)
> **License:** MIT
> **Repo:** [github.com/kansei-link/openclaw-plugin](https://github.com/kansei-link/openclaw-plugin)

## What It Does

The plugin hooks into OpenClaw's tool-call lifecycle:

| Hook / Tool | When | What |
|---|---|---|
| `before_tool_call` | Before any SaaS tool runs | Injects known pitfall warnings |
| `after_tool_call` | After any SaaS tool completes | Records success/failure/duration |
| `kansei_diagnose` | Agent hits an error | Returns diagnosis + workaround |
| `kansei_confirm` | Agent succeeds | Returns optimization tips |

This means **every MCP tool call** (freee, Notion, Slack, Stripe...) is automatically observed — the agent doesn't need to do anything special.

## Installation

### 1. Add to your OpenClaw config

```json
{
  "plugins": [
    {
      "id": "kansei-link",
      "package": "@kansei-link/openclaw-plugin"
    }
  ]
}
```

### 2. (Optional) Configure telemetry mode

```json
{
  "plugins": [
    {
      "id": "kansei-link",
      "package": "@kansei-link/openclaw-plugin",
      "config": {
        "telemetryMode": "local",
        "dataDir": "~/.kansei-link/telemetry/"
      }
    }
  ]
}
```

| Option | Values | Default | Description |
|---|---|---|---|
| `telemetryMode` | `"local"` / `"sync"` | `"local"` | `local` = disk only. `sync` = send anonymized data to KanseiLINK central. |
| `dataDir` | path string | `~/.kansei-link/telemetry/` | Where telemetry JSONL files are stored. |

## How It Works

### Automatic Observation

Once installed, the plugin silently observes every tool call:

```
Agent calls freee_api_get(...)
  ├── before_tool_call: check known pitfalls → warn if any
  ├── (tool executes normally)
  └── after_tool_call: record { tool, duration, success/fail, error type }
```

No agent code changes needed. The plugin runs at priority 40 (below default 50), so it never blocks other plugins.

### Telemetry Storage

Data is stored locally as append-only JSONL:

```
~/.kansei-link/telemetry/
  2026-06-09.jsonl    # Daily log files
  stats.json          # Running aggregates per service
```

**Privacy by design:**
- Parameter **values** are stripped — only parameter **keys** are recorded
- No full response content stored
- Agent identity is not tracked
- `telemetryMode: "local"` (default) keeps everything on disk

### Agent-Facing Tools

#### `kansei_diagnose`

When an agent hits a SaaS error, it calls `kansei_diagnose`:

```json
kansei_diagnose({
  "toolName": "freee_api_get",
  "error": "company_id 不整合",
  "context": "Trying to fetch invoice list"
})
```

Response:

```json
{
  "diagnosed": true,
  "diagnosis": "company_idが初期値'0'のまま。freee_set_current_companyを先に呼ぶ必要がある。",
  "workaround": "freee_set_current_company を最初に呼んで事業所を選択してから API を叩く",
  "confidence": 0.95,
  "evidenceSource": "source_scan:config.ts:160 + client.ts:107-121",
  "successRate": "47/50 (94%)"
}
```

If the error isn't in the knowledge base, it returns an honest "don't know" with suggested web search keywords — never vague or stale info.

#### `kansei_confirm`

After a successful connection:

```json
kansei_confirm({
  "toolName": "freee_api_get",
  "tokensUsed": 1200
})
```

Returns optimization tips based on telemetry patterns (e.g., "average response time is high, consider batching").

## Knowledge Base

The diagnosis engine ships with known pitfalls from source-code scans:

| Service | Pitfall | Severity |
|---|---|---|
| freee | `companyId` defaults to `'0'` until `freee_set_current_company` is called | High |
| freee | 401 after refresh = token revoked, not just expired | Medium |
| freee | `company_id` in POST body must match current company | Medium |
| freee | Rate limit: 3600 req/h, check Retry-After header | High |

This knowledge base grows automatically as:
1. More source-code scans run (confirmed data production)
2. Agents report errors via `kansei_diagnose`
3. Telemetry accumulates failure patterns

## KanseiLink MCP vs OpenClaw Plugin

| | KanseiLink MCP Server | OpenClaw Plugin |
|---|---|---|
| **Install** | `npx @kansei-link/mcp-server` | Add to OpenClaw plugin config |
| **Works with** | Any MCP client (Claude, Cursor, Cline...) | OpenClaw only |
| **Data source** | 11,000+ pre-built service evaluations | Live observation of your tool calls |
| **Agent action** | Agent calls `search_services` / `lookup` | Automatic (hooks observe silently) |
| **Best for** | "Which service should I use? How do I connect?" | "Why did this call fail? What's my success rate?" |

**Use both together** for maximum coverage: KanseiLink MCP gives agents the map before they start; the OpenClaw plugin watches the journey and catches problems in real time.

## Development

```bash
git clone https://github.com/kansei-link/openclaw-plugin
cd openclaw-plugin
npm install
npm run build    # tsc → dist/
npm run dev      # tsc --watch
```

Requires OpenClaw plugin API `>=2026.3.24-beta.2`.
