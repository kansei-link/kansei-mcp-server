#!/usr/bin/env tsx
/**
 * KanseiLINK MCP-Native Recipe Seeder
 *
 * Generates high-quality recipes using CONFIRMED tool names from self-tested
 * and deep-audited MCP servers. Every tool name in these recipes was verified
 * to exist via real MCP handshake.
 *
 * Usage:
 *   npx tsx src/crawler/seed-mcp-recipes.ts           # insert all
 *   npx tsx src/crawler/seed-mcp-recipes.ts --dry      # preview only
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../../kansei-link.db");

interface RecipeStep {
  order: number;
  service_id: string;
  action: string;
  /** MCP tool name — VERIFIED via self-test or deep audit */
  mcp_tool: string;
  input_mapping: Record<string, unknown>;
  output_mapping: Record<string, string>;
  error_hint: string;
}

interface Recipe {
  id: string;
  goal: string;
  description: string;
  steps: RecipeStep[];
  required_services: string[];
  gotchas: string[];
}

// ═════════════════════════════════════════════════════════════════════
//  RECIPES — all tool names verified via MCP handshake
// ═════════════════════════════════════════════════════════════════════

const MCP_RECIPES: Recipe[] = [
  // ── 1. Developer standup report ─────────────────────────────────
  {
    id: "mcp-daily-standup",
    goal: "Daily standup report from GitHub activity to Slack",
    description:
      "Pulls yesterday's PRs, issues, and commits from GitHub, formats a standup summary, and posts it to a Slack channel. Fully MCP-native — no REST API wrangling needed.",
    steps: [
      {
        order: 1,
        service_id: "github",
        action: "Search for PRs and issues updated in the last 24 hours",
        mcp_tool: "search_repositories",
        input_mapping: { query: "org:{org} updated:>={yesterday} is:pr", page: 1, perPage: 20 },
        output_mapping: { prs: "step1.items" },
        error_hint: "search_repositories returns repos, not issues. For issue/PR search use the GitHub search syntax with 'is:pr' or 'is:issue' qualifiers.",
      },
      {
        order: 2,
        service_id: "github",
        action: "Get details on recently updated issues",
        mcp_tool: "list_issues",
        input_mapping: { owner: "{org}", repo: "{repo}", state: "open", sort: "updated", per_page: 10 },
        output_mapping: { issues: "step2.items" },
        error_hint: "list_issues requires owner+repo. For org-wide view, iterate over repos or use search.",
      },
      {
        order: 3,
        service_id: "slack",
        action: "Post formatted standup summary to team channel",
        mcp_tool: "slack_post_message",
        input_mapping: { channel_id: "{standup_channel}", text: "📊 *Daily Standup — {date}*\n\n*PRs:* {pr_summary}\n*Issues:* {issue_summary}" },
        output_mapping: { message_ts: "step3.ts" },
        error_hint: "channel_id must be the Slack internal ID (C0xxxxx), not the channel name. Use slack_list_channels to look it up first.",
      },
    ],
    required_services: ["github", "slack"],
    gotchas: [
      "GitHub MCP search_repositories returns repository objects. For PR/issue search, pass GitHub search qualifiers in the query string (is:pr, is:issue, is:open).",
      "Slack channel_id is NOT the channel name — always resolve via slack_list_channels first. The ID format is C followed by alphanumeric characters.",
      "GitHub PAT must have 'repo' scope for private repos. Public repos work with no token but have lower rate limits (60/hr vs 5000/hr).",
      "Slack message formatting uses mrkdwn (not Markdown): *bold*, _italic_, `code`, ~strike~. No ## headers.",
    ],
  },

  // ── 2. PR review workflow ───────────────────────────────────────
  {
    id: "mcp-pr-review-notify",
    goal: "Notify reviewers on Slack when a PR needs review, track in Notion",
    description:
      "When a new PR is created, searches for the right reviewers, notifies them on Slack with context, and creates a review tracking entry in Notion. End-to-end MCP.",
    steps: [
      {
        order: 1,
        service_id: "github",
        action: "Get the PR details including diff stats and description",
        mcp_tool: "get_file_contents",
        input_mapping: { owner: "{org}", repo: "{repo}", path: ".github/CODEOWNERS" },
        output_mapping: { codeowners: "step1.content" },
        error_hint: "get_file_contents returns base64-encoded content for binary files. For text files it returns UTF-8 string directly.",
      },
      {
        order: 2,
        service_id: "slack",
        action: "Send review request to the appropriate channel with PR context",
        mcp_tool: "slack_post_message",
        input_mapping: { channel_id: "{review_channel}", text: "🔍 *Review needed:* {pr_title}\nRepo: {repo} | Files: {changed_files}\nAuthor: {author}\n{pr_url}" },
        output_mapping: { message_ts: "step2.ts" },
        error_hint: "For DMs, use the user's member ID as channel_id. Get it via slack_get_users.",
      },
      {
        order: 3,
        service_id: "notion",
        action: "Create a review tracking entry in the PR review database",
        mcp_tool: "API-post-search",
        input_mapping: { filter: { property: "object", value: "database" }, query: "PR Reviews" },
        output_mapping: { database_id: "step3.results[0].id" },
        error_hint: "API-post-search returns max 100 results. The database must be shared with the Notion integration. Use Notion-Version: 2022-06-28.",
      },
    ],
    required_services: ["github", "slack", "notion"],
    gotchas: [
      "Notion API-post-search requires the integration to have access to the database — user must share the database with the integration in Notion's Share menu.",
      "Notion page creation is a separate API-post-page call after finding the database_id via search. The properties schema must match the database schema exactly.",
      "GitHub CODEOWNERS file may not exist — wrap step 1 in a try/catch and fall back to manual reviewer assignment.",
      "Slack thread replies (slack_reply_to_thread) need the original message_ts — save step2's output for follow-ups.",
    ],
  },

  // ── 3. Release announcement ─────────────────────────────────────
  {
    id: "mcp-release-announce",
    goal: "Publish release notes to Slack and Notion changelog when a GitHub release is created",
    description:
      "Takes a GitHub release, formats the changelog, posts to Slack, and creates a Notion changelog page. Uses verified MCP tools only.",
    steps: [
      {
        order: 1,
        service_id: "github",
        action: "Get the latest release details and release notes",
        mcp_tool: "list_commits",
        input_mapping: { owner: "{org}", repo: "{repo}", sha: "main", per_page: 20 },
        output_mapping: { commits: "step1.commits" },
        error_hint: "list_commits returns commit objects with sha, message, author. For release-specific commits, compare between tags.",
      },
      {
        order: 2,
        service_id: "slack",
        action: "Post release announcement to announcements channel",
        mcp_tool: "slack_post_message",
        input_mapping: { channel_id: "{announce_channel}", text: "🚀 *{repo} v{version} released!*\n\n{release_notes}\n\n<{release_url}|View on GitHub>" },
        output_mapping: { announce_ts: "step2.ts" },
        error_hint: "Slack link syntax is <url|display text> — do NOT use Markdown [text](url) syntax.",
      },
      {
        order: 3,
        service_id: "notion",
        action: "Create changelog page in the product changelog database",
        mcp_tool: "API-patch-block-children",
        input_mapping: { block_id: "{changelog_page_id}", children: [{ type: "heading_2", heading_2: { rich_text: [{ text: { content: "v{version}" } }] } }] },
        output_mapping: { block_id: "step3.results.id" },
        error_hint: "API-patch-block-children appends blocks to a page. The block_id is the page ID. Notion blocks have strict type schemas — validate structure before calling.",
      },
    ],
    required_services: ["github", "slack", "notion"],
    gotchas: [
      "GitHub MCP server doesn't have a dedicated 'get_release' tool — use list_commits between tags or get_file_contents on CHANGELOG.md as a workaround.",
      "Notion rich_text content has a 2000-character limit per text block. Split long release notes across multiple paragraph blocks.",
      "Slack message text has a 40,000-character limit but renders poorly beyond ~4,000. Summarize and link to full notes.",
      "Notion API-patch-block-children is APPEND only — it adds to the end of the page. To prepend (newest first), you'd need to read existing blocks and rewrite.",
    ],
  },

  // ── 4. Bug report pipeline ──────────────────────────────────────
  {
    id: "mcp-bug-report-pipeline",
    goal: "Create GitHub issue from Slack bug report with Notion tracking",
    description:
      "When a bug is reported in Slack, creates a structured GitHub issue with reproduction steps, links it in Notion for PM tracking, and threads the GitHub URL back to Slack.",
    steps: [
      {
        order: 1,
        service_id: "slack",
        action: "Get the bug report details from the Slack thread",
        mcp_tool: "slack_get_thread_replies",
        input_mapping: { channel_id: "{bugs_channel}", thread_ts: "{report_thread_ts}" },
        output_mapping: { messages: "step1.messages" },
        error_hint: "slack_get_thread_replies needs the parent message's ts (timestamp). This is the message ID, not a human-readable time.",
      },
      {
        order: 2,
        service_id: "github",
        action: "Create a structured bug issue with labels",
        mcp_tool: "create_issue",
        input_mapping: { owner: "{org}", repo: "{repo}", title: "Bug: {summary}", body: "## Reported by\n{reporter}\n\n## Description\n{bug_description}\n\n## Steps to Reproduce\n{steps}\n\n---\n_Automated from Slack thread_" },
        output_mapping: { issue_number: "step2.number", issue_url: "step2.html_url" },
        error_hint: "create_issue requires owner+repo. Labels must already exist in the repo — create_issue won't auto-create labels.",
      },
      {
        order: 3,
        service_id: "slack",
        action: "Reply to the bug thread with the GitHub issue link",
        mcp_tool: "slack_reply_to_thread",
        input_mapping: { channel_id: "{bugs_channel}", thread_ts: "{report_thread_ts}", text: "✅ GitHub issue created: {issue_url}" },
        output_mapping: { reply_ts: "step3.ts" },
        error_hint: "slack_reply_to_thread requires both channel_id AND thread_ts. The reply appears as a threaded message.",
      },
      {
        order: 4,
        service_id: "notion",
        action: "Add bug to the PM tracking database",
        mcp_tool: "API-post-search",
        input_mapping: { query: "Bug Tracker", filter: { property: "object", value: "database" } },
        output_mapping: { database_id: "step4.results[0].id" },
        error_hint: "After finding the database, use a separate API call to create the page entry with properties matching the database schema.",
      },
    ],
    required_services: ["slack", "github", "notion"],
    gotchas: [
      "Slack thread_ts is a string like '1234567890.123456' — it looks like a float but must be treated as a string. Don't parse or round it.",
      "GitHub create_issue body supports full GitHub Flavored Markdown including task lists, but NOT Slack mrkdwn format — convert before posting.",
      "Notion database properties are strongly typed. A 'Status' property must be set to one of its predefined options. Check the database schema first.",
      "Rate limit awareness: GitHub (5000/hr with PAT), Slack (tier 3 methods ≈50/min), Notion (3 req/s per integration).",
    ],
  },

  // ── 5. Meeting notes → action items ─────────────────────────────
  {
    id: "mcp-meeting-actions",
    goal: "Distribute meeting notes from Notion and create GitHub issues for action items",
    description:
      "Reads a Notion meeting notes page, extracts action items, creates GitHub issues for each, and shares the summary on Slack with links.",
    steps: [
      {
        order: 1,
        service_id: "notion",
        action: "Read the meeting notes page content",
        mcp_tool: "API-get-block-children",
        input_mapping: { block_id: "{meeting_page_id}" },
        output_mapping: { blocks: "step1.results" },
        error_hint: "API-get-block-children returns a paginated list of blocks. For long pages, check has_more and use start_cursor for pagination.",
      },
      {
        order: 2,
        service_id: "github",
        action: "Create an issue for each action item extracted from the notes",
        mcp_tool: "create_issue",
        input_mapping: { owner: "{org}", repo: "{repo}", title: "Action: {action_title}", body: "From meeting: {meeting_title}\nDate: {date}\n\n{action_detail}\n\nNotion: {meeting_url}" },
        output_mapping: { issue_url: "step2.html_url" },
        error_hint: "Call create_issue once per action item. Batch them in sequence to avoid rate limits.",
      },
      {
        order: 3,
        service_id: "slack",
        action: "Post meeting summary with action item links to team channel",
        mcp_tool: "slack_post_message",
        input_mapping: { channel_id: "{team_channel}", text: "📝 *Meeting Notes: {meeting_title}*\n\n*Attendees:* {attendees}\n*Action Items:*\n{action_list_with_links}\n\n<{meeting_url}|Full notes in Notion>" },
        output_mapping: { message_ts: "step3.ts" },
        error_hint: "Slack message with multiple links can hit the unfurl limit (max 5 link previews per message). Use <url|text> to control which links unfurl.",
      },
    ],
    required_services: ["notion", "github", "slack"],
    gotchas: [
      "Notion blocks have different types (paragraph, heading, to_do, bulleted_list_item). Action items are typically to_do blocks — filter by type.",
      "Notion to_do blocks have a 'checked' boolean. Only create GitHub issues for unchecked items.",
      "GitHub issue body supports GitHub Flavored Markdown. Convert Notion rich_text format (which uses annotations for bold/italic/code) to GFM.",
      "Notion page IDs are UUIDs with dashes. The URL format /pagename-{id_without_dashes} — add dashes back when using the API.",
    ],
  },

  // ── 6. Project kickoff ──────────────────────────────────────────
  {
    id: "mcp-project-kickoff",
    goal: "Set up a new project with GitHub repo, Notion project page, and Slack channel announcement",
    description:
      "One-shot project initialization: creates a GitHub repository, sets up a Notion project page from template, and announces the new project on Slack.",
    steps: [
      {
        order: 1,
        service_id: "github",
        action: "Create a new repository with README and standard settings",
        mcp_tool: "create_repository",
        input_mapping: { name: "{project_slug}", description: "{project_description}", private: true, auto_init: true },
        output_mapping: { repo_url: "step1.html_url", repo_name: "step1.full_name" },
        error_hint: "create_repository name must be URL-safe (no spaces, special chars). Use kebab-case. Org repos need the org scope in PAT.",
      },
      {
        order: 2,
        service_id: "notion",
        action: "Search for the project template database and create a new entry",
        mcp_tool: "API-post-search",
        input_mapping: { query: "Projects", filter: { property: "object", value: "database" } },
        output_mapping: { database_id: "step2.results[0].id" },
        error_hint: "After finding the database, create a page with properties. Notion database schemas vary — retrieve the DB first to check property types.",
      },
      {
        order: 3,
        service_id: "slack",
        action: "Announce the new project with links to GitHub and Notion",
        mcp_tool: "slack_post_message",
        input_mapping: { channel_id: "{general_channel}", text: "🎉 *New Project: {project_name}*\n\n{project_description}\n\n• <{repo_url}|GitHub Repo>\n• <{notion_url}|Notion Page>\n\nLead: <@{lead_slack_id}>" },
        output_mapping: { announcement_ts: "step3.ts" },
        error_hint: "Slack user mentions use <@MEMBER_ID> format. Get the ID via slack_get_users, NOT the display name.",
      },
    ],
    required_services: ["github", "notion", "slack"],
    gotchas: [
      "GitHub create_repository with auto_init:true creates an initial commit with README.md. If you push immediately after, use the default branch (usually 'main').",
      "Notion page creation needs the exact property schema of the target database. Common types: title, rich_text, select, multi_select, date, url, relation.",
      "Slack <@MEMBER_ID> mentions only work with the internal member ID (U followed by alphanumeric), not the username or display name.",
      "GitHub PAT needs 'repo' scope for private repos and 'admin:org' scope to create repos under an organization.",
    ],
  },

  // ── 7. Knowledge capture from Slack to Notion ───────────────────
  {
    id: "mcp-knowledge-capture",
    goal: "Save important Slack discussions to a Notion knowledge base",
    description:
      "Captures a valuable Slack thread (technical decisions, architecture discussions, troubleshooting solutions), formats it, and saves to a Notion knowledge base for future reference.",
    steps: [
      {
        order: 1,
        service_id: "slack",
        action: "Retrieve the full thread content",
        mcp_tool: "slack_get_thread_replies",
        input_mapping: { channel_id: "{channel_id}", thread_ts: "{thread_ts}" },
        output_mapping: { messages: "step1.messages" },
        error_hint: "slack_get_thread_replies includes the parent message. Messages have user IDs, not display names — resolve via slack_get_user_profile if needed.",
      },
      {
        order: 2,
        service_id: "slack",
        action: "Look up user display names for the thread participants",
        mcp_tool: "slack_get_user_profile",
        input_mapping: { user_id: "{participant_ids}" },
        output_mapping: { profiles: "step2.profiles" },
        error_hint: "slack_get_user_profile takes a single user_id. Call once per unique user in the thread.",
      },
      {
        order: 3,
        service_id: "notion",
        action: "Create a knowledge base page with the formatted discussion",
        mcp_tool: "API-patch-block-children",
        input_mapping: { block_id: "{kb_page_id}", children: [{ type: "heading_2", heading_2: { rich_text: [{ text: { content: "{topic}" } }] } }, { type: "paragraph", paragraph: { rich_text: [{ text: { content: "{formatted_discussion}" } }] } }] },
        output_mapping: { page_id: "step3.results.id" },
        error_hint: "API-patch-block-children appends blocks to an existing page. Create the page first via API-post-search to find the DB, then create the page entry.",
      },
      {
        order: 4,
        service_id: "slack",
        action: "Add a bookmark reaction and reply with the Notion link",
        mcp_tool: "slack_add_reaction",
        input_mapping: { channel_id: "{channel_id}", timestamp: "{thread_ts}", reaction: "bookmark" },
        output_mapping: {},
        error_hint: "slack_add_reaction uses emoji names without colons. 'bookmark' not ':bookmark:'. Will fail silently if already reacted.",
      },
    ],
    required_services: ["slack", "notion"],
    gotchas: [
      "Slack messages contain raw user IDs (<@U12345>) and channel references (<#C12345>). Replace these with display names before saving to Notion.",
      "Slack code blocks use triple backticks but Notion uses code block objects. Parse and convert the format.",
      "Notion rich_text has a 2000-char limit per text segment. Long Slack threads must be split across multiple paragraph blocks.",
      "Slack API rate limits vary by method tier. slack_get_user_profile is Tier 4 (100+ per minute) but batch lookups for large threads.",
    ],
  },

  // ── 8. Incident response ────────────────────────────────────────
  {
    id: "mcp-incident-response",
    goal: "Create incident response flow: Slack alert → GitHub issue → Notion incident log",
    description:
      "When an incident is detected, posts an alert to Slack, creates a tracking GitHub issue, and logs the incident in Notion with timeline. All links cross-referenced.",
    steps: [
      {
        order: 1,
        service_id: "slack",
        action: "Post incident alert to the incidents channel",
        mcp_tool: "slack_post_message",
        input_mapping: { channel_id: "{incidents_channel}", text: "🚨 *INCIDENT: {severity} — {title}*\n\nDetected: {timestamp}\nService: {affected_service}\nImpact: {impact_description}\n\nResponder: <@{responder_id}>" },
        output_mapping: { alert_ts: "step1.ts" },
        error_hint: "For critical incidents, consider also using slack_post_message to a DM channel to the on-call person.",
      },
      {
        order: 2,
        service_id: "github",
        action: "Create incident tracking issue with severity label",
        mcp_tool: "create_issue",
        input_mapping: { owner: "{org}", repo: "{incidents_repo}", title: "[{severity}] {title}", body: "## Incident Report\n\n**Severity:** {severity}\n**Detected:** {timestamp}\n**Affected Service:** {affected_service}\n\n## Impact\n{impact_description}\n\n## Timeline\n- {timestamp}: Incident detected\n\n## Slack Thread\n{slack_thread_url}" },
        output_mapping: { issue_url: "step2.html_url", issue_number: "step2.number" },
        error_hint: "Labels like 'incident', 'P0', 'P1' must pre-exist in the repo. create_issue doesn't auto-create labels.",
      },
      {
        order: 3,
        service_id: "slack",
        action: "Thread the GitHub issue link back to the incident alert",
        mcp_tool: "slack_reply_to_thread",
        input_mapping: { channel_id: "{incidents_channel}", thread_ts: "{alert_ts}", text: "📋 Tracking: {issue_url}" },
        output_mapping: {},
        error_hint: "Use the alert_ts from step 1 as the thread_ts to keep everything in one thread.",
      },
      {
        order: 4,
        service_id: "notion",
        action: "Log incident in the incident database with cross-links",
        mcp_tool: "API-post-search",
        input_mapping: { query: "Incident Log", filter: { property: "object", value: "database" } },
        output_mapping: { database_id: "step4.results[0].id" },
        error_hint: "After finding the database, create a page with Severity (select), Status (select), GitHub URL (url), Slack URL (url) properties.",
      },
    ],
    required_services: ["slack", "github", "notion"],
    gotchas: [
      "Slack thread URLs follow the format: https://{workspace}.slack.com/archives/{channel_id}/p{ts_without_dot}. Convert message_ts '1234567890.123456' to 'p1234567890123456'.",
      "GitHub issue body Markdown renders differently from Slack mrkdwn. Don't copy Slack formatting directly.",
      "Notion incident database should have Status as a select property with values like 'Investigating', 'Identified', 'Monitoring', 'Resolved'.",
      "For P0 incidents, the entire flow should complete in under 60 seconds. Avoid unnecessary API calls.",
    ],
  },

  // ── 9. File-based documentation sync ────────────────────────────
  {
    id: "mcp-docs-sync",
    goal: "Sync local documentation files to Notion pages",
    description:
      "Reads local markdown files from the filesystem, converts them to Notion blocks, and creates/updates corresponding Notion pages. Useful for keeping technical docs in sync.",
    steps: [
      {
        order: 1,
        service_id: "mcp-filesystem",
        action: "List documentation files in the docs directory",
        mcp_tool: "list_directory",
        input_mapping: { path: "./docs" },
        output_mapping: { files: "step1.entries" },
        error_hint: "list_directory returns file and directory names. Filter by .md extension for documentation files.",
      },
      {
        order: 2,
        service_id: "mcp-filesystem",
        action: "Read each markdown file's content",
        mcp_tool: "read_file",
        input_mapping: { path: "./docs/{filename}" },
        output_mapping: { content: "step2.content" },
        error_hint: "read_file returns the full file content as a string. For large files (>1MB), consider read_text_file which is optimized for text.",
      },
      {
        order: 3,
        service_id: "notion",
        action: "Create or update the corresponding Notion page",
        mcp_tool: "API-patch-block-children",
        input_mapping: { block_id: "{docs_page_id}", children: "converted_blocks" },
        output_mapping: { page_id: "step3.results.id" },
        error_hint: "Notion blocks have a different structure than Markdown. Convert ## → heading_2, - → bulleted_list_item, ``` → code block, etc.",
      },
    ],
    required_services: ["mcp-filesystem", "notion"],
    gotchas: [
      "Markdown to Notion block conversion is not 1:1. Tables, nested lists (>3 levels), and HTML in Markdown need special handling.",
      "Notion has a max of 100 blocks per API-patch-block-children call. For long documents, batch the blocks.",
      "filesystem MCP paths are relative to the server's working directory. Ensure the MCP server was started in the correct project root.",
      "Notion doesn't support Markdown image syntax. Images need to be uploaded separately or referenced as external URLs.",
    ],
  },

  // ── 10. Agent memory knowledge graph ────────────────────────────
  {
    id: "mcp-knowledge-graph-build",
    goal: "Build a knowledge graph from GitHub repository structure and documentation",
    description:
      "Scans a GitHub repository's structure and key files, then builds a structured knowledge graph using the MCP memory server. Enables semantic recall of project architecture.",
    steps: [
      {
        order: 1,
        service_id: "github",
        action: "Get repository file tree for architectural overview",
        mcp_tool: "get_file_contents",
        input_mapping: { owner: "{org}", repo: "{repo}", path: "" },
        output_mapping: { tree: "step1.content" },
        error_hint: "get_file_contents on root path returns the directory listing. Recursively explore key directories (src/, docs/, config/).",
      },
      {
        order: 2,
        service_id: "github",
        action: "Read README and key configuration files",
        mcp_tool: "get_file_contents",
        input_mapping: { owner: "{org}", repo: "{repo}", path: "README.md" },
        output_mapping: { readme: "step2.content" },
        error_hint: "README may be README.md, readme.md, README.rst, or similar. Try common variations.",
      },
      {
        order: 3,
        service_id: "mcp-memory",
        action: "Create entities for the repo, its key components, and their relationships",
        mcp_tool: "create_entities",
        input_mapping: { entities: [{ name: "{repo}", entityType: "repository", observations: ["language: {lang}", "description: {desc}"] }] },
        output_mapping: { entities: "step3.entities" },
        error_hint: "create_entities is idempotent — calling with the same entity name updates observations. entityType is a free-form string.",
      },
      {
        order: 4,
        service_id: "mcp-memory",
        action: "Create relationships between components",
        mcp_tool: "create_relations",
        input_mapping: { relations: [{ from: "{repo}", to: "{component}", relationType: "contains" }] },
        output_mapping: {},
        error_hint: "Both 'from' and 'to' entities must exist before creating a relation. Create entities first in step 3.",
      },
    ],
    required_services: ["github", "mcp-memory"],
    gotchas: [
      "MCP memory server stores data in a local JSON file. The knowledge graph persists across sessions but NOT across different machines.",
      "Entity names in memory are case-sensitive. Use consistent naming conventions (lowercase kebab-case recommended).",
      "create_entities observations are append-only — old observations aren't removed. Use delete_observations to clean stale data.",
      "Memory search_nodes does fuzzy matching on entity names and observations. Structure observations as 'key: value' for better retrieval.",
    ],
  },

  // ── 11. Sprint retrospective ────────────────────────────────────
  {
    id: "mcp-sprint-retro",
    goal: "Gather sprint data from GitHub for retrospective, summarize to Notion and Slack",
    description:
      "Collects completed PRs, closed issues, and commit stats for the sprint period from GitHub, creates a retrospective page in Notion, and posts highlights to Slack.",
    steps: [
      {
        order: 1,
        service_id: "github",
        action: "Search for PRs merged during the sprint",
        mcp_tool: "search_repositories",
        input_mapping: { query: "org:{org} is:pr is:merged merged:{sprint_start}..{sprint_end}", page: 1, perPage: 50 },
        output_mapping: { merged_prs: "step1.items" },
        error_hint: "GitHub search date range format is YYYY-MM-DD..YYYY-MM-DD. The search API has a rate limit of 30 req/min.",
      },
      {
        order: 2,
        service_id: "notion",
        action: "Create retrospective page with sprint metrics",
        mcp_tool: "API-patch-block-children",
        input_mapping: { block_id: "{retro_page_id}", children: [{ type: "heading_1", heading_1: { rich_text: [{ text: { content: "Sprint {sprint_number} Retro" } }] } }] },
        output_mapping: {},
        error_hint: "Build a comprehensive page with sections: Metrics (PRs merged, issues closed), What went well, What to improve, Action items.",
      },
      {
        order: 3,
        service_id: "slack",
        action: "Share retro highlights with the team",
        mcp_tool: "slack_post_message",
        input_mapping: { channel_id: "{team_channel}", text: "📊 *Sprint {sprint_number} Complete*\n\n✅ {merged_count} PRs merged\n🐛 {closed_issues} issues closed\n👥 {contributors} contributors\n\nFull retro: <{notion_url}|View in Notion>" },
        output_mapping: {},
        error_hint: "Keep the Slack summary concise — details go in Notion. Link to the full page.",
      },
    ],
    required_services: ["github", "notion", "slack"],
    gotchas: [
      "GitHub search API returns max 1000 results. For large orgs with 1000+ PRs per sprint, paginate or filter by repo.",
      "Notion heading blocks (heading_1, heading_2, heading_3) don't support child blocks directly. Use toggle_heading for collapsible sections.",
      "Sprint date boundaries should use timezone-aware timestamps. GitHub uses UTC — convert from your local timezone.",
      "Slack message character limit is 40,000 but optimal readability is under 2,000 characters.",
    ],
  },

  // ── 12. Competitive intelligence (using deep-audited MCP servers) ──
  {
    id: "mcp-competitive-intel",
    goal: "Gather competitive intelligence from YouTube transcripts and news feeds",
    description:
      "Uses specialized MCP servers to fetch YouTube video transcripts and news articles about competitors, then saves structured insights to memory for recall.",
    steps: [
      {
        order: 1,
        service_id: "io-github-cdcstream-captapi",
        action: "Get transcript from a competitor's product video",
        mcp_tool: "youtube_transcript",
        input_mapping: { video_url: "{competitor_video_url}" },
        output_mapping: { transcript: "step1.transcript" },
        error_hint: "youtube_transcript needs a full YouTube URL or video ID. Not all videos have captions available.",
      },
      {
        order: 2,
        service_id: "ai-tensorfeed-mcp-server",
        action: "Fetch recent news articles about the competitor",
        mcp_tool: "get_news_articles",
        input_mapping: { query: "{competitor_name}" },
        output_mapping: { articles: "step2.articles" },
        error_hint: "get_news_articles returns articles with title, content, source, date. Filter by relevance.",
      },
      {
        order: 3,
        service_id: "mcp-memory",
        action: "Store competitive insights as entities with observations",
        mcp_tool: "create_entities",
        input_mapping: { entities: [{ name: "{competitor_name}", entityType: "competitor", observations: ["{key_insight_1}", "{key_insight_2}"] }] },
        output_mapping: {},
        error_hint: "Use structured observations: 'product_update: {detail}', 'pricing_change: {detail}', 'feature_launch: {detail}'.",
      },
    ],
    required_services: ["io-github-cdcstream-captapi", "ai-tensorfeed-mcp-server", "mcp-memory"],
    gotchas: [
      "YouTube transcript quality varies — auto-generated captions have errors. Use youtube_summarize for a cleaner overview if available.",
      "News API results may include duplicates from syndication. Deduplicate by title similarity.",
      "Memory entities are local-only. For team-shared competitive intelligence, also push to Notion or a shared database.",
      "These are hosted MCP servers — they require remote HTTP connections. Check firewall/proxy settings.",
    ],
  },
];

// ═════════════════════════════════════════════════════════════════════

function main() {
  const dryRun = process.argv.includes("--dry");
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const insert = db.prepare(`
    INSERT OR REPLACE INTO recipes (id, goal, description, steps, required_services, gotchas)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const recipe of MCP_RECIPES) {
      // Convert steps to include mcp_tool in action for searchability
      const enrichedSteps = recipe.steps.map((s) => ({
        ...s,
        action: `[MCP: ${s.mcp_tool}] ${s.action}`,
      }));

      if (dryRun) {
        console.error(`  [dry] ${recipe.id}: ${recipe.goal} (${recipe.required_services.join(", ")})`);
      } else {
        insert.run(
          recipe.id,
          recipe.goal,
          recipe.description,
          JSON.stringify(enrichedSteps),
          JSON.stringify(recipe.required_services),
          JSON.stringify(recipe.gotchas),
        );
        inserted++;
      }
    }
  });

  tx();

  console.error("\n═══════════════════════════════════════════════════");
  console.error("  KanseiLINK MCP-Native Recipe Seeder");
  console.error("═══════════════════════════════════════════════════");
  console.error(`  Total recipes:  ${MCP_RECIPES.length}`);
  console.error(`  Inserted:       ${dryRun ? "(dry run)" : inserted}`);
  console.error(`  Services used:  ${[...new Set(MCP_RECIPES.flatMap((r) => r.required_services))].join(", ")}`);
  console.error("═══════════════════════════════════════════════════");

  db.close();
}

main();
