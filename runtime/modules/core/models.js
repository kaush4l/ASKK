/**
 * The model catalogue — so an agent only names a model when it wants a different one.
 *
 *     models.json   {"default": "local", "models": {"local": {"provider": "openai", "model": "...", "base_url": "..."}}}
 *     settings      the same shape, saved from the page; it wins over the file
 *
 *     resolve(spec.inference, catalogue)  →  {alias, provider, model, baseUrl, apiKey, ...}
 *
 * Port of the skeleton's `core/models.py`. An agent's `model:` may name an alias or a model id.
 * With no `model:` the default alias is used. Anything else the agent sets wins over the
 * catalogue entry. Resolution happens per step in the thread, so changing the default in the
 * page reaches the next step of every agent that did not pin its own — a hot swap.
 */

const KEYS = {
  provider: 'provider',
  model: 'model',
  base_url: 'baseUrl',
  baseUrl: 'baseUrl',
  api_key: 'apiKey',
  apiKey: 'apiKey',
  temperature: 'temperature',
  max_output_tokens: 'maxOutputTokens',
  maxOutputTokens: 'maxOutputTokens',
  context_length: 'contextLength',
  contextLength: 'contextLength',
  via: 'via',
  headers: 'headers',
  request_params: 'requestParams',
  requestParams: 'requestParams',
  // the cli provider: which model CLI the host bridge runs
  cli: 'cli',
  command: 'command',
  args: 'args',
  timeout: 'timeout',
  // the scripted provider: canned replies, for tests and for trying the page without a model
  script: 'script',
  replies: 'replies',
  delay: 'delay',
}

/** The file's catalogue with the page's saved settings laid over it. */
export function merge(file = {}, saved = {}) {
  const models = { ...(file.models ?? {}), ...(saved.models ?? {}) }
  return { default: saved.default || file.default || Object.keys(models)[0] || '', models }
}

/** One catalogue entry in camelCase, empty values dropped. */
export function entry(raw = {}) {
  const out = {}
  for (const [key, value] of Object.entries(raw)) if (key in KEYS && value !== '' && value != null) out[KEYS[key]] = value
  return out
}

/**
 * What only the catalogue may say. An agent folder can be written by an agent (create_agent),
 * so a folder naming the program a CLI model runs would be a way to run a command with no
 * approval. The catalogue is the owner's: saved from the page, or models.json.
 */
const OWNER_ONLY = ['command', 'args', 'cli']

/** Explicit package bindings never fall back from an absent alias to a raw model ID. */
export function boundModelAvailable(catalogue, binding) {
  const alias = binding === '$default' ? catalogue?.default : binding
  const models = catalogue?.models
  const value = models?.[alias]
  return typeof alias === 'string' && Boolean(alias) && alias !== '$default' && Object.hasOwn(models ?? {}, alias) && Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
}

/** Turn an agent's inference settings into the settings its provider needs. */
export function resolve(settings = {}, catalogue = { models: {} }) {
  const { model: requested = catalogue.default, ...own } = entry(settings)
  if (requested === '$default' && !boundModelAvailable(catalogue, requested)) throw new Error('The desk default model profile is missing or invalid; configure a valid model before running.')
  const named = requested === '$default' ? catalogue.default : requested
  for (const key of OWNER_ONLY) delete own[key]
  if (own.provider === 'cli') delete own.provider
  const listed = named ? catalogue.models?.[named] : null
  const base = listed ? entry(listed) : named ? { model: named } : {}
  return { provider: 'openai', ...base, ...own, alias: listed ? named : '' }
}
