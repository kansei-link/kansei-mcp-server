# X Announcement Draft — KanseiLink v1.0.0

## Thread (3 tweets)

### Tweet 1 (Main)
KanseiLink v1.0.0 shipped.

25 MCP tools → 5.

Before: agents saw 25 tools and got confused.
After: 3 tools for every agent, 2 for admins.

Mode auto-detection means lookup({ service_id: "freee" }) just works — no need to remember get_service_tips vs get_service_detail vs get_insights.

npm i @kansei-link/mcp-server

### Tweet 2 (Technical detail)
The 5 tools:

search_services — find services by intent
lookup — 8 modes (tips/detail/insights/recipe/history/combinations/feedback/voices)
report — 4 modes (outcome/feedback/event/voice)
inspect — colony health (8 modes)
analyze — analytics (4 modes)

24 mode combinations, 1 clean surface.

Every mode auto-detects from params. Pass success=true → outcome report. Pass goal="onboard employee" → recipe lookup.

### Tweet 3 (Why it matters)
Why this matters for MCP ecosystem:

Too many tools = LLM tool selection degrades.

Cursor, Claude Code, Codex — they all struggle when an MCP server dumps 20+ tools. The agent wastes tokens reasoning about which tool to call.

5 tools with mode detection > 25 individual tools.

Docs: [link]
GitHub: github.com/kansei-link/kansei-mcp-server

---

## Alt: Single tweet version

KanseiLink v1.0.0: 25 MCP tools → 5.

Mode auto-detection — lookup({ service_id }) gives you tips, add detail: true for full guide, insights: true for analytics. One tool, 8 modes.

Why: too many tools = LLM confusion in Cursor/Claude Code/Codex.

npx @kansei-link/mcp-server
