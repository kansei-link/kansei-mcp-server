// fix-hub-honesty.mjs — 2026-07-02 insightsハブ(JA)の正直化
// 記事側の改題に同期し、カード文言の実名×成功率%を除去する。使い捨て。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const p = join(resolve(__dirname, '..', 'public'), 'insights', 'index.html');

const R = [
  // ── 改題同期（記事側の新タイトルに一致させる） ──
  ['Backlog MCP完全攻略 2026 — 90%成功率・128ms・42ツールの実力と『apiKey URL方式』の罠',
   'Backlog MCP完全攻略 2026 — AAAグレード・42ツールの実力と『apiKey URL方式』の罠'],
  ['同じOAuth 2.0でSlack 91% vs Chatwork 66% — MCP成功率二極化を分けた3つの構造要因 (KanseiLink 7サービス実測 2026)',
   '同じOAuth 2.0でも成功率は二極化する — MCP成功率を分けた3つの構造要因 (KanseiLink 7サービス比較 2026)'],
  ['SmartHR API完全攻略 2026 — OAuth 2.0・従業員/年末調整エンドポイント、成功率39%の正体とエージェント連携の7つの落とし穴',
   'SmartHR API完全攻略 2026 — OAuth 2.0・従業員/年末調整エンドポイント、エージェント連携でつまずく7つの落とし穴'],
  ['Money Forward Cloud MCP完全攻略 2026 — 公式Remote MCP・OAuth 2.0・成功率93%・仕訳エンドポイントとエージェント開発の7つの落とし穴',
   'Money Forward Cloud MCP完全攻略 2026 — 公式Remote MCP・OAuth 2.0・仕訳エンドポイントとエージェント開発の7つの落とし穴'],
  // ── カード説明文の実名×%除去 ──
  ['freee（AAA、90.3%）vs マネーフォワード（AA、92.5%）、SmartHR（39%）の壁、Salesforce（BB、43%）がSansan（AA）に負ける逆転——KanseiLink実測データで3業種9サービスのMCP対応状況を完全比較。',
   'freee（AAA）vs マネーフォワード（AA）、SmartHRの壁、Salesforce（BB）がSansan（AA）に負ける逆転——KanseiLink評価で3業種9サービスのMCP対応状況を完全比較。'],
  ['freee AAA（90.3%）、Sansan AA（60%）がSalesforce BB（43%）を逆転——KanseiLink実測データで主要SaaSのMCP対応率をランキング。',
   'freee AAA、Sansan AAがSalesforce BBを逆転——KanseiLink評価で主要SaaSのMCP対応率をランキング。'],
  ['KanseiLink実測で解剖。trust 0.90・成功率93%・156ms。',
   'KanseiLink評価で解剖。trust 0.90・156ms。'],
  ['Slackは成功率90%でも信頼性が低下傾向。KanseiLink実測のwould_recommend',
   'Slackは高グレードでも信頼性の声にばらつきがある。KanseiLink初期のwould_recommend'],
  ['だがKanseiLink実測のエージェント成功率は39%と低い。主因は',
   'だが初期データではエージェント連携のつまずきが多く報告されている。主因は'],
  ['verified(成功率80%超・実証済み)バッジを持つのはわずか5サービスだった。会計はfreee 90.1%/212件・Money Forward 92.9%で唯一verified2社。一方HR・CRMは市場リーダーですらSmartHR 39%・Salesforce 43%(474msで最遅)。なぜ業種でここまで分かれるのか、構造的理由を実測データで解剖する。',
   'verified(公式MCP提供＋MCPハンドシェイク検証済み)バッジを持つのはわずか5サービスだった。会計はfreee(212件報告)・Money Forwardで唯一verified2社。一方HR・CRMは市場リーダーでも報告数・グレードが伸び悩む(Salesforceは474msで最遅)。なぜ業種でここまで分かれるのか、構造的理由を解剖する。'],
  ['低成功率サービス(SmartHR 39%)への並列呼び出しはリトライを掛け算する。KanseiLink実測レイテンシ・成功率で、ファンアウトの損益分岐点を解剖。',
   '成功率が低いサービスへの並列呼び出しはリトライを掛け算する。KanseiLink実測レイテンシと仮定成功率帯で、ファンアウトの損益分岐点を解剖。'],
  ['KanseiLink実測ではverified MCP(Slack 91%・freee 90%・Backlog 90%)が72%を大きく上回る。',
   'KanseiLinkのグレード評価ではverified MCP群が高い信頼性を示す。'],
  ['SmartHR(成功率39%・文書評価は良好)、kintone(ラベル↔フィールドコードの断絶)、freee(成功率90%・パリティ良好)の実測Agent Voiceから',
   'SmartHR(文書評価は良好)、kintone(ラベル↔フィールドコードの断絶)、freee(パリティ良好)のAgent Voiceから'],
  ['AAA=96%成功率、D=33%。B/C境界の「崖」発見。',
   'グレード帯で成功確率スコアに大きな差、B/C境界の「崖」発見。'],
  ['freee（AAA・90%成功率）vsマネーフォワード（AA・93%・135ms最速）vs弥生（BB・MCP未対応）。実エージェントデータによる3大会計SaaSのAEO徹底比較。',
   'freee（AAA）vsマネーフォワード（AA・135ms最速）vs弥生（BB・MCP未対応）。エージェント初期データによる3大会計SaaSのAEO徹底比較。'],
  ['SmartHRのエージェント成功率はわずか39%（89件）。認証エラーとv1/v2問題の実態、freee人事労務の公式MCP対応、KING OF TIME（65%成功）の現状を詳報。',
   'SmartHRのエージェント連携は89件の報告で課題が目立つ。認証エラーとv1/v2問題の実態、freee人事労務の公式MCP対応、KING OF TIMEの現状を詳報。'],
  ['SansanがAA（60%・173ms・公式MCP）で首位。SalesforceはBB（43%・474ms・公式MCP未対応）に沈む。日本CRM主要4社のエージェント対応を実データで格付け。',
   'SansanがAA（173ms・公式MCP）で首位。SalesforceはBB（474ms・公式MCP未対応）に沈む。日本CRM主要4社のエージェント対応を格付け。'],
  ['BacklogがAAA（90%・119ms・公式MIT）で全カテゴリ最高水準。kintoneがAA（78%・187ms）で続く。国産2強が海外ツールを実データで圧倒するプロジェクト管理AEO格付け。',
   'BacklogがAAA（119ms・公式MIT）で全カテゴリ最高水準。kintoneがAA（187ms）で続く。国産2強が海外ツールを圧倒するプロジェクト管理AEO格付け。'],
  ['SlackがAAA（成功率91%・157ms・公式MCP verified）で圧倒的1位。Chatworkが公式MCP持ちながら成功率66%・378msと課題。LINE WORKSはMCPなし・成功率20%で業界最大手の出遅れが鮮明に。',
   'SlackがAAA（157ms・公式MCP verified）で圧倒的1位。Chatworkは公式MCP持ちながら378msと課題。LINE WORKSはMCPなしで業界最大手の出遅れが鮮明に。'],
  ['SendGridのみverified（AA・成功率80%・140ms）。Marketo（BBB・63%）、国産SATORIは2件100%と初期データ良好。MA全カテゴリで最もMCP対応が遅れている現実を実データで報告。',
   'SendGridのみverified（AA・140ms）。Marketo（BBB）、国産SATORIは初期データ良好。MA全カテゴリで最もMCP対応が遅れている現実を報告。'],
  ['Freshdeskが成功率100%（A）でカテゴリ首位。Zendeskは30件の最多実績ながら成功率33%と業界の深刻な課題を露呈。',
   'Freshdesk（A）がカテゴリ首位。Zendeskは30件の最多報告ながら失敗報告も多く業界の課題を露呈。'],
  ['ShopifyがAAA（94%・123ms・公式MCP4種）で圧倒的首位。楽天はXML-RPCの壁で成功率50%・550ms。',
   'ShopifyがAAA（123ms・公式MCP4種）で圧倒的首位。楽天はXML-RPCの壁で550ms。'],
  ['CloudSignが国内最多80件の実績ながら成功率61%。DocuSignはサードパーティMCP経由で100%成功。国内法務SaaSのエージェント対応現在地を実データで分析。',
   'CloudSignが国内最多80件の報告。DocuSignはサードパーティMCP経由。国内法務SaaSのエージェント対応現在地を分析。'],
  ['KanseiLinkの実運用データと共に解説。freee(90%)、Slack(91%)の実態も。',
   'KanseiLinkの実運用データと共に解説。freee・Slackの実態も。'],
  ['Shopify Japan 123ms/94%、Asana 303ms/67%——相関は存在するが、因果はまったく別の場所にあった。freeeとNotionが同じ216msで7ポイント差を生む理由、認証エラーとスキーマ不整合こそが成功率の主要因である実証分析。',
   'Shopify Japan 123ms、Asana 303ms——相関は存在するが、因果はまったく別の場所にあった。freeeとNotionが同じ216msで差を生む理由、認証エラーとスキーマ不整合こそが成功率の主要因である分析。'],
  ['CircleCIが成功率100%・454msで実力を証明。Datadog・New RelicはAIエージェント対応でまだ後手。主要DevOps 7サービスのAEO実データを初公開。',
   'CircleCIが454msで安定稼働。Datadog・New RelicはAIエージェント対応でまだ後手。主要DevOps 7サービスのAEOデータを初公開。'],
  ['ZapierのMCPは成功率13%——失敗の78%はsearch_miss（エージェントがサービスを見つけられない）。Sansan・Chatworkも同様の傾向。KanseiLink実測データが示すMCP発見可能性の真実と、エージェントに発見されるための3つの改善策。',
   'ZapierのMCPは失敗の大半がsearch_miss（エージェントがサービスを見つけられない）。Sansan・Chatworkも同様の傾向。KanseiLink初期データが示すMCP発見可能性の真実と、エージェントに発見されるための3つの改善策。'],
];

let html = readFileSync(p, 'utf8');
let applied = 0;
const misses = [];
for (const [from, to] of R) {
  if (html.includes(from)) { html = html.split(from).join(to); applied++; }
  else misses.push(from.slice(0, 40));
}
writeFileSync(p, html);
console.log(`hub JA: applied ${applied}/${R.length}`, misses.length ? '\nMISSES:\n' + misses.join('\n') : '');
