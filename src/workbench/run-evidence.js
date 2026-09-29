import { parseStages } from '../core/calls.js'
import { normalizeToolActivity } from '../core/tool-activity.js'

const ACTIVE = new Set(['queued', 'thinking', 'calling', 'waiting', 'compacting', 'starting', 'running', 'cancelling', 'verifying'])
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const validId = value => typeof value === 'string' && value.length > 0 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
const validName = value => typeof value === 'string' && /^[A-Za-z_][\w./-]*$/.test(value)
function freeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value); Object.values(value).forEach(child => freeze(child, seen)); Object.freeze(value)
  }
  return value
}

function namesMatch(call, observation) {
  if (!own(observation, 'name')) return true
  if (observation.name === call.name) return true
  // The engine currently records the full rendered call in observation.name.
  // Validate that entire display expression; never execute it or use it to join IDs.
  if (typeof observation.name !== 'string' || !/^[A-Za-z_][\w./-]*\s*\(/.test(observation.name)) return false
  const parsed = parseStages(observation.name)
  return parsed.faults.length === 0 && parsed.stages.length === 1 && parsed.stages[0].length === 1 && parsed.stages[0][0].name === call.name
}

/**
 * A detached, frozen view of recorded tool evidence: {tools, unpaired}.
 * tools contains only unique calls. A result requires a unique matching callId
 * and compatible recorded name. Every ambiguous/orphan event remains inspectable
 * in unpaired; no position/name fallback or result-text success heuristic exists.
 * summary is the exact recorded value, including false, zero, null and ''. Use
 * hasResult (not truthiness) when deciding whether to display a recorded result.
 */
export function projectRunTools(details = {}) {
  const events = structuredClone(Array.isArray(details.toolEvents) ? details.toolEvents : [])
  const runId = details.id ?? null, agent = details.agent ?? null
  const runStatus = details.slot?.status ?? details.status
  const groups = new Map(), tools = [], unpaired = []
  function reject(entry, reason) {
    const event = entry.event
    unpaired.push({
      id: `unpaired:${entry.index}`, callId: validId(event?.callId) ? event.callId : null,
      runId, agent, kind: event?.kind ?? null, status: 'unresolved', reason,
      eventIndex: entry.index, sequence: event?.sequence ?? null, at: event?.at ?? null,
      hasResult: event?.kind === 'observation' && own(event, 'value'),
      summary: event?.kind === 'observation' ? event.value : undefined, raw: event,
    })
  }
  for (const [index, event] of events.entries()) {
    const entry = { index, event }
    if (!record(event)) { reject(entry, 'invalid_event'); continue }
    if (!['call', 'observation'].includes(event.kind)) { reject(entry, 'unsupported_event_kind'); continue }
    if (!validId(event.callId)) { reject(entry, 'missing_call_id'); continue }
    if (!groups.has(event.callId)) groups.set(event.callId, [])
    groups.get(event.callId).push(entry)
  }
  for (const [callId, entries] of groups) {
    const calls = entries.filter(entry => entry.event.kind === 'call')
    const observations = entries.filter(entry => entry.event.kind === 'observation')
    let reason
    if (calls.length > 1 || observations.length > 1) reason = 'duplicate_call_id'
    else if (!calls.length) reason = 'missing_call'
    else if (!validName(calls[0].event.name)) reason = 'invalid_tool_name'
    else if (entries.some(({ event }) => runId != null && (own(event, 'run') && event.run !== runId || own(event, 'runId') && event.runId !== runId))) reason = 'run_mismatch'
    else if (entries.some(({ event }) => agent != null && own(event, 'agent') && event.agent !== agent)) reason = 'agent_mismatch'
    else if (observations.length && !namesMatch(calls[0].event, observations[0].event)) reason = 'name_mismatch'
    if (reason) { entries.forEach(entry => reject(entry, reason)); continue }
    const call = calls[0].event, observation = observations[0]?.event ?? null
    const known = observation?.ok === true || observation?.ok === false
    const status = observation ? observation.ok === true ? 'done' : observation.ok === false ? observation.failureKind === 'invalid_input' ? 'rejected' : 'failed' : 'unresolved'
      : ACTIVE.has(runStatus) ? 'running' : ['interrupted', 'cancelled'].includes(runStatus) ? 'interrupted' : 'unresolved'
    tools.push({
      id: callId, callId, runId, agent, name: call.name, args: call.args,
      ...(typeof call.args?.path === 'string' ? { path: call.args.path } : {}),
      ...(typeof call.args?.command === 'string' ? { command: call.args.command } : {}),
      ...normalizeToolActivity(observation?.activity, { ok: observation?.ok }),
      status, summary: observation ? observation.value : undefined,
      hasResult: observation !== null && own(observation, 'value'), outcomeKnown: known,
      reason: !observation ? 'missing_outcome' : !known ? 'unknown_outcome' : null,
      callSequence: call.sequence ?? null, resultSequence: observation?.sequence ?? null,
      callEventIndex: calls[0].index, resultEventIndex: observations[0]?.index ?? null,
      startedAt: call.at ?? null, finishedAt: observation?.at ?? null, ms: observation?.ms ?? null,
      attemptId: call.attemptId ?? null, callText: call.value,
      raw: { call, observation },
    })
  }
  // Present calls in their recorded array order; the order never determines pairing.
  tools.sort((left, right) => left.callEventIndex - right.callEventIndex)
  unpaired.sort((left, right) => left.eventIndex - right.eventIndex)
  return freeze({ tools, unpaired })
}
