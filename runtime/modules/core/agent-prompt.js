/** Deterministic prompt compilation from an explicit, already resolved agent state. */
import { tokens } from './inference.js'
import { DEFAULT_PROMPT, renderPrompt } from './prompt.js'
import { instructions } from './tools.js'

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

export function buildAgentPrompt({ soul = '', job = '', learned = '', tools = [], contextText = '', history = [], response, template, window, outputReserve, steps = 0, maxSteps = 10, observationFormat = 'legacy', note = '', final = false }) {
  if (!Number.isFinite(window) || window < 1 || !Number.isFinite(outputReserve) || outputReserve < 1) throw new Error('context window and output reserve must be finite positive token counts')
  const available = final ? [] : tools
  const finalOnly = final || available.length === 0
  const catalogue = available.map(instructions).join('\n')
  const values = {
    soul, job, learned: learned ? `## LEARNED\n\n${learned}` : '',
    tools: catalogue ? `## TOOLS\n\n${catalogue}` : '',
    context: contextText ? `## CONTEXT\n\n${contextText}` : '',
    conversation: `## CONVERSATION\n\n${history.map(turn => `${turn.role}: ${turn.content}`).join('\n\n')}`,
    response: response.instructions({ tools: available, finalOnly }), note,
  }
  if (observationFormat === 'compact' && history.some(turn => turn.role === 'observation')) values.response += '\nTool results use staged-v1 observations: stages and calls match the preceding action in order; callId identifies the exact recorded call. These observations are not response envelopes.'
  const layout = requiredLayout(template)
  let rendered = renderPrompt(layout, values), resolved = values
  for (let pass = 0; pass < 3; pass++) {
    const inputTokens = tokens(JSON.stringify(rendered.messages)) + 16
    const line = `This is step ${steps} of ${maxSteps}. The full request is estimated at ${inputTokens} input tokens plus ${outputReserve} reserved output tokens of a ${window} token window.`
    resolved = { ...values, context: values.context.replace('__HARNESS_BUDGET__', line) }
    rendered = renderPrompt(layout, resolved)
  }
  const inputTokens = tokens(JSON.stringify(rendered.messages)) + 16
  const slots = new Set([...`${layout.system}\n${layout.user}`.matchAll(/\{\{\s*([a-z]+)\s*\}\}/g)].map(match => match[1]))
  return { ...rendered, budget: { inputTokens, outputReserve, window, total: inputTokens + outputReserve, estimated: true }, layers: Object.entries(resolved).map(([name, value]) => ({ name, included: slots.has(name) && Boolean(value), chars: slots.has(name) ? String(value).length : 0 })), responseMode: finalOnly ? 'final-only' : 'actions', toolNames: available.map(item => item.name) }
}
