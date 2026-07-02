// fix-project-mgmt-honesty.mjs — 2026-07-02 担当漏れページの正直化
// project-mgmt-saas-aeo-2026.html (JA/EN) の実名×成功率%を除去。
// レイテンシms・件数・グレードはKEEP。使い捨てスクリプト。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');

const JA = [
  ['成功率90%・平均レイテンシ119msを記録しており', '平均レイテンシ119msを記録しており（成功率は観測中）'],
  ['成功率90%・平均レイテンシ119msは、信頼性と速度の両面で傑出した数値を示している', '平均レイテンシ119msはカテゴリ最速で、成功率は観測データを蓄積中だ'],
  ['成功率78%・187msは、AAグレードを支える十分な信頼性を示している', '187msの平均レイテンシを記録している（成功率は観測中）'],
  ['90%成功・119ms', '119ms'],
  ['78%成功・187ms', '187ms'],
  ['（90%・119ms）', '（119ms）'],
  ['（78%・187ms）', '（187ms）'],
  ['2件（成功率50%）', '2件（成功率は観測中）'],
  ['<div class="val">90%</div><div class="lbl">成功率</div>', '<div class="val">観測中</div><div class="lbl">成功率</div>'],
  ['<div class="val">78%</div><div class="lbl">成功率</div>', '<div class="val">観測中</div><div class="lbl">成功率</div>'],
  ['<div class="val">50%</div><div class="lbl">成功率</div>', '<div class="val">観測中</div><div class="lbl">成功率</div>'],
  ['<td>90%</td>', '<td>観測中</td>'],
  ['<td>78%</td>', '<td>観測中</td>'],
  ['<td>50%</td>', '<td>観測中</td>'],
];

const EN = [
  ['Backlog earns AAA with 90% success and 119ms latency', 'Backlog earns AAA with 119ms latency (success rate: observing)'],
  ['Backlog earns AAA with 90% success rate and 119ms average latency', 'Backlog earns AAA with 119ms average latency (success rate: observing)'],
  ['Backlog earns AAA (90% success, 119ms)', 'Backlog earns AAA (119ms)'],
  ['Backlog AAA (90% success, 119ms)', 'Backlog AAA (119ms)'],
  ['kintone holds AA (78%, 187ms)', 'kintone holds AA (187ms)'],
  ['at 90% success rate and 119ms average latency', 'at 119ms average latency (success rate: observing)'],
  ['with 78% success rate and 187ms latency', 'with 187ms latency (success rate: observing)'],
  ['Backlog: AAA grade, 90% success rate, 119ms latency, 90 agent runs', 'Backlog: AAA grade, 119ms latency, 90 agent runs'],
  ['A grade, 50% success rate, 2 agent runs', 'A grade, 2 agent runs'],
  ['it records a 90% success rate and 119ms average latency', 'it records a 119ms average latency (success rate: observing)'],
  ['kintone posts a 78% success rate and 187ms average latency', 'kintone posts a 187ms average latency (success rate: observing)'],
  ['only 2 agent runs with a 50% success rate', 'only 2 agent runs'],
  ['With only 2 telemetry records at 50% success, the', 'With only 2 telemetry records, the'],
  ['Backlog (AAA, 90% success, 119ms, official MIT MCP)', 'Backlog (AAA, 119ms, official MIT MCP)'],
  ['kintone (AA, 78%, full business platform, official MCP)', 'kintone (AA, full business platform, official MCP)'],
  ['it records 90% success rate and 119ms latency', 'it records 119ms latency (success rate: observing)'],
  ['Its AA grade (78%, 187ms, official MCP)', 'Its AA grade (187ms, official MCP)'],
  ['<div class="val">90%</div><div class="lbl">Success Rate</div>', '<div class="val">observing</div><div class="lbl">Success Rate</div>'],
  ['<div class="val">78%</div><div class="lbl">Success Rate</div>', '<div class="val">observing</div><div class="lbl">Success Rate</div>'],
  ['<div class="val">50%</div><div class="lbl">Success Rate</div>', '<div class="val">observing</div><div class="lbl">Success Rate</div>'],
  ['<td>90%</td>', '<td>observing</td>'],
  ['<td>78%</td>', '<td>observing</td>'],
  ['<td>50%</td>', '<td>observing</td>'],
];

for (const [rel, rules] of [
  ['insights/project-mgmt-saas-aeo-2026.html', JA],
  ['en/insights/project-mgmt-saas-aeo-2026.html', EN],
]) {
  const p = join(pub, rel.replace('/', '\\'));
  let html = readFileSync(p, 'utf8');
  let applied = 0;
  const misses = [];
  for (const [from, to] of rules) {
    if (html.includes(from)) {
      html = html.split(from).join(to);
      applied++;
    } else {
      misses.push(from.slice(0, 50));
    }
  }
  writeFileSync(p, html);
  console.log(`${rel}: applied ${applied}/${rules.length}`, misses.length ? 'MISSES: ' + JSON.stringify(misses) : '');
}
