/** The worker entry the registry tests spawn — one per agent, as in the page.
 *
 * A real entry file assembles the environment and hands `serve` the `loadAgent`
 * that uses it (increment 4.2 owns that loader). This one hands it a stand-in
 * small enough to assert against: the point under test is the wiring, not the
 * engine. What is real here is the `Toolbox` — a peer arrives as `{ name,
 * description, invoke }` and this file does nothing to it but pass it to
 * `addTools`, so if the duck type did not hold, `delegate` would fail.
 */

import { serve } from "../core/worker-host.js"
import { Toolbox } from "../core/tools.js"

/** A stand-in engine: it answers questions about how it was wired. */
class FakeAgent {
  /** @param {string} name @param {string} dir */
  constructor(name, dir) {
    this.name = name
    this.description = `agent ${name} from ${dir}`
    /** @type {any[]} */ this.tools = []
    this.toolbox = Toolbox.of()
    /** @type {{ role: string, content: string }[]} */ this.messages = []
    /** @type {any} */ this.summarizer = null
    /** @type {any} */ this.verifier = null
    /** @type {any} */ this.critic = null
  }

  /** @param {...any} items */
  addTools(...items) {
    this.tools.push(...items)
    this.toolbox = Toolbox.of(...this.tools)
  }

  /** @param {string} input @returns {Promise<any>} */
  async invoke(input) {
    this.messages.push({ role: "user", content: input })
    const answer = await this.answer(input)
    this.messages.push({ role: "assistant", content: String(answer) })
    return answer
  }

  /** @param {string} input @returns {Promise<any>} */
  async answer(input) {
    const [word, ...rest] = input.split(" ")
    if (word === "tools") return this.toolbox.names.join(",")
    if (word === "role") return this[/** @type {"summarizer"} */ (rest[0])]?.description ?? "none"
    if (word === "delegate") {
      const result = await this.toolbox.get(String(rest[0]))?.call({ query: rest.slice(1).join(" ") })
      return result?.ok ? result.output : `no such tool: ${rest[0]}`
    }
    return `${this.name} heard: ${input}`
  }

  async close() {
    this.messages.push({ role: "system", content: "closed" })
  }
}

serve(self, {
  loadAgent: async (name, dir) => {
    if (name === "broken") throw new Error("no engine for you")
    return new FakeAgent(name, dir)
  },
})
