/** Calibration stays local to an engine and a resolved model configuration. */
export function calibrationKey(llm) {
  if (llm.calibrationKey) return llm.calibrationKey
  const settings = llm.settings ?? {}
  return JSON.stringify([settings.provider ?? 'openai', settings.baseUrl ?? '', llm.model ?? settings.model ?? '', settings.via ?? '', settings.command ?? '', settings.args ?? []])
}

/** Provider counts only; cached subsets alone are not a complete input count. */
export function reportedInputTokens(usage) {
  const valid = value => Number.isSafeInteger(value) && value >= 0
  if (!usage || typeof usage !== 'object') return null
  if (valid(usage.prompt_tokens)) return usage.prompt_tokens
  if (!valid(usage.input_tokens)) return null
  // Anthropic input_tokens excludes cache reads and cache creation.
  const cached = [usage.cache_read_input_tokens, usage.cache_creation_input_tokens]
  if (cached.some(value => value !== undefined && !valid(value))) return null
  const total = usage.input_tokens + cached.reduce((sum, value) => sum + (value ?? 0), 0)
  return valid(total) ? total : null
}
