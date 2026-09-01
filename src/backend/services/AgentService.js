import { Outcome } from '../../core/Outcome.js'

/**
 * What agents exist and what each one declares.
 *
 * Read-only. Agent files live in `public/agents/` and are read by the running
 * app, so editing an agent means editing its file — which is the point: an
 * agent's behaviour lives in one place a person can read.
 */
export class AgentService {
  constructor(catalogue, pool) {
    this.catalogue = catalogue
    this.pool = pool
  }

  /**
   * The sub-agent threads that are actually running.
   *
   * A pool only records a thread it constructed, and `confirmedName` is what
   * the worker itself reported once alive — so this is evidence that delegation
   * happened on another thread, not an assumption that it did.
   */
  async threads() {
    return Outcome.ok(this.pool?.threads() ?? [])
  }

  async list() {
    const all = await this.catalogue.all()
    if (!all.ok) return all
    return Outcome.ok(
      all.value.map(({ name, description, tools }) => ({ name, description, tools })),
      all.notes,
    )
  }

  /** One agent's full declared configuration, including its instructions. */
  async get({ name }) {
    const loaded = await this.catalogue.spec(name)
    return loaded.ok ? Outcome.ok({ ...loaded.value }, loaded.notes) : loaded
  }
}
