/** A source template is configuration, never an executable agent factory. */
export function renderPackageTemplate(template, { label = 'My agent', description = '', instructions = '' } = {}) {
  if (template?.version !== 1 || !Array.isArray(template.files) || !template.files.length || template.files.length > 256) throw new Error('The agent starter template is unavailable or unsupported.')
  for (const [name, value] of Object.entries({ label, description, instructions })) if (typeof value !== 'string' || value.length > (name === 'instructions' ? 100000 : 4000)) throw new Error(`Invalid agent ${name}.`)
  if (!label.trim()) throw new Error('Give the draft a name.')
  const values = { name: JSON.stringify(label.trim()), description: JSON.stringify(description), instructions }
  return template.files.map(file => {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') throw new Error('The agent starter template contains an invalid file.')
    return { path: file.path, content: file.content.replace(/\{\{([a-z]+)\}\}/g, (match, key) => {
      if (!Object.hasOwn(values, key)) throw new Error(`Unknown starter template field: ${key}`)
      return values[key]
    }) }
  })
}
