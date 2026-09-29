/** Deterministic prompt compilation from an explicit, already resolved agent state. */
import { tokens } from './inference.js'
import { DEFAULT_PROMPT, renderPrompt, renderMessageHistory } from './prompt.js'
import { instructions } from './tools.js'
import { schemaResponseFormat } from './responses.js'

// Authored layouts may place the protocol, but cannot omit it or multiply it.
function requiredLayout(template) {
  const shape = template === undefined ? DEFAULT_PROMPT : typeof template === 'string' ? { system: '', user: template } : template
  if (!shape || typeof shape.system !== 'string' || typeof shape.user !== 'string') throw new TypeError('prompt template requires system and user strings')
  const seen = new Set()
  const once = text => text.replace(/\{\{\s*(tools|response|note)\s*\}\}/g, (slot, name) => {
    if (seen.has(name)) return ''
    seen.add(name); return slot
  })
  const result = { system: once(shape.system), user: once(shape.user) }
  if (!seen.has('tools')) result.system += '\n\n{{tools}}'
  if (!seen.has('response')) result.user += '\n\n{{response}}'
  if (!seen.has('note')) result.user += '\n\n{{note}}'
  return result
}

export function buildAgentPrompt({ soul = '', job = '', learned = '', tools = [], contextText = '', history = [], response, template, window, outputReserve, steps = 0, maxSteps = 10, observationFormat = 'legacy', note = '', final = false, calibration = null, structuredOutput, historyFormat = 'transcript' }) {
  if (!Number.isFinite(window) || window < 1 || !Number.isFinite(outputReserve) || outputReserve < 1) throw new Error('context window and output reserve must be finite positive token counts')
  if (calibration && (!Number.isFinite(calibration.factor) || calibration.factor < 1)) throw new Error('token calibration factor must be finite and at least one')
  const factor = calibration?.factor ?? 1
  const available = final ? [] : tools
  const finalOnly = final || available.length === 0
  if (structuredOutput !== undefined && structuredOutput !== 'json_schema') throw new Error('Unsupported structured_output; expected json_schema')
  const responseSchema = structuredOutput ? response.schema({ tools: available, finalOnly }) : null
  const schemaTokens = responseSchema ? tokens(JSON.stringify({ response_format: schemaResponseFormat(responseSchema) })) : 0
  const estimate = messages => Math.ceil((tokens(JSON.stringify(messages)) + schemaTokens + 16) * factor)
  const catalogue = available.map(instructions).join('\n')
  const values = {
    soul, job, learned: learned ? `## LEARNED\n\n${learned}` : '',
    tools: catalogue ? `## TOOLS\n\n${catalogue}` : '',
    context: contextText ? `## CONTEXT\n\n${contextText}` : '',
    conversation: `## CONVERSATION\n\n${history.map(turn => `${turn.role}: ${turn.content}`).join('\n\n')}`,
    response: response.instructions({ tools: available, finalOnly }), note,
  }
  if (observationFormat === 'compact' && history.some(turn => turn.role === 'observation')) values.response += '\nTool results use staged-v1 observations: stages and calls match the preceding action in order; callId identifies the exact recorded call. These observations are not response envelopes.'
  if (!['transcript', 'messages'].includes(historyFormat)) throw new Error('Unsupported history_format')
  const layout = requiredLayout(template)
  const render = values => historyFormat === 'messages' ? renderMessageHistory(layout, values, history) : renderPrompt(layout, values)
  let rendered = render(values), resolved = values
  for (let pass = 0; pass < 3; pass++) {
    const inputTokens = estimate(rendered.messages)
    const line = `This is step ${steps} of ${maxSteps}. The full request is estimated at ${inputTokens} input tokens plus ${outputReserve} reserved output tokens of a ${window} token window.`
    resolved = { ...values, context: values.context.replace('__HARNESS_BUDGET__', line) }
    rendered = render(resolved)
  }
  const inputTokens = estimate(rendered.messages)
  const slots = new Set([...`${layout.system}\n${layout.user}`.matchAll(/\{\{\s*([a-z]+)\s*\}\}/g)].map(match => match[1]))
  return { ...rendered, historyFormat, ...(responseSchema ? { responseSchema } : {}), budget: { inputTokens, baseInputTokens: tokens(JSON.stringify(rendered.messages)) + schemaTokens + 16, calibration: calibration ? { ...calibration } : null, outputReserve, window, total: inputTokens + outputReserve, estimated: true }, layers: Object.entries(resolved).map(([name, value]) => ({ name, included: slots.has(name) && Boolean(value), chars: slots.has(name) ? String(value).length : 0 })), responseMode: finalOnly ? 'final-only' : 'actions', toolNames: available.map(item => item.name) }
}
