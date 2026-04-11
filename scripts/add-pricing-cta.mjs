#!/usr/bin/env node
/**
 * Add Pricing CTA banner to category AEO articles.
 * Inserts a "Unlock full analysis" CTA before the existing MCP cta-banner.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const CATEGORIES = [
  'accounting', 'hr', 'communication', 'crm', 'ecommerce',
  'marketing', 'payment', 'project-mgmt', 'support', 'bi-analytics'
];

const JA_CTA = `
    <div style="margin:32px 0;padding:28px 32px;background:linear-gradient(135deg,#1A3FD6 0%,#7882DC 100%);border-radius:16px;color:white;text-align:center;">
      <div style="font-size:20px;font-weight:700;margin-bottom:8px;">AXR詳細データ + Agent Voiceを見る</div>
      <p style="font-size:15px;opacity:0.9;margin:0 0 16px;line-height:1.6;">サービス別のAXRスコア推移、レシピ成功率、gotchas、マルチエージェント比較をProプランで解放。</p>
      <a href="../pricing.html" style="display:inline-block;padding:12px 32px;background:white;color:#1A3FD6;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">料金プランを見る →</a>
    </div>`;

const EN_CTA = `
    <div style="margin:32px 0;padding:28px 32px;background:linear-gradient(135deg,#1A3FD6 0%,#7882DC 100%);border-radius:16px;color:white;text-align:center;">
      <div style="font-size:20px;font-weight:700;margin-bottom:8px;">Unlock Full AXR Data + Agent Voice</div>
      <p style="font-size:15px;opacity:0.9;margin:0 0 16px;line-height:1.6;">Access per-service AXR trends, recipe success rates, gotchas, and multi-agent comparison with Pro.</p>
      <a href="../pricing.html" style="display:inline-block;padding:12px 32px;background:white;color:#1A3FD6;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">View Plans →</a>
    </div>`;

let updated = 0;

for (const cat of CATEGORIES) {
  for (const [dir, cta] of [['public/insights', JA_CTA], ['public/en/insights', EN_CTA]]) {
    const file = `${dir}/${cat}-saas-aeo-2026.html`;
    if (!existsSync(file)) continue;

    let html = readFileSync(file, 'utf-8');

    // Skip if already has pricing CTA
    if (html.includes('料金プランを見る') || html.includes('View Plans →')) continue;

    // Insert before the cta-banner div
    const marker = '<div class="cta-banner">';
    const idx = html.indexOf(marker);
    if (idx === -1) continue;

    html = html.slice(0, idx) + cta + '\n' + html.slice(idx);
    writeFileSync(file, html, 'utf-8');
    console.log(`[OK] ${file}`);
    updated++;
  }
}

console.log(`\nDone: ${updated} files updated`);
