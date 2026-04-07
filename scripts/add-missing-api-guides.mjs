#!/usr/bin/env node
/**
 * Add API connection guides for the 34 services that are missing guides.
 * Reads existing api-guides-seed.json, appends new guides, writes back.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const guidesPath = resolve(__dirname, "../src/data/api-guides-seed.json");

const existing = JSON.parse(readFileSync(guidesPath, "utf-8"));
const existingIds = new Set(existing.map((g) => g.service_id));

const newGuides = [
  // ── Cloud / Infrastructure ──────────────────────────────
  {
    service_id: "openai-api",
    base_url: "https://api.openai.com/v1/",
    api_version: "v1",
    auth_overview: "API key authentication. Generate at platform.openai.com/api-keys. Pass as Bearer token. Organization header optional for multi-org accounts.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at platform.openai.com. 2. Create API key (project-scoped recommended). 3. Set Authorization: Bearer {key}. 4. Optional: OpenAI-Organization header for org routing.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/chat/completions", description: "Chat completion (GPT-4o, GPT-4, GPT-3.5)", auth_required: true },
      { method: "POST", path: "/embeddings", description: "Text embeddings (text-embedding-3-small/large)", auth_required: true },
      { method: "POST", path: "/images/generations", description: "DALL-E image generation", auth_required: true },
      { method: "POST", path: "/audio/transcriptions", description: "Whisper speech-to-text", auth_required: true },
      { method: "GET", path: "/models", description: "List available models", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "has_more + after cursor for list endpoints. Streaming via SSE for completions.",
    rate_limit: "Tier-based: Tier 1 (500 RPM), Tier 2 (5,000 RPM), up to Tier 5. Per-model TPM limits. Check headers: x-ratelimit-remaining-*.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"type\":\"...\",\"param\":null,\"code\":\"...\"}}",
    quickstart_example: "POST /v1/chat/completions\nAuthorization: Bearer {api_key}\nContent-Type: application/json\n\n{\"model\":\"gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
    agent_tips: [
      "Use gpt-4o for best quality/speed balance, gpt-4o-mini for cost efficiency.",
      "Always set stream:true for chat UIs — reduces perceived latency.",
      "Project-scoped API keys are more secure than user-level keys.",
      "Check x-ratelimit-remaining-tokens header to avoid 429s.",
      "Structured output: use response_format:{type:'json_schema'} for reliable JSON."
    ],
    docs_url: "https://platform.openai.com/docs/api-reference"
  },
  {
    service_id: "aws-lambda",
    base_url: "https://lambda.{region}.amazonaws.com/2015-03-31/",
    api_version: "2015-03-31",
    auth_overview: "AWS Signature Version 4 (SigV4). Use IAM access key + secret key. AWS SDK handles signing automatically. Region-specific endpoints.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Create IAM user/role with Lambda permissions in AWS Console. 2. Generate access key + secret key. 3. Configure AWS SDK: aws configure or env vars AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY. 4. Set AWS_REGION.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/functions/{name}/invocations", description: "Invoke a Lambda function synchronously", auth_required: true },
      { method: "GET", path: "/functions", description: "List all Lambda functions", auth_required: true },
      { method: "POST", path: "/functions", description: "Create a new Lambda function", auth_required: true },
      { method: "PUT", path: "/functions/{name}/code", description: "Update function code", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Marker-based pagination. NextMarker in response, pass as Marker parameter.",
    rate_limit: "1,000 concurrent executions (default soft limit). API calls: varies by action. Invoke: no hard limit but throttled by concurrency.",
    error_format: "JSON: {\"Type\":\"...\",\"Message\":\"...\"}. HTTP 4xx/5xx. FunctionError header for invocation errors.",
    quickstart_example: "aws lambda invoke --function-name my-function --payload '{\"key\":\"value\"}' output.json\n\nOR via SDK:\nconst { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');\nconst client = new LambdaClient({ region: 'ap-northeast-1' });\nawait client.send(new InvokeCommand({ FunctionName: 'my-func', Payload: JSON.stringify({key:'val'}) }));",
    agent_tips: [
      "Always use AWS SDK instead of raw HTTP — SigV4 signing is complex.",
      "For JP workloads, use ap-northeast-1 (Tokyo) region.",
      "InvocationType: 'Event' for async, 'RequestResponse' for sync, 'DryRun' for validation.",
      "Check FunctionError header in response — null means success, 'Handled'/'Unhandled' means error.",
      "Use Lambda Layers for shared dependencies across functions."
    ],
    docs_url: "https://docs.aws.amazon.com/lambda/latest/api/welcome.html"
  },
  {
    service_id: "google-cloud",
    base_url: "https://cloud.google.com/apis",
    api_version: "Varies by service (e.g., compute/v1, storage/v1)",
    auth_overview: "OAuth 2.0 service account or user credentials. Service account JSON key recommended for server-to-server. Application Default Credentials (ADC) simplifies auth.",
    auth_token_url: "https://oauth2.googleapis.com/token",
    auth_scopes: "Service-specific: https://www.googleapis.com/auth/cloud-platform (broad), https://www.googleapis.com/auth/compute (Compute Engine), etc.",
    auth_setup_hint: "1. Create project in Google Cloud Console. 2. Enable required APIs. 3. Create service account + download JSON key. 4. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json. 5. Use google-cloud SDK — ADC handles the rest.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/compute/v1/projects/{p}/zones/{z}/instances", description: "Create Compute Engine VM", auth_required: true },
      { method: "POST", path: "/storage/v1/b/{bucket}/o", description: "Upload object to Cloud Storage", auth_required: true },
      { method: "POST", path: "/v1/projects/{p}/locations/{l}/functions", description: "Create Cloud Function", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "nextPageToken in response, pass as pageToken parameter. pageSize for page size.",
    rate_limit: "Per-API quotas. Default: 600 req/min for most APIs. Quotas page in Console for details.",
    error_format: "JSON: {\"error\":{\"code\":404,\"message\":\"...\",\"status\":\"NOT_FOUND\",\"errors\":[...]}}",
    quickstart_example: "// Using @google-cloud/storage SDK\nconst {Storage} = require('@google-cloud/storage');\nconst storage = new Storage(); // ADC auto-detects credentials\nconst [files] = await storage.bucket('my-bucket').getFiles();\nconsole.log(files.map(f => f.name));",
    agent_tips: [
      "Always use official SDKs (@google-cloud/*) — they handle auth, retries, pagination.",
      "Set GOOGLE_APPLICATION_CREDENTIALS env var for service account auth.",
      "For JP compliance, use asia-northeast1 (Tokyo) or asia-northeast2 (Osaka) regions.",
      "Use gcloud CLI for quick testing: gcloud compute instances list.",
      "Enable APIs first in Console — disabled by default, API calls will 403 otherwise."
    ],
    docs_url: "https://cloud.google.com/apis/docs/overview"
  },
  {
    service_id: "cloudflare",
    base_url: "https://api.cloudflare.com/client/v4/",
    api_version: "v4",
    auth_overview: "API token (recommended) or API key + email. Tokens are scoped and more secure. Pass as Bearer token in Authorization header.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to dash.cloudflare.com/profile/api-tokens. 2. Create token with specific permissions (e.g., Zone:DNS:Edit). 3. Use Authorization: Bearer {token}. 4. Legacy: X-Auth-Email + X-Auth-Key headers (not recommended).",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/zones", description: "List zones (domains)", auth_required: true },
      { method: "GET", path: "/zones/{id}/dns_records", description: "List DNS records for a zone", auth_required: true },
      { method: "POST", path: "/zones/{id}/dns_records", description: "Create DNS record", auth_required: true },
      { method: "PUT", path: "/zones/{id}/settings/ssl", description: "Update SSL/TLS settings", auth_required: true },
      { method: "POST", path: "/accounts/{id}/workers/scripts/{name}", description: "Deploy Workers script", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page + per_page parameters. Response includes result_info: {page, per_page, total_count, total_pages}.",
    rate_limit: "1,200 req/5min globally. Some endpoints lower (e.g., Workers: 1,000/min).",
    error_format: "JSON: {\"success\":false,\"errors\":[{\"code\":1003,\"message\":\"...\"}],\"messages\":[],\"result\":null}",
    quickstart_example: "GET /client/v4/zones\nAuthorization: Bearer {api_token}\nContent-Type: application/json\n\nResponse: {\"success\":true,\"result\":[{\"id\":\"...\",\"name\":\"example.com\",...}]}",
    agent_tips: [
      "Always check 'success' field in response — HTTP 200 doesn't mean success.",
      "Use API tokens over global API key — tokens are scoped and revocable.",
      "Zone ID is required for most operations — get it from GET /zones first.",
      "Workers and Pages have separate API patterns — check docs for each.",
      "Purge cache: POST /zones/{id}/purge_cache with {purge_everything:true}."
    ],
    docs_url: "https://developers.cloudflare.com/api/"
  },
  {
    service_id: "render",
    base_url: "https://api.render.com/v1/",
    api_version: "v1",
    auth_overview: "API key authentication. Generate at dashboard.render.com Account Settings. Pass as Bearer token in Authorization header.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to dashboard.render.com → Account Settings → API Keys. 2. Create new key. 3. Use Authorization: Bearer {key}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/services", description: "List all services", auth_required: true },
      { method: "POST", path: "/services", description: "Create a new service", auth_required: true },
      { method: "POST", path: "/services/{id}/deploys", description: "Trigger a deploy", auth_required: true },
      { method: "GET", path: "/services/{id}/deploys", description: "List deploys for a service", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Cursor-based. Response includes cursor field. Pass as cursor query param.",
    rate_limit: "Not officially documented. Observed ~100 req/min.",
    error_format: "JSON: {\"id\":\"...\",\"message\":\"...\"}",
    quickstart_example: "GET /v1/services\nAuthorization: Bearer {api_key}\n\nResponse: [{\"service\":{\"id\":\"...\",\"name\":\"my-app\",\"type\":\"web_service\",...}}]",
    agent_tips: [
      "Service types: web_service, private_service, background_worker, static_site, cron_job.",
      "Deploy hooks are simpler for CI/CD — no auth needed, just POST to webhook URL.",
      "Check service.suspended field — suspended services won't deploy.",
      "Use environment groups to share env vars across services."
    ],
    docs_url: "https://docs.render.com/api"
  },
  {
    service_id: "fly-io",
    base_url: "https://api.machines.dev/v1/",
    api_version: "v1 (Machines API)",
    auth_overview: "API token authentication. Generate via flyctl CLI (fly tokens create) or dashboard. Pass as Bearer token.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Install flyctl: curl -L https://fly.io/install.sh | sh. 2. fly auth login. 3. fly tokens create for API token. 4. Use Authorization: Bearer {token}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/apps/{app}/machines", description: "List Machines in an app", auth_required: true },
      { method: "POST", path: "/apps/{app}/machines", description: "Create a new Machine", auth_required: true },
      { method: "POST", path: "/apps/{app}/machines/{id}/start", description: "Start a Machine", auth_required: true },
      { method: "POST", path: "/apps/{app}/machines/{id}/stop", description: "Stop a Machine", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "No pagination — returns all machines for an app.",
    rate_limit: "Not officially documented. Generous limits for Machine operations.",
    error_format: "JSON: {\"error\":\"...\",\"status\":\"...\"}",
    quickstart_example: "GET /v1/apps/my-app/machines\nAuthorization: Bearer {fly_token}\n\nResponse: [{\"id\":\"...\",\"name\":\"...\",\"state\":\"started\",\"region\":\"nrt\",...}]",
    agent_tips: [
      "Machines API is the primary API — Fly Apps v1 API is deprecated.",
      "Use region 'nrt' (Narita/Tokyo) for JP workloads.",
      "Machines are per-request VMs — they can start/stop in <300ms.",
      "Use fly-replay header for request routing to specific regions.",
      "Check machine.state: created, started, stopped, destroyed."
    ],
    docs_url: "https://fly.io/docs/machines/api/"
  },
  // ── Productivity / PM ──────────────────────────────────
  {
    service_id: "clickup",
    base_url: "https://api.clickup.com/api/v2/",
    api_version: "v2",
    auth_overview: "OAuth 2.0 or personal API token. Personal token for quick setup — generate in Settings > Apps. OAuth for production integrations.",
    auth_token_url: "https://api.clickup.com/api/v2/oauth/token",
    auth_scopes: null,
    auth_setup_hint: "1. Settings > Apps > Generate API Token (personal). 2. Use Authorization: {token} (no Bearer prefix!). 3. For OAuth: register app, get client_id/secret, redirect flow.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/team", description: "Get workspace info", auth_required: true },
      { method: "POST", path: "/list/{id}/task", description: "Create a task in a list", auth_required: true },
      { method: "GET", path: "/task/{id}", description: "Get task details", auth_required: true },
      { method: "PUT", path: "/task/{id}", description: "Update a task", auth_required: true },
      { method: "GET", path: "/team/{id}/space", description: "Get spaces in workspace", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page parameter (0-indexed). Response returns tasks array — empty array means no more pages.",
    rate_limit: "100 req/min per token. 429 with Retry-After header.",
    error_format: "JSON: {\"err\":\"...\",\"ECODE\":\"...\"}",
    quickstart_example: "GET /api/v2/team\nAuthorization: {personal_token}\n\nResponse: {\"teams\":[{\"id\":\"...\",\"name\":\"My Workspace\",...}]}",
    agent_tips: [
      "Auth header is Authorization: {token} — NO 'Bearer' prefix for personal tokens.",
      "Hierarchy: Workspace > Space > Folder > List > Task. Navigate top-down.",
      "Custom fields are in custom_fields array — use field ID, not name, for updates.",
      "Use include_subtasks=true query param to get subtasks in task lists.",
      "Webhooks available for real-time updates — register via POST /team/{id}/webhook."
    ],
    docs_url: "https://clickup.com/api/"
  },
  {
    service_id: "asana",
    base_url: "https://app.asana.com/api/1.0/",
    api_version: "1.0",
    auth_overview: "OAuth 2.0 or Personal Access Token (PAT). PAT for quick setup — generate in Developer Console. OAuth for production apps.",
    auth_token_url: "https://app.asana.com/-/oauth_token",
    auth_scopes: "default (full access)",
    auth_setup_hint: "1. Developer Console > My Apps > Create Token (PAT). 2. Use Authorization: Bearer {token}. 3. For OAuth: register app, get client_id/secret, auth code flow.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/workspaces", description: "List all workspaces", auth_required: true },
      { method: "POST", path: "/tasks", description: "Create a task", auth_required: true },
      { method: "GET", path: "/tasks/{id}", description: "Get task details", auth_required: true },
      { method: "GET", path: "/projects/{id}/tasks", description: "List tasks in a project", auth_required: true },
      { method: "POST", path: "/tasks/{id}/subtasks", description: "Create a subtask", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Cursor-based: next_page.offset in response. Pass as offset query param.",
    rate_limit: "1,500 req/min per PAT. Free tier: 150 req/min. Retry-After header on 429.",
    error_format: "JSON: {\"errors\":[{\"message\":\"...\",\"help\":\"...\",\"phrase\":\"...\"}]}",
    quickstart_example: "POST /api/1.0/tasks\nAuthorization: Bearer {token}\nContent-Type: application/json\n\n{\"data\":{\"workspace\":\"{workspace_gid}\",\"name\":\"New task\",\"projects\":[\"{project_gid}\"]}}",
    agent_tips: [
      "All response data is wrapped in {data: ...} — always unwrap.",
      "Use opt_fields query param to select specific fields and reduce payload.",
      "GIDs (global IDs) are strings, not numbers — treat as strings.",
      "Batch API: POST /batch for up to 10 requests in one call.",
      "Webhooks: POST /webhooks to subscribe to project/task changes."
    ],
    docs_url: "https://developers.asana.com/docs/overview"
  },
  {
    service_id: "zapier",
    base_url: "https://api.zapier.com/v1/",
    api_version: "v1 (NLA — Natural Language Actions)",
    auth_overview: "API key or OAuth. NLA API uses API key from zapier.com/l/natural-language-actions. Pass as Bearer token.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to zapier.com/l/natural-language-actions. 2. Enable actions (Gmail, Slack, etc.) for AI access. 3. Get API key. 4. Use Authorization: Bearer {key} or x-api-key header.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/exposed/", description: "List exposed actions configured for AI", auth_required: true },
      { method: "POST", path: "/exposed/{action_id}/execute/", description: "Execute an action with natural language", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — returns all exposed actions.",
    rate_limit: "Not officially documented. Dependent on connected service limits.",
    error_format: "JSON: {\"error\":\"...\",\"status\":\"error\"}",
    quickstart_example: "POST /v1/exposed/{action_id}/execute/\nAuthorization: Bearer {api_key}\nContent-Type: application/json\n\n{\"instructions\":\"Send a Slack message to #general saying hello\"}",
    agent_tips: [
      "NLA API is designed for AI agents — pass natural language instructions.",
      "Each action must be manually 'exposed' by the user in Zapier dashboard.",
      "Preview before execute: POST /exposed/{id}/execute/ with preview_only:true.",
      "Connected accounts are pre-configured — the agent doesn't need individual service auth.",
      "For traditional automation, use Zap webhooks (POST to webhook URL) instead of NLA."
    ],
    docs_url: "https://platform.zapier.com/docs/natural-language-actions"
  },
  {
    service_id: "google-workspace",
    base_url: "https://www.googleapis.com/",
    api_version: "Varies: admin/directory/v1, gmail/v1, calendar/v3, drive/v3",
    auth_overview: "OAuth 2.0 with domain-wide delegation for admin, or per-user OAuth. Service account with domain-wide delegation for server apps. API key for public data only.",
    auth_token_url: "https://oauth2.googleapis.com/token",
    auth_scopes: "Per-API: https://www.googleapis.com/auth/admin.directory.user (Users), https://www.googleapis.com/auth/calendar (Calendar), https://www.googleapis.com/auth/drive (Drive)",
    auth_setup_hint: "1. Google Cloud Console > Create project > Enable Workspace APIs. 2. Create OAuth client or service account. 3. For admin APIs: enable domain-wide delegation in Google Admin Console. 4. Set GOOGLE_APPLICATION_CREDENTIALS for service accounts.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/admin/directory/v1/users", description: "List users in domain", auth_required: true },
      { method: "GET", path: "/calendar/v3/calendars/{id}/events", description: "List calendar events", auth_required: true },
      { method: "GET", path: "/drive/v3/files", description: "List files in Drive", auth_required: true },
      { method: "POST", path: "/gmail/v1/users/me/messages/send", description: "Send email via Gmail API", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "nextPageToken/pageToken pattern. maxResults for page size.",
    rate_limit: "Per-API: Admin SDK 2,400/min, Calendar 500/100s/user, Drive 12,000/min, Gmail 250 quota units/user/sec.",
    error_format: "JSON: {\"error\":{\"code\":403,\"message\":\"...\",\"status\":\"PERMISSION_DENIED\",\"errors\":[...]}}",
    quickstart_example: "GET /admin/directory/v1/users?domain=example.com&maxResults=10\nAuthorization: Bearer {access_token}\n\nResponse: {\"users\":[{\"primaryEmail\":\"...\",\"name\":{\"fullName\":\"...\"},...}]}",
    agent_tips: [
      "Each Workspace API (Gmail, Calendar, Drive, Admin) has different scopes — request minimal scopes.",
      "Domain-wide delegation requires Google Workspace admin to authorize the service account.",
      "Use fields parameter to select specific response fields (same as opt_fields).",
      "Gmail API uses base64url encoding for message bodies — not plain base64.",
      "Admin SDK requires super admin or delegated admin privileges."
    ],
    docs_url: "https://developers.google.com/workspace"
  },
  {
    service_id: "dropbox-business",
    base_url: "https://api.dropboxapi.com/2/",
    api_version: "2",
    auth_overview: "OAuth 2.0 with PKCE. Short-lived access tokens (4 hours) + refresh tokens. Scoped permissions via App Console.",
    auth_token_url: "https://api.dropboxapi.com/oauth2/token",
    auth_scopes: "files.content.read, files.content.write, files.metadata.read, sharing.read, account_info.read",
    auth_setup_hint: "1. Create app at dropbox.com/developers/apps. 2. Set permissions (scopes). 3. Generate access token for testing, or implement OAuth flow. 4. Use Authorization: Bearer {token}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/files/list_folder", description: "List files in a folder", auth_required: true },
      { method: "POST", path: "/files/upload", description: "Upload file (up to 150MB)", auth_required: true },
      { method: "POST", path: "/files/download", description: "Download a file", auth_required: true },
      { method: "POST", path: "/sharing/list_shared_links", description: "List shared links", auth_required: true }
    ],
    request_content_type: "application/json (RPC), application/octet-stream (upload/download)",
    pagination_style: "Cursor-based: has_more + cursor in response. Pass cursor to /files/list_folder/continue.",
    rate_limit: "Not rate-limited per se, but 409 rate_limit errors for write-heavy operations. Automatic retry with Retry-After.",
    error_format: "JSON: {\"error_summary\":\"path/not_found/...\",\"error\":{\".tag\":\"path\",\"path\":{\".tag\":\"not_found\"}}}",
    quickstart_example: "POST /2/files/list_folder\nAuthorization: Bearer {token}\nContent-Type: application/json\n\n{\"path\":\"/Documents\",\"recursive\":false,\"limit\":100}",
    agent_tips: [
      "All endpoints use POST (even reads) — Dropbox API is RPC-style, not REST.",
      "File paths start with '/' and are case-insensitive. Root is '' (empty string).",
      "Upload uses content-upload endpoint (content.dropboxapi.com) with Dropbox-API-Arg header.",
      "Access tokens expire in 4 hours — always implement refresh token flow.",
      "Error tags use dot notation: error.\".tag\" — parse carefully."
    ],
    docs_url: "https://www.dropbox.com/developers/documentation/http/overview"
  },
  {
    service_id: "box-jp",
    base_url: "https://api.box.com/2.0/",
    api_version: "2.0",
    auth_overview: "OAuth 2.0 with JWT (server-to-server) or standard OAuth. JWT recommended for automation — no user interaction needed. Developer token for testing (60 min).",
    auth_token_url: "https://api.box.com/oauth2/token",
    auth_scopes: "root_readwrite, manage_users, manage_groups, manage_data_retention, etc.",
    auth_setup_hint: "1. Create app at app.box.com/developers/console. 2. Choose OAuth 2.0 with JWT. 3. Generate key pair + download JSON config. 4. Admin must authorize the app in Admin Console. 5. Use Box SDK with JSON config.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/folders/{id}/items", description: "List items in a folder (root: id=0)", auth_required: true },
      { method: "POST", path: "/files/content", description: "Upload a file (multipart)", auth_required: true },
      { method: "GET", path: "/files/{id}/content", description: "Download a file", auth_required: true },
      { method: "GET", path: "/search", description: "Search files and folders", auth_required: true },
      { method: "POST", path: "/folders", description: "Create a new folder", auth_required: true }
    ],
    request_content_type: "application/json (metadata), multipart/form-data (upload)",
    pagination_style: "offset + limit parameters. total_count in response.",
    rate_limit: "1,000 API calls/min per user. Burst: up to 10 req/sec. Retry-After header on 429.",
    error_format: "JSON: {\"type\":\"error\",\"status\":409,\"code\":\"conflict\",\"message\":\"...\",\"context_info\":{...}}",
    quickstart_example: "GET /2.0/folders/0/items?limit=100\nAuthorization: Bearer {token}\n\nResponse: {\"total_count\":5,\"entries\":[{\"type\":\"file\",\"id\":\"...\",\"name\":\"...\"},...]}",
    agent_tips: [
      "Root folder ID is always '0'. All folder operations start from here.",
      "JWT auth requires Admin Console authorization — without it, API calls silently fail.",
      "Use 'fields' query param to request specific fields and reduce payload.",
      "Upload uses multipart form with 'attributes' JSON and file content.",
      "Box has strong JP data residency support — data stored in JP region."
    ],
    docs_url: "https://developer.box.com/reference/"
  },
  // ── Marketing / MA ──────────────────────────────────────
  {
    service_id: "marketo",
    base_url: "https://{munchkin_id}.mktorest.com/rest/",
    api_version: "v1",
    auth_overview: "OAuth 2.0 client credentials. Get client_id + client_secret from Admin > Integration > LaunchPoint. Access token valid for 1 hour.",
    auth_token_url: "https://{munchkin_id}.mktorest.com/identity/oauth/token",
    auth_scopes: null,
    auth_setup_hint: "1. Admin > Integration > LaunchPoint > New Service. 2. Note client_id and client_secret. 3. GET /identity/oauth/token?grant_type=client_credentials&client_id={id}&client_secret={secret}. 4. Use access_token as Bearer.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/v1/leads.json", description: "Get leads by filter (email, id, etc.)", auth_required: true },
      { method: "POST", path: "/v1/leads.json", description: "Create/update leads (upsert)", auth_required: true },
      { method: "POST", path: "/v1/campaigns/{id}/trigger.json", description: "Trigger a smart campaign", auth_required: true },
      { method: "GET", path: "/v1/activities.json", description: "Get lead activities", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "nextPageToken in response. Paging token for bulk extract. Max 300 records per page.",
    rate_limit: "50,000 API calls/day (standard). 10 concurrent API calls. 100 calls per 20 seconds.",
    error_format: "JSON: {\"requestId\":\"...\",\"success\":false,\"errors\":[{\"code\":\"601\",\"message\":\"Access token invalid\"}]}",
    quickstart_example: "GET /rest/v1/leads.json?filterType=email&filterValues=test@example.com\nAuthorization: Bearer {access_token}\n\nResponse: {\"requestId\":\"...\",\"success\":true,\"result\":[{\"id\":1,\"email\":\"test@example.com\",...}]}",
    agent_tips: [
      "Munchkin ID is in your Marketo URL — e.g., 123-ABC-456.mktorest.com.",
      "Access tokens expire in 1 hour — cache and refresh proactively.",
      "Leads.json action can be 'createOrUpdate' (default), 'createOnly', 'updateOnly'.",
      "Use Bulk Extract API for large datasets — async job-based pattern.",
      "Daily API limit (50K) is shared across all integrations — monitor usage."
    ],
    docs_url: "https://developers.marketo.com/rest-api/"
  },
  {
    service_id: "pipedrive",
    base_url: "https://api.pipedrive.com/v1/",
    api_version: "v1",
    auth_overview: "API token or OAuth 2.0. API token from Settings > Personal preferences > API. Pass as api_token query parameter or OAuth Bearer.",
    auth_token_url: "https://oauth.pipedrive.com/oauth/token",
    auth_scopes: "deals:read, deals:write, persons:read, persons:write, activities:read, activities:write, etc.",
    auth_setup_hint: "1. Settings > Personal preferences > API > copy API token. 2. Append ?api_token={token} to all requests. 3. For OAuth: register app in Marketplace, implement auth code flow.",
    sandbox_url: "https://developers.pipedrive.com/docs/api/v1 (sandbox accounts available)",
    key_endpoints: [
      { method: "GET", path: "/deals", description: "List deals with filters", auth_required: true },
      { method: "POST", path: "/deals", description: "Create a deal", auth_required: true },
      { method: "GET", path: "/persons", description: "List contacts/persons", auth_required: true },
      { method: "POST", path: "/activities", description: "Create an activity (call, meeting, etc.)", auth_required: true },
      { method: "GET", path: "/pipelines", description: "List sales pipelines", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Cursor-based: additional_data.pagination.next_start in response. Pass as start param. limit for page size.",
    rate_limit: "80 req/2sec (Essential), 160/2sec (Advanced), 240/2sec (Professional). X-RateLimit-* headers.",
    error_format: "JSON: {\"success\":false,\"error\":\"...\",\"error_info\":\"...\",\"data\":null}",
    quickstart_example: "GET /v1/deals?status=open&limit=10&api_token={token}\n\nResponse: {\"success\":true,\"data\":[{\"id\":1,\"title\":\"Big Deal\",\"value\":50000,...}]}",
    agent_tips: [
      "API token in query param is simplest but less secure — use OAuth for production.",
      "All responses have success boolean — check it, HTTP 200 doesn't guarantee success.",
      "Custom fields use hashed keys (e.g., 'abc123_custom_field') — GET /dealFields to map names.",
      "Use filter_id parameter to apply saved filters from the UI.",
      "Deals flow through pipeline stages — use PUT /deals/{id} to move stages."
    ],
    docs_url: "https://developers.pipedrive.com/docs/api/v1"
  },
  // ── Support ──────────────────────────────────────────────
  {
    service_id: "freshdesk",
    base_url: "https://{domain}.freshdesk.com/api/v2/",
    api_version: "v2",
    auth_overview: "API key authentication via Basic Auth. API key as username, 'X' as password. Get key from Profile Settings.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Login to Freshdesk > Profile icon > Profile Settings. 2. Copy API Key. 3. Use Basic Auth: base64({api_key}:X). 4. Or pass api_key as username in basic auth.",
    sandbox_url: "https://{domain}.freshdesk.com (free plan available for testing)",
    key_endpoints: [
      { method: "GET", path: "/tickets", description: "List tickets", auth_required: true },
      { method: "POST", path: "/tickets", description: "Create a ticket", auth_required: true },
      { method: "PUT", path: "/tickets/{id}", description: "Update a ticket", auth_required: true },
      { method: "GET", path: "/contacts", description: "List contacts", auth_required: true },
      { method: "POST", path: "/tickets/{id}/reply", description: "Reply to a ticket", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page + per_page parameters. Link header with next page URL. Max 30 per page for tickets.",
    rate_limit: "Tier-based: Free (50/min), Growth (200/min), Pro (400/min), Enterprise (700/min).",
    error_format: "JSON: {\"description\":\"Validation failed\",\"errors\":[{\"field\":\"email\",\"message\":\"...\",\"code\":\"...\"}]}",
    quickstart_example: "GET /api/v2/tickets?per_page=10\nAuthorization: Basic {base64(api_key:X)}\n\nResponse: [{\"id\":1,\"subject\":\"Help needed\",\"status\":2,\"priority\":1,...}]",
    agent_tips: [
      "Basic Auth password is literally 'X' (the letter) — not empty, not the key again.",
      "Status values: 2=Open, 3=Pending, 4=Resolved, 5=Closed. Use numeric values.",
      "Priority: 1=Low, 2=Medium, 3=High, 4=Urgent. Numeric only.",
      "Include=stats adds response/resolution time stats to ticket responses.",
      "Custom fields use 'custom_fields' object with cf_fieldname keys."
    ],
    docs_url: "https://developers.freshdesk.com/api/"
  },
  // ── Communication ──────────────────────────────────────
  {
    service_id: "lineworks",
    base_url: "https://www.worksapis.com/v1.0/",
    api_version: "v1.0 (API 2.0)",
    auth_overview: "OAuth 2.0 with JWT assertion. Service account issues JWT, exchanges for access token. Developer Console for client_id and service account.",
    auth_token_url: "https://auth.worksmobile.com/oauth2/v2.0/token",
    auth_scopes: "bot, user.read, calendar, directory",
    auth_setup_hint: "1. LINE WORKS Developer Console > App登録. 2. Service Account発行 + Private Key ダウンロード. 3. JWTを生成 (iss=client_id, sub=service_account_id). 4. POST /token with grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/bots/{botId}/channels/{channelId}/messages", description: "Send message via Bot", auth_required: true },
      { method: "GET", path: "/users/{userId}", description: "Get user info", auth_required: true },
      { method: "GET", path: "/users/{userId}/calendar/events", description: "List calendar events", auth_required: true },
      { method: "POST", path: "/bots/{botId}/channels/{channelId}/messages/push", description: "Push message to channel", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Cursor-based: responseMetaData.nextCursor in response.",
    rate_limit: "200 req/sec per app. Messaging: 5,000 messages/day for free plan.",
    error_format: "JSON: {\"code\":\"UNAUTHORIZED\",\"description\":\"...\"}",
    quickstart_example: "POST /v1.0/bots/{botId}/channels/{channelId}/messages\nAuthorization: Bearer {access_token}\nContent-Type: application/json\n\n{\"content\":{\"type\":\"text\",\"text\":\"Hello from agent\"}}",
    agent_tips: [
      "JWT auth is mandatory for API 2.0 — no simple API key option.",
      "Private key must be RSA 2048-bit. Use jsonwebtoken library to sign JWTs.",
      "Bot must be registered and added to channels before sending messages.",
      "Access tokens expire in 24 hours — refresh proactively.",
      "JP企業でSlackの代替として導入されている。Messaging APIのパターンはLINE Botに類似。"
    ],
    docs_url: "https://developers.worksmobile.com/jp/docs/api"
  },
  {
    service_id: "channel-talk",
    base_url: "https://api.channel.io/open/v5/",
    api_version: "v5",
    auth_overview: "API key + secret pair. Pass as X-Access-Key and X-Access-Secret headers. Generate in Channel Talk Settings > Developer.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Channel Talk 管理画面 > 設定 > デベロッパー. 2. API Key (Access Key) + Secret を取得. 3. Set X-Access-Key and X-Access-Secret headers.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/user-chats", description: "List user chats (conversations)", auth_required: true },
      { method: "POST", path: "/user-chats/{id}/messages", description: "Send message in a chat", auth_required: true },
      { method: "GET", path: "/users", description: "List users/contacts", auth_required: true },
      { method: "POST", path: "/user-chats", description: "Create a new chat", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Cursor-based: since/limit parameters.",
    rate_limit: "Not officially documented. Observed ~100 req/sec.",
    error_format: "JSON: {\"type\":\"error\",\"message\":\"...\"}",
    quickstart_example: "GET /open/v5/user-chats?limit=10\nX-Access-Key: {access_key}\nX-Access-Secret: {access_secret}\n\nResponse: {\"userChats\":[{\"id\":\"...\",\"state\":\"opened\",...}]}",
    agent_tips: [
      "Dual header auth: both X-Access-Key AND X-Access-Secret required.",
      "User chats vs team chats — user-chats are customer conversations, team-chats are internal.",
      "Webhook for real-time: Settings > Developer > Webhook URL.",
      "JP/KR market dominant — UI is in Japanese, API responses may contain JP text.",
      "Message types: text, file, link — check type field when parsing."
    ],
    docs_url: "https://developers.channel.io/docs"
  },
  // ── JP SaaS ─────────────────────────────────────────────
  {
    service_id: "yayoi",
    base_url: "https://api.yayoi-kk.co.jp/",
    api_version: "v1 (limited)",
    auth_overview: "OAuth 2.0 via Yayoi ID. Limited API availability — primarily Yayoi Smart Connect for data import/export.",
    auth_token_url: "https://auth.yayoi-kk.co.jp/oauth/token",
    auth_scopes: "smartconnect",
    auth_setup_hint: "1. 弥生IDでログイン. 2. スマート取引取込APIのパートナー申請. 3. OAuth認証フローでaccess_token取得. 4. 注意: APIは限定的で、パートナー申請が必要.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/v1/smart-connect/transactions", description: "Import transactions via Smart Connect", auth_required: true },
      { method: "GET", path: "/v1/smart-connect/status", description: "Check import status", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A",
    rate_limit: "Not documented. Partner agreement specifies limits.",
    error_format: "JSON: {\"error\":\"...\",\"error_description\":\"...\"}",
    quickstart_example: "POST /v1/smart-connect/transactions\nAuthorization: Bearer {access_token}\nContent-Type: application/json\n\n{\"transactions\":[{\"date\":\"2024-01-15\",\"amount\":10000,\"description\":\"売上\"}]}",
    agent_tips: [
      "API利用にはパートナー申請が必要 — 個人開発者には開放されていない.",
      "スマート取引取込がメインのAPI — 他の機能のAPIは限定的.",
      "弥生会計/弥生青色申告のデータは直接APIアクセス不可 — Smart Connect経由.",
      "CSVインポート/エクスポートが事実上の主要連携方法.",
      "確定申告シーズン（1-3月）は負荷が高い."
    ],
    docs_url: "https://www.yayoi-kk.co.jp/products/smart-connect/"
  },
  {
    service_id: "jobcan",
    base_url: "https://ssl.wf.jobcan.jp/api/v1/",
    api_version: "v1",
    auth_overview: "API token authentication. Generate in ジョブカン管理画面 > API設定. Pass as Authorization: Token {token}.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. ジョブカン管理画面にログイン. 2. 設定 > その他 > API設定. 3. APIトークンを発行. 4. Authorization: Token {token} ヘッダーで利用.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/attendances", description: "Get attendance records (出勤データ)", auth_required: true },
      { method: "POST", path: "/attendances/clock-in", description: "Clock in (打刻)", auth_required: true },
      { method: "GET", path: "/employees", description: "List employees", auth_required: true },
      { method: "GET", path: "/shifts", description: "Get shift schedules", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page + per_page parameters.",
    rate_limit: "Not officially documented. Recommended: max 60 req/min.",
    error_format: "JSON: {\"errors\":[{\"message\":\"...\"}]}",
    quickstart_example: "GET /api/v1/attendances?date=2024-01-15\nAuthorization: Token {api_token}\n\nResponse: {\"attendances\":[{\"employee_id\":\"...\",\"clock_in\":\"09:00\",...}]}",
    agent_tips: [
      "ジョブカンは勤怠/ワークフロー/経費/採用/労務の5製品 — APIは勤怠がメイン.",
      "打刻データは日本時間 (JST) で返される.",
      "従業員IDは社員番号ではなくジョブカン内部ID — マッピングが必要.",
      "API設定は管理者権限のみ. 一般ユーザーはAPI利用不可.",
      "36協定管理のため残業時間の集計に特に有用."
    ],
    docs_url: "https://jobcan.zendesk.com/hc/ja/categories/200714498"
  },
  {
    service_id: "base-ec",
    base_url: "https://api.thebase.in/1/",
    api_version: "1",
    auth_overview: "OAuth 2.0. Register app at developers.thebase.in. Auth code flow for shop owner authorization.",
    auth_token_url: "https://api.thebase.in/1/oauth/token",
    auth_scopes: "read_users, write_items, read_items, read_orders, write_orders, etc.",
    auth_setup_hint: "1. developers.thebase.in でアプリ登録. 2. client_id/secret取得. 3. OAuth認証フロー: /1/oauth/authorize → code → /1/oauth/token. 4. Bearer token利用.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/items", description: "List products (商品一覧)", auth_required: true },
      { method: "POST", path: "/items/add", description: "Add a product", auth_required: true },
      { method: "GET", path: "/orders", description: "List orders (注文一覧)", auth_required: true },
      { method: "GET", path: "/users/me", description: "Get authenticated shop info", auth_required: true }
    ],
    request_content_type: "application/x-www-form-urlencoded (POST), JSON (GET responses)",
    pagination_style: "offset + limit parameters. Max 100 per page.",
    rate_limit: "3 req/sec per access token. Daily limit varies by plan.",
    error_format: "JSON: {\"error\":\"...\",\"error_description\":\"...\"}",
    quickstart_example: "GET /1/items?limit=20\nAuthorization: Bearer {access_token}\n\nResponse: {\"items\":[{\"item_id\":123,\"title\":\"商品A\",\"price\":1000,...}]}",
    agent_tips: [
      "POSTリクエストはJSON非対応 — form-urlencoded形式で送信.",
      "Access tokenは30日で失効 — refresh_tokenで更新必須.",
      "商品価格は税込み（内税）で管理されている.",
      "画像アップロードはmultipart/form-data.",
      "JP個人EC最大手 — 200万ショップ以上."
    ],
    docs_url: "https://docs.thebase.in/"
  },
  {
    service_id: "misoca",
    base_url: "https://app.misoca.jp/api/v3/",
    api_version: "v3",
    auth_overview: "OAuth 2.0. Register app at 弥生IDの開発者ポータル. Misocaは弥生グループのため弥生IDで認証.",
    auth_token_url: "https://app.misoca.jp/oauth2/token",
    auth_scopes: "invoice:read, invoice:write, contact:read",
    auth_setup_hint: "1. 弥生ID開発者ポータルでアプリ登録. 2. OAuth認証フローでaccess_token取得. 3. Authorization: Bearer {token}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/invoices", description: "List invoices (請求書一覧)", auth_required: true },
      { method: "POST", path: "/invoices", description: "Create an invoice", auth_required: true },
      { method: "GET", path: "/invoices/{id}/pdf", description: "Download invoice as PDF", auth_required: true },
      { method: "GET", path: "/contacts", description: "List contacts (取引先一覧)", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page + per_page parameters.",
    rate_limit: "30 req/min.",
    error_format: "JSON: {\"errors\":[{\"message\":\"...\",\"code\":\"...\"}]}",
    quickstart_example: "GET /api/v3/invoices?per_page=10\nAuthorization: Bearer {access_token}\n\nResponse: [{\"id\":1,\"subject\":\"請求書\",\"total_amount\":100000,...}]",
    agent_tips: [
      "弥生グループのため弥生IDが必要 — Misoca単独のアカウントでは不可.",
      "インボイス制度対応 — 適格請求書の発行に対応.",
      "PDF出力はバイナリレスポンス — Content-Type: application/pdf.",
      "金額は税抜で管理、tax_rateを指定して消費税を計算.",
      "個人事業主/小規模向け — freeeやMFと比べてシンプル."
    ],
    docs_url: "https://doc.misoca.jp/"
  },
  {
    service_id: "bakuraku",
    base_url: "https://api.bakuraku.jp/v1/",
    api_version: "v1 (limited availability)",
    auth_overview: "API key authentication. Limited API availability — primarily webhook and CSV-based integration.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. バクラク管理画面 > 設定 > API連携. 2. APIキーを発行. 3. 注意: REST APIは限定的、主にCSV連携とWebhook.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/invoices/import", description: "Import invoices via CSV/API", auth_required: true },
      { method: "GET", path: "/invoices", description: "List processed invoices", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based",
    rate_limit: "Not documented.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "GET /v1/invoices?limit=10\nX-Api-Key: {api_key}\n\nResponse: {\"invoices\":[{\"id\":\"...\",\"vendor_name\":\"...\",\"amount\":50000,...}]}",
    agent_tips: [
      "AI-OCRが強み — 請求書の自動読取がメイン機能.",
      "REST APIは限定的 — Webhook連携 + CSVエクスポートが主な連携方法.",
      "freeeやMFとの会計連携が前提の設計.",
      "インボイス制度対応の適格請求書チェック機能あり.",
      "LayerXが提供 — エンタープライズ向けが急成長中."
    ],
    docs_url: "https://bakuraku.jp/docs/"
  },
  {
    service_id: "teamspirit",
    base_url: "https://login.salesforce.com/services/data/v59.0/",
    api_version: "Salesforce API v59.0",
    auth_overview: "Salesforce OAuth 2.0. TeamSpiritはSalesforce Platform上に構築。Salesforce Connected Appで認証。",
    auth_token_url: "https://login.salesforce.com/services/oauth2/token",
    auth_scopes: "api, refresh_token",
    auth_setup_hint: "1. Salesforce設定 > アプリケーション > 接続アプリケーション > 新規. 2. client_id/secret取得. 3. OAuth フロー (username-password or auth code). 4. instance_urlに対してAPI呼び出し.",
    sandbox_url: "https://test.salesforce.com (sandbox org)",
    key_endpoints: [
      { method: "GET", path: "/sobjects/teamspirit__AtkWork__c", description: "Get attendance records (勤怠レコード)", auth_required: true },
      { method: "POST", path: "/sobjects/teamspirit__AtkWork__c", description: "Create attendance record", auth_required: true },
      { method: "GET", path: "/query?q=SELECT+...", description: "SOQL query for TeamSpirit objects", auth_required: true },
      { method: "GET", path: "/sobjects/teamspirit__AtkEmpDay__c", description: "Get daily attendance details", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "SOQL: nextRecordsUrl in response. REST: N/A per object.",
    rate_limit: "Salesforce limits: 100,000 API calls/24h (Enterprise). Concurrent: 25.",
    error_format: "JSON: [{\"errorCode\":\"...\",\"message\":\"...\",\"fields\":[]}]",
    quickstart_example: "GET /services/data/v59.0/query?q=SELECT+Id,teamspirit__StartTime__c+FROM+teamspirit__AtkWork__c+LIMIT+10\nAuthorization: Bearer {access_token}\n\nResponse: {\"records\":[{\"Id\":\"...\",\"teamspirit__StartTime__c\":\"2024-01-15T09:00:00.000Z\",...}]}",
    agent_tips: [
      "Salesforce Platform上 — 全てのAPIはSalesforce REST/SOQL経由.",
      "カスタムオブジェクト名は teamspirit__ プレフィックス付き.",
      "SOQL必須 — TeamSpirit固有のオブジェクト・フィールド名を把握する必要あり.",
      "Sandbox (test.salesforce.com) でテスト推奨.",
      "勤怠+工数+経費を一元管理 — ERP連携が強み."
    ],
    docs_url: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/"
  },
  {
    service_id: "hrmos",
    base_url: "https://api.hrmos.co/v1/",
    api_version: "v1",
    auth_overview: "API token authentication. Generate in HRMOS管理画面 > API設定. Pass as Bearer token.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. HRMOS管理画面 > 設定 > API連携. 2. APIトークンを発行. 3. Authorization: Bearer {token}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/employees", description: "List employees (従業員一覧)", auth_required: true },
      { method: "GET", path: "/attendances", description: "Get attendance records", auth_required: true },
      { method: "GET", path: "/departments", description: "List departments (部署一覧)", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset + limit parameters.",
    rate_limit: "60 req/min.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "GET /v1/employees?limit=20\nAuthorization: Bearer {api_token}\n\nResponse: {\"employees\":[{\"id\":\"...\",\"name\":\"...\",\"department\":\"...\",...}]}",
    agent_tips: [
      "HRMOS勤怠とHRMOS採用は別製品 — APIも別系統.",
      "BizReachグループ（現Visional）提供.",
      "従業員データは日本語フィールド名を含む場合あり.",
      "勤怠データはJST基準.",
      "SmartHRやfreee人事との連携パターンが多い."
    ],
    docs_url: "https://hrmos.co/api-docs/"
  },
  {
    service_id: "talentio",
    base_url: "https://api.talentio.com/v1/",
    api_version: "v1",
    auth_overview: "API key authentication. Generate in Talentio管理画面. Pass as Bearer token.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Talentio管理画面 > 設定 > API. 2. APIキーを生成. 3. Authorization: Bearer {api_key}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/applicants", description: "List job applicants (応募者一覧)", auth_required: true },
      { method: "GET", path: "/jobs", description: "List job postings (求人一覧)", auth_required: true },
      { method: "GET", path: "/stages", description: "List recruitment stages", auth_required: true },
      { method: "PUT", path: "/applicants/{id}/stage", description: "Move applicant to next stage", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page + per_page parameters.",
    rate_limit: "Not officially documented. Recommended: 30 req/min.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "GET /v1/applicants?per_page=20\nAuthorization: Bearer {api_key}\n\nResponse: {\"applicants\":[{\"id\":1,\"name\":\"...\",\"email\":\"...\",\"stage\":\"面接\",...}]}",
    agent_tips: [
      "ATS (採用管理) 特化 — 応募者トラッキングがメイン.",
      "選考ステージは企業カスタム — stages APIで事前取得必要.",
      "応募者データにPII含む — 取扱注意.",
      "HRMOSやGreenhouse との比較で検討されることが多い.",
      "JP中小企業向けATS市場で人気."
    ],
    docs_url: "https://talentio.com/api-docs"
  },
  {
    service_id: "kaonavi",
    base_url: "https://api.kaonavi.jp/api/v2/",
    api_version: "v2",
    auth_overview: "OAuth 2.0 client credentials. consumer_key + consumer_secret from 管理画面. Access token valid for 24 hours.",
    auth_token_url: "https://api.kaonavi.jp/api/v2/token",
    auth_scopes: null,
    auth_setup_hint: "1. カオナビ管理画面 > 設定 > API設定. 2. consumer_key/secret を取得. 3. POST /token with grant_type=client_credentials + Basic auth (key:secret). 4. Bearer token利用.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/members", description: "List all members (社員一覧)", auth_required: true },
      { method: "GET", path: "/members/{id}", description: "Get member details", auth_required: true },
      { method: "GET", path: "/departments", description: "List department tree", auth_required: true },
      { method: "PUT", path: "/members", description: "Bulk update members", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — returns all records. Filter by department or role.",
    rate_limit: "60 req/min. Token refresh: 1 req/min.",
    error_format: "JSON: {\"errors\":[{\"message\":\"...\"}]}",
    quickstart_example: "POST /api/v2/token\nAuthorization: Basic {base64(consumer_key:consumer_secret)}\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials\n\n→ {\"access_token\":\"...\",\"token_type\":\"Bearer\",\"expires_in\":86400}",
    agent_tips: [
      "JP No.1タレントマネジメント — 3,000社以上導入.",
      "Access tokenは24時間有効 — freee (24h) と同じパターン.",
      "社員データは一括取得 → 個別詳細のパターン.",
      "カスタムフィールド（シート）で企業独自の人事データを管理.",
      "部署ツリーはネスト構造 — children配列を再帰処理."
    ],
    docs_url: "https://developer.kaonavi.jp/"
  },
  {
    service_id: "officestation",
    base_url: "https://api.officestation.jp/v1/",
    api_version: "v1 (limited)",
    auth_overview: "API token authentication. 管理画面から発行. Limited API — primarily CSV export and e-Gov連携.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. オフィスステーション管理画面 > API設定. 2. トークン発行. 3. Authorization: Bearer {token}. 注意: API範囲は限定的.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/employees", description: "List employees", auth_required: true },
      { method: "POST", path: "/egov/submit", description: "Submit to e-Gov (電子申請)", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page + per_page.",
    rate_limit: "Not documented.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "GET /v1/employees?per_page=50\nAuthorization: Bearer {token}\n\nResponse: {\"employees\":[{\"id\":\"...\",\"name\":\"...\",\"my_number_registered\":true,...}]}",
    agent_tips: [
      "社会保険・労務手続きに特化 — e-Gov電子申請がメイン機能.",
      "APIは限定的 — CSV連携やe-Gov直接連携が主な利用パターン.",
      "マイナンバー管理機能あり — PIIの取扱に厳重注意.",
      "社労士事務所の導入率が高い.",
      "SmartHR/freee人事と競合だがe-Gov連携に強み."
    ],
    docs_url: "https://www.officestation.jp/"
  },
  {
    service_id: "salesgo",
    base_url: "https://api.salesgo.io/v1/",
    api_version: "v1",
    auth_overview: "API key authentication. Generate in SalesGo管理画面. Pass as X-Api-Key header.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. SalesGo管理画面 > 設定 > API連携. 2. APIキーを取得. 3. X-Api-Key: {key} ヘッダーで利用.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/leads", description: "List leads", auth_required: true },
      { method: "POST", path: "/leads", description: "Create a lead", auth_required: true },
      { method: "GET", path: "/activities", description: "List sales activities", auth_required: true },
      { method: "POST", path: "/emails/send", description: "Send automated email", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset + limit.",
    rate_limit: "Not documented.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "GET /v1/leads?limit=20\nX-Api-Key: {api_key}\n\nResponse: {\"leads\":[{\"id\":\"...\",\"company\":\"...\",\"email\":\"...\",...}]}",
    agent_tips: [
      "JP初のMCP対応SFA — AIエージェント連携が差別化ポイント.",
      "リード管理 + メール自動配信がメイン機能.",
      "470万件の企業データベース内蔵 — ターゲティングに活用.",
      "Salesforce/HubSpotと比較されるが、JP市場特化.",
      "MCP連携でエージェントからの直接操作が可能."
    ],
    docs_url: "https://salesgo.io/"
  },
  {
    service_id: "freee-sign",
    base_url: "https://api.freee.co.jp/sign/v1/",
    api_version: "v1",
    auth_overview: "OAuth 2.0 via freee共通認証基盤. freee会計と同じOAuthフロー.",
    auth_token_url: "https://accounts.secure.freee.co.jp/public_api/token",
    auth_scopes: "sign:read, sign:write",
    auth_setup_hint: "1. freee API設定 > アプリ登録 (sign権限を含む). 2. OAuth認証フロー. 3. freee会計と同一のaccess_tokenでsign APIも利用可能（スコープ設定による）.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/contracts", description: "List contracts (契約一覧)", auth_required: true },
      { method: "POST", path: "/contracts", description: "Create a contract for signing", auth_required: true },
      { method: "GET", path: "/contracts/{id}/pdf", description: "Download signed contract PDF", auth_required: true },
      { method: "POST", path: "/contracts/{id}/send", description: "Send contract for signature", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset + limit.",
    rate_limit: "300 req/5min (freee共通).",
    error_format: "JSON: {\"errors\":[{\"type\":\"...\",\"messages\":[\"...\"]}]}",
    quickstart_example: "GET /sign/v1/contracts?limit=10\nAuthorization: Bearer {access_token}\n\nResponse: {\"contracts\":[{\"id\":1,\"title\":\"業務委託契約書\",\"status\":\"signed\",...}]}",
    agent_tips: [
      "freee会計と認証基盤が共通 — 1つのOAuthアプリでsignも利用可能.",
      "CloudSignの競合 — freeeエコシステム内での電子署名.",
      "契約ステータス: draft → sent → signed → completed.",
      "PDF出力はバイナリ — Content-Disposition headerでファイル名取得.",
      "freee会計の取引データと自動連携可能."
    ],
    docs_url: "https://developer.freee.co.jp/"
  },
  {
    service_id: "garoon",
    base_url: "https://{subdomain}.cybozu.com/g/api/v1/",
    api_version: "v1",
    auth_overview: "Cybozu共通認証: API token or Basic Auth (パスワード認証) or OAuth. kintoneと同じ認証パターン.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Garoon管理画面 > APIトークン設定. 2. 必要な権限でトークン生成. 3. X-Cybozu-API-Token: {token} ヘッダー. 4. 複数トークンはカンマ結合.",
    sandbox_url: "https://developer.cybozu.io/ (developer network)",
    key_endpoints: [
      { method: "GET", path: "/schedule/events", description: "Get schedule events (スケジュール)", auth_required: true },
      { method: "POST", path: "/schedule/events", description: "Create a schedule event", auth_required: true },
      { method: "GET", path: "/workflow/requests", description: "Get workflow requests (ワークフロー)", auth_required: true },
      { method: "GET", path: "/space", description: "Get space info (スペース)", auth_required: true },
      { method: "GET", path: "/bulletin", description: "Get bulletin board posts (掲示板)", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset + limit parameters.",
    rate_limit: "10,000 req/day (standard). Concurrent: 10.",
    error_format: "JSON: {\"message\":\"...\",\"id\":\"...\",\"code\":\"...\"}",
    quickstart_example: "GET /g/api/v1/schedule/events?rangeStart=2024-01-15T00:00:00+09:00&rangeEnd=2024-01-16T00:00:00+09:00\nX-Cybozu-API-Token: {token}\n\nResponse: {\"events\":[{\"id\":\"...\",\"subject\":\"定例会議\",\"start\":{\"dateTime\":\"...\"},...}]}",
    agent_tips: [
      "kintoneと認証方式が同じ — X-Cybozu-API-Tokenヘッダー.",
      "日時はISO 8601 + タイムゾーン必須 (+09:00 for JST).",
      "スケジュール + ワークフロー + 掲示板 + スペースの4機能がメイン.",
      "複数APIトークンの組合せ: カンマ区切りで1ヘッダーに結合.",
      "大企業のグループウェアとして圧倒的シェア — kintoneとの連携が鍵."
    ],
    docs_url: "https://cybozu.dev/ja/garoon/docs/"
  },
  {
    service_id: "hennge-one",
    base_url: "https://api.hennge.com/v1/",
    api_version: "v1 (limited)",
    auth_overview: "Admin API with API token. Generate in HENNGE One管理コンソール. Limited public API availability.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. HENNGE One管理コンソール > API設定. 2. APIトークン発行. 3. 注意: APIは管理者向けで限定的. SSO/セキュリティ設定の自動化が主な用途.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/users", description: "List managed users", auth_required: true },
      { method: "PUT", path: "/users/{id}/policy", description: "Update access policy for user", auth_required: true },
      { method: "GET", path: "/audit-logs", description: "Get audit logs", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page + per_page.",
    rate_limit: "Not documented.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "GET /v1/users?per_page=50\nAuthorization: Bearer {api_token}\n\nResponse: {\"users\":[{\"id\":\"...\",\"email\":\"...\",\"mfa_enabled\":true,...}]}",
    agent_tips: [
      "JP No.1 クラウドセキュリティ (SaaS認証基盤) — IdP + メールセキュリティ.",
      "APIは限定的 — ユーザー管理とポリシー設定がメイン.",
      "SSO (SAML/OIDC) 連携の設定自動化に有用.",
      "メールDLP機能 — 誤送信防止のルール管理が可能.",
      "Okta/Azure ADの競合だがJP大企業に強い."
    ],
    docs_url: "https://hennge.com/jp/"
  },
  {
    service_id: "eight",
    base_url: "https://api.8card.net/v1/",
    api_version: "v1",
    auth_overview: "OAuth 2.0. Sansan提供の名刺管理個人向けサービス. Developer登録でアプリ作成.",
    auth_token_url: "https://api.8card.net/oauth/token",
    auth_scopes: "read_cards, read_profile",
    auth_setup_hint: "1. Eight Developer Portalでアプリ登録. 2. OAuth認証フロー. 3. Authorization: Bearer {access_token}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/cards", description: "List business cards (名刺一覧)", auth_required: true },
      { method: "GET", path: "/cards/{id}", description: "Get card details", auth_required: true },
      { method: "GET", path: "/me", description: "Get authenticated user profile", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset + limit.",
    rate_limit: "Not documented. Recommended: 30 req/min.",
    error_format: "JSON: {\"error\":\"...\",\"error_description\":\"...\"}",
    quickstart_example: "GET /v1/cards?limit=20\nAuthorization: Bearer {access_token}\n\nResponse: {\"cards\":[{\"id\":\"...\",\"company_name\":\"...\",\"person_name\":\"...\",\"email\":\"...\",...}]}",
    agent_tips: [
      "Sansan提供の個人向け名刺管理 — Sansanは法人向け.",
      "名刺データはOCR + 手入力で精度が高い.",
      "個人の名刺データにPII含む — APPI準拠の取扱必須.",
      "APIは読み取り専用が中心 — 名刺の追加はアプリ経由.",
      "Sansan APIとは別系統 — 認証もエンドポイントも異なる."
    ],
    docs_url: "https://8card.net/"
  },
  {
    service_id: "satori-ma",
    base_url: "https://api.satori.marketing/v1/",
    api_version: "v1",
    auth_overview: "API key authentication. Generate in SATORI管理画面. Pass as X-Api-Key header.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. SATORI管理画面 > 設定 > API設定. 2. APIキーを生成. 3. X-Api-Key: {api_key} ヘッダー.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/leads", description: "List leads (リード一覧)", auth_required: true },
      { method: "POST", path: "/leads", description: "Create/update a lead", auth_required: true },
      { method: "GET", path: "/campaigns", description: "List campaigns", auth_required: true },
      { method: "POST", path: "/campaigns/{id}/trigger", description: "Trigger campaign action", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset + limit.",
    rate_limit: "Not documented.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "GET /v1/leads?limit=20\nX-Api-Key: {api_key}\n\nResponse: {\"leads\":[{\"id\":\"...\",\"email\":\"...\",\"company\":\"...\",\"score\":85,...}]}",
    agent_tips: [
      "JP国産MA (Marketing Automation) — 匿名リードのトラッキングが強み.",
      "リードスコアリング機能 — score値でホットリード判定.",
      "Webトラッキングコード設置が前提 — Cookie連携で行動分析.",
      "HubSpot/Marketoの競合だがJP中堅企業に特化.",
      "メールマーケティング + ポップアップ + プッシュ通知の3チャネル."
    ],
    docs_url: "https://satori.marketing/"
  },
  {
    service_id: "bdash",
    base_url: "https://api.b-dash.com/v1/",
    api_version: "v1 (limited)",
    auth_overview: "API key authentication. Generate in b→dash管理画面. Primarily data integration via ETL, not REST API.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. b→dash管理画面 > データ連携設定. 2. API認証キー取得. 3. 注意: REST APIは限定的 — ノーコードETLがメインの連携方法.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/data/import", description: "Import data (CDP取り込み)", auth_required: true },
      { method: "GET", path: "/segments", description: "List customer segments", auth_required: true },
      { method: "POST", path: "/campaigns/trigger", description: "Trigger campaign via API", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Not documented.",
    rate_limit: "Not documented.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "POST /v1/data/import\nX-Api-Key: {api_key}\nContent-Type: application/json\n\n{\"table\":\"customers\",\"records\":[{\"email\":\"...\",\"name\":\"...\",\"segment\":\"...\"}]}",
    agent_tips: [
      "CDP (Customer Data Platform) + MA一体型 — データ統合がメイン.",
      "REST APIは限定的 — ノーコードGUIでのETL連携がメインの使い方.",
      "SQLベースのセグメンテーション — 分析にはSQL知識必要.",
      "JP企業のCDP市場でシェア上位.",
      "Treasure Data/Segment の競合だがノーコード志向."
    ],
    docs_url: "https://bdash-marketing.com/"
  }
];

// Merge
let added = 0;
let skipped = 0;
for (const guide of newGuides) {
  if (existingIds.has(guide.service_id)) {
    skipped++;
    continue;
  }
  existing.push(guide);
  existingIds.add(guide.service_id);
  added++;
}

writeFileSync(guidesPath, JSON.stringify(existing, null, 2) + "\n");
console.log(`Existing guides: ${existing.length - added}`);
console.log(`New guides to add: ${added}`);
console.log(`Skipped (already exist): ${skipped}`);
console.log(`Total guides: ${existing.length}`);
console.log(`Written to: ${guidesPath}`);
