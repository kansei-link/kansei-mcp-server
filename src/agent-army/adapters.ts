/**
 * Model adapters — unified interface for Claude, OpenAI, Google APIs.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — for Claude Haiku/Sonnet
 *   OPENAI_API_KEY     — for GPT-4o-mini
 *   GOOGLE_AI_API_KEY  — for Gemini Flash
 */
import type { ModelAdapter, ModelId } from "./types.js";

// ---------------------------------------------------------------------------
// Anthropic (Claude)
// ---------------------------------------------------------------------------
export class AnthropicAdapter implements ModelAdapter {
  readonly modelId: ModelId;
  private apiKey: string;

  constructor(modelId: "claude-haiku-3.5" | "claude-sonnet-4") {
    this.modelId = modelId;
    this.apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  }

  async complete(systemPrompt: string, userPrompt: string) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelId === "claude-haiku-3.5"
          ? "claude-haiku-4-5-20251001"
          : "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    return {
      content: data.content[0]?.text ?? "",
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI (GPT)
// ---------------------------------------------------------------------------
export class OpenAIAdapter implements ModelAdapter {
  readonly modelId: ModelId = "gpt-4o-mini";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set");
  }

  async complete(systemPrompt: string, userPrompt: string) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      content: data.choices[0]?.message?.content ?? "",
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
    };
  }
}

// ---------------------------------------------------------------------------
// Google (Gemini)
// ---------------------------------------------------------------------------
export class GeminiAdapter implements ModelAdapter {
  readonly modelId: ModelId = "gemini-2.0-flash";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_AI_API_KEY ?? "";
    if (!this.apiKey) throw new Error("GOOGLE_AI_API_KEY not set");
  }

  async complete(systemPrompt: string, userPrompt: string) {
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createAdapter(modelId: ModelId): ModelAdapter {
  switch (modelId) {
    case "gemini-2.0-flash":
      return new GeminiAdapter();
    case "gpt-4o-mini":
      return new OpenAIAdapter();
    case "claude-haiku-3.5":
      return new AnthropicAdapter("claude-haiku-3.5");
    case "claude-sonnet-4":
      return new AnthropicAdapter("claude-sonnet-4");
  }
}
