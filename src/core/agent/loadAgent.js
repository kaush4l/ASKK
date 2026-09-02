import { createEngine } from '../engine/index.js'
import { Outcome } from '../Outcome.js'
import { PromptTemplate } from '../prompt/PromptTemplate.js'
import { getResponseModel } from '../response/index.js'
import { BUILTIN_TOOLS, SubAgentTool, Toolbox } from '../tools/index.js'
import { AgentSpec } from './AgentSpec.js'

/**
 * Build an agent from its spec.
 *
 * The engine that comes back is the agent: its instructions, loop, contract and
 * toolkit all came out of `agents/<name>/agent.md`. Nothing here supplies a
 * system message or attaches a tool the file did not ask for.
 */

/**
 * Resolve the names in a file's `tools:` list.
 *
 * A name is looked up as a built-in first, then as another agent. That order
 * matters only when the two collide, and a built-in losing its name to a
 * project's agent is the more surprising of the two outcomes.
 *
 * An unresolvable name costs that tool and nothing else — the agent still runs
 * with the rest, and the note says which one went missing.
 */
export function resolveTools({ names = [], peers = [], dispatch, services = {} } = {}) {
  const notes = []
  const tools = []
  const byName = new Map(peers.map((spec) => [spec.name, spec]))

  for (const name of names) {
    // `Object.hasOwn`, not a truthiness test: every object answers `toString`
    // and `constructor`, so a plain lookup would resolve a tool named after one
    // of them to something that is not a tool at all.
    if (Object.hasOwn(BUILTIN_TOOLS, name)) {
      // Built-ins are factories: the sandbox, and anything else a tool needs to
      // reach the world, exist only in the running app and are handed in here.
      tools.push(BUILTIN_TOOLS[name](services))
      continue
    }
    const peer = byName.get(name)
    if (peer && dispatch) {
      // The agent file's own name and description become the tool's name and
      // description — the calling model is told what this agent is for in the
      // words its author wrote.
      tools.push(new SubAgentTool({ spec: peer, dispatch }))
      continue
    }
    notes.push(
      peer
        ? `tool ${JSON.stringify(name)} is an agent, but no way to reach it was provided`
        : `tool ${JSON.stringify(name)} was not found; it is neither a built-in nor an agent`,
    )
  }
  return Outcome.ok(tools, notes)
}

/**
 * No `overrides` bag. It spread last over the engine's arguments, so anything
 * could reach the engine past this signature — which is how `soul` stayed
 * arguable for four waves while no caller ever passed it.
 *
 * @param {{spec: AgentSpec, inference: object, peers?: AgentSpec[],
 *   dispatch?: Function, tools?: object[], context?: Array<[string, string]>}} options
 * @returns {Outcome} value is an Engine configured from the agent file
 */
export function buildAgent({
  spec,
  inference,
  peers = [],
  dispatch,
  tools,
  extraTools = [],
  context = [],
  services = {},
} = {}) {
  const resolved = tools
    ? Outcome.ok(tools)
    : resolveTools({ names: spec.tools, peers, dispatch, services })

  // An agent file may state its own prompt arrangement. Most do not, and take
  // the default — which is the point of a default.
  const arranged = PromptTemplate.of(spec.prompt, { source: spec.source ?? spec.name })

  const built = createEngine({
    loop: spec.engine,
    name: spec.name,
    system: spec.system,
    responseModel: getResponseModel(spec.response),
    // Tools discovered at runtime — an MCP server's, which cannot be known
    // until the server has been asked — join the ones the file named.
    toolbox: new Toolbox([...resolved.value, ...extraTools]),
    // The agent's own check, off its own file. A loop runs it; nothing here
    // judges it — see `ReActEngine.run`.
    check: spec.check,
    // The caller supplies the facts, because they are facts about the caller's
    // realm — what is stored, which model was chosen — and an agent file cannot
    // know them.
    context,
    template: arranged.template,
    inference,
  })
  return Outcome.ok(built.value, [...resolved.notes, ...arranged.notes, ...built.notes])
}

export { AgentSpec }
