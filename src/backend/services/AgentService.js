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

  /**
   * Work handed to another agent that outlived the turn that asked for it.
   *
   * The same records `check_task` reads, offered to the page for a different
   * reason: the model needs the answer, and a person needs to know something is
   * running at all. A rail that said nothing about it would leave a background
   * question indistinguishable from one that was never asked.
   */
  async tasks() {
    return Outcome.ok(this.pool?.tasks?.() ?? [])
  }

  /**
   * End one handed-over task, and the thread carrying it.
   *
   * The page can already stop the turn it is waiting on — `Kernel.cancel`
   * aborts the request it holds. This is the other half, and it was missing:
   * work handed to a sub-agent outlives the turn that asked for it, so there
   * was no request left to abort and nothing anywhere could end it. A run that
   * cannot be ended is a run whose only exit is closing the tab.
   *
   * The boolean is whether anything was stopped. Pressing stop as the answer
   * arrives is the ordinary way to miss, and that is not an error.
   */
  async stop({ id } = {}) {
    return Outcome.ok(this.pool?.stop?.(id) ?? false)
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
