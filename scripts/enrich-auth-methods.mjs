// Data-quality pass: fill in api_auth_method for services where the MCP
// server is official / third-party but the auth column was left NULL in
// the seed. This directly affected AXR grades — a NULL auth_method costs
// a +0.1 bonus, which pushed several clearly-AAA services down to AA.
//
// Source of truth: docs + tags + common convention per service.
import Database from 'better-sqlite3';
const db = new Database('./kansei-link.db');

const AUTH_FILLINS = {
  freee:          'oauth2_pkce',      // OAuth 2.0 + PKCE, 24h refresh
  moneyforward:   'oauth2',           // standard OAuth 2.0
  'brave-search': 'api_key',          // X-Subscription-Token header
  tavily:         'api_key',          // Authorization Bearer <key>
  qdrant:         'api_key',          // Cloud: API key. Self-hosted: none.
  firecrawl:      'api_key',          // Bearer token
  elevenlabs:     'api_key',          // xi-api-key header
  langfuse:       'api_key_pair',     // public + secret key pair
  'postgresql-mcp': 'connection_string', // DB connection string, not HTTP auth
};

const update = db.prepare(
  'UPDATE services SET api_auth_method = ? WHERE id = ? AND api_auth_method IS NULL'
);

console.log('Filling in missing api_auth_method values...\n');
let updated = 0, skipped = 0, notFound = 0;
for (const [id, auth] of Object.entries(AUTH_FILLINS)) {
  const existing = db.prepare('SELECT id, api_auth_method FROM services WHERE id = ?').get(id);
  if (!existing) {
    console.log('  ⚠️ ', id, '→ not found');
    notFound++;
    continue;
  }
  if (existing.api_auth_method !== null) {
    console.log('  =  ', id, '→ already set:', existing.api_auth_method);
    skipped++;
    continue;
  }
  update.run(auth, id);
  console.log('  ✅', id.padEnd(20), '→', auth);
  updated++;
}
console.log();
console.log('Summary:', updated, 'updated,', skipped, 'skipped,', notFound, 'not found');
db.close();
