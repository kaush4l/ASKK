/** The agent as prompt input — the standing furniture of every prompt, the
 * facts about right now, and whatever rides alongside the text.
 *
 * Split out of `agent.js` for the 200-line rule. The seam is real: everything
 * here answers "what goes into the call", and nothing here decides what to do
 * with what comes back.
 */

import { DEFAULT_COMPONENTS } from "./agent-config.js"
import { getComponent } from "./component-registry.js"
import { Multimodality } from "./inference.js"
import { loaded } from "./skills.js"

/** @typedef {import("./agent.js").Agent} Agent */
/** @typedef {import("./component-base.js").Component} Component */
/** @typedef {import("./component-base.js").ComponentInit} ComponentInit */
/** @typedef {import("./skills.js").Skill} Skill */

/** `%Y-%m-%d %H:%M:%S %Z` and `%A`. The zone travels with the clock because
 * `%Z` is an abbreviation — `PDT` — and a Date alone cannot render one.
 * @param {Date} now @param {string} zone @returns {Record<string, string>} */
function clockFacts(now, zone) {
  /** @type {Record<string, string>} */
  const at = {}
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
  })
  for (const part of format.formatToParts(now)) at[part.type] = part.value
  return {
    "current time": `${at.year}-${at.month}-${at.day} ${at.hour}:${at.minute}:${at.second} ${at.timeZoneName}`,
    day: at.weekday,
  }
}

/**
 * Facts about right now — the one part of the prompt that must never be cached,
 * and the one place a wrong answer breaks every golden prompt. The clock comes
 * from the ports because a core that read the host's could not be compared
 * against a recording at all.
 * @param {Agent} agent @returns {Record<string, string>}
 */
export function contextFacts(agent) {
  const facts = clockFacts(agent.ports.clock.now(), agent.ports.clock.zone())
  return { ...facts, ...(agent.space ? agent.space.context() : {}) }
}

/**
 * Per-name constructor arguments. A registered name with no entry here is built
 * with none — which is exactly what lets a component this file knows nothing
 * about be named from an agent.md.
 * @param {Agent} agent @returns {Record<string, () => Record<string, unknown>>}
 */
function componentArgs(agent) {
  return {
    soul: () => ({ text: agent.soul }),
    system: () => ({ text: agent.system }),
    // `agent.context()`, not `contextFacts(agent)`: the method is the seam a
    // test replaces to pin the clock, exactly as the Python's did.
    context: () => ({ facts: agent.context() }),
    // Built by the modules that own the bytes rather than formatted here: the
    // `### SKILL:` heading and the tool usage lines are text the model reads,
    // and there may be only one place that writes each of them.
    loaded_skills: () => ({ bodies: loaded(/** @type {Skill[]} */ (agent.session.skills)).bodies }),
    history: () => ({ lines: agent.transcript.component().lines }),
    tools: () => ({ usages: agent.toolbox.component().usages }),
  }
}

/**
 * The standing furniture of every prompt, honouring a declared `components` list.
 *
 * The Python matched each name against six string literals in a `match/case`,
 * which meant four already-registered components could never be named from a
 * config and a newly registered one still could not — its architecture doc's
 * finding F-2. The registry is the only authority on what a name means, so it is
 * what gets asked. An unknown name stays a warning rather than a throw: a typo
 * in a hand-edited agent.md should cost that one block, not the agent.
 *
 * @param {Agent} agent @param {boolean} [tools] @returns {Component[]}
 */
export function baseComponents(agent, tools = true) {
  const wanted = agent.components ?? DEFAULT_COMPONENTS
  const sources = componentArgs(agent)
  /** @type {Component[]} */
  const built = []
  for (const name of wanted) {
    if (name === "tools" && !tools) continue
    /** @type {typeof import("./component-base.js").Component} */
    let Part
    try {
      Part = getComponent(name)
    } catch {
      agent.log.warning(`${agent.name}: unknown base component '${name}' skipped`)
      continue
    }
    const source = sources[name]
    built.push(new Part(/** @type {ComponentInit} */ (source ? source() : {})))
  }
  return built
}

/**
 * Run every modality provider and return what they produced — fresh each call,
 * never stored. A provider that fails costs its own attachment and nothing else.
 * @param {Agent} agent @returns {Promise<Multimodality[]>}
 */
export async function collectModalities(agent) {
  /** @type {Multimodality[]} */
  const collected = []
  for (const provider of agent.modalities) {
    const result = await provider.call({})
    if (!result.ok) {
      agent.log.warning(`${agent.name}: modality provider ${provider.name} failed: ${result.error}`)
      continue
    }
    for (const line of String(result.output).split(/\r?\n/)) {
      const item = Multimodality.of(line.trim())
      if (item) collected.push(item)
    }
  }
  if (collected.length) agent.log.info(`${agent.name}: attaching ${collected.length} item(s) to this call`)
  return collected
}
