import { exampleToolInput } from './tool-input.js'
/**
 * Structured replies in TOON (`field: value` blocks, cheap, streamable) or JSON (universal).
 *
 *     const reply = responseModel(ReAct, 'toon')
 *     reply.instructions()        // prompt side — generated from the fields, never hand-written
 *     reply.parse(text)           // parse side — { value, faults }
 *     reply.fields(text)          // the fields finished so far, while the reply streams
 *
 * Port of the skeleton's `core/responses.py`. A response is a list of fields, and each
 * field's description carries real instruction, because that is where the model reads it.
 * The format is chosen once and carried by the response, so a field's meaning is written
 * once and rendered correctly in either format.
 */

import { parseStages, structuredStages } from './calls.js'

export const schemaResponseFormat = schema => ({ type: 'json_schema', json_schema: { name: 'agent_response', strict: false, schema } })

/** The ReAct reply: think, then say `do`, then `act`. One payload field, not two. */
export const ReAct = {
  name: 'ReActResponse',
  fields: [
    { name: 'thoughts', kind: 'list', description: 'your reasoning, one step per item' },
    { name: 'observations', kind: 'list', description: 'what the last result told you' },
    {
      name: 'do',
      kind: 'text',
      description: "exactly 'tool' to run tools, or 'done' to reply — never a tool name, tool names belong in act",
    },
    {
      name: 'act',
      kind: 'tool calls, or text',
      description:
        "what do asked for. With 'tool', the tools to run, each written as name({\"key\": \"value\"}) and grouped " +
        '[[first, second], [third]] — those in the same inner list run at the same time, the lists run one after ' +
        "another. With 'done', the reply, in plain words. One or the other, never both.",
      example: '[[first({"key": "value"}), second({"key": "value"})]] — or the reply itself, when do is done',
    },
  ],
  /** A tool name written in `do` meant 'tool'. A missing `do` is a fault, never a default. */
  validate(value) {
    const faults = []
    const said = String(value.do ?? '').trim().toLowerCase()
    if (!said) faults.push("do: missing — write exactly 'tool' or 'done'")
    else value.do = said === 'done' ? 'done' : 'tool'
    if (typeof value.act !== 'string') faults.push('act: expected text in contract version 1')
    else {
      value.act = value.act.trim()
      if (value.do === 'tool') faults.push(...parseStages(value.act).faults)
      if (value.do === 'done' && !value.act) faults.push('act: a final answer must not be empty')
    }
    return faults
  },
  calls: (value) => (value.do === 'tool' ? parseStages(value.act).stages : []),
  answer: (value) => (value.do === 'done' ? value.act : ''),
  recovered: (text) => ({ do: 'invalid', act: String(text ?? '').trim(), failed: true }),
}

export const CompactReAct = {
  name: 'CompactReActResponse',
  version: 2,
  fields: [
    ReAct.fields[2],
    { name: 'act', kind: 'stages or text', description: 'With do="tool", a non-empty array of stages; each stage is an array of {"name":"tool_name","args":{}} calls. Calls within a stage run together; stages run in order. With do="done", a non-empty final answer string.' },
  ],
  validate(value) {
    const faults = []
    if (!['tool', 'done'].includes(value.do)) faults.push('do: expected exactly "tool" or "done"')
    if (Object.keys(value).some((key) => !['do', 'act'].includes(key))) faults.push('reply: version 2 permits only do and act')
    if (value.do === 'tool') faults.push(...structuredStages(value.act).faults)
    else if (value.do === 'done' && (typeof value.act !== 'string' || !value.act.trim())) faults.push('act: expected a non-empty final answer string')
    return faults
  },
  calls: (value) => value.do === 'tool' ? structuredStages(value.act).stages : [],
  answer: ReAct.answer,
  recovered: ReAct.recovered,
}

/** One action per decision; normalized to the same validated dispatcher stages. */
export const SingleReAct = {
  ...CompactReAct,
  name: 'SingleReActResponse',
  version: 3,
  fields: [ReAct.fields[2], { name: 'act', kind: 'call or text', description: 'With do="tool", exactly one {"name":"tool_name","args":{}} object. Wait for its result before choosing the next action. With do="done", a non-empty final answer string.' }],
  validate(value) {
    const faults = []
    if (!['tool', 'done'].includes(value.do)) faults.push('do: expected exactly "tool" or "done"')
    if (Object.keys(value).some(key => !['do', 'act'].includes(key))) faults.push('reply: version 3 permits only do and act')
    if (value.do === 'tool') faults.push(...structuredStages([[value.act]]).faults)
    else if (value.do === 'done' && (typeof value.act !== 'string' || !value.act.trim())) faults.push('act: expected a non-empty final answer string')
    return faults
  },
  calls: value => value.do === 'tool' ? structuredStages([[value.act]]).stages : [],
}

/** The response, speaking one format. */
export function responseModel(shape = ReAct, format = 'toon') {
  const names = new Set(shape.fields.map((field) => field.name))
  const byName = Object.fromEntries(shape.fields.map((field) => [field.name, field]))

  const instructions = ({ tools = [], finalOnly = tools.length === 0 } = {}) => {
    finalOnly ||= tools.length === 0
    // Do not invent arguments for arbitrary provider JSON Schema ($ref, oneOf, etc.).
    const exampleTool = finalOnly ? null : tools.find(tool => !tool.providerInputSchema)
    const name = exampleTool?.name
    const args = exampleTool?.inputSchema ? exampleToolInput(exampleTool.inputSchema) : Object.fromEntries(Object.entries(exampleTool?.parameters ?? {}).map(([key, type]) => [key,
      /number|integer/.test(String(type)) ? 1 : /boolean/.test(String(type)) ? false : /array/.test(String(type)) ? [] : /object/.test(String(type)) ? {} : 'value',
    ]))
    const toolExample = exampleTool ? `[[${name}(${JSON.stringify(args)})]]` : ''
    const fields = finalOnly ? shape.fields.map(field => field.name === 'do' ? { ...field, description: 'exactly done; no tools are available for this response', example: 'done' } : field.name === 'act' ? { ...field, kind: 'text', description: 'a non-empty final answer string', example: 'The result and any unfinished work.' } : field) : shape.fields
    const lines = fields.map((field) => `- ${field.name} (${field.kind}): ${field.description}`)
    if (format === 'json') {
      if (finalOnly) return `## RESPONSE FORMAT\n\nContract version ${shape.version ?? 1}. Reply with a single JSON object, no markdown fences, with these fields:\n\n${lines.join('\n')}\n\nFinal example: {"do":"done","act":"The result and any unfinished work."}\n`
      const act = shape.version === 3 ? { name, args } : shape.version === 2 ? [[{ name, args }]] : `[[${name}(${JSON.stringify(args)})]]`
      return `## RESPONSE FORMAT\n\nContract version ${shape.version ?? 1}. Reply with a single JSON object, no markdown fences, with these fields:\n\n${lines.join('\n')}\n\n${exampleTool ? `Tool example: ${JSON.stringify({ do: 'tool', act })}\n` : ''}Final example: {"do":"done","act":"The verified result."}\n`
    }
    const example = fields.map((field) => `${field.name}: ${field.name === 'act' ? toolExample || 'The result and any unfinished work.' : field.name === 'do' ? exampleTool ? 'tool' : 'done' : field.example ?? sample(field)}`)
    return (
      '## RESPONSE FORMAT\n\n' +
      'Reply in TOON: one `field: value` per block, blank line between blocks.\n' +
      'List values use bracket notation [item one, item two].\n' +
      'No markdown fences, no bold, no bullets, no other field names.\n\n' +
      `${lines.join('\n')}\n\n### Example\n\n${example.join('\n\n')}\n`
    )
  }

  const toon = (text) => {
    const lines = String(text).split('\n')
    const starts = []
    lines.forEach((line, index) => {
      const colon = line.indexOf(':')
      if (colon === -1) return
      const key = line
        .slice(0, colon)
        .trim()
        .replace(/^[*\-#\s`]+|[*`\s]+$/g, '')
        .toLowerCase()
      if (names.has(key)) starts.push({ index, key, first: line.slice(colon + 1).trim() })
    })
    const data = {}
    starts.forEach((start, position) => {
      const end = position + 1 < starts.length ? starts[position + 1].index : lines.length
      const block = [start.first, ...lines.slice(start.index + 1, end)].join('\n').trim()
      data[start.key] = coerce(byName[start.key], block)
    })
    return data
  }

  const json = (text) => {
    let source = String(text)
    if ((shape.version ?? 1) < 2) {
      const start = source.indexOf('{')
      const end = source.lastIndexOf('}')
      if (start === -1 || end <= start) return { value: null, faults: [] }
      source = source.slice(start, end + 1)
    }
    try {
      const value = JSON.parse(source)
      if (value && typeof value === 'object' && !Array.isArray(value)) return { value, faults: [] }
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
      return { value: null, faults: [`reply: expected a JSON object, received ${type}`] }
    } catch (error) {
      // Engines may quote model output in SyntaxError messages. Keep punctuation and
      // location hints, but remove quoted excerpts and bound the repair diagnostic.
      const detail = String(error.message).replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, match => match.length > 3 ? '[text]' : match).replace(/\s+/g, ' ').slice(0, 180)
      return { value: null, faults: [`reply: invalid JSON — ${detail}`] }
    }
  }

  const read = (text) => {
    if (format === 'json') return json(text).value ?? ((shape.version ?? 1) >= 2 ? {} : toon(text))
    const found = toon(text)
    return Object.keys(found).length ? found : (json(text).value ?? {})
  }

  return {
    shape,
    format,
    instructions,

    /** Optional provider constraint, never a substitute for parsing or tool validation. */
    schema({ tools = [], finalOnly = tools.length === 0 } = {}) {
      if (format !== 'json' || ![2, 3].includes(shape.version)) throw new Error('Response schema requires JSON contract version 2 or 3')
      const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
      const done = object({ do: { const: 'done' }, act: { type: 'string', minLength: 1 } })
      if (finalOnly || !tools.length) return done
      const call = object({ name: { type: 'string', enum: [...new Set(tools.map(tool => tool.name))] }, args: { type: 'object', additionalProperties: true } })
      const array = items => ({ type: 'array', minItems: 1, items })
      return { anyOf: [object({ do: { const: 'tool' }, act: shape.version === 3 ? call : array(array(call)) }), done] }
    },

    /** The whole reply, validated: `{ value, faults }`. Faults are what the repair shows the model. */
    parse(text) {
      if (format === 'json' && (shape.version ?? 1) >= 2) {
        const parsed = json(text)
        if (parsed.faults.length) return { value: {}, faults: parsed.faults }
        return { value: parsed.value, faults: shape.validate(parsed.value) }
      }
      const value = read(text)
      const faults = Object.keys(value).length ? shape.validate(value) : ['reply: no fields found — use the format above']
      return { value, faults }
    },

    /**
     * The fields readable so far while the reply streams. In TOON the last field is still being
     * written, so it is held back until the stream ends. JSON cannot be read until it closes.
     */
    fields(text, complete = false) {
      if (format === 'json') return json(text).value ?? {}
      const found = Object.entries(toon(text))
      return Object.fromEntries(complete ? found : found.slice(0, -1))
    },

    calls: (value) => shape.calls(value),
    answer: (value) => shape.answer(value),
    recovered: (text) => shape.recovered(text),
  }
}

function sample(field) {
  return field.kind === 'list' ? '[item one, item two]' : `<${field.name}>`
}

/** List fields split on their top-level commas; text fields stay whole. */
function coerce(field, text) {
  if (field.kind !== 'list') return text
  let body = text.trim()
  if (body.startsWith('[') && body.endsWith(']')) body = body.slice(1, -1)
  const items = []
  let depth = 0
  let current = ''
  let quoted = false
  for (const char of body) {
    if (char === '"') quoted = !quoted
    if (!quoted && '([{'.includes(char)) depth += 1
    if (!quoted && ')]}'.includes(char)) depth -= 1
    if (char === ',' && depth === 0 && !quoted) {
      items.push(current.trim())
      current = ''
    } else current += char
  }
  items.push(current.trim())
  return items.filter(Boolean)
}
