#!/usr/bin/env node
// tier1-report.mjs — tier1-snapshot.mjs が出した diff.json を、GitHub の PR と Issue にする。
//
//   小（版だけ）       → 対応する欄（tier1.json の version_fields）を書き換えたブランチと PR を自動で作る。
//                        題「freshness: <サービス> <前>→<後>」。自動マージはしない（Michie がマージ）。
//                        書き換える欄が無いサービスの小は、ジョブの要約に件数だけ。
//   中・大・取得失敗   → サービスごとに Issue（ラベル freshness）。本文＝出典 URL・前の値・今の値・分類。
//                        同じサービスで開いている Issue があれば追記（増やさない）。
//   note（記録だけ）   → 何もしない（要約の件数だけ）。
//
// gh CLI（GH_TOKEN）を使う。--dry-run では何も作らず、作る物を標準出力に出す。
//
// 使い方: node scripts/tier1-report.mjs --diff diff.json [--dry-run] [--repo owner/name] [--summary $GITHUB_STEP_SUMMARY]
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const DIFF_FILE = opt('--diff'); const REPO = opt('--repo', 'kansei-link/kansei-mcp-server'); const SUMMARY = opt('--summary');
if (!DIFF_FILE) { console.error('usage: --diff <file> [--dry-run] [--repo owner/name] [--summary file]'); process.exit(2); }

const diff = JSON.parse(readFileSync(resolve(DIFF_FILE), 'utf8'));
const tier1 = JSON.parse(readFileSync(resolve(ROOT, 'src/data/tier1.json'), 'utf8'));
const byId = Object.fromEntries(tier1.services.map((s) => [s.id, s]));
const LABEL = 'freshness';
const LEVEL_JA = { small: '小（版だけ）', medium: '中', large: '大', failed: '取得失敗', note: '記録だけ' };

const sh = (cmd, a, input) => execFileSync(cmd, a, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 20 * 1024 * 1024 }).trim();
const gh = (a, input) => (DRY ? (console.log(`[dry-run] gh ${a.join(' ')}${input ? `\n${input}` : ''}`), '') : sh('gh', ['-R', REPO, ...a], input));
const git = (a) => (DRY ? (console.log(`[dry-run] git ${a.join(' ')}`), '') : sh('git', a));
const short = (v) => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const fence = (v) => '```\n' + short(v).slice(0, 1500) + '\n```';

const results = { prs: [], issues_created: [], issues_appended: [], small_without_field: [] };

// ── 1. 小 → 自動 PR（version_fields があるサービスだけ）──
function applyVersionField(vf, before, after, date) {
  const file = resolve(ROOT, vf.file);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const item = (data.items || []).find((x) => x.id === vf.id);
  if (!item) throw new Error(`${vf.file}: id ${vf.id} not found`);
  const [a, b] = vf.path.split('.');
  const cur = b ? item[a]?.[b] : item[a];
  if (typeof cur !== 'string') throw new Error(`${vf.file}: ${vf.id}.${vf.path} is not a string`);
  let next = cur;
  if (before && next.includes(before)) next = next.split(before).join(after);
  else if (/\d+\.\d+\.\d+/.test(next)) next = next.replace(/\d+\.\d+\.\d+/, after); // 前の版が欄に無ければ最初の版らしき物を置き換える
  else throw new Error(`${vf.file}: ${vf.id}.${vf.path} has no version text to replace`);
  next = next.replace(/\d{4}-\d{2}-\d{2} 時点/, `${date} 時点`);
  if (next === cur) return false;
  if (b) item[a][b] = next; else item[a] = next;
  if (!DRY) writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  else console.log(`[dry-run] ${vf.file} ${vf.id}.${vf.path}: "${cur}" → "${next}"`);
  return true;
}

const smalls = diff.items.filter((x) => x.level === 'small');
const smallByService = new Map();
for (const it of smalls) { if (!smallByService.has(it.service)) smallByService.set(it.service, []); smallByService.get(it.service).push(it); }
for (const [id, items] of smallByService) {
  const svc = byId[id];
  const fields = (svc?.version_fields || []);
  const applicable = items.filter((it) => fields.some((vf) => vf.source === it.kind && it.field === 'version'));
  if (!applicable.length) { results.small_without_field.push({ service: id, items: items.map((x) => `${x.kind} ${x.field} ${short(x.before)}→${short(x.after)}`) }); continue; }
  const it = applicable[0];
  const branch = `freshness/${diff.date}-${id}`;
  const title = `freshness: ${svc.name} ${short(it.before)}→${short(it.after)}`;
  try {
    git(['checkout', '-B', branch]);
    let changed = false;
    for (const vf of fields.filter((vf) => vf.source === it.kind)) changed = applyVersionField(vf, it.before, it.after, diff.date) || changed;
    if (changed && existsSync(resolve(ROOT, 'scripts/generate-mcp-ja-pages.mjs'))) {
      if (!DRY) { sh('node', ['scripts/generate-mcp-ja-pages.mjs']); if (existsSync(resolve(ROOT, 'scripts/add-language-links.mjs'))) sh('node', ['scripts/add-language-links.mjs']); }
      else console.log('[dry-run] node scripts/generate-mcp-ja-pages.mjs && node scripts/add-language-links.mjs');
    }
    if (!changed) { results.small_without_field.push({ service: id, items: ['欄に変化なし（既に新しい版）'] }); git(['checkout', '-']); continue; }
    const body = [
      `第 1 段の週次記録（${diff.prev_date} → ${diff.date}）で、版だけの変化を見つけました。自動で作った PR です。**マージは人が行います。**`, '',
      `| 出典 | 欄 | 前 | 今 |`, `|---|---|---|---|`,
      ...items.map((x) => `| ${x.url} | ${x.field} | ${short(x.before)} | ${short(x.after)} |`), '',
      `書き換えた欄: ${fields.map((vf) => `\`${vf.file}\` → ${vf.id}.${vf.path}`).join('・')}`, '',
      `記録: \`snapshots\` ブランチの \`tier1/${diff.date}.json\`。設計: founder-ops/research/Freshness_2026-10/DESIGN-tier1-source-diff-v0.md`, '',
      '🤖 Generated by .github/workflows/tier1-diff.yml',
    ].join('\n');
    git(['add', '-A']);
    git(['-c', 'user.name=tier1-diff[bot]', '-c', 'user.email=tier1-diff@users.noreply.github.com', 'commit', '-q', '-m', title]);
    git(['push', '-f', 'origin', branch]);
    const url = gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--label', LABEL, '--body', body]);
    results.prs.push({ service: id, title, url });
    git(['checkout', '-q', '-']);
  } catch (e) {
    console.error(`PR for ${id} failed: ${e.message}`);
    results.small_without_field.push({ service: id, items: [`PR を作れなかった: ${String(e.message).slice(0, 160)}`] });
    try { git(['checkout', '-q', '-f', '-']); } catch { /* ignore */ }
  }
}

// ── 2. 中・大・取得失敗 → Issue（サービスごと・開いていれば追記）──
const issueItems = diff.items.filter((x) => ['medium', 'large', 'failed'].includes(x.level));
const perService = new Map();
for (const it of issueItems) { if (!perService.has(it.service)) perService.set(it.service, []); perService.get(it.service).push(it); }
function ensureLabel() {
  try { gh(['label', 'create', LABEL, '--color', 'D4C5F9', '--description', '第 1 段の出典の変化（中・大・取得失敗）', '--force']); } catch { /* exists */ }
}
if (perService.size) ensureLabel();
for (const [id, items] of perService) {
  const name = items[0].service_name;
  const worst = items.some((x) => x.level === 'large') ? 'large' : items.some((x) => x.level === 'medium') ? 'medium' : 'failed';
  const table = [
    `### ${diff.date}（前回 ${diff.prev_date || 'なし'}）`, '',
    ...items.map((x) => [`- **${LEVEL_JA[x.level]}** ${x.kind} ${x.field}`, `  - 出典: ${x.url}`, `  - 前: ${x.before === null ? '—' : ''}`, x.before === null ? '' : fence(x.before), `  - 今:`, fence(x.after)].filter(Boolean).join('\n')), '',
    '対応: 一次資料で確かめてから直す（自動では書き換えない）。',
  ].join('\n');
  const title = `freshness: ${name}（${LEVEL_JA[worst]}）`;
  let existing = '';
  try { existing = DRY ? '' : gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--search', `"freshness: ${name}" in:title`, '--json', 'number,title', '--jq', `.[] | select(.title | startswith("freshness: ${name}")) | .number`]).split('\n')[0]; } catch { existing = ''; }
  if (existing) {
    gh(['issue', 'comment', existing, '--body', table]);
    results.issues_appended.push({ service: id, number: Number(existing) });
  } else {
    const body = [`第 1 段（tier1.json）の週次記録で、**${name}** の出典に変化または取得失敗がありました。`, '', table, '', '🤖 Generated by .github/workflows/tier1-diff.yml'].join('\n');
    const url = gh(['issue', 'create', '--title', title, '--label', LABEL, '--body', body]);
    results.issues_created.push({ service: id, title, url });
  }
}

// ── 3. 要約（件数だけ）──
const c = diff.counts;
const lines = [
  `## 第 1 段の差分 ${diff.date}（前回 ${diff.prev_date || 'なし・初回は記録だけ'}）`, '',
  `| 小 | 中 | 大 | 取得失敗 | 記録だけ |`, `|---|---|---|---|---|`, `| ${c.small} | ${c.medium} | ${c.large} | ${c.failed} | ${c.note} |`, '',
  `- 自動で作った PR: ${results.prs.length}${results.prs.length ? '（' + results.prs.map((p) => p.url || p.title).join('・') + '）' : ''}`,
  `- 新しい Issue: ${results.issues_created.length}・追記した Issue: ${results.issues_appended.length}`,
  `- 小のうち書き換える欄が無い物: ${results.small_without_field.length}`,
];
const text = lines.join('\n') + '\n';
console.log(text);
if (SUMMARY) appendFileSync(SUMMARY, text);
