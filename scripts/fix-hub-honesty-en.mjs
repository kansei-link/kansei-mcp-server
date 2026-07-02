// fix-hub-honesty-en.mjs — 2026-07-02 insightsハブ(EN)の正直化。使い捨て。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const p = join(resolve(__dirname, '..', 'public'), 'en', 'insights', 'index.html');

const R = [
  // ── retitle sync ──
  ['Backlog MCP Deep Dive 2026 — 90% Success, 128ms Latency, 42 Tools, and the apiKey URL Trap',
   'Backlog MCP Deep Dive 2026 — AAA Grade, 42 Tools, and the apiKey URL Trap'],
  ['Same OAuth 2.0, Slack 91% vs Chatwork 66% — Three Structural Forces Behind the MCP Success-Rate Divergence (KanseiLink 7-Service Data 2026)',
   'Same OAuth 2.0, Diverging Success Rates — Three Structural Forces Behind the MCP Divergence (KanseiLink 7-Service Comparison 2026)'],
  ['SmartHR API Deep Dive 2026 — OAuth 2.0, Employee/Year-End-Adjustment Endpoints, and Why the Agent Success Rate Is Stuck at 39%',
   'SmartHR API Deep Dive 2026 — OAuth 2.0, Employee/Year-End-Adjustment Endpoints, and the 7 Pitfalls That Trip Up Agent Integrations'],
  ['93% Success Rate, Journal Endpoints', 'Journal Endpoints'],
  // ── card descriptions ──
  ['trust 0.90, 93% success, 156ms', 'trust 0.90, 156ms'],
  ['Slack holds a 90% success rate yet its reliability is degrading', 'Slack holds a top grade yet reliability sentiment is mixed'],
  ["Yet KanseiLink's measured agent success rate is just 39%, and the cause isn't", "Yet early reports show agents tripping repeatedly, and the cause isn't"],
  ['only 5 carry the verified (over 80% success, battle-tested) badge. Accounting is the only one with two — freee 90.1%/212 reports and Money Forward 92.9%. Meanwhile HR and CRM lag even at their leaders: SmartHR 39%, Salesforce 43% (the slowest',
   'only 5 carry the verified (official MCP + handshake-checked) badge. Accounting is the only one with two — freee (212 reports) and Money Forward. Meanwhile HR and CRM lag even at their leaders: Salesforce is also the slowest (474ms'],
  ['parallel calls to low-success services (SmartHR 39%)', 'parallel calls to low-success services'],
  ["In KanseiLink data, verified MCP (Slack 91%, freee 90%, Backlog 90%) far exceeds it.",
   "In KanseiLink's grade ratings, verified MCP servers show strong reliability."],
  ['From SmartHR (39% success, "good" docs), kintone (label↔field-code disconnect), and freee (90% success, parity-good)',
   'From SmartHR ("good" docs), kintone (label↔field-code disconnect), and freee (parity-good)'],
  ['AAA=96% success, D=33%.', 'Success-probability scores diverge sharply by grade band.'],
  ['freee (AAA, 90% success) vs Money Forward (AA, 93%, 135ms fastest) vs Yayoi (BB, no MCP). A full AEO comparison of Japan\'s top three accounting platforms using real agent telemetry.',
   'freee (AAA) vs Money Forward (AA, 135ms fastest) vs Yayoi (BB, no MCP). A full AEO comparison of Japan\'s top three accounting platforms using early agent data.'],
  ["SmartHR's agent success rate is just 39% across 89 runs. Auth failures, v1/v2 endpoint issues, and semantic discoverability gaps — plus freee HR's official MCP and KING OF TIME at 65%.",
   "SmartHR's agent integrations show repeated stumbles across 89 reports. Auth failures, v1/v2 endpoint issues, and semantic discoverability gaps — plus freee HR's official MCP and KING OF TIME's current state."],
  ['Sansan leads with AA (60% success, 173ms, official MCP). Salesforce falls to BB (43% success, 474ms, no official MCP). Real agent telemetry across',
   'Sansan leads with AA (173ms, official MCP). Salesforce falls to BB (474ms, no official MCP). Agent-readiness ratings across'],
  ['Backlog earns AAA (90% success, 119ms, MIT-licensed official MCP). kintone holds AA (78%, 187ms).',
   'Backlog earns AAA (119ms, MIT-licensed official MCP). kintone holds AA (187ms).'],
  ['Slack earns AAA (91% success, 157ms, verified official MCP). Chatwork holds AA with official MCP but 66% success and 378ms latency. LINE WORKS has no MCP and 20% success — Japan\'s largest messenger lags far behind.',
   'Slack earns AAA (157ms, verified official MCP). Chatwork holds AA with official MCP but 378ms latency. LINE WORKS has no MCP — Japan\'s largest messenger lags far behind.'],
  ['Only SendGrid is verified (AA, 80%, 140ms via 3rd-party MCP). Marketo sits at BBB (63%). Japan\'s SATORI shows 100% success in 2 runs.',
   'Only SendGrid is verified (AA, 140ms via 3rd-party MCP). Marketo sits at BBB. Japan\'s SATORI shows positive early data (2 runs).'],
  ['Freshdesk leads with 100% success rate (Grade A). Zendesk draws the most agent attempts (30) but only a 33% success rate.',
   'Freshdesk leads the category (Grade A). Zendesk draws the most agent attempts (30) but also frequent failure reports.'],
  ['Shopify dominates with AAA (94%, 123ms, 4 official MCP servers). Rakuten\'s XML-RPC protocol delivers a 50% success rate and 550ms latency.',
   'Shopify dominates with AAA (123ms, 4 official MCP servers). Rakuten\'s XML-RPC protocol delivers 550ms latency.'],
  ['CloudSign leads domestically with 80 connections but 61% success rate. DocuSign achieves 100% via third-party MCP. Real data analysis of',
   'CloudSign leads domestically with 80 reported connections. DocuSign connects via third-party MCP. An analysis of'],
  ['KanseiLink data shows freee (90%), Slack (91%), and Shopify (94%) as the success-rate leaders.',
   'KanseiLink grade data highlights freee, Slack, and Shopify as the leaders.'],
  ['Shopify Japan 123ms/94%, Asana 303ms/67% — the correlation is real, but causation points somewhere unexpected. freee and Notion share identical latency (216ms) yet differ by 7 points in success rate.',
   'Shopify Japan 123ms, Asana 303ms — the correlation is real, but causation points somewhere unexpected. freee and Notion share identical latency (216ms) yet diverge in reported reliability.'],
  ['CircleCI proves 100% success rate across 3 agent reports at 454ms.', 'CircleCI shows stable behavior across 3 agent reports at 454ms.'],
  ['Zapier MCP: 13% success rate, 78% of failures are search_miss — agents can\'t find the service. Sansan and Chatwork follow the same pattern. KanseiLink real-world data',
   'Zapier MCP fails mostly on search_miss — agents can\'t find the service. Sansan and Chatwork follow the same pattern. KanseiLink early data'],
  ['verified averages 89% success (83–94%). connectable spans 13–100% — Zapier at 13%, Teams at 100%, both connectable.',
   'verified (official MCP + handshake-checked) is the stable tier; connectable spans a huge range — Zapier and Teams are both "connectable" yet worlds apart.'],
  ['KanseiLink real-world data: n=113, 91.15% success rate, AAA grade.', 'KanseiLink early data: n=113 reports, AAA grade.'],
  ['From KanseiLink measured data (n=91, 90% success rate, 128ms avg latency, AAA grade)', 'From KanseiLink data (n=91 reports, 128ms avg latency, AAA grade)'],
  ['All use OAuth 2.0, yet success rates span Shopify 94%, Money Forward 93%, Slack 91%, Backlog 90%, freee 90%, Notion 83%, and Chatwork 66% — a 28-point spread.',
   'All use OAuth 2.0, yet reported reliability diverges sharply.'],
];

let html = readFileSync(p, 'utf8');
let applied = 0;
const misses = [];
for (const [from, to] of R) {
  if (html.includes(from)) { html = html.split(from).join(to); applied++; }
  else misses.push(from.slice(0, 50));
}
writeFileSync(p, html);
console.log(`hub EN: applied ${applied}/${R.length}`, misses.length ? '\nMISSES:\n' + misses.join('\n') : '');
