#!/usr/bin/env node
// generate-ard.mjs — ARD（Agentic Resource Discovery v0.91）段階 A の生成器。
//
// 入力:
//   --csv <path>   日本の公式 MCP の一覧（official_mcp=yes の行だけ使う）。公開リポジトリには置かない。
//   scripts/ard/authored.json   手書き: service_id・表示名・問いの例・記録の段階・自社 MCP の一行
//   package.json                MCP Registry の server.json の元（version・description・mcpName）
// 出力（どれも手で直さない。直すのは入力）:
//   public/.well-known/ard.json          manifest（entries[]）
//   public/ns/ard/v1.jsonld, v1.html     kansei: 名前空間の JSON-LD context と人間向けの語の説明
//   public/ard/index.html                人間向けの一覧
//   public/problems/*.html               /ard/* のエラーの型（RFC 9457 の type URI）の説明
//   public/.well-known/mcp/server.json, server.json   MCP Registry の server.json（同じ内容を二か所）
//   src/data/ard-entries.json            本番サーバーが返すカード（/ard/entries/<id>.json）
//   src/data/ard-openapi.json            /ard/* の OpenAPI 3.1
//   public/sitemap.xml                   新しい HTML の <url> を足す（無い時だけ）
//
// 使い方: node scripts/generate-ard.mjs --csv <一覧の CSV> [--as-of YYYY-MM-DD]
//   --as-of は生成日（省略時は今日・日本時間）。authored.json で publish_after を持つ会社は、
//   生成日がその日以前の間、全部の出力から外す（外した数だけを標準出力と一覧ページに出す）。
//
// 仕様の版: ards-project/ard-spec spec/ard.md v0.91（b76f235・2026-09-12）。
// 記録の段階（L0〜L3）は authored.json が決め、ここは「L1 以上にだけ証拠と検証主体を付ける」を守らせる。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GA_SNIPPET, SITE } from './lib/site-instrumentation.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);

const csvPath = argOf('--csv') ?? process.env.KANSEI_ARD_CSV;
if (!csvPath) {
  console.error('generate-ard: --csv <一覧の CSV> が要る（元データは公開リポジトリに置かない）');
  process.exit(2);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 今日（日本時間）。sv-SE の日付の書式は YYYY-MM-DD */
const todayJst = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const TODAY = argOf('--as-of') ?? todayJst();
if (!DATE_RE.test(TODAY)) throw new Error(`--as-of は YYYY-MM-DD: ${TODAY}`);

const ARD_SPEC = 'ards-project/ard-spec spec/ard.md v0.91 (b76f235, 2026-09-12)';
const ARD_BASE_CONTEXT = 'https://agenticresourcediscovery.org/context/v1';
const NS = `${SITE}/ns/ard/v1#`;
const SERVER = 'https://mcp.kansei-link.com';
const MANIFEST_URL = `${SITE}/.well-known/ard.json`;
const AUTHOR = 'kansei-link.com';
const VERIFIER = 'human:synapse-arrows';
const QUERY_NOTE = '問いの例は KanseiLINK が作成。公式の記述は url の先。';
const SERVER_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const SERVICE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const URN_RE = /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/;

const authored = JSON.parse(readFileSync(join(ROOT, 'scripts', 'ard', 'authored.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// ─── CSV（RFC 4180・引用符の中の改行とカンマを読む） ─────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((k, i) => [k, r[i].trim()])));
}

const official = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r.official_mcp === 'yes');

// ─── 記録を組む ─────────────────────────────────────────────────────
const HOSTING_JA = {
  'self-hosted-local': '利用者の手元で実行',
  'self-hosted-remote': '利用者が自分でリモートに設置',
  'vendor-hosted': '提供者が運用',
  unclear: '一次資料に記載なし',
};
const splitHosting = (h) => h.split('+').map((s) => s.trim()).filter(Boolean);
const orNull = (s) => (s && s !== '—' ? s : null);
/** 認証方式の短い呼び名（説明文用）。全文は authMethod にそのまま残す。 */
const authShort = (a) => {
  const head = a.split(/ \(| — |（/)[0].trim();
  return head === 'unclear' || head === '' ? '一次資料に記載なし' : head;
};
const authLabel = (r) => r.auth_short ?? authShort(r.auth_method);
const hostingJa = (list) => list.map((h) => HOSTING_JA[h] ?? h).join('＋');
const levelLabel = (lv) => `${lv} ${authored.levels[lv]}`;

function finishRecord(rec) {
  if (!SERVICE_ID_RE.test(rec.service_id)) throw new Error(`service_id の文法: ${rec.service_id}`);
  if (!URN_RE.test(rec.identifier)) throw new Error(`URN の文法: ${rec.identifier}`);
  if (!authored.levels[rec.level]) throw new Error(`段階が不明: ${rec.service_id} ${rec.level}`);
  if (rec.queries.length !== 3) throw new Error(`問いの例は日本語 2＋英語 1: ${rec.service_id}`);
  const verified = rec.level !== 'L0';
  if (verified && rec.evidence.length === 0) throw new Error(`L1 以上には証拠が要る: ${rec.service_id}`);
  if (!verified && (rec.evidence.length || rec.level_basis)) throw new Error(`L0 に証拠を付けない: ${rec.service_id}`);
  rec.verifier = verified ? VERIFIER : null;
  return rec;
}

const records = [];
const used = new Set();
const withheld = []; // publish_after が生成日以後の会社。名前はどの出力にも出さない
for (const row of official) {
  const hits = authored.companies.filter((c) => row.company.startsWith(c.match));
  if (hits.length !== 1) throw new Error(`authored.json の match が ${hits.length} 件: ${row.company}`);
  const a = hits[0];
  if (used.has(a.service_id)) throw new Error(`service_id が重複: ${a.service_id}`);
  used.add(a.service_id);
  if (a.publish_after !== undefined) {
    if (!DATE_RE.test(a.publish_after)) throw new Error(`publish_after は YYYY-MM-DD: ${a.service_id}`);
    if (TODAY <= a.publish_after) { withheld.push(a.publish_after); continue; }
  }
  records.push(finishRecord({
    service_id: a.service_id,
    identifier: `urn:air:kansei-link.com:jp-saas:${a.service_id}`,
    display_name: a.display_name,
    company: a.company,
    product: row.product,
    announcement_url: orNull(row.announcement_url),
    announcement_date: orNull(row.announcement_date),
    repo_url: orNull(row.repo_url),
    docs_url: orNull(row.docs_url),
    official_registry: row.registry,
    hosting: splitHosting(row.hosting),
    auth_method: a.auth_method_note ? `${row.auth_method}／${a.auth_method_note}` : row.auth_method,
    auth_short: a.auth_short ?? null,
    use_case_group: row.use_case_group,
    accessed_on: row.accessed_on,
    level: a.level ?? 'L0',
    level_basis: a.level_basis ?? null,
    verified_on: a.verified_on ?? row.accessed_on,
    evidence: (a.evidence ?? []).map((k) => authored.evidence[k] ?? (() => { throw new Error(`証拠の鍵が無い: ${k}`); })()),
    failures: a.failures ? [authored.field_notes_json] : [],
    queries: a.queries,
  }));
}
const unmatched = authored.companies.filter((c) => !used.has(c.service_id));
if (unmatched.length) throw new Error(`CSV に無い会社: ${unmatched.map((c) => c.match).join(', ')}`);

for (const r of records) {
  const source = r.announcement_date ? `一次資料（${r.announcement_date} 付）` : '公式リポジトリ';
  const stage = r.level === 'L0'
    ? `記録の段階: ${r.level} 存在確認（接続は未検証・確認日 ${r.accessed_on}）。`
    : `記録の段階: ${levelLabel(r.level)}。${r.level_basis}。`;
  r.description = `${r.company}の「${r.product}」に公式 MCP があることを、${source}で確認した記録。提供形態: ${hostingJa(r.hosting)}。認証: ${authLabel(r)}。${stage}${QUERY_NOTE}`;
}

// 自社 MCP（手書きの一行）
const s = authored.self;
const self = finishRecord({
  service_id: s.service_id,
  identifier: s.identifier,
  display_name: s.display_name,
  company: s.company,
  product: s.product,
  announcement_url: null,
  announcement_date: null,
  repo_url: s.repo_url,
  docs_url: s.docs_url,
  official_registry: `yes: ${pkg.mcpName}`,
  hosting: splitHosting(s.hosting),
  auth_method: s.auth_method,
  use_case_group: s.use_case_group,
  accessed_on: s.verified_on,
  level: s.level,
  level_basis: s.level_basis,
  verified_on: s.verified_on,
  evidence: s.evidence.map((k) => authored.evidence[k]),
  failures: [],
  queries: s.queries,
});
self.description = `${s.summary}提供形態: ${hostingJa(self.hosting)}。認証: ${authShort(self.auth_method)}。記録の段階: ${levelLabel(self.level)}。${self.level_basis}。${QUERY_NOTE}`;
records.push(self);

// ─── MCP Registry の server.json（package.json から） ────────────────
/** Registry の schema は description を 100 字までにしている。越える時は区切りで切る（言葉は足さない）。 */
function registryDescription(d) {
  if (d.length <= 100) return d;
  let cut = d;
  for (const sep of [', ', ' — ']) {
    while (cut.length > 100 && cut.includes(sep)) cut = cut.slice(0, cut.lastIndexOf(sep));
    if (cut.length <= 100) return cut;
  }
  throw new Error('package.json の description を 100 字以内に切れない');
}
const serverJson = {
  $schema: SERVER_SCHEMA,
  name: pkg.mcpName,
  description: registryDescription(pkg.description),
  repository: { url: s.repo_url, source: 'github' },
  version: pkg.version,
  packages: [{ registryType: 'npm', identifier: pkg.name, version: pkg.version, transport: { type: 'stdio' } }],
  remotes: [{ type: 'streamable-http', url: `${SERVER}/mcp` }],
};

// ─── カード（本番サーバーが返す物） ───────────────────────────────────
const cardUrl = (id) => `${SERVER}/ard/entries/${id}.json`;
function toCard(r) {
  const card = {
    schema: 'kansei-ard-entry-card/v1',
    note: 'KanseiLINK が一次資料から作った記録。提供者が出している MCP Server Card ではない。公式の所在は official.location。',
    service_id: r.service_id,
    identifier: r.identifier,
    displayName: r.display_name,
    company: r.company,
    product: r.product,
    official: {
      location: r.repo_url ?? r.docs_url ?? null,
      repo_url: r.repo_url,
      docs_url: r.docs_url,
      announcement_url: r.announcement_url,
      announcement_date: r.announcement_date,
      mcp_registry: r.official_registry,
    },
    hosting: r.hosting,
    auth_method: r.auth_method,
    use_case_group: r.use_case_group,
    verification: {
      level: r.level,
      label: authored.levels[r.level],
      basis: r.level_basis,
      verified_on: r.verified_on,
      author: AUTHOR,
      verifier: r.verifier,
      evidence: r.evidence,
    },
    failures: r.failures,
    sources: [...new Set([r.announcement_url, r.repo_url, r.docs_url].filter(Boolean))],
    accessed_on: r.accessed_on,
    manifest: MANIFEST_URL,
    generated_on: TODAY,
  };
  if (r === self) card.mcpServer = serverJson;
  return card;
}
const cards = Object.fromEntries(records.map((r) => [r.service_id, toCard(r)]));

// ─── manifest ───────────────────────────────────────────────────────
const ENTRY_CONTEXT = [ARD_BASE_CONTEXT, { kansei: NS }];
function toEntry(r) {
  const e = {
    '@context': ENTRY_CONTEXT,
    identifier: r.identifier,
    displayName: r.display_name,
    type: 'application/mcp-server-card+json',
    url: cardUrl(r.service_id),
    description: r.description,
    representativeQueries: r.queries,
    tags: [...(r.use_case_group === '該当なし' ? [] : [r.use_case_group]), ...r.hosting],
    'kansei:verificationLevel': r.level,
    'kansei:verifiedOn': r.verified_on,
    'kansei:author': AUTHOR,
  };
  if (r.verifier) {
    e['kansei:verifier'] = r.verifier;
    e['kansei:evidence'] = r.evidence;
  }
  if (r.announcement_url) e['kansei:sourceAnnouncement'] = r.announcement_url;
  e['kansei:hosting'] = r.hosting;
  e['kansei:authMethod'] = r.auth_method;
  e['kansei:useCaseGroup'] = r.use_case_group;
  if (r.failures.length) e['kansei:failures'] = r.failures;
  return e;
}
const oa = authored.openapi_entry;
const openapiEntry = {
  '@context': ENTRY_CONTEXT,
  identifier: oa.identifier,
  displayName: oa.display_name,
  type: 'application/vnd.oai.openapi+json;version=3.1',
  url: `${SERVER}/ard/openapi.json`,
  description: oa.description,
  representativeQueries: oa.queries,
  'kansei:author': AUTHOR,
};
if (!URN_RE.test(oa.identifier)) throw new Error(`URN の文法: ${oa.identifier}`);
const manifest = {
  specVersion: '1.0',
  host: { displayName: 'KanseiLINK (Synapse Arrows PTE. LTD.)', identifier: 'did:web:kansei-link.com' },
  entries: [...records.map(toEntry), openapiEntry],
};

// ─── JSON-LD context ────────────────────────────────────────────────
const TERMS = [
  ['verificationLevel', '記録の段階', 'L0 存在確認（一次資料で公式 MCP を確認）／L1 到達確認（封印した問いで毎日測った）／L2 接続確認（起動・接続して操作定義を取得）／L3 業務完了確認。L0 は「検証済み」ではない。', null],
  ['verifiedOn', '確認日', 'その段階を確かめた日（L0 は一次資料を開いた日）。', 'xsd:date'],
  ['verifiedUntil', '有効期限', 'この記録を確かめ直す期限。期限を決めていない記録には付けない。', 'xsd:date'],
  ['evidence', '証拠', 'L1 以上の記録の裏付け（測る前に封印した正解の指紋など）の URL。L0 には付かない。', '@id'],
  ['author', '作成主体', 'この記録を書いた主体。', null],
  ['verifier', '検証主体', 'L1 以上を確かめた主体。L0 には付かない。', null],
  ['sourceAnnouncement', '一次資料', '公式 MCP の存在を確認した、提供者自身の発表・文書の URL。', '@id'],
  ['hosting', '提供形態', 'self-hosted-local（利用者の手元で実行）／self-hosted-remote（利用者が自分でリモートに設置）／vendor-hosted（提供者が運用）／unclear（一次資料に記載なし）。', null],
  ['authMethod', '認証方式', '一次資料に書かれた認証方式。unclear は一次資料に記載なし。', null],
  ['useCaseGroup', '用途の束', '用途で分けた束。順位ではない。', null],
  ['failures', '現場メモ', 'エージェントが実務で詰まった記録（機械可読）の URL。', '@id'],
];
const SET_TERMS = new Set(['evidence', 'hosting', 'failures']);
const jsonldContext = {
  '@context': {
    '@version': 1.1,
    kansei: NS,
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    ...Object.fromEntries(TERMS.map(([name, , , type]) => {
      const def = { '@id': `kansei:${name}` };
      if (type) def['@type'] = type;
      if (SET_TERMS.has(name)) def['@container'] = '@set';
      return [`kansei:${name}`, def];
    })),
  },
  '@graph': TERMS.map(([name, label, comment]) => ({
    '@id': `kansei:${name}`,
    '@type': 'rdf:Property',
    'rdfs:label': label,
    'rdfs:comment': comment,
  })),
};

// ─── OpenAPI 3.1 ────────────────────────────────────────────────────
const ids = records.map((r) => r.service_id);
const nullable = (schema) => ({ ...schema, type: [schema.type, 'null'] });
const str = { type: 'string' };
const uri = { type: 'string', format: 'uri' };
const date = { type: 'string', format: 'date' };
const counter = {
  type: 'object',
  required: ['count', 'last_fetched_at', 'by_ua_class'],
  properties: {
    count: { type: 'integer', minimum: 0 },
    last_fetched_at: nullable({ type: 'string', format: 'date-time' }),
    by_ua_class: { $ref: '#/components/schemas/UaClassCounts' },
  },
};
const problemResponse = (description) => ({
  description,
  headers: { 'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' } },
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});
const okResponse = (description, schemaRef) => ({
  description,
  headers: { 'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' } },
  content: { 'application/json': { schema: schemaRef } },
});
const rateLimited = {
  description: 'Too many requests (100 per minute per client). The body is the server-wide rate limiter\'s, not a problem document.',
  headers: { 'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' } },
  content: { 'application/json': { schema: { type: 'object', required: ['error'], properties: { error: str } } } },
};
const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'KanseiLINK ARD Entries API',
    summary: 'Entry cards behind kansei-link.com/.well-known/ard.json',
    description: 'Read-only. Each ARD entry published at https://kansei-link.com/.well-known/ard.json points to a card here, so that fetches can be counted. Cards are records KanseiLINK made from primary sources; they are not MCP Server Cards issued by the providers. Errors are RFC 9457 problem details.',
    version: TODAY,
    license: { name: 'MIT', identifier: 'MIT' },
    contact: { name: 'KanseiLINK', url: `${SITE}/independence.html` },
  },
  servers: [{ url: SERVER, description: 'Production (Railway)' }],
  security: [],
  tags: [{ name: 'ard', description: 'ARD entry cards, their counts, and this document.' }],
  paths: {
    '/ard/entries/{service_id}.json': {
      get: {
        operationId: 'getArdEntryCard',
        tags: ['ard'],
        summary: 'Get the card of one ARD entry',
        description: 'Returns the record for one service: where the official MCP lives, hosting, auth method, the level of the record (L0–L3) and its evidence.',
        parameters: [{ name: 'service_id', in: 'path', required: true, description: 'The last segment of the entry\'s URN.', schema: { type: 'string', enum: ids } }],
        responses: {
          200: okResponse('The card.', { $ref: '#/components/schemas/EntryCard' }),
          400: problemResponse('The path is not /ard/entries/<service_id>.json or the id breaks the grammar (type …/problems/bad-request).'),
          404: problemResponse('No entry with this id (type …/problems/ard-entry-not-found).'),
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/ard/stats.json': {
      get: {
        operationId: 'getArdStats',
        tags: ['ard'],
        summary: 'Fetch counts since the last restart',
        description: 'In-memory counts per entry and per User-Agent class. Reset when the server restarts.',
        responses: {
          200: okResponse('The counts.', { $ref: '#/components/schemas/Stats' }),
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/ard/openapi.json': {
      get: {
        operationId: 'getArdOpenapi',
        tags: ['ard'],
        summary: 'Get this document',
        description: 'The OpenAPI 3.1 definition of the /ard/* routes.',
        responses: {
          200: okResponse('This document.', { type: 'object' }),
          404: problemResponse('The document is not available in this build.'),
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
  },
  components: {
    headers: {
      'X-Request-Id': { description: 'Identifier of this request. Quote it when reporting a problem; the same value is in the server log and in a problem document\'s `instance`.', schema: str },
    },
    responses: { RateLimited: rateLimited },
    schemas: {
      EntryCard: {
        type: 'object',
        required: ['schema', 'service_id', 'identifier', 'displayName', 'company', 'product', 'official', 'hosting', 'auth_method', 'use_case_group', 'verification', 'failures', 'sources', 'accessed_on', 'manifest', 'generated_on'],
        properties: {
          schema: { type: 'string', const: 'kansei-ard-entry-card/v1' },
          note: str,
          service_id: { type: 'string', pattern: SERVICE_ID_RE.source },
          identifier: { type: 'string', pattern: URN_RE.source },
          displayName: str,
          company: str,
          product: str,
          official: {
            type: 'object',
            description: 'Where the official MCP lives, from primary sources.',
            required: ['location', 'repo_url', 'docs_url', 'announcement_url', 'announcement_date', 'mcp_registry'],
            properties: {
              location: nullable({ ...uri, description: 'repo_url, else docs_url. null when the primary sources give neither.' }),
              repo_url: nullable(uri),
              docs_url: nullable(uri),
              announcement_url: nullable(uri),
              announcement_date: nullable(date),
              mcp_registry: { type: 'string', description: 'Whether it is listed in the official MCP Registry ("no", or "yes: <name>").' },
            },
          },
          hosting: { type: 'array', items: { type: 'string', enum: Object.keys(HOSTING_JA) } },
          auth_method: { type: 'string', description: 'As written in primary sources. "unclear" = not stated there.' },
          use_case_group: str,
          verification: {
            type: 'object',
            required: ['level', 'label', 'basis', 'verified_on', 'author', 'verifier', 'evidence'],
            properties: {
              level: { type: 'string', enum: Object.keys(authored.levels), description: 'L0 existence confirmed in primary sources (not verified to connect) / L1 reached daily with a sealed question / L2 started, connected and tool definitions obtained / L3 task completed.' },
              label: str,
              basis: nullable(str),
              verified_on: date,
              author: str,
              verifier: nullable({ type: 'string', description: 'Only for L1 and above.' }),
              evidence: { type: 'array', items: uri, description: 'Only for L1 and above.' },
            },
          },
          failures: { type: 'array', items: uri, description: 'Machine-readable field notes about this service.' },
          sources: { type: 'array', items: uri },
          accessed_on: date,
          manifest: uri,
          generated_on: date,
          mcpServer: { type: 'object', description: 'Only on kansei-link-mcp: the same content as the MCP Registry server.json.' },
        },
      },
      UaClassCounts: {
        type: 'object',
        required: ['ai_crawler', 'mcp_client', 'browser', 'unknown'],
        properties: Object.fromEntries(['ai_crawler', 'mcp_client', 'browser', 'unknown'].map((k) => [k, { type: 'integer', minimum: 0 }])),
      },
      Counter: counter,
      Stats: {
        type: 'object',
        required: ['since', 'generated_at', 'totals', 'ai_crawlers', 'entries', 'openapi'],
        properties: {
          since: { type: 'string', format: 'date-time', description: 'When this server process started.' },
          generated_at: { type: 'string', format: 'date-time' },
          note: str,
          totals: {
            type: 'object',
            required: ['entries', 'entries_by_ua_class', 'openapi', 'stats', 'not_found', 'bad_request'],
            properties: {
              entries: { type: 'integer', minimum: 0 },
              entries_by_ua_class: { $ref: '#/components/schemas/UaClassCounts' },
              openapi: { type: 'integer', minimum: 0 },
              stats: { type: 'integer', minimum: 0 },
              not_found: { type: 'integer', minimum: 0 },
              bad_request: { type: 'integer', minimum: 0 },
            },
          },
          ai_crawlers: { type: 'object', description: 'Fetches by known AI crawler name.', additionalProperties: { type: 'integer', minimum: 0 } },
          entries: { type: 'object', description: 'Per service_id.', additionalProperties: { $ref: '#/components/schemas/Counter' } },
          openapi: { $ref: '#/components/schemas/Counter' },
        },
      },
      Problem: {
        type: 'object',
        description: 'RFC 9457 problem details.',
        required: ['type', 'title', 'status', 'detail', 'instance'],
        properties: {
          type: { type: 'string', format: 'uri', enum: [`${SITE}/problems/ard-entry-not-found`, `${SITE}/problems/bad-request`] },
          title: str,
          status: { type: 'integer', enum: [400, 404] },
          detail: str,
          instance: { type: 'string', pattern: '^urn:kansei:request:.+$' },
        },
      },
    },
  },
};

// ─── HTML ───────────────────────────────────────────────────────────
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STYLE = `:root{--b:#1a3fd6;--i:#101828;--m:#667085;--l:#e4e7ec;--s:#f4f5fd}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--i);line-height:1.85}nav,main,footer{max-width:1000px;margin:auto;padding:20px 28px}nav{display:flex;justify-content:space-between;border-bottom:1px solid var(--l)}a{color:var(--b)}.brand{font-size:22px;font-weight:800;text-decoration:none}.hero{background:linear-gradient(135deg,#0a1628,#1a3fd6);color:#fff;padding:52px 28px}.hero>div{max-width:1000px;margin:auto}.hero h1{font-size:clamp(26px,4.2vw,40px);line-height:1.35;margin:.2em 0}.hero p{font-size:17px;opacity:.92}h2{margin-top:46px;border-left:5px solid var(--b);padding-left:14px}.rule{background:var(--s);border-left:5px solid var(--b);padding:14px 18px;margin:18px 0}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}th,td{border-bottom:1px solid var(--l);padding:9px 10px;text-align:left;vertical-align:top}th{background:var(--s);white-space:nowrap}code{background:var(--s);padding:1px 5px;border-radius:4px;font-size:13px}.lv{display:inline-block;padding:1px 9px;border-radius:999px;font-weight:700;font-size:13px;white-space:nowrap}.lv0{background:#f2f4f7;color:#475467}.lv1,.lv2,.lv3{background:#e7f6ec;color:#067647}.note{color:var(--m);font-size:14px}footer{border-top:1px solid var(--l);margin-top:60px;color:var(--m)}`;
function page({ path, title, description, hero, body, extraHead = '' }) {
  const url = `${SITE}${path}`;
  return `<!DOCTYPE html><html lang="ja"><head>
${GA_SNIPPET}<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | KanseiLink</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow"><link rel="canonical" href="${url}">
${extraHead}<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:url" content="${url}"><meta property="og:locale" content="ja_JP">
<style>${STYLE}</style>
</head>
<body><nav><a class="brand" href="/">KanseiLink</a><a href="/ard/">ARD の一覧</a></nav>
<header class="hero"><div>${hero}</div></header>
<main>
${body}
</main>
<footer>© 2026 <a href="https://synapsearrows.com">Synapse Arrows Pte. Ltd.</a> · <a href="/ard/">ARD の一覧</a> · <a href="/insights/">Research &amp; Insights</a> · <a href="/independence.html">独立性のポリシー</a></footer>
</body></html>
`;
}
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;

function entryRow(r) {
  const links = [
    r.repo_url ? link(r.repo_url, '公式リポジトリ') : null,
    r.docs_url ? link(r.docs_url, '公式の文書') : null,
    r.announcement_url ? link(r.announcement_url, `発表${r.announcement_date ? `（${r.announcement_date}）` : ''}`) : null,
  ].filter(Boolean).join('<br>');
  const proof = [
    ...r.evidence.map((u) => link(u, `証拠: ${u.split('/').pop()}`)),
    ...r.failures.map((u) => link(u, '現場メモ（JSON）')),
  ].join('<br>');
  const stage = r.level === 'L0'
    ? `<span class="lv lv0">L0 存在確認のみ</span>`
    : `<span class="lv lv${r.level[1]}">${esc(r.level)} ${esc(authored.levels[r.level].split('（')[0])}</span><br><span class="note">${esc(r.level_basis)}</span>`;
  return `<tr id="${esc(r.service_id)}"><td><strong>${esc(r.display_name)}</strong><br><span class="note">${esc(r.product)}</span></td><td>${stage}${proof ? `<br>${proof}` : ''}</td><td>${esc(hostingJa(r.hosting))}</td><td>${esc(authLabel(r))}</td><td>${links || '—'}</td><td>${link(cardUrl(r.service_id), 'JSON')}<br><span class="note">確認日 ${esc(r.verified_on)}</span></td></tr>`;
}
const GROUP_ORDER = ['会計・人事', 'ワークフロー・経費', 'グループウェア・連絡', '営業・CRM', 'EC・決済', '開発・運用', '該当なし'];
const third = records.filter((r) => r !== self);
const groups = GROUP_ORDER.map((g) => [g, third.filter((r) => r.use_case_group === g)]).filter(([, rs]) => rs.length);
const leftover = third.filter((r) => !GROUP_ORDER.includes(r.use_case_group));
if (leftover.length) throw new Error(`用途の束が一覧に無い: ${leftover.map((r) => r.use_case_group).join(', ')}`);
const TABLE_HEAD = '<tr><th>製品（会社）</th><th>記録の段階</th><th>提供形態</th><th>認証</th><th>公式の所在・一次資料</th><th>カード</th></tr>';
const countBy = (lv) => records.filter((r) => r.level === lv).length;
const verifiedCount = records.filter((r) => r.level !== 'L0').length;

// 外した会社の製品名・会社名・理由の詳細は書かない。数と、足す日だけ
const dayAfter = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const withheldNote = withheld.length
  ? `\n<p class="note">${withheld.length} 件は観測期間中のため ${dayAfter([...withheld].sort().pop())} 以降に追加します。</p>`
  : '';

const ardIndex = page({
  path: '/ard/',
  title: '日本の SaaS の公式 MCP — ARD の一覧（記録の段階つき）',
  description: `日本の SaaS ${third.length} 社の公式 MCP と KanseiLINK 自身の MCP を、ARD（Agentic Resource Discovery）のエントリとして公開。各記録に段階（L0 存在確認〜L3 業務完了確認）を付け、存在確認だけの記録を検証済みとは書きません。`,
  extraHead: `<link rel="ard" href="/.well-known/ard.json">\n`,
  hero: `<div>ARD · 段階 A · ${esc(TODAY)}</div>
<h1>日本の SaaS の公式 MCP — ARD の一覧</h1>
<p>AI エージェントが「どこに公式の MCP があるか」を機械で見つけられるように、私たちの記録を ARD（Agentic Resource Discovery）の形で公開しています。人が読むための一覧がこのページです。</p>`,
  body: `<h2>これは何か</h2>
<p>機械向けの本体は ${link('/.well-known/ard.json', '/.well-known/ard.json')}（${manifest.entries.length} エントリ）です。日本の SaaS ${third.length} 社の公式 MCP、KanseiLINK 自身の MCP サーバー、この一覧を取得する API の定義（OpenAPI）が入っています。順位でも評価でもなく、一次資料で確かめた所在の記録です。</p>
<div class="rule"><strong>記録の段階 — 存在確認だけの記録を「検証済み」とは書きません</strong><br>
・<strong>L0 存在確認</strong>: 提供者自身の発表・文書・リポジトリで、公式の MCP があることを確かめた。<strong>つながるかどうかは確かめていません。</strong><br>
・<strong>L1 到達確認</strong>: 封印した問いで、AI が公式の所在に辿り着けるかを毎日測った。<br>
・<strong>L2 接続確認</strong>: 実際に起動・接続して、操作の定義を取得した。<br>
・<strong>L3 業務完了確認</strong>: 業務を最後まで終えた。今は該当なし。<br>
今の内訳: L0 が ${countBy('L0')} 件、L1 以上が ${verifiedCount} 件（${records.filter((r) => r.level !== 'L0').map((r) => esc(r.display_name)).join('・')}）。</div>${withheldNote}
<p class="note">「問いの例」（representativeQueries）は KanseiLINK が書いた物で、提供者の言葉ではありません。提供形態と認証は一次資料に書かれていた範囲で、書かれていなければ「一次資料に記載なし」としています。作成主体は <code>${AUTHOR}</code>、L1 以上の検証主体は <code>${VERIFIER}</code> です。</p>
${groups.map(([g, rs]) => `<h2>${esc(g === '該当なし' ? 'その他（用途の束に該当なし）' : g)}（${rs.length}）</h2>
<div class="wrap"><table><thead>${TABLE_HEAD}</thead><tbody>
${rs.map(entryRow).join('\n')}
</tbody></table></div>`).join('\n')}
<h2>KanseiLINK 自身</h2>
<div class="wrap"><table><thead>${TABLE_HEAD}</thead><tbody>
${entryRow(self)}
<tr id="ard-entries-api"><td><strong>${esc(oa.display_name)}</strong><br><span class="note">${esc(oa.description)}</span></td><td><span class="note">段階の対象外（API の定義）</span></td><td>提供者が運用</td><td>none</td><td>—</td><td>${link(`${SERVER}/ard/openapi.json`, 'JSON')}</td></tr>
</tbody></table></div>
<h2>機械で読む人へ</h2>
<p>・manifest: ${link('/.well-known/ard.json', `${SITE}/.well-known/ard.json`)}（仕様: ${esc(ARD_SPEC)}）<br>
・<code>kansei:</code> の語の定義: ${link('/ns/ard/v1.jsonld', '/ns/ard/v1.jsonld')}（説明は ${link('/ns/ard/v1.html', '/ns/ard/v1')}）<br>
・各エントリの <code>url</code> は、取得を数えるために私たちのサーバーのカードを指します。公式の所在はカードの <code>official.location</code> です。取得の数は ${link(`${SERVER}/ard/stats.json`, '/ard/stats.json')} に出しています（記録するのは時刻・経路・User-Agent・Referer・Accept だけで、IP は記録しません）。<br>
・エラーは RFC 9457 の形で返します: ${link('/problems/ard-entry-not-found.html', 'ard-entry-not-found')}・${link('/problems/bad-request.html', 'bad-request')}</p>
<p class="note">記録の誤りの指摘・訂正は ${link('/independence.html', '独立性のポリシー')} の窓口へ。提供者からの訂正は一次資料に合わせて直します。</p>`,
});

const nsPage = page({
  path: '/ns/ard/v1.html',
  title: 'kansei: 名前空間（ARD エントリに足している語）v1',
  description: 'KanseiLINK が ARD のエントリに足している語（記録の段階・確認日・証拠・作成主体・検証主体など）の定義。',
  extraHead: `<link rel="alternate" type="application/ld+json" href="/ns/ard/v1.jsonld">\n`,
  hero: `<div>VOCABULARY · v1</div><h1>kansei: 名前空間</h1><p>名前空間の IRI は <code>${esc(NS)}</code>。JSON-LD の context は ${link('/ns/ard/v1.jsonld', '/ns/ard/v1.jsonld')}。</p>`,
  body: `<h2>語</h2>
<div class="wrap"><table><thead><tr><th>語</th><th>名前</th><th>意味</th></tr></thead><tbody>
${TERMS.map(([name, label, comment]) => `<tr id="${name}"><td><code>kansei:${name}</code></td><td>${esc(label)}</td><td>${esc(comment)}</td></tr>`).join('\n')}
</tbody></table></div>
<p class="note">これらの語は ${link('/.well-known/ard.json', '/.well-known/ard.json')} のエントリで使っています。人間向けの一覧は ${link('/ard/', '/ard/')}。</p>`,
});

const PROBLEM_PAGES = [
  {
    slug: 'ard-entry-not-found',
    status: 404,
    title: 'ARD のエントリが見つからない（ard-entry-not-found）',
    what: '<code>/ard/entries/&lt;service_id&gt;.json</code> に渡した <code>service_id</code> のエントリが、私たちの一覧にありません。文法は合っているが、その id の記録が無い、という意味です。',
    next: `・一覧（${link('/.well-known/ard.json', '/.well-known/ard.json')}）の <code>url</code> をそのまま使ってください。id を自分で組み立てると外れることがあります。<br>・探しているサービスが一覧に無いのは、私たちが一次資料で公式の MCP を確かめられていない、というだけです。そのサービスに MCP が無いという意味ではありません。<br>・人間向けの一覧は ${link('/ard/', '/ard/')}。`,
  },
  {
    slug: 'bad-request',
    status: 400,
    title: '要求の形が合っていない（bad-request）',
    what: '経路が <code>/ard/entries/&lt;service_id&gt;.json</code> の形になっていないか、<code>service_id</code> が文法（英小文字・数字・ハイフン、先頭は英小文字か数字、64 字まで）に合っていません。',
    next: `・末尾の <code>.json</code> を付けてください。<br>・id は ${link('/.well-known/ard.json', '/.well-known/ard.json')} の各エントリの <code>url</code> に入っている物をそのまま使ってください。<br>・経路の定義は ${link(`${SERVER}/ard/openapi.json`, '/ard/openapi.json')}（OpenAPI 3.1）にあります。`,
  },
];
const problemPage = (p) => page({
  path: `/problems/${p.slug}.html`,
  title: p.title,
  description: `KanseiLINK の /ard/* が返すエラーの型 ${p.slug}（HTTP ${p.status}）の説明。何が起きたか・次に何をするか。`,
  hero: `<div>PROBLEM TYPE · HTTP ${p.status}</div><h1>${esc(p.title)}</h1><p>type: <code>${SITE}/problems/${p.slug}</code></p>`,
  body: `<h2>何が起きたか</h2>
<p>${p.what}</p>
<h2>次に何をするか</h2>
<p>${p.next}</p>
<h2>このエラーを報告する時</h2>
<p>応答の <code>X-Request-Id</code> ヘッダ（本文の <code>instance</code> の <code>urn:kansei:request:</code> の後ろと同じ値）を添えてください。私たちの記録から同じ要求を探せます。</p>
<h2>この型のエラーに紐づく現場メモ</h2>
<p>まだ無い。</p>
<p class="note">応答の形は RFC 9457（<code>application/problem+json</code>）です。もう一つの型: ${PROBLEM_PAGES.filter((o) => o.slug !== p.slug).map((o) => link(`/problems/${o.slug}.html`, o.slug)).join('')}</p>`,
});

// ─── 書き出し ───────────────────────────────────────────────────────
const written = [];
function write(rel, content) {
  const file = join(ROOT, ...rel.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  written.push(rel);
}
write('public/.well-known/ard.json', manifest);
write('public/ns/ard/v1.jsonld', jsonldContext);
write('public/ns/ard/v1.html', nsPage);
write('public/ard/index.html', ardIndex);
for (const p of PROBLEM_PAGES) write(`public/problems/${p.slug}.html`, problemPage(p));
write('public/.well-known/mcp/server.json', serverJson);
write('server.json', serverJson);
write('src/data/ard-entries.json', { generated_on: TODAY, spec: ARD_SPEC, manifest: MANIFEST_URL, entries: cards });
write('src/data/ard-openapi.json', openapi);

// sitemap: 新しい HTML の <url> を足す（無い時だけ。ほかの行は触らない）
const sitemapFile = join(ROOT, 'public', 'sitemap.xml');
if (existsSync(sitemapFile)) {
  let xml = readFileSync(sitemapFile, 'utf8');
  const nl = xml.includes('\r\n') ? '\r\n' : '\n';
  const locs = ['/ard/', '/ns/ard/v1.html', ...PROBLEM_PAGES.map((p) => `/problems/${p.slug}.html`)].map((p) => `${SITE}${p}`);
  const add = locs.filter((loc) => !xml.includes(`<loc>${loc}</loc>`));
  if (add.length) {
    const block = add.map((loc) => `  <url>${nl}    <loc>${loc}</loc>${nl}    <lastmod>${TODAY}</lastmod>${nl}  </url>${nl}`).join('');
    xml = xml.replace('</urlset>', `${block}</urlset>`);
    writeFileSync(sitemapFile, xml);
    written.push(`public/sitemap.xml (+${add.length})`);
  }
}

const levels = Object.keys(authored.levels).map((lv) => `${lv}=${countBy(lv)}`).join(' ');
console.log(`[generate-ard] ${TODAY} entries=${manifest.entries.length} (jp-saas ${third.length} + self 1 + openapi 1) levels: ${levels}`);
console.log(`[generate-ard] withheld until after publish_after (as of ${TODAY}): ${withheld.length}`);
console.log(`[generate-ard] server.json version=${serverJson.version} remote=${serverJson.remotes[0].url}`);
if (serverJson.description !== pkg.description) console.log(`[generate-ard] server.json description を 100 字に切った: "${serverJson.description}"`);
for (const w of written) console.log(`  wrote ${w}`);
