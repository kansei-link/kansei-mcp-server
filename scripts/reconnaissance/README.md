# Reconnaissance Ant

> Daily crawler that monitors all Synapse Arrows products from inside KanseiLINK MCP.
>
> Implements the [Playbook reconnaissance-ant pattern](https://github.com/michielinksee/synapse-arrows-playbook/blob/main/02-process/reconnaissance-ant.md).
>
> Status: **Tier B-β** — health probe + UI snapshot diff + Linksee Memory bridge (queue).

## Purpose

KanseiLINK is the MCP intelligence layer Synapse Arrows sells to other companies.
Before selling it externally, we use it internally to monitor every Synapse Arrows
product every morning. This is dogfood² — the strongest possible sales proof,
and the early-warning system that catches drift before users do.

## Architecture

```
┌─────────────────────────────────────────┐
│  GitHub Actions cron @ 00:00 UTC daily  │
│  (= 09:00 JST)                          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  scripts/reconnaissance/run.mjs         │
│                                         │
│  for each config in configs/*.json:     │
│    for each monitor enabled in config:  │
│      run monitor → collect findings     │
│    write per-product report             │
│  write daily summary report             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  data/reconnaissance/reports/           │
│    {YYYY-MM-DD}.md                      │
│      ├ summary (5 / 5 healthy)          │
│      └ per-product sections             │
│                                         │
│  Slack/email alert (Tier C — future)    │
└─────────────────────────────────────────┘
```

## What's monitored (Tier B-β)

Per product:
- **health**: `urls_must_200` — every URL should return 2xx + response time
- **snapshot**: Playwright UI screenshot + pixel diff against rolling baseline (yesterday)
- **linksee bridge**: critical findings queued to `data/reconnaissance/linksee-queue.jsonl`
  for downstream Claude session to ingest

## What's deferred

| Monitor / feature | Tier | Notes |
|---|---|---|
| agent_voice probe (chat API testing) | B-γ | Requires per-product API endpoint + test query bank |
| Cross-repo STATE.md auto-commit | C | Requires PAT setup |
| Slack / email alerter | C | Requires webhook config |
| 朝digest agent integration | C | Depends on digest agent existing |
| design.lock.json compliance | C | Depends on `design.lock.json` existing in product repos |
| perf baseline (TTFB / TTF token) | C | Depends on Tier B-γ infra |
| cost baseline (audit_cost integration) | C | Depends on KanseiLINK audit_cost tool internal mode |
| cross-product UX consistency | C | Depends on 2+ products having configs |

## Configs

```
configs/
├── kansei-link.json    # KanseiLINK monitoring itself (recursive but fine)
├── scanavi.json        # https://github.com/michielinksee/VINOX
└── cardwize.json       # https://github.com/michielinksee/Card_Navi
```

Each config follows the schema in
[Playbook reconnaissance-config.json.template](https://github.com/michielinksee/synapse-arrows-playbook/blob/main/05-templates/reconnaissance-config.json.template).

## Local run

```bash
node scripts/reconnaissance/run.mjs           # all configs
node scripts/reconnaissance/run.mjs --product=scanavi  # one product
node scripts/reconnaissance/run.mjs --dry-run # don't write report
```

## CI

`.github/workflows/reconnaissance.yml` runs the script daily and commits
the report to `data/reconnaissance/reports/`.

## Why dogfood²

If KanseiLINK breaks the internal monitoring of our own products, that
manifests as obvious failure (yesterday's report missing, or red across
the board). External sales prospects can verify by visiting the public
report directory: **"They run their own monitoring on themselves every
day, and it's been green for 47 consecutive days. That's the system
they're trying to sell us."**
