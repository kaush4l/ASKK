import { openStore } from '../runtime/store.js'

const JOURNAL = 'workspace-pending-files-v1'
const CACHE = '_workspaceCheckpoint'
const journalOf = row => {
  const value = row?.value ?? { version: 1, revision: 0, entries: {} }
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('The saved workspace journal has an unsupported format. Its contents were preserved.')
  return value
}
const revisionOf = file => file?.rev ?? file?.revision ?? 0
const sameRevision = (a, b) => String(a) === String(b)
const entryAt = (journal, path) => Object.hasOwn(journal.entries, path) ? journal.entries[path] : undefined
const visible = file => { if (!file) return null; const { [CACHE]: cached, ...record } = file; return { ...record, rev: revisionOf(file) } }
const nextRevision = value => Number.isSafeInteger(value) ? value + 1 : `offline:${crypto.randomUUID()}`
const baseOf = file => file ? { kind: file[CACHE] === 1 ? 'known' : 'legacy', rev: revisionOf(file), content: file.content } : { kind: 'absent', rev: 0 }
const desiredMatches = (entry, current) => entry.value === null ? !current : !!current && current.content === entry.value.content

export function cleanPath(input) {
  const path = String(input ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!path || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '' || part === '.') || path.includes('\0')) throw new Error('Choose a relative file path inside this project')
  return path
}

function mountConflict(conflicts, cause) {
  return Object.assign(new Error(`Saved offline changes conflict with runtime files: ${conflicts.map(row => row.path).join(', ')}. Your saved browser copies are preserved; resolve these files before mounting the runtime.`, cause ? { cause } : undefined), { code: 'WORKSPACE_MOUNT_CONFLICT', conflicts })
}

/** Clean checkpoints are cache. Offline acknowledgements remain in a durable CAS journal until a backend confirms their desired state. */
export class ProjectFiles {
  constructor({ name = 'askk-workspace', onCommit = () => {} } = {}) { this.name = name; this.onCommit = onCommit; this.backend = null; this.chain = Promise.resolve() }
  async start() { this.store = await openStore(this.name); return this }
  queued(operation) { const result = this.chain.then(operation); this.chain = result.catch(() => {}); return result }
  requireDurable() { if (!this.store.durable) throw new Error('Browser storage is unavailable. This draft has not been saved durably.') }
  async journal() { return journalOf(await this.store.get('settings', JOURNAL)) }
  async stageLegacy() {
    const legacy = (await this.store.all('files')).filter(file => file[CACHE] !== 1)
    if (!legacy.length) return
    await this.store.update('settings', JOURNAL, row => {
      const journal = journalOf(row); const entries = { ...journal.entries }; let changed = false
      for (const file of legacy) if (!Object.hasOwn(entries, file.path)) { entries[file.path] = { base: baseOf(file), value: visible(file), localRev: revisionOf(file) }; changed = true }
      return changed ? { value: { key: JOURNAL, value: { version: 1, revision: journal.revision + 1, entries } } } : {}
    })
  }
  async staged() {
    const [cached, journal] = await Promise.all([this.store.all('files'), this.journal()])
    const files = new Map(cached.map(file => [file.path, visible(file)]))
    for (const [path, entry] of Object.entries(journal.entries)) entry.value === null ? files.delete(path) : files.set(path, visible(entry.value))
    return { cached, journal, files }
  }
  pending(cached, journal) {
    const entries = { ...journal.entries }
    // Legacy rows might be saved edits. Never discard them on an ambiguous mount.
    for (const file of cached) if (file[CACHE] !== 1 && !Object.hasOwn(entries, file.path)) entries[file.path] = { base: baseOf(file), value: visible(file), localRev: revisionOf(file) }
    return entries
  }
  async list() {
    const rows = this.backend ? (await this.backend.list('')).map(row => ({ ...row, rev: revisionOf(row) })) : [...(await this.staged()).files.values()].map(({ path, content, rev }) => ({ path, size: new TextEncoder().encode(content).length, rev }))
    return rows.sort((a, b) => a.path.localeCompare(b.path))
  }
  async read(path) {
    path = cleanPath(path)
    if (this.backend) return visible(await this.backend.read(path))
    const journal = await this.journal()
    return Object.hasOwn(journal.entries, path) ? visible(journal.entries[path].value) : visible(await this.store.get('files', path))
  }
  async cache(file) { if (file) await this.store.put('files', { ...visible(file), [CACHE]: 1 }) }
  save({ path, content, expect }) {
    return this.queued(async () => {
      path = cleanPath(path); content = String(content)
      if (this.backend) {
        const current = await this.read(path)
        if (expect != null && !sameRevision(expect, revisionOf(current))) return { conflict: true, rev: revisionOf(current), current }
        const result = await this.backend.write({ path, content, expectedRevision: expect ?? revisionOf(current) })
        if (result.conflict) return result
        const writtenRevision = result.rev ?? result.revision
        // The write receipt owns this acknowledgement. A later read may observe an
        // unrelated writer and must never advance the editor's CAS base to its revision.
        this.onCommit({ type: 'workspace.committed', operation: 'write', path, content, rev: writtenRevision })
        if (writtenRevision == null || result.content !== undefined && result.content !== content) throw new Error('The runtime returned an invalid acknowledgement for the written content')
        const file = await this.read(path)
        if (!file || file.content !== content || !sameRevision(file.rev, writtenRevision)) return { conflict: true, committed: true, writtenRevision, rev: revisionOf(file), current: file }
        await this.cache(file); return { ok: true, rev: writtenRevision }
      }
      this.requireDurable()
      const cached = await this.store.get('files', path)
      const result = await this.store.update('settings', JOURNAL, row => {
        const journal = journalOf(row); const existing = entryAt(journal, path)
        const current = existing ? existing.value : visible(cached); const rev = revisionOf(current)
        if (expect != null && !sameRevision(expect, rev)) return { conflict: true, rev, current }
        const next = nextRevision(existing?.localRev ?? rev)
        const entry = { base: existing?.base ?? baseOf(cached), value: { path, content, rev: next, at: Date.now() }, localRev: next }
        return { value: { key: JOURNAL, value: { version: 1, revision: journal.revision + 1, entries: { ...journal.entries, [path]: entry } } }, rev: next }
      })
      if (result.conflict) return { ok: false, conflict: true, rev: result.rev, current: result.current }
      this.onCommit({ type: 'workspace.committed', operation: 'write', path, rev: result.rev })
      return { ok: true, rev: result.rev }
    })
  }
  remove(path, expect) {
    return this.queued(async () => {
      path = cleanPath(path)
      if (this.backend) {
        const current = await this.read(path)
        if (expect != null && !sameRevision(expect, revisionOf(current))) throw new Error('This file changed. Reopen it before deleting.')
        const result = await this.backend.remove({ path, expectedRevision: expect ?? revisionOf(current) })
        if (result?.conflict) throw new Error('This file changed. Reopen it before deleting.')
        this.onCommit({ type: 'workspace.committed', operation: 'delete', path })
        await this.store.delete('files', path)
      } else {
        this.requireDurable()
        const cached = await this.store.get('files', path)
        await this.store.update('settings', JOURNAL, row => {
          const journal = journalOf(row); const existing = entryAt(journal, path); const current = existing ? existing.value : cached
          if (expect != null && !sameRevision(expect, revisionOf(current))) throw new Error('This file changed. Reopen it before deleting.')
          if (!current) return {}
          const entries = { ...journal.entries }
          entries[path] = { base: existing?.base ?? baseOf(cached), value: null, localRev: nextRevision(existing?.localRev ?? revisionOf(current)) }
          return { value: { key: JOURNAL, value: { version: 1, revision: journal.revision + 1, entries } } }
        })
      }
      if (!this.backend) this.onCommit({ type: 'workspace.committed', operation: 'delete', path })
    })
  }
  rename(from, to, expect) {
    return this.queued(async () => {
      from = cleanPath(from); to = cleanPath(to)
      if (this.backend) {
        if (await this.read(to)) throw new Error('A file already exists at that path')
        const file = await this.read(from); if (!file) throw new Error('File no longer exists')
        if (expect != null && !sameRevision(expect, file.rev)) throw new Error('This file changed. Reopen it before renaming.')
        const result = await this.backend.rename({ path: from, destination: to, expectedRevision: file.rev })
        if (result?.conflict) throw new Error('This file changed. Reopen it before renaming.')
        this.onCommit({ type: 'workspace.committed', operation: 'rename', path: to, from })
        await this.store.delete('files', from); await this.cache(await this.read(to))
      } else {
        this.requireDurable()
        const [sourceCache, destinationCache] = await Promise.all([this.store.get('files', from), this.store.get('files', to)])
        await this.store.update('settings', JOURNAL, row => {
          const journal = journalOf(row); const source = entryAt(journal, from); const destination = entryAt(journal, to)
          const file = source ? source.value : sourceCache; const occupied = destination ? destination.value : destinationCache
          if (occupied) throw new Error('A file already exists at that path')
          if (!file) throw new Error('File no longer exists')
          if (expect != null && !sameRevision(expect, revisionOf(file))) throw new Error('This file changed. Reopen it before renaming.')
          const entries = { ...journal.entries }; const rev = nextRevision(source?.localRev ?? revisionOf(file))
          entries[from] = { base: source?.base ?? baseOf(sourceCache), value: null, localRev: rev }
          entries[to] = { base: destination?.base ?? baseOf(destinationCache), value: { ...visible(file), path: to, rev, at: Date.now() }, localRev: rev }
          return { value: { key: JOURNAL, value: { version: 1, revision: journal.revision + 1, entries } } }
        })
      }
      if (!this.backend) this.onCommit({ type: 'workspace.committed', operation: 'rename', path: to, from })
    })
  }
  async plan(backend, entries, { requireApplied = false } = {}) {
    const actions = []; const conflicts = []
    for (const [path, entry] of Object.entries(entries)) {
      cleanPath(path)
      const current = visible(await backend.read(path))
      if (desiredMatches(entry, current)) continue // Retry a mount interrupted after its write succeeded.
      const base = entry.base
      const unchanged = base.kind === 'absent' ? !current : base.kind === 'legacy' ? !current || current.content === base.content : !!current && sameRevision(revisionOf(current), base.rev) && current.content === base.content
      if (requireApplied || !unchanged) conflicts.push({ path, operation: entry.value === null ? 'delete' : 'write', expectedRevision: base.rev, actualRevision: revisionOf(current) })
      else actions.push({ path, entry, expectedRevision: revisionOf(current) })
    }
    if (conflicts.length) throw mountConflict(conflicts)
    return actions
  }
  async reviewConflict(backend, path) {
    path = cleanPath(path)
    await this.stageLegacy()
    const journal = await this.journal(); const entry = entryAt(journal, path)
    if (!entry) throw new Error('This offline change was already resolved. Refresh the workspace.')
    return { path, journalRevision: journal.revision, base: entry.base, saved: entry.value, runtime: visible(await backend.read(path)) }
  }
  resolveConflict(backend, { path, journalRevision, runtimeRevision, choice, content }) {
    return this.queued(async () => {
      this.requireDurable(); path = cleanPath(path)
      if (!['saved', 'runtime', 'merge'].includes(choice) || choice === 'merge' && typeof content !== 'string') throw new Error('Choose the saved copy, runtime copy, or a merged text value')
      const current = visible(await backend.read(path))
      if (!sameRevision(revisionOf(current), runtimeRevision)) throw new Error('The runtime file changed again. Review its latest version before resolving.')
      const result = await this.store.update('settings', JOURNAL, row => {
        const journal = journalOf(row); const entry = entryAt(journal, path)
        if (journal.revision !== journalRevision || !entry) throw new Error('Your saved changes changed during review. Reopen the conflict before resolving.')
        const rev = nextRevision(entry.localRev)
        const value = choice === 'saved' ? entry.value : choice === 'runtime' ? current : { path, content }
        // Keep both reviewed copies in the durable journal until mounting succeeds.
        // No runtime mutation happens until a later revision-checked mount.
        const next = { base: current ? { kind: 'known', rev: current.rev, content: current.content } : { kind: 'absent', rev: 0 }, value: value ? { ...value, rev, at: Date.now() } : null, localRev: rev, review: { previous: entry, runtime: current, choice, at: Date.now() } }
        return { value: { key: JOURNAL, value: { version: 1, revision: journal.revision + 1, entries: { ...journal.entries, [path]: next } } }, rev }
      })
      this.onCommit({ type: 'workspace.committed', operation: 'resolve-offline', path, rev: result.rev })
      return { ok: true, rev: result.rev }
    })
  }
  mount(backend, { transfer = false } = {}) {
    return this.queued(async () => {
      await this.stageLegacy()
      const staged = await this.staged(); const entries = this.pending(staged.cached, staged.journal)
      let actions
      if (transfer) {
        if ((await backend.list('')).length) throw new Error('Transfer requires an empty destination workspace; existing files were preserved')
        actions = [...staged.files].map(([path, value]) => ({ path, entry: { value }, expectedRevision: 0 }))
      } else actions = await this.plan(backend, entries)
      // Copy destinations before removing rename sources. Failed CAS leaves the durable
      // journal intact; retries recognize already-applied desired content.
      for (const action of [...actions.filter(row => row.entry.value !== null), ...actions.filter(row => row.entry.value === null)]) {
        const { path, entry, expectedRevision } = action
        try {
          const result = entry.value === null ? await backend.remove({ path, expectedRevision }) : await backend.write({ path, content: entry.value.content, expectedRevision })
          if (result?.conflict) throw mountConflict([{ path, operation: entry.value === null ? 'delete' : 'write', expectedRevision, actualRevision: result.rev ?? result.revision }])
        } catch (error) {
          if (error.code === 'WORKSPACE_MOUNT_CONFLICT') throw error
          throw mountConflict([{ path, operation: entry.value === null ? 'delete' : 'write', expectedRevision, reason: error.message }], error)
        }
      }
      await this.plan(backend, entries, { requireApplied: true })
      await this.checkpointBackend(backend, staged.journal.revision, entries)
      this.backend = backend
    })
  }
  async checkpointBackend(backend, acknowledgedRevision, entries = {}) {
    const rows = await backend.list(''); const paths = new Set(rows.map(file => file.path))
    for (const old of await this.store.all('files')) if (!paths.has(old.path)) await this.store.delete('files', old.path)
    for (const row of rows) {
      if (row.size > 2 * 1024 * 1024) { await this.store.delete('files', row.path); continue }
      const file = visible(await backend.read(row.path)); if (file?.content != null) await this.cache(file)
    }
    await this.plan(backend, entries, { requireApplied: true })
    if (acknowledgedRevision !== undefined) await this.store.update('settings', JOURNAL, row => {
      const journal = journalOf(row)
      if (journal.revision !== acknowledgedRevision) throw new Error('Saved offline changes changed during mount. They were preserved; retry mounting the runtime.')
      return { value: { key: JOURNAL, value: { version: 1, revision: journal.revision + 1, entries: {} } } }
    })
  }
  checkpoint() {
    return this.queued(async () => {
      if (!this.backend) return
      await this.stageLegacy()
      const staged = await this.staged(); const entries = this.pending(staged.cached, staged.journal)
      await this.plan(this.backend, entries, { requireApplied: true })
      await this.checkpointBackend(this.backend, staged.journal.revision, entries)
    })
  }
  async snapshot() {
    if (this.backend) return (await this.backend.snapshot('')).files
    return [...(await this.staged()).files.values()].map(file => { const bytes = new TextEncoder().encode(file.content); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return { path: file.path, base64: btoa(binary) } })
  }
}
