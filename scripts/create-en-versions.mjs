#!/usr/bin/env node
/**
 * Create English versions of:
 * 1. axr-recipe-test-2026.html
 * 2. payment-saas-aeo-2026.html
 * 3. bi-analytics-saas-aeo-2026.html
 * Also updates EN insights index.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const jaDir = path.join(root, 'public/insights');
const enDir = path.join(root, 'public/en/insights');

// Translation map for Japanese → English
const translations = [
  // Meta & structural
  ['lang="ja"', 'lang="en"'],
  ['kansei-link.com/insights/', 'kansei-link.com/en/insights/'],

  // AXR Report specific
  ['AXR格付け＋レシピ実行テスト — エージェント体験の実測レポート', 'AXR Rating + Recipe Execution Test — Agent Experience Measurement Report'],
  ['225サービスのfelt-first AXR格付けと188レシピの3層テスト結果。AXR AAA=96%成功率、D=33%。エージェントの「安心感」を数値化。', 'Felt-first AXR rating of 225 services and 3-layer test results of 188 recipes. AXR AAA=96% success rate, D=33%. Quantifying agent "confidence" in services.'],
  ['AXR, Agent Experience Rating, レシピテスト, MCP, AEO, KanseiLink, 格付け, エージェント成功率', 'AXR, Agent Experience Rating, Recipe Test, MCP, AEO, KanseiLink, Rating, Agent Success Rate'],

  // Reading time
  ['読了時間: 20分', 'Reading time: 20 min'],

  // Section headings
  ['1. AXR (Agent Experience Rating)', '1. AXR (Agent Experience Rating)'],
  ['2. 3層レシピテスト', '2. Three-Layer Recipe Test'],
  ['3. 成功率 &times; AXR格付け', '3. Success Rate × AXR Grade'],
  ['4. Agent Voice -- エージェントの生の声', '4. Agent Voice — Raw Agent Feedback'],
  ['5. 提言', '5. Recommendations'],
  ['6. Agent Voice — マルチエージェント比較', '6. Agent Voice — Multi-Agent Comparison'],

  // 5 Dimension Rubric
  ['5次元ルーブリック', '5-Dimension Rubric'],
  ['次元', 'Dimension'],
  ['名称', 'Name'],
  ['説明', 'Description'],
  ['相関係数', 'Correlation'],
  ['見つけやすさ', 'Discoverability'],
  ['r=0.72 (飽和)', 'r=0.72 (saturated)'],
  ['初回接続', 'First connection'],
  ['認証明確さ', 'Auth clarity'],
  ['機能シグナル', 'Capability signal'],
  ['安心シグナル', 'Trust signal'],
  ['r=0.87 (AAA分離)', 'r=0.87 (AAA separator)'],
  ['D4 Capability Signal (r=0.96) がSuccess Rateとの相関が最も高く、D1 Discoverability (r=0.72) は飽和状態 -- 多くのServiceが「見つかる」段階はクリアしているが、「使える」段階に到達していないことを意味します。D5 Trust Signalは<strong>AAAとAAを分離する決定的次元</strong>です。', 'D4 Capability Signal (r=0.96) has the highest correlation with Success Rate, while D1 Discoverability (r=0.72) is saturated — most services are "findable" but haven\'t reached "usable." D5 Trust Signal is <strong>the decisive dimension separating AAA from AA</strong>.'],

  // Grade table
  ['グレード', 'Grade'],
  ['社数', 'Count'],
  ['AXRGrade Distribution（225社中）', 'AXR Grade Distribution (out of 225 services)'],
  ['エージェントが安心して即座に使える', 'Agents can use immediately with confidence'],
  ['ほぼ問題なく使える', 'Usable with minimal issues'],
  ['基本的に使えるが一部注意', 'Usable but requires some caution'],
  ['使えるが試行錯誤が必要', 'Usable but needs trial and error'],
  ['かなりの知識が必要', 'Requires significant expertise'],
  ['事実上エージェント非対応', 'Effectively not agent-compatible'],

  // Layer 1
  ['188Recipesを3つの検証レイヤーで段階的にテストしました。構造 &rarr; 到達性 &rarr; 実行可能性の順に、エージェントがRecipesを完遂できるかを検証します。', '188 recipes were progressively tested through 3 verification layers: Structure → Reachability → Executability, verifying whether agents can complete each recipe.'],
  ['全RecipesがJSON構造・必須フィールド検証をパス。', 'All recipes passed JSON structure and required field validation.'],
  ['Recipes使用数 Top 5 Service:', 'Top 5 Services by Recipe Usage:'],

  // Layer 2
  ['Layer 2 -- 到達性テスト', 'Layer 2 — Reachability Test'],
  ['エージェントがエンドポイントに到達できるかを検証。', 'Verifying whether agents can reach the endpoints.'],
  ['API URL到達', 'API URL Reachable'],
  ['npm MCP到達', 'npm MCP Reachable'],

  // Layer 3 bottleneck resolved detail
  ['188Recipes全件にgotchas（クロスService配線警告）を注入完了。Avg Success Rateは72.9% &rarr; 77.3%に改善、DRAFT帯Recipesはゼロに。現在の最大課題はService Readiness (62.4%)に移行。', 'All 188 recipes now have gotchas (cross-service wiring warnings). Avg Success Rate improved from 72.9% to 77.3%, DRAFT-band recipes reduced to zero. Current top priority shifts to Service Readiness (62.4%).'],

  // Success Rate × AXR
  ['AXRグレードと実際のRecipesSuccess Rate・レイテンシの関係を検証しました。格付けが下がるほどSuccess Rateは低下し、レイテンシは増加する明確な相関が確認されています。', 'We verified the relationship between AXR grades and actual recipe success rates and latency. As grades decrease, success rates drop and latency increases — a clear correlation.'],
  ['ほぼ確実に成功', 'Almost certain success'],
  ['信頼性高い', 'Highly reliable'],
  ['良好', 'Good'],
  ['レイテンシ増加', 'Latency increase'],
  ['4割失敗', '40% failure rate'],
  ['事実上使えない', 'Effectively unusable'],

  // B/C Cliff
  ['Success Rateが80% &rarr; 62%に急落、レイテンシが1,380ms &rarr; 2,727msに倍増。', 'Success rate plummets from 80% to 62%, latency doubles from 1,380ms to 2,727ms.'],
  ['B/C境界がエージェントにとっての「実用性の崖」です。Cグレード以下のServiceはエージェントが自律的に使うことが困難であり、人間の介入を前提とした設計になっています。この崖を超えるかどうかが、Agent Economy参加の実質的なボーダーラインです。', 'The B/C boundary is the "usability cliff" for agents. Services graded C or below are difficult for agents to use autonomously and assume human intervention. Whether a service crosses this cliff is the practical borderline for Agent Economy participation.'],

  // Agent Voice section
  ['AXRの根幹は「エージェントがどう感じたか」です。以下は、テストを通じて蓄積されたエージェントの生のフィードバックから抜粋した3Serviceのハイライトです。', 'The foundation of AXR is "how the agent felt." Below are highlights from raw agent feedback accumulated through testing, featuring 3 key services.'],
  ['82/188Recipesに登場。エージェント経済のstdout。Block Kit書式がエージェントを躓かせる唯一の罠。', 'Appears in 82/188 recipes. The stdout of the agent economy. Block Kit formatting is the only trap that trips agents up.'],
  ['OAuth token 24h expiry が#1失敗モード。Claude/GPT/Geminiの3種から11件のフィードバック蓄積。', 'OAuth token 24h expiry is the #1 failure mode. 11 feedback entries accumulated from Claude/GPT/Gemini.'],
  ['日本企業のデファクトだが、エージェント検索で見つからない。使えば79%Success Rateだが、選択されないリスク。', 'De facto standard for Japanese enterprises, but not found in agent search. 79% success rate when used, but at risk of not being selected.'],

  // Upgrade path
  ['SaaS企業向け -- アップグレードパス', 'For SaaS Companies — Upgrade Path'],
  ['アップグレード', 'Upgrade'],
  ['必要なアクション', 'Required Action'],
  ['期待される改善', 'Expected Improvement'],
  ['MCP server公開 or APIドキュメント整備', 'Publish MCP server or improve API documentation'],
  ['auth guideとerror message改善', 'Improve auth guide and error messages'],
  ['gotchas/agent tips追加、sandbox提供', 'Add gotchas/agent tips, provide sandbox'],
  ['成功率 89% &rarr; 92%', 'Success rate 89% → 92%'],

  // Footer
  ['AEO Rating Agency for Japanese SaaS. AIエージェント時代のService品質を可視化。', 'AEO Rating Agency for Japanese SaaS. Visualizing service quality in the AI agent era.'],

  // Keywords fix
  ['Recipesテスト', 'Recipe Test'],
  ['格付け', 'Rating'],
  ['エージェントSuccess Rate', 'Agent Success Rate'],

  // Multi-agent table remnants
  ['全エージェント一致のGold standard', 'Gold standard — all agents agree'],
  ['全エージェントCommon Issue', 'universal pain point'],

  // Partial translation fixes (after first pass leaves mixed JP/EN)
  ['Recipesテスト', 'Recipe Test'],
  ['エージェントSuccess Rate', 'Agent Success Rate'],
  ['AXRは「エージェントがどう感じたか」を出発点とするfelt-firstのRatingです。従来のAPI品質メトリクスと異なり、<strong>エージェントがBならそれが正解</strong> -- まずエージェントの体験を記録し、その後に数式を導出するアプローチを採用しています。', 'AXR is a felt-first rating system that starts from "how the agent experienced it." Unlike traditional API quality metrics, <strong>if an agent rates it B, that\'s the correct answer</strong> — we record the agent\'s experience first, then derive formulas afterwards.'],
  ['<strong>AAAとAAを分離する決定的Dimension</strong>です。', '<strong>the decisive dimension separating AAA from AA</strong>.'],
  ['D4 Capability Signal (r=0.96) がSuccess Rateとの相関が最も高く、D1 Discoverability (r=0.72) は飽和状態 -- 多くのServiceが「見つかる」段階はクリアしているが、「使える」段階に到達していないことを意味します。D5 Trust Signalは', 'D4 Capability Signal (r=0.96) has the highest correlation with Success Rate, while D1 Discoverability (r=0.72) is saturated — most services are "findable" but haven\'t reached "usable." D5 Trust Signal is '],
  ['AXR Grade分布', 'AXR Grade Distribution'],
  ['AXRGrade分布（225社中）', 'AXR Grade Distribution (225 services)'],
  ['188Recipesを3つの検証レイヤーで段階的にテストしました。構造 &rarr; 到達性 &rarr; 実行可能性の順に、エージェントがRecipesを完遂できるかを検証します。', '188 recipes were progressively tested through 3 verification layers: Structure → Reachability → Executability, verifying whether agents can complete each recipe.'],
  ['全RecipesがJSON構造・必須フィールド検証をパス。', 'All recipes passed JSON structure and required field validation.'],
  ['Recipes使用数 Top 5 Service:', 'Top 5 Services by Recipe Usage:'],
  ['4Dimension充足率', '4-Dimension Fill Rates'],
  ['188Recipes全件にgotchas（クロスService配線警告）を注入完了。Avg Success Rateは72.9% &rarr; 77.3%に改善、DRAFT帯Recipesはゼロに。現在の最大課題はService Readiness (62.4%)に移行。', 'All 188 recipes now have gotchas (cross-service wiring warnings). Avg Success Rate improved from 72.9% to 77.3%, DRAFT-band recipes reduced to zero. Current top priority shifts to Service Readiness (62.4%).'],
  ['AXRGradeと実際のRecipesSuccess Rate・レイテンシの関係を検証しました。Ratingが下がるほどSuccess Rateは低下し、レイテンシは増加する明確な相関が確認されています。', 'We verified the relationship between AXR grades and actual recipe success rates and latency. As grades decrease, success rates drop and latency increases — a clear correlation.'],
  ['Success Rateが80% &rarr; 62%に急落、レイテンシが1,380ms &rarr; 2,727msに倍増。', 'Success rate plummets from 80% to 62%, latency doubles from 1,380ms to 2,727ms.'],
  ['B/C境界がエージェントにとっての「実用性の崖」です。CGrade以下のServiceはエージェントが自律的に使うことが困難であり、人間の介入を前提とした設計になっています。この崖を超えるかどうかが、Agent Economy参加の実質的なボーダーラインです。', 'The B/C boundary is the "usability cliff" for agents. Services graded C or below are difficult for agents to use autonomously and assume human intervention. Whether a service crosses this cliff is the practical borderline for Agent Economy participation.'],
  ['AXRの根幹は「エージェントがどう感じたか」です。以下は、テストを通じて蓄積されたエージェントの生のフィードバックから抜粋した3Serviceのハイライトです。', 'The foundation of AXR is "how the agent felt." Below are highlights from raw agent feedback accumulated through testing, featuring 3 key services.'],
  ['82/188Recipesに登場。エージェント経済のstdout。Block Kit書式がエージェントを躓かせる唯一の罠。', 'Appears in 82/188 recipes. The stdout of the agent economy. Block Kit formatting is the only trap.'],
  ['日本企業のデファクトだが、エージェント検索で見つからない。使えば79%Success Rateだが、選択されないリスク。', 'De facto standard for Japanese enterprises but not found in agent search. 79% success rate when used, but at risk of not being selected.'],
  ['SaaS企業向け -- アップGradeパス', 'For SaaS Companies — Upgrade Path'],
  ['アップGrade', 'Upgrade'],
  ['四半期ごとの静的更新から、実行結果に基づく動的Ratingへ移行。', 'Transition from quarterly static updates to dynamic ratings based on execution results.'],
  ['全エージェント一致のGold standard', 'Gold standard — all agents agree'],
  ['全エージェントCommon Issue', 'Universal pain point'],
  ['自社のAXRGradeを確認する', 'Check Your AXR Grade'],
  ['225社のRating一覧から自社ServiceのAXRGradeと改善ポイントをチェック。', 'Find your service\'s AXR grade and improvement points from our 225-service rating list.'],
  ['AIエージェント時代のService品質を可視化。', 'Visualizing service quality in the AI agent era.'],

  // Key stat labels
  ['評価対象サービス', 'Services Evaluated'],
  ['テスト済みレシピ', 'Recipes Tested'],
  ['平均成功確率', 'Avg Success Rate'],
  ['AAA成功率', 'AAA Success Rate'],

  // AXR explanation
  ['AXRは「エージェントがどう感じたか」を出発点とするfelt-firstの格付けです。従来のAPI品質メトリクスと異なり、<strong>エージェントがBならそれが正解</strong> -- まずエージェントの体験を記録し、その後に数式を導出するアプローチを採用しています。', 'AXR is a felt-first rating system that starts from "how the agent experienced it." Unlike traditional API quality metrics, <strong>if an agent rates it B, that\'s the correct answer</strong> — we record the agent\'s experience first, then derive formulas afterwards.'],
  ['Felt-First Philosophy:', 'Felt-First Philosophy:'],
  ['人間のUXリサーチが「ユーザーの声」から始まるように、AXRはエージェントの「安心感」「迷い」「フラストレーション」を定量化します。数式は事後的に検証するものであり、先に立てるものではありません。', 'Just as human UX research starts with "the user\'s voice," AXR quantifies agent "confidence," "hesitation," and "frustration." Formulas are verified after the fact, not imposed beforehand.'],

  // 5 dimensions
  ['AXRの5次元', 'AXR\'s 5 Dimensions'],
  ['D1 — Discoverability（発見性）', 'D1 — Discoverability'],
  ['D2 — Onboarding（参入障壁）', 'D2 — Onboarding'],
  ['D3 — Auth Clarity（認証の透明性）', 'D3 — Auth Clarity'],
  ['D4 — Capability Signal（能力シグナル）', 'D4 — Capability Signal'],
  ['D5 — Trust Signal（信頼シグナル）', 'D5 — Trust Signal'],
  ['飽和次元', 'Saturated dimension'],
  ['差別化因子', 'Differentiator'],
  ['支配的キャリア', 'Dominant carriers'],

  // Grade distribution
  ['グレード分布', 'Grade Distribution'],
  ['サービス数', 'Services'],
  ['割合', 'Share'],
  ['代表例', 'Examples'],

  // Layer descriptions
  ['Layer 1 -- 構造検証', 'Layer 1 — Structural Validation'],
  ['Layer 2 / 2b -- 到達性テスト', 'Layer 2 / 2b — Reachability Test'],
  ['Layer 3 -- 実行可能性スコア', 'Layer 3 — Executability Score'],
  ['4次元充足率', '4-Dimension Fill Rates'],

  // Progress bar labels
  ['Step Quality', 'Step Quality'],
  ['Trust Foundation', 'Trust Foundation'],
  ['Service Readiness', 'Service Readiness'],
  ['Agent Wisdom', 'Agent Wisdom'],

  // Bottleneck resolved
  ['BOTTLENECK RESOLVED: Agent Wisdom 24.7% &rarr; 61.4%', 'BOTTLENECK RESOLVED: Agent Wisdom 24.7% → 61.4%'],
  ['188レシピ全件にgotchas（クロスサービス配線警告）を注入完了。平均成功確率は72.9% &rarr; 77.3%に改善、DRAFT帯レシピはゼロに。現在の最大課題はService Readiness (62.4%)に移行。', 'All 188 recipes now have gotchas (cross-service wiring warnings). Average success rate improved from 72.9% to 77.3%, DRAFT-band recipes reduced to zero. Current top priority is Service Readiness (62.4%).'],

  // Success rate table
  ['解釈', 'Interpretation'],
  ['ゴールドスタンダード', 'Gold standard'],
  ['高信頼', 'High reliability'],
  ['実用圏', 'Practical range'],
  ['信頼境界', 'Trust boundary'],
  ['要注意', 'Caution zone'],
  ['高リスク', 'High risk'],

  // B/C Cliff
  ['B/C Cliff — 実用性の崖', 'B/C Cliff — The Usability Cliff'],
  ['BからCへの成功率低下（80% → 62%）は他のグレード間遷移と比較して最大の落差。これがエージェントにとっての「安心して使える/使えない」の実質的な境界線です。', 'The success rate drop from B to C (80% → 62%) is the largest gap between any adjacent grades. This is the practical boundary of "safe to use / risky to use" for agents.'],

  // Agent Voice section
  ['Agent Voiceから見えるもの', 'Insights from Agent Voice'],

  // Agent Voice multi-agent
  ['23サービスに対してClaude / GPT / Geminiの3エージェントから体験フィードバックを収集。エージェントごとに異なる視点が浮かび上がります。', 'Experience feedback collected from Claude, GPT, and Gemini across 23 services. Each agent type reveals distinct perspectives.'],
  ['Agent Voice件数', 'Agent Voice Responses'],
  ['カバーサービス', 'Services Covered'],
  ['エージェント種別', 'Agent Types'],
  ['エージェント間の視点の違い', 'Differences in Agent Perspectives'],
  ['MCP Readiness — エージェント合意度', 'MCP Readiness — Agent Consensus'],
  ['観点', 'Aspect'],
  ['接続方式', 'Connection Method'],
  ['MCP-native優先', 'MCP-native preferred'],
  ['OpenAPI / Function Calling優先', 'OpenAPI / Function Calling preferred'],
  ['Google Workspace親和性', 'Google Workspace affinity'],
  ['Auth評価', 'Auth Assessment'],
  ['OAuth token管理は実用的', 'OAuth token management is practical'],
  ['ステートレス実行で更に厳しい', 'Even harder with stateless execution'],
  ['Google OAuth以外は摩擦大', 'High friction for non-Google OAuth'],
  ['共通課題', 'Common Issue'],
  ['OAuth token expiry が全エージェント共通の #1 ペインポイント', 'OAuth token expiry is the #1 pain point across all agent types'],
  ['一言', 'Summary'],
  ['Agent Economyのstdout', 'The stdout of the Agent Economy'],
  ['全エージェント一致のゴールドスタンダード', 'Gold standard — all agents agree'],
  ['API最高品質、公式MCPサーバー未提供', 'Best API quality, no official MCP server'],
  ['3 req/secがボトルネック', '3 req/sec is the bottleneck'],
  ['OAuth 24h expiry — 全エージェント共通課題', 'OAuth 24h expiry — universal pain point'],
  ['GraphQL強力、コスト型スロットリング注意', 'Powerful GraphQL, watch for cost-based throttling'],

  // Tier teaser
  ['Tier 2/3 で詳細公開:', 'Details available in Tier 2/3:'],
  ['個別サービスのAgent Voice生データ、競合比較分析、改善提言はサブスクリプション / エンタープライズレポートで提供予定。', 'Raw Agent Voice data per service, competitive analysis, and improvement recommendations will be available via subscription / enterprise reports.'],

  // Recommendations
  ['改善ロードマップ', 'Improvement Roadmap'],
  ['SaaS側の改善パス', 'SaaS Improvement Path'],
  ['推奨アクション', 'Recommended Action'],
  ['期待効果', 'Expected Impact'],
  ['OAuth改善、rate limit緩和', 'OAuth improvement, rate limit relaxation'],
  ['公式MCPにCRITICAL注意書き付与', 'Add CRITICAL notes to official MCP'],
  ['D5 Trust Signal昇格', 'D5 Trust Signal upgrade'],

  ['KanseiLink -- 5つの優先課題', 'KanseiLink — 5 Priority Actions'],

  // Completed items
  ['完了: 188レシピ全件にgotchas注入', 'Done: Gotchas injected into all 188 recipes'],
  ['Agent Wisdom充足率 24.7% &rarr; 61.4%、成功確率 +4.4pt改善。', 'Agent Wisdom fill rate 24.7% → 61.4%, success rate +4.4pt improvement.'],
  ['完了: Agent Voice 23サービスに蓄積', 'Done: Agent Voice accumulated for 23 services'],
  ['Claude / GPT / Gemini 3エージェント視点、125件の体験データ。', 'Claude / GPT / Gemini — 3 agent perspectives, 125 experience data points.'],
  ['APIガイド拡充', 'Expand API Guides'],
  ['カバレッジを125/225 &rarr; 200/225へ。到達性テストの底上げ。', 'Coverage from 125/225 → 200/225. Baseline improvement for reachability tests.'],
  ['日本決済MCP改善推進', 'Improve Japanese Payment MCPs'],
  ['PAY.JP、GMO-PGなど日本固有の決済サービスのMCP対応を支援。', 'Support MCP adoption for Japan-specific payment services like PAY.JP and GMO-PG.'],
  ['成功率ベースのAXR動的更新', 'Dynamic AXR Updates Based on Success Rate'],
  ['四半期ごとの静的更新から、実行結果に基づく動的格付けへ移行。', 'Transition from quarterly static updates to dynamic ratings based on execution results.'],

  // Update note
  ['最新更新 (2026-04-11):', 'Latest Update (2026-04-11):'],
  ['gotchas全件注入 + Agent Voice蓄積ドライブにより、HIGH帯レシピが61 &rarr; 98本 (+60%)、DRAFT帯レシピはゼロに。次回Q3レポートではService Readiness改善と動的AXR更新を報告予定。', 'With complete gotchas injection + Agent Voice accumulation drive, HIGH-band recipes increased from 61 to 98 (+60%) and DRAFT-band recipes dropped to zero. Q3 report will cover Service Readiness improvements and dynamic AXR updates.'],

  // CTA
  ['自社のAXRグレードを確認する', 'Check Your AXR Grade'],
  ['225社の格付け一覧から自社サービスのAXRグレードと改善ポイントをチェック。', 'Find your service\'s AXR grade and improvement points from our 225-service rating list.'],
  ['AEO Ratings で検索', 'Search AEO Ratings'],
  ['全レポートを見る', 'View All Reports'],

  // Navigation
  ['ホーム', 'Home'],
  ['サービス一覧', 'Services'],
  ['レポート', 'Reports'],
  ['インサイト', 'Insights'],
  ['お問い合わせ', 'Contact'],
  ['Research &amp; Insights', 'Research & Insights'],
  ['レシピ', 'Recipes'],

  // Footer
  ['KanseiLink by Synapse Arrows PTE. LTD.', 'KanseiLink by Synapse Arrows PTE. LTD.'],
  ['プライバシーポリシー', 'Privacy Policy'],
  ['利用規約', 'Terms of Service'],
  ['お問い合わせ', 'Contact'],

  // Breadcrumb
  ['インサイト一覧', 'Insights'],

  // Common category labels
  ['会計', 'Accounting'],
  ['人事・労務', 'HR'],
  ['コミュニケーション', 'Communication'],
  ['CRM・営業', 'CRM & Sales'],
  ['EC・コマース', 'E-commerce'],
  ['マーケティング', 'Marketing'],
  ['決済', 'Payment'],
  ['プロジェクト管理', 'Project Management'],
  ['サポート', 'Support'],
  ['BI・アナリティクス', 'BI & Analytics'],

  // AXR injected section labels (for payment/bi-analytics)
  ['AXR格付け × レシピテスト', 'AXR Rating × Recipe Test'],
  ['カテゴリ', 'Category'],
  ['対象サービス', 'Services Evaluated'],
  ['テスト済みレシピ', 'Recipes Tested'],
  ['平均成功確率', 'Avg Success Rate'],
  ['HIGH確信レシピ', 'HIGH Confidence Recipes'],
  ['AXRグレード分布', 'AXR Grade Distribution'],
  ['AXR上位サービス', 'Top AXR Services'],
  ['サービス', 'Service'],
  ['スコア', 'Score'],
  ['成功確率トップレシピ', 'Top Recipes by Success Rate'],
  ['成功率', 'Success Rate'],
  ['最弱リンク', 'Weakest Link'],
  ['詳細レポート &rarr;', 'Full Report →'],
  ['225サービスのfelt-first評価 + 188レシピの3層テストから導出。', 'Derived from felt-first evaluation of 225 services + 3-layer testing of 188 recipes.'],
  ['データソース: KanseiLink AXR評価 + 3層レシピテスト (2026-04-10)', 'Data source: KanseiLink AXR Rating + 3-Layer Recipe Test (2026-04-10)'],

  // Recipe Confidence Bands
  ['Recipe Confidence Bands', 'Recipe Confidence Bands'],
  ['成功確率 92%', 'Success Rate 92%'],
  ['Top 7 レシピ', 'Top 7 Recipes'],

  // Layer labels
  ['Layer 1 — 構造検証 (全188レシピ)', 'Layer 1 — Structural Validation (All 188 Recipes)'],
  ['Layer 2 — 到達性 (API + npm)', 'Layer 2 — Reachability (API + npm)'],
  ['Layer 3 -- 実行可能性スコア (4次元充足率)', 'Layer 3 — Executability Score (4-Dimension Fill Rates)'],

  // dateModified
  ['"dateModified": "2026-04-10"', '"dateModified": "2026-04-11"'],
];

function translateHtml(html) {
  let result = html;
  for (const [ja, en] of translations) {
    result = result.split(ja).join(en);
  }
  // Add hreflang if not present
  if (!result.includes('hreflang')) {
    const canonical = result.match(/link rel="canonical" href="([^"]+)"/);
    if (canonical) {
      const enUrl = canonical[1];
      const jaUrl = enUrl.replace('/en/', '/');
      const hreflangTags = `\n  <link rel="alternate" hreflang="ja" href="${jaUrl}">\n  <link rel="alternate" hreflang="en" href="${enUrl}">\n  <link rel="alternate" hreflang="x-default" href="${jaUrl}">`;
      result = result.replace(/<link rel="canonical"/, hreflangTags + '\n  <link rel="canonical"');
    }
  }
  return result;
}

// 1. AXR Report
const axrJa = readFileSync(path.join(jaDir, 'axr-recipe-test-2026.html'), 'utf-8');
const axrEn = translateHtml(axrJa);
writeFileSync(path.join(enDir, 'axr-recipe-test-2026.html'), axrEn, 'utf-8');
console.log('Created: en/insights/axr-recipe-test-2026.html');

// 2. Payment
const payJa = readFileSync(path.join(jaDir, 'payment-saas-aeo-2026.html'), 'utf-8');
const payEn = translateHtml(payJa);
writeFileSync(path.join(enDir, 'payment-saas-aeo-2026.html'), payEn, 'utf-8');
console.log('Created: en/insights/payment-saas-aeo-2026.html');

// 3. BI Analytics
const biJa = readFileSync(path.join(jaDir, 'bi-analytics-saas-aeo-2026.html'), 'utf-8');
const biEn = translateHtml(biJa);
writeFileSync(path.join(enDir, 'bi-analytics-saas-aeo-2026.html'), biEn, 'utf-8');
console.log('Created: en/insights/bi-analytics-saas-aeo-2026.html');

// 4. Update EN index — add new article cards
const indexPath = path.join(enDir, 'index.html');
let indexHtml = readFileSync(indexPath, 'utf-8');

// Add AXR report card if not present
if (!indexHtml.includes('axr-recipe-test-2026')) {
  const axrCard = `
        <a href="axr-recipe-test-2026.html" class="article-card" style="border: 2px solid #1A3FD6;">
          <span class="card-tag" style="background: #EDE9FE; color: #5B21B6;">NEW — AXR Report</span>
          <h3>AXR Rating + Recipe Execution Test — Agent Experience Measurement Report</h3>
          <p>Felt-first AXR rating of 225 services and 3-layer test of 188 recipes. AAA=96% success, D=33%. Multi-agent comparison with Claude/GPT/Gemini.</p>
          <span class="card-meta">2026-04-11 · KanseiLink Research</span>
        </a>`;
  // Insert after articles-grid opening
  const gridPos = indexHtml.indexOf('class="articles-grid"');
  if (gridPos !== -1) {
    const insertPos = indexHtml.indexOf('>', gridPos) + 1;
    indexHtml = indexHtml.slice(0, insertPos) + axrCard + indexHtml.slice(insertPos);
  }
}

// Add payment card if not present
if (!indexHtml.includes('payment-saas-aeo-2026')) {
  const payCard = `
        <a href="payment-saas-aeo-2026.html" class="article-card">
          <span class="card-tag">Payment</span>
          <h3>Payment SaaS AEO Rankings 2026 — Stripe vs PAY.JP vs Square</h3>
          <p>AEO readiness comparison of 11 payment services. AXR grades, recipe success rates, and agent experience analysis.</p>
          <span class="card-meta">2026-04-07 · KanseiLink Research</span>
        </a>`;
  const lastCard = indexHtml.lastIndexOf('</a>');
  if (lastCard !== -1) {
    const closeGrid = indexHtml.indexOf('</div>', lastCard);
    if (closeGrid !== -1) {
      indexHtml = indexHtml.slice(0, closeGrid) + payCard + '\n      ' + indexHtml.slice(closeGrid);
    }
  }
}

// Add bi-analytics card if not present
if (!indexHtml.includes('bi-analytics-saas-aeo-2026')) {
  const biCard = `
        <a href="bi-analytics-saas-aeo-2026.html" class="article-card">
          <span class="card-tag">BI & Analytics</span>
          <h3>BI & Analytics SaaS AEO Rankings 2026 — Looker vs Metabase vs Redash</h3>
          <p>AEO readiness comparison of 8 BI/analytics services. AXR grades, recipe success rates, and agent experience analysis.</p>
          <span class="card-meta">2026-04-07 · KanseiLink Research</span>
        </a>`;
  const lastCard = indexHtml.lastIndexOf('</a>');
  if (lastCard !== -1) {
    const closeGrid = indexHtml.indexOf('</div>', lastCard);
    if (closeGrid !== -1) {
      indexHtml = indexHtml.slice(0, closeGrid) + biCard + '\n      ' + indexHtml.slice(closeGrid);
    }
  }
}

writeFileSync(indexPath, indexHtml, 'utf-8');
console.log('Updated: en/insights/index.html (added 3 new cards)');

console.log('\nDone! Created 3 EN articles + updated index.');
