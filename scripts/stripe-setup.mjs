#!/usr/bin/env node
/**
 * Stripe Test Mode Setup — Creates Products + Prices for KanseiLink.
 *
 * Prerequisites:
 *   1. Set STRIPE_SECRET_KEY=sk_test_... in .env
 *   2. Run: node scripts/stripe-setup.mjs
 *
 * Creates:
 *   - Product: KanseiLink Pro
 *     - Price: $19/mo (monthly)
 *     - Price: $149/yr (annual, 35% off)
 *   - Product: KanseiLink Team
 *     - Price: $149/mo per service
 *
 * Outputs the Price IDs to paste into .env
 */

import Stripe from 'stripe';
import { config } from 'dotenv';

config(); // Load .env

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('ERROR: Set STRIPE_SECRET_KEY in .env first');
  console.error('Get your test key from: https://dashboard.stripe.com/test/apikeys');
  process.exit(1);
}

if (!key.startsWith('sk_test_')) {
  console.error('WARNING: This key does not start with sk_test_. Are you sure this is a test key?');
  console.error('Aborting for safety. Use a test mode key.');
  process.exit(1);
}

const stripe = new Stripe(key);

async function main() {
  console.log('Creating KanseiLink Stripe products and prices...\n');

  // ─── Pro Product ───
  const proProd = await stripe.products.create({
    name: 'KanseiLink Pro',
    description: 'Full article access, Agent Voice details, recipe success rates, multi-agent comparison (Claude/GPT/Gemini)',
    metadata: { tier: 'pro' },
  });
  console.log(`Product created: ${proProd.name} (${proProd.id})`);

  const proMonthly = await stripe.prices.create({
    product: proProd.id,
    unit_amount: 1900, // $19.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: 'pro', billing: 'monthly' },
  });
  console.log(`  Pro Monthly: $19/mo → ${proMonthly.id}`);

  const proAnnual = await stripe.prices.create({
    product: proProd.id,
    unit_amount: 14900, // $149.00
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: { tier: 'pro', billing: 'annual' },
  });
  console.log(`  Pro Annual:  $149/yr → ${proAnnual.id}`);

  // ─── Team Product ───
  const teamProd = await stripe.products.create({
    name: 'KanseiLink Team',
    description: 'Per-service detailed reports, competitive analysis, AXR trends, raw Agent Voice data',
    metadata: { tier: 'team' },
  });
  console.log(`\nProduct created: ${teamProd.name} (${teamProd.id})`);

  const teamMonthly = await stripe.prices.create({
    product: teamProd.id,
    unit_amount: 14900, // $149.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: 'team', billing: 'monthly' },
  });
  console.log(`  Team Monthly: $149/mo per service → ${teamMonthly.id}`);

  // ─── Output .env values ───
  console.log('\n' + '='.repeat(60));
  console.log('Add these to your .env file:');
  console.log('='.repeat(60));
  console.log(`STRIPE_PRICE_PRO_MONTHLY=${proMonthly.id}`);
  console.log(`STRIPE_PRICE_PRO_ANNUAL=${proAnnual.id}`);
  console.log(`STRIPE_PRICE_TEAM=${teamMonthly.id}`);
  console.log('='.repeat(60));

  // ─── Webhook setup reminder ───
  console.log('\nNext steps:');
  console.log('1. Copy the price IDs above into .env');
  console.log('2. Set up webhook endpoint:');
  console.log('   stripe listen --forward-to localhost:3000/webhooks/stripe');
  console.log('   (or set STRIPE_WEBHOOK_SECRET from Stripe Dashboard)');
  console.log('3. Start the server: npm run start:http');
  console.log('4. Test checkout: POST /api/checkout { "priceId": "' + proMonthly.id + '" }');
}

main().catch(err => {
  console.error('Stripe setup failed:', err.message);
  process.exit(1);
});
