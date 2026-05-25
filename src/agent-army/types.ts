/**
 * Agent Army — Multi-model service verification system.
 *
 * Tests ~600 untested services using cheap models (Gemini Flash, GPT-4o-mini,
 * Haiku) to populate model_service_stats and move services out of BBB limbo.
 */

export type TestLevel = "L1" | "L2" | "L3";

export type ModelId =
  | "gemini-2.0-flash"
  | "gpt-4o-mini"
  | "claude-haiku-3.5"
  | "claude-sonnet-4";

export interface TestTask {
  service_id: string;
  service_name: string;
  level: TestLevel;
  model: ModelId;
  /** What we're testing */
  task_type: string;
  /** Input data (service detail, recipe, etc.) */
  payload: Record<string, unknown>;
}

export interface TestResult {
  service_id: string;
  model: ModelId;
  level: TestLevel;
  task_type: string;
  success: boolean;
  latency_ms: number;
  error_type?: string;
  context?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
}

export interface ArmySummary {
  total_tasks: number;
  completed: number;
  successes: number;
  failures: number;
  errors: number;
  cost_usd: number;
  by_model: Record<string, { calls: number; successes: number; cost: number }>;
  by_level: Record<string, { calls: number; successes: number }>;
  duration_ms: number;
}

/** Model adapter interface — each provider implements this */
export interface ModelAdapter {
  readonly modelId: ModelId;
  /**
   * Send a prompt and get a structured response.
   * Returns { content, usage } or throws on API error.
   */
  complete(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    content: string;
    input_tokens: number;
    output_tokens: number;
  }>;
}
