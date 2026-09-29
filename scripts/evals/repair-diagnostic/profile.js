/** Explicitly selected evaluation transport, not an inferred saved UI setting.
 * Temperature 0 also matches the sixth run's recorded ProviderRequest. */
export const MODEL_PROFILE = Object.freeze({
  provider: 'openai', model: 'Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp',
  base_url: 'http://127.0.0.1:8873/v1', max_output_tokens: 8192,
  context_length: 32768, temperature: 0,
  request_params: Object.freeze({ chat_template_kwargs: Object.freeze({ enable_thinking: false }) }),
})
export const modelCatalogue = () => ({ default: 'repair-evaluation', models: { 'repair-evaluation': structuredClone(MODEL_PROFILE) } })
