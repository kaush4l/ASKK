/** Literal substitution only: templates never execute code or expand inserted values twice. */
export const DEFAULT_PROMPT = Object.freeze({
  system: '{{soul}}\n\n{{job}}\n\n{{learned}}\n\n{{tools}}',
  user: '{{context}}\n\n{{conversation}}\n\n{{response}}{{note}}',
})

export function renderPrompt(template = DEFAULT_PROMPT, values) {
  const shape = typeof template === 'string' ? { system: '', user: template } : template
  if (!shape || typeof shape.system !== 'string' || typeof shape.user !== 'string') throw new TypeError('prompt template requires system and user strings')
  const fill = (source) => source.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`unknown prompt template slot: ${key}`)
    return String(values[key] ?? '')
  }).trim()
  const messages = [{ role: 'system', content: fill(shape.system) }, { role: 'user', content: fill(shape.user) }]
  return { sheet: messages.map((message) => message.content).filter(Boolean).join('\n\n'), messages }
}

/** Snapshot only JSON-shaped public data. Freezing protects recorded attempts from later edits. */
export function snapshot(value) {
  const copy = JSON.parse(JSON.stringify(value))
  const freeze = (part) => {
    if (part && typeof part === 'object') {
      Object.values(part).forEach(freeze)
      Object.freeze(part)
    }
    return part
  }
  return freeze(copy)
}
