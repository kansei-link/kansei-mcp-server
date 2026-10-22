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
//   取得に失敗した出典  … 名前解決できない・404 →「取得失敗」（ページの移転・廃止の兆し・すぐ Issue）
//                        タイムアウト・5xx・接続切れ → 「一時的」（記録だけ・2 週続けば「取得失敗」）
//                        403/429（ブラウザ UA で取り直しても）→「CI から拒否」（記録だけ・Issue は立てない）
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
// 403/429 で「手元では取れる」型は、1 回だけ普通のブラウザに近い UA で取り直す（fix1: 初回の雑音 12 件のうち 3 件）。
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT = 25_000;
const REGISTRY_TIMEOUT = 60_000; // Registry は遅い（20 秒では時々切れる・60 秒なら返る）
const REGISTRY_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out'); const PREV = opt('--prev'); const DIFF = opt('--diff');
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
if (!OUT) { console.error('usage: --out <file> [--prev <file>] [--diff <file>] [--only id,id]'); process.exit(2); }

const sha = (s) => createHash('sha256').update(s).digest('hex');
const trunc = (s, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

// Failure kinds (fix1):
//   refused   … 403/429 のまま（ブラウザ UA で取り直しても）＝CI からの取得を拒まれている。記録だけ・Issue は立てない
//   permanent … 名前解決できない（ENOTFOUND）・404/410 ＝ページの移転や廃止の兆し。すぐ Issue
//   transient … タイムアウト・5xx・接続切れ ＝ 2 週続いた時だけ Issue
class FetchFailure extends Error { constructor(kind, message) { super(message); this.kind = kind; } }
const httpFailure = (status) => new FetchFailure(status === 403 || status === 429 ? 'refused' : (status === 404 || status === 410) ? 'permanent' : 'transient', `HTTP ${status}`);
function classifyError(e) {
  if (e instanceof FetchFailure) return e;
  const code = e?.cause?.code || e?.code || '';
  const msg = String(e?.message || e);
  if (/ENOTFOUND|EAI_AGAIN/.test(code) || /ENOTFOUND|getaddrinfo/.test(msg)) return new FetchFailure('permanent', `名前解決できない（${code || 'ENOTFOUND'}）`);
  if (e?.name === 'TimeoutError' || /timeout|aborted/i.test(msg)) return new FetchFailure('transient', 'timeout');
  return new FetchFailure('transient', trunc(`${msg}${code ? ` (${code})` : ''}`, 200));
}
async function get(url, accept = 'text/html,application/json;q=0.9,*/*;q=0.8', { timeout = TIMEOUT, retryRefusedWithBrowserUa = true } = {}) {
  const once = async (ua) => {
    const r = await fetch(url, { headers: { 'user-agent': ua, accept, 'accept-language': 'ja,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    return { status: r.status, url: r.url, text: await r.text() };
  };
  let res = await once(UA);
  if ((res.status === 403 || res.status === 429) && retryRefusedWithBrowserUa) { await sleep(2000); res = await once(BROWSER_UA); res.retried_with_browser_ua = true; }
  return res;
}
const expect200 = (res) => { if (res.status !== 200) throw httpFailure(res.status); return res; };
// Every source returns { ok, value } or { ok:false, failure_kind, error }. Errors are strings only (no stack, no headers).
async function tryGet(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { const f = classifyError(e); return { ok: false, failure_kind: f.kind, error: trunc(f.message, 200) }; }
}

// ── 公式 MCP Registry ──
// fix2: 時間を測って記録する（原因＝遅い／拒否／特定の語だけ、を実行ごとに見分けるため）。
const registryTimings = []; // { q, attempt, ms, status }
async function registryProbe() {
  // 実行の最初に 1 回だけ、軽い問い合わせ（limit=1）で Registry の応答時間と状態を測る。結果は snapshot の meta とログに残す。
  const t0 = Date.now();
  try {
    const { status } = await get('https://registry.modelcontextprotocol.io/v0/servers?limit=1', 'application/json', { timeout: REGISTRY_TIMEOUT, retryRefusedWithBrowserUa: false });
    const ms = Date.now() - t0;
    console.error(`registry probe: HTTP ${status} in ${ms} ms`);
    return { status, ms };
  } catch (e) {
    const ms = Date.now() - t0; const f = classifyError(e);
    console.error(`registry probe: ${f.kind} (${f.message}) after ${ms} ms`);
    return { status: null, ms, error: f.message, kind: f.kind };
  }
}
async function registry(q) {
  // 60 秒・最大 3 回（間を空けて）。最後の失敗だけを返す。各回の時間を記録する。
  let last;
  for (let attempt = 1; attempt <= REGISTRY_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    try {
      const { status, text } = await get(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=100`, 'application/json', { timeout: REGISTRY_TIMEOUT, retryRefusedWithBrowserUa: false });
      registryTimings.push({ q, attempt, ms: Date.now() - t0, status });
      if (status !== 200) throw httpFailure(status);
      return parseRegistry(JSON.parse(text));
    } catch (e) {
      last = e;
      const f = classifyError(e);
      if (!registryTimings.some((t) => t.q === q && t.attempt === attempt)) registryTimings.push({ q, attempt, ms: Date.now() - t0, status: null, error: f.message });
      if (f.kind !== 'transient' || attempt === REGISTRY_ATTEMPTS) break;
      console.error(`  registry ${q}: attempt ${attempt} failed (${f.message}) after ${Date.now() - t0} ms, retrying`);
      await sleep(5_000 * attempt);
    }
  }
  throw last;
}
function parseRegistry(j) {
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
  const { text } = expect200(await get(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`, 'application/json'));
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
    else throw httpFailure(tags.status);
  } else throw httpFailure(rel.status);
  const readme = expect200(await get(`https://raw.githubusercontent.com/${repo}/HEAD/README.md`, 'text/plain'));
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
  const { text, url: finalUrl, retried_with_browser_ua } = expect200(await get(url));
  const body = normalise(htmlToText(text));
  const lines = [...new Set(body.split('\n').filter((l) => RELEVANT.test(l)).map((l) => trunc(l, 300)))].slice(0, 80);
  return { final_url: finalUrl !== url ? finalUrl : undefined, browser_ua: retried_with_browser_ua || undefined, sha256: sha(body), length: body.length, relevant_lines: lines, relevant_sha256: sha(lines.join('\n')) };
}

// ── お知らせ: headings containing MCP ──
async function newsPage(url) {
  const { text, retried_with_browser_ua } = expect200(await get(url));
  const heads = [];
  for (const m of text.matchAll(/<(h[1-4]|a|li|dt|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
    if (/\bMCP\b/i.test(t) && t.length >= 6 && t.length <= 200) heads.push(t);
  }
  return { browser_ua: retried_with_browser_ua || undefined, mcp_headings: [...new Set(heads)].slice(0, 50) };
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
const snap = { schema: 'tier1-snapshot/0', date: new Date().toISOString().slice(0, 10), generated_at: new Date().toISOString(), tier1_as_of: cfg.as_of, meta: {}, services: {} };
snap.meta.registry_probe = await registryProbe();

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
  const n = Object.values(rec.sources); const bad = n.filter((x) => !x.ok);
  console.error(`${s.id}: ${n.length} sources, ${bad.length} failed${bad.length ? ` (${bad.map((x) => x.failure_kind).join(',')})` : ''}`);
  await sleep(1_500); // サービス間も少し間を空ける（Registry に続けて当てない）
}
snap.meta.registry_timings = registryTimings;
{
  const ok = registryTimings.filter((t) => t.status === 200), bad = registryTimings.filter((t) => t.status !== 200);
  const avg = ok.length ? Math.round(ok.reduce((a, t) => a + t.ms, 0) / ok.length) : null;
  const max = ok.length ? Math.max(...ok.map((t) => t.ms)) : null;
  console.error(`registry timings: ok ${ok.length} (avg ${avg} ms, max ${max} ms) / failed attempts ${bad.length}${bad.length ? ` [${bad.map((t) => `${t.q}#${t.attempt} ${t.error || t.status} ${t.ms}ms`).join(', ')}]` : ''}`);
}
mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(resolve(OUT), JSON.stringify(snap, null, 1) + '\n');

// ── diff ──
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// fix2: 「2 週続いたら」は日付で数える。前回の記録が 6 日以上前（＝前の週の実行）で、かつ今回も失敗の時だけ Issue。
// 同じ週の手動実行（同じ日・数日後）は数えない。
const TRANSIENT_MIN_GAP_DAYS = 6;
const prevAgeDays = prev?.date ? Math.round((new Date(snap.date) - new Date(prev.date)) / 86_400_000) : null;
function diffSources(id, name, cur, before) {
  const out = [];
  const push = (level, key, src, field, prevV, nowV, note) => out.push({ level, service: id, service_name: name, source: key, kind: src.kind, url: src.url, field, before: prevV ?? null, after: nowV ?? null, note: note || undefined });
  for (const [key, src] of Object.entries(cur.sources)) {
    const old = before?.sources?.[key];
    if (!src.ok) {
      // fix1: 失敗の種類で分ける。refused → 記録だけ（CI から拒否）／permanent → すぐ Issue／transient → 2 週続いた時だけ Issue
      const prevWord = old ? (old.ok ? 'ok' : `failed (${old.failure_kind || '?'})`) : null;
      const kind = src.failure_kind || 'transient';
      const failedLastWeek = Boolean(old && !old.ok && prevAgeDays != null && prevAgeDays >= TRANSIENT_MIN_GAP_DAYS);
      const level = kind === 'refused' ? 'refused' : kind === 'permanent' ? 'failed' : (failedLastWeek ? 'failed' : 'transient');
      push(level, key, src, 'fetch', prevWord, src.error, kind === 'transient' && level === 'failed' ? `前の週（${prev.date}）に続けて失敗` : undefined);
      continue;
    }
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
  // 初回（前回なし）も同じ分け方: 失敗だけが出る（permanent → failed・transient → 記録だけ・refused → CI から拒否）
  for (const [id, cur] of Object.entries(snap.services)) items.push(...diffSources(id, cur.name, cur, prev?.services?.[id]));
  const count = (lv) => items.filter((x) => x.level === lv).length;
  const diff = { schema: 'tier1-diff/1', date: snap.date, prev_date: prev?.date || null, prev_age_days: prevAgeDays, first_run: !prev, registry_probe: snap.meta.registry_probe,
    counts: { small: count('small'), medium: count('medium'), large: count('large'), failed: count('failed'), refused: count('refused'), transient: count('transient'), note: count('note') }, items };
  writeFileSync(resolve(DIFF), JSON.stringify(diff, null, 1) + '\n');
  console.error(`diff vs ${prev?.date || '(none)'}: small ${diff.counts.small} / medium ${diff.counts.medium} / large ${diff.counts.large} / failed ${diff.counts.failed} / refused ${diff.counts.refused} / transient ${diff.counts.transient} / note ${diff.counts.note}`);
}
