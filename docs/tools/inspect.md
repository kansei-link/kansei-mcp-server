---
title: "inspect"
description: "Internal admin tool for colony health. Inspect anomalies, manage update proposals, take snapshots, and evaluate MCP design patterns."
---

## Overview

`inspect` is an admin/operator tool for maintaining the KanseiLink service database. It provides capabilities for anomaly inspection, data update proposals (PR-model), snapshot management, and API design evaluation.

This tool is not part of the standard agent flow. It is used by operators and trusted agents for database health monitoring and curation.

## Modes

`inspect` supports 8 modes. The mode is auto-detected from your parameters, or you can set it explicitly.

### queue

View anomalies detected in service data that need human or agent verification.

**`queue_status`** (enum, default: "open"): Filter by status: `"open"`, `"in_progress"`, `"resolved"`, `"all"`. Default: `"open"`.

**`queue_severity`** (enum, default: "all"): Filter by severity: `"low"`, `"medium"`, `"high"`, `"critical"`, `"all"`. Default: `"all"`.

**`queue_service_id`** (string): Filter by specific service ID.

**`queue_limit`** (number, default: 10): Max results. Default: 10.

#### Example

```json
inspect({ "mode": "queue" })
```

```json
inspect({
  "queue_status": "open",
  "queue_severity": "high"
})
```

### submit

Submit your verification result for an anomaly from the queue.

**`inspection_id`** (number, required): Inspection ID from the queue. With `verdict`, triggers submit mode. Alone, triggers queue lookup.

**`verdict`** (enum, required): Your finding: `"confirmed"`, `"false_alarm"`, `"resolved"`, or `"partially_resolved"`.

**`findings`** (string, required): What you found during inspection. PII is auto-masked.

**`tested_workaround`** (string): Workaround you tested, if any.

**`workaround_works`** (boolean): Did the tested workaround work?

#### Example

```json
inspect({
  "inspection_id": 42,
  "verdict": "confirmed",
  "findings": "API returns 500 on invoice creation with special characters in description field.",
  "tested_workaround": "URL-encode the description field before sending",
  "workaround_works": true
})
```

### check_updates

Check for recent changes or updates to a service's API, pricing, or configuration.

**`check_service_id`** (string, required): Service name or ID to check for changes. Triggers check_updates mode.

**`since_days`** (number, default: 30): How many days back to look. Default: 30.

#### Example

```json
inspect({
  "check_service_id": "freee",
  "since_days": 90
})
```

### propose

Propose a data update using the PR-model workflow. Changes are queued for review before being applied.

**`propose_service_id`** (string, required): Service ID to propose changes for.

**`field`** (string): Single field to update (shorthand). Allowed fields: `description`, `category`, `tags`, `mcp_endpoint`, `mcp_status`, `api_url`, `api_auth_method`, `namespace`. Triggers propose mode when paired with `new_value`.

**`new_value`** (string): New value for the field (used with `field` shorthand). Triggers propose mode when paired with `field`.

**`changes`** (Record<string, string>): Object of field-to-value pairs. Alternative to `field` + `new_value` for multi-field updates.

**`reason`** (string, required): Why this change is needed.

**`evidence_url`** (string): URL to source (API docs, changelog).

**`change_type`** (enum, default: "update"): Type of change: `"update"`, `"new_feature"`, `"deprecation"`, `"breaking_change"`, `"fix"`. Default: `"update"`.

**`agent_id`** (string): Agent identifier for attribution.

#### Example

```json
inspect({
  "propose_service_id": "freee",
  "field": "api_url",
  "new_value": "https://api.freee.co.jp/api/1",
  "reason": "API base URL updated in v3 migration",
  "evidence_url": "https://developer.freee.co.jp/changelog",
  "change_type": "breaking_change"
})
```

### review

Approve or reject a pending update proposal.

**`update_id`** (number, required): Proposal ID to review. With `approved`, triggers review mode.

**`approved`** (boolean, required): `true` to approve, `false` to reject.

**`reviewer`** (string, default: "michie"): Who is reviewing. Default: `"michie"`.

**`review_note`** (string): Optional review comment.

#### Example

```json
inspect({
  "update_id": 15,
  "approved": true,
  "review_note": "Verified against official changelog."
})
```

### pending

View the proposal queue to see what updates are waiting for review.

**`pending_status`** (enum, default: "pending"): Filter by status: `"pending"`, `"approved"`, `"rejected"`, `"all"`. Triggers pending mode when present.

**`pending_service_id`** (string): Filter by service ID.

**`pending_limit`** (number, default: 20): Max results. Default: 20.

#### Example

```json
inspect({ "pending_status": "pending" })
```

### snapshot

Capture daily metrics for services. Used for building historical trend data.

**`snapshot_service_id`** (string): Service to snapshot. Triggers snapshot mode. Omit the value to snapshot all services.

**`snapshot_date`** (string): Date to snapshot (YYYY-MM-DD). Default: today.

#### Example

```json
inspect({ "snapshot_service_id": "freee" })
```

### evaluate

Rate the API design quality of a service across four dimensions. Builds historical data for consulting reports.

**`evaluate_service_id`** (string, required): Service to evaluate. Triggers evaluate mode.

**`api_quality_score`** (number, required): API design quality: RESTful conventions, naming, status codes. Range: 0.0 to 1.0.

**`doc_completeness_score`** (number, required): Documentation quality: completeness, accuracy, examples. Range: 0.0 to 1.0.

**`auth_stability_score`** (number, required): Auth reliability: token refresh, expiry handling, OAuth flow. Range: 0.0 to 1.0.

**`error_clarity_score`** (number, required): Error response quality: clear codes, actionable messages. Range: 0.0 to 1.0.

**`evaluate_notes`** (string): Free-text notes on design strengths and weaknesses.

#### Example

```json
inspect({
  "evaluate_service_id": "kintone",
  "api_quality_score": 0.7,
  "doc_completeness_score": 0.8,
  "auth_stability_score": 0.6,
  "error_clarity_score": 0.5,
  "evaluate_notes": "Good REST design but error messages lack detail. Auth token refresh has edge cases."
})
```

## Mode Auto-Detection

| Priority | Condition | Mode |
|----------|-----------|------|
| 1 | `mode` parameter is set | *(explicit override)* |
| 2 | `inspection_id` + `verdict` | `submit` |
| 3 | `inspection_id` alone | `queue` (lookup) |
| 4 | `update_id` + `approved` (boolean) | `review` |
| 5 | `field` + `new_value` | `propose` |
| 6 | `pending_status` is present | `pending` |
| 7 | `snapshot_service_id` is present | `snapshot` |
| 8 | `evaluate_service_id` is present | `evaluate` |
| 9 | `check_service_id` is present | `check_updates` |

If no actionable parameters are provided, the tool returns an error with auto-detection hints.

## Notes

- **This is an admin/operator tool.** It is not part of the standard `search_services` --> `lookup` --> `report` flow that regular agents use.
- **The propose/review workflow follows a PR model.** Proposed changes are queued and must be approved before they are applied to the database.
- **Approved changes automatically trigger** changelog recording and trust score recalculation.
- **Snapshot mode** is typically run on a daily schedule to build the time-series data that powers `lookup` history mode.
- **Evaluate scores** (0.0 to 1.0) feed into AXR grade calculations and AEO reports generated by the `analyze` tool.
