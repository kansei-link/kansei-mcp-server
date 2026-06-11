# KanseiLink Security Policy

## Data Collection

KanseiLink collects aggregated, anonymized usage data through the `report_outcome` tool. This data helps agents make informed decisions about MCP service quality.

### What We Collect
- Service ID and success/failure status
- Response latency (optional)
- Error category (optional, predefined types only)
- Context text (optional, PII auto-masked before storage)

### What We Do NOT Collect
- Agent identity (hashed to anonymous ID)
- User personal information (auto-masked)
- Authentication credentials
- Request/response payloads from MCP services
- IP addresses of calling agents

## PII Auto-Masking

All text submitted via `context` field is processed through PII masking before storage:

| Pattern | Replaced With |
|---------|--------------|
| Email addresses | `[EMAIL]` |
| Japanese phone numbers (03-xxxx-xxxx, 090-xxxx-xxxx) | `[PHONE]` |
| International phone numbers (+81-x-xxxx-xxxx) | `[PHONE]` |
| IP addresses | `[IP]` |
| Japanese kanji names with honorific (〇〇さん/様/氏) | `[NAME]` |
| Japanese full names with space (田中 太郎) | `[NAME]` |
| Common Japanese surnames + given name (50 surnames) | `[NAME]` |
| Katakana full names | `[NAME]` |

**Policy**: Raw text with PII is never persisted to disk. Masking occurs in-memory before any database write.

- `agent_id` (e.g. on `submit_feedback`) is normalized to an agent *family* (`claude` / `gpt` / `gemini` / …) or `anonymous` — an arbitrary identifier (email, username) can never be stored through it.
- Auto-captured error responses (`kansei-link-report-hook`) are PII-masked **before** classification; only the resulting error *category* is ever transmitted, never the raw response.

## What ships where

- The **npm package** (`@kansei-link/mcp-server`, stdio server) makes **no outbound network calls by default** — it serves a local bundled SQLite dataset.
- The **hosted HTTP facade** (Railway) exposes the dashboard read APIs, Stripe billing, and the opt-in `report-outcome` / `telemetry` sinks.

## Billing & Access Endpoints (hosted facade)

- **Stripe webhooks** (`/webhooks/stripe`) are verified with `stripe.webhooks.constructEvent` (HMAC signature) over the raw request body.
- **`/api/checkout`** accepts only price IDs configured via `STRIPE_PRICE_*` (a client cannot substitute an arbitrary or different valid price).
- **`/api/access`** is read-only content gating, keyed by email — it returns only a tier + expiry (no payment data). It is intentionally not token-gated at launch, so existing subscribers aren't locked out; the residual risk is a low-stakes "is this email a customer" read. **Magic-link email login** is the planned post-launch upgrade that closes this read-enumeration (a Stripe-verified token issuer, `/api/access-token?session_id=...`, already exists as the bridge).
- **`/api/portal`** (manage/cancel billing — high-impact) **is** token-gated: it requires the per-email `HMAC(email, secret)` token, so it cannot be used to take over or enumerate billing.
- **`/admin/*`** endpoints require a `CRAWLER_SECRET` bearer token.
- CORS is scoped to a single configured origin; credentials are not exposed.

Server secrets are environment variables only (never committed): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `CRAWLER_SECRET`, `ACCESS_TOKEN_SECRET` (optional — falls back to `STRIPE_WEBHOOK_SECRET`), `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`. See `.env.example`.

## Trust Model

### Service Trust Score (0.0 - 1.0)
- Initial score: 0.5 (neutral)
- Adjusted based on: namespace verification, community outcomes, manual review
- Scores below 0.3 trigger a warning in search results

### Data Confidence Score (0.0 - 1.0)
Calculated from:
- Unique agent count (40% weight): More independent agents = more trustworthy
- Total call volume (30% weight): More data points = more reliable
- Data recency (30% weight): Fresher data = more relevant

### 4-Layer Defense Against Bad Data
1. **Structural validation** (MVP): Input schema validation via Zod
2. **Statistical anomaly detection** (MVP): Basic outlier detection on latency/success patterns
3. **Cross-validation** (planned): 3+ independent agent confirmations boost confidence
4. **Human review** (planned): Flagged anomalies reviewed by maintainers

## Reporting Vulnerabilities

Contact: security@synapsearrows.com (or open a GitHub security advisory)

## Namespace Verification

KanseiLink uses `io.github.kansei-link/*` namespace, verified via GitHub OIDC. We do not claim domain-based namespaces until DNS ownership is confirmed.
