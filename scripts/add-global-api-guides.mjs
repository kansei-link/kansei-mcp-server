#!/usr/bin/env node
/**
 * Add API connection guides for the 62 new global services.
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
  // ── AI / ML ──────────────────────────────────────────────
  {
    service_id: "groq",
    base_url: "https://api.groq.com/openai/v1/",
    api_version: "v1 (OpenAI-compatible)",
    auth_overview: "API key authentication. Generate key at console.groq.com. Pass as Bearer token in Authorization header. OpenAI SDK compatible — just change base_url.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at console.groq.com. 2. Create API key in dashboard. 3. Use OpenAI SDK with base_url='https://api.groq.com/openai/v1'. 4. Or use curl with Authorization: Bearer {key}.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/chat/completions", description: "Chat completion (Llama, Mixtral, Gemma models)", auth_required: true },
      { method: "POST", path: "/audio/transcriptions", description: "Whisper speech-to-text", auth_required: true },
      { method: "GET", path: "/models", description: "List available models", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — streaming via SSE for chat completions.",
    rate_limit: "Free tier: 30 req/min, 14,400 req/day. Paid: higher limits. Model-specific token limits (e.g., Llama 3.1 8B: 6,000 tokens/min free).",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"type\":\"...\",\"code\":\"...\"}}",
    quickstart_example: "POST /openai/v1/chat/completions\nAuthorization: Bearer {api_key}\nContent-Type: application/json\n\n{\"model\":\"llama-3.3-70b-versatile\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
    agent_tips: [
      "OpenAI SDK drop-in: just set base_url to https://api.groq.com/openai/v1.",
      "Fastest inference for open models — Llama 3, Mixtral, Gemma available.",
      "Use 'llama-3.3-70b-versatile' for best quality, 'llama-3.1-8b-instant' for speed.",
      "Streaming is recommended for chat — set stream:true.",
      "Rate limits are per-model. Check X-RateLimit-* headers in responses."
    ],
    docs_url: "https://console.groq.com/docs/api-reference"
  },
  {
    service_id: "google-ai",
    base_url: "https://generativelanguage.googleapis.com/v1beta/",
    api_version: "v1beta",
    auth_overview: "API key authentication. Generate at aistudio.google.com or Google Cloud Console. Pass as ?key= query parameter or x-goog-api-key header.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to aistudio.google.com > Get API Key. 2. Or create in Google Cloud Console > APIs & Services > Credentials. 3. Enable Generative Language API.",
    sandbox_url: "https://aistudio.google.com/",
    key_endpoints: [
      { method: "POST", path: "/models/{model}:generateContent", description: "Generate text/multimodal content", auth_required: true },
      { method: "POST", path: "/models/{model}:streamGenerateContent", description: "Streaming generation", auth_required: true },
      { method: "GET", path: "/models", description: "List available models", auth_required: true },
      { method: "POST", path: "/models/{model}:embedContent", description: "Generate embeddings", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A for generation. Model list: pageToken/nextPageToken.",
    rate_limit: "Free tier: 15 req/min for Gemini Pro, 2 req/min for Gemini Ultra. Paid: 360 req/min. 1,500 req/day free.",
    error_format: "JSON: {\"error\":{\"code\":400,\"message\":\"...\",\"status\":\"INVALID_ARGUMENT\"}}",
    quickstart_example: "POST /v1beta/models/gemini-2.0-flash:generateContent?key={API_KEY}\nContent-Type: application/json\n\n{\"contents\":[{\"parts\":[{\"text\":\"Explain MCP protocol\"}]}]}",
    agent_tips: [
      "Use AI Studio (aistudio.google.com) for quick prototyping before coding.",
      "Gemini 2.0 Flash is best for speed, Gemini 2.5 Pro for quality.",
      "Multimodal: pass image as inline_data with base64 or file URI.",
      "Function calling supported — use 'tools' field in request.",
      "Safety settings can be adjusted per request — useful for content generation."
    ],
    docs_url: "https://ai.google.dev/gemini-api/docs"
  },
  {
    service_id: "cohere",
    base_url: "https://api.cohere.com/v2/",
    api_version: "v2",
    auth_overview: "API key (Bearer token). Generate at dashboard.cohere.com/api-keys. Free trial key available.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at cohere.com. 2. Go to Dashboard > API Keys. 3. Copy key and use as Bearer token.",
    sandbox_url: "https://dashboard.cohere.com/playground",
    key_endpoints: [
      { method: "POST", path: "/chat", description: "Chat completion with Command models", auth_required: true },
      { method: "POST", path: "/embed", description: "Generate text embeddings", auth_required: true },
      { method: "POST", path: "/rerank", description: "Rerank search results by relevance", auth_required: true },
      { method: "POST", path: "/classify", description: "Text classification", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A for generation endpoints.",
    rate_limit: "Trial: 20 req/min. Production: 10,000 req/min. Rate limits in response headers.",
    error_format: "JSON: {\"message\":\"...\",\"status_code\":429}",
    quickstart_example: "POST /v2/chat\nAuthorization: Bearer {api_key}\nContent-Type: application/json\n\n{\"model\":\"command-a-03-2025\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
    agent_tips: [
      "Cohere excels at RAG — use /rerank after vector search for better results.",
      "Embed v3 models support multiple input_types: search_document, search_query, classification.",
      "For RAG: embed docs with input_type='search_document', queries with 'search_query'.",
      "Command R+ is best for complex reasoning, Command R for speed.",
      "Tool use supported in /chat — pass tools array for function calling."
    ],
    docs_url: "https://docs.cohere.com/reference/about"
  },
  {
    service_id: "mistral",
    base_url: "https://api.mistral.ai/v1/",
    api_version: "v1 (OpenAI-compatible)",
    auth_overview: "API key as Bearer token. Generate at console.mistral.ai. OpenAI SDK compatible.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at console.mistral.ai. 2. Generate API key. 3. Use with OpenAI SDK (change base_url) or Mistral SDK.",
    sandbox_url: "https://chat.mistral.ai/",
    key_endpoints: [
      { method: "POST", path: "/chat/completions", description: "Chat completion", auth_required: true },
      { method: "POST", path: "/embeddings", description: "Generate embeddings", auth_required: true },
      { method: "GET", path: "/models", description: "List models", auth_required: true },
      { method: "POST", path: "/fim/completions", description: "Fill-in-the-middle code completion", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — streaming via SSE.",
    rate_limit: "Free tier: 1 req/sec, 500K tokens/month. Paid plans: higher. Check X-RateLimit headers.",
    error_format: "JSON: {\"object\":\"error\",\"message\":\"...\",\"type\":\"...\",\"param\":null,\"code\":null}",
    quickstart_example: "POST /v1/chat/completions\nAuthorization: Bearer {api_key}\n\n{\"model\":\"mistral-large-latest\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
    agent_tips: [
      "OpenAI SDK compatible — change base_url to https://api.mistral.ai/v1.",
      "Mistral Large for quality, Mistral Small for speed, Codestral for code.",
      "FIM (fill-in-middle) endpoint is unique to Mistral — great for code infilling.",
      "JSON mode: set response_format={\"type\":\"json_object\"} for structured output.",
      "Function calling: use tools array, similar to OpenAI format."
    ],
    docs_url: "https://docs.mistral.ai/api/"
  },
  {
    service_id: "perplexity",
    base_url: "https://api.perplexity.ai/",
    api_version: "v1 (OpenAI-compatible)",
    auth_overview: "API key as Bearer token. Generate at perplexity.ai/settings/api.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at perplexity.ai. 2. Go to Settings > API. 3. Generate key. 4. Requires payment method for API access.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/chat/completions", description: "Search-augmented chat completion", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — single endpoint with streaming support.",
    rate_limit: "Varies by plan. Free: very limited. Pro: 50 req/min. Check response headers.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"type\":\"...\",\"code\":...}}",
    quickstart_example: "POST /chat/completions\nAuthorization: Bearer {api_key}\n\n{\"model\":\"sonar-pro\",\"messages\":[{\"role\":\"user\",\"content\":\"What is MCP?\"}]}",
    agent_tips: [
      "Perplexity is search-augmented — responses include citations from the web.",
      "Use 'sonar-pro' for best quality with citations, 'sonar' for speed.",
      "Responses include 'citations' array with source URLs.",
      "Great for fact-checking and real-time information queries.",
      "OpenAI SDK compatible — change base_url to https://api.perplexity.ai."
    ],
    docs_url: "https://docs.perplexity.ai/api-reference"
  },
  {
    service_id: "elevenlabs",
    base_url: "https://api.elevenlabs.io/v1/",
    api_version: "v1",
    auth_overview: "API key in xi-api-key header. Generate at elevenlabs.io/app/settings/api-keys.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at elevenlabs.io. 2. Go to Profile > API Keys. 3. Pass key as xi-api-key header.",
    sandbox_url: "https://elevenlabs.io/app/speech-synthesis",
    key_endpoints: [
      { method: "POST", path: "/text-to-speech/{voice_id}", description: "Convert text to speech audio", auth_required: true },
      { method: "GET", path: "/voices", description: "List available voices", auth_required: true },
      { method: "POST", path: "/voice-generation/generate-voice", description: "Generate a new voice from description", auth_required: true },
      { method: "POST", path: "/speech-to-text", description: "Transcribe audio to text", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A for generation. Voice library: has_more + next_page_token.",
    rate_limit: "Free: 10K chars/month. Starter: 30K chars/month. Concurrent request limits vary by plan.",
    error_format: "JSON: {\"detail\":{\"status\":\"...\",\"message\":\"...\"}}",
    quickstart_example: "POST /v1/text-to-speech/{voice_id}\nxi-api-key: {api_key}\nContent-Type: application/json\n\n{\"text\":\"Hello world\",\"model_id\":\"eleven_multilingual_v2\"}\n\nResponse: audio/mpeg binary",
    agent_tips: [
      "Response is binary audio (mpeg) — save to file or stream directly.",
      "Use eleven_multilingual_v2 model for non-English languages including Japanese.",
      "Voice cloning requires Professional plan. Instant cloning needs ~1 min of audio.",
      "For long text, use streaming endpoint /text-to-speech/{voice_id}/stream.",
      "Character quota is shared across all endpoints. Check usage via /user/subscription."
    ],
    docs_url: "https://elevenlabs.io/docs/api-reference"
  },
  {
    service_id: "langfuse",
    base_url: "https://cloud.langfuse.com/api/public/",
    api_version: "v2",
    auth_overview: "Basic auth with public_key:secret_key. Generate keys at cloud.langfuse.com project settings.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Create project at cloud.langfuse.com. 2. Go to Settings > API Keys. 3. Use public_key as username, secret_key as password in Basic auth.",
    sandbox_url: "https://cloud.langfuse.com/",
    key_endpoints: [
      { method: "POST", path: "/ingestion", description: "Batch ingest traces, spans, events", auth_required: true },
      { method: "GET", path: "/traces", description: "List traces with pagination", auth_required: true },
      { method: "GET", path: "/traces/{traceId}", description: "Get trace details", auth_required: true },
      { method: "GET", path: "/scores", description: "List evaluation scores", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: page and limit params. Response includes totalItems.",
    rate_limit: "Cloud: 1,000 req/min. Self-hosted: unlimited. Batch ingestion recommended.",
    error_format: "JSON: {\"error\":\"...\",\"message\":\"...\"}",
    quickstart_example: "POST /api/public/ingestion\nAuthorization: Basic {base64(public_key:secret_key)}\n\n{\"batch\":[{\"type\":\"trace-create\",\"body\":{\"name\":\"my-trace\"}}]}",
    agent_tips: [
      "Use Python/JS SDK for automatic tracing — much easier than raw API.",
      "Batch ingestion endpoint accepts up to 1000 events per request.",
      "Self-hosting available: docker compose up for local development.",
      "Integrates with LangChain, LlamaIndex, OpenAI SDK via callbacks.",
      "Scores can be attached to traces for evaluation — useful for quality monitoring."
    ],
    docs_url: "https://langfuse.com/docs/api"
  },

  // ── MCP Official / Search / Scraping ───────────────────────
  {
    service_id: "brave-search",
    base_url: "https://api.search.brave.com/res/v1/",
    api_version: "v1",
    auth_overview: "API key in X-Subscription-Token header. Get free key at brave.com/search/api/.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to brave.com/search/api. 2. Sign up and get API key (free tier: 2,000 queries/month). 3. Pass as X-Subscription-Token header.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/web/search", description: "Web search with results", auth_required: true },
      { method: "GET", path: "/news/search", description: "News search", auth_required: true },
      { method: "GET", path: "/images/search", description: "Image search", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: use 'offset' param (default 0). Max 100 results total.",
    rate_limit: "Free: 1 req/sec, 2,000/month. Paid: 20 req/sec. HTTP 429 on limit.",
    error_format: "JSON: {\"type\":\"ErrorResponse\",\"error\":{\"id\":\"...\",\"message\":\"...\"}}",
    quickstart_example: "GET /res/v1/web/search?q=MCP+protocol\nX-Subscription-Token: {api_key}\n\nResponse: {\"web\":{\"results\":[{\"title\":\"...\",\"url\":\"...\",\"description\":\"...\"}]}}",
    agent_tips: [
      "Official MCP server available: npx @anthropic/brave-search-mcp.",
      "Free tier is generous (2K/month) — great for agent web search.",
      "Use 'country' and 'search_lang' params for localized results.",
      "Results include 'extra_snippets' for more context — enable with extra_snippets=true.",
      "No tracking or user profiling — privacy-first search API."
    ],
    docs_url: "https://brave.com/search/api/"
  },
  {
    service_id: "tavily",
    base_url: "https://api.tavily.com/",
    api_version: "v1",
    auth_overview: "API key in request body or Authorization header. Get key at app.tavily.com.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at app.tavily.com. 2. Get API key from dashboard. 3. Pass as 'api_key' in POST body or Bearer token.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/search", description: "AI-optimized web search", auth_required: true },
      { method: "POST", path: "/extract", description: "Extract content from URLs", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — returns top results (configurable via max_results).",
    rate_limit: "Free: 1,000 searches/month. Paid: higher limits.",
    error_format: "JSON: {\"detail\":\"...\"}",
    quickstart_example: "POST /search\n{\"api_key\":\"{key}\",\"query\":\"best MCP servers 2026\",\"max_results\":5}",
    agent_tips: [
      "Designed for AI agents — returns clean, structured results optimized for LLMs.",
      "Use search_depth='advanced' for deeper research (uses more credits).",
      "include_answer=true returns an AI-generated summary with the results.",
      "Official MCP server available — ideal for agent research workflows.",
      "Extract endpoint pulls full content from URLs — great for RAG pipelines."
    ],
    docs_url: "https://docs.tavily.com/"
  },
  {
    service_id: "firecrawl",
    base_url: "https://api.firecrawl.dev/v1/",
    api_version: "v1",
    auth_overview: "API key as Bearer token. Get key at firecrawl.dev.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at firecrawl.dev. 2. Get API key from dashboard. 3. Use as Bearer token in Authorization header.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/scrape", description: "Scrape a single URL to markdown/structured data", auth_required: true },
      { method: "POST", path: "/crawl", description: "Crawl entire website", auth_required: true },
      { method: "POST", path: "/map", description: "Map site structure (sitemap discovery)", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Crawl is async — poll GET /crawl/{id} for status and results.",
    rate_limit: "Free: 500 credits/month. Each scrape = 1 credit, crawl pages = 1 credit each.",
    error_format: "JSON: {\"success\":false,\"error\":\"...\"}",
    quickstart_example: "POST /v1/scrape\nAuthorization: Bearer {api_key}\n\n{\"url\":\"https://example.com\",\"formats\":[\"markdown\"]}",
    agent_tips: [
      "Returns clean markdown — perfect for feeding into LLMs.",
      "Use formats=['markdown','html'] to get both versions.",
      "Crawl is asynchronous — returns job_id, poll for completion.",
      "Self-hostable via Docker for unlimited usage.",
      "Official MCP server available for agent web scraping workflows."
    ],
    docs_url: "https://docs.firecrawl.dev/api-reference"
  },

  // ── Accounting / Finance ───────────────────────────────────
  {
    service_id: "quickbooks",
    base_url: "https://quickbooks.api.intuit.com/v3/",
    api_version: "v3",
    auth_overview: "OAuth 2.0. Register app at developer.intuit.com. Use OAuth Playground for testing.",
    auth_token_url: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    auth_scopes: "com.intuit.quickbooks.accounting",
    auth_setup_hint: "1. Register at developer.intuit.com. 2. Create app for QuickBooks Online. 3. Use OAuth 2.0 Authorization Code flow. 4. Get realmId (company ID) during auth.",
    sandbox_url: "https://developer.intuit.com/app/developer/sandbox",
    key_endpoints: [
      { method: "POST", path: "/company/{realmId}/invoice", description: "Create invoice", auth_required: true },
      { method: "GET", path: "/company/{realmId}/query?query=SELECT...", description: "Query entities with SQL-like syntax", auth_required: true },
      { method: "POST", path: "/company/{realmId}/payment", description: "Record payment", auth_required: true },
      { method: "GET", path: "/company/{realmId}/reports/ProfitAndLoss", description: "Get P&L report", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "SQL-like query: STARTPOSITION and MAXRESULTS (e.g., SELECT * FROM Invoice STARTPOSITION 1 MAXRESULTS 100).",
    rate_limit: "500 req/min per realmId. Concurrent: 10 requests. Throttle at 40% of limit.",
    error_format: "JSON: {\"Fault\":{\"Error\":[{\"Message\":\"...\",\"Detail\":\"...\",\"code\":\"...\"}]}}",
    quickstart_example: "GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice WHERE TotalAmt > '100.00'\nAuthorization: Bearer {access_token}\nAccept: application/json",
    agent_tips: [
      "realmId (company ID) is essential — obtained during OAuth flow.",
      "Use SQL-like query language for flexible data retrieval.",
      "Sandbox has pre-populated test data — great for development.",
      "Minor version header recommended: 'Intuit_tid' for request tracking.",
      "Webhooks available for real-time notifications on entity changes.",
      "USD amounts use decimal (123.45), not integer cents."
    ],
    docs_url: "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account"
  },
  {
    service_id: "xero",
    base_url: "https://api.xero.com/api.xro/2.0/",
    api_version: "2.0",
    auth_overview: "OAuth 2.0 with PKCE. Register at developer.xero.com. Multi-tenant: one token accesses multiple orgs.",
    auth_token_url: "https://identity.xero.com/connect/token",
    auth_scopes: "openid profile email accounting.transactions accounting.contacts",
    auth_setup_hint: "1. Register at developer.xero.com. 2. Create app (PKCE for public clients). 3. Authorize and get tenant_id. 4. Include Xero-tenant-id header in all requests.",
    sandbox_url: "https://developer.xero.com/documentation/development-guide/using-demo-company",
    key_endpoints: [
      { method: "GET", path: "/Invoices", description: "List invoices", auth_required: true },
      { method: "POST", path: "/Invoices", description: "Create invoice", auth_required: true },
      { method: "GET", path: "/Contacts", description: "List contacts", auth_required: true },
      { method: "GET", path: "/Reports/ProfitAndLoss", description: "Profit & Loss report", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: ?page=1 (100 records per page). Check HasMorePages in response.",
    rate_limit: "60 req/min per tenant. Daily: 5,000 API calls. App limit: 10,000/day across all tenants.",
    error_format: "JSON: {\"Type\":\"ValidationException\",\"Message\":\"...\",\"Elements\":[...]}",
    quickstart_example: "GET /api.xro/2.0/Invoices?where=Status==\"AUTHORISED\"\nAuthorization: Bearer {access_token}\nXero-tenant-id: {tenant_id}",
    agent_tips: [
      "Xero-tenant-id header is REQUIRED on every API call.",
      "Use 'where' parameter with OData-like filtering for queries.",
      "Demo company available for testing — no real data needed.",
      "Amounts use decimal format (e.g., 100.50).",
      "Webhooks: Xero sends SHA256 HMAC signed payloads for validation."
    ],
    docs_url: "https://developer.xero.com/documentation/api/accounting/overview"
  },
  {
    service_id: "stripe-global",
    base_url: "https://api.stripe.com/v1/",
    api_version: "v1",
    auth_overview: "API key as Bearer token. Secret key (sk_) for server-side, Publishable key (pk_) for client-side. Test mode keys start with sk_test_.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Sign up at dashboard.stripe.com. 2. Get API keys from Developers > API keys. 3. Use sk_test_ keys for development. 4. Switch to sk_live_ for production.",
    sandbox_url: "https://dashboard.stripe.com/test",
    key_endpoints: [
      { method: "POST", path: "/charges", description: "Create a charge", auth_required: true },
      { method: "POST", path: "/payment_intents", description: "Create payment intent (recommended)", auth_required: true },
      { method: "POST", path: "/customers", description: "Create customer", auth_required: true },
      { method: "GET", path: "/invoices", description: "List invoices", auth_required: true },
      { method: "POST", path: "/subscriptions", description: "Create subscription", auth_required: true }
    ],
    request_content_type: "application/x-www-form-urlencoded",
    pagination_style: "cursor-based: use 'starting_after' param with last object ID. Default 10, max 100.",
    rate_limit: "100 req/sec (read), 25 req/sec (write) in test mode. Live: 100 read, 100 write.",
    error_format: "JSON: {\"error\":{\"type\":\"card_error\",\"code\":\"card_declined\",\"message\":\"...\"}}",
    quickstart_example: "POST /v1/payment_intents\nAuthorization: Bearer sk_test_xxx\nContent-Type: application/x-www-form-urlencoded\n\namount=2000&currency=usd&payment_method_types[]=card",
    agent_tips: [
      "IMPORTANT: Request body uses form-encoded, NOT JSON (despite JSON responses).",
      "Always use Payment Intents API over legacy Charges API.",
      "Test card numbers: 4242424242424242 (success), 4000000000000002 (decline).",
      "Amounts are in smallest currency unit: 2000 = $20.00 USD, 2000 = ¥2,000 JPY.",
      "Idempotency-Key header prevents duplicate charges on retries.",
      "Webhooks: verify signature with endpoint secret for security."
    ],
    docs_url: "https://docs.stripe.com/api"
  },
  {
    service_id: "freshbooks",
    base_url: "https://api.freshbooks.com/accounting/account/{account_id}/",
    api_version: "v3",
    auth_overview: "OAuth 2.0. Register at freshbooks.com/developers. Get account_id from /auth/api/v1/users/me.",
    auth_token_url: "https://api.freshbooks.com/auth/oauth/token",
    auth_scopes: null,
    auth_setup_hint: "1. Register at freshbooks.com/developers. 2. Create OAuth app. 3. Get account_id from /auth/api/v1/users/me after auth.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/invoices/invoices", description: "List invoices", auth_required: true },
      { method: "POST", path: "/invoices/invoices", description: "Create invoice", auth_required: true },
      { method: "GET", path: "/expenses/expenses", description: "List expenses", auth_required: true },
      { method: "GET", path: "/users/clients", description: "List clients", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: ?page=1&per_page=100.",
    rate_limit: "20 req/sec per account. HTTP 429 with retry-after header.",
    error_format: "JSON: {\"response\":{\"errors\":[{\"errno\":1000,\"field\":\"...\",\"message\":\"...\"}]}}",
    quickstart_example: "GET /accounting/account/{account_id}/invoices/invoices\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "account_id is mandatory in URL — get it first from /auth/api/v1/users/me.",
      "Amounts are strings with 2 decimal places (\"100.00\").",
      "Use ?include[]=lines to embed invoice line items in response.",
      "Time tracking: separate /timetracking/business/{id}/time_entries endpoint."
    ],
    docs_url: "https://www.freshbooks.com/api/start"
  },
  {
    service_id: "brex",
    base_url: "https://platform.brexapis.com/v2/",
    api_version: "v2",
    auth_overview: "API token as Bearer. Generate at dashboard.brex.com > Developer > API tokens.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Log into dashboard.brex.com. 2. Go to Developer > API. 3. Create token with needed scopes.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/transactions/card/primary", description: "List card transactions", auth_required: true },
      { method: "GET", path: "/accounts/card", description: "List card accounts with balances", auth_required: true },
      { method: "POST", path: "/transfers", description: "Initiate transfer", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: next_cursor in response.",
    rate_limit: "1,000 req/min. HTTP 429 with retry-after.",
    error_format: "JSON: {\"error\":\"...\",\"message\":\"...\"}",
    quickstart_example: "GET /v2/transactions/card/primary\nAuthorization: Bearer {token}\nIdempotency-Key: {uuid}",
    agent_tips: [
      "Amounts in cents (integer). 10000 = $100.00.",
      "Idempotency-Key header recommended for POST/PUT requests.",
      "Transaction categories are auto-classified by Brex.",
      "Use webhooks for real-time transaction notifications."
    ],
    docs_url: "https://developer.brex.com/openapi/onboarding_api/"
  },
  {
    service_id: "mercury",
    base_url: "https://api.mercury.com/api/v1/",
    api_version: "v1",
    auth_overview: "API token as Bearer. Generate at app.mercury.com > Settings > API.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Log into Mercury dashboard. 2. Settings > Developers > API Token. 3. Use as Bearer token.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/accounts", description: "List bank accounts", auth_required: true },
      { method: "GET", path: "/account/{id}/transactions", description: "List transactions", auth_required: true },
      { method: "POST", path: "/account/{id}/transactions", description: "Send payment (ACH/wire)", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: offset and limit params.",
    rate_limit: "60 req/min. HTTP 429.",
    error_format: "JSON: {\"errors\":[\"...\"]}",
    quickstart_example: "GET /api/v1/accounts\nAuthorization: Bearer {token}",
    agent_tips: [
      "Amounts in cents (integer). 10000 = $100.00.",
      "Payment creation requires approval — may not be instant.",
      "Read-only token available for analytics without transfer risk.",
      "Treasury and credit card endpoints also available."
    ],
    docs_url: "https://docs.mercury.com/reference"
  },
  {
    service_id: "ramp",
    base_url: "https://api.ramp.com/developer/v1/",
    api_version: "v1",
    auth_overview: "OAuth 2.0 client credentials. Register at ramp.com/developer.",
    auth_token_url: "https://api.ramp.com/developer/v1/token",
    auth_scopes: "transactions:read cards:read",
    auth_setup_hint: "1. Apply at ramp.com/developer. 2. Get client_id and client_secret. 3. Use client_credentials grant.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/transactions", description: "List transactions", auth_required: true },
      { method: "GET", path: "/cards", description: "List cards", auth_required: true },
      { method: "GET", path: "/reimbursements", description: "List reimbursements", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: has_more and next param.",
    rate_limit: "100 req/min.",
    error_format: "JSON: {\"error_code\":\"...\",\"error_message\":\"...\"}",
    quickstart_example: "GET /developer/v1/transactions\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "Client credentials flow — no user interaction needed.",
      "Transactions include merchant, category, and receipt data.",
      "Amounts in cents. Negative amounts = credits/refunds.",
      "Webhooks for real-time expense notifications."
    ],
    docs_url: "https://docs.ramp.com/reference"
  },

  // ── HR ─────────────────────────────────────────────────────
  {
    service_id: "workday",
    base_url: "https://{tenant}.workday.com/api/",
    api_version: "v1",
    auth_overview: "OAuth 2.0 with tenant-specific URLs. Requires Workday admin to register API client.",
    auth_token_url: "https://{tenant}.workday.com/ccx/oauth2/{tenant}/token",
    auth_scopes: "Tenant-specific ISSG (Integration System Security Group) permissions.",
    auth_setup_hint: "1. Workday admin creates API Client in Workday Studio. 2. Register redirect URI. 3. Assign ISSG permissions. 4. Tenant URL format: {company}.workday.com.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/wql/v1/data", description: "Query data using WQL (Workday Query Language)", auth_required: true },
      { method: "GET", path: "/staffing/v6/workers", description: "List workers/employees", auth_required: true },
      { method: "GET", path: "/absenceManagement/v1/workers/{id}/timeOffs", description: "Get time off requests", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: offset and limit. Default page 100.",
    rate_limit: "Tenant-specific. Typically 100 req/min for standard integrations.",
    error_format: "JSON: {\"error\":\"...\",\"errors\":[{\"error\":\"...\",\"field\":\"...\"}]}",
    quickstart_example: "GET /wql/v1/data?query=SELECT workdayID, fullName FROM allWorkers\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "Tenant URL is company-specific — no universal base URL.",
      "WQL (Workday Query Language) is powerful for custom data queries.",
      "ISSG permissions are granular — admin must configure per integration.",
      "SOAP API still dominant for complex operations — REST API growing.",
      "Test in sandbox tenant before production to avoid HR data issues."
    ],
    docs_url: "https://developer.workday.com/"
  },
  {
    service_id: "bamboohr",
    base_url: "https://api.bamboohr.com/api/gateway.php/{subdomain}/v1/",
    api_version: "v1",
    auth_overview: "API key with Basic auth. Key as username, 'x' as password.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to BambooHR > Account > API Keys. 2. Generate key. 3. Use as username in Basic auth with password 'x'.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/employees/directory", description: "Get employee directory", auth_required: true },
      { method: "GET", path: "/employees/{id}", description: "Get employee details", auth_required: true },
      { method: "GET", path: "/time_off/requests", description: "List time off requests", auth_required: true },
      { method: "POST", path: "/employees", description: "Create employee", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — most endpoints return all results. Use 'fields' param to limit data.",
    rate_limit: "No published rate limit but throttled on abuse. Be reasonable with polling.",
    error_format: "JSON or XML depending on Accept header.",
    quickstart_example: "GET /api/gateway.php/{subdomain}/v1/employees/directory\nAuthorization: Basic {base64(api_key:x)}\nAccept: application/json",
    agent_tips: [
      "Subdomain is company-specific (e.g., mycompany.bamboohr.com → subdomain='mycompany').",
      "Basic auth: API key as username, literal 'x' as password.",
      "Employee fields are configurable — use GET /meta/fields for available fields.",
      "Custom fields have numeric IDs — fetch /meta/fields first.",
      "Accept: application/json header important — defaults to XML."
    ],
    docs_url: "https://documentation.bamboohr.com/reference"
  },
  {
    service_id: "gusto",
    base_url: "https://api.gusto.com/v1/",
    api_version: "v1",
    auth_overview: "OAuth 2.0 Authorization Code. Register at dev.gusto.com. Partner access required.",
    auth_token_url: "https://api.gusto.com/oauth/token",
    auth_scopes: "public",
    auth_setup_hint: "1. Apply at dev.gusto.com for partner access. 2. Create OAuth app. 3. Use demo company for testing.",
    sandbox_url: "https://app.gusto-demo.com/",
    key_endpoints: [
      { method: "GET", path: "/companies/{company_id}/employees", description: "List employees", auth_required: true },
      { method: "GET", path: "/companies/{company_id}/payrolls", description: "List payrolls", auth_required: true },
      { method: "POST", path: "/companies/{company_id}/payrolls/{id}/calculate", description: "Calculate payroll", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: ?page=1&per=100.",
    rate_limit: "60 req/min per token.",
    error_format: "JSON: {\"errors\":[{\"error_type\":\"...\",\"message\":\"...\"}]}",
    quickstart_example: "GET /v1/companies/{company_id}/employees\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "Partner application required — not self-serve API access.",
      "Demo company available at gusto-demo.com for testing.",
      "Payroll calculation is a multi-step process: create → calculate → submit.",
      "company_id obtained from GET /v1/me or during OAuth."
    ],
    docs_url: "https://docs.gusto.com/"
  },
  {
    service_id: "rippling",
    base_url: "https://api.rippling.com/",
    api_version: "v1",
    auth_overview: "OAuth 2.0. Register at developer.rippling.com. Bearer token access.",
    auth_token_url: "https://api.rippling.com/auth/token",
    auth_scopes: "platform:read employees:read",
    auth_setup_hint: "1. Apply at developer.rippling.com. 2. Create app. 3. OAuth 2.0 authorization code flow.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/platform/api/employees", description: "List employees", auth_required: true },
      { method: "GET", path: "/platform/api/companies/current", description: "Get company info", auth_required: true },
      { method: "GET", path: "/platform/api/departments", description: "List departments", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: next_cursor in response.",
    rate_limit: "100 req/min per app.",
    error_format: "JSON: {\"error\":\"...\",\"message\":\"...\"}",
    quickstart_example: "GET /platform/api/employees\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "Rippling is a unified platform (HR + IT + Finance) — API spans multiple domains.",
      "Employee data may include device management and app provisioning info.",
      "Webhooks available for employee lifecycle events (hire, terminate, etc.).",
      "Custom fields supported — check company-specific field definitions."
    ],
    docs_url: "https://developer.rippling.com/"
  },
  {
    service_id: "deel",
    base_url: "https://api.letsdeel.com/rest/v2/",
    api_version: "v2",
    auth_overview: "API token as Bearer. Generate at app.deel.com > Integrations > API.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to Deel dashboard > Developer > API. 2. Generate API token. 3. Use as Bearer token.",
    sandbox_url: "https://app-demo.deel.com/",
    key_endpoints: [
      { method: "GET", path: "/contracts", description: "List contracts", auth_required: true },
      { method: "GET", path: "/invoices", description: "List invoices/payments", auth_required: true },
      { method: "GET", path: "/people", description: "List workers (employees & contractors)", auth_required: true },
      { method: "POST", path: "/contracts", description: "Create new contract", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: page and limit params.",
    rate_limit: "100 req/min.",
    error_format: "JSON: {\"errors\":[{\"code\":\"...\",\"message\":\"...\"}]}",
    quickstart_example: "GET /rest/v2/contracts\nAuthorization: Bearer {api_token}",
    agent_tips: [
      "Deel handles both employees (EOR) and contractors — different contract types.",
      "Currency is per-contract — multi-currency by design.",
      "Demo environment available for testing without real payments.",
      "Webhook events for contract signing, payment, and status changes."
    ],
    docs_url: "https://developer.deel.com/"
  },
  {
    service_id: "greenhouse",
    base_url: "https://harvest.greenhouse.io/v1/",
    api_version: "v1 (Harvest API)",
    auth_overview: "Basic auth with API key. Key as username, empty password. Generate at Greenhouse > Configure > Dev Center.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to Greenhouse > Configure > Dev Center > API Credential Management. 2. Create Harvest API key. 3. Use as username in Basic auth (empty password).",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/candidates", description: "List candidates", auth_required: true },
      { method: "GET", path: "/applications", description: "List applications", auth_required: true },
      { method: "GET", path: "/jobs", description: "List open jobs", auth_required: true },
      { method: "POST", path: "/candidates", description: "Create candidate", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: per_page (max 500) and page params. Link header for next page.",
    rate_limit: "50 req/10 sec. HTTP 429 with Retry-After.",
    error_format: "JSON: {\"errors\":[{\"message\":\"...\",\"field\":\"...\"}]}",
    quickstart_example: "GET /v1/candidates?per_page=100\nAuthorization: Basic {base64(api_key:)}",
    agent_tips: [
      "Harvest API for data access, Job Board API for public job listings.",
      "Basic auth: API key as username, empty string as password.",
      "Per-page max is 500 — use for bulk data retrieval.",
      "Custom fields are returned but vary per company configuration.",
      "Webhook subscriptions for candidate and application events."
    ],
    docs_url: "https://developers.greenhouse.io/harvest.html"
  },

  // ── Support ────────────────────────────────────────────────
  {
    service_id: "helpscout",
    base_url: "https://api.helpscout.net/v2/",
    api_version: "v2 (Mailbox 2.0)",
    auth_overview: "OAuth 2.0 Authorization Code. Register at developer.helpscout.com. Or use API key with Basic auth.",
    auth_token_url: "https://api.helpscout.net/v2/oauth2/token",
    auth_scopes: null,
    auth_setup_hint: "1. Go to developer.helpscout.com > My Apps. 2. Create app with OAuth. 3. Or generate API key for basic auth (simpler).",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/conversations", description: "List conversations", auth_required: true },
      { method: "GET", path: "/mailboxes", description: "List mailboxes", auth_required: true },
      { method: "POST", path: "/conversations", description: "Create conversation", auth_required: true },
      { method: "GET", path: "/customers", description: "List customers", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: ?page=1 (50 per page). _embedded.conversations and page info in response.",
    rate_limit: "400 req/min per app. HTTP 429.",
    error_format: "JSON: {\"_embedded\":{\"errors\":[{\"path\":\"...\",\"message\":\"...\"}]}}",
    quickstart_example: "GET /v2/conversations?status=active&mailbox=12345\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "HAL+JSON format — links and embedded resources in _embedded.",
      "Conversation threads: GET /conversations/{id}/threads for messages.",
      "Tags, custom fields, and workflows are configurable per mailbox.",
      "Beacon (live chat) data accessible through same API."
    ],
    docs_url: "https://developer.helpscout.com/mailbox-api/"
  },
  {
    service_id: "front",
    base_url: "https://api2.frontapp.com/",
    api_version: "v1",
    auth_overview: "API token as Bearer. Generate at app.frontapp.com > Settings > API & integrations.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to Front > Settings > Developers > API tokens. 2. Create token. 3. Use as Bearer token.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/conversations", description: "List conversations", auth_required: true },
      { method: "GET", path: "/inboxes", description: "List shared inboxes", auth_required: true },
      { method: "POST", path: "/channels/{id}/messages", description: "Send message", auth_required: true },
      { method: "GET", path: "/contacts", description: "List contacts", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: _pagination.next in response.",
    rate_limit: "Starter: 50 req/min. Growth: 100/min. Scale: 200/min.",
    error_format: "JSON: {\"_error\":{\"status\":403,\"title\":\"...\",\"message\":\"...\"}}",
    quickstart_example: "GET /conversations?q[statuses][]=open\nAuthorization: Bearer {api_token}",
    agent_tips: [
      "Conversations unify email, SMS, chat, and social into one thread.",
      "Use q[] query params for filtering (status, tags, assignees).",
      "Shared inboxes are the core unit — list them first.",
      "Webhooks available for real-time conversation events."
    ],
    docs_url: "https://dev.frontapp.com/reference/introduction"
  },
  {
    service_id: "servicenow",
    base_url: "https://{instance}.service-now.com/api/now/",
    api_version: "REST API",
    auth_overview: "OAuth 2.0 or Basic auth. Instance-specific URL. Admin creates OAuth app in System OAuth > Application Registry.",
    auth_token_url: "https://{instance}.service-now.com/oauth_token.do",
    auth_scopes: "useraccount",
    auth_setup_hint: "1. Admin registers OAuth app in ServiceNow instance. 2. Use client credentials or authorization code flow. 3. Or use Basic auth (username:password) for simple access.",
    sandbox_url: "https://developer.servicenow.com/dev.do (free Personal Developer Instance)",
    key_endpoints: [
      { method: "GET", path: "/table/incident", description: "List incidents", auth_required: true },
      { method: "POST", path: "/table/incident", description: "Create incident", auth_required: true },
      { method: "GET", path: "/table/sc_request", description: "List service requests", auth_required: true },
      { method: "GET", path: "/table/{tableName}", description: "Query any table", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: sysparm_offset and sysparm_limit (max 10,000). X-Total-Count in response header.",
    rate_limit: "Instance-specific. Default: no hard limit but governed by instance performance.",
    error_format: "JSON: {\"error\":{\"message\":\"...\",\"detail\":\"...\"}}",
    quickstart_example: "GET /api/now/table/incident?sysparm_limit=10&sysparm_query=priority=1\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "Instance URL is company-specific: {company}.service-now.com.",
      "Table API is the most common — almost everything is a table.",
      "sysparm_query uses encoded query format (e.g., priority=1^state=2).",
      "Free Personal Developer Instance (PDI) available for testing.",
      "Scripted REST API allows custom endpoints — ask the admin about available ones.",
      "sysparm_display_value=true returns labels instead of sys_ids."
    ],
    docs_url: "https://developer.servicenow.com/dev.do#!/reference"
  },
  {
    service_id: "gorgias",
    base_url: "https://{subdomain}.gorgias.com/api/",
    api_version: "v1",
    auth_overview: "API key + email as Basic auth. Generate at Settings > REST API in Gorgias.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to Gorgias > Settings > REST API. 2. Create API key. 3. Use email:api_key as Basic auth.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/tickets", description: "List tickets", auth_required: true },
      { method: "POST", path: "/tickets", description: "Create ticket", auth_required: true },
      { method: "GET", path: "/customers", description: "List customers", auth_required: true },
      { method: "POST", path: "/tickets/{id}/messages", description: "Reply to ticket", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: cursor param. Response includes next_cursor.",
    rate_limit: "2 req/sec per API key.",
    error_format: "JSON: {\"message\":\"...\",\"code\":\"...\"}",
    quickstart_example: "GET /api/tickets?limit=25\nAuthorization: Basic {base64(email:api_key)}",
    agent_tips: [
      "Subdomain is your Gorgias account name.",
      "Basic auth: email as username, API key as password.",
      "Deep Shopify/BigCommerce integration — tickets have order context.",
      "Macros and rules can be managed via API for automation.",
      "Rate limit is strict (2/sec) — implement proper throttling."
    ],
    docs_url: "https://developers.gorgias.com/"
  },

  // ── Marketing / Analytics ──────────────────────────────────
  {
    service_id: "mixpanel",
    base_url: "https://api.mixpanel.com/",
    api_version: "v2",
    auth_overview: "Service account (username:secret) for query APIs. Project token for ingestion.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Create Service Account at mixpanel.com > Project Settings > Service Accounts. 2. Use username:secret as Basic auth for query APIs. 3. Use project token for /track endpoint.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/track", description: "Track events (use project token)", auth_required: true },
      { method: "POST", path: "/engage", description: "Update user profiles", auth_required: true },
      { method: "GET", path: "/api/2.0/events", description: "Query events data", auth_required: true },
      { method: "GET", path: "/api/2.0/funnels", description: "Query funnel data", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A for queries. Exports: use /api/2.0/export with from_date/to_date.",
    rate_limit: "Ingestion: no published limit. Query: 60 req/hour for free, higher for paid.",
    error_format: "JSON: {\"error\":\"...\",\"status\":0}",
    quickstart_example: "POST /track\nContent-Type: application/json\n\n[{\"event\":\"sign_up\",\"properties\":{\"distinct_id\":\"user123\",\"token\":\"{project_token}\"}}]",
    agent_tips: [
      "Two auth methods: project token for tracking, service account for querying.",
      "Use /import for server-side event ingestion (more reliable than /track).",
      "JQL (JavaScript Query Language) for complex custom queries.",
      "distinct_id is the user identifier — must be consistent across events.",
      "Mixpanel stores events for 90 days on free plan."
    ],
    docs_url: "https://developer.mixpanel.com/reference"
  },
  {
    service_id: "amplitude",
    base_url: "https://api2.amplitude.com/",
    api_version: "v2",
    auth_overview: "API key + secret. Pass API key for ingestion, API key:secret for export/query.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to Amplitude > Settings > Projects > API Keys. 2. Copy API Key and Secret Key. 3. API Key for tracking, both for data export.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/2/httpapi", description: "Track events (batch)", auth_required: true },
      { method: "GET", path: "/2/events/segmentation", description: "Event segmentation query", auth_required: true },
      { method: "GET", path: "/2/export", description: "Raw data export", auth_required: true },
      { method: "GET", path: "/2/funnels", description: "Funnel analysis", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A for queries. Export: date-range based.",
    rate_limit: "Ingestion: 1,000 events/sec. Query: varies by endpoint.",
    error_format: "JSON: {\"code\":400,\"error\":\"...\"}",
    quickstart_example: "POST /2/httpapi\nContent-Type: application/json\n\n{\"api_key\":\"{api_key}\",\"events\":[{\"user_id\":\"user123\",\"event_type\":\"purchase\"}]}",
    agent_tips: [
      "API key goes in request body for ingestion, not header.",
      "user_id OR device_id required per event — at least one.",
      "Use Identify API to set user properties separately from events.",
      "Cohort API for creating/exporting behavioral cohorts.",
      "Data is available for query within ~1 minute of ingestion."
    ],
    docs_url: "https://www.docs.developers.amplitude.com/"
  },
  {
    service_id: "segment",
    base_url: "https://api.segment.io/v1/",
    api_version: "v1",
    auth_overview: "Write key as Basic auth username for tracking. Access token for Config API.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Create source in Segment workspace. 2. Copy Write Key for tracking. 3. For Config API: create access token at segment.com > Settings > Access Tokens.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/track", description: "Track event", auth_required: true },
      { method: "POST", path: "/identify", description: "Identify user with traits", auth_required: true },
      { method: "POST", path: "/page", description: "Track page view", auth_required: true },
      { method: "POST", path: "/batch", description: "Batch multiple calls", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Config API: cursor-based pagination.",
    rate_limit: "500 req/sec (tracking). Config API: 10 req/sec.",
    error_format: "JSON: {\"success\":false,\"message\":\"...\"}",
    quickstart_example: "POST /v1/track\nAuthorization: Basic {base64(writeKey:)}\nContent-Type: application/json\n\n{\"userId\":\"user123\",\"event\":\"Order Completed\",\"properties\":{\"revenue\":49.99}}",
    agent_tips: [
      "Write key as Basic auth username with empty password (like BambooHR pattern).",
      "Use /batch for server-side — sends up to 500KB per request.",
      "Segment routes data to 400+ destinations automatically.",
      "Tracking Plan enforces event schema — check before sending new events.",
      "Profiles API (Unify) for querying merged user profiles."
    ],
    docs_url: "https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/"
  },
  {
    service_id: "posthog",
    base_url: "https://app.posthog.com/api/",
    api_version: "v1",
    auth_overview: "Personal API key as Bearer token. Project API key for event capture.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to PostHog > Settings > Personal API Keys. 2. Create key. 3. Use as Bearer token for API queries. 4. Project API key for event capture.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/capture", description: "Capture event (use project API key)", auth_required: true },
      { method: "GET", path: "/projects/{id}/insights", description: "List insights/saved queries", auth_required: true },
      { method: "GET", path: "/projects/{id}/feature_flags", description: "List feature flags", auth_required: true },
      { method: "POST", path: "/projects/{id}/query", description: "Run HogQL query", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: next URL in response.",
    rate_limit: "No hard limit for Cloud. Self-hosted: depends on deployment.",
    error_format: "JSON: {\"type\":\"validation_error\",\"detail\":\"...\"}",
    quickstart_example: "POST /capture\nContent-Type: application/json\n\n{\"api_key\":\"{project_api_key}\",\"event\":\"pageview\",\"distinct_id\":\"user123\"}",
    agent_tips: [
      "Two key types: Personal API key (queries), Project API key (capture).",
      "Self-hostable — Docker setup for local development.",
      "HogQL is PostHog's query language — SQL-like for custom analysis.",
      "Feature flags: evaluate server-side via /decide endpoint.",
      "Community MCP server available for agent integration."
    ],
    docs_url: "https://posthog.com/docs/api"
  },
  {
    service_id: "klaviyo",
    base_url: "https://a.klaviyo.com/api/",
    api_version: "v3 (2024-10-15 revision)",
    auth_overview: "Private API key as Bearer token. Generate at klaviyo.com > Account > Settings > API Keys.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to Klaviyo > Account > Settings > API Keys. 2. Create Private API Key with needed scopes. 3. Set revision header to latest.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/profiles", description: "List customer profiles", auth_required: true },
      { method: "POST", path: "/events", description: "Create event/track activity", auth_required: true },
      { method: "GET", path: "/campaigns", description: "List campaigns", auth_required: true },
      { method: "GET", path: "/flows", description: "List automation flows", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: page[cursor] param. JSON:API format with links.next.",
    rate_limit: "75 req/sec for most endpoints. Some: 10/sec. Retry-After header.",
    error_format: "JSON:API: {\"errors\":[{\"id\":\"...\",\"status\":400,\"title\":\"...\",\"detail\":\"...\"}]}",
    quickstart_example: "GET /api/profiles\nAuthorization: Klaviyo-API-Key {private_api_key}\nrevision: 2024-10-15",
    agent_tips: [
      "Authorization format is 'Klaviyo-API-Key {key}' — NOT Bearer.",
      "Must include 'revision' header (date string) for API versioning.",
      "JSON:API format — data is nested in 'data' array with 'attributes'.",
      "Two key types: Private (server-side), Public (client-side tracking).",
      "Flows are automation sequences — triggered by events or segments."
    ],
    docs_url: "https://developers.klaviyo.com/en/reference"
  },
  {
    service_id: "activecampaign",
    base_url: "https://{account}.api-us1.com/api/3/",
    api_version: "v3",
    auth_overview: "API key in Api-Token header. Find at Settings > Developer.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to ActiveCampaign > Settings > Developer. 2. Copy API URL and Key. 3. API URL contains your account name.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/contacts", description: "List contacts", auth_required: true },
      { method: "POST", path: "/contacts", description: "Create/update contact", auth_required: true },
      { method: "GET", path: "/deals", description: "List deals (CRM)", auth_required: true },
      { method: "GET", path: "/automations", description: "List automations", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: offset and limit params (max 100).",
    rate_limit: "5 req/sec per account.",
    error_format: "JSON: {\"errors\":[{\"title\":\"...\",\"detail\":\"...\",\"code\":\"...\"}]}",
    quickstart_example: "GET /api/3/contacts?limit=20\nApi-Token: {api_key}",
    agent_tips: [
      "API URL is account-specific: {account}.api-us1.com.",
      "Auth header is 'Api-Token' — NOT Authorization Bearer.",
      "Contact sync: POST /contact/sync for create-or-update behavior.",
      "Rate limit is strict (5/sec) — batch operations recommended.",
      "Custom fields: GET /fields to discover available custom fields."
    ],
    docs_url: "https://developers.activecampaign.com/reference"
  },
  {
    service_id: "brevo",
    base_url: "https://api.brevo.com/v3/",
    api_version: "v3",
    auth_overview: "API key in api-key header. Generate at app.brevo.com > SMTP & API.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to Brevo > SMTP & API > API Keys. 2. Generate v3 API key. 3. Pass in 'api-key' header.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/smtp/email", description: "Send transactional email", auth_required: true },
      { method: "GET", path: "/contacts", description: "List contacts", auth_required: true },
      { method: "POST", path: "/contacts", description: "Create contact", auth_required: true },
      { method: "GET", path: "/emailCampaigns", description: "List email campaigns", auth_required: true },
      { method: "POST", path: "/whatsapp/sendMessage", description: "Send WhatsApp message", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: offset and limit (max 1000). Response includes count.",
    rate_limit: "Depends on plan. Starter: 100 emails/hour. Free: 300 emails/day.",
    error_format: "JSON: {\"code\":\"invalid_parameter\",\"message\":\"...\"}",
    quickstart_example: "POST /v3/smtp/email\napi-key: {api_key}\nContent-Type: application/json\n\n{\"sender\":{\"email\":\"from@example.com\"},\"to\":[{\"email\":\"to@example.com\"}],\"subject\":\"Hello\",\"htmlContent\":\"<p>Hi</p>\"}",
    agent_tips: [
      "Auth header is 'api-key' — lowercase, NOT Authorization Bearer.",
      "Covers email, SMS, WhatsApp, and chat from one API.",
      "Transactional vs Marketing emails: different endpoints and limits.",
      "Contact attributes are customizable — check /contacts/attributes.",
      "Formerly Sendinblue — some docs may reference old name."
    ],
    docs_url: "https://developers.brevo.com/reference"
  },
  {
    service_id: "customer-io",
    base_url: "https://track.customer.io/api/v1/",
    api_version: "v1 (Track) + v1 (App)",
    auth_overview: "Track API: site_id:api_key as Basic auth. App API: Bearer token from app.customer.io.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to customer.io > Settings > API Credentials. 2. Track API: use site_id and API key. 3. App API: create Bearer token for campaigns/segments.",
    sandbox_url: null,
    key_endpoints: [
      { method: "PUT", path: "/customers/{id}", description: "Create/update customer", auth_required: true },
      { method: "POST", path: "/customers/{id}/events", description: "Track customer event", auth_required: true },
      { method: "DELETE", path: "/customers/{id}", description: "Delete customer", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "App API: cursor-based.",
    rate_limit: "Track API: 100 req/sec. App API: 10 req/sec.",
    error_format: "JSON: {\"meta\":{\"error\":\"...\",\"status\":401}}",
    quickstart_example: "PUT /api/v1/customers/user123\nAuthorization: Basic {base64(site_id:api_key)}\nContent-Type: application/json\n\n{\"email\":\"user@example.com\",\"first_name\":\"John\"}",
    agent_tips: [
      "Two APIs: Track (behavioral data) and App (campaigns/segments).",
      "Track API uses Basic auth (site_id:api_key), App API uses Bearer token.",
      "Customer ID is your choice — use your internal user ID.",
      "Events trigger campaigns (workflows) — name events consistently.",
      "Attributes set on customers are available for segmentation."
    ],
    docs_url: "https://customer.io/docs/api/"
  },

  // ── SNS / Social ───────────────────────────────────────────
  {
    service_id: "twitter-api",
    base_url: "https://api.x.com/2/",
    api_version: "v2",
    auth_overview: "OAuth 2.0 with PKCE for user context. OAuth 1.0a also supported. App-only: Bearer token.",
    auth_token_url: "https://api.x.com/2/oauth2/token",
    auth_scopes: "tweet.read tweet.write users.read",
    auth_setup_hint: "1. Apply at developer.x.com. 2. Create project and app. 3. Get Bearer token for app-only access. 4. Use OAuth 2.0 PKCE for user-context actions.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/tweets", description: "Create tweet", auth_required: true },
      { method: "GET", path: "/tweets/search/recent", description: "Search recent tweets", auth_required: true },
      { method: "GET", path: "/users/{id}", description: "Get user by ID", auth_required: true },
      { method: "GET", path: "/users/{id}/tweets", description: "Get user's tweets", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: pagination_token in response. Use next_token for next page.",
    rate_limit: "Free: 1,500 tweets read/month, 50 write/month. Basic ($100/mo): 10K read. Pro ($5K/mo): 1M read.",
    error_format: "JSON: {\"errors\":[{\"message\":\"...\",\"type\":\"...\"}]}",
    quickstart_example: "GET /2/tweets/search/recent?query=MCP protocol&max_results=10\nAuthorization: Bearer {bearer_token}",
    agent_tips: [
      "Free tier is very limited — 1,500 tweets/month read.",
      "OAuth 2.0 PKCE required for posting (user context).",
      "Use 'tweet.fields' and 'expansions' params to get full data.",
      "Rate limits are per-endpoint — check X-Rate-Limit headers.",
      "API v2 is current — v1.1 is deprecated but still works for some endpoints."
    ],
    docs_url: "https://developer.x.com/en/docs/x-api"
  },
  {
    service_id: "linkedin-api",
    base_url: "https://api.linkedin.com/v2/",
    api_version: "v2",
    auth_overview: "OAuth 2.0 Authorization Code. Register at linkedin.com/developers. 3-legged auth for user data.",
    auth_token_url: "https://www.linkedin.com/oauth/v2/accessToken",
    auth_scopes: "r_liteprofile r_emailaddress w_member_social",
    auth_setup_hint: "1. Create app at linkedin.com/developers. 2. Add products (Share on LinkedIn, Marketing APIs). 3. OAuth 2.0 with redirect URI.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/ugcPosts", description: "Create post/share content", auth_required: true },
      { method: "GET", path: "/me", description: "Get authenticated user profile", auth_required: true },
      { method: "GET", path: "/organizationalEntityAcls", description: "List managed pages", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: start and count params.",
    rate_limit: "100 req/day for most endpoints. Application-level daily limits.",
    error_format: "JSON: {\"serviceErrorCode\":65600,\"message\":\"...\",\"status\":403}",
    quickstart_example: "GET /v2/me\nAuthorization: Bearer {access_token}",
    agent_tips: [
      "Product approval needed for most APIs — not instant access.",
      "Marketing APIs require separate approval and higher-tier partnership.",
      "Access tokens expire in 60 days — refresh tokens last 365 days.",
      "Rate limits are very strict (100/day) — plan API calls carefully.",
      "Community Management API is replacing some v2 endpoints."
    ],
    docs_url: "https://learn.microsoft.com/en-us/linkedin/"
  },
  {
    service_id: "youtube-api",
    base_url: "https://www.googleapis.com/youtube/v3/",
    api_version: "v3",
    auth_overview: "API key for public data. OAuth 2.0 for user data (uploads, playlists). Enable YouTube Data API v3 in Google Cloud Console.",
    auth_token_url: "https://oauth2.googleapis.com/token",
    auth_scopes: "https://www.googleapis.com/auth/youtube",
    auth_setup_hint: "1. Enable YouTube Data API v3 in Google Cloud Console. 2. Create API key for read-only public data. 3. Create OAuth credentials for user operations.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/search", description: "Search videos, channels, playlists", auth_required: true },
      { method: "GET", path: "/videos", description: "Get video details", auth_required: true },
      { method: "GET", path: "/channels", description: "Get channel details", auth_required: true },
      { method: "POST", path: "/videos?uploadType=resumable", description: "Upload video", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "token-based: nextPageToken and prevPageToken in response. Use pageToken param.",
    rate_limit: "10,000 quota units/day. Each endpoint costs different units (search=100, list=1).",
    error_format: "JSON: {\"error\":{\"code\":403,\"message\":\"...\",\"errors\":[{\"reason\":\"quotaExceeded\"}]}}",
    quickstart_example: "GET /youtube/v3/search?part=snippet&q=MCP+server&type=video&key={API_KEY}",
    agent_tips: [
      "Quota is unit-based, NOT request-based. Search costs 100 units!",
      "Use 'part' parameter wisely — each part (snippet, statistics, contentDetails) adds quota cost.",
      "API key works for all public data — no OAuth needed for reading.",
      "Upload requires resumable upload protocol for reliability.",
      "Analytics API is separate: youtubeAnalytics.googleapis.com."
    ],
    docs_url: "https://developers.google.com/youtube/v3/docs"
  },
  {
    service_id: "buffer",
    base_url: "https://api.bufferapp.com/1/",
    api_version: "v1",
    auth_overview: "OAuth 2.0 or personal access token. Create at buffer.com/developers/api.",
    auth_token_url: "https://api.bufferapp.com/1/oauth2/token.json",
    auth_scopes: null,
    auth_setup_hint: "1. Register at buffer.com/developers/apps. 2. Create app. 3. Or use personal access token for quick start.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/user.json", description: "Get user info", auth_required: true },
      { method: "GET", path: "/profiles.json", description: "List connected social profiles", auth_required: true },
      { method: "POST", path: "/updates/create.json", description: "Schedule post", auth_required: true },
      { method: "GET", path: "/profiles/{id}/updates/pending.json", description: "Get pending posts", auth_required: true }
    ],
    request_content_type: "application/x-www-form-urlencoded",
    pagination_style: "offset-based: page and count params.",
    rate_limit: "No published rate limit. Fair use policy.",
    error_format: "JSON: {\"success\":false,\"message\":\"...\",\"code\":1000}",
    quickstart_example: "POST /1/updates/create.json?access_token={token}\nContent-Type: application/x-www-form-urlencoded\n\nprofile_ids[]={profile_id}&text=Hello world!",
    agent_tips: [
      "Request body is form-encoded, NOT JSON.",
      "Profile = connected social account. List profiles first to get IDs.",
      "Schedule: set 'scheduled_at' for specific time, or use 'now' for immediate.",
      "Supports Twitter, LinkedIn, Instagram, Facebook, TikTok, Pinterest.",
      "Analytics: use /updates/{id}/interactions.json for engagement data."
    ],
    docs_url: "https://buffer.com/developers/api"
  },

  // ── DevOps / Cloud ─────────────────────────────────────────
  {
    service_id: "github-actions",
    base_url: "https://api.github.com/",
    api_version: "v3 (REST) + GraphQL",
    auth_overview: "Personal access token or GitHub App token as Bearer. Fine-grained tokens recommended.",
    auth_token_url: null,
    auth_scopes: "actions:read actions:write",
    auth_setup_hint: "1. Settings > Developer settings > Personal access tokens (fine-grained). 2. Or create GitHub App for org-wide access.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/repos/{owner}/{repo}/actions/runs", description: "List workflow runs", auth_required: true },
      { method: "POST", path: "/repos/{owner}/{repo}/actions/workflows/{id}/dispatches", description: "Trigger workflow", auth_required: true },
      { method: "GET", path: "/repos/{owner}/{repo}/actions/artifacts", description: "List artifacts", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: page and per_page (max 100). Link header for navigation.",
    rate_limit: "5,000 req/hour (authenticated). GitHub App: 15,000/hour per installation.",
    error_format: "JSON: {\"message\":\"...\",\"documentation_url\":\"...\"}",
    quickstart_example: "GET /repos/{owner}/{repo}/actions/runs?status=completed&per_page=5\nAuthorization: Bearer {token}\nX-GitHub-Api-Version: 2022-11-28",
    agent_tips: [
      "Include X-GitHub-Api-Version header for consistent behavior.",
      "workflow_dispatch event allows manual/API triggering of workflows.",
      "Artifacts are downloadable as zip — use Accept: application/vnd.github+json.",
      "Rate limit of 5K/hour is shared across all GitHub API calls.",
      "Use conditional requests (If-None-Match/ETag) to save rate limit."
    ],
    docs_url: "https://docs.github.com/en/rest/actions"
  },
  {
    service_id: "circleci",
    base_url: "https://circleci.com/api/v2/",
    api_version: "v2",
    auth_overview: "Personal API token as Bearer or in Circle-Token header. Generate at circleci.com > User Settings > Personal API Tokens.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to circleci.com > User Settings > Personal API Tokens. 2. Create token. 3. Use as 'Circle-Token' header or Bearer token.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/pipeline", description: "List pipelines", auth_required: true },
      { method: "POST", path: "/project/{project-slug}/pipeline", description: "Trigger pipeline", auth_required: true },
      { method: "GET", path: "/workflow/{id}", description: "Get workflow details", auth_required: true },
      { method: "GET", path: "/workflow/{id}/job", description: "List jobs in workflow", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "token-based: next_page_token in response.",
    rate_limit: "No published hard limit. Fair use policy.",
    error_format: "JSON: {\"message\":\"...\"}",
    quickstart_example: "POST /api/v2/project/gh/{org}/{repo}/pipeline\nCircle-Token: {token}\nContent-Type: application/json\n\n{\"branch\":\"main\"}",
    agent_tips: [
      "Project slug format: gh/{org}/{repo} for GitHub, bb/{org}/{repo} for Bitbucket.",
      "Trigger pipeline with parameters for dynamic configuration.",
      "Use Insights API for test and performance metrics.",
      "Workflows contain jobs — hierarchy is Pipeline > Workflow > Job."
    ],
    docs_url: "https://circleci.com/docs/api/v2/"
  },
  {
    service_id: "heroku",
    base_url: "https://api.heroku.com/",
    api_version: "v3",
    auth_overview: "API key or OAuth token as Bearer. Get API key at dashboard.heroku.com > Account > API Key.",
    auth_token_url: "https://id.heroku.com/oauth/token",
    auth_scopes: "global",
    auth_setup_hint: "1. Go to dashboard.heroku.com > Account Settings. 2. Scroll to API Key > Reveal. 3. Or use heroku auth:token from CLI.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/apps", description: "List apps", auth_required: true },
      { method: "POST", path: "/apps", description: "Create app", auth_required: true },
      { method: "GET", path: "/apps/{app}/dynos", description: "List dynos", auth_required: true },
      { method: "POST", path: "/apps/{app}/builds", description: "Create build from source", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "Range-based: Range header (e.g., Range: id ..; max=200). Next-Range in response.",
    rate_limit: "4,500 req/hour per OAuth token.",
    error_format: "JSON: {\"id\":\"invalid_params\",\"message\":\"...\"}",
    quickstart_example: "GET /apps\nAuthorization: Bearer {api_key}\nAccept: application/vnd.heroku+json; version=3",
    agent_tips: [
      "Include Accept: application/vnd.heroku+json; version=3 header.",
      "Range-based pagination is unique to Heroku — use Range header.",
      "App names are globally unique. Use /apps/{name} or /apps/{id}.",
      "Eco dynos sleep after 30 min inactivity — first request is slow.",
      "Use /apps/{app}/config-vars for environment variables."
    ],
    docs_url: "https://devcenter.heroku.com/articles/platform-api-reference"
  },

  // ── Database ───────────────────────────────────────────────
  {
    service_id: "turso",
    base_url: "https://api.turso.tech/v1/",
    api_version: "v1",
    auth_overview: "API token as Bearer. Generate at turso.tech dashboard or turso auth api-tokens mint.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Install Turso CLI: curl -sSfL https://get.tur.so/install.sh | bash. 2. turso auth login. 3. turso auth api-tokens mint. 4. Use as Bearer token.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/organizations/{org}/databases", description: "List databases", auth_required: true },
      { method: "POST", path: "/organizations/{org}/databases", description: "Create database", auth_required: true },
      { method: "POST", path: "/organizations/{org}/databases/{name}/auth/tokens", description: "Create DB auth token", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — small result sets.",
    rate_limit: "No published limit for Platform API. Database queries: plan-based.",
    error_format: "JSON: {\"error\":\"...\"}",
    quickstart_example: "GET /v1/organizations/{org}/databases\nAuthorization: Bearer {api_token}",
    agent_tips: [
      "Two APIs: Platform API (manage DBs) and libSQL protocol (query data).",
      "Connect to DB via libsql:// URL with auth token — not the Platform API.",
      "Embedded replicas: sync to local SQLite file for ultra-low latency reads.",
      "Free tier: 500 DBs, 9GB storage, 25M row reads/month.",
      "Use @libsql/client npm package for TypeScript/Node.js."
    ],
    docs_url: "https://docs.turso.tech/api-reference"
  },

  // ── EC / Payment ───────────────────────────────────────────
  {
    service_id: "bigcommerce",
    base_url: "https://api.bigcommerce.com/stores/{store_hash}/v3/",
    api_version: "v3",
    auth_overview: "API token (X-Auth-Token header) + Client ID (X-Auth-Client header). Create at devtools.bigcommerce.com.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to BigCommerce admin > Settings > API > API Accounts. 2. Create V2/V3 API Account. 3. Use store_hash from API path, X-Auth-Token and X-Auth-Client headers.",
    sandbox_url: "https://developer.bigcommerce.com/tools-resources/sandbox",
    key_endpoints: [
      { method: "GET", path: "/catalog/products", description: "List products", auth_required: true },
      { method: "GET", path: "/orders", description: "List orders (v2 endpoint)", auth_required: true },
      { method: "GET", path: "/customers", description: "List customers", auth_required: true },
      { method: "POST", path: "/carts", description: "Create cart", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "page-based: ?page=1&limit=250 (max 250).",
    rate_limit: "Standard: 4 req/sec. Plus: 7/sec. Pro/Enterprise: 7-12/sec.",
    error_format: "JSON: {\"status\":422,\"title\":\"...\",\"errors\":{\"field\":\"...\"}}",
    quickstart_example: "GET /stores/{store_hash}/v3/catalog/products\nX-Auth-Token: {access_token}\nX-Auth-Client: {client_id}",
    agent_tips: [
      "Two headers required: X-Auth-Token AND X-Auth-Client.",
      "store_hash is in the API URL — unique per store.",
      "Orders use v2 API: /stores/{hash}/v2/orders.",
      "GraphQL Storefront API available for frontend queries.",
      "Sandbox store available for development/testing."
    ],
    docs_url: "https://developer.bigcommerce.com/docs/rest-catalog"
  },
  {
    service_id: "klarna",
    base_url: "https://api.klarna.com/",
    api_version: "v1",
    auth_overview: "API key (username:password) as Basic auth. Obtain from Klarna Merchant Portal.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Log into Klarna Merchant Portal. 2. Go to Settings > API credentials. 3. Use as Basic auth (username:password).",
    sandbox_url: "https://api.playground.klarna.com/",
    key_endpoints: [
      { method: "POST", path: "/payments/v1/sessions", description: "Create payment session", auth_required: true },
      { method: "POST", path: "/payments/v1/authorizations/{token}/order", description: "Create order", auth_required: true },
      { method: "GET", path: "/ordermanagement/v1/orders/{id}", description: "Get order details", auth_required: true },
      { method: "POST", path: "/ordermanagement/v1/orders/{id}/captures", description: "Capture order", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based where applicable.",
    rate_limit: "Not published. Contact Klarna for high-volume needs.",
    error_format: "JSON: {\"error_code\":\"...\",\"error_messages\":[\"...\"],\"correlation_id\":\"...\"}",
    quickstart_example: "POST /payments/v1/sessions\nAuthorization: Basic {base64(username:password)}\nContent-Type: application/json\n\n{\"purchase_country\":\"US\",\"purchase_currency\":\"USD\",\"order_amount\":10000,\"order_lines\":[...]}",
    agent_tips: [
      "Amounts in minor units (cents): 10000 = $100.00.",
      "Playground (sandbox) uses different base URL — api.playground.klarna.com.",
      "Order flow: create session → authorize → capture.",
      "Region-specific: US, EU, and APAC have different base URLs.",
      "BNPL options (Pay Later, Slice It) depend on market availability."
    ],
    docs_url: "https://docs.klarna.com/"
  },
  {
    service_id: "adyen",
    base_url: "https://checkout-test.adyen.com/v71/",
    api_version: "v71",
    auth_overview: "API key in X-API-Key header. Generate in Adyen Customer Area > Developers > API credentials.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Log into Adyen Customer Area. 2. Go to Developers > API credentials. 3. Generate API key. 4. Use test prefix URL for sandbox.",
    sandbox_url: "https://checkout-test.adyen.com/",
    key_endpoints: [
      { method: "POST", path: "/sessions", description: "Create payment session (Drop-in)", auth_required: true },
      { method: "POST", path: "/payments", description: "Make payment (API-only)", auth_required: true },
      { method: "POST", path: "/payments/details", description: "Submit additional payment details", auth_required: true },
      { method: "GET", path: "/paymentMethods", description: "Get available payment methods", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A for payment endpoints.",
    rate_limit: "Test: 100 req/sec. Live: depends on contract.",
    error_format: "JSON: {\"status\":422,\"errorCode\":\"...\",\"message\":\"...\",\"errorType\":\"...\"}",
    quickstart_example: "POST /v71/sessions\nX-API-Key: {api_key}\nContent-Type: application/json\n\n{\"amount\":{\"value\":10000,\"currency\":\"USD\"},\"merchantAccount\":\"{merchant}\",\"returnUrl\":\"https://example.com/return\"}",
    agent_tips: [
      "Amounts are in minor units: {value:10000, currency:'USD'} = $100.00.",
      "Test URL: checkout-test.adyen.com. Live URL: checkout-live.adyen.com/{prefix}.",
      "250+ payment methods supported — use /paymentMethods to discover available ones.",
      "Sessions API (Drop-in) is simplest. Payments API for full control.",
      "merchantAccount is required — found in Adyen Customer Area.",
      "Test card: 4111 1111 1111 1111 with any future date and 737 CVC."
    ],
    docs_url: "https://docs.adyen.com/api-explorer/"
  },

  // ── BI / Analytics ─────────────────────────────────────────
  {
    service_id: "bigquery",
    base_url: "https://bigquery.googleapis.com/bigquery/v2/",
    api_version: "v2",
    auth_overview: "OAuth 2.0 or service account. Enable BigQuery API in Google Cloud Console.",
    auth_token_url: "https://oauth2.googleapis.com/token",
    auth_scopes: "https://www.googleapis.com/auth/bigquery",
    auth_setup_hint: "1. Enable BigQuery API in Cloud Console. 2. Create service account with BigQuery roles. 3. Download JSON key file. 4. Or use Application Default Credentials.",
    sandbox_url: "https://console.cloud.google.com/bigquery (free tier: 1TB query/month)",
    key_endpoints: [
      { method: "POST", path: "/projects/{projectId}/queries", description: "Run SQL query", auth_required: true },
      { method: "GET", path: "/projects/{projectId}/datasets", description: "List datasets", auth_required: true },
      { method: "POST", path: "/projects/{projectId}/jobs", description: "Create job (load, query, extract)", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "token-based: pageToken in response. Use in next request.",
    rate_limit: "Concurrent queries: 100 per project. API: 100 req/sec.",
    error_format: "JSON: {\"error\":{\"code\":403,\"message\":\"...\",\"errors\":[...]}}",
    quickstart_example: "POST /bigquery/v2/projects/{projectId}/queries\nAuthorization: Bearer {access_token}\n\n{\"query\":\"SELECT * FROM `project.dataset.table` LIMIT 10\",\"useLegacySql\":false}",
    agent_tips: [
      "Free tier: 1TB query processing/month, 10GB storage.",
      "Always set useLegacySql:false for standard SQL.",
      "Use client libraries (@google-cloud/bigquery) over raw REST.",
      "Table names use backtick syntax: `project.dataset.table`.",
      "Dry run: set dryRun:true to estimate query cost without running."
    ],
    docs_url: "https://cloud.google.com/bigquery/docs/reference/rest"
  },
  {
    service_id: "databricks",
    base_url: "https://{workspace}.cloud.databricks.com/api/2.0/",
    api_version: "2.0",
    auth_overview: "Personal access token as Bearer. Generate in Databricks workspace > User Settings > Developer.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Log into Databricks workspace. 2. User Settings > Developer > Access Tokens. 3. Generate token. 4. Use workspace URL from your deployment.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/sql/statements", description: "Execute SQL statement", auth_required: true },
      { method: "GET", path: "/clusters/list", description: "List clusters", auth_required: true },
      { method: "POST", path: "/jobs/create", description: "Create job", auth_required: true },
      { method: "POST", path: "/jobs/run-now", description: "Trigger job run", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "token-based: has_more and next_page_token.",
    rate_limit: "30 req/sec per workspace. Rate-limited endpoints return 429.",
    error_format: "JSON: {\"error_code\":\"...\",\"message\":\"...\"}",
    quickstart_example: "POST /api/2.0/sql/statements\nAuthorization: Bearer {token}\n\n{\"warehouse_id\":\"{id}\",\"statement\":\"SELECT * FROM catalog.schema.table LIMIT 10\"}",
    agent_tips: [
      "Workspace URL is deployment-specific: {workspace}.cloud.databricks.com.",
      "SQL Statements API requires a SQL Warehouse — check warehouse_id.",
      "Unity Catalog for data governance — 3-level namespace: catalog.schema.table.",
      "Jobs API for scheduling notebooks and pipelines.",
      "Use Databricks SDK (Python/Java) for better experience than raw REST."
    ],
    docs_url: "https://docs.databricks.com/api/"
  },

  // ── Design ─────────────────────────────────────────────────
  {
    service_id: "framer",
    base_url: "https://api.framer.com/v1/",
    api_version: "v1",
    auth_overview: "API key as Bearer token. Generate at framer.com > Account Settings > API.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Go to framer.com account settings. 2. Generate API token. 3. Use as Bearer token.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/sites", description: "List sites", auth_required: true },
      { method: "GET", path: "/sites/{id}/collections", description: "List CMS collections", auth_required: true },
      { method: "GET", path: "/sites/{id}/collections/{collectionId}/items", description: "List CMS items", auth_required: true },
      { method: "POST", path: "/sites/{id}/collections/{collectionId}/items", description: "Create CMS item", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "cursor-based: cursor param.",
    rate_limit: "Not published. Fair use.",
    error_format: "JSON: {\"error\":\"...\",\"message\":\"...\"}",
    quickstart_example: "GET /v1/sites\nAuthorization: Bearer {api_token}",
    agent_tips: [
      "API is primarily for CMS content management, not visual design.",
      "Design changes are made in Framer editor, not via API.",
      "CMS collections map to content types (blog posts, products, etc.).",
      "Webhooks available for publish events."
    ],
    docs_url: "https://www.framer.com/developers/"
  },
  {
    service_id: "webflow",
    base_url: "https://api.webflow.com/v2/",
    api_version: "v2",
    auth_overview: "OAuth 2.0 or site API token as Bearer. Create at webflow.com/dashboard/account/integrations.",
    auth_token_url: "https://api.webflow.com/oauth/access_token",
    auth_scopes: "sites:read cms:read cms:write forms:read",
    auth_setup_hint: "1. Go to Site Settings > Integrations > API Access. 2. Generate Site API token. 3. Or create OAuth app at webflow.com/developers.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/sites", description: "List sites", auth_required: true },
      { method: "GET", path: "/sites/{id}/collections", description: "List CMS collections", auth_required: true },
      { method: "GET", path: "/collections/{id}/items", description: "List CMS items", auth_required: true },
      { method: "POST", path: "/collections/{id}/items", description: "Create CMS item", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "offset-based: offset and limit (max 100).",
    rate_limit: "60 req/min per site.",
    error_format: "JSON: {\"code\":\"...\",\"message\":\"...\",\"externalReference\":\"...\"}",
    quickstart_example: "GET /v2/sites\nAuthorization: Bearer {site_api_token}",
    agent_tips: [
      "v2 API is current — v1 deprecated.",
      "CMS items must match collection schema — check fields first.",
      "Publish after CMS changes: POST /sites/{id}/publish.",
      "Site API tokens are scoped to one site. OAuth spans multiple.",
      "Form submissions readable via GET /sites/{id}/forms/{formId}/submissions."
    ],
    docs_url: "https://developers.webflow.com/data/reference"
  },

  // ── Forms ──────────────────────────────────────────────────
  {
    service_id: "typeform",
    base_url: "https://api.typeform.com/",
    api_version: "v1",
    auth_overview: "Personal access token as Bearer. Generate at admin.typeform.com > Account > Personal tokens.",
    auth_token_url: "https://api.typeform.com/oauth/authorize",
    auth_scopes: "forms:read forms:write responses:read",
    auth_setup_hint: "1. Go to admin.typeform.com > Account > Personal tokens. 2. Create token with needed scopes. 3. Or use OAuth for app integration.",
    sandbox_url: null,
    key_endpoints: [
      { method: "GET", path: "/forms", description: "List forms", auth_required: true },
      { method: "POST", path: "/forms", description: "Create form", auth_required: true },
      { method: "GET", path: "/forms/{form_id}/responses", description: "Get form responses", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "token-based: before/after params with response token.",
    rate_limit: "2 req/sec. Higher limits on paid plans.",
    error_format: "JSON: {\"code\":\"...\",\"description\":\"...\"}",
    quickstart_example: "GET /forms/{form_id}/responses?page_size=25\nAuthorization: Bearer {token}",
    agent_tips: [
      "Form structure uses 'fields' array with types (short_text, multiple_choice, etc.).",
      "Responses are keyed by field.ref — set refs during form creation for stable keys.",
      "Webhook integration: POST /forms/{id}/webhooks for real-time responses.",
      "Logic jumps for branching are in 'logic' array."
    ],
    docs_url: "https://developer.typeform.com/create/"
  },
  {
    service_id: "tally",
    base_url: "https://api.tally.so/",
    api_version: "v1 (limited)",
    auth_overview: "No traditional API. Uses webhooks for form submissions. Zapier/Make integrations available.",
    auth_token_url: null,
    auth_scopes: null,
    auth_setup_hint: "1. Create form at tally.so. 2. Go to form > Integrations > Webhooks. 3. Set webhook URL for form submissions. 4. Or use Zapier/Make for automation.",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "(webhook)", description: "Receive form submission via webhook", auth_required: false }
    ],
    request_content_type: "application/json",
    pagination_style: "N/A — webhook push only.",
    rate_limit: "N/A — submissions are pushed via webhooks.",
    error_format: "N/A",
    quickstart_example: "Webhook payload:\n{\"eventId\":\"...\",\"createdAt\":\"...\",\"data\":{\"fields\":[{\"key\":\"question_xxx\",\"label\":\"Name\",\"type\":\"INPUT_TEXT\",\"value\":\"John\"}]}}",
    agent_tips: [
      "No REST API for reading forms — webhook-only for submissions.",
      "Zapier and Make integrations are the primary automation path.",
      "Webhook payload includes all field values with labels.",
      "Free tier has no submission limits — very generous.",
      "Conditional logic and calculations available in forms."
    ],
    docs_url: "https://tally.so/help/webhooks"
  },

  // ── Communication ──────────────────────────────────────────
  {
    service_id: "google-meet",
    base_url: "https://meet.googleapis.com/v2/",
    api_version: "v2",
    auth_overview: "OAuth 2.0 with Google Workspace. Enable Google Meet API in Cloud Console.",
    auth_token_url: "https://oauth2.googleapis.com/token",
    auth_scopes: "https://www.googleapis.com/auth/meetings.space.created",
    auth_setup_hint: "1. Enable Google Meet REST API in Cloud Console. 2. Create OAuth credentials. 3. Requires Google Workspace account (not personal Gmail).",
    sandbox_url: null,
    key_endpoints: [
      { method: "POST", path: "/spaces", description: "Create meeting space", auth_required: true },
      { method: "GET", path: "/spaces/{name}", description: "Get meeting space details", auth_required: true },
      { method: "GET", path: "/conferenceRecords", description: "List past conference records", auth_required: true }
    ],
    request_content_type: "application/json",
    pagination_style: "token-based: pageToken/nextPageToken.",
    rate_limit: "Google Workspace API limits apply. Default: 600 req/min.",
    error_format: "JSON: {\"error\":{\"code\":403,\"message\":\"...\",\"status\":\"PERMISSION_DENIED\"}}",
    quickstart_example: "POST /v2/spaces\nAuthorization: Bearer {access_token}\nContent-Type: application/json\n\n{\"config\":{\"accessType\":\"OPEN\"}}",
    agent_tips: [
      "Requires Google Workspace — not available for personal Gmail accounts.",
      "Meet API is relatively new (2024) — limited features vs Calendar API.",
      "Creating a space returns a meetingUri for joining.",
      "For scheduling meetings with times, use Google Calendar API instead.",
      "Conference records available after meeting ends — includes participant info."
    ],
    docs_url: "https://developers.google.com/meet/api/reference/rest"
  }
];

// Deduplicate
const toAdd = newGuides.filter((g) => !existingIds.has(g.service_id));
console.log(`Existing guides: ${existing.length}`);
console.log(`New guides to add: ${toAdd.length}`);
console.log(`Skipped (already exist): ${newGuides.length - toAdd.length}`);

const merged = [...existing, ...toAdd];
writeFileSync(guidesPath, JSON.stringify(merged, null, 2));
console.log(`Total guides: ${merged.length}`);
console.log("Written to:", guidesPath);
