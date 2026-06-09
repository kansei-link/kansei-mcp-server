# Show HN Draft

## Title
Show HN: KanseiLink – Local-first MCP navigator for AI agents (11K services, 80% fewer tokens, MIT)

## URL
https://github.com/kansei-link/kansei-mcp-server

## Body (text post)

I built a local-first intelligence layer that helps AI agents find, evaluate, and compose MCP tools without trial-and-error.

**Problem:** When Claude/GPT/Gemini agents try to connect SaaS services via MCP, they waste thousands of tokens on web searches, failed auth flows, deprecated endpoints, and undocumented quirks. There's no aggregated source of "does this actually work with an agent?"

**KanseiLink** ships a local SQLite DB (zero API calls needed) with:

- 11,000+ MCP/SaaS services with trust scores from real agent testing
- 200 workflow recipes (multi-service compositions like "PR merged → Slack notify → update project board")
- 199 API connection guides with auth pitfalls, rate limits, and workarounds

One command:

    npx @kansei-link/mcp-server

Token savings measured at 89-97% across 7 services (freee, Slack, Notion, kintone, GitHub, Stripe, Backlog) vs the typical web_fetch + trial-and-error pattern. Average: ~16,800 tokens without → ~950 tokens with KanseiLink.

**How it works:**

1. `search_services({ intent: "send invoice" })` → finds the right MCP server + auth method
2. `lookup({ service_id: "freee" })` → pre-digested tips: auth flow, known pitfalls, workarounds
3. Your agent executes correctly on the first try
4. `report({ success: true })` → feeds back into trust scores (optional, anonymized)

**Architecture:**
- Local SQLite, no server dependency
- 5 unified tools (search, lookup, report, inspect, analyze)
- FTS5 + trigram search for CJK languages
- Privacy-preserving: PII auto-masked, agent identity anonymized
- PostToolUse hook for zero-friction outcome reporting

**What it is NOT:**
- Not another MCP registry (those list servers; this evaluates them with real usage data)
- Not an API gateway (your agent still calls services directly)
- Not locked to one LLM provider (works with Claude, GPT, Gemini, any MCP client)

MIT licensed. Feedback and contributions welcome.

GitHub: https://github.com/kansei-link/kansei-mcp-server
npm: https://www.npmjs.com/package/@kansei-link/mcp-server
Site: https://kansei-link.com

---

## Maker Comment (post within 5 minutes of submission)

Hey HN, maker here. Some context on why I built this:

I've been building AI agent workflows for Japanese SaaS (accounting, HR, project management) and kept hitting the same wall: every time an agent tries a new MCP server, it burns 10-25K tokens just figuring out auth, reading docs, and recovering from errors. Multiply by 10+ services per workflow, and you're spending more tokens on discovery than on actual work.

So I started collecting "what actually works" into a structured DB. That grew into KanseiLink.

**Tech stack:**
- TypeScript + better-sqlite3
- MCP SDK (stdio transport, works with Claude Code, Cursor, Cline, etc.)
- SQLite with FTS5 for bilingual search (English + Japanese)
- Weekly automated health probes against 5,000 MCP endpoints
- Registry diff to detect new/changed/removed servers

**Honest limitations:**
- Trust scores are bootstrapped from automated testing + manual verification, not millions of user reports (yet)
- Japanese SaaS coverage is deeper than global (that's where I started)
- The "80% fewer tokens" claim assumes you'd otherwise be doing web_fetch + trial-and-error. If you already know the API perfectly, savings are smaller.
- No GUI yet — it's a CLI/MCP tool, so it's agent-first

**Where it's going:**
- Cross-model telemetry (aggregate success/failure data across Claude, GPT, Gemini)
- Community-contributed workarounds
- Early warning system ("Stripe's OAuth broke for 40% of agents today")

Happy to answer questions about the architecture, methodology, or Japanese SaaS ecosystem.

---

## Quick Responses to Anticipated HN Comments

**"This is just a list, I can Google this"**
→ "Google gives you docs pages that cost 15-25K tokens to parse. KanseiLink gives you the same info pre-digested in 800 tokens, with pitfalls and workarounds from actual agent failures. The value isn't the list — it's the evaluated, agent-optimized format."

**"How are trust scores calculated without users?"**
→ "Automated health probes (5K endpoints weekly) + fleet testing with real MCP handshakes + manual verification for top-tier services. User telemetry will layer on top once we have opt-in volume."

**"Why not just contribute this to the official MCP registry?"**
→ "The registry lists servers. We evaluate them. Different jobs. The registry says 'this server exists.' We say 'this server works 88% of the time, auth breaks on refresh tokens, here's the workaround.' Complementary, not competing."

**"Will this work with X?"**
→ "Any MCP client: Claude Code, Cursor, Cline, Zed, custom SDK implementations. It's a standard MCP server — just add it to your config."

**"Japanese-focused? I don't need Japanese SaaS."**
→ "11K services total, ~2K are Japan-specific. The rest are global (Slack, Stripe, GitHub, Notion, etc.). Started in Japan because that's where I hit the pain first, but the architecture is language-agnostic."
