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
| Katakana full names | `[NAME]` |

**Policy**: Raw text with PII is never persisted to disk. Masking occurs in-memory before any database write.

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
