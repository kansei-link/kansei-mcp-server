/**
 * One-turn "ask a public LLM" for kind_of_truth = llm_answer (M-004a).
 * Mirrors the 2026-07-29 audit (scripts/ai-answer-audit.mjs): plain chat
 * completion, no tools, no system prompt, no search grounding. The question is
 * the only text the model sees. Returns { text, model, citations } and never
 * throws for provider errors — those come back as { error } so the harness can
 * record an instrument_error row.
 *
 * Provider 'fake' (smoke tests only) reads answers from the JSON file named by
 * KANSEI_FAKE_LLM_ANSWERS_FILE: { "<provider-label>": "<answer text>" }.
 */
import { readFileSync } from 'node:fs';

const MAX_TOKENS = 1200;

export const PROVIDER_MODELS = {
  openai: () => process.env.OPENAI_AUDIT_MODEL || 'gpt-5.5',
  gemini: () => process.env.GEMINI_AUDIT_MODEL || 'gemini-flash-latest',
  perplexity: () => process.env.PERPLEXITY_AUDIT_MODEL || 'sonar',
  claude: () => process.env.ANTHROPIC_AUDIT_MODEL || 'claude-opus-4-8',
  fake: () => 'fake-model',
};

async function json(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; } }

export async function askLlm(provider, question, { label = provider } = {}) {
  const model = (PROVIDER_MODELS[provider] || (() => provider))();
  try {
    if (provider === 'fake') {
      const answers = JSON.parse(readFileSync(process.env.KANSEI_FAKE_LLM_ANSWERS_FILE, 'utf8'));
      if (!(label in answers)) return { error: `fake answer missing for ${label}`, model };
      return { text: String(answers[label]), model, citations: [] };
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_completion_tokens: MAX_TOKENS, messages: [{ role: 'user', content: question }] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model };
      return { text: d.choices?.[0]?.message?.content ?? '', model: d.model || model, citations: [] };
    }
    if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: question }] }], generationConfig: { maxOutputTokens: MAX_TOKENS } }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model };
      const cand = d.candidates?.[0];
      return { text: cand?.content?.parts?.map((p) => p.text || '').join('\n') ?? '', model: d.modelVersion || model, citations: (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web?.uri).filter(Boolean) };
    }
    if (provider === 'perplexity') {
      const res = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: question }] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model };
      return { text: d.choices?.[0]?.message?.content ?? '', model: d.model || model, citations: (d.search_results || d.citations || []).map((c) => (typeof c === 'string' ? c : c?.url)).filter(Boolean) };
    }
    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: question }] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model };
      return { text: (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'), model: d.model || model, citations: [] };
    }
    return { error: `unknown provider ${provider}`, model };
  } catch (e) {
    return { error: String(e?.message || e), model };
  }
}
