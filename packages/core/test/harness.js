/**
 * ONE BUILD, ASSEMBLED THE WAY A TEST NEEDS IT, in one place: the skeleton and
 * the delegation tests read the same product and must not each invent their own
 * — two harnesses is two definitions of what "the build" is.
 */
import { CAPABILITIES, get, withHeader } from '@harness/kernel'
import { newAgentState, tool } from '@harness/agent'
import { fakeAgents, fakeClock, testPorts } from '@harness/adapters-test'
import { bootFresh, handle } from '@harness/core'
import { memorySegments, manualTimer } from './doubles.js'

/** One scripted turn, read off the door it arrives through — the barrel exports `testPorts` and not the type. @typedef {NonNullable<Parameters<typeof testPorts>[0]>['script']} Scripts */
/** @typedef {import('@harness/core').Row} Row */

/**
 * THE CARD EVERY BUILD IS ASSEMBLED AGAINST. It is here and not per-test
 * because the budget is derived from the window and nothing in these tests is
 * about the window — but it is not OPTIONAL either: an agent with no card ends
 * every turn before the model call, which is the production defect these tests
 * exist downstream of.
 * @type {import('@harness/context').ModelCard}
 */
const CARD = {
  name: 'scripted', model: 'scripted', kind: 'openai', contextTokens: 128_000,
  maxOutputTokens: null, acceptsImages: false, reasons: false,
}

/**
 * One build: scripted model, a tool table, and a deadline the test fires. The
 * agent's TOOLBOX is the descriptors it may call and `tools` is what runs them
 * — both are handed in here because the spec reader has not landed.
 * `me` and `segments` are handed in by the errand suite and nowhere else: a
 * sub-agent is the same build under a different NAME, and its conversation
 * surviving a reload is two boots over ONE store.
 * @param {{script?: Scripts, tools?: Record<string, import('@harness/core').ToolRun>,
 *   agents?: Parameters<typeof fakeAgents>[0], auto?: boolean, me?: string,
 *   segments?: ReturnType<typeof memorySegments>}} [parts]
 */
export function harness(parts = {}) {
  const clock = fakeClock({ start: 1_000, step: 1 })
  const ports = testPorts({ clock, script: parts.script ?? [], agents: fakeAgents(parts.agents ?? {}) })
  const segments = parts.segments ?? memorySegments()
  const toolbox = Object.keys(parts.tools ?? {}).map((name) => tool({ name, description: `the ${name} tool` }))
  const agent = { ...newAgentState(), toolbox, card: CARD }
  const app = bootFresh({ ports, available: [...CAPABILITIES], segments, tools: parts.tools ?? {}, agent, me: parts.me })
  return { app, ports, segments, clock, timer: manualTimer({ auto: parts.auto }) }
}

/** @param {import('@harness/core').App} app @param {string} [who] @returns {Row[]} */
export function rows(app, who) {
  const req = who ? withHeader(get('/chat'), 'x-agent', who) : get('/chat')
  return /** @type {Row[]} */ (handle(app, req).data.messages)
}

/** Turn the event loop over until `ready` — how a test fires a deadline the driver has reached. */
export async function until(/** @type {() => boolean} */ ready) {
  for (let i = 0; i < 100 && !ready(); i++) await new Promise((r) => setTimeout(r, 0))
  if (!ready()) throw new Error('the driver never reached the point this test waited for')
}
