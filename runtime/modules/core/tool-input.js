/** A deliberately small declarative input contract. Trusted tool adapters own schemas;
 * neither model replies nor agent folders can install validators or executable code. */
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
export function validateToolInput(schema, value, path = 'args') {
  if (!schema) return [] // Legacy tools keep their adapter-level validation.
  const faults = []
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const matches = type => type === 'object' ? plain(value) : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : type === 'null' ? value === null : typeof value === type
  if (!types.some(matches)) return [`${path} must be ${types.join(' or ')}`]
  if (schema.enum && !schema.enum.includes(value)) faults.push(`${path} must be one of ${schema.enum.join(', ')}`)
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) faults.push(`${path} is too short`)
    if (schema.maxLength != null && value.length > schema.maxLength) faults.push(`${path} is too long`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) faults.push(`${path} has too few items`)
    if (schema.maxItems != null && value.length > schema.maxItems) faults.push(`${path} has too many items`)
    if (schema.items) for (let index = 0; index < value.length; index++) faults.push(...validateToolInput(schema.items, value[index], `${path}[${index}]`))
  } else if (plain(value)) {
    for (const name of schema.required ?? []) if (!Object.hasOwn(value, name)) faults.push(`${path}.${name} is required`)
    for (const [name, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, name)) faults.push(...validateToolInput(schema.properties[name], item, `${path}.${name}`))
      else if (schema.additionalProperties === false) faults.push(`${path}.${name} is not an accepted parameter`)
    }
  }
  return faults
}
export function schemaParameters(schema) {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, field]) => [name, `${Array.isArray(field.type) ? field.type.join(' or ') : field.type}${schema.required?.includes(name) ? '' : ' (optional)'}`]))
}

/** Contract examples come from the same descriptor used before dispatch. */
export function exampleToolInput(schema) {
  if (schema.enum?.length) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type === 'object') return Object.fromEntries((schema.required ?? []).map(name => [name, exampleToolInput(schema.properties[name])]))
  if (type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => exampleToolInput(schema.items ?? { type: 'string' }))
  if (type === 'boolean') return false
  if (type === 'integer' || type === 'number') return 1
  if (type === 'null') return null
  return 'value'.padEnd(schema.minLength ?? 0, 'x').slice(0, schema.maxLength ?? Infinity)
}
