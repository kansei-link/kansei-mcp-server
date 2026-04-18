// Add a service_api_guide for Supabase. Addresses the gap found by
// analyze_token_savings (supabase had has_kansei_guide: false despite being
// a major dev tool).
//
// Based on Supabase docs and real agent-level pain points observed in the
// wild. Keep it compact — the guide is a fallback for when web_fetch fails.
import Database from 'better-sqlite3';
const db = new Database('./kansei-link.db');

const guide = {
  service_id: 'supabase',
  base_url: 'https://<project_ref>.supabase.co',
  api_version: 'v1',
  auth_overview:
    'Supabase uses JWT-based auth with two key types: anon key (safe for client use, works with RLS) and service_role key (server-only, bypasses RLS). Always expose only anon key to the browser. Database connections additionally accept the Postgres connection string with sslmode=require.',
  auth_token_url: 'https://<project_ref>.supabase.co/auth/v1/token',
  auth_scopes: 'anon,authenticated,service_role',
  auth_setup_hint:
    '1. Dashboard → Project Settings → API → copy Project URL + anon key + service_role key. 2. Never commit service_role key — it bypasses RLS and is admin-level. 3. For direct Postgres access, use Connection Pooling (port 6543) for serverless, Direct (port 5432) for long-lived connections. 4. RLS is off by default on custom schemas — always enable RLS on any table with user data.',
  sandbox_url: 'https://supabase.com/dashboard',
  key_endpoints: JSON.stringify([
    { method: 'POST', path: '/auth/v1/signup', purpose: 'Create user' },
    { method: 'POST', path: '/auth/v1/token?grant_type=password', purpose: 'Login' },
    { method: 'GET', path: '/rest/v1/<table>', purpose: 'Query (PostgREST)' },
    { method: 'POST', path: '/rest/v1/<table>', purpose: 'Insert row' },
    { method: 'PATCH', path: '/rest/v1/<table>?id=eq.<id>', purpose: 'Update by filter' },
    { method: 'DELETE', path: '/rest/v1/<table>?id=eq.<id>', purpose: 'Delete by filter' },
    { method: 'POST', path: '/storage/v1/object/<bucket>/<path>', purpose: 'Upload file' },
    { method: 'POST', path: '/functions/v1/<name>', purpose: 'Invoke Edge Function' },
  ]),
  request_content_type: 'application/json',
  pagination_style: 'Range header: Range: 0-9 (first 10 rows). Response includes Content-Range: 0-9/42 for total.',
  rate_limit: 'Auth: 30 req/5min per IP. PostgREST: limited by Postgres connection pool (15 on Free, 60 on Pro). Edge Functions: 500 req/s burst, 50/s sustained on Free.',
  error_format:
    'PostgREST: { "code": "PGRST116", "message": "...", "details": "...", "hint": "..." }. Auth: { "error": "invalid_grant", "error_description": "..." }. Always check status + body.code.',
  quickstart_example: `# Query users table with RLS
curl 'https://<project>.supabase.co/rest/v1/users?select=id,email' \\
  -H "apikey: <anon_key>" \\
  -H "Authorization: Bearer <user_jwt_or_anon_key>" \\
  -H "Accept: application/json"

# Insert a row
curl -X POST 'https://<project>.supabase.co/rest/v1/users' \\
  -H "apikey: <anon_key>" \\
  -H "Authorization: Bearer <service_role_key>" \\
  -H "Content-Type: application/json" \\
  -H "Prefer: return=representation" \\
  -d '{"email":"user@example.com","name":"Alice"}'`,
  agent_tips: JSON.stringify([
    "RLS is THE thing: if queries return [] when you expect data, you're probably hitting RLS silently. Use service_role key server-side or add a policy.",
    "anon key is safe in browsers; service_role key is NOT — it bypasses RLS. Never log, never commit, never send to client.",
    "PostgREST uses filter operators: ?id=eq.5, ?age=gte.18, ?name=ilike.*john*. Don't confuse with SQL — no WHERE keyword.",
    "For full-text search use ?column=fts.query (with tsvector column). Simpler for agents than building SQL.",
    "Storage bucket must exist AND have a policy before uploads work. 403 errors almost always mean missing bucket policy, not missing auth.",
    "Edge Functions timeout at 150s on Free, 400s on Pro. For long jobs use pg_cron inside Postgres instead.",
    "Realtime subscriptions require enabling Replication on the table: Dashboard → Database → Replication → toggle the table.",
    "Connection pooler (6543) is mandatory for serverless (Vercel/Lambda). Direct connection (5432) will exhaust pool within minutes.",
    "The @supabase/supabase-js client hides most of this. For agent raw-REST workflows, PostgREST filter syntax is the biggest surprise.",
    "Vector search: use pgvector via SQL + RPC function. There's no native /embeddings endpoint — you handle embeddings yourself.",
  ]),
  docs_url: 'https://supabase.com/docs',
};

const existing = db.prepare('SELECT service_id FROM service_api_guides WHERE service_id = ?').get('supabase');
if (existing) {
  console.log('Supabase guide already exists — skipping.');
} else {
  const cols = Object.keys(guide);
  const placeholders = cols.map((c) => '@' + c).join(', ');
  const stmt = db.prepare(`INSERT INTO service_api_guides (${cols.join(', ')}) VALUES (${placeholders})`);
  stmt.run(guide);
  console.log('✅ Supabase guide inserted');
  const row = db.prepare('SELECT service_id, docs_url FROM service_api_guides WHERE service_id = ?').get('supabase');
  console.log('Verification:', row);
}

db.close();
