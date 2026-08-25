/**
 * Host-side test doubles for every port. Imported ONLY by tests and by the
 * pure-core harness that proves I3 — nothing in a shipping path may reach here.
 * @module
 */

export { memoryKv, memoryBlob, memoryStore } from './stores.js'
export { fakeClock, fakeRng } from './time.js'
export { scriptedModel } from './model.js'
export { fakeNet, fakeAgents, fakeWorkspace } from './world.js'

import { memoryKv, memoryStore } from './stores.js'
import { fakeClock, fakeRng } from './time.js'
import { scriptedModel } from './model.js'
import { fakeNet, fakeAgents, fakeWorkspace } from './world.js'

/**
 * Every port at once, each overridable. The one call a test makes when it cares
 * about the turn and not about the substrate.
 * @param {Partial<import('@harness/kernel').Ports> & {script?: import('./model.js').Scripted[]}} [over]
 * @returns {import('@harness/kernel').Ports}
 */
export function testPorts(over = {}) {
  return {
    clock: over.clock ?? fakeClock(),
    rng: over.rng ?? fakeRng(),
    store: over.store ?? memoryStore(),
    model: over.model ?? scriptedModel(over.script ?? []),
    net: over.net ?? fakeNet(),
    agents: over.agents ?? fakeAgents(),
    workspace: over.workspace ?? fakeWorkspace(),
    spaces: over.spaces ?? memoryKv(),
  }
}
