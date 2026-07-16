// Claude Code transcript (JSONL) parser for the usage hook.
//
// Extracts, from one session transcript:
//   1. DENOMINATOR (measured): total token usage across all assistant API
//      turns — fresh input, output, cache creation, cache reads — deduped
//      by message id so streaming re-writes don't double count.
//   2. KanseiLink activity (measured): tool_use calls whose name matches
//      mcp__kansei-link__* (or mcp__plugin_kansei-link_*), the service ids
//      they asked about, and the actual size of the tool_result payloads.
//
// Nothing here estimates anything. Estimation (the "what would this have
// cost without KanseiLink" baseline) happens in baselines.ts and is kept
// separate so measured vs estimated never blur.

import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";

/** Mixed JP/EN text averages ~3 chars/token — same constant the analyze tool uses. */
export const CHARS_PER_TOKEN = 3;

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface ToolErrorStats {
  fails: number;
  /** measured size of the error outputs this tool produced */
  error_tokens: number;
}

export interface SessionRecord {
  session_id: string;
  recorded_at: string;
  started_at: string | null;
  ended_at: string | null;
  /** per-model measured usage, summed over deduped assistant turns */
  models: Record<string, ModelUsage>;
  /** input + output + cache_creation (fresh work the API actually did) */
  fresh_tokens: number;
  /** fresh_tokens + cache_read_tokens (everything that crossed the wire) */
  total_tokens: number;
  kansei: {
    calls: number;
    /** calls per KanseiLink tool name (lookup, search_services, ...) */
    tools: Record<string, number>;
    /** distinct service ids the agent asked KanseiLink about */
    services: Record<string, number>;
    /** measured size of KanseiLink tool responses, converted at 3 chars/token */
    response_tokens: number;
  };
  /**
   * Error-loop detection: where the agent got STUCK.
   *
   * A "retry chain" is >=2 consecutive failures of the same tool with no
   * success of that tool in between. `stuck_tokens` = measured error-output
   * tokens of the chain + assistant output produced while the chain was
   * open. The token counts are measured; ATTRIBUTING them to "being stuck"
   * is a heuristic — surfaces must label this "attributed", not raw
   * "measured".
   */
  errors: {
    failed_calls: number;
    /** measured size of ALL error outputs (they sit in context afterwards) */
    error_result_tokens: number;
    retry_chains: number;
    longest_chain: number;
    stuck_tokens: number;
    /** worst offenders: tool name → fail count + error output size */
    by_tool: Record<string, ToolErrorStats>;
  };
}

const KANSEI_TOOL_RE = /^mcp__(?:plugin_)?kansei[-_]link(?:_kansei[-_]link)?__(.+)$/;

function isKanseiTool(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const m = name.match(KANSEI_TOOL_RE);
  return m ? m[1] : null;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object" && typeof (b as any).text === "string") {
          return (b as any).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export async function parseTranscript(
  transcriptPath: string,
  sessionId: string
): Promise<SessionRecord> {
  const record: SessionRecord = {
    session_id: sessionId,
    recorded_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    models: {},
    fresh_tokens: 0,
    total_tokens: 0,
    kansei: { calls: 0, tools: {}, services: {}, response_tokens: 0 },
    errors: {
      failed_calls: 0,
      error_result_tokens: 0,
      retry_chains: 0,
      longest_chain: 0,
      stuck_tokens: 0,
      by_tool: {},
    },
  };

  // Dedupe assistant usage: streaming writes the same message across several
  // lines with identical message.id — count each (requestId, message.id) once.
  const seenUsage = new Set<string>();
  // tool_use_id → true for KanseiLink calls, so we can attribute the
  // matching tool_result lines.
  const kanseiToolUseIds = new Set<string>();
  // tool_use_id → tool name, for ALL tools (error attribution).
  const toolNameById = new Map<string, string>();

  // Retry-chain state: open while the same tool keeps failing.
  let chain: {
    tool: string;
    fails: number;
    errTokens: number;
    assistantOut: number;
  } | null = null;

  const closeChain = (): void => {
    if (chain && chain.fails >= 2) {
      record.errors.retry_chains += 1;
      record.errors.longest_chain = Math.max(record.errors.longest_chain, chain.fails);
      record.errors.stuck_tokens += chain.errTokens + chain.assistantOut;
    }
    chain = null;
  };

  const rl = createInterface({
    input: createReadStream(transcriptPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // partial/corrupt line — skip, never fail
    }

    const ts = typeof entry.timestamp === "string" ? entry.timestamp : null;
    if (ts) {
      if (!record.started_at || ts < record.started_at) record.started_at = ts;
      if (!record.ended_at || ts > record.ended_at) record.ended_at = ts;
    }

    const msg = entry.message;
    if (!msg || typeof msg !== "object") continue;

    // ── assistant turns: usage + tool_use blocks ──
    if (entry.type === "assistant") {
      const usage = msg.usage;
      if (usage && typeof usage === "object") {
        const key = `${entry.requestId ?? ""}:${msg.id ?? ""}`;
        if (!seenUsage.has(key)) {
          seenUsage.add(key);
          const model = typeof msg.model === "string" ? msg.model : "unknown";
          const m = (record.models[model] ??= {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
          });
          m.input_tokens += Number(usage.input_tokens) || 0;
          m.output_tokens += Number(usage.output_tokens) || 0;
          m.cache_creation_tokens += Number(usage.cache_creation_input_tokens) || 0;
          m.cache_read_tokens += Number(usage.cache_read_input_tokens) || 0;
          // While a retry chain is open, the model's own output (reading the
          // error, planning the retry) is part of the stuck cost.
          if (chain) chain.assistantOut += Number(usage.output_tokens) || 0;
        }
      }

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || block.type !== "tool_use") continue;
          if (typeof block.id === "string" && typeof block.name === "string") {
            toolNameById.set(block.id, block.name);
          }
          const tool = isKanseiTool(block.name);
          if (!tool) continue;
          record.kansei.calls += 1;
          record.kansei.tools[tool] = (record.kansei.tools[tool] ?? 0) + 1;
          if (typeof block.id === "string") kanseiToolUseIds.add(block.id);
          const input = block.input;
          if (input && typeof input === "object") {
            for (const k of ["service_id", "service"]) {
              const v = (input as any)[k];
              if (typeof v === "string" && v.length > 0 && v.length < 64) {
                record.kansei.services[v] = (record.kansei.services[v] ?? 0) + 1;
                break;
              }
            }
          }
        }
      }
    }

    // ── user turns: tool_result blocks ──
    if (entry.type === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || block.type !== "tool_result") continue;
        if (typeof block.tool_use_id !== "string") continue;

        if (kanseiToolUseIds.has(block.tool_use_id)) {
          const text = contentToText(block.content);
          record.kansei.response_tokens += Math.round(text.length / CHARS_PER_TOKEN);
        }

        // Error-loop tracking (all tools).
        const toolName = toolNameById.get(block.tool_use_id) ?? "unknown";
        if (block.is_error === true) {
          const errTokens = Math.round(contentToText(block.content).length / CHARS_PER_TOKEN);
          record.errors.failed_calls += 1;
          record.errors.error_result_tokens += errTokens;
          const t = (record.errors.by_tool[toolName] ??= { fails: 0, error_tokens: 0 });
          t.fails += 1;
          t.error_tokens += errTokens;

          if (chain && chain.tool === toolName) {
            chain.fails += 1;
            chain.errTokens += errTokens;
          } else {
            closeChain();
            chain = { tool: toolName, fails: 1, errTokens, assistantOut: 0 };
          }
        } else if (chain && chain.tool === toolName) {
          // The failing tool finally succeeded — the chain is resolved.
          closeChain();
        }
      }
    }
  }
  closeChain();

  for (const m of Object.values(record.models)) {
    record.fresh_tokens += m.input_tokens + m.output_tokens + m.cache_creation_tokens;
    record.total_tokens +=
      m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens;
  }

  return record;
}
