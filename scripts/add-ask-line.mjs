#!/usr/bin/env node
// add-ask-line.mjs — put the one visible "ask" line on the pages where a reader meets one service.
// Idempotent: an existing <!-- ask-line -->…<!-- /ask-line --> block is replaced, never doubled.
//
// Where (INSTRUCTION-agent-ask-announce-line, 2026-10-21):
//   1. public/services/<slug>/index.html      — slug is the catalog id (checked against services-seed.json)
//   2. deep-dive articles whose subject is one service (map below; comparison pieces get nothing)
//   3. the field-notes articles (JA/EN) and agent-field-notes.json (an "ask_url" field per card; no sentence)
// Position: right after the first paragraph under the h1 (service pages: right after the hero section).
//
// Usage: node scripts/add-ask-line.mjs [--dry]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASK_BASE, askLineBlock, seedServiceIds } from './lib/ask-line.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'public');
const dry = process.argv.includes('--dry');
const ids = seedServiceIds(root);

// Deep dives: file stem → catalog id and display name. Only pieces about exactly one service.
const DEEP_DIVES = {
  'backlog-mcp-deep-dive-2026': { id: 'backlog', name: 'Backlog' },
  'freee-mcp-deep-dive-2026': { id: 'freee', name: 'freee' },
  'github-mcp-deep-dive-2026': { id: 'github', name: 'GitHub' },
  'kintone-mcp-deep-dive-2026': { id: 'kintone', name: 'kintone' },
  'linear-mcp-deep-dive-2026': { id: 'linear', name: 'Linear' },
  'moneyforward-mcp-deep-dive-2026': { id: 'moneyforward', name: 'Money Forward Cloud' },
  'notion-mcp-deep-dive-2026': { id: 'notion', name: 'Notion' },
  'slack-mcp-deep-dive-2026': { id: 'slack', name: 'Slack' },
  'smarthr-api-deep-dive-2026': { id: 'smarthr', name: 'SmartHR' },
  'stripe-mcp-deep-dive-2026': { id: 'stripe-global', name: 'Stripe' },
};
const FIELD_NOTES = { id: 'freee', name: 'freee' };

const report = { placed: { services: 0, articles: 0, fieldNotes: 0 }, unchanged: 0, skipped: [] };
const seedName = (() => {
  const seed = JSON.parse(readFileSync(resolve(root, 'src', 'data', 'services-seed.json'), 'utf8'));
  const arr = Array.isArray(seed) ? seed : seed.services || [];
  return new Map(arr.map((s) => [s.id, s.name]));
})();

function place(file, html, block, anchorRe, bucket) {
  // Remove an earlier block together with the newline we put before it, so re-running lands on the same bytes.
  const stripped = html.replace(/\n?<!-- ask-line -->[\s\S]*?<!-- \/ask-line -->/g, '');
  const m = stripped.match(anchorRe);
  if (!m) { report.skipped.push(`${rel(file)}: 差し込む位置（h1 の後の最初の段落）が見つからない`); return; }
  const at = m.index + m[0].length;
  const next = stripped.slice(0, at) + '\n' + block + stripped.slice(at);
  if (next === html) { report.unchanged++; return; }
  if (!dry) writeFileSync(file, next);
  report.placed[bucket]++;
}
const rel = (f) => f.slice(root.length + 1).split('\\').join('/');
const langOf = (html) => (/<html[^>]*lang="ja"/i.test(html) ? 'ja' : 'en');

// 1. service pages — anchor: the end of the hero section that holds the h1
for (const slug of readdirSync(resolve(pub, 'services'))) {
  const file = resolve(pub, 'services', slug, 'index.html');
  if (!existsSync(file)) continue;
  if (!ids.has(slug)) { report.skipped.push(`services/${slug}: id が services-seed.json に無い`); continue; }
  const html = readFileSync(file, 'utf8');
  const name = (seedName.get(slug) || slug).replace(/\s+MCP(\s+Server)?$/i, ''); // 'freee MCP' -> 'freee'
  place(file, html, askLineBlock({ id: slug, name, lang: langOf(html) }, { wrap: true }),
    /<h1 class="hero-name">[\s\S]*?<\/section>/, 'services');
}

// 2. deep dives — anchor: the first </p> after the h1
for (const dir of ['insights', 'en/insights']) {
  for (const f of readdirSync(resolve(pub, dir))) {
    if (!/deep-dive/.test(f) || !f.endsWith('.html')) continue;
    const stem = f.replace(/\.html$/, '');
    const map = DEEP_DIVES[stem];
    if (!map) { report.skipped.push(`${dir}/${f}: 対象サービスが一つに決まらない（表に無い）`); continue; }
    if (!ids.has(map.id)) { report.skipped.push(`${dir}/${f}: id "${map.id}" が services-seed.json に無い`); continue; }
    const file = resolve(pub, dir, f);
    const html = readFileSync(file, 'utf8');
    place(file, html, askLineBlock({ ...map, lang: langOf(html) }), /<h1[\s\S]*?<\/p>/, 'articles');
  }
}

// 3. field-notes articles — anchor: the first </p> after the h1
for (const f of ['insights/agent-field-notes-2026-10.html', 'en/insights/agent-field-notes-2026-10.html']) {
  const file = resolve(pub, f);
  if (!existsSync(file)) { report.skipped.push(`${f}: 無い`); continue; }
  const html = readFileSync(file, 'utf8');
  place(file, html, askLineBlock({ ...FIELD_NOTES, lang: langOf(html) }), /<h1[\s\S]*?<\/p>/, 'fieldNotes');
}

// 3b. agent-field-notes.json — one "ask_url" per card, derived from the card's service id
{
  const file = resolve(pub, 'insights', 'agent-field-notes.json');
  const raw = readFileSync(file, 'utf8');
  const json = JSON.parse(raw);
  let touched = 0;
  for (const it of json.items || []) {
    const idm = String(it.service || '').match(/service_id:\s*([a-z0-9-]+)/i);
    const id = idm?.[1];
    if (!id || !ids.has(id)) { report.skipped.push(`agent-field-notes.json ${it.card_id}: service id が読めないか seed に無い`); continue; }
    const url = `${ASK_BASE}?service=${encodeURIComponent(id)}`;
    if (it.ask_url !== url) { it.ask_url = url; touched++; }
  }
  const next = JSON.stringify(json, null, 2) + '\n';
  if (next !== raw) { if (!dry) writeFileSync(file, next); report.placed.fieldNotes += touched ? 1 : 0; }
  else report.unchanged++;
}

console.log(`[add-ask-line]${dry ? ' (dry)' : ''} services=${report.placed.services} articles=${report.placed.articles} field-notes=${report.placed.fieldNotes} unchanged=${report.unchanged}`);
if (report.skipped.length) { console.log('  置かなかった:'); for (const s of report.skipped) console.log(`    - ${s}`); }
