const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
const path = value => identifier(value) && !value.includes('\\') && !value.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..')

/** Link metadata is presentation only; consumers must resolve real retained resources. */
export function normalizeToolActivity(value, { ok } = {}) {
  try {
    if (typeof ok !== 'boolean' || !plain(value)) return {}
    const result = {}
    for (const key of ['path', 'commandId', 'artifactId']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
      if (key !== 'commandId' && !ok) continue
      if ((key === 'path' ? path : identifier)(descriptor.value)) result[key] = descriptor.value
    }
    return result
  } catch { return {} }
}

/** A trusted tool adapter owns receipt interpretation; model prose never supplies links. */
export function toolActivity(item, { text, ok }, args) {
  try {
    if (typeof item?.projectActivity !== 'function' || typeof ok !== 'boolean') return {}
    const projected = item.projectActivity({ text, ok, name: item.name, args: structuredClone(args ?? {}) })
    if (projected instanceof Promise) { projected.catch(() => {}); return {} }
    return normalizeToolActivity(projected, { ok })
  } catch { return {} }
}
