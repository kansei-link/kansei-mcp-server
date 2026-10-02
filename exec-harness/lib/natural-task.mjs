/**
 * Callers for kind_of_truth = natural_task (M-006): one natural-language task per run, the provider's
 * own search / fetch tools enabled, and the RAW responses returned for lib/natural-task-rules.mjs to
 * check and read. Loaded only by the naturalTask target (dynamic import), so no other marker depends on it.
 *
 * Configurations (2026-10-02, after Codex review of 79e624d: two, not four):
 *   openai     Responses API, tools:[web_search], tool_choice required, user_location JP fixed,
 *              include web_search_call.action.sources; a dated reasoning model (gpt-5.5-2026-04-23).
 *              raw = the response body exactly as received (its status / error are checked by the rules).
 *   anthropic  Messages API, server tools web_search_20250305 + web_fetch_20250910 (the base versions:
 *              the dynamic-filtering versions hide part of the candidates inside code execution).
 *              pause_turn is re-sent up to MAX_CONTINUATIONS times. raw = { turns: [every response body
 *              exactly as received] } — nothing is concatenated, dropped or coerced here; the rules check
 *              every turn before any of them is read (Codex 79e624d N2).
 *   fake       smoke tests only: KANSEI_FAKE_NATURAL_FILE = { "<observer label>": { raw, error?, error_class?, model? } }
 * Not configurations: Perplexity (its Agent API citation field is unconfirmed on a real response) and
 * Claude Code (its isolation has not been verified on a real start) — taskpack not_measured; their callers
 * were removed (git history keeps them). Gemini with Google Search grounding: its terms forbid collecting or
 * analysing the grounding links programmatically.
 * Provider errors never throw: they come back as { error, error_class? } so the harness records an
 * instrument row (error_class: provider_api (default) | timeout | budget | other).
 * The model a provider reports is returned as it came; marker-generic decides whether it may be public.
 */
import { readFileSync } from 'node:fs';

export const CONFIG_DEFAULTS = Object.freeze({
  openai: Object.freeze({ model: 'gpt-5.5-2026-04-23', tools: Object.freeze(['web_search']), max_output_tokens: 4000, user_location: Object.freeze({ type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' }), fetch_meaning: 'model_opened_page' }),
  anthropic: Object.freeze({ model: 'claude-opus-5-5', tools: Object.freeze(['web_search_20250305', 'web_fetch_20250910']), max_tokens: 4000, max_uses: 5, fetch_meaning: 'provider_server_fetched' }),
});
export const MAX_CONTINUATIONS = 3;

async function json(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; } }

/** { raw, model, error, files } — raw is what the rules module checks and reads. */
export async function runNaturalTask(config, prompt, { label, cfg = {} } = {}) {
  const provider = config.provider;
  const opt = { ...(CONFIG_DEFAULTS[provider] || {}), ...cfg };
  try {
    if (provider === 'fake') {
      const table = JSON.parse(readFileSync(process.env.KANSEI_FAKE_NATURAL_FILE, 'utf8'));
      const f = table[label];
      if (!f) return { error: `fake response missing for ${label}`, model: 'fake-model' };
      if (f.error) return { error: String(f.error), error_class: f.error_class, model: 'fake-model' };
      return { raw: f.raw, model: f.model || 'fake-model', files: [] };
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: opt.model, input: prompt, max_output_tokens: opt.max_output_tokens, tools: [{ type: 'web_search', user_location: opt.user_location }], tool_choice: 'required', include: ['web_search_call.action.sources'] }) });
      const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model: opt.model };
      return { raw: d, model: typeof d?.model === 'string' ? d.model : null, files: [], usage: d?.usage || null };
    }
    if (provider === 'anthropic') {
      const tools = [{ type: opt.tools[0], name: 'web_search', max_uses: opt.max_uses }, { type: opt.tools[1], name: 'web_fetch', max_uses: opt.max_uses }];
      const messages = [{ role: 'user', content: prompt }];
      const turns = []; let model = null; let usage = null;
      for (;;) {
        const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: opt.model, max_tokens: opt.max_tokens, tools, messages }) });
        const d = await json(res); if (!res.ok) return { error: d.error?.message || `HTTP ${res.status}`, model };
        turns.push(d); // as received
        if (typeof d?.model === 'string') model = d.model;
        usage = d?.usage || usage;
        // continue only a well-formed paused turn; anything else ends here and the rules decide
        if (d?.stop_reason === 'pause_turn' && Array.isArray(d.content) && turns.length <= MAX_CONTINUATIONS) { messages.push({ role: 'assistant', content: d.content }); continue; }
        return { raw: { turns }, model, files: [], usage };
      }
    }
    return { error: `unknown provider ${provider}`, model: 'none' };
  } catch (e) { return { error: String(e?.message || e), model: (CONFIG_DEFAULTS[provider] || {}).model || provider }; }
}
