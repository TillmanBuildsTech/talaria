// Curated "realistic" model catalog — the mainstream, established models the
// active Hermes providers (openrouter + opencode-zen) can actually run, as
// sourced from Hermes' own model registry. Blended into the dropdown alongside
// each profile's configured default (which comes from /talaria-config).
//
// provider is the Hermes provider name sent with the override so the gateway
// honors the switch. contextLength feeds the context-warning bar; null/absent
// falls back to DEFAULT_CONTEXT_WINDOW in the store.

export const KNOWN_MODELS = [
  // Anthropic (via OpenRouter) — 200k context
  { model: 'anthropic/claude-opus-5', provider: 'openrouter', contextLength: 200000 },
  { model: 'anthropic/claude-opus-4-6', provider: 'openrouter', contextLength: 200000 },
  { model: 'anthropic/claude-sonnet-5', provider: 'openrouter', contextLength: 200000 },
  { model: 'anthropic/claude-sonnet-4-6', provider: 'openrouter', contextLength: 200000 },
  { model: 'anthropic/claude-sonnet-4-5', provider: 'openrouter', contextLength: 200000 },
  { model: 'anthropic/claude-haiku-4-5', provider: 'openrouter', contextLength: 200000 },

  // DeepSeek (via OpenRouter) — 128k
  { model: 'deepseek/deepseek-v4-flash', provider: 'openrouter', contextLength: 128000 },
  { model: 'deepseek/deepseek-v4-pro', provider: 'openrouter', contextLength: 128000 },
  { model: 'deepseek/deepseek-r1-0528', provider: 'openrouter', contextLength: 128000 },

  // Google Gemini (via OpenRouter) — 1M
  { model: 'google/gemini-3.7-flash', provider: 'openrouter', contextLength: 1048576 },
  { model: 'google/gemini-3.6-flash', provider: 'openrouter', contextLength: 1048576 },
  { model: 'google/gemini-3-flash', provider: 'openrouter', contextLength: 1048576 },

  // OpenAI (via OpenRouter)
  { model: 'openai/gpt-5.6-luna-pro', provider: 'openrouter', contextLength: 200000 },
  { model: 'openai/gpt-5.5-pro', provider: 'openrouter', contextLength: 128000 },
  { model: 'openai/gpt-5', provider: 'openrouter', contextLength: 128000 },
  { model: 'openai/gpt-4o', provider: 'openrouter', contextLength: 128000 },
  { model: 'openai/o3', provider: 'openrouter', contextLength: 200000 },
  { model: 'openai/o4-mini', provider: 'openrouter', contextLength: 200000 },

  // NVIDIA Nemotron
  { model: 'nvidia/nemotron-3-super-120b-a12b:free', provider: 'openrouter', contextLength: 131072 },
  { model: 'nvidia/nemotron-3-ultra-550b-a55b', provider: 'openrouter', contextLength: 256000 },

  // Other notable openrouter models
  { model: 'qwen/qwen3.8-max', provider: 'openrouter', contextLength: 128000 },
  { model: 'x-ai/grok-4.20-reasoning', provider: 'openrouter', contextLength: 131072 },
  { model: 'xai/grok-4.6', provider: 'openrouter', contextLength: 131072 },
  { model: 'moonshotai/kimi-k3', provider: 'openrouter', contextLength: 131072 },
  { model: 'z-ai/glm-5.3', provider: 'openrouter', contextLength: 128000 },
  { model: 'openrouter/owl-alpha', provider: 'openrouter', contextLength: 64000 }
]

export function knownWindowFor(model) {
  const hit = KNOWN_MODELS.find(m => m.model === model)
  return hit && hit.contextLength ? hit.contextLength : null
}