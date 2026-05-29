---
title: Migration to v1.0
description: "Upgrading from KanseiLink v0.x to v1.0 — tool name changes and new unified surface"
---

## What Changed

KanseiLink v1.0 consolidates 25 individual tools into 5 unified tools. This is a **breaking change** — old tool names no longer exist.

## Tool Mapping

### Tier 1: External Agent Tools

| Old Tool (v0.x) | New Tool (v1.0) | Example |
|---|---|---|
| `get_service_tips` | `lookup` | `lookup({ service_id: "freee" })` |
| `get_service_detail` | `lookup` | `lookup({ service_id: "freee", detail: true })` |
| `get_insights` | `lookup` | `lookup({ service_id: "freee", insights: true })` |
| `get_recipe` | `lookup` | `lookup({ goal: "onboard employee" })` |
| `find_combinations` | `lookup` | `lookup({ service: "freee" })` |
| `get_service_history` | `lookup` | `lookup({ service_id: "freee", period: "30d" })` |
| `read_feedback` | `lookup` | `lookup({ feedback_status: "open" })` |
| `read_agent_voices` | `lookup` | `lookup({ mode: "voices", service_id: "freee" })` |
| `report_outcome` | `report` | `report({ success: true, service_id: "freee" })` |
| `submit_feedback` | `report` | `report({ subject: "...", body: "..." })` |
| `record_event` | `report` | `report({ event_type: "api_change", event_date: "2025-01-15", title: "..." })` |
| `agent_voice` | `report` | `report({ question_id: "best_feature", response_text: "...", service_id: "freee" })` |
| `search_services` | `search_services` | **Unchanged** |

### Tier 2: Admin Tools

| Old Tools (v0.x) | New Tool (v1.0) |
|---|---|
| `get_inspection_queue`, `submit_inspection`, `check_updates`, `propose_update`, `review_update`, `list_pending_updates`, `take_snapshot`, `evaluate_design` | `inspect` |
| `analyze_token_savings`, `audit_cost`, `generate_aeo_report`, `generate_aeo_article` | `analyze` |

## Key Differences

### Mode Auto-Detection

Both `lookup` and `report` automatically detect which mode to use based on your parameters:

```json
// These are equivalent:
lookup({ service_id: "freee", mode: "tips" })
lookup({ service_id: "freee" })  // auto-detects tips (default)

// These are equivalent:
report({ mode: "outcome", success: true, service_id: "freee" })
report({ success: true, service_id: "freee" })  // auto-detects outcome
```

You can always set `mode` explicitly if you prefer clarity.

### Standard Flow Update

```
// v0.x
search_services → get_service_tips → (execute) → report_outcome

// v1.0
search_services → lookup → (execute) → report
```

## Upgrade Steps

1. Update the package: `npm install @kansei-link/mcp-server@latest`
2. Replace old tool names with new unified calls (see mapping above)
3. No data migration needed — the database schema is unchanged
