import { validateToolInput, schemaParameters } from './tool-input.js'
import { snapshot } from './prompt.js'
/**
 * Tools — anything callable that can describe itself to a model.
 *
 *     tool({name, description, parameters, run})     one shape for every tier
 *     fromModule(exports, {tier, source})           a tools.js file → its tools
 *     instructions(tool)                            the line the model reads
 *     toolbox(tiers, {has})                         resolve names once, local first
 *
 * Port of the skeleton's `core/tools.py`. Three tiers and agents share one shape, so an
 * engine's tool list is the whole of what it can reach. A tool's instruction line is
 * generated from its own name, description and parameters, so the prompt and the code
 * cannot drift apart.
 *
 * A tool module imports nothing: it exports plain objects or functions, and receives what it
 * needs through `run(args, ctx)`. A worker ignores the page's import map and cannot resolve
 * bare specifiers, so a module that imported would load in one realm and fail in the other.
 */

/** Normalise anything tool-shaped into `{name, description, parameters, requires, run, tier, source}`. */
export function tool(spec, defaults = {}) {
  const run = typeof spec === 'function' ? spec : spec.run
  const name = String(defaults.name ?? spec.name ?? run?.name ?? '')
  if (typeof run !== 'function') throw new TypeError(`tool ${name || '?'} has no run function`)
  return {
    name,
    description: String(spec.description ?? '').trim(),
    parameters: spec.inputSchema ? schemaParameters(spec.inputSchema) : { ...(spec.parameters ?? {}) },
    inputSchema: spec.inputSchema ? snapshot(spec.inputSchema) : null,
    providerInputSchema: spec.providerInputSchema ? snapshot(spec.providerInputSchema) : null,
    requires: [...(spec.requires ?? [])],
    risk: spec.risk ?? defaults.risk ?? '',
    repeatable: spec.repeatable !== false,
    // Results may depend on files, permissions, time or another agent. Caching is opt-in.
    cacheable: spec.cacheable === true && !spec.writes,
    writes: Boolean(spec.writes),
    resolveArguments: typeof spec.resolveArguments === 'function' ? spec.resolveArguments : null,
    projectObservation: typeof spec.projectObservation === 'function' ? spec.projectObservation : null,
    projectActivity: typeof spec.projectActivity === 'function' ? spec.projectActivity : null,
    run,
    tier: defaults.tier ?? spec.tier ?? 'built-in',
    source: defaults.source ?? spec.source ?? '',
  }
}

/**
 * Every exported tool in a module. An export counts if it is a function or an object with a
 * `run` function; names starting with `_` are private, as in the skeleton. The export name
 * is the tool name unless an object export says otherwise.
 */
export function fromModule(exports, { tier = 'local', source = '' } = {}) {
  const found = []
  for (const [key, value] of Object.entries(exports)) {
    if (key.startsWith('_') || key === 'default') continue
    const isFunction = typeof value === 'function'
    const isObject = value && typeof value === 'object' && typeof value.run === 'function'
    if (!isFunction && !isObject) continue
    const name = isObject && typeof value.name === 'string' ? value.name : key
    found.push(tool(value, { name, tier, source }))
  }
  return found
}

/** The line the model reads: `- name(a: number, b: string): description`. */
export function instructions(item) {
  if (item.providerInputSchema) return `- ${item.name}(args: JSON object): ${item.description}\n  Input JSON Schema: ${JSON.stringify(item.providerInputSchema)}`
  const args = Object.entries(item.parameters)
    .map(([key, type]) => `${key}: ${type}`)
    .join(', ')
  return `- ${item.name}(${args}): ${item.description}`
}

/**
 * Resolve tiers into one list, decided once: local, then common, then built-in, then agents.
 * A later tool whose name is already taken is shadowed, and said so. A tool whose
 * requirement is missing is left out of the prompt, and said so.
 *
 * Returns `{ tools, shadowed, unavailable }`.
 */
export function toolbox(tiers, { has = () => true } = {}) {
  const taken = new Map()
  const shadowed = []
  const unavailable = []
  for (const tier of tiers) {
    for (const item of tier) {
      const missing = item.requires.filter((need) => !has(need))
      if (missing.length) {
        unavailable.push({ name: item.name, tier: item.tier, missing })
        continue
      }
      if (taken.has(item.name)) {
        shadowed.push({ name: item.name, tier: item.tier, by: taken.get(item.name).tier })
        continue
      }
      taken.set(item.name, item)
    }
  }
  return { tools: [...taken.values()], shadowed, unavailable }
}

/** Status comes from execution, never from text that the tool happens to return. */
export async function runToolResult(item, args, ctx) {
  let resolvedArgs
  try {
    const faults = validateToolInput(item.inputSchema, args ?? {})
    if (faults.length) return { text: `${item.name} failed: Invalid tool arguments: ${faults.join('; ')}`, ok: false, failureKind: 'invalid_input' }
    if (item.resolveArguments) {
      try {
        const resolved = item.resolveArguments(snapshot(args ?? {}), ctx)
        if (resolved && typeof resolved.then === 'function') {
          Promise.resolve(resolved).catch(() => {})
          throw new Error('Tool argument resolution must be synchronous')
        }
        if (!resolved || typeof resolved !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(resolved))) throw new Error('Tool argument resolution must return a plain object')
        resolvedArgs = snapshot(resolved)
      } catch (error) {
        return { text: `${item.name} failed: Invalid tool arguments: ${error?.message ?? error}`, ok: false, failureKind: 'invalid_input' }
      }
    }
    const result = await item.run(resolvedArgs ?? args ?? {}, ctx)
    const text = result == null || result === '' ? '(no output)' : typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    return { text, ok: true, ...(resolvedArgs ? { resolvedArgs } : {}) }
  } catch (error) {
    return { text: `${item.name} failed: ${error?.message ?? error}`, ok: false, ...(resolvedArgs ? { resolvedArgs } : {}) }
  }
}

/** Compatibility text adapter. Engines consume the typed result above. */
export async function runTool(item, args, ctx) { return (await runToolResult(item, args, ctx)).text }
