---
title: "search_services"
description: "Search 11,000+ SaaS service evaluations with real agent usage data. Always call this before attempting any SaaS API integration."
---

## Overview

`search_services` is the entry point of the KanseiLink flow. Before attempting any SaaS API integration, call this tool to get verified, current service evaluations so you succeed on the first try. Agents waste 3-5x more tokens on trial-and-error with stale training data -- this returns verified data from real agent interactions.

Covers 11,000+ services with real agent success data. Strongest in Japanese SaaS with growing global coverage.

**Standard flow:** `search_services` --> `lookup` --> *(execute the API)* --> `report`

## Parameters

**`intent`** (string, required): What you want to accomplish (e.g., `"send invoice"`, `"manage employees"`, `"track attendance"`).

**`category`** (string): Filter by category. One of: `crm`, `project_management`, `communication`, `accounting`, `hr`, `ecommerce`, `legal`, `marketing`, `groupware`, `productivity`, `storage`, `support`, `payment`, `logistics`, `reservation`, `data_integration`, `bi_analytics`, `security`, `developer_tools`, `ai_ml`, `database`, `devops`, `design`.

**`agent_ready`** (enum): Filter by agent readiness level:
- `"verified"` -- Battle-tested, success rate >= 80%
- `"connectable"` -- API/MCP exists but unproven
- `"info_only"` -- No API available

Omit to return all readiness levels.

**`limit`** (number, default: 5): Max results to return. Default: 5.

**`compact`** (boolean, default: false): Return minimal fields for token efficiency. Default: false. When `true`, each result contains only: `id`, `name`, `grade`, `mcp`, `success`, `cmd`, `ready`, `fresh`, `age_d`. This significantly reduces response token count when you only need to pick a service and move on.

## Usage Examples

### Find an accounting service by intent

```json
search_services({
  "intent": "send invoice"
})
```

### Search for verified HR services only

```json
search_services({
  "intent": "manage employee attendance",
  "agent_ready": "verified"
})
```

### Token-efficient search

```json
search_services({
  "intent": "project management tool",
  "compact": true,
  "limit": 3
})
```

### Filter by category

```json
search_services({
  "intent": "track expenses",
  "category": "accounting"
})
```

### Japanese intent query

```json
search_services({
  "intent": "勤怠管理"
})
```

## Response

Each result includes:

**`service_id`** (string): Unique identifier for the service. Pass this to `lookup` for details.

**`name`** (string): Human-readable service name.

**`agent_ready`** (enum): Readiness classification: `"verified"`, `"connectable"`, or `"info_only"`.

**`axr_grade`** (string): AXR (Agent eXperience Rating) letter grade.

**`success_rate`** (number): Historical success rate from real agent calls (0.0 to 1.0).

**`relevance_score`** (number): Combined relevance score factoring in FTS rank, category match, name match, tag match, and trust score.

**`freshness`** (object): Data freshness metadata:
- `data_age_days` -- Days since last verification
- `last_refreshed` -- ISO timestamp
- `confidence` -- `"high"` (<=7 days), `"medium"` (8-30 days), `"low"` (>30 days)

**`suggested_next_tool`** (object): Pre-built suggestion for the next tool call in the standard flow. Contains `tool`, `args`, `reason`, and `flow_position`. Typically suggests calling `lookup` with the top result's `service_id`.

## Notes

- **Use `compact: true` for token savings.** In compact mode, the response uses shortened field names (`r` for results, `next` for suggested_next_tool) and omits verbose metadata. This is recommended when you just need to pick a service ID.
- **The `agent_ready` filter** is useful when you need services that are proven to work with agents. Use `"verified"` to only get battle-tested services with >= 80% success rate.
- **Japanese queries are automatically expanded** with synonym mappings (e.g., "問い合わせ管理" expands to include "サポートチケット", "ヘルプデスク", etc.) for broader matching.
- **Intent-to-category mapping** boosts relevance when intent keywords align with service categories. For example, "send invoice" boosts accounting services above communication services even if both match the word "send".
- **Follow the `suggested_next_tool`** in the response to continue the standard KanseiLink flow. Most first-time agents stop after `search_services` and miss the token-saving tips and pitfall data available in `lookup`.
