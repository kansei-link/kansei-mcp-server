// ask-line.mjs — the one visible line that tells a reader (human or agent) how to ask about an error.
// Shared by scripts/add-ask-line.mjs (writes it) and scripts/site-gate.mjs (checks it).
// Decision: DESIGN-ask-v1 §5 / §9-3 (Michie 2026-10-20) — visible, not imperative, not hidden.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ASK_BASE = 'https://kansei-link-mcp-production.up.railway.app/api/v1/ask';
export const OPEN = '<!-- ask-line -->';
export const CLOSE = '<!-- /ask-line -->';
export const WRITE_DOCS = 'https://kansei-link.com/agents/write.html';
export const MCP_URL = 'https://mcp.kansei-link.com/mcp';
export const BLOCK_RE = /<!-- ask-line -->([\s\S]*?)<!-- \/ask-line -->/g;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = 'margin:12px 0 0;padding:8px 12px;border:1px solid #e4e7ec;border-radius:6px;background:#f4f5fd;font-size:13px;line-height:1.55;color:#475467;';

/** The sentence itself. `<id>` and `<Name>` are filled in; the placeholders for the message stay visible. */
export function askLineHtml({ id, name, lang }) {
  const url = `${ASK_BASE}?service=${encodeURIComponent(id)}&amp;error=`;
  if (lang === 'ja') {
    return `<p class="ask-line" lang="ja" style="${STYLE}">${esc(name)} のエラーで止まったら: <code>GET ${url}&lt;短いエラー文&gt;</code> で、確認済みの解決策（あれば）と公式ドキュメントが返ります。読み取りだけで、何も公開されません。エラー文に鍵やトークンを入れないでください。長い文は同じ欄を JSON で POST。解決したら・しなかったら: 書き戻し方 → <a href="https://kansei-link.com/agents/write.html">/agents/write.html</a><br>MCP で使うなら: <code>claude mcp add --transport http kansei-link ${MCP_URL}</code> → <code>lookup({ service_id: "${esc(id)}" })</code>（鍵なし・オフラインは <code>npx -y @kansei-link/mcp-server</code>）</p>`;
  }
  return `<p class="ask-line" lang="en" style="${STYLE}">Stuck on an error with ${esc(name)}? <code>GET ${url}&lt;short message&gt;</code> returns any checked fixes on file and the official docs. Read-only; nothing is published. Leave secrets out of the message; for long error text, POST the same fields as JSON. Solved it, or not? How to write back: <a href="https://kansei-link.com/agents/write.html">/agents/write.html</a><br>Over MCP: <code>claude mcp add --transport http kansei-link ${MCP_URL}</code> then <code>lookup({ service_id: "${esc(id)}" })</code> (no key; offline: <code>npx -y @kansei-link/mcp-server</code>)</p>`;
}

/** Wrapped in the markers. `wrap` adds a container for pages whose text does not sit in a column (service pages). */
export function askLineBlock(opts, { wrap = false } = {}) {
  const inner = askLineHtml(opts);
  return `${OPEN}${wrap ? `<div style="max-width:720px;margin:0 auto 36px;padding:0 24px;">${inner}</div>` : inner}${CLOSE}`;
}

/** Service ids the production ask accepts = the ids in services-seed.json (same source as the production DB). */
export function seedServiceIds(root) {
  const seed = JSON.parse(readFileSync(resolve(root, 'src', 'data', 'services-seed.json'), 'utf8'));
  const arr = Array.isArray(seed) ? seed : seed.services || [];
  return new Set(arr.map((s) => s.id));
}

/** Problems with the ask-line in one HTML string: unbalanced markers, more than one block, or an id the ask would 404 on. */
export function checkAskLine(html, ids) {
  const out = [];
  const opens = html.split(OPEN).length - 1;
  const closes = html.split(CLOSE).length - 1;
  if (opens !== closes) out.push(`印が対になっていない（開き ${opens}・閉じ ${closes}）`);
  if (opens > 1) out.push(`ask-line が ${opens} 個ある（1 個まで）`);
  for (const m of html.matchAll(BLOCK_RE)) {
    const idm = m[1].match(/[?&](?:amp;)?service=([^&"<\s]+)/);
    if (!idm) { out.push('ask-line に service= が無い'); continue; }
    const id = decodeURIComponent(idm[1]);
    if (!ids.has(id)) out.push(`ask-line の service id "${id}" が services-seed.json に無い（ask は 404 を返す）`);
  }
  return out;
}
