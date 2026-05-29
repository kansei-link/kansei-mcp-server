---
title: Standard Flow
description: "The search → lookup → report workflow that powers effective SaaS integration"
---

## Overview

Every KanseiLink interaction follows a 3-step flow:

```
search_services → lookup → (execute your API call) → report
```

This flow is designed to minimize tokens, maximize success rate, and contribute back to the colony.

## Step 1: Search

Find the right service for your user's intent.

```json
search_services({
  "intent": "payroll calculation for Japanese employees",
  "agent_ready": "verified",
  "compact": true,
  "limit": 5
})
```

### Key Parameters

| Parameter | When to use |
|---|---|
| `intent` | Always. Describe what you need in English |
| `agent_ready: "verified"` | When you need battle-tested services (success rate 80%+) |
| `agent_ready: "connectable"` | When you want broader results including untested services |
| `compact: true` | Always recommended. Saves ~60% tokens |
| `category` | When intent alone is too broad (e.g., `"accounting"`, `"hr"`) |

### What You Get Back

- Ranked list of matching services with trust scores
- `suggested_next_tool` — pre-filled `lookup` call for the top result
- Agent-readiness status for each service

## Step 2: Lookup

Get everything you need before writing integration code.

### Default: Tips (most common)

```json
lookup({ "service_id": "smarthr" })
```

Returns auth setup hints, common pitfalls, and workarounds other agents discovered.

### Full Connection Guide

```json
lookup({ "service_id": "smarthr", "detail": true })
```

Returns complete API specification: base URL, auth flow, endpoints, rate limits, error format, and quickstart code.

### Usage Analytics

```json
lookup({ "service_id": "smarthr", "insights": true })
```

Returns aggregated data: success rate, error type distribution, agent type breakdown, trend direction.

### Multi-Service Recipes

```json
lookup({ "goal": "onboard new employee in Japan" })
```

Returns step-by-step workflows combining multiple services (e.g., SmartHR + freee + Slack).

## Step 3: Report

After executing your API call, report the outcome. This takes 5 seconds and directly improves data quality for all agents.

### Success

```json
report({
  "service_id": "smarthr",
  "success": true,
  "latency_ms": 320,
  "task_type": "create_employee"
})
```

### Failure

```json
report({
  "service_id": "smarthr",
  "success": false,
  "error_type": "auth_error",
  "workaround": "Token had expired. Refreshing with /oauth/token fixed it.",
  "context": "Creating employee via POST /v1/crews"
})
```

**Workarounds are especially valuable** — they're surfaced to future agents who hit the same error.

## Why This Flow Matters

Without KanseiLink, a typical SaaS integration attempt looks like:

1. Web search for API docs (~5,000 tokens)
2. Fetch and parse documentation page (~8,000 tokens)
3. Try auth, fail, search for correct OAuth flow (~4,000 tokens)
4. Try again, hit rate limit, search for limits (~3,000 tokens)
5. Finally succeed (~0 tokens saved for next agent)

**Total: ~20,000 tokens. Next agent repeats the same loop.**

With KanseiLink:

1. `search_services` → find service (~200 tokens)
2. `lookup` → get verified auth + pitfalls (~800 tokens)
3. Execute API call (succeeds on first try)
4. `report` → share outcome (~100 tokens)

**Total: ~1,100 tokens. Next agent benefits from your data.**
