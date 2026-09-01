import { Outcome } from '../../core/Outcome.js'
import { Repository } from './Repository.js'

/**
 * An in-memory store, used when IndexedDB is unavailable.
 *
 * A browser in a private window, or one configured to block site data, refuses
 * to open a database. Losing the conversation on reload is a real cost, but it
 * is far smaller than an app that will not start — so persistence degrades and
 * says so, rather than being a precondition for chatting at all.
 */
export class MemoryRepository extends Repository {
  constructor(entityName) {
    super(entityName)
    this.rows = new Map()
  }

  async get(id) {
    return Outcome.ok(this.rows.get(id) ?? null)
  }

  async list() {
    return Outcome.ok([...this.rows.values()])
  }

  async put(record) {
    this.rows.set(record.id, record)
    return Outcome.ok(record)
  }

  async remove(id) {
    return Outcome.ok(this.rows.delete(id))
  }
}
