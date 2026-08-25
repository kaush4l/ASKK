/**
 * The agent: a pure step function and the data it walks. No I/O of any kind
 * lives in this package — the loop DESCRIBES effects and `core`'s driver runs
 * them (I3, I7).
 *
 * Increment 6 of eight: one prompt vocabulary and one retry ceiling — every
 * block the loop sends is now `@harness/context`'s, because this package's
 * second copy of the words had already drifted from it and still taught the
 * retired text-call protocol; three model calls per turn rather than four,
 * because `MAX_ATTEMPTS` counts calls and the comparison read it as retries;
 * and delegation as two messages, so a sub-agent is the same loop in its own
 * Worker and records its own ending rather than having one inferred for it.
 *
 * Increment 5 of eight: what the loop hands the model and what comes back — the
 * paper derived per call from this agent's state and this stage's grant, the
 * faculties that arrive in one piece (their tools AND their block), a failed
 * effect as a fact the reducer folds and retries with a backoff, and a turn
 * that survives a reload or ends saying it did not.
 *
 * Increment 4 of eight: the agent file and the stages it declares — our own
 * reader for the YAML subset the shipped files are written in (a build-time
 * parse cannot see a file a person authors in this browser), a stage as
 * `{brief, toolAllowlist, responseSchema}` with its words fetched rather than
 * compiled in, the one cheap call that chooses the rest of the turn, and a
 * per-tool availability predicate that fails safe to unavailable. The paper is
 * what follows.
 *
 * `step` is the only writer of an AgentState, so the sibling functions that
 * RETURN one — `land`, `openBatch`, `idle`, `endTurn`, `boundary` — are not
 * named here. They stay exported from their own modules for the loop and its
 * tests; advertising them to the rest of the build would hand a caller exactly
 * the out-of-band write the reducer exists to make impossible, which is how the
 * Rust cleared `agent.task` from two files that were not the loop.
 * @module
 */

export {
  newAgentState, serializeAgentState, restoreAgentState,
  DEFAULT_MAX_ROUNDS, DEFAULT_COMPACT_AT, DEFAULT_KEEP_RECENT, DEFAULT_PASSES,
} from './state.js'
export { EFFECT_TYPES, callModel, invokeTool, emit, delegate } from './effect.js'
export {
  NO_TOOLS, ALL_TOOLS, onlyTools, grant, WORK_BUDGET,
  BRIEF_KEYS, DURABLE, SKILL_TOOLS, actsIn, briefPath, loadBriefs, resolveStage,
} from './stages.js'
export { ENGINES, ROLES, readFrontmatter, unquote } from './frontmatter.js'
export { parseAgentFile, unwritten } from './spec.js'
export { loadAgents, roleHolder } from './roster.js'
export { adoptSpec, spaceNamed } from './adopt.js'
export {
  ANSWER, ROUTE, ROUTES, STRATEGY, STAGES_OF, STRATEGY_SCHEMA, WHY, labelled, routeChosen, routeOf, voteIn,
} from './strategy.js'
export { step } from './step.js'
export { askFor, askModel, stageNow } from './ask.js'
export { granted, paperFor } from './fill.js'
export { ARTIFACTS, FACULTIES, MEMORY, SPACE, facultyBlocks, facultyOf, facultyTools } from './faculty/index.js'
export { EFFECT_FAILED, MAX_ATTEMPTS, backoffMs, emptySignature, failureIn, isEmptyCompletion } from './retry.js'
export { CHECKPOINT_VERSION, checkpoint, resume } from './checkpoint.js'
export { arg, available, tool, readArgs, usage } from './tools.js'
export { NOTHING_RAN, check, named, peerTool, toolboxFor, usages } from './toolbox.js'
export { NATIVE, SCANNED, callsIn, scanCalls, swallowedClose } from './calls.js'
export { CALL_REFUSED } from './round.js'
export { CRITIC_FAULTED, FAULT, PASS, passed } from './critic.js'
export { PASS_CEILING, PASS_SPENT, again, exhausted, passOf } from './passes.js'
export { endingNow, openTurn, stageIn, walkOn } from './walk.js'
export { FINISH_REASONS, DROPPED, dropped } from './turn.js'
export {
  ENDED, ANSWERED, MALFORMED, ROUND_CEILING, TRUNCATED, REFUSED, FAILED, NO_CALLS, RESPOND,
  INTERRUPTED, STALLED, UNCHECKED, endingFor, endedWhy, endedRounds,
} from './ending.js'
export { STOP_REQUESTED, STOPPED, isStopRequest } from './stop.js'
export { STEERED, carried } from './steer.js'
export { ERRAND_PROTOCOL, beginMessage, endedMessage, readMessage } from './errand/protocol.js'
export { agentsOver } from './errand/caller.js'
export { errandBegun, errandHeard } from './errand/callee.js'

/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./state.js').Goal} Goal */
/** @typedef {import('./state.js').Standing} Standing */
/** @typedef {import('./state.js').Space} Space */
/** @typedef {import('./state.js').Paper} Paper */
/** @typedef {import('./effect.js').Effect} Effect */
/** @typedef {import('./effect.js').Document} Document */
/** @typedef {import('./tools.js').Tool} Tool */
/** @typedef {import('./tools.js').ToolArg} ToolArg */
/** @typedef {import('./calls.js').CallStyle} CallStyle */
/** @typedef {import('./round.js').Asked} Asked */
/** @typedef {import('./stages.js').ToolScope} ToolScope */
/** @typedef {import('./stages.js').Stage} Stage */
/** @typedef {import('./faculty/index.js').Faculty} Faculty */
/** @typedef {import('./faculty/index.js').Block} Block */
/** @typedef {import('./retry.js').Failure} Failure */
/** @typedef {import('./spec.js').AgentSpec} AgentSpec */
/** @typedef {import('./frontmatter.js').Refusal} Refusal */
/** @typedef {import('./strategy.js').Route} Route */
/** @typedef {import('./strategy.js').StageName} StageName */
/** @typedef {import('./toolbox.js').Resolved} Resolved */
/** @typedef {import('./step.js').Stepped} Stepped */
/** @typedef {import('./turn.js').Incoming} Incoming */
/** @typedef {import('./turn.js').Reply} Reply */
/** @typedef {import('./turn.js').ToolCall} ToolCall */
/** @typedef {import('./turn.js').FinishReason} FinishReason */
/** @typedef {import('./turn.js').Awaiting} Awaiting */
/** @typedef {import('./errand/protocol.js').ErrandMessage} ErrandMessage */
/** @typedef {import('./errand/protocol.js').Begin} Begin */
/** @typedef {import('./errand/protocol.js').Ended} Ended */
/** @typedef {import('./errand/caller.js').Channel} Channel */
/** @typedef {import('./errand/caller.js').Workers} Workers */
/** @typedef {import('./errand/callee.js').Errand} Errand */
