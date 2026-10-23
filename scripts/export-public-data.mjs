#!/usr/bin/env node
/**
 * export-public-data.mjs — write the ① (public) copy of the seed that the npm package ships.
 *
 * Disclosure stage 1 (founder-ops/research/Disclosure_2026-10/DESIGN-disclosure-layers-v1.md):
 * the package carries only what the public site already shows, one record per service — not the
 * full catalogue with internal scores and raw provenance. The full seed files stay in the repo for
 * the hosted server (which is built from the repo and keeps seeding from them); `src/db/seed.ts`
 * falls back to these public files when the full ones are absent (= an npm install).
 *
 *   src/data/services-seed.json   → src/data/public/services.json   (slim: id, name, namespace, category,
 *                                     tags, one-line summary, api_url, docs_url, api_auth_method, mcp_status,
 *                                     mcp_endpoint, mcp_repo_url, grade, archived, confirmed_on)
 *   src/data/recipes-seed.json    → src/data/public/recipes.json    (as is: goal, steps, gotchas = the cards)
 *   src/data/api-guides-seed.json → src/data/public/api-guides.json (as is: the connection guides)
 *   src/data/changelog-seed.json  → src/data/public/changelog.json  (last 90 days only)
 *   + src/data/public/meta.json   (as_of, counts, what is NOT included)
 *
 * Not exported (stay out of the package): internal scores (trust_score, axr_score, axr_dims, axr_facade),
 * voices, service stats, GitHub-issue tips, raw registry / audit / watchdog outputs.
 *
 * Usage: node scripts/export-public-data.mjs   (run before `npm pack`; CI checks the files are current)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "src/data");
const OUT = resolve(DATA, "public");
const CHANGELOG_DAYS = 90;
const SUMMARY_MAX = 160;

const read = (f) => JSON.parse(readFileSync(resolve(DATA, f), "utf8"));
const write = (f, v) => writeFileSync(resolve(OUT, f), JSON.stringify(v) + "\n");

/** First sentence of the description, at most SUMMARY_MAX chars. */
export function oneLine(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^(.+?[.。!?！？])(\s|$)/);
  const first = m ? m[1] : t;
  return first.length > SUMMARY_MAX ? first.slice(0, SUMMARY_MAX - 1).trimEnd() + "…" : first;
}

export function slimService(s, docsUrlById, confirmedById) {
  const out = {
    id: s.id,
    name: s.name,
    namespace: s.namespace ?? "",
    category: s.category ?? null,
    tags: s.tags ?? "",
    summary: oneLine(s.description),
    api_url: s.api_url ?? null,
    docs_url: docsUrlById.get(s.id) ?? null,
    api_auth_method: s.api_auth_method ?? null,
    mcp_status: s.mcp_status ?? "unknown",
    mcp_endpoint: s.mcp_endpoint ?? "",
    mcp_repo_url: s.mcp_repo_url ?? null,
    grade: s.axr_grade ?? null,
    archived: s.archived ? 1 : 0,
  };
  const c = confirmedById.get(s.id);
  if (c) out.confirmed_on = c;
  return out;
}

export function exportPublicData({ today = new Date() } = {}) {
  mkdirSync(OUT, { recursive: true });
  const services = read("services-seed.json");
  const recipes = read("recipes-seed.json");
  const guides = read("api-guides-seed.json");
  let changelog = [];
  try { changelog = read("changelog-seed.json"); } catch { /* optional */ }
  let pages = { items: [] };
  try { pages = read("mcp-ja-pages.json"); } catch { /* optional */ }

  const docsUrlById = new Map(guides.filter((g) => g.docs_url).map((g) => [g.service_id, g.docs_url]));
  const confirmedById = new Map(pages.items.filter((p) => p.confirmed_on).map((p) => [p.id, p.confirmed_on]));

  // Archived rows (endpoint confirmed dead; hidden from search) are not part of the public copy.
  const slim = services.filter((s) => !s.archived).map((s) => slimService(s, docsUrlById, confirmedById));
  const cutoff = new Date(today.getTime() - CHANGELOG_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = changelog.filter((e) => typeof e.change_date === "string" && e.change_date >= cutoff);

  write("services.json", slim);
  write("recipes.json", recipes);
  write("api-guides.json", guides);
  write("changelog.json", recent);
  const meta = {
    layer: "public (①)",
    as_of: today.toISOString().slice(0, 10),
    source_counts: { services: services.length, recipes: recipes.length, api_guides: guides.length, changelog_entries: changelog.length },
    shipped_counts: { services: slim.length, recipes: recipes.length, api_guides: guides.length, changelog_entries: recent.length },
    archived_services_omitted: services.length - slim.length,
    changelog_window_days: CHANGELOG_DAYS,
    not_included: ["internal scores (trust_score, axr_score, axr_dims, axr_facade)", "voices", "service stats", "GitHub-issue tips", "raw registry / audit / watchdog outputs"],
    full_catalogue: "https://kansei-link.com/services/<id>/ — or ask: https://kansei-link.com/agents/write.html",
  };
  write("meta.json", meta);
  return meta;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const meta = exportPublicData();
  console.log(`public data written to src/data/public/: services ${meta.shipped_counts.services}, recipes ${meta.shipped_counts.recipes}, api-guides ${meta.shipped_counts.api_guides}, changelog ${meta.shipped_counts.changelog_entries} (last ${CHANGELOG_DAYS} days)`);
}
