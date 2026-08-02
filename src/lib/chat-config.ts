/** User-tunable generation settings for chat, and mapping to Ollama options. */
export interface GenerationConfig {
  temperature: number
  numCtx: number
}

export const DEFAULT_GENERATION: GenerationConfig = {
  temperature: 0.7,
  numCtx: 4096,
}

/** Translate the UI config into Ollama's `options` payload (or undefined). */
export function toOllamaOptions(
  cfg: GenerationConfig,
): Record<string, unknown> | undefined {
  const options: Record<string, unknown> = { temperature: cfg.temperature }
  if (cfg.numCtx > 0) options.num_ctx = cfg.numCtx
  return Object.keys(options).length ? options : undefined
}
