/**
 * L0 leaf vocabulary. Ids, typed errors, the seam types, facts and the log,
 * capability grants, module manifests, and the port contracts. Imports nothing
 * from the workspace — every other package imports this and none of it back.
 * @module
 */

export { MODEL_ENDPOINT, SEARCH_ENDPOINT, ENTRY_AGENT, STAGES } from './ids.js'
export { STATUSES, isBusy, statusSentence } from './status.js'
export {
  HarnessError, StoreError, ModelError, NetError,
  DelegateError, WorkspaceError, CapabilityError, isLoopback,
} from './errors.js'
export { EVENT_VERSION, FACT_TYPES, EventLog, isKnownFact, factAgent } from './event.js'
export { get, post, withHeader, addressee, ok, problem, isProblem } from './seam.js'
export { CAPABILITIES, CAPABILITY_SENTENCE, grants, effectiveGrant } from './capability.js'
export { matchesRoute, readManifest } from './manifest.js'

/** @typedef {import('./ids.js').AgentId} AgentId */
/** @typedef {import('./ids.js').ModuleId} ModuleId */
/** @typedef {import('./ids.js').ToolId} ToolId */
/** @typedef {import('./ids.js').SectionId} SectionId */
/** @typedef {import('./ids.js').EndpointName} EndpointName */
/** @typedef {import('./ids.js').TurnId} TurnId */
/** @typedef {import('./ids.js').EventId} EventId */
/** @typedef {import('./ids.js').Timestamp} Timestamp */
/** @typedef {import('./ids.js').StageId} StageId */
/** @typedef {import('./status.js').Status} Status */
/** @typedef {import('./event.js').Fact} Fact */
/** @typedef {import('./event.js').Event} Event */
/** @typedef {import('./seam.js').Request} Request */
/** @typedef {import('./seam.js').Response} Response */
/** @typedef {import('./capability.js').CapabilityId} CapabilityId */
/** @typedef {import('./capability.js').CapabilityGrant} CapabilityGrant */
/** @typedef {import('./manifest.js').Manifest} Manifest */
/** @typedef {import('./manifest.js').Route} Route */
/** @typedef {import('./ports.js').ClockPort} ClockPort */
/** @typedef {import('./ports.js').RngPort} RngPort */
/** @typedef {import('./ports.js').KvStore} KvStore */
/** @typedef {import('./ports.js').BlobStore} BlobStore */
/** @typedef {import('./ports.js').StorePort} StorePort */
/** @typedef {import('./ports.js').ModelPort} ModelPort */
/** @typedef {import('./ports.js').ModelReply} ModelReply */
/** @typedef {import('./ports.js').FinishReason} FinishReason */
/** @typedef {import('./ports.js').Usage} Usage */
/** @typedef {import('./ports.js').NetPort} NetPort */
/** @typedef {import('./ports.js').BrokeredRequest} BrokeredRequest */
/** @typedef {import('./ports.js').BrokeredResponse} BrokeredResponse */
/** @typedef {import('./ports.js').AgentPort} AgentPort */
/** @typedef {import('./ports.js').WorkspacePort} WorkspacePort */
/** @typedef {import('./ports.js').Execution} Execution */
/** @typedef {import('./ports.js').Ports} Ports */
