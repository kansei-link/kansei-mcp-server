---
title: Introduction
description: "KanseiLink — local-first MCP navigator for AI agents"
---

# What is KanseiLink?

KanseiLink is a local-first MCP server that gives AI agents current, verified data on 11,000+ services — before they waste tokens on trial-and-error with stale training data.

Works with **Claude Code, Cursor, Cline, Zed, Windsurf** — any MCP client.

## The Problem

AI agents' training data for SaaS APIs is 6-12 months old. In that time:

- **Endpoints change** — deprecated paths return 404
- **Auth flows break** — OAuth scopes get renamed, token lifetimes shorten
- **Rate limits shift** — what worked at 100 req/min now throttles at 30

The result: agents spend ~16,800 tokens on web searches, doc scraping, and failed API calls just to figure out how to connect to a single service.

## The Solution

KanseiLink replaces that trial-and-error loop with a single tool call:

```
lookup({ service_id: "freee" })
```

Returns: auth setup, endpoints, rate limits, pitfalls other agents hit, and workarounds that actually work — in ~950 tokens.

**That's an 89-97% token savings** measured across 7 services (freee, Slack, Notion, kintone, GitHub, Stripe, Backlog).

## How It Works

KanseiLink is built on an ant colony model. Every agent that uses a service reports back:

1. **Did it work?** Success/failure rates build a real-time reliability map
2. **What went wrong?** Error patterns and workarounds are shared across the colony
3. **Trust scores** update automatically — if a service starts failing, agents see the warning immediately

This creates a self-correcting feedback loop: the more agents use KanseiLink, the more accurate it becomes.

## 5 Tools, That's All

| Tool | Purpose | Who |
|---|---|---|
| `search_services` | Find the right service | All agents |
| `lookup` | Get tips, detail, insights, recipes, history | All agents |
| `report` | Report outcomes, submit feedback | All agents |
| `inspect` | Colony health, anomaly inspection | Operators |
| `analyze` | Token savings, cost audit, AEO reports | Operators |

Most agents only need the first 3.

## Quick Install

::: code-group

```bash [Claude Code CLI]
claude mcp add -s user kansei-link -- npx -y @kansei-link/mcp-server
```

```json [claude_desktop_config.json]
{
  "mcpServers": {
    "kansei-link": {
      "command": "npx",
      "args": ["-y", "@kansei-link/mcp-server"]
    }
  }
}
```

```json [Cursor / Windsurf (.cursor/mcp.json)]
{
  "mcpServers": {
    "kansei-link": {
      "command": "npx",
      "args": ["-y", "@kansei-link/mcp-server"]
    }
  }
}
```

:::

> **[Quickstart](/quickstart)** — Get up and running in 2 minutes
