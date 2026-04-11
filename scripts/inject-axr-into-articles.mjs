#!/usr/bin/env node
/**
 * Inject AXR + Recipe Test data section into each category AEO article.
 * Inserts a new section before the CTA banner in each article.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pubDir = path.join(root, 'public/insights');

const services = JSON.parse(readFileSync(path.join(root, 'src/data/services-seed.json'), 'utf-8'));
const recipes = JSON.parse(readFileSync(path.join(root, 'src/data/recipes-seed.json'), 'utf-8'));
const probs = JSON.parse(readFileSync(path.join(root, 'content/eval/recipe-success-probabilities.json'), 'utf-8'));

const smap = Object.fromEntries(services.map(s => [s.id, s]));
const pmap = Object.fromEntries(probs.recipes.map(r => [r.id, r]));

const GRADE_COLORS = {
  AAA: '#065F46', AA: '#059669', A: '#0891B2',
  B: '#D97706', C: '#EA580C', D: '#DC2626'
};

const catConfig = {
  accounting: { file: 'accounting-saas-aeo-2026.html', label: '会計' },
  hr: { file: 'hr-saas-aeo-2026.html', label: '人事・労務' },
  communication: { file: 'communication-saas-aeo-2026.html', label: 'コミュニケーション' },
  crm: { file: 'crm-saas-aeo-2026.html', label: 'CRM・営業' },
  ecommerce: { file: 'ecommerce-saas-aeo-2026.html', label: 'EC・コマース' },
  marketing: { file: 'marketing-saas-aeo-2026.html', label: 'マーケティング' },
  payment: { file: 'payment-saas-aeo-2026.html', label: '決済' },
  project_management: { file: 'project-mgmt-saas-aeo-2026.html', label: 'プロジェクト管理' },
  support: { file: 'support-saas-aeo-2026.html', label: 'サポート' },
  bi_analytics: { file: 'bi-analytics-saas-aeo-2026.html', label: 'BI・アナリティクス' },
};

for (const [cat, cfg] of Object.entries(catConfig)) {
  const filePath = path.join(pubDir, cfg.file);
  let html;
  try {
    html = readFileSync(filePath, 'utf-8');
  } catch { console.log(`Skip: ${cfg.file} not found`); continue; }

  // Skip if already injected
  if (html.includes('axr-recipe-section')) {
    console.log(`Skip: ${cfg.file} already has AXR section`);
    continue;
  }

  // Gather category data
  const catServices = services.filter(s => s.category === cat);
  const axrDist = {};
  for (const s of catServices) {
    const g = s.axr_grade || '?';
    axrDist[g] = (axrDist[g] || 0) + 1;
  }

  const topServices = catServices
    .filter(s => s.axr_score)
    .sort((a, b) => b.axr_score - a.axr_score)
    .slice(0, 5);

  // Recipes for this category
  const catRecipeIds = new Set();
  for (const r of recipes) {
    for (const sid of (r.required_services || [])) {
      if (smap[sid]?.category === cat) { catRecipeIds.add(r.id); break; }
    }
  }
  const catRecipes = [...catRecipeIds]
    .map(id => pmap[id])
    .filter(Boolean)
    .sort((a, b) => b.success_probability - a.success_probability);

  const avgProb = catRecipes.length > 0
    ? (catRecipes.reduce((s, r) => s + r.success_probability, 0) / catRecipes.length).toFixed(1)
    : '—';

  const highCount = catRecipes.filter(r => r.success_probability >= 80).length;
  const bestRecipe = catRecipes[0];

  // Build distribution bar
  const gradeOrder = ['AAA', 'AA', 'A', 'B', 'C', 'D'];
  const total = catServices.length;
  const distSegments = gradeOrder
    .filter(g => axrDist[g])
    .map(g => `<span style="flex:${axrDist[g]};background:${GRADE_COLORS[g]};color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${g} ${axrDist[g]}</span>`)
    .join('');

  // Top services rows
  const topRows = topServices.map(s =>
    `<tr><td><strong>${s.name}</strong></td><td><span style="background:${GRADE_COLORS[s.axr_grade]};color:white;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700;">${s.axr_grade}</span></td><td>${s.axr_score}</td></tr>`
  ).join('\n              ');

  // Top recipes rows
  const topRecipeRows = catRecipes.slice(0, 5).map(r =>
    `<tr><td>${r.id}</td><td><strong>${r.success_probability}%</strong></td><td>${r.weakest_grade || '—'}</td><td>${r.step_count}</td></tr>`
  ).join('\n              ');

  // Build the section HTML
  const section = `
    <!-- AXR × Recipe Test Section (auto-injected 2026-04-10) -->
    <div id="axr-recipe-section" style="margin:48px 0;padding:32px;background:linear-gradient(135deg,#F4F5FD 0%,#EEF2FF 100%);border-radius:16px;border:1px solid #E0E7FF;">
      <h2 style="color:#1A3FD6;margin:0 0 8px;font-size:22px;">AXR格付け × レシピテスト — ${cfg.label}カテゴリ</h2>
      <p style="color:#6B7280;font-size:14px;margin:0 0 24px;">225サービスのfelt-first評価 + 188レシピの3層テストから導出。<a href="axr-recipe-test-2026.html" style="color:#1A3FD6;">詳細レポート &rarr;</a></p>

      <!-- Key Metrics -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">
        <div style="background:white;padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#1A3FD6;">${total}</div>
          <div style="font-size:12px;color:#6B7280;">対象サービス</div>
        </div>
        <div style="background:white;padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#059669;">${catRecipes.length}</div>
          <div style="font-size:12px;color:#6B7280;">テスト済みレシピ</div>
        </div>
        <div style="background:white;padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#D97706;">${avgProb}%</div>
          <div style="font-size:12px;color:#6B7280;">平均成功確率</div>
        </div>
        <div style="background:white;padding:16px;border-radius:12px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#065F46;">${highCount}</div>
          <div style="font-size:12px;color:#6B7280;">HIGH確信レシピ</div>
        </div>
      </div>

      <!-- AXR Distribution -->
      <h3 style="font-size:16px;margin:0 0 8px;">AXRグレード分布</h3>
      <div style="display:flex;border-radius:8px;overflow:hidden;height:32px;margin-bottom:16px;">
        ${distSegments}
      </div>

      <!-- Top Services -->
      <h3 style="font-size:16px;margin:0 0 8px;">AXR上位サービス</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <thead>
          <tr style="border-bottom:2px solid #E5E7EB;">
            <th style="text-align:left;padding:8px;">サービス</th>
            <th style="text-align:left;padding:8px;">AXR</th>
            <th style="text-align:left;padding:8px;">スコア</th>
          </tr>
        </thead>
        <tbody>
          ${topRows}
        </tbody>
      </table>

      <!-- Top Recipes -->
      ${catRecipes.length > 0 ? `
      <h3 style="font-size:16px;margin:0 0 8px;">成功確率トップレシピ</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
        <thead>
          <tr style="border-bottom:2px solid #E5E7EB;">
            <th style="text-align:left;padding:8px;">レシピ</th>
            <th style="text-align:left;padding:8px;">成功率</th>
            <th style="text-align:left;padding:8px;">最弱リンク</th>
            <th style="text-align:left;padding:8px;">Steps</th>
          </tr>
        </thead>
        <tbody>
          ${topRecipeRows}
        </tbody>
      </table>` : ''}

      <p style="font-size:13px;color:#9CA3AF;margin:0;">データソース: KanseiLink AXR評価 + 3層レシピテスト (2026-04-10)</p>
    </div>
    <!-- /AXR Section -->
`;

  // Find insertion point: before CTA banner or before footer
  let insertBefore = html.indexOf('<div class="cta-banner">');
  if (insertBefore === -1) insertBefore = html.indexOf('class="cta-banner"');
  if (insertBefore === -1) insertBefore = html.indexOf('<!-- For AI Agents -->');
  if (insertBefore === -1) insertBefore = html.indexOf('<section class="agent-section">');
  if (insertBefore === -1) insertBefore = html.indexOf('</article>');

  if (insertBefore === -1) {
    console.log(`Skip: ${cfg.file} — no insertion point found`);
    continue;
  }

  const newHtml = html.slice(0, insertBefore) + section + html.slice(insertBefore);
  writeFileSync(filePath, newHtml, 'utf-8');
  console.log(`Injected: ${cfg.file} — ${total} services, ${catRecipes.length} recipes, avg ${avgProb}%`);
}

console.log('\nDone!');
