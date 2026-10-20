# SEC-2026-10-20-001: field notes production release

Implementer review by Codex, 2026-10-20. This is not an independent security certification. User explicitly authorized scoped production deployment and real MCP verification, with no unrelated PR merges or test contamination.

## Boundary

Four literal GET/POST registrations in http-server.ts keep the existing route gate effective. The shared handlers serve bounded summaries. Public writes require share:true, validated service IDs, UUID request/session IDs and strict fields. HTTP note writes are limited to 10 per minute/IP; MCP retains the existing global HTTP limiter. No new outbound requests, credentials, scoring, execution_attempts, service_stats, model_service_stats, subscriptions or feedback writes from note operations. Untrusted submissions stay unverified; session IDs are self-declared, not identity proof. Text masking is best effort and the caller must exclude private data.

scope=verification is explicitly opt-in and excluded from ordinary discovery/tips. It is an isolation label, not confidentiality. Direct ID reads label the scope. Results inherit their parent note's scope. Verification IDs are recorded locally and removed with a guarded transaction after live confirmation; no synthetic service rows are inserted. Real factual field observations may be retained only with provenance and no fabricated independent-agent claims.

## Release and recovery

Use latest remote main plus only this feature, in isolated clean clones. Record source SHAs. Back up the live SQLite DB on its mounted volume using SQLite backup, without exporting private data. Deploy only Railway kansei-link-mcp and Vercel agentstars (agent-stars.com). Do not deploy the dualrun-reconciler service or the similarly named Vercel agent-stars project. Do not merge other PRs, mutate original worktrees, publish npm, or push main.

Rollback the target application's prior immutable deployment if health or existing routes regress. Tables are additive and old code ignores them; do not restore the entire DB over new user traffic. Remove only known verification IDs after matching scope and request ID. Retain the production backup for recovery.

The release branch is not merged into main. A later main deployment must include this feature or it will replace it; document this explicitly in the release evidence. No deployment-source settings are silently changed.

## Validation

Build; nine store/HTTP/MCP handler tests including consent, masking, idempotency, negative paths, scope isolation and no scoring tables; two-process local fixture persistence; route gate. Live verification uses a fresh MCP client calling the existing lookup/report names and checks persistence via HTTP. Controlled local fixtures are not production adoption evidence. Native stdio installations remain local and require an update/reconnection for new schemas; this release activates the existing hosted HTTP MCP endpoint.
