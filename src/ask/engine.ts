// ---------------------------------------------------------------------------
// ask v1 — the read-only "stuck on an error" lookup (DESIGN-ask-v1-2026-10-20).
//
// An agent hands us a service id and an error message. We mask secrets, pull
// out an error key (HTTP status + provider code), match it against checked
// remedies, and answer 200 whether or not anything matched. Nothing an agent
// sends is ever published: the only durable trace is one `ask_log` row
// holding service, the error key (known provider codes only), the sha256 of
// the MASKED text, the match count, runtime family, UA class and request id.
// Nothing derived from the words of the question is stored: no raw text, no
// tokens, no word order or word set (Codex re-review 2026-10-21). No IP.
//
// Matching parts (parseErrorKey / normalizeSymptom / tokenOverlap / isSimilar /
// normalizeRuntime) were ported from the unpublished `ask-endpoint` branch
// (fa7100ea). The `agent_cards` table and "create an unverified card when
// nothing matches" behaviour were deliberately NOT ported (§9 decision 1).
// ---------------------------------------------------------------------------
import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { maskSecrets } from "../utils/secret-mask.js";
import { maskPii } from "../utils/pii-masker.js";
import { sanitizeUntrusted } from "../utils/untrusted.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ASK_GET_MAX = 300;
export const ASK_POST_MAX = 2000;
export const ASK_MAX_MATCHES = 5;
export const ASK_LOG_RETENTION_DAYS = 180;
export const ASK_DAILY_CAP_DEFAULT = 5000;

export class AskError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// ─── Error key / normalisation (ported) ────────────────────────────

export interface ErrorKey {
  layer: "rest" | "mcp" | "unknown";
  http_status: number | null;
  provider_code: string | null;
}

const RUNTIME_FAMILIES = ["claude", "codex", "gpt", "openai", "gemini", "cursor", "copilot",
  "llama", "mistral", "grok", "deepseek", "qwen", "windsurf", "cline", "aider"];

/** Collapse any runtime label to a known family (never a user/installation identifier). */
export function normalizeRuntime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const low = String(raw).toLowerCase();
  return RUNTIME_FAMILIES.find((f) => low.includes(f)) ?? "other";
}

/** Mask secrets + PII, strip control chars, cap length. The ONLY text that may be hashed/tokenised. */
export function cleanText(raw: string | null | undefined, maxLen: number): string {
  if (!raw) return "";
  const sanitized = sanitizeUntrusted(raw, maxLen);
  return maskPii(maskSecrets(sanitized).masked).masked;
}

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "is", "are", "was", "for", "and", "or", "with", "at", "by",
  "error", "errors", "failed", "fail", "request", "response", "http", "https", "api", "when", "while",
  "mcp", "tool", "returned", "returns", "got", "get", "this", "that", "it", "be", "not",
]);
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** lowercase → drop masked placeholders/digits/punctuation → tokens (CJK as bigrams). */
export function normalizeSymptom(text: string): string[] {
  const low = text
    .toLowerCase()
    .replace(/\[(?:token|api_key|secret|email|url|uuid|jwt|hex|blob|name|ip|phone|tenant|id|key|opaque|auth|private_key)\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^\p{L}\p{N}_]+/gu, " ");
  const out = new Set<string>();
  for (const tok of low.split(/\s+/)) {
    if (!tok) continue;
    if (CJK.test(tok)) {
      const chars = Array.from(tok);
      if (chars.length === 1) out.add(chars[0]);
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
      continue;
    }
    if (tok.length < 2 || STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return [...out];
}

/** Best-effort extraction of HTTP status + provider code from masked error text. */
export function parseErrorKey(symptom: string): ErrorKey {
  const s = symptom;
  let http: number | null = null;
  const m1 = s.match(/\b(?:http|status(?:\s*code)?|statuscode|code)\s*[:=]?\s*([1-5]\d\d)\b/i)
    ?? s.match(/\b([45]\d\d)\b(?=\s*(?:[:\-–]|\(|[A-Z][a-z]|$))/m)
    ?? s.match(/\b([45]\d\d)\b/);
  if (m1) http = parseInt(m1[1], 10);

  let code: string | null = null;
  const m2 =
    s.match(/["']?(?:provider_code|error_code|errorCode|code|error|type)["']?\s*[:=]\s*["']?([A-Za-z][A-Za-z0-9_.-]{2,63})["']?/) ??
    s.match(/\b([a-z][a-z0-9]*_[a-z0-9_]{2,})\b(?!\s*[=:])/) ?? // snake_case word, but not a key name such as api_key=…
    s.match(/\b([A-Za-z]+(?:Error|Exception|Denied|Expired|Forbidden|Unauthorized|TooManyRequests))\b/);
  if (m2 && !/^(true|false|null|undefined)$/i.test(m2[1])) code = m2[1];

  const layer: ErrorKey["layer"] = http ? "rest" : /\bmcp\b|tool call|tool_use|freee-mcp|server/i.test(s) ? "mcp" : "unknown";
  return { layer, http_status: http, provider_code: code };
}

/** Overlap coefficient |A∩B| / min(|A|,|B|). */
export function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sb = new Set(b);
  let inter = 0;
  for (const t of a) if (sb.has(t)) inter++;
  return inter / Math.min(a.length, b.length);
}

export const SIMILARITY_THRESHOLD = 0.6;

export function keysMatch(a: ErrorKey | null, b: ErrorKey | null): boolean {
  return !!(a && b && a.http_status && a.provider_code && a.http_status === b.http_status
    && a.provider_code.toLowerCase() === b.provider_code?.toLowerCase());
}

export function isSimilar(aTokens: string[], aKey: ErrorKey | null, bTokens: string[], bKey: ErrorKey | null): boolean {
  if (keysMatch(aKey, bKey)) return true;
  const sb = new Set(bTokens);
  const inter = aTokens.filter((t) => sb.has(t)).length;
  if (inter < 2) return false;
  return tokenOverlap(aTokens, bTokens) >= SIMILARITY_THRESHOLD;
}

// ─── Candidates: checked remedies only (§9 decision 4) ─────────────

export type MatchStatus = "verified" | "lived";
export type MatchSource = "field_note" | "note" | "error_card";

export interface Candidate {
  source: MatchSource;
  id: string;
  status: MatchStatus;
  service_id: string;
  error_key: ErrorKey;
  message_pattern: string | null;
  text: string;                 // matched by token overlap
  applies_when: string | null;
  first_check: string | null;
  how_resolved: string | null;
  success_check: string | null;
  page: string | null;
}

function loadJsonFile<T>(candidates: string[]): T | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try { return JSON.parse(readFileSync(p, "utf-8")) as T; } catch { return null; }
  }
  return null;
}

function serviceIdFromNote(service: string): string {
  const m = service.match(/service_id:\s*([a-z0-9][a-z0-9._-]*)/i);
  return (m ? m[1] : service.split(/[（(\s]/)[0]).toLowerCase();
}

let fieldNotesCache: Candidate[] | null = null;
/** public/insights/agent-field-notes.json → candidates (status = kind, only verified/lived kept). */
export function loadFieldNotes(): Candidate[] {
  if (fieldNotesCache) return fieldNotesCache;
  const raw = loadJsonFile<{ items?: any[] }>([
    path.join(__dirname, "..", "..", "public", "insights", "agent-field-notes.json"),
    path.join(process.cwd(), "public", "insights", "agent-field-notes.json"),
  ]);
  fieldNotesCache = (raw?.items ?? []).flatMap((n): Candidate[] => {
    const status = String(n.kind ?? "");
    if (status !== "lived" && status !== "verified") return [];
    const ek = n.error_key ?? {};
    const human = String(n.human_step_required ?? "");
    return [{
      source: "field_note",
      id: String(n.card_id),
      status,
      service_id: serviceIdFromNote(String(n.service ?? "")),
      error_key: {
        layer: ek.layer === "rest" || ek.layer === "mcp" ? ek.layer : "unknown",
        http_status: typeof ek.http_status === "number" ? ek.http_status : null,
        provider_code: ek.provider_code ? String(ek.provider_code) : null,
      },
      message_pattern: ek.message_pattern ? String(ek.message_pattern).replace(/^contains\s+/i, "") : null,
      text: [n.what_the_agent_saw, ek.message_pattern].filter(Boolean).join(" "),
      applies_when: n.what_the_agent_saw ? String(n.what_the_agent_saw) : null,
      first_check: n.what_was_true ? String(n.what_was_true) : null,
      how_resolved: n.how_resolved ? String(n.how_resolved) : null,
      success_check: human && !/^no$/i.test(human) ? `human step required — ${human}` : null,
      page: n.page ? String(n.page) : null,
    }];
  });
  return fieldNotesCache;
}

/** Error cards (agent-stars wiki/errors, SCHEMA-ErrorCard-v1). Import is a separate job; the slot is here. */
let errorCardsCache: Candidate[] | null = null;
export function loadErrorCards(): Candidate[] {
  if (errorCardsCache) return errorCardsCache;
  const raw = loadJsonFile<{ items?: any[] }>([
    path.join(__dirname, "..", "..", "src", "data", "error-cards.json"),
    path.join(__dirname, "..", "data", "error-cards.json"),
  ]);
  errorCardsCache = (raw?.items ?? []).flatMap((c): Candidate[] => {
    const status = String(c.status ?? "");
    if (status !== "lived" && status !== "verified") return [];
    const ek = c.error_key ?? {};
    return [{
      source: "error_card",
      id: String(c.id ?? c.card_id),
      status,
      service_id: String(c.service_id ?? "").toLowerCase(),
      error_key: {
        layer: ek.layer === "rest" || ek.layer === "mcp" ? ek.layer : "unknown",
        http_status: typeof ek.http_status === "number" ? ek.http_status : null,
        provider_code: ek.provider_code ? String(ek.provider_code) : null,
      },
      message_pattern: ek.message_pattern ? String(ek.message_pattern) : null,
      text: [c.symptom, ek.message_pattern].filter(Boolean).join(" "),
      applies_when: c.applies_when ?? null,
      first_check: c.first_check ?? null,
      how_resolved: c.how_resolved ?? null,
      success_check: c.success_check ?? null,
      page: c.page ?? null,
    }];
  });
  return errorCardsCache;
}

/** agent_notes rows that reached verified/lived (none today: v0 pins status to unverified) and are not hidden. */
function loadNoteCandidates(db: Database.Database, serviceId: string): Candidate[] {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_notes'").get();
  if (!hasTable) return [];
  const rows = db.prepare(`SELECT id, service_id, status, task, symptom, procedure, conditions, evidence
    FROM agent_notes WHERE service_id = ? AND hidden = 0 AND status IN ('verified','lived')
    ORDER BY created_at DESC LIMIT 200`).all(serviceId) as Array<Record<string, string>>;
  return rows.map((r) => ({
    source: "note",
    id: r.id,
    status: r.status as MatchStatus,
    service_id: r.service_id,
    error_key: parseErrorKey(r.symptom),
    message_pattern: null,
    text: `${r.task} ${r.symptom}`,
    applies_when: r.conditions,
    first_check: r.symptom,
    how_resolved: r.procedure,
    success_check: r.evidence,
    page: null,
  }));
}

// ─── What is kept is decided by what we already know (Codex review 2026-10-21) ──
// Masking regexes always have holes, and "known words" are no guarantee either: a secret can be
// built from ordinary words (Codex re-review). So ask_log keeps no words at all, and a
// provider_code is kept only if a checked candidate carries the same code.

let fileCodesCache: Map<string, string> | null = null;
function codesOf(candidates: Candidate[], into = new Map<string, string>()): Map<string, string> {
  for (const c of candidates) if (c.error_key.provider_code) into.set(c.error_key.provider_code.toLowerCase(), c.error_key.provider_code);
  return into;
}
/**
 * The ONLY place a parsed error key becomes usable. A provider_code is kept when a checked candidate
 * carries the same code (returned in the candidate's spelling); otherwise it becomes null and
 * codeKnown=false. The raw parsed key must not be passed anywhere after this call (ask_log, stats,
 * candidates, logs, response).
 */
export function publicErrorKey(raw: ErrorKey, noteCandidates: Candidate[]): { key: ErrorKey; codeKnown: boolean | null } {
  if (!raw.provider_code) return { key: { ...raw, provider_code: null }, codeKnown: null };
  if (!fileCodesCache) fileCodesCache = codesOf([...loadFieldNotes(), ...loadErrorCards()]);
  const lower = raw.provider_code.toLowerCase();
  const known = fileCodesCache.get(lower) ?? codesOf(noteCandidates).get(lower) ?? null;
  return { key: { ...raw, provider_code: known }, codeKnown: known !== null };
}

/** Startup diagnostic: how many verified/lived candidates each file source contributes (counts only). */
export function candidateSourceCounts(): { field_notes: number; error_cards: number } {
  return { field_notes: loadFieldNotes().length, error_cards: loadErrorCards().length };
}

export interface AskMatch {
  source: MatchSource; id: string; status: MatchStatus;
  applies_when: string | null; first_check: string | null; how_resolved: string | null;
  success_check: string | null; page: string | null;
  matched_by: "error_key" | "message" | "tokens";
}

/** ① error key ② message pattern contained ③ token overlap ≥ 0.6 — top 5. */
export function matchCandidates(candidates: Candidate[], serviceId: string, masked: string, key: ErrorKey): AskMatch[] {
  const low = masked.toLowerCase();
  const tokens = normalizeSymptom(masked);
  const scored: Array<{ score: number; m: AskMatch }> = [];
  for (const c of candidates) {
    if (c.service_id !== serviceId) continue;
    let score = 0; let by: AskMatch["matched_by"] | null = null;
    if (keysMatch(key, c.error_key)) { score = 3; by = "error_key"; }
    else if (c.message_pattern && c.message_pattern.length >= 4 && low.includes(c.message_pattern.toLowerCase())) { score = 2; by = "message"; }
    else {
      const ctokens = normalizeSymptom(c.text);
      if (isSimilar(tokens, key, ctokens, c.error_key)) { score = 1 + tokenOverlap(tokens, ctokens); by = "tokens"; }
    }
    if (!by) continue;
    if (c.status === "verified") score += 0.1; // verified ranks above lived on a tie
    scored.push({ score, m: {
      source: c.source, id: c.id, status: c.status, applies_when: c.applies_when, first_check: c.first_check,
      how_resolved: c.how_resolved, success_check: c.success_check, page: c.page, matched_by: by,
    } });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, ASK_MAX_MATCHES).map((s) => s.m);
}

// ─── ask_log (demand ledger) ───────────────────────────────────────

export function ensureAskSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ask_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asked_at TEXT NOT NULL DEFAULT (datetime('now')),
      service_id TEXT NOT NULL,
      layer TEXT NOT NULL,
      http_status INTEGER,
      provider_code TEXT,
      error_sha256 TEXT NOT NULL,
      -- Kept for schema stability only; always '[]'. Nothing derived from the question's words is stored.
      tokens TEXT NOT NULL,
      runtime TEXT,
      ua_class TEXT NOT NULL,
      match_count INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      code_known INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ask_log_service_time ON ask_log(service_id, asked_at);
  `);
  // code_known: NULL = no code parsed, 1 = matched a checked candidate's code, 0 = parsed but unknown
  // (provider_code stored as null; counted for the admin queue only, never published).
  const askCols = db.pragma("table_info(ask_log)") as Array<{ name: string }>;
  if (!askCols.some((c) => c.name === "code_known")) db.exec("ALTER TABLE ask_log ADD COLUMN code_known INTEGER");
  // 180-day retention, applied at startup (no raw text is kept, but demand data is still bounded).
  db.prepare(`DELETE FROM ask_log WHERE asked_at < datetime('now', ?)`).run(`-${ASK_LOG_RETENTION_DAYS} days`);
  // 2026-10-22 (discovery v1): which service ids were asked for but do not exist. Only an id that matches
  // UNKNOWN_ID_RE is stored; anything else is counted as "malformed" with no content. No question text, no IP.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ask_unknown_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asked_at TEXT NOT NULL DEFAULT (datetime('now')),
      service_id TEXT,
      malformed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ask_unknown_service_time ON ask_unknown_service(asked_at);
  `);
  db.prepare(`DELETE FROM ask_unknown_service WHERE asked_at < datetime('now', ?)`).run(`-${ASK_LOG_RETENTION_DAYS} days`);
}

/** Shape an unknown service id must have to be stored at all (otherwise only the malformed count grows). */
export const UNKNOWN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function recordUnknownService(db: Database.Database, service: string): void {
  if (!askLogEnabled()) return;
  if (UNKNOWN_ID_RE.test(service)) db.prepare(`INSERT INTO ask_unknown_service (service_id, malformed) VALUES (?, 0)`).run(service);
  else db.prepare(`INSERT INTO ask_unknown_service (service_id, malformed) VALUES (NULL, 1)`).run();
}

/** Admin: service ids asked for that do not exist (last `days`), most frequent first; malformed = count only. */
export function askUnknownServiceIds(db: Database.Database, days = 7, limit = 20) {
  const ids = db.prepare(`SELECT service_id, count(*) AS asks, max(asked_at) AS last_asked_at
    FROM ask_unknown_service WHERE malformed = 0 AND asked_at >= datetime('now', ?)
    GROUP BY service_id ORDER BY asks DESC, last_asked_at DESC LIMIT ?`).all(`-${days} days`, limit) as Array<{ service_id: string; asks: number; last_asked_at: string }>;
  const malformed = (db.prepare(`SELECT count(*) AS n FROM ask_unknown_service WHERE malformed = 1 AND asked_at >= datetime('now', ?)`)
    .get(`-${days} days`) as { n: number }).n;
  return { window_days: days, ids, malformed };
}

export function askLogEnabled(): boolean {
  const v = (process.env.ASK_LOG_ENABLED ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0");
}

// Global daily cap (all callers, HTTP and MCP). In-memory, UTC day; resets on restart.
let capDay = ""; let capCount = 0;
export function dailyCap(): number {
  const n = Number.parseInt(process.env.ASK_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : ASK_DAILY_CAP_DEFAULT;
}
export function takeDailySlot(now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  if (day !== capDay) { capDay = day; capCount = 0; }
  if (capCount >= dailyCap()) return false;
  capCount++;
  return true;
}
export function resetDailyCapForTests(): void { capDay = ""; capCount = 0; }
/** Slots taken today (UTC day, this process). Read-only; the same counter the cap enforces. */
export function dailySlotsUsed(now = new Date()): number {
  return capDay === now.toISOString().slice(0, 10) ? capCount : 0;
}

// ─── The operation ─────────────────────────────────────────────────

export const askSchema = z.object({
  service: z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9_.-]+$/),
  error: z.string().min(1),
  runtime: z.string().trim().max(40).optional(),
}).strict();

export interface AskOptions {
  uaClass: string;          // ai_crawler | mcp_client | browser | unknown
  requestId?: string;
  maxErrorLength: number;   // ASK_GET_MAX or ASK_POST_MAX
}

export interface AskResponse {
  service: string;
  error_key: ErrorKey;
  matches: AskMatch[];
  same_symptom_30d: number;
  official_docs: string | null;
  if_no_match: string;
  request_id: string;
  content_role: "untrusted_data";
}

const IF_NO_MATCH = "No checked fix is on file for this service and error key. If your user allows, what you tried can be recorded with report({ mode: 'note', note: {..., share: true} }) or POST /api/v1/notes; unmatched error keys are queued for verification.";

export function officialDocs(db: Database.Database, serviceId: string): string | null {
  const guide = db.prepare("SELECT docs_url FROM service_api_guides WHERE service_id = ? LIMIT 1").get(serviceId) as { docs_url: string | null } | undefined;
  if (guide?.docs_url) return guide.docs_url;
  const svc = db.prepare("SELECT api_url FROM services WHERE id = ?").get(serviceId) as { api_url: string | null } | undefined;
  return svc?.api_url ?? null;
}

/**
 * Validate → mask → key → match → log. Throws AskError(400 too_long / 404 service_not_found /
 * 429 daily_limit). Never throws on "no match": that is a 200 with matches: [].
 */
export function ask(db: Database.Database, raw: unknown, opts: AskOptions): AskResponse {
  const input = askSchema.parse(raw);
  if (input.error.length > opts.maxErrorLength) {
    throw new AskError(400, "too_long", opts.maxErrorLength === ASK_GET_MAX
      ? `error exceeds ${ASK_GET_MAX} characters; send it as JSON with POST /api/v1/ask (up to ${ASK_POST_MAX})`
      : `error exceeds ${ASK_POST_MAX} characters; send only the error message, not the whole trace`);
  }
  if (!db.prepare("SELECT 1 FROM services WHERE id = ?").get(input.service)) {
    recordUnknownService(db, input.service);
    throw new AskError(404, "service_not_found", "unknown service id; use search_services to find the id");
  }
  if (!takeDailySlot()) throw new AskError(429, "daily_limit", "ask has reached today's global capacity; try again tomorrow");

  const masked = cleanText(input.error, opts.maxErrorLength);
  const runtime = normalizeRuntime(input.runtime);
  const requestId = opts.requestId ?? randomUUID();
  const noteCandidates = loadNoteCandidates(db, input.service);
  // Converted once, right after parsing; the raw provider_code is not used past this line.
  const { key, codeKnown } = publicErrorKey(parseErrorKey(masked), noteCandidates);
  const candidates = [...loadFieldNotes(), ...loadErrorCards(), ...noteCandidates];
  const matches = matchCandidates(candidates, input.service, masked, key);

  const same = (db.prepare(`SELECT count(*) AS n FROM ask_log WHERE service_id = ? AND layer = ?
    AND http_status IS ? AND provider_code IS ? AND asked_at >= datetime('now', '-30 days')`)
    .get(input.service, key.layer, key.http_status, key.provider_code) as { n: number }).n;

  const sha = createHash("sha256").update(masked).digest("hex");
  if (askLogEnabled()) {
    db.prepare(`INSERT INTO ask_log (service_id, layer, http_status, provider_code, code_known, error_sha256, tokens, runtime, ua_class, match_count, request_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(input.service, key.layer, key.http_status, key.provider_code,
      codeKnown === null ? null : codeKnown ? 1 : 0, sha,
      "[]", runtime, opts.uaClass, matches.length, requestId);
    // One-line log: never the error text; only the allow-listed key. ASK_LOG_ENABLED=false silences it too.
    console.log(`[ask] service=${input.service} key=${key.layer}/${key.http_status ?? "-"}/${key.provider_code ?? "-"} sha=${sha.slice(0, 16)} matches=${matches.length} ua=${opts.uaClass} rid=${requestId}`);
  }

  return {
    service: input.service,
    error_key: key,
    matches,
    same_symptom_30d: same,
    official_docs: officialDocs(db, input.service),
    if_no_match: IF_NO_MATCH,
    request_id: requestId,
    content_role: "untrusted_data",
  };
}

// ─── Aggregates ────────────────────────────────────────────────────

/** Public: 30-day counts per service × error_key. Individual asks are never exposed. */
export function askStats(db: Database.Database) {
  const rows = db.prepare(`SELECT service_id, layer, http_status, provider_code,
      count(*) AS asks, sum(match_count > 0) AS matched
    FROM ask_log WHERE asked_at >= datetime('now', '-30 days')
    GROUP BY service_id, layer, http_status, provider_code
    ORDER BY asks DESC, service_id LIMIT 200`).all() as Array<{ service_id: string; layer: string; http_status: number | null; provider_code: string | null; asks: number; matched: number }>;
  return {
    schema: "kansei-ask-stats/v1",
    window_days: 30,
    generated_at: new Date().toISOString(),
    total_asks: rows.reduce((s, r) => s + r.asks, 0),
    entries: rows.map((r) => ({
      service: r.service_id,
      error_key: { layer: r.layer, http_status: r.http_status, provider_code: r.provider_code },
      asks: r.asks,
      matched: r.matched,
    })),
  };
}

/** Admin: unmatched service × error_key in the last 30 days, most frequent first — the verification queue. */
export function askCandidates(db: Database.Database) {
  const rows = db.prepare(`SELECT service_id, layer, http_status, provider_code, count(*) AS asks,
      max(asked_at) AS last_asked_at, count(DISTINCT error_sha256) AS distinct_messages,
      coalesce(sum(code_known = 0), 0) AS unknown_code_asks
    FROM ask_log WHERE match_count = 0 AND asked_at >= datetime('now', '-30 days')
    GROUP BY service_id, layer, http_status, provider_code
    ORDER BY asks DESC, last_asked_at DESC LIMIT 100`).all();
  return { window_days: 30, generated_at: new Date().toISOString(), candidates: rows };
}

/** Safe MCP error payload: never echo input. */
export function askOperation<T>(run: () => T): T | { error: string } {
  try { return run(); } catch (e) {
    if (e instanceof z.ZodError) return { error: "invalid_ask_input" };
    if (e instanceof AskError) return { error: e.code };
    throw e;
  }
}
