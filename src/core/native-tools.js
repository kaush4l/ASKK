/** Native transport validation only. Execution and argument-schema authority stay with the dispatcher. */
const NAME = /^[A-Za-z0-9_-]{1,64}$/
const ID = /^[A-Za-z0-9_-]{1,128}$/
export const isNativeCallId = value => typeof value === 'string' && ID.test(value)
export const isNativeFunctionName = value => typeof value === 'string' && NAME.test(value)

export function validateNativeTools(tools, settings, fail) {
  if (!Array.isArray(tools)) fail('nativeTools must be an array', 'configuration')
  if ((settings.provider ?? 'openai') !== 'openai') fail('Native tools require an OpenAI-compatible endpoint', 'configuration')
  if (settings.structuredOutput !== undefined) fail('Native tools conflict with structured_output', 'configuration')
  for (const key of ['tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'functions', 'function_call']) {
    if (Object.hasOwn(settings.requestParams ?? {}, key)) fail(`Native tools conflict with request_params.${key}`, 'configuration')
  }
  const names = new Set()
  for (const tool of tools) {
    const fn = tool?.function
    if (tool?.type !== 'function' || !fn || !NAME.test(fn.name ?? '') || typeof fn.name !== 'string' || names.has(fn.name)) fail('Native tools require unique valid function names', 'configuration')
    if (!fn.parameters || typeof fn.parameters !== 'object' || Array.isArray(fn.parameters) || fn.parameters.type !== 'object') fail('Native function parameters must declare an object schema', 'configuration')
    names.add(fn.name)
  }
}

export function nativeToolAccumulator(tools, fail) {
  const calls = new Map()
  const ids = new Set()
  const names = new Set(tools.map(tool => tool.function.name))
  return {
    get size() { return calls.size },
    add(fragment) {
      if (!fragment || !Number.isInteger(fragment.index) || fragment.index < 0) fail('Native tool fragment requires a nonnegative integer index')
      if (tools.length === 0) fail('Native tool calls are forbidden on a final-only request')
      if (fragment.type !== undefined && fragment.type !== 'function') fail('Native tool call must have function type')
      let call = calls.get(fragment.index)
      if (!call) {
        if (calls.size) fail('Only one native tool call is allowed per response')
        call = { id: '', type: 'function', function: { name: '', arguments: '' } }
        calls.set(fragment.index, call)
      }
      if (fragment.id !== undefined) {
        if (typeof fragment.id !== 'string' || !ID.test(fragment.id) || ids.has(fragment.id) || call.id) fail('Native tool call requires a unique valid ID')
        ids.add(fragment.id)
        call.id = fragment.id
      }
      if (fragment.function !== undefined) {
        if (!fragment.function || typeof fragment.function !== 'object' || Array.isArray(fragment.function)) fail('Invalid native function fragment')
        for (const key of ['name', 'arguments']) {
          if (fragment.function[key] !== undefined) {
            if (typeof fragment.function[key] !== 'string') fail(`Native function ${key} fragment must be a string`)
            call.function[key] += fragment.function[key]
          }
        }
      }
    },
    finish() {
      const call = calls.values().next().value
      if (!call) return null
      if (!ID.test(call.id) || !NAME.test(call.function.name) || !names.has(call.function.name)) fail('Native tool call has a missing ID or unknown function name')
      let args
      try { args = JSON.parse(call.function.arguments) } catch { fail('Native tool arguments must be valid JSON') }
      if (!args || typeof args !== 'object' || Array.isArray(args)) fail('Native tool arguments must be a JSON object')
      return call
    },
  }
}
