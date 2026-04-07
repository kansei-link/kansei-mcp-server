#!/usr/bin/env node
/**
 * Add ~55 essential global services + 12 recipes to KanseiLink seed data.
 * Run once, then delete this script.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "../src/data");

// ─── New Services ───
const newServices = [
  // === Development & Infrastructure ===
  {
    id: "aws-lambda",
    name: "AWS (Lambda / DynamoDB / RDS)",
    namespace: "",
    description: "Amazon Web Services core compute and database services. Lambda for serverless functions, DynamoDB for NoSQL, RDS for managed relational databases. Comprehensive SDKs and REST APIs. Community MCP servers available for S3, Lambda, and DynamoDB.",
    category: "developer_tools",
    tags: "aws,lambda,dynamodb,rds,serverless,cloud,infrastructure",
    mcp_endpoint: "",
    mcp_status: "third_party",
    api_url: "https://docs.aws.amazon.com/",
    api_auth_method: "api_key",
    trust_score: 0.7
  },
  {
    id: "google-cloud",
    name: "Google Cloud Platform",
    namespace: "",
    description: "Google's cloud computing platform. Compute Engine, Cloud Functions, Cloud Run, Pub/Sub, Cloud Storage, and 100+ services. Extensive REST and gRPC APIs. Terraform and SDK support.",
    category: "developer_tools",
    tags: "gcp,google-cloud,compute,cloud-run,cloud-functions,infrastructure",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://cloud.google.com/apis",
    api_auth_method: "oauth2",
    trust_score: 0.65
  },
  {
    id: "azure",
    name: "Microsoft Azure",
    namespace: "",
    description: "Microsoft's cloud platform. Azure Functions, Cosmos DB, Azure AI, App Service, and enterprise integration. REST APIs with OpenAPI specs. Strong enterprise adoption.",
    category: "developer_tools",
    tags: "azure,microsoft,cloud,functions,cosmos-db,enterprise",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://learn.microsoft.com/en-us/rest/api/azure/",
    api_auth_method: "oauth2",
    trust_score: 0.65
  },
  {
    id: "circleci",
    name: "CircleCI",
    namespace: "",
    description: "Continuous integration and delivery platform. Pipeline orchestration, Docker-based builds, parallelism, test splitting. REST API v2 for pipeline management and insights.",
    category: "devops",
    tags: "ci,cd,pipeline,testing,docker,automation",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://circleci.com/docs/api/v2/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    namespace: "",
    description: "GitHub's built-in CI/CD platform. Workflow automation with YAML configuration, marketplace of 20,000+ actions. Managed via GitHub REST API (workflow runs, artifacts, secrets).",
    category: "devops",
    tags: "ci,cd,github,automation,workflows,actions",
    mcp_endpoint: "",
    mcp_status: "third_party",
    api_url: "https://docs.github.com/en/rest/actions",
    api_auth_method: "oauth2",
    trust_score: 0.7
  },
  {
    id: "heroku",
    name: "Heroku",
    namespace: "",
    description: "Platform-as-a-service for building, running, and scaling apps. Git-based deploys, add-on marketplace, Heroku Postgres. Platform API for app and dyno management.",
    category: "devops",
    tags: "paas,hosting,deployment,postgres,heroku,salesforce",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://devcenter.heroku.com/articles/platform-api-reference",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },
  {
    id: "turso",
    name: "Turso",
    namespace: "",
    description: "Edge-hosted distributed SQLite database built on libSQL. Low-latency reads from 30+ regions. REST API and native SDKs. Embedded replicas for local-first apps.",
    category: "database",
    tags: "sqlite,edge,database,libsql,distributed,serverless",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.turso.tech/api-reference",
    api_auth_method: "api_key",
    trust_score: 0.5
  },

  // === Communication ===
  {
    id: "google-meet",
    name: "Google Meet",
    namespace: "",
    description: "Google's video conferencing platform integrated with Google Workspace. Meeting creation, calendar integration, recording management via Google Calendar and Admin APIs.",
    category: "communication",
    tags: "video,meeting,conferencing,google,workspace",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developers.google.com/meet/api",
    api_auth_method: "oauth2",
    trust_score: 0.55
  },

  // === Marketing & Analytics ===
  {
    id: "mixpanel",
    name: "Mixpanel",
    namespace: "",
    description: "Product analytics platform. Event tracking, funnel analysis, retention reports, cohort analysis. Ingestion API for events, Query API (JQL) for data export and analysis.",
    category: "marketing",
    tags: "analytics,product-analytics,events,funnels,retention,cohorts",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.mixpanel.com/",
    api_auth_method: "api_key",
    trust_score: 0.55
  },
  {
    id: "amplitude",
    name: "Amplitude",
    namespace: "",
    description: "Digital analytics platform for product intelligence. Behavioral analytics, experimentation, CDP. HTTP API for event ingestion, Cohort/Export APIs for data retrieval.",
    category: "marketing",
    tags: "analytics,product-analytics,behavioral,experimentation,cdp",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://www.docs.developers.amplitude.com/",
    api_auth_method: "api_key",
    trust_score: 0.55
  },
  {
    id: "segment",
    name: "Segment (Twilio)",
    namespace: "",
    description: "Customer Data Platform. Collect, clean, and route user data to 400+ destinations. Track API for events, Profiles API for user data, Connections API for source/destination management.",
    category: "data_integration",
    tags: "cdp,data-pipeline,analytics,customer-data,tracking,twilio",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://segment.com/docs/api/",
    api_auth_method: "api_key",
    trust_score: 0.6
  },
  {
    id: "posthog",
    name: "PostHog",
    namespace: "",
    description: "Open-source product analytics suite. Analytics, session replay, feature flags, A/B testing, surveys. Self-host or cloud. REST API and community MCP server available.",
    category: "marketing",
    tags: "analytics,product-analytics,feature-flags,session-replay,open-source",
    mcp_endpoint: "",
    mcp_status: "third_party",
    api_url: "https://posthog.com/docs/api",
    api_auth_method: "api_key",
    trust_score: 0.6
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    namespace: "",
    description: "Email and SMS marketing automation for ecommerce. Flows, campaigns, segmentation, predictive analytics. REST API v3 for lists, profiles, campaigns, and event tracking.",
    category: "marketing",
    tags: "email-marketing,sms,ecommerce,automation,segmentation,klaviyo",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developers.klaviyo.com/",
    api_auth_method: "api_key",
    trust_score: 0.55
  },
  {
    id: "activecampaign",
    name: "ActiveCampaign",
    namespace: "",
    description: "Marketing automation and CRM platform. Email marketing, sales automation, messaging, machine learning-powered predictions. REST API v3 for contacts, deals, automations.",
    category: "marketing",
    tags: "email-marketing,automation,crm,sales,marketing-automation",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developers.activecampaign.com/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },
  {
    id: "brevo",
    name: "Brevo (Sendinblue)",
    namespace: "",
    description: "All-in-one marketing platform. Email, SMS, WhatsApp, chat, CRM. Transactional and marketing email APIs. REST API v3 for contacts, campaigns, and automations.",
    category: "marketing",
    tags: "email-marketing,sms,whatsapp,crm,transactional-email",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developers.brevo.com/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },
  {
    id: "customer-io",
    name: "Customer.io",
    namespace: "",
    description: "Messaging automation platform. Behavioral-triggered emails, push notifications, SMS, in-app messages. Track API for events, App API for campaigns and segments.",
    category: "marketing",
    tags: "messaging,automation,email,push,behavioral,customer-engagement",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://customer.io/docs/api/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },

  // === Accounting & Finance (Global) ===
  {
    id: "quickbooks",
    name: "QuickBooks Online",
    namespace: "",
    description: "Intuit's cloud accounting platform. #1 SMB accounting software globally. Invoicing, expenses, payroll, tax. REST API v3 with OAuth 2.0. 750+ app integrations.",
    category: "accounting",
    tags: "accounting,invoicing,payroll,tax,quickbooks,intuit,global",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account",
    api_auth_method: "oauth2",
    trust_score: 0.6
  },
  {
    id: "xero",
    name: "Xero",
    namespace: "",
    description: "Cloud accounting for small businesses. Popular in UK, AU, NZ. Invoicing, bank reconciliation, payroll, inventory. REST API with OAuth 2.0. 1000+ app marketplace.",
    category: "accounting",
    tags: "accounting,invoicing,payroll,bank-reconciliation,xero,global",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.xero.com/",
    api_auth_method: "oauth2",
    trust_score: 0.6
  },
  {
    id: "freshbooks",
    name: "FreshBooks",
    namespace: "",
    description: "Cloud accounting built for freelancers and service businesses. Time tracking, invoicing, expenses, proposals. REST API for invoices, clients, time entries.",
    category: "accounting",
    tags: "accounting,invoicing,time-tracking,freelancer,freshbooks",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://www.freshbooks.com/api",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },
  {
    id: "brex",
    name: "Brex",
    namespace: "",
    description: "Corporate card and spend management for startups and enterprises. Real-time expense tracking, budgets, bill pay. REST API for transactions, users, and card management.",
    category: "accounting",
    tags: "corporate-card,expenses,spend-management,startup,fintech",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.brex.com/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },
  {
    id: "ramp",
    name: "Ramp",
    namespace: "",
    description: "Corporate card and finance automation platform. Expense management, bill pay, procurement, accounting integrations. REST API for transactions and reimbursements.",
    category: "accounting",
    tags: "corporate-card,expenses,finance-automation,procurement",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.ramp.com/",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },
  {
    id: "mercury",
    name: "Mercury",
    namespace: "",
    description: "Banking for startups. Business checking/savings, treasury, venture debt, corporate cards. API for transactions, accounts, and payment initiation.",
    category: "accounting",
    tags: "banking,startup,treasury,payments,fintech",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.mercury.com/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },

  // === HR ===
  {
    id: "workday",
    name: "Workday",
    namespace: "",
    description: "Enterprise HCM and financial management platform. HR, payroll, talent management, workforce planning. REST and SOAP APIs. Dominant in enterprise HR globally.",
    category: "hr",
    tags: "hcm,payroll,talent,enterprise,workforce,global",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://community.workday.com/sites/default/files/file-hosting/restapi/",
    api_auth_method: "oauth2",
    trust_score: 0.55
  },
  {
    id: "bamboohr",
    name: "BambooHR",
    namespace: "",
    description: "HR software for small and medium businesses. Employee records, time-off tracking, onboarding, performance reviews. REST API for employee data and time tracking.",
    category: "hr",
    tags: "hr,employee-management,onboarding,time-off,smb",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://documentation.bamboohr.com/reference",
    api_auth_method: "api_key",
    trust_score: 0.5
  },
  {
    id: "gusto",
    name: "Gusto",
    namespace: "",
    description: "Payroll, benefits, and HR platform for US small businesses. Full-service payroll, health insurance, 401(k). REST API for payroll, employees, and company management.",
    category: "hr",
    tags: "payroll,benefits,hr,small-business,us",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.gusto.com/",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },
  {
    id: "rippling",
    name: "Rippling",
    namespace: "",
    description: "Unified workforce platform. HR, IT, payroll, benefits, device management in one system. REST API. Fast-growing platform connecting HR and IT management.",
    category: "hr",
    tags: "hr,payroll,it-management,device,unified-platform",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.rippling.com/",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },
  {
    id: "deel",
    name: "Deel",
    namespace: "",
    description: "Global payroll and compliance platform. Hire and pay contractors and employees in 150+ countries. REST API for contracts, invoices, and payments.",
    category: "hr",
    tags: "global-payroll,contractors,compliance,remote,international",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.deel.com/",
    api_auth_method: "oauth2",
    trust_score: 0.55
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    namespace: "",
    description: "Structured hiring platform. ATS, interview scheduling, scorecards, offer management. Harvest API for candidates and jobs, Ingestion API for job board integration.",
    category: "hr",
    tags: "ats,recruiting,hiring,interviews,talent-acquisition",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developers.greenhouse.io/",
    api_auth_method: "api_key",
    trust_score: 0.55
  },

  // === Customer Support ===
  {
    id: "helpscout",
    name: "Help Scout",
    namespace: "",
    description: "Customer support platform with shared inbox, knowledge base, and live chat. REST API (Mailbox 2.0) for conversations, customers, and reports.",
    category: "support",
    tags: "support,helpdesk,shared-inbox,knowledge-base,customer-service",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.helpscout.com/",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },
  {
    id: "front",
    name: "Front",
    namespace: "",
    description: "Customer operations platform. Shared inbox for email, SMS, social. Workflow automation, analytics. REST API for conversations, contacts, and message operations.",
    category: "support",
    tags: "shared-inbox,customer-ops,email,workflow,collaboration",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://dev.frontapp.com/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },
  {
    id: "servicenow",
    name: "ServiceNow",
    namespace: "",
    description: "Enterprise IT service management and digital workflow platform. ITSM, ITOM, HRSD. REST API (Table API, Scripted REST) for incident, change, and request management.",
    category: "support",
    tags: "itsm,itil,enterprise,service-desk,workflow,digital-workflow",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.servicenow.com/dev.do",
    api_auth_method: "oauth2",
    trust_score: 0.6
  },
  {
    id: "gorgias",
    name: "Gorgias",
    namespace: "",
    description: "Ecommerce-focused helpdesk. Deep Shopify/BigCommerce integration. Automate responses with macros and rules. REST API for tickets, customers, and integrations.",
    category: "support",
    tags: "support,ecommerce,shopify,helpdesk,automation",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developers.gorgias.com/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },

  // === SNS & Social ===
  {
    id: "twitter-api",
    name: "X (Twitter) API",
    namespace: "",
    description: "Social media platform API. Post tweets, read timelines, manage lists, search. API v2 with OAuth 2.0. Essential for social monitoring and engagement automation.",
    category: "marketing",
    tags: "social-media,twitter,x,posts,timeline,search,engagement",
    mcp_endpoint: "",
    mcp_status: "third_party",
    api_url: "https://developer.x.com/en/docs",
    api_auth_method: "oauth2",
    trust_score: 0.6
  },
  {
    id: "linkedin-api",
    name: "LinkedIn API",
    namespace: "",
    description: "Professional network API. Share posts, manage company pages, Marketing API for ads, Community Management API. OAuth 2.0. Key B2B marketing channel.",
    category: "marketing",
    tags: "social-media,linkedin,b2b,professional,marketing,recruiting",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://learn.microsoft.com/en-us/linkedin/",
    api_auth_method: "oauth2",
    trust_score: 0.55
  },
  {
    id: "youtube-api",
    name: "YouTube API",
    namespace: "",
    description: "Video platform API by Google. Upload videos, manage playlists, read analytics, live streaming. Data API v3 and Analytics API. Largest video platform globally.",
    category: "marketing",
    tags: "video,youtube,streaming,analytics,content,google",
    mcp_endpoint: "",
    mcp_status: "third_party",
    api_url: "https://developers.google.com/youtube/v3",
    api_auth_method: "oauth2",
    trust_score: 0.6
  },
  {
    id: "buffer",
    name: "Buffer",
    namespace: "",
    description: "Social media management platform. Schedule posts across Twitter, LinkedIn, Instagram, Facebook, TikTok. REST API for publishing, analytics, and channel management.",
    category: "marketing",
    tags: "social-media,scheduling,publishing,analytics,multi-platform",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://buffer.com/developers/api",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },

  // === Search & Web Automation ===
  {
    id: "brave-search",
    name: "Brave Search",
    namespace: "io.github.anthropic/brave-search",
    description: "Privacy-focused search engine with independent index. Web search, news, and local results. Official MCP server by Anthropic. Top choice for AI agent web search.",
    category: "data_integration",
    tags: "search,web-search,privacy,brave,mcp-official",
    mcp_endpoint: "npx @anthropic/brave-search-mcp",
    mcp_status: "official",
    trust_score: 0.85
  },
  {
    id: "tavily",
    name: "Tavily",
    namespace: "",
    description: "AI-optimized search API built for LLMs and AI agents. Returns clean, structured search results. Official MCP server. Designed specifically for agentic workflows.",
    category: "data_integration",
    tags: "search,ai-search,llm,structured-data,agent-optimized",
    mcp_endpoint: "npx tavily-mcp",
    mcp_status: "official",
    trust_score: 0.8
  },
  {
    id: "playwright-mcp",
    name: "Playwright MCP",
    namespace: "io.github.anthropic/playwright",
    description: "Browser automation framework by Microsoft with official MCP server. Navigate pages, fill forms, click elements, extract data. Key tool for AI agent web interaction.",
    category: "developer_tools",
    tags: "browser,automation,testing,web,scraping,playwright,mcp-official",
    mcp_endpoint: "npx @anthropic/playwright-mcp",
    mcp_status: "official",
    trust_score: 0.85
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    namespace: "",
    description: "Web scraping API optimized for LLMs. Crawl websites and return clean markdown. Official MCP server. Handles JavaScript rendering, anti-bot bypass, and structured extraction.",
    category: "data_integration",
    tags: "scraping,crawling,markdown,llm,web-data,mcp-official",
    mcp_endpoint: "npx firecrawl-mcp",
    mcp_status: "official",
    trust_score: 0.8
  },

  // === AI & ML ===
  {
    id: "google-ai",
    name: "Google AI (Gemini)",
    namespace: "",
    description: "Google's AI platform. Gemini models (Pro, Ultra, Flash), Vertex AI, embeddings, multimodal capabilities. REST API and SDKs. Competitive with OpenAI and Anthropic.",
    category: "ai_ml",
    tags: "llm,gemini,google,multimodal,embeddings,vertex-ai",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://ai.google.dev/",
    api_auth_method: "api_key",
    trust_score: 0.7
  },
  {
    id: "cohere",
    name: "Cohere",
    namespace: "",
    description: "Enterprise AI platform. Command models, Embed for search, Rerank for relevance. Strong RAG capabilities. REST API with enterprise-grade security and deployment options.",
    category: "ai_ml",
    tags: "llm,embeddings,rerank,rag,enterprise-ai,nlp",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.cohere.com/",
    api_auth_method: "api_key",
    trust_score: 0.6
  },
  {
    id: "mistral",
    name: "Mistral AI",
    namespace: "",
    description: "European AI lab. Mistral, Mixtral, and Codestral models. Function calling, JSON mode, vision. REST API compatible with OpenAI format. Strong open-weight model lineup.",
    category: "ai_ml",
    tags: "llm,open-weight,european,function-calling,code,mixtral",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.mistral.ai/",
    api_auth_method: "api_key",
    trust_score: 0.6
  },
  {
    id: "groq",
    name: "Groq",
    namespace: "",
    description: "Ultra-fast LLM inference on custom LPU hardware. Fastest token generation speeds. OpenAI-compatible API. Supports Llama, Mistral, Gemma models.",
    category: "ai_ml",
    tags: "llm,inference,fast,lpu,hardware,openai-compatible",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://console.groq.com/docs/",
    api_auth_method: "api_key",
    trust_score: 0.6
  },
  {
    id: "perplexity",
    name: "Perplexity",
    namespace: "",
    description: "AI-powered search and answer engine. Sonar models with real-time web search built in. REST API (OpenAI-compatible) returns answers with citations. Used for research agents.",
    category: "ai_ml",
    tags: "ai-search,llm,citations,web-search,research,sonar",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.perplexity.ai/",
    api_auth_method: "api_key",
    trust_score: 0.6
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    namespace: "",
    description: "AI voice synthesis and cloning platform. Text-to-speech, voice cloning, dubbing, sound effects. REST API and official MCP server. Leading voice AI provider.",
    category: "ai_ml",
    tags: "tts,voice,speech,cloning,audio,voice-ai",
    mcp_endpoint: "npx elevenlabs-mcp",
    mcp_status: "official",
    trust_score: 0.7
  },
  {
    id: "qdrant",
    name: "Qdrant",
    namespace: "",
    description: "High-performance vector database. Similarity search, filtering, payload indexing. REST and gRPC APIs. Official MCP server. Open-source with managed cloud offering.",
    category: "database",
    tags: "vector-db,embeddings,similarity-search,rag,open-source",
    mcp_endpoint: "npx @qdrant/mcp-server",
    mcp_status: "official",
    trust_score: 0.75
  },
  {
    id: "chroma",
    name: "Chroma",
    namespace: "",
    description: "Open-source embedding database for AI applications. Simple API for storing and querying embeddings. Python and JS clients. Popular for RAG prototyping.",
    category: "database",
    tags: "vector-db,embeddings,rag,open-source,ai-native",
    mcp_endpoint: "",
    mcp_status: "third_party",
    api_url: "https://docs.trychroma.com/",
    api_auth_method: "api_key",
    trust_score: 0.6
  },
  {
    id: "langfuse",
    name: "Langfuse",
    namespace: "",
    description: "Open-source LLM observability and evaluation platform. Tracing, prompt management, scoring, datasets. REST API and official MCP server. Essential for LLM ops.",
    category: "ai_ml",
    tags: "llm-ops,observability,tracing,evaluation,prompt-management,open-source",
    mcp_endpoint: "npx langfuse-mcp",
    mcp_status: "official",
    trust_score: 0.7
  },

  // === EC & Payment ===
  {
    id: "bigcommerce",
    name: "BigCommerce",
    namespace: "",
    description: "Enterprise ecommerce platform. Headless commerce, multi-channel selling, B2B support. REST and GraphQL APIs. Strong API-first architecture for composable commerce.",
    category: "ecommerce",
    tags: "ecommerce,headless,b2b,multi-channel,enterprise",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.bigcommerce.com/",
    api_auth_method: "oauth2",
    trust_score: 0.55
  },
  {
    id: "klarna",
    name: "Klarna",
    namespace: "",
    description: "Buy-now-pay-later and payment platform. Installment payments, pay later, financing. Payments API, Order Management API. Major BNPL provider globally.",
    category: "payment",
    tags: "bnpl,payments,installments,financing,ecommerce",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.klarna.com/",
    api_auth_method: "api_key",
    trust_score: 0.55
  },
  {
    id: "adyen",
    name: "Adyen",
    namespace: "",
    description: "Enterprise payment platform. Unified commerce across online, in-store, and mobile. 250+ payment methods, risk management. REST API for payments and payouts.",
    category: "payment",
    tags: "payments,enterprise,unified-commerce,global,pos,risk",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.adyen.com/api-explorer/",
    api_auth_method: "api_key",
    trust_score: 0.6
  },

  // === Database ===
  {
    id: "postgresql-mcp",
    name: "PostgreSQL MCP",
    namespace: "io.github.anthropic/postgres",
    description: "World's most advanced open-source relational database. Official MCP server by Anthropic for read-only queries. AI agents can inspect schemas and query data directly.",
    category: "database",
    tags: "database,sql,relational,open-source,postgres,mcp-official",
    mcp_endpoint: "npx @anthropic/postgres-mcp",
    mcp_status: "official",
    trust_score: 0.85
  },
  {
    id: "mysql-mcp",
    name: "MySQL",
    namespace: "",
    description: "Popular open-source relational database by Oracle. Community MCP server available for schema inspection and queries. Most widely deployed open-source database.",
    category: "database",
    tags: "database,sql,relational,open-source,mysql,oracle",
    mcp_endpoint: "",
    mcp_status: "third_party",
    trust_score: 0.65
  },
  {
    id: "redis",
    name: "Redis",
    namespace: "",
    description: "In-memory data store for caching, queuing, and real-time applications. Key-value, streams, pub/sub, search. Community MCP server. Redis Cloud for managed service.",
    category: "database",
    tags: "cache,key-value,in-memory,pub-sub,streams,real-time",
    mcp_endpoint: "",
    mcp_status: "third_party",
    trust_score: 0.65
  },

  // === Design ===
  {
    id: "framer",
    name: "Framer",
    namespace: "",
    description: "Modern web design and publishing platform. Visual design to production website. Component-based, CMS, localization. REST API for sites and CMS content management.",
    category: "design",
    tags: "web-design,no-code,publishing,cms,prototyping",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://www.framer.com/developers/",
    api_auth_method: "api_key",
    trust_score: 0.5
  },
  {
    id: "webflow",
    name: "Webflow",
    namespace: "",
    description: "Visual web development platform. Design, build, and launch responsive websites. CMS, ecommerce, memberships. REST API for CMS items, forms, and site management.",
    category: "design",
    tags: "web-design,no-code,cms,ecommerce,visual-development",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developers.webflow.com/",
    api_auth_method: "oauth2",
    trust_score: 0.55
  },

  // === Forms ===
  {
    id: "typeform",
    name: "Typeform",
    namespace: "",
    description: "Conversational form and survey platform. Interactive forms, quizzes, surveys with branching logic. REST API for form creation, responses, and webhooks.",
    category: "productivity",
    tags: "forms,surveys,quizzes,data-collection,conversational",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://developer.typeform.com/",
    api_auth_method: "oauth2",
    trust_score: 0.5
  },
  {
    id: "tally",
    name: "Tally",
    namespace: "",
    description: "Free form builder with powerful features. No-code forms with calculations, conditional logic, file uploads. Webhooks and Zapier integration. API for responses.",
    category: "productivity",
    tags: "forms,no-code,free,surveys,data-collection",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://tally.so/help/webhooks",
    api_auth_method: "api_key",
    trust_score: 0.45
  },

  // === Additional high-hub services ===
  {
    id: "snowflake",
    name: "Snowflake",
    namespace: "",
    description: "Cloud data platform for data warehousing, data lakes, and data sharing. SQL-based analytics at scale. REST API (Snowpipe, Snowpark). Cortex AI for LLM integration.",
    category: "bi_analytics",
    tags: "data-warehouse,analytics,sql,cloud,data-sharing,cortex",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.snowflake.com/en/developer-guide/sql-api",
    api_auth_method: "oauth2",
    trust_score: 0.6
  },
  {
    id: "bigquery",
    name: "BigQuery",
    namespace: "",
    description: "Google's serverless data warehouse. Petabyte-scale analytics with SQL. Streaming inserts, ML integration (BigQuery ML), BI Engine. REST API and client libraries.",
    category: "bi_analytics",
    tags: "data-warehouse,analytics,sql,google,serverless,ml",
    mcp_endpoint: "",
    mcp_status: "third_party",
    api_url: "https://cloud.google.com/bigquery/docs/reference/rest",
    api_auth_method: "oauth2",
    trust_score: 0.65
  },
  {
    id: "databricks",
    name: "Databricks",
    namespace: "",
    description: "Unified analytics platform built on Apache Spark. Data engineering, ML, SQL analytics, lakehouse architecture. REST API for jobs, clusters, notebooks, and Unity Catalog.",
    category: "bi_analytics",
    tags: "data-engineering,ml,spark,lakehouse,analytics,sql",
    mcp_endpoint: "",
    mcp_status: "api_only",
    api_url: "https://docs.databricks.com/api/",
    api_auth_method: "api_key",
    trust_score: 0.6
  }
];

// ─── New Recipes ───
const newRecipes = [
  {
    id: "github-linear-slack-dev-flow",
    goal: "Development workflow: PR to task tracking with team notifications",
    description: "Automate development lifecycle: GitHub PR triggers Linear issue update, Slack notifies the team of progress and review requests.",
    steps: [
      { order: 1, service_id: "github", action: "Monitor pull request events (opened, merged, review requested)", input_mapping: { from: "webhook", fields: ["pr_url", "title", "author", "action"] }, output_mapping: { pr_data: "step1.pr_data" }, error_hint: "Ensure GitHub webhook is configured for PR events" },
      { order: 2, service_id: "linear", action: "Update linked issue status based on PR state (In Review, Done)", input_mapping: { issue_id: "step1.pr_data.branch_issue_id", status: "step1.pr_data.action" }, output_mapping: { issue_url: "step2.issue_url" }, error_hint: "Branch name must contain Linear issue ID (e.g., ENG-123)" },
      { order: 3, service_id: "slack", action: "Post PR status update to engineering channel", input_mapping: { channel: "config.eng_channel", message: "PR {{title}} by {{author}} — {{action}}" }, output_mapping: { message_id: "step3.message_id" }, error_hint: "Bot must be invited to the target channel" }
    ],
    required_services: ["github", "linear", "slack"]
  },
  {
    id: "stripe-quickbooks-slack-payment-accounting",
    goal: "Payment to accounting sync with notifications",
    description: "Stripe payment events automatically create QuickBooks journal entries and notify finance team via Slack.",
    steps: [
      { order: 1, service_id: "stripe-global", action: "Capture payment_intent.succeeded webhook with amount, currency, customer", input_mapping: { from: "webhook", fields: ["amount", "currency", "customer_id", "invoice_id"] }, output_mapping: { payment: "step1.payment" }, error_hint: "Ensure Stripe webhook endpoint is configured for payment_intent.succeeded" },
      { order: 2, service_id: "quickbooks", action: "Create sales receipt or invoice payment in QuickBooks", input_mapping: { amount: "step1.payment.amount", customer: "step1.payment.customer_id", reference: "step1.payment.invoice_id" }, output_mapping: { qb_entry_id: "step2.entry_id" }, error_hint: "Customer must exist in QuickBooks. Map Stripe customer ID to QBO customer" },
      { order: 3, service_id: "slack", action: "Notify finance channel of recorded payment", input_mapping: { channel: "config.finance_channel", message: "Payment ${{amount}} recorded in QuickBooks (ref: {{invoice_id}})" }, output_mapping: { message_id: "step3.message_id" }, error_hint: "Verify bot has access to finance channel" }
    ],
    required_services: ["stripe-global", "quickbooks", "slack"]
  },
  {
    id: "shopify-klaviyo-segment-ecommerce",
    goal: "Ecommerce analytics and marketing automation pipeline",
    description: "Shopify order events flow through Segment CDP to Klaviyo for targeted email campaigns and customer segmentation.",
    steps: [
      { order: 1, service_id: "shopify-global", action: "Capture order events (created, fulfilled, refunded) via webhook", input_mapping: { from: "webhook", fields: ["order_id", "customer_email", "items", "total", "status"] }, output_mapping: { order: "step1.order" }, error_hint: "Configure Shopify webhook for orders/create and orders/fulfilled" },
      { order: 2, service_id: "segment", action: "Track order event with customer properties to Segment CDP", input_mapping: { event: "Order Completed", user_id: "step1.order.customer_email", properties: "step1.order" }, output_mapping: { segment_msg_id: "step2.message_id" }, error_hint: "Ensure Segment source is configured for server-side tracking" },
      { order: 3, service_id: "klaviyo", action: "Trigger post-purchase email flow based on order data", input_mapping: { email: "step1.order.customer_email", event: "Placed Order", properties: "step1.order" }, output_mapping: { flow_id: "step3.flow_id" }, error_hint: "Klaviyo flow must be active for Placed Order metric" }
    ],
    required_services: ["shopify-global", "segment", "klaviyo"]
  },
  {
    id: "hubspot-calendly-gmail-sales",
    goal: "Sales meeting booking and follow-up automation",
    description: "Calendly meeting booked creates HubSpot deal, Gmail sends pre-meeting prep email with prospect context.",
    steps: [
      { order: 1, service_id: "calendly", action: "Capture meeting scheduled event with attendee details", input_mapping: { from: "webhook", fields: ["invitee_email", "event_type", "scheduled_time", "meeting_url"] }, output_mapping: { meeting: "step1.meeting" }, error_hint: "Calendly webhook must be subscribed to invitee.created events" },
      { order: 2, service_id: "hubspot-jp", action: "Create or update deal in HubSpot with meeting details", input_mapping: { contact_email: "step1.meeting.invitee_email", deal_name: "Meeting: {{event_type}}", properties: "step1.meeting" }, output_mapping: { deal_id: "step2.deal_id" }, error_hint: "Check if contact already exists in HubSpot before creating" },
      { order: 3, service_id: "google-workspace", action: "Send pre-meeting prep email to sales rep with prospect context", input_mapping: { to: "config.sales_rep_email", subject: "Prep for {{invitee_email}} meeting", body: "Meeting at {{scheduled_time}}. Deal: {{deal_id}}" }, output_mapping: { email_id: "step3.email_id" }, error_hint: "Ensure Gmail API send scope is authorized" }
    ],
    required_services: ["calendly", "hubspot-jp", "google-workspace"]
  },
  {
    id: "figma-github-vercel-design-deploy",
    goal: "Design handoff to production deployment pipeline",
    description: "Figma design updates trigger GitHub issue for implementation, Vercel deploys preview for design review.",
    steps: [
      { order: 1, service_id: "figma", action: "Detect design file version update and extract component changes", input_mapping: { from: "webhook", fields: ["file_key", "file_name", "timestamp", "description"] }, output_mapping: { design_update: "step1.design_update" }, error_hint: "Figma webhook must be registered via Figma REST API" },
      { order: 2, service_id: "github", action: "Create GitHub issue with design change details and Figma link", input_mapping: { repo: "config.frontend_repo", title: "Design update: {{file_name}}", body: "Figma: {{file_key}} — {{description}}" }, output_mapping: { issue_url: "step2.issue_url" }, error_hint: "GitHub token needs repo:write permission" },
      { order: 3, service_id: "vercel", action: "Trigger preview deployment for the design branch", input_mapping: { project: "config.vercel_project", ref: "step2.branch_name" }, output_mapping: { preview_url: "step3.preview_url" }, error_hint: "Vercel project must be connected to the GitHub repo" }
    ],
    required_services: ["figma", "github", "vercel"]
  },
  {
    id: "salesforce-docusign-quickbooks-b2b-contract",
    goal: "B2B contract flow: deal close to signature to invoicing",
    description: "Salesforce deal closure triggers DocuSign contract, signed contract auto-creates QuickBooks invoice.",
    steps: [
      { order: 1, service_id: "salesforce-jp", action: "Detect opportunity stage change to Closed Won", input_mapping: { from: "webhook", fields: ["opportunity_id", "amount", "account_name", "contact_email"] }, output_mapping: { deal: "step1.deal" }, error_hint: "Configure Salesforce outbound message for Opportunity stage change" },
      { order: 2, service_id: "docusign-jp", action: "Send contract envelope for e-signature to customer", input_mapping: { signer_email: "step1.deal.contact_email", template_id: "config.contract_template", custom_fields: "step1.deal" }, output_mapping: { envelope_id: "step2.envelope_id" }, error_hint: "DocuSign template must have merge fields matching Salesforce data" },
      { order: 3, service_id: "quickbooks", action: "Create invoice upon contract signature completion", input_mapping: { customer: "step1.deal.account_name", amount: "step1.deal.amount", reference: "step2.envelope_id" }, output_mapping: { invoice_id: "step3.invoice_id" }, error_hint: "Customer name must match between Salesforce and QuickBooks" }
    ],
    required_services: ["salesforce-jp", "docusign-jp", "quickbooks"]
  },
  {
    id: "zendesk-slack-linear-support-to-bug",
    goal: "Customer support escalation to engineering bug tracking",
    description: "Zendesk ticket tagged as bug automatically creates Linear issue and notifies engineering via Slack.",
    steps: [
      { order: 1, service_id: "zendesk", action: "Detect ticket tagged with 'bug' or priority escalation", input_mapping: { from: "webhook", fields: ["ticket_id", "subject", "description", "priority", "requester"] }, output_mapping: { ticket: "step1.ticket" }, error_hint: "Zendesk trigger must fire on tag addition or priority change" },
      { order: 2, service_id: "linear", action: "Create bug issue in engineering team with ticket context", input_mapping: { team: "config.eng_team_id", title: "Bug: {{subject}}", description: "From Zendesk #{{ticket_id}}: {{description}}", priority: "step1.ticket.priority" }, output_mapping: { issue_id: "step2.issue_id", issue_url: "step2.issue_url" }, error_hint: "Linear API key must have issue create permission" },
      { order: 3, service_id: "slack", action: "Alert engineering channel with bug details and Linear link", input_mapping: { channel: "config.eng_channel", message: "Bug from support: {{subject}} — {{issue_url}}" }, output_mapping: { message_id: "step3.message_id" }, error_hint: "Bot must be in engineering channel" }
    ],
    required_services: ["zendesk", "linear", "slack"]
  },
  {
    id: "google-drive-slack-notion-doc-sharing",
    goal: "Document sharing and knowledge base sync",
    description: "New Google Drive files in shared folder are indexed in Notion wiki and team is notified via Slack.",
    steps: [
      { order: 1, service_id: "google-drive", action: "Watch shared folder for new file uploads", input_mapping: { from: "webhook", fields: ["file_id", "file_name", "mime_type", "created_by", "web_link"] }, output_mapping: { file: "step1.file" }, error_hint: "Google Drive push notification channel must be set up" },
      { order: 2, service_id: "notion", action: "Add entry to knowledge base database with file link and metadata", input_mapping: { database_id: "config.wiki_db_id", title: "step1.file.file_name", url: "step1.file.web_link", author: "step1.file.created_by" }, output_mapping: { page_id: "step2.page_id" }, error_hint: "Notion integration must have access to the target database" },
      { order: 3, service_id: "slack", action: "Notify team channel about new document", input_mapping: { channel: "config.team_channel", message: "New doc: {{file_name}} by {{created_by}} — added to wiki" }, output_mapping: { message_id: "step3.message_id" }, error_hint: "Verify Slack bot token has chat:write scope" }
    ],
    required_services: ["google-drive", "notion", "slack"]
  },
  {
    id: "stripe-mercury-brex-startup-finance",
    goal: "Startup financial operations: payments, banking, and expense tracking",
    description: "Stripe revenue flows to Mercury banking, Brex expense data synced for unified financial visibility.",
    steps: [
      { order: 1, service_id: "stripe-global", action: "Aggregate daily payment summary (revenue, fees, net)", input_mapping: { from: "scheduled", fields: ["date", "gross_revenue", "fees", "net_revenue", "transaction_count"] }, output_mapping: { daily_summary: "step1.summary" }, error_hint: "Use Stripe Balance Transactions API with date filter" },
      { order: 2, service_id: "mercury", action: "Verify Stripe payout received in Mercury checking account", input_mapping: { account_id: "config.mercury_checking", expected_amount: "step1.summary.net_revenue" }, output_mapping: { balance: "step2.balance", matched: "step2.matched" }, error_hint: "Mercury API may have delay in reflecting pending transactions" },
      { order: 3, service_id: "brex", action: "Pull daily card spend and categorize against budget", input_mapping: { date: "step1.summary.date" }, output_mapping: { daily_spend: "step3.spend", budget_remaining: "step3.budget_remaining" }, error_hint: "Brex API pagination may be needed for high transaction volume" }
    ],
    required_services: ["stripe-global", "mercury", "brex"]
  },
  {
    id: "mixpanel-amplitude-segment-product-analytics",
    goal: "Unified product analytics pipeline",
    description: "Segment collects events and routes to both Mixpanel and Amplitude for cross-platform product analysis.",
    steps: [
      { order: 1, service_id: "segment", action: "Collect and normalize user events from web and mobile", input_mapping: { from: "sdk", fields: ["event_name", "user_id", "properties", "timestamp", "platform"] }, output_mapping: { event: "step1.event" }, error_hint: "Segment source must be configured for each platform (web, iOS, Android)" },
      { order: 2, service_id: "mixpanel", action: "Route event to Mixpanel for funnel and retention analysis", input_mapping: { event: "step1.event.event_name", distinct_id: "step1.event.user_id", properties: "step1.event.properties" }, output_mapping: { mixpanel_status: "step2.status" }, error_hint: "Segment destination for Mixpanel must be enabled and mapped" },
      { order: 3, service_id: "amplitude", action: "Route event to Amplitude for behavioral cohort analysis", input_mapping: { event_type: "step1.event.event_name", user_id: "step1.event.user_id", event_properties: "step1.event.properties" }, output_mapping: { amplitude_status: "step3.status" }, error_hint: "Segment destination for Amplitude must be enabled" }
    ],
    required_services: ["segment", "mixpanel", "amplitude"]
  },
  {
    id: "brave-search-anthropic-notion-research",
    goal: "AI-powered research automation with knowledge capture",
    description: "Brave Search retrieves web data, Anthropic Claude analyzes and summarizes, results stored in Notion research database.",
    steps: [
      { order: 1, service_id: "brave-search", action: "Search web for topic and retrieve top results with snippets", input_mapping: { query: "user_input.research_topic", count: 10 }, output_mapping: { results: "step1.results" }, error_hint: "Brave Search API key required. Rate limit: 1 req/sec on free tier" },
      { order: 2, service_id: "anthropic-api", action: "Analyze search results and generate structured research summary", input_mapping: { model: "claude-sonnet-4-5-20250514", prompt: "Analyze these search results about {{research_topic}} and provide key findings", context: "step1.results" }, output_mapping: { summary: "step2.summary", key_findings: "step2.findings" }, error_hint: "Keep token usage within API limits" },
      { order: 3, service_id: "notion", action: "Create research entry in knowledge base with summary and sources", input_mapping: { database_id: "config.research_db", title: "Research: {{research_topic}}", content: "step2.summary", sources: "step1.results" }, output_mapping: { page_url: "step3.page_url" }, error_hint: "Notion page content blocks have 2000 character limit per block" }
    ],
    required_services: ["brave-search", "anthropic-api", "notion"]
  },
  {
    id: "posthog-slack-linear-feature-flag-incident",
    goal: "Feature flag monitoring with automated incident response",
    description: "PostHog detects error spike after feature flag rollout, alerts Slack, auto-creates Linear incident ticket.",
    steps: [
      { order: 1, service_id: "posthog", action: "Monitor error rate for feature flag cohort and detect anomaly", input_mapping: { from: "webhook", fields: ["feature_flag", "error_rate", "baseline_rate", "affected_users"] }, output_mapping: { alert: "step1.alert" }, error_hint: "PostHog action webhook must be configured for error rate threshold" },
      { order: 2, service_id: "slack", action: "Send urgent alert to engineering channel with rollback recommendation", input_mapping: { channel: "config.incidents_channel", message: "Feature flag {{feature_flag}} error spike: {{error_rate}}% vs {{baseline_rate}}% baseline. {{affected_users}} users affected." }, output_mapping: { alert_ts: "step2.message_ts" }, error_hint: "Use Slack blocks for rich formatting of incident data" },
      { order: 3, service_id: "linear", action: "Create urgent incident issue with feature flag context", input_mapping: { team: "config.eng_team_id", title: "Incident: {{feature_flag}} error spike", priority: 1, labels: ["incident", "feature-flag"] }, output_mapping: { incident_url: "step3.issue_url" }, error_hint: "Ensure 'incident' label exists in Linear team" }
    ],
    required_services: ["posthog", "slack", "linear"]
  }
];

// ─── Merge and write ───
const servicesPath = resolve(dataDir, "services-seed.json");
const recipesPath = resolve(dataDir, "recipes-seed.json");

const existingServices = JSON.parse(readFileSync(servicesPath, "utf-8"));
const existingRecipes = JSON.parse(readFileSync(recipesPath, "utf-8"));

const existingIds = new Set(existingServices.map(s => s.id));
let added = 0;
let skipped = 0;

for (const s of newServices) {
  if (existingIds.has(s.id)) {
    console.log(`  SKIP (duplicate): ${s.id}`);
    skipped++;
  } else {
    existingServices.push(s);
    existingIds.add(s.id);
    added++;
    console.log(`  ADD: ${s.id} — ${s.name}`);
  }
}

const existingRecipeIds = new Set(existingRecipes.map(r => r.id));
let recipesAdded = 0;

for (const r of newRecipes) {
  if (existingRecipeIds.has(r.id)) {
    console.log(`  SKIP recipe: ${r.id}`);
  } else {
    existingRecipes.push(r);
    recipesAdded++;
    console.log(`  ADD recipe: ${r.id}`);
  }
}

writeFileSync(servicesPath, JSON.stringify(existingServices, null, 2) + "\n");
writeFileSync(recipesPath, JSON.stringify(existingRecipes, null, 2) + "\n");

console.log(`\nDone: ${added} services added, ${skipped} skipped, ${recipesAdded} recipes added`);
console.log(`Total: ${existingServices.length} services, ${existingRecipes.length} recipes`);
