/** A source template is configuration, never an executable agent factory. */
export function renderPackageTemplate(template, { label = 'My agent', description = '', instructions = '', responseProtocol = 'envelope' } = {}) {
  if (template?.version !== 1 || !Array.isArray(template.files) || !template.files.length || template.files.length > 256) throw new Error('The agent starter template is unavailable or unsupported.')
  for (const [name, value] of Object.entries({ label, description, instructions })) if (typeof value !== 'string' || value.length > (name === 'instructions' ? 100000 : 4000)) throw new Error(`Invalid agent ${name}.`)
  if (!label.trim()) throw new Error('Give the draft a name.')
  if (!description.trim() && typeof template.defaultDescription === 'string') description = template.defaultDescription
  if (template.protocols !== undefined && (!Array.isArray(template.protocols) || template.protocols.some(choice => !choice || typeof choice.id !== 'string' || typeof choice.source !== 'string'))) throw new Error('The starter response protocols are invalid.')
  const protocol = template.protocols?.find(choice => choice.id === responseProtocol)
  if ((template.protocols && !protocol) || (!template.protocols && responseProtocol !== 'envelope')) throw new Error('Unsupported starter response protocol.')
  if (protocol && typeof protocol.source !== 'string') throw new Error('The starter response protocol is invalid.')
  const values = { ...(protocol ? { protocol: protocol.source } : {}), name: JSON.stringify(label.trim()), description: JSON.stringify(description), instructions }
  return template.files.map(file => {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') throw new Error('The agent starter template contains an invalid file.')
    return { path: file.path, content: file.content.replace(/\{\{([a-z]+)\}\}/g, (match, key) => {
      if (!Object.hasOwn(values, key)) throw new Error(`Unknown starter template field: ${key}`)
      return values[key]
    }) }
  })
}
