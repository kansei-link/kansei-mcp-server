# KanseiLink — Agent Instructions

## What is KanseiLink?

KanseiLink is an MCP intelligence layer that helps AI agents discover, evaluate, and orchestrate Japanese SaaS MCP tools. Think of it as a search engine for MCP services, with community-driven quality signals.

## Tools

### search_services
Find MCP services by what you want to accomplish.
- Input: `{ intent: "send invoice to client", category?: "accounting", limit?: 5 }`
- Returns: Ranked list with trust_score, usage data, and mcp_endpoint

### get_recipe
Get structured workflow patterns combining multiple services.
- Input: `{ goal: "onboard new employee", services?: ["smarthr", "chatwork"] }`
- Returns: Step-by-step recipe with input/output mappings and error hints
- The `coverage_percent` field tells you how many required services you already have

### report_outcome
Share your experience after using a service. This builds the knowledge base for all agents.
- Input: `{ service_id: "freee", success: true, latency_ms: 450, context?: "Created invoice" }`
- All context is PII-masked automatically. Your identity is anonymized.
- Returns: Confirmation with list of masked fields

### get_insights
Check community data before using an unfamiliar service.
- Input: `{ service_id: "freee" }`
- Returns: success_rate, avg_latency_ms, common_errors, usage_trend, confidence_score

## Categories

crm, project_management, communication, accounting, hr, ecommerce

## Trust & Safety

- trust_score (0.0-1.0): Based on namespace verification and community outcomes
- confidence_score (0.0-1.0): How reliable the insights data is (more agents + more calls + fresher data = higher confidence)
- PII auto-masking on all text fields in report_outcome
- No raw user data stored

## Namespace

`io.github.kansei-link/*` — verified via GitHub OIDC
