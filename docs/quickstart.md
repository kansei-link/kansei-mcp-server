---
title: Quickstart
description: "Get up and running with KanseiLink in 2 minutes"
---

## Installation

**Add by URL (hosted, current data, no key):**

```bash
claude mcp add --transport http kansei-link https://mcp.kansei-link.com/mcp
```

::: code-group

```json [Cursor / Windsurf / Cline (.cursor/mcp.json)]
{
  "mcpServers": {
    "kansei-link": { "url": "https://mcp.kansei-link.com/mcp" }
  }
}
```

```text [Claude Desktop]
Settings → Connectors → Add custom connector → https://mcp.kansei-link.com/mcp
```

:::

**Offline (no network calls at all):** the npm package runs locally on a small public copy of the catalogue.

::: code-group

```bash [Claude Code CLI]
claude mcp add -s user kansei-link -- npx -y @kansei-link/mcp-server
```

```json [Any MCP client]
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

What the hosted server keeps about a call: [SECURITY.md → What the server can see](https://github.com/kansei-link/kansei-mcp-server/blob/main/SECURITY.md#what-the-server-can-see).

## Your First Call

### Step 1: Search for a service

```json
search_services({
  "intent": "send invoice to clients",
  "compact": true,
  "limit": 5
})
```

Returns ranked services matching your intent, with trust scores and agent-readiness status.

### Step 2: Get tips before integrating

```json
lookup({
  "service_id": "freee"
})
```

Returns auth setup, common pitfalls, workarounds, and recent reliability data — everything you need before writing integration code.

### Step 3: Report your experience

```json
report({
  "service_id": "freee",
  "success": true,
  "latency_ms": 450,
  "task_type": "create_invoice"
})
```

Takes 5 seconds. Helps every future agent that uses this service.

**That's the entire flow.** Three tools, three steps.

## Going Deeper

Need more than tips? The `lookup` tool has 8 modes:

```json
// Full connection guide (auth, endpoints, rate limits)
lookup({ "service_id": "freee", "detail": true })

// Usage analytics (success rates, error patterns)
lookup({ "service_id": "freee", "insights": true })

// Multi-service workflow recipe
lookup({ "goal": "onboard new employee in Japan" })

// Reliability history over time
lookup({ "service_id": "freee", "period": "30d" })
```

All through a single tool. Mode is auto-detected from your parameters.

> **[Standard Flow Guide](/guides/standard-flow)** — Deep dive into the search-lookup-report workflow
