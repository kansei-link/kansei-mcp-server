#!/usr/bin/env node
/**
 * fake-freee-mcp — an in-memory stand-in for freee-mcp used ONLY by
 * scripts/smoke-run-marker.mts. Speaks newline-delimited JSON-RPC on stdio and
 * imitates the parts of freee-mcp 0.26.5 that run-marker.mjs depends on:
 *
 *   - freee_server_info / freee_auth_status / freee_get_current_company /
 *     freee_list_companies / freee_set_current_company / freee_api_get
 *   - the "company_id の不整合" guard: freee_api_get refuses a company_id that is
 *     not the current company and tells the caller to switch first
 *   - /api/1/companies (JSON) and /api/1/deals with meta.total_count
 *
 * Every id, name and number here is invented. No network, no files touched,
 * except an optional state dump to $FAKE_FREEE_STATE_FILE after each switch
 * (so a smoke test can verify what the "persisted" current company ended as).
 */
import { writeFileSync } from 'node:fs';

const COMPANIES = [
  { id: 1000001, name: '偽の本番株式会社', name_kana: null, display_name: '偽の本番株式会社', company_number: '1000000001', role: 'admin' },
  { id: 1000002, name: null, name_kana: null, display_name: '開発用テスト事業所A', company_number: '1000000002', role: 'admin' },
  { id: 1000003, name: null, name_kana: null, display_name: '事業所名（未設定）', company_number: '1000000003', role: 'admin' },
];
const DEALS_TOTAL = { 1000001: 42, 1000002: 3, 1000003: 0 };
const state = { currentCompanyId: Number(process.env.FAKE_FREEE_START_COMPANY || 1000001), switches: [] };
const dump = () => { if (process.env.FAKE_FREEE_STATE_FILE) writeFileSync(process.env.FAKE_FREEE_STATE_FILE, JSON.stringify(state)); };
dump();

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const byId = (id) => COMPANIES.find((c) => c.id === Number(id));
const TOOLS = [
  { name: 'freee_server_info', description: 'server info', inputSchema: { type: 'object', properties: {} } },
  { name: 'freee_auth_status', description: 'auth status', inputSchema: { type: 'object', properties: {} } },
  { name: 'freee_current_user', description: 'current user', inputSchema: { type: 'object', properties: {} } },
  { name: 'freee_get_current_company', description: 'current company', inputSchema: { type: 'object', properties: {} } },
  { name: 'freee_list_companies', description: 'list companies', inputSchema: { type: 'object', properties: {} } },
  { name: 'freee_set_current_company', description: 'set current company', inputSchema: { type: 'object', properties: { company_id: { type: 'string' } }, required: ['company_id'] } },
  { name: 'freee_api_get', description: 'GET', inputSchema: { type: 'object', properties: { service: { type: 'string' }, path: { type: 'string' }, query: { type: 'object' } }, required: ['service', 'path'] } },
  { name: 'freee_api_list_paths', description: 'list paths', inputSchema: { type: 'object', properties: {} } },
  { name: 'freee_api_post', description: 'POST (must never be exposed by the harness)', inputSchema: { type: 'object', properties: {} } },
];

function call(name, args = {}) {
  switch (name) {
    case 'freee_server_info': return text('freee-mcp server info:\n- version: fake-0.0.1\n- transport: stdio');
    case 'freee_auth_status': return text('認証状態: 有効\n有効期限: 12/31/2099, 11:59:59 PM');
    case 'freee_current_user': return text('ユーザー: fake (ID: 1)');
    case 'freee_get_current_company': { const c = byId(state.currentCompanyId); return text(`現在の事業所: ${c.display_name} (ID: ${c.id})`); }
    case 'freee_list_companies': return text('事業所一覧:\n' + COMPANIES.map((c) => `${c.name ?? '(未設定)'} (${c.id})${c.id === state.currentCompanyId ? ' *' : ''} [display_name: ${c.display_name}]`).join('\n'));
    case 'freee_set_current_company': {
      const c = byId(args.company_id);
      if (!c) return text(`APIリクエストエラー: 事業所が見つかりません`);
      state.currentCompanyId = c.id; state.switches.push(c.id); dump();
      return text(`事業所を切り替えました: ${c.display_name} (ID: ${c.id})`);
    }
    case 'freee_api_list_paths': return text('/api/1/companies\n/api/1/deals');
    case 'freee_api_get': {
      const path = String(args.path || '');
      if (path === '/api/1/companies') return text(JSON.stringify({ companies: COMPANIES }, null, 2));
      const cid = args.query?.company_id ?? args.company_id;
      const useId = cid == null ? state.currentCompanyId : Number(cid);
      if (useId !== state.currentCompanyId) return text(`APIリクエストエラー: company_id の不整合: リクエストの company_id (${useId}) と現在の事業所 (${state.currentCompanyId}) が異なります。\nfreee_set_current_company で事業所を切り替えるか、リクエストの company_id を修正してください。`);
      if (/^\/api\/1\/companies\/\d+$/.test(path)) return text(JSON.stringify({ company: byId(useId) }, null, 2));
      if (path === '/api/1/deals') {
        const n = DEALS_TOTAL[useId] ?? 0;
        return text(JSON.stringify({ deals: n ? [{ id: 1, company_id: useId, issue_date: '2026-08-15', amount: 100, partner_id: 1, status: 'settled' }] : [], meta: { total_count: n } }, null, 2));
      }
      return text('パス検証エラー: unsupported path in fake');
    }
    default: return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true };
  }
}

let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id == null) continue; // notification
    let result;
    if (msg.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-freee-mcp', version: '0.0.1' } };
    else if (msg.method === 'tools/list') result = { tools: TOOLS };
    else if (msg.method === 'tools/call') result = call(msg.params?.name, msg.params?.arguments || {});
    else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } }) + '\n'); continue; }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
