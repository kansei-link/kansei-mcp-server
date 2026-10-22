#!/usr/bin/env node
// tier1-snapshot.mjs — 第 1 段（src/data/tier1.json の 20 サービス）の出典ごとの値を 1 つの JSON に記録し、
// 前回の JSON と比べて差分を「小・中・大・取得失敗」に分ける。
//
// 設計: founder-ops/research/Freshness_2026-10/DESIGN-tier1-source-diff-v0.md（Michie 承認 2026-10-22）
//   公式 MCP Registry … 件数・名前・版・isLatest・説明   版だけ→小／新規登録・説明の変化→中
//   npm               … 版・公開日                      版だけ→小
//   GitHub            … 最新リリース・README の認証の節    リリース→小／認証の節の変化→大
//   公式の文書         … 正規化した本文の sha256・該当行    該当行の変化→大／それ以外→記録だけ
//   接続先（公開物のみ）… HTTP 状態・/.well-known/oauth-authorization-server の主な欄
//                                                       状態が 2xx/4xx 以外→大／欄の変化→大
//   お知らせ           … 「MCP」を含む見出し               新しい見出し→中
//   取得に失敗した出典  … 「取得失敗」（ページの移転・廃止の兆し）
//
// 依存なし（Node 20+ の fetch）。認証が要る接続先には繋がない（鍵を持たない）。スクリーンショットは使わない。
//
// 使い方:
//   node scripts/tier1-snapshot.mjs --out tier1/2026-10-27.json [--prev tier1/2026-10-20.json] [--diff diff.json] [--only garoon,chatwork]
//   終了コード: 0。差分やエラーは JSON に書く（CI の失敗にしない）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'kansei-tier1-diff/0.1 (+https://kansei-link.com; weekly freshness check)';
const TIMEOUT = 25_000;

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out'); const PREV = opt('--prev'); const DIFF = opt('--diff');
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
if (!OUT) { console.error('usage: --out <file> [--prev <file>] [--diff <file>] [--only id,id]'); process.exit(2); }

const sha = (s) => createHash('sha256').update(s).digest('hex');
const trunc = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

async function get(url, accept = 'text/html,application/json;q=0.9,*/*;q=0.8') {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  return { status: r.status, url: r.url, text };
}
// Every source returns { ok, value } or { ok:false, error }. Errors are strings only (no stack, no headers).
async function tryGet(fn) { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: trunc(String(e?.message || e), 200) }; } }

// ── 公式 MCP Registry ──
async function registry(q) {
  const { status, text } = await get(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=100`, 'application/json');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const j = JSON.parse(text);
  const servers = (j.servers || []).map((x) => ({
    name: x.server?.name, version: x.server?.version,
    is_latest: Boolean(x._meta?.['io.modelcontextprotocol.registry/official']?.isLatest),
    description: trunc(x.server?.description || '', 300),
    remote: x.server?.remotes?.[0]?.url || null,
  })).sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));
  return { count: servers.length, servers };
}

// ── npm ──
async function npm(name) {
  const { status, text } = await get(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`, 'application/json');
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const j = JSON.parse(text);
  const latest = j['dist-tags']?.latest || null;
  return { version: latest, published_at: latest ? (j.time?.[latest] || null) : null };
}

// ── GitHub: latest release + README auth section ──
const AUTH_HEADING = /認証|authentication|authorization|環境変数|environment variables|configuration|設定|credentials|token|api key|セットアップ|setup/i;
function authSection(md) {
  const lines = md.split(/\r?\n/);
  const out = []; let level = 0; let on = false;
  for (const l of lines) {
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (on && h[1].length <= level) on = false;
      if (!on && AUTH_HEADING.test(h[2])) { on = true; level = h[1].length; out.push(h[0]); continue; }
    }
    if (on) out.push(l);
  }
  return out.join('\n').replace(/\s+/g, ' ').trim();
}
async function github(repo) {
  const rel = await get(`https://api.github.com/repos/${repo}/releases/latest`, 'application/vnd.github+json');
  let release = null;
  if (rel.status === 200) { const j = JSON.parse(rel.text); release = { tag: j.tag_name, published_at: j.published_at }; }
  else if (rel.status === 404) {
    const tags = await get(`https://api.github.com/repos/${repo}/tags?per_page=1`, 'application/vnd.github+json');
    if (tags.status === 200) { const t = JSON.parse(tags.text)[0]; release = t ? { tag: t.name, published_at: null, from: 'tags' } : null; }
    else throw new Error(`tags HTTP ${tags.status}`);
  } else throw new Error(`releases HTTP ${rel.status}`);
  const readme = await get(`https://raw.githubusercontent.com/${repo}/HEAD/README.md`, 'text/plain');
  if (readme.status !== 200) throw new Error(`README HTTP ${readme.status}`);
  const auth = authSection(readme.text);
  return { release, readme_sha256: sha(readme.text), auth_section: { sha256: sha(auth), length: auth.length, text: trunc(auth, 1500) } };
}

// ── 公式の文書: normalised body + relevant lines ──
const RELEVANT = /\bMCP\b|OAuth|トークン|\btoken\b|認証|authenticat|authoriz|client[_ ]?id|https?:\/\/[^\s"'<>）)]+\/mcp\b|\/\.well-known\//i;
function htmlToText(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' '); // 広告・導線の塊
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  return s;
}
function normalise(text) {
  return text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3)
    // 日付・時刻・閲覧数など、内容が同じでも毎回変わる物を落とす
    .map((l) => l.replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, '<date>').replace(/\d{1,2}:\d{2}(:\d{2})?/g, '<time>').replace(/\b\d{1,3}(,\d{3})+\b/g, '<n>'))
    .join('\n');
}
async function docPage(url) {
  const { status, text, url: finalUrl } = await get(url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const body = normalise(htmlToText(text));
  const lines = [...new Set(body.split('\n').filter((l) => RELEVANT.test(l)).map((l) => trunc(l, 300)))].slice(0, 80);
  return { final_url: finalUrl !== url ? finalUrl : undefined, sha256: sha(body), length: body.length, relevant_lines: lines, relevant_sha256: sha(lines.join('\n')) };
}

// ── お知らせ: headings containing MCP ──
async function newsPage(url) {
  const { status, text } = await get(url);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const heads = [];
  for (const m of text.matchAll(/<(h[1-4]|a|li|dt|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
    if (/\bMCP\b/i.test(t) && t.length >= 6 && t.length <= 200) heads.push(t);
  }
  return { mcp_headings: [...new Set(heads)].slice(0, 50) };
}

// ── 接続先（公開物のみ・認証しない）──
const WK_FIELDS = ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'client_id_metadata_document_supported', 'scopes_supported', 'code_challenge_methods_supported', 'grant_types_supported'];
async function endpoint(url) {
  const r = await fetch(url, { method: 'GET', headers: { 'user-agent': UA, accept: 'application/json, text/event-stream' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
  const status = r.status;
  const origin = new URL(url).origin;
  let well_known = null; let wk_status = null;
  try {
    const w = await get(`${origin}/.well-known/oauth-authorization-server`, 'application/json');
    wk_status = w.status;
    if (w.status === 200) { const j = JSON.parse(w.text); well_known = Object.fromEntries(WK_FIELDS.filter((k) => k in j).map((k) => [k, j[k]])); }
  } catch (e) { wk_status = `error: ${trunc(String(e?.message || e), 100)}`; }
  return { status, well_known_status: wk_status, well_known };
}

// ── run ──
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'src/data/tier1.json'), 'utf8'));
const prev = PREV ? JSON.parse(readFileSync(resolve(PREV), 'utf8')) : null;
const snap = { schema: 'tier1-snapshot/0', date: new Date().toISOString().slice(0, 10), generated_at: new Date().toISOString(), tier1_as_of: cfg.as_of, services: {} };

for (const s of cfg.services) {
  if (ONLY && !ONLY.has(s.id)) continue;
  const rec = { name: s.name, group: s.group, sources: {} };
  if (s.registry_search) rec.sources[`registry:${s.registry_search}`] = { kind: 'registry', url: `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(s.registry_search)}`, ...(await tryGet(() => registry(s.registry_search))) };
  if (s.npm) rec.sources[`npm:${s.npm}`] = { kind: 'npm', url: `https://www.npmjs.com/package/${s.npm}`, ...(await tryGet(() => npm(s.npm))) };
  if (s.github_repo) rec.sources[`github:${s.github_repo}`] = { kind: 'github', url: `https://github.com/${s.github_repo}`, ...(await tryGet(() => github(s.github_repo))) };
  for (const u of s.docs || []) rec.sources[`doc:${u}`] = { kind: 'doc', url: u, ...(await tryGet(() => docPage(u))) };
  if (s.endpoint) rec.sources[`endpoint:${s.endpoint}`] = { kind: 'endpoint', url: s.endpoint, ...(await tryGet(() => endpoint(s.endpoint))) };
  for (const u of s.news || []) rec.sources[`news:${u}`] = { kind: 'news', url: u, ...(await tryGet(() => newsPage(u))) };
  snap.services[s.id] = rec;
  const n = Object.values(rec.sources); const bad = n.filter((x) => !x.ok).length;
  console.error(`${s.id}: ${n.length} sources, ${bad} failed`);
}
mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(resolve(OUT), JSON.stringify(snap, null, 1) + '\n');

// ── diff ──
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function diffSources(id, name, cur, before) {
  const out = [];
  const push = (level, key, src, field, prevV, nowV, note) => out.push({ level, service: id, service_name: name, source: key, kind: src.kind, url: src.url, field, before: prevV ?? null, after: nowV ?? null, note: note || undefined });
  for (const [key, src] of Object.entries(cur.sources)) {
    const old = before?.sources?.[key];
    if (!src.ok) { push('failed', key, src, 'fetch', old?.ok ? 'ok' : (old ? 'failed' : null), src.error); continue; }
    if (!old || !old.ok) continue; // 前回が無い／失敗 → 比べない（今回の値は記録に残る）
    const a = old.value, b = src.value;
    switch (src.kind) {
      case 'registry': {
        const byName = (list) => new Map(list.map((x) => [x.name, x]));
        const A = byName(a.servers.filter((x) => x.is_latest)), B = byName(b.servers.filter((x) => x.is_latest));
        for (const [n, y] of B) {
          const x = A.get(n);
          if (!x) { push('medium', key, src, `new registration ${n}`, null, y.version); continue; }
          if (x.version !== y.version) push('small', key, src, `version ${n}`, x.version, y.version);
          if (x.description !== y.description) push('medium', key, src, `description ${n}`, x.description, y.description);
          if (x.remote !== y.remote) push('medium', key, src, `remote ${n}`, x.remote, y.remote);
        }
        for (const n of A.keys()) if (!B.has(n)) push('medium', key, src, `gone ${n}`, A.get(n).version, null);
        break;
      }
      case 'npm': if (a.version !== b.version) push('small', key, src, 'version', a.version, b.version); break;
      case 'github':
        if (!same(a.release, b.release)) push('small', key, src, 'release', a.release?.tag, b.release?.tag);
        if (a.auth_section.sha256 !== b.auth_section.sha256) push('large', key, src, 'README auth section', trunc(a.auth_section.text, 600), trunc(b.auth_section.text, 600));
        break;
      case 'doc':
        if (a.relevant_sha256 !== b.relevant_sha256) {
          const gone = a.relevant_lines.filter((l) => !b.relevant_lines.includes(l)), added = b.relevant_lines.filter((l) => !a.relevant_lines.includes(l));
          push('large', key, src, 'relevant lines', gone.join('\n'), added.join('\n'));
        } else if (a.sha256 !== b.sha256) push('note', key, src, 'body (non-relevant)', a.sha256.slice(0, 12), b.sha256.slice(0, 12));
        break;
      case 'endpoint': {
        const okStatus = (s) => (s >= 200 && s < 300) || (s >= 400 && s < 500);
        if (!okStatus(b.status)) push('large', key, src, 'HTTP status', a.status, b.status);
        else if (a.status !== b.status) push('note', key, src, 'HTTP status', a.status, b.status);
        if (!same(a.well_known, b.well_known)) push('large', key, src, 'oauth-authorization-server', a.well_known, b.well_known);
        break;
      }
      case 'news': {
        const added = b.mcp_headings.filter((h) => !a.mcp_headings.includes(h));
        if (added.length) push('medium', key, src, 'new MCP heading', null, added.join('\n'));
        break;
      }
    }
  }
  return out;
}
if (DIFF) {
  const items = [];
  if (prev) for (const [id, cur] of Object.entries(snap.services)) items.push(...diffSources(id, cur.name, cur, prev.services?.[id]));
  else for (const [id, cur] of Object.entries(snap.services)) for (const [key, src] of Object.entries(cur.sources)) if (!src.ok) items.push({ level: 'failed', service: id, service_name: cur.name, source: key, kind: src.kind, url: src.url, field: 'fetch', before: null, after: src.error });
  const count = (lv) => items.filter((x) => x.level === lv).length;
  const diff = { schema: 'tier1-diff/0', date: snap.date, prev_date: prev?.date || null, first_run: !prev,
    counts: { small: count('small'), medium: count('medium'), large: count('large'), failed: count('failed'), note: count('note') }, items };
  writeFileSync(resolve(DIFF), JSON.stringify(diff, null, 1) + '\n');
  console.error(`diff vs ${prev?.date || '(none)'}: small ${diff.counts.small} / medium ${diff.counts.medium} / large ${diff.counts.large} / failed ${diff.counts.failed} / note ${diff.counts.note}`);
}
