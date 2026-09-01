import { DEFAULT_LOOP, ENGINES } from '../engine/index.js'
import { parseMcpServers } from '../mcp/McpConfig.js'
import { Outcome } from '../Outcome.js'
import { RESPONSE_MODELS } from '../response/index.js'

/**
 * One agent's declared configuration, normalised.
 *
 * The agent file is the only source of an agent's instructions — nothing in
 * this tree hardcodes a system message. What the file does not say is filled
 * from these defaults, and anything it says that cannot be honoured is
 * corrected with a note, never refused: an agent file with one bad line should
 * lose that line, not the whole agent.
 *
 * Takes an already-parsed record rather than file text. Frontmatter is YAML,
 * and parsing YAML is done once at build time by `scripts/agents.js` — the
 * browser receives structured data and never carries a parser it would only use
 * for files that are fixed at build time anyway.
 */
export const AGENT_DEFAULTS = Object.freeze({
  name: 'agent',
  description: '',
  engine: DEFAULT_LOOP,
  response: 'react',
  // 128k. An agent that has read anything at all needs room to reason about it,
  // and a low default silently truncates long work instead of failing loudly.
  maxTokens: 131072,
  temperature: null,
  // Null, not false, and not true: null means "this agent has no opinion, use
  // the app-wide setting", which is the shape `temperature` already uses. A
  // boolean here would silently override settings for every agent file that
  // never mentioned the word.
  thinking: null,
  model: '',
  tools: [],
  // MCP servers, as McpServerConfig records read from this agent's own file.
  // Empty because a server is something an agent is given, never something it
  // has by default.
  mcp: [],
  // Empty means the default arrangement. A file lists block ids only when this
  // agent wants a different prompt shape — see `PromptTemplate` for what the
  // default is and why.
  prompt: [],
})

/** Frontmatter is written in snake_case; the code is camelCase. */
const ALIASES = {
  prompt_order: 'prompt',
  blocks: 'prompt',
  max_tokens: 'maxTokens',
  enable_thinking: 'thinking',
  max_steps: 'maxSteps',
  response_model: 'response',
  loop: 'engine',
}

/**
 * Settings that no longer exist, named so a file still carrying one is told.
 *
 * Silently ignoring a line someone wrote would leave them believing a limit is
 * in force that is not.
 *
 * `max_steps` used to be listed here. It is not any more — see below, where it
 * becomes the step line of a budget. What was retired was the hidden ceiling,
 * not the number: an author who wrote `max_steps: 8` was stating a term, and
 * the honest answer is to honour it and tell the agent, rather than to discard
 * it because the mechanism underneath it changed.
 */
const RETIRED = {
  repeat_limit: 'a repeated call is reported to the agent, not counted against it',
  format:
    'the contract is written in TOON only; a JSON reply is still read as a repair, not as a form a file may ask for',
}

/**
 * A budget limit, or null with a note saying why not.
 *
 * NOT `positiveIntOrNull`, and the difference is the whole reason this exists.
 * That one uses `Number.parseInt`, which reads a number off the FRONT of a
 * string and discards the rest — so `tokens: "250k"` became a 250-token budget
 * that closed after the first turn, `seconds: "10m"` became ten seconds, and
 * `"2.5e5"` became 2. Every one of them silently, with no note, on a line the
 * author wrote believing it said something else.
 *
 * `Number` refuses all four: it is the whole string or nothing. That is the
 * right strictness HERE and not for `max_tokens`, because a budget that is
 * quietly a thousandth of what was asked for does not fail — it just ends good
 * runs early and looks like the model giving up.
 */
function budgetLimit(value, field, notes) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    notes.push(`${field} ${JSON.stringify(value)} is not a positive number; ignored`)
    return null
  }
  return Math.floor(parsed)
}

function positiveIntOrNull(value, field, notes) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    notes.push(`${field} ${JSON.stringify(value)} is not a positive number; ignored`)
    return null
  }
  return parsed
}

export class AgentSpec {
  constructor(values) {
    Object.assign(this, values)
  }

  /**
   * Build a spec from an agent file's metadata and body.
   *
   * @returns {Outcome} value is an AgentSpec; notes record every correction.
   */
  static of({ metadata = {}, body = '', source = '<unknown>' } = {}) {
    const notes = []
    const raw = {}
    for (const [key, value] of Object.entries(metadata)) {
      if (Object.hasOwn(RETIRED, key)) {
        notes.push(`${source}: ${key} no longer does anything — ${RETIRED[key]}`)
        continue
      }
      raw[ALIASES[key] ?? key] = value
    }

    const name = String(raw.name ?? '').trim() || AGENT_DEFAULTS.name
    if (!raw.name) notes.push(`${source}: no name declared; called ${name}`)

    let engine = String(raw.engine ?? AGENT_DEFAULTS.engine)
    if (!ENGINES[engine]) {
      notes.push(
        `${source}: engine ${JSON.stringify(engine)} is not available; used ${DEFAULT_LOOP}`,
      )
      engine = DEFAULT_LOOP
    }

    let response = String(raw.response ?? AGENT_DEFAULTS.response)
    if (!RESPONSE_MODELS[response]) {
      notes.push(`${source}: response ${JSON.stringify(response)} is not available; used react`)
      response = 'react'
    }

    // Only an override is ever written in a file. Everything absent takes the
    // default, so an agent file says what is different about this agent and
    // nothing else.
    const maxTokens =
      positiveIntOrNull(raw.maxTokens, `${source}: max_tokens`, notes) ?? AGENT_DEFAULTS.maxTokens

    // The prompt arrangement is validated by the template, not here: the list
    // of block ids is the template's vocabulary, and duplicating it in this
    // file would be a second place for it to go stale.
    const prompt = Array.isArray(raw.prompt)
      ? raw.prompt.map((id) => String(id).trim()).filter(Boolean)
      : raw.prompt
        ? [String(raw.prompt).trim()]
        : []

    // Three optional numbers, and every one of them separately optional: a file
    // declaring `steps` alone is stating the one term it cares about and takes
    // `Budget`'s defaults for the other two. A key that is present but not a
    // limit costs that key and leaves a note, like every other bad line here.
    const terms =
      raw.budget && typeof raw.budget === 'object' && !Array.isArray(raw.budget) ? raw.budget : {}
    if (raw.budget !== undefined && terms !== raw.budget) {
      notes.push(`${source}: budget ${JSON.stringify(raw.budget)} is not a set of limits; ignored`)
    }
    const budget = {}
    const currencies = ['steps', 'tokens', 'seconds']
    for (const field of currencies) {
      const value = budgetLimit(terms[field], `${source}: budget.${field}`, notes)
      if (value !== null) budget[field] = value
    }
    // The comment above promised this and the code did not do it: a key that is
    // not one of the three was dropped in silence, so `budget: {minutes: 5}`
    // produced no budget and no note and left an author certain they had set
    // one. Named rather than counted, because the useful half of the sentence
    // is which word was wrong.
    for (const field of Object.keys(terms)) {
      if (!currencies.includes(field)) {
        notes.push(`${source}: budget.${field} is not a limit this loop spends; ignored`)
      }
    }
    const legacySteps = positiveIntOrNull(raw.maxSteps, `${source}: max_steps`, notes)
    if (legacySteps !== null && budget.steps === undefined) {
      budget.steps = legacySteps
      // Said out loud because the word means something different now. It used
      // to stop the loop without telling the agent; it is now a line the agent
      // reads in its prompt every turn, and the turn it runs out on is spent
      // answering rather than being cut off.
      notes.push(
        `${source}: max_steps is this agent's budget.steps now — the agent is told the number, not stopped at it`,
      )
    }

    // MCP servers are records, not names: the command, its arguments and the
    // tools this agent is allowed to see are all part of what this agent is.
    const declared = Array.isArray(raw.mcp) ? raw.mcp : raw.mcp ? [raw.mcp] : []
    const { servers: mcp, notes: mcpNotes } = parseMcpServers(declared, source)
    notes.push(...mcpNotes)

    const tools = Array.isArray(raw.tools)
      ? raw.tools.map((t) => String(t).trim()).filter(Boolean)
      : raw.tools
        ? [String(raw.tools).trim()]
        : []

    // Three states, and the third is the point: absent means the app-wide
    // setting decides. Anything written that is not a boolean is corrected with
    // a note, like every other bad line here — `thinking: "no"` must not become
    // true because a non-empty string is truthy.
    let thinking = null
    if (raw.thinking !== undefined && raw.thinking !== null && raw.thinking !== '') {
      const written = String(raw.thinking).trim().toLowerCase()
      if (typeof raw.thinking === 'boolean' || written === 'true' || written === 'false') {
        thinking = written === 'true'
      } else {
        notes.push(
          `${source}: thinking ${JSON.stringify(raw.thinking)} is not true or false; ignored`,
        )
      }
    }

    let temperature = null
    if (raw.temperature !== undefined && raw.temperature !== null && raw.temperature !== '') {
      const parsed = Number(raw.temperature)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
        notes.push(
          `${source}: temperature ${JSON.stringify(raw.temperature)} is out of range; ignored`,
        )
      } else {
        temperature = parsed
      }
    }

    // The body IS the system message. An empty one is allowed and means the
    // agent brings only its response contract — an odd agent, but a legitimate
    // one, and not something to substitute an invented instruction for.
    const system = String(body ?? '').trim()
    if (!system) notes.push(`${source}: the file has no body, so this agent has no instructions`)

    return Outcome.ok(
      new AgentSpec({
        name,
        description: String(raw.description ?? '').trim(),
        engine,
        response,
        temperature,
        thinking,
        maxTokens,
        tools,
        mcp,
        prompt,
        budget,
        model: String(raw.model ?? '').trim(),
        system,
        source,
      }),
      notes,
    )
  }
}
