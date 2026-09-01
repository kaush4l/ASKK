import { Outcome, Reason } from '../Outcome.js'
import { parseAgentFile } from './AgentFile.js'
import { AgentSpec } from './AgentSpec.js'

/**
 * The agent folder, read over HTTP from `public/agents/`.
 *
 * A directory cannot be listed over HTTP, so the build writes `index.json`
 * beside the folders and that is the roster. Files are fetched once and kept —
 * an agent file does not change while the page is open, and a sub-agent call
 * must not pay for a round trip to learn who it is.
 */
export const AGENTS_PATH = 'agents'

export class AgentCatalogue {
  /**
   * @param {string} baseUrl where the app is served from, e.g. `/ASKK`. Built
   *   from an inlined constant rather than the router, because this runs in a
   *   worker, which has neither a router nor a document to resolve against.
   */
  constructor(baseUrl = '') {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this._roster = null
    this._specs = new Map()
  }

  _url(...parts) {
    return [this.baseUrl, AGENTS_PATH, ...parts].filter(Boolean).join('/')
  }

  async _fetchText(url, what) {
    const got = await Outcome.attempt(async () => {
      const response = await fetch(url, { cache: 'no-cache' })
      if (!response.ok) {
        return Promise.reject(new Error(`HTTP ${response.status}`))
      }
      return response.text()
    })
    return got.ok
      ? got
      : Outcome.failed(Reason.UNAVAILABLE, `could not read ${what}: ${got.failure.message}`, {
          hint: `Expected it at ${url}.`,
        })
  }

  /** @returns {Promise<Outcome>} value is an array of agent names */
  async names() {
    if (this._roster) return Outcome.ok(this._roster)

    const read = await this._fetchText(this._url('index.json'), 'the agent roster')
    if (!read.ok) return read

    const parsed = await Outcome.attempt(() => JSON.parse(read.value))
    if (!parsed.ok) {
      return Outcome.failed(Reason.UNAVAILABLE, 'the agent roster is not valid JSON')
    }
    const names = Array.isArray(parsed.value?.agents) ? parsed.value.agents : []
    this._roster = names
    return Outcome.ok(names)
  }

  /** @returns {Promise<Outcome>} value is an AgentSpec */
  async spec(name) {
    if (this._specs.has(name)) return Outcome.ok(this._specs.get(name))

    const source = `agents/${name}/agent.md`
    const read = await this._fetchText(this._url(name, 'agent.md'), `agent ${JSON.stringify(name)}`)
    if (!read.ok) return read

    const { metadata, body, notes } = parseAgentFile(read.value, source)
    const built = AgentSpec.of({ metadata: { name, ...metadata }, body, source })
    this._specs.set(name, built.value)
    return Outcome.ok(built.value, [...notes, ...built.notes])
  }

  /**
   * Every agent's spec. A file that cannot be read is left out with a note
   * rather than failing the roster — one broken agent must not hide the others.
   *
   * @returns {Promise<Outcome>} value is an array of AgentSpec
   */
  async all() {
    const roster = await this.names()
    if (!roster.ok) return roster

    const specs = []
    const notes = []
    for (const name of roster.value) {
      const loaded = await this.spec(name)
      notes.push(...loaded.notes)
      if (loaded.ok) specs.push(loaded.value)
      else notes.push(loaded.failure.message)
    }
    return Outcome.ok(specs, notes)
  }
}
