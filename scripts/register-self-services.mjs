// Register KanseiLink and linksee-memory as services in the KanseiLink DB.
// This unblocks:
//   - agent_voice({service_id: "kansei-link", ...})   — meta-feedback
//   - take_snapshot({service_id: "linksee-memory"})   — snapshot our sibling MCP
//   - report_outcome + all other service-keyed tools
//
// Idempotent: uses INSERT OR IGNORE.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const db = new Database('./kansei-link.db');

const services = [
  {
    id: 'kansei-link',
    name: 'KanseiLink MCP',
    namespace: 'io.github.kansei-link/kansei-mcp-server',
    description:
      'MCP intelligence layer for the Agent Economy. Discover and evaluate 301+ SaaS/API services (JP + global) with trust scores, workflow recipes, and real agent experience data. Built-in self-feedback loop (agent_voice + report_outcome) grows the DB community-driven. Official MCP server.',
    category: 'developer_tools',
    tags: 'mcp,saas-discovery,api-integration,japanese-saas,agent-economy,aeo,meta',
    mcp_endpoint: 'npx -y @kansei-link/mcp-server',
    mcp_status: 'official',
    api_url: 'https://kansei-link.com',
    api_auth_method: null,
    trust_score: 0.85,
    usage_count: 0,
    axr_grade: 'A',
    axr_score: 70,
  },
  {
    id: 'linksee-memory',
    name: 'Linksee Memory',
    namespace: 'io.github.michielinksee/linksee-memory',
    description:
      'Local-first agent memory MCP. 6-layer WHY structure (goal/context/emotion/implementation/caveat/learning) + AST-aware file diff cache (50-99% token savings on re-reads). Cross-agent (Claude Code / Cursor / ChatGPT Desktop) via a single SQLite file at ~/.linksee-memory/memory.db. Pairs with KanseiLink — KanseiLink = external collective intelligence, Linksee Memory = personal past experience.',
    category: 'developer_tools',
    tags: 'mcp,memory,agent-memory,cross-agent,local-first,token-savings,linksee',
    mcp_endpoint: 'npx -y linksee-memory',
    mcp_status: 'official',
    api_url: 'https://github.com/michielinksee/linksee-memory',
    api_auth_method: null,
    trust_score: 0.75,
    usage_count: 0,
    axr_grade: 'A',
    axr_score: 70,
  },
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO services
    (id, name, namespace, description, category, tags, mcp_endpoint, mcp_status,
     api_url, api_auth_method, trust_score, usage_count, axr_grade, axr_score)
  VALUES
    (@id, @name, @namespace, @description, @category, @tags, @mcp_endpoint, @mcp_status,
     @api_url, @api_auth_method, @trust_score, @usage_count, @axr_grade, @axr_score)
`);

console.log('Registering self-services...\n');
for (const svc of services) {
  const exists = db.prepare('SELECT id FROM services WHERE id = ?').get(svc.id);
  if (exists) {
    console.log(`  - ${svc.id}: already exists, skipping`);
    continue;
  }
  insert.run(svc);
  console.log(`  ✅ ${svc.id}: inserted`);
}

// Verify
console.log('\nVerification:');
for (const svc of services) {
  const row = db
    .prepare('SELECT id, name, category, mcp_status FROM services WHERE id = ?')
    .get(svc.id);
  console.log(' ', row);
}

db.close();
console.log('\nDone.');
