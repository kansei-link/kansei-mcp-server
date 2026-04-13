/**
 * Estimate LLM API cost from model name and token counts.
 * Prices are per 1K tokens in USD (April 2026 pricing).
 */

const PRICING_PER_1K: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4":      { input: 0.015,   output: 0.075 },
  "claude-sonnet-4":    { input: 0.003,   output: 0.015 },
  "claude-sonnet-3.5":  { input: 0.003,   output: 0.015 },
  "claude-haiku-3.5":   { input: 0.0008,  output: 0.004 },
  // OpenAI
  "gpt-5":              { input: 0.00125, output: 0.01 },
  "gpt-4o":             { input: 0.0025,  output: 0.01 },
  "gpt-4o-mini":        { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo":        { input: 0.01,    output: 0.03 },
  "o3":                 { input: 0.002,   output: 0.008 },
  "o3-mini":            { input: 0.00011, output: 0.00044 },
  "o4-mini":            { input: 0.00011, output: 0.00044 },
  // Google
  "gemini-2.5-pro":     { input: 0.00125, output: 0.01 },
  "gemini-2.5-flash":   { input: 0.00015, output: 0.0006 },
  "gemini-2.0-flash":   { input: 0.0001,  output: 0.0004 },
  // DeepSeek
  "deepseek-v3":        { input: 0.00014, output: 0.00028 },
  "deepseek-r1":        { input: 0.00055, output: 0.00219 },
  // Meta (via providers)
  "llama-4":            { input: 0.0002,  output: 0.0008 },
  "llama-3.3":          { input: 0.00006, output: 0.00006 },
};

export function estimateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const pricing = PRICING_PER_1K[modelName];
  if (!pricing) return null;
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

/** Get known pricing for a model, or null */
export function getModelPricing(modelName: string): { input: number; output: number } | null {
  return PRICING_PER_1K[modelName] || null;
}

/** List all models with known pricing */
export function getKnownModels(): string[] {
  return Object.keys(PRICING_PER_1K);
}
