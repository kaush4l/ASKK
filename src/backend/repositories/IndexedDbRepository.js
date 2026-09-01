import { Outcome } from '../../core/Outcome.js'
import { Repository } from './Repository.js'

/**
 * The IndexedDB adapter for the persistence port.
 *
 * Stores plain records, never class instances: structured-clone drops the
 * prototype, so an entity written directly would come back as a bare object
 * with none of its methods. Rehydration is the caller's job, which is why this
 * class takes and returns JSON.
 */
export class IndexedDbRepository extends Repository {
  constructor(entityName, db, storeName) {
    super(entityName)
    this.db = db
    this.storeName = storeName
  }

  async get(id) {
    const found = await this.db.get(this.storeName, id)
    return found.ok ? Outcome.ok(found.value ?? null) : found
  }

  async list() {
    const found = await this.db.getAll(this.storeName)
    return found.ok ? Outcome.ok(found.value ?? []) : found
  }

  async put(record) {
    const written = await this.db.put(this.storeName, record)
    return written.ok ? Outcome.ok(record) : written
  }

  async remove(id) {
    const existing = await this.db.get(this.storeName, id)
    if (!existing.ok) return existing
    if (!existing.value) return Outcome.ok(false)

    const deleted = await this.db.delete(this.storeName, id)
    return deleted.ok ? Outcome.ok(true) : deleted
  }
}
