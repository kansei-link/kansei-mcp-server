/**
 * Normalize LLM model names to canonical forms.
 * Handles provider prefixes, version suffixes, and common aliases.
 */

const MODEL_ALIASES: Record<string, string> = {
  // Anthropic
  "claude-opus-4": "claude-opus-4",
  "claude-4-opus": "claude-opus-4",
  "opus-4": "claude-opus-4",
  "opus": "claude-opus-4",
  "claude-sonnet-4": "claude-sonnet-4",
  "sonnet-4": "claude-sonnet-4",
  "sonnet": "claude-sonnet-4",
  "claude-haiku-3.5": "claude-haiku-3.5",
  "haiku-3.5": "claude-haiku-3.5",
  "haiku": "claude-haiku-3.5",
  "claude-sonnet-3.5": "claude-sonnet-3.5",
  "sonnet-3.5": "claude-sonnet-3.5",
  // OpenAI
  "gpt-5": "gpt-5",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4-turbo",
  "o3": "o3",
  "o3-mini": "o3-mini",
  "o4-mini": "o4-mini",
  // Google
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
  "gemini-2.0-flash": "gemini-2.0-flash",
  "gemini-pro": "gemini-2.5-pro",
  "gemini-flash": "gemini-2.5-flash",
  // Meta
  "llama-4": "llama-4",
  "llama-3.3": "llama-3.3",
  // DeepSeek
  "deepseek-v3": "deepseek-v3",
  "deepseek-r1": "deepseek-r1",
};

export function normalizeModelName(raw: string): string {
  const lower = raw.toLowerCase().trim();
  // Strip version date suffixes like -20250514
  const stripped = lower.replace(/-\d{8}$/, "");
  // Strip provider prefixes like anthropic/ or openai/
  const noPrefix = stripped.replace(/^(anthropic|openai|google|meta|deepseek)\//, "");
  return MODEL_ALIASES[noPrefix] || noPrefix;
}

/** Infer agent_type from model_name */
export function inferAgentType(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.includes("claude") || lower.includes("opus") || lower.includes("sonnet") || lower.includes("haiku")) return "claude";
  if (lower.includes("gpt") || lower.includes("o3") || lower.includes("o4")) return "gpt";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("copilot")) return "copilot";
  if (lower.includes("llama")) return "llama";
  if (lower.includes("deepseek")) return "deepseek";
  return "other";
}
