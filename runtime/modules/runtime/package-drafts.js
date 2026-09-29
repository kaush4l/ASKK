/** Browser-owned text folders. Invalid authored content is durable; only reviewed
 * snapshots pass to the existing package validator and installation compiler. */
import { draftLabel as labelOf, draftFiles as filesOf, encodeDraftBackup, decodeDraftBackup } from '../core/draft-backup.js'
import { snapshot } from '../core/prompt.js'

const KEY = 'package-drafts:v1'
const MAX_DRAFTS = 32
const MAX_BYTES = 64 * 1024 * 1024
// Multiple views/managers can share a store. Keep a save from overtaking a
// reviewed installation that is waiting for the installation manager's queue.
// Separate browser tabs are serialized by the hub's existing leader lease.
const queues = new WeakMap()
const encoder = new TextEncoder()
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key))
const bytesOf = record => record.files.reduce((sum, file) => sum + encoder.encode(file.content).length, 0)
function envelope(row) {
  if (row == null) return { version: 1, records: [] }
  const value = row.value
  if (!plain(row) || !plain(value) || !only(value, ['version', 'records']) || value.version !== 1 || !Array.isArray(value.records) || value.records.length > MAX_DRAFTS) fail('DRAFT_STORAGE', 'Saved package drafts have an unsupported structure; they were preserved.')
  const ids = new Set()
  for (const record of value.records) {
    if (!plain(record) || !only(record, ['id', 'label', 'files', 'version', 'createdAt', 'updatedAt']) || typeof record.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(record.id) || ids.has(record.id) || !Number.isSafeInteger(record.version) || record.version < 1 || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) fail('DRAFT_STORAGE', 'Saved package draft metadata is invalid; it was preserved.')
    ids.add(record.id); labelOf(record.label); filesOf(record.files)
  }
  if (value.records.reduce((sum, record) => sum + bytesOf(record), 0) > MAX_BYTES) fail('DRAFT_STORAGE', 'Saved package drafts exceed the storage limit; they were preserved.')
  return value
}
const locate = (saved, id) => {
  const record = saved.records.find(row => row.id === id)
  if (!record) fail('DRAFT_MISSING', 'This package draft no longer exists.')
  return record
}

export class PackageDrafts {
  constructor(hub) { this.hub = hub; this.reviews = new Map() }
  ordered(work) { const pending = (queues.get(this.hub.store) ?? Promise.resolve()).catch(() => {}).then(work); queues.set(this.hub.store, pending); return pending }
  admit(guard) { this.hub.packages.admit(guard) }
  async list() {
    const saved = envelope(await this.hub.store.get('settings', KEY))
    return snapshot(saved.records.map(({ files, ...record }) => ({ ...record, fileCount: files.length, bytes: bytesOf({ files }) })))
  }
  async read(id) { return snapshot(locate(envelope(await this.hub.store.get('settings', KEY)), id)) }
  async exportBackup(id, { expectedVersion } = {}) {
    return this.ordered(async () => {
      const draft = await this.read(id)
      if (draft.version !== expectedVersion) fail('DRAFT_CONFLICT', 'This draft changed since it was opened. Reload the saved draft before exporting again.')
      return encodeDraftBackup(draft)
    })
  }
  async importBackup(text) { return this.create(decodeDraftBackup(text)) }
  async create({ label = 'Untitled agent', files = [] } = {}) {
    const record = { id: crypto.randomUUID(), label: labelOf(label), files: filesOf(files), version: 1, createdAt: Date.now(), updatedAt: Date.now() }
    return this.ordered(async () => {
      this.admit()
      await this.hub.store.update('settings', KEY, current => {
        this.admit()
        const saved = envelope(current)
        if (saved.records.length >= MAX_DRAFTS || saved.records.reduce((sum, row) => sum + bytesOf(row), 0) + bytesOf(record) > MAX_BYTES) fail('DRAFT_LIMIT', 'The browser draft limit is reached; existing work was preserved.')
        return { value: { key: KEY, value: { version: 1, records: [...saved.records, record] } } }
      })
      return snapshot(record)
    })
  }
  async save(id, { expectedVersion, label, files } = {}) {
    const changes = { ...(label === undefined ? {} : { label: labelOf(label) }), ...(files === undefined ? {} : { files: filesOf(files) }) }
    return this.ordered(async () => {
      this.admit()
      let updated
      await this.hub.store.update('settings', KEY, current => {
        this.admit()
        const saved = envelope(current), prior = locate(saved, id)
        if (prior.version !== expectedVersion) fail('DRAFT_CONFLICT', 'This draft changed since it was opened. Reload the saved draft before saving again.')
        if (prior.version === Number.MAX_SAFE_INTEGER) fail('DRAFT_LIMIT', 'This draft reached its revision limit; copy its files into a new draft.')
        updated = { ...prior, ...changes, version: prior.version + 1, updatedAt: Date.now() }
        const records = saved.records.map(row => row.id === id ? updated : row)
        if (records.reduce((sum, row) => sum + bytesOf(row), 0) > MAX_BYTES) fail('DRAFT_LIMIT', 'The browser draft limit is reached; existing work was preserved.')
        return { value: { key: KEY, value: { version: 1, records } } }
      })
      for (const [stageId, review] of this.reviews) if (review.id === id) this.reviews.delete(stageId)
      return snapshot(updated)
    })
  }
  async preview(id) {
    return this.ordered(async () => {
      this.admit()
      const draft = await this.read(id)
      const preview = await this.hub.packages.preview(draft.files)
      this.admit()
      // The installation manager bounds and expires its stages; mirror that bound.
      for (const stageId of this.reviews.keys()) if (!this.hub.packages.stages.has(stageId)) this.reviews.delete(stageId)
      this.reviews.set(preview.stageId, { id, version: draft.version })
      return snapshot({ ...preview, draftId: id, draftVersion: draft.version })
    })
  }
  async install(id, { expectedVersion, stageId, ...choices } = {}) {
    const selected = { ...snapshot({ leadAgentId: choices.leadAgentId, models: choices.models, tools: choices.tools }), admissionGuard: choices.admissionGuard }
    return this.ordered(async () => {
      this.admit(selected.admissionGuard)
      const draft = await this.read(id), review = this.reviews.get(stageId)
      if (draft.version !== expectedVersion || review?.id !== id || review.version !== expectedVersion) fail('DRAFT_CONFLICT', 'The draft changed or its review expired. Validate and review the saved draft again before installing.')
      const result = await this.hub.packages.install(stageId, selected)
      this.reviews.delete(stageId)
      return result
    })
  }
}
