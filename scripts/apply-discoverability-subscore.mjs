#!/usr/bin/env node
/**
 * Discoverability subscore → services.axr_dims (informational).
 *
 * Reads the latest discoverability_scans rows and writes a labeled subscore
 * into services.axr_dims JSON under the "discoverability" key.
 *
 * RATING INTEGRITY RULE: this does NOT touch axr_score / axr_grade.
 * Published grades change only at quarterly Index issues (2026 Autumn earliest),
 * never silently mid-quarter. Until then the subscore is informational.
 *
 * Formula (0-100, all components public_signal or probe):
 *   +25 llms.txt on product domain          (public_signal)
 *   +15 llms.txt on developer domain        (public_signal)
 *   +15 JSON-LD on product page             (public_signal)
 *   +30 docs URL reachable (2xx/3xx)        (probe, honest UA)
 *   +15 no bot-specific AI blocks on docs robots.txt; -5 per blocked bot (floor 0)
 * Platform-hosted services (GitHub-only): subscore null — no own-domain signals.
 */
import Database from 'better-sqlite3';

const db = new Database('kansei-link.db');
const latest = db.prepare(`SELECT MAX(scanned_at) d FROM discoverability_scans`).get().d;
if (!latest) { console.error('no scans found'); process.exit(1); }

const rows = db.prepare(`SELECT * FROM discoverability_scans WHERE scanned_at = ?`).all(latest);
const getDims = db.prepare(`SELECT axr_dims FROM services WHERE id = ?`);
const setDims = db.prepare(`UPDATE services SET axr_dims = ? WHERE id = ?`);

let applied = 0, nulled = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    const raw = JSON.parse(r.raw);
    const existing = JSON.parse(getDims.get(r.service_id)?.axr_dims || '{}');

    let entry;
    if (raw.platform_hosted) {
      entry = { score: null, as_of: latest, reason: 'platform-hosted (no own domain in DB)', source_label: 'n/a' };
      nulled++;
    } else {
      const docsOk = /^[23]\d\d$/.test(String(r.docs_status));
      const components = {
        llms_txt_product: r.llms_txt_product ? 25 : 0,
        llms_txt_developer: r.llms_txt_developer ? 15 : 0,
        json_ld_product: (JSON.parse(r.json_ld_types_product || '[]').length > 0) ? 15 : 0,
        docs_reachable: docsOk ? 30 : 0,
        ai_bots_open: Math.max(0, 15 - 5 * (r.bots_blocked_developer || 0)),
      };
      entry = {
        score: Object.values(components).reduce((a, b) => a + b, 0),
        components,
        as_of: latest,
        source_label: 'public_signal+probe',
        note: 'informational — not part of axr_grade until quarterly issue',
      };
      applied++;
    }
    existing.discoverability = entry;
    setDims.run(JSON.stringify(existing), r.service_id);
  }
});
tx();
console.log(`axr_dims.discoverability written: ${applied} scored, ${nulled} null(platform-hosted), scan=${latest}`);

// sanity sample
for (const id of ['freee', 'sansan', 'moneyforward', 'slack']) {
  const d = getDims.get(id);
  if (d?.axr_dims) console.log(id, '→', JSON.stringify(JSON.parse(d.axr_dims).discoverability?.components || null), 'score:', JSON.parse(d.axr_dims).discoverability?.score);
}
db.close();
