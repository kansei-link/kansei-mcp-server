/**
 * ARD（Agentic Resource Discovery）段階 A — エントリのカードを返し、取得を数える。
 *
 * kansei-link.com/.well-known/ard.json の各エントリの `url` がここを指す。静的ファイルには
 * ログが無いので、「エージェントが発見して辿ってきたか」をここで数える。
 *
 * - データは scripts/generate-ard.mjs が書いた src/data/ard-*.json を読むだけ（DB は触らない）。
 *   ファイルが無い・壊れている時も起動は止めない（全 id が 404 になるだけ）。
 * - 取得ごとに一行ログ（時刻・path・UA・Referer・Accept・request id・status）。IP は記録しない。
 * - 数はメモリ内（再起動で消える）。永続化は段階 B。
 * - エラーは RFC 9457（application/problem+json）。型は二つだけ。
 */
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadData(filename: string): unknown {
  // seed.ts と同じ探し方: src/data（dev・Docker）→ dist/data
  const candidates = [
    path.join(__dirname, "..", "src", "data", filename),
    path.join(__dirname, "data", filename),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as unknown;
    } catch (err) {
      console.error(`[ard] ${filename} を読めない（この機能だけ止める）:`, (err as Error).message);
      return null;
    }
  }
  console.error(`[ard] ${filename} が無い（この機能だけ止める）`);
  return null;
}

type UaClass = "ai_crawler" | "mcp_client" | "browser" | "unknown";
const UA_CLASSES: UaClass[] = ["ai_crawler", "mcp_client", "browser", "unknown"];

const SERVICE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidField(filename: string, field: string): void {
  console.error(`[ard] ${filename} の ${field} の形が違う（空として扱う）`);
}

function objectData(filename: string): Record<string, unknown> {
  const value = loadData(filename);
  if (isObject(value)) return value;
  invalidField(filename, "$root");
  return {};
}

function normalizedRegex(value: unknown, field: string, flags: string): RegExp | null {
  if (value === undefined) return null;
  if (!isObject(value) || typeof value.regex !== "string") {
    invalidField("ai-user-agents.json", `${field}.regex`);
    return null;
  }
  const src = value.regex;
  if (!src) return null;
  try {
    return new RegExp(src, flags);
  } catch {
    invalidField("ai-user-agents.json", `${field}.regex`);
    return null;
  }
}

let cards: Record<string, unknown> = {};
let openapiDoc: Record<string, unknown> | null = null;
let aiTokens: { token: string; lower: string }[] = [];
let mcpTokens: string[] = [];
let otherBotRe: RegExp | null = null;
let browserRe: RegExp | null = null;

export function classifyUserAgent(ua: string): { uaClass: UaClass; crawler: string | null } {
  const lower = ua.toLowerCase();
  for (const { token, lower: tokenLower } of aiTokens) {
    if (lower.includes(tokenLower)) return { uaClass: "ai_crawler", crawler: token };
  }
  if (mcpTokens.some((t) => lower.includes(t))) return { uaClass: "mcp_client", crawler: null };
  if (otherBotRe?.test(ua)) return { uaClass: "unknown", crawler: null };
  if (browserRe?.test(ua)) return { uaClass: "browser", crawler: null };
  return { uaClass: "unknown", crawler: null };
}

// ─── request id ────────────────────────────────────────────────────
// Railway の edge が付ける x-railway-request-id があればそのまま採用する。ヘッダは呼ぶ側も
// 付けられるので、ログと応答に写す前に形を確かめる（合わなければ自前の uuid）。
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdOf(res: Response): string {
  return (res.locals.requestId as string | undefined) ?? "unknown";
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const fromEdge = req.header("x-railway-request-id");
  const id = fromEdge && REQUEST_ID_RE.test(fromEdge) ? fromEdge : randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

// ─── 数（メモリ内） ────────────────────────────────────────────────
interface Counter {
  count: number;
  last_fetched_at: string | null;
  by_ua_class: Record<UaClass, number>;
}
const newCounter = (): Counter => ({
  count: 0,
  last_fetched_at: null,
  by_ua_class: { ai_crawler: 0, mcp_client: 0, browser: 0, unknown: 0 },
});

const startedAt = new Date().toISOString();
const entryCounters = new Map<string, Counter>();
const openapiCounter = newCounter();
const statsCounter = newCounter();
const errorCounts = { not_found: 0, bad_request: 0 };
const crawlerCounts = new Map<string, number>();

// 形の検査に加え、読み込み・正規化・カウンタの準備全体も守る。
// 全部が揃うまでデータを公開しないので、想定外の例外でも空のまま応答できる。
try {
  const entriesFile = objectData("ard-entries.json");
  const normalizedCards: Record<string, unknown> = {};
  if (!isObject(entriesFile.entries)) {
    invalidField("ard-entries.json", "entries");
  } else {
    for (const [id, card] of Object.entries(entriesFile.entries)) {
      if (!SERVICE_ID_RE.test(id) || !isObject(card)) {
        invalidField("ard-entries.json", `entries[${JSON.stringify(id)}]`);
        continue;
      }
      normalizedCards[id] = card;
    }
  }

  const rawOpenapi = loadData("ard-openapi.json");
  const normalizedOpenapi = isObject(rawOpenapi) ? rawOpenapi : null;
  if (!normalizedOpenapi) invalidField("ard-openapi.json", "$root");

  const uaData = objectData("ai-user-agents.json");
  const normalizedAi: { token: string; lower: string }[] = [];
  if (!Array.isArray(uaData.ai_crawlers)) {
    invalidField("ai-user-agents.json", "ai_crawlers");
  } else {
    uaData.ai_crawlers.forEach((crawler: unknown, index: number) => {
      if (!isObject(crawler) || typeof crawler.token !== "string" || !crawler.token.trim()) {
        invalidField("ai-user-agents.json", `ai_crawlers[${index}].token`);
        return;
      }
      normalizedAi.push({ token: crawler.token, lower: crawler.token.toLowerCase() });
    });
  }

  const normalizedMcp: string[] = [];
  const patterns = uaData.mcp_client_patterns;
  if (!isObject(patterns) || !Array.isArray(patterns.tokens)) {
    invalidField("ai-user-agents.json", "mcp_client_patterns.tokens");
  } else {
    patterns.tokens.forEach((token: unknown, index: number) => {
      if (typeof token !== "string") {
        invalidField("ai-user-agents.json", `mcp_client_patterns.tokens[${index}]`);
        return;
      }
      normalizedMcp.push(token.toLowerCase());
    });
  }
  const normalizedOtherBot = normalizedRegex(uaData.other_bot_pattern, "other_bot_pattern", "i");
  const normalizedBrowser = normalizedRegex(uaData.browser_pattern, "browser_pattern", "");

  for (const id of Object.keys(normalizedCards)) entryCounters.set(id, newCounter());
  cards = normalizedCards;
  openapiDoc = normalizedOpenapi;
  aiTokens = normalizedAi;
  mcpTokens = normalizedMcp;
  otherBotRe = normalizedOtherBot;
  browserRe = normalizedBrowser;
} catch (err) {
  entryCounters.clear();
  console.error("[ard] データの初期化を完了できない（空として扱う）:", err instanceof Error ? err.message : "unknown error");
}

function bump(counter: Counter, uaClass: UaClass, now: string): void {
  counter.count++;
  counter.last_fetched_at = now;
  counter.by_ua_class[uaClass]++;
}

// ─── 一行ログ ──────────────────────────────────────────────────────
const clip = (s: string | undefined, max: number): string | null => (s ? s.slice(0, max) : null);

/** Referer は origin と path だけ残す（query に利用者の入力が入ることがあるため）。 */
function refererWithoutQuery(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return clip(`${u.origin}${u.pathname}`, 300);
  } catch {
    return null;
  }
}

function logAccess(req: Request, res: Response, status: number, uaClass: UaClass, now: string): void {
  console.log(
    "[ard] " +
      JSON.stringify({
        ts: now,
        path: clip(req.path, 200),
        status,
        ua: clip(req.header("user-agent"), 300),
        ua_class: uaClass,
        referer: refererWithoutQuery(req.header("referer")),
        accept: clip(req.header("accept"), 200),
        request_id: requestIdOf(res),
      })
  );
}

// ─── 応答 ──────────────────────────────────────────────────────────
function commonHeaders(res: Response): void {
  // 公開の読み取り専用データ。ブラウザ内のエージェントからも読めるようにする
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
  // 取得のたびに数えたいので、途中で溜めさせない
  res.setHeader("Cache-Control", "no-cache");
}

const PROBLEMS = {
  "ard-entry-not-found": { status: 404, title: "ARD entry not found" },
  "bad-request": { status: 400, title: "Bad request" },
} as const;
type ProblemSlug = keyof typeof PROBLEMS;

function sendProblem(res: Response, slug: ProblemSlug, detail: string): number {
  const p = PROBLEMS[slug];
  commonHeaders(res);
  res
    .status(p.status)
    .type("application/problem+json")
    .send(
      JSON.stringify({
        type: `https://kansei-link.com/problems/${slug}`,
        title: p.title,
        status: p.status,
        detail,
        instance: `urn:kansei:request:${requestIdOf(res)}`,
      })
    );
  return p.status;
}

/** GET /ard/entries/<service_id>.json */
export function handleArdEntry(req: Request, res: Response): void {
  const now = new Date().toISOString();
  const { uaClass, crawler } = classifyUserAgent(req.header("user-agent") ?? "");
  const file = String(req.params.file ?? "");
  const id = file.endsWith(".json") ? file.slice(0, -".json".length) : null;

  let status: number;
  if (id === null || !SERVICE_ID_RE.test(id)) {
    errorCounts.bad_request++;
    status = sendProblem(
      res,
      "bad-request",
      "The path must be /ard/entries/<service_id>.json, where service_id matches ^[a-z0-9][a-z0-9-]{0,63}$."
    );
  } else if (!Object.prototype.hasOwnProperty.call(cards, id)) {
    errorCounts.not_found++;
    status = sendProblem(
      res,
      "ard-entry-not-found",
      `No ARD entry with service_id '${id}'. The list of entries is https://kansei-link.com/.well-known/ard.json.`
    );
  } else {
    bump(entryCounters.get(id)!, uaClass, now);
    if (crawler) crawlerCounts.set(crawler, (crawlerCounts.get(crawler) ?? 0) + 1);
    commonHeaders(res);
    res.json(cards[id]);
    status = 200;
  }
  logAccess(req, res, status, uaClass, now);
}

/** GET /ard/openapi.json */
export function handleArdOpenapi(req: Request, res: Response): void {
  const now = new Date().toISOString();
  const { uaClass, crawler } = classifyUserAgent(req.header("user-agent") ?? "");
  let status: number;
  if (!openapiDoc) {
    errorCounts.not_found++;
    status = sendProblem(res, "ard-entry-not-found", "The OpenAPI document is not available in this build.");
  } else {
    bump(openapiCounter, uaClass, now);
    if (crawler) crawlerCounts.set(crawler, (crawlerCounts.get(crawler) ?? 0) + 1);
    commonHeaders(res);
    res.json(openapiDoc);
    status = 200;
  }
  logAccess(req, res, status, uaClass, now);
}

/** GET /ard/stats.json — 起動からの数。stats 自身の取得は entries の数に入れない。 */
export function handleArdStats(req: Request, res: Response): void {
  const now = new Date().toISOString();
  const { uaClass } = classifyUserAgent(req.header("user-agent") ?? "");
  bump(statsCounter, uaClass, now);

  const byClass = Object.fromEntries(UA_CLASSES.map((c) => [c, 0])) as Record<UaClass, number>;
  let entryTotal = 0;
  for (const c of entryCounters.values()) {
    entryTotal += c.count;
    for (const k of UA_CLASSES) byClass[k] += c.by_ua_class[k];
  }
  commonHeaders(res);
  res.json({
    since: startedAt,
    generated_at: now,
    note: "In-memory counts since the last restart of this server. Not persisted.",
    totals: {
      entries: entryTotal,
      entries_by_ua_class: byClass,
      openapi: openapiCounter.count,
      stats: statsCounter.count,
      not_found: errorCounts.not_found,
      bad_request: errorCounts.bad_request,
    },
    ai_crawlers: Object.fromEntries([...crawlerCounts.entries()].sort()),
    entries: Object.fromEntries([...entryCounters.entries()].sort(([a], [b]) => a.localeCompare(b))),
    openapi: openapiCounter,
  });
  logAccess(req, res, 200, uaClass, now);
}
