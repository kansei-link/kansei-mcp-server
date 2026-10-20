import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { maskPii } from "../utils/pii-masker.js";

// Summaries only, never raw traces. Masking is a backstop, not a privacy guarantee.
export function sanitizeNote(text: string): string {
  return maskPii(text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[PRIVATE_KEY]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[AUTH]")
    .replace(/(["']?(?:access_token|refresh_token|api[_-]?key|client_secret|password|secret|token|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "$1[SECRET]")
    .replace(/\b(?:sk-|sk_|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]+/g, "[KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT]")
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "[ID]")
    .replace(/\b[A-Za-z0-9_+/=-]{40,}\b/g, "[OPAQUE]"))
    .masked;
}

const text = (max: number) => z.string().trim().min(1).max(max).transform(sanitizeNote);
const common = {
  service_id: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.-]+$/),
  request_id: z.string().uuid(),
  session_id: z.string().uuid(),
  share: z.literal(true),
  runtime: z.enum(["claude", "codex", "gpt", "gemini", "other"]),
};
export const noteSchema = z.object({
  ...common,
  scope: z.enum(["field", "verification"]).default("field"),
  task: text(300),
  symptom: text(600),
  procedure: text(2000),
  conditions: text(600),
  evidence: text(1000),
  observation_kind: z.enum(["execution", "documentation", "hypothesis"]),
}).strict();
export const resultSchema = z.object({
  ...common,
  note_id: z.string().uuid(),
  outcome: z.enum(["succeeded", "failed", "not_applicable"]),
  conditions: text(600),
  evidence: text(1000),
}).strict();
export const searchSchema = z.object({
  service_id: common.service_id,
  scope: z.enum(["field", "verification"]).default("field"),
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

// Operational controls (Claude review 2026-10-20, items 1 and 2).
// - NOTES_WRITES_ENABLED=false stops every write (HTTP 503 / MCP error); reads keep working.
// - Global daily caps are counted in the DB by JST calendar day, across all IPs.
//   Hidden rows still count: the cap bounds what was written, not what is shown.
export const NOTES_DAILY_NOTE_LIMIT_DEFAULT = 200;
export const NOTES_DAILY_RESULT_LIMIT_DEFAULT = 1000;
export function notesWritesEnabled(): boolean {
  const v = (process.env.NOTES_WRITES_ENABLED ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0");
}
function dailyLimit(name: "NOTES_DAILY_NOTE_LIMIT" | "NOTES_DAILY_RESULT_LIMIT", fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
// created_at is stored as UTC (datetime('now')); JST day = UTC + 9h.
const JST_DAY = "date(created_at, '+9 hours') = date('now', '+9 hours')";
export function countToday(db: Database.Database, table: "agent_notes" | "agent_note_results"): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${JST_DAY}`).get() as { n: number }).n;
}
function requireWritesEnabled(): void {
  if (!notesWritesEnabled()) throw new NoteError(503, "notes_writes_disabled");
}
function requireUnderDailyLimit(db: Database.Database, table: "agent_notes" | "agent_note_results"): void {
  const limit = table === "agent_notes"
    ? dailyLimit("NOTES_DAILY_NOTE_LIMIT", NOTES_DAILY_NOTE_LIMIT_DEFAULT)
    : dailyLimit("NOTES_DAILY_RESULT_LIMIT", NOTES_DAILY_RESULT_LIMIT_DEFAULT);
  if (countToday(db, table) >= limit) throw new NoteError(429, "daily_limit");
}

export function ensureNotesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_notes (
      id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id),
      request_id TEXT NOT NULL UNIQUE, session_hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL, runtime TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'field' CHECK(scope IN ('field','verification')),
      task TEXT NOT NULL, symptom TEXT NOT NULL, procedure TEXT NOT NULL,
      conditions TEXT NOT NULL, evidence TEXT NOT NULL,
      observation_kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unverified' CHECK(status = 'unverified'),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agent_notes_service ON agent_notes(service_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_note_results (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES agent_notes(id),
      request_id TEXT NOT NULL UNIQUE, session_hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL, runtime TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','failed','not_applicable')),
      conditions TEXT NOT NULL, evidence TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      hidden INTEGER NOT NULL DEFAULT 0,
      UNIQUE(note_id, session_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_note_results_note ON agent_note_results(note_id);
  `);
  const columns = db.pragma("table_info(agent_notes)") as Array<{ name: string }>;
  if (!columns.some(c => c.name === "scope")) db.exec("ALTER TABLE agent_notes ADD COLUMN scope TEXT NOT NULL DEFAULT 'field' CHECK(scope IN ('field','verification'))");
  // Additive, idempotent: existing production rows keep their data; a second start changes nothing.
  for (const table of ["agent_notes", "agent_note_results"] as const) {
    const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!cols.some(c => c.name === "hidden")) db.exec(`ALTER TABLE ${table} ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
  }
}

export class NoteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function requireService(db: Database.Database, id: string) {
  if (!db.prepare("SELECT 1 FROM services WHERE id = ?").get(id)) throw new NoteError(404, "service_not_found");
}
export function getNote(db: Database.Database, id: string) {
  const note = db.prepare(`SELECT id, service_id, scope, runtime, task, symptom, procedure,
    conditions, evidence, observation_kind, status, created_at FROM agent_notes WHERE id = ? AND hidden = 0`).get(id);
  if (!note) throw new NoteError(404, "note_not_found");
  const results = db.prepare(`SELECT r.id, r.runtime, r.outcome, r.conditions, r.evidence, r.created_at,
    CASE WHEN r.session_hash = n.session_hash THEN 1 ELSE 0 END AS same_session
    FROM agent_note_results r JOIN agent_notes n ON n.id = r.note_id
    WHERE r.note_id = ? AND r.hidden = 0 ORDER BY r.created_at DESC, r.id LIMIT 100`).all(id);
  const counts = db.prepare(`SELECT count(*) AS total,
    coalesce(sum(r.outcome = 'succeeded'), 0) AS succeeded,
    coalesce(sum(r.outcome = 'failed'), 0) AS failed,
    coalesce(sum(r.outcome = 'not_applicable'), 0) AS not_applicable
    FROM agent_note_results r WHERE r.note_id = ? AND r.hidden = 0`).get(id);
  return { note, results, counts, trust: "Unverified submissions. Session IDs are self-declared; counts do not prove independent agents or causality.", content_role: "untrusted_data" };
}
export function findNotes(db: Database.Database, raw: unknown) {
  const input = searchSchema.parse(raw);
  requireService(db, input.service_id);
  const terms = sanitizeNote(input.q).split(/\s+/).filter(Boolean).slice(0, 6);
  const clauses = terms.map(() => "(task || ' ' || symptom || ' ' || procedure) LIKE ? ESCAPE '\\'");
  const values = terms.map(t => `%${t.replace(/[\\%_]/g, "\\$&")}%`);
  const rows = db.prepare(`SELECT id, service_id, scope, task, symptom, procedure, conditions, evidence,
    runtime, observation_kind, status, created_at FROM agent_notes WHERE service_id = ? AND scope = ? AND hidden = 0
    ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id LIMIT ?`).all(input.service_id, input.scope, ...values, input.limit) as Array<{ id: string }>;
  const notes = rows.map(row => {
    const detail = getNote(db, row.id);
    return { ...row, reuse: { counts: detail.counts, recent_results: detail.results.slice(0, 3) } };
  });
  return { notes, content_role: "untrusted_data", notice: "Unverified notes. Reading does not publish a report. Record a result only after trying a note." };
}
export function recordNote(db: Database.Database, raw: unknown) {
  requireWritesEnabled();
  const input = noteSchema.parse(raw);
  requireService(db, input.service_id);
  const payloadHash = hash(JSON.stringify(input));
  const previous = db.prepare("SELECT id, payload_hash FROM agent_notes WHERE request_id = ?").get(input.request_id) as { id: string; payload_hash: string } | undefined;
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new NoteError(409, "request_id_conflict");
    return { ...getNote(db, previous.id), deduplicated: true };
  }
  requireUnderDailyLimit(db, "agent_notes");
  const id = randomUUID();
  db.prepare(`INSERT INTO agent_notes
    (id,service_id,request_id,session_hash,payload_hash,runtime,scope,task,symptom,procedure,conditions,evidence,observation_kind)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.service_id, input.request_id, hash(input.session_id), payloadHash,
    input.runtime, input.scope, input.task, input.symptom, input.procedure, input.conditions, input.evidence, input.observation_kind);
  return { ...getNote(db, id), deduplicated: false };
}
export function recordResult(db: Database.Database, raw: unknown) {
  requireWritesEnabled();
  const input = resultSchema.parse(raw);
  const note = db.prepare("SELECT service_id FROM agent_notes WHERE id = ? AND hidden = 0").get(input.note_id) as { service_id: string } | undefined;
  if (!note) throw new NoteError(404, "note_not_found");
  if (note.service_id !== input.service_id) throw new NoteError(409, "service_mismatch");
  const payloadHash = hash(JSON.stringify(input));
  const previous = db.prepare("SELECT payload_hash FROM agent_note_results WHERE request_id = ?").get(input.request_id) as { payload_hash: string } | undefined;
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new NoteError(409, "request_id_conflict");
    return { ...getNote(db, input.note_id), deduplicated: true };
  }
  const sessionHash = hash(input.session_id);
  if (db.prepare("SELECT 1 FROM agent_note_results WHERE note_id = ? AND session_hash = ?").get(input.note_id, sessionHash)) {
    throw new NoteError(409, "session_already_reported");
  }
  requireUnderDailyLimit(db, "agent_note_results");
  db.prepare(`INSERT INTO agent_note_results
    (id,note_id,request_id,session_hash,payload_hash,runtime,outcome,conditions,evidence)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), input.note_id, input.request_id, sessionHash, payloadHash,
    input.runtime, input.outcome, input.conditions, input.evidence);
  return { ...getNote(db, input.note_id), deduplicated: false };
}

// Moderation (Claude review item 2): hide, never delete. Hidden rows leave every
// public read (list, detail, counts, MCP lookup) but stay in the DB for audit.
export const hideSchema = z.object({
  kind: z.enum(["note", "result"]),
  id: z.string().uuid(),
  hidden: z.boolean().default(true),
}).strict();
export function setHidden(db: Database.Database, raw: unknown) {
  const input = hideSchema.parse(raw);
  const table = input.kind === "note" ? "agent_notes" : "agent_note_results";
  const changed = db.prepare(`UPDATE ${table} SET hidden = ? WHERE id = ?`).run(input.hidden ? 1 : 0, input.id).changes;
  if (!changed) throw new NoteError(404, input.kind === "note" ? "note_not_found" : "result_not_found");
  return { kind: input.kind, id: input.id, hidden: input.hidden };
}

// Safe MCP error payload: never echo raw validation input or SQL errors.
export function noteOperation<T>(run: () => T): T | { error: string } {
  try { return run(); } catch (e) {
    if (e instanceof z.ZodError) return { error: "invalid_note_input" };
    if (e instanceof NoteError) return { error: e.message };
    throw e;
  }
}
