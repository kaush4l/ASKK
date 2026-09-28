import { expect, test } from 'bun:test'
import { reconcileMissingDocuments, mayOpenFile, readEditorDocument } from '../src/workbench/external-files.js'
import { createEditorGroup, openEditorTab, closeEditorTab, editorSession, editorGeneration, rememberEditorState, forgetEditorFile } from '../src/workbench/editor-layout.js'
import { acknowledgeSavedDraft, saveAllDrafts } from '../src/workbench/save-all.js'

const clean = { content: 'saved', baseContent: 'saved', baseRev: 7 }
const dirty = { ...clean, content: 'unsaved typing' }
const ready = { ready: true, hydrated: true }

test('initial empty lists cannot discard clean files or recovered drafts', () => {
  const documents = { 'clean.js': clean, 'draft.js': dirty }
  expect(reconcileMissingDocuments(documents, [], { hydrated: true }).documents).toBe(documents)
  expect(reconcileMissingDocuments(documents, [], { ready: true }).documents).toBe(documents)
  expect(reconcileMissingDocuments(documents, [{ path: 'clean.js' }, { path: 'draft.js' }], ready).documents).toBe(documents)
})

test('authoritative deletion closes clean file and diff tabs but preserves dirty drafts', () => {
  const documents = { 'clean.js': clean, 'draft.js': dirty }
  const result = reconcileMissingDocuments(documents, [], ready)
  expect(result.closedPaths).toEqual(['clean.js'])
  expect(result.documents['clean.js']).toBeUndefined()
  expect(result.documents['draft.js']).toEqual({ ...dirty, incoming: { deleted: true, rev: 0, content: '' } })
  let group = createEditorGroup()
  for (const path of ['clean.js', 'diff:clean.js', 'draft.js']) group = openEditorTab(group, path, { pin: true })
  for (const path of result.closedPaths) { group = closeEditorTab(group, path); group = closeEditorTab(group, `diff:${path}`) }
  expect(group.tabs).toEqual(['draft.js'])
  expect(reconcileMissingDocuments(result.documents, [], ready).documents).toBe(result.documents)
  expect(documents['draft.js']).toBe(dirty)
})

test('a pending save keeps its document until its receipt, and late typing survives deletion', () => {
  const saving = new Set(['a.js'])
  const pending = reconcileMissingDocuments({ 'a.js': clean }, [], { ...ready, saving })
  expect(pending.closedPaths).toEqual([])
  expect(pending.documents['a.js'].incoming.deleted).toBe(true)
  const typed = { 'a.js': { ...pending.documents['a.js'], content: 'typed before reconciliation' } }
  expect(reconcileMissingDocuments(typed, [], ready).closedPaths).toEqual([])
  expect(reconcileMissingDocuments(typed, [], ready).documents['a.js'].content).toBe('typed before reconciliation')
})

test('restored unloaded tabs close only after the authoritative list and drafts have hydrated', () => {
  const openPaths = ['removed.js', 'removed.js', 'draft.js']
  const documents = { 'draft.js': dirty }
  expect(reconcileMissingDocuments(documents, [], { openPaths }).closedPaths).toEqual([])
  expect(reconcileMissingDocuments(documents, [], { ...ready, openPaths }).closedPaths).toEqual(['removed.js'])
})

test('a delayed clean read cannot reinstall a deleted file while a recovered dirty draft remains openable', async () => {
  let files = [{ path: 'a.js' }]; let finish
  const read = new Promise(resolve => { finish = resolve })
  const accepted = read.then(() => mayOpenFile('a.js', {}, files, true))
  files = []; finish(clean)
  expect(await accepted).toBe(false)
  expect(mayOpenFile('a.js', { 'a.js': dirty }, files, true)).toBe(true)
})

test('explicit recreation acknowledges absent revision zero and clears the deletion marker', async () => {
  const missing = reconcileMissingDocuments({ 'a.js': dirty }, [], ready).documents['a.js']
  const submitted = { content: missing.content, baseContent: '', baseRev: 0 }
  const recreated = acknowledgeSavedDraft(missing, submitted, 8)
  expect(recreated).toMatchObject({ content: dirty.content, baseContent: dirty.content, baseRev: 8, incoming: null })
  await saveAllDrafts(() => ({ 'a.js': recreated }), async () => { throw new Error('Already saved') })
})

test('forgetting a deleted file prevents late unmount caching without touching another file or project', () => {
  const cache = {}; const left = editorSession(cache, 'primary'); const right = editorSession(cache, 'secondary')
  const key = 'project:a.js'; const generation = editorGeneration(left, key)
  const entry = { state: { doc: 'old saved file' }, top: 40, left: 0 }
  for (const session of [left, right]) { session.states.set(key, entry); session.states.set('project:b.js', entry); session.states.set('other:a.js', entry) }
  forgetEditorFile(cache, 'project', 'a.js')
  expect(rememberEditorState(left, key, generation, entry)).toBe(false)
  for (const session of [left, right]) { expect(session.states.has(key)).toBe(false); expect(session.states.has('project:b.js')).toBe(true); expect(session.states.has('other:a.js')).toBe(true) }
  expect(rememberEditorState(left, key, editorGeneration(left, key), { ...entry, state: { doc: 'explicitly recreated file' } })).toBe(true)
})

function openingFixture() {
  let state = { ready: true, files: [{ path: 'a.js', rev: 'A' }], documents: {} }
  let current = true
  const requests = [], installed = []
  const result = readEditorDocument({
    path: 'a.js', snapshot: () => state, isCurrent: () => current,
    read: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    install: file => { installed.push(file); state = { ...state, documents: { 'a.js': file } } },
  })
  return { result, requests, installed, snapshot: () => state,
    list: files => { state = { ...state, files } },
    document: doc => { state = { ...state, documents: { 'a.js': doc } } },
    supersede: () => { current = false },
  }
}
const fileVersion = rev => ({ path: 'a.js', rev, content: `version ${rev}` })

for (const operation of ['replacement', 'deletion and recreation']) test(`opening retries a stale snapshot after ${operation}`, async () => {
  const f = openingFixture()
  if (operation === 'deletion and recreation') f.list([])
  f.list([{ path: 'a.js', rev: 'B' }])
  f.requests[0].resolve(fileVersion('A'))
  await Promise.resolve()
  expect(f.requests).toHaveLength(2)
  expect(f.installed).toEqual([])
  f.requests[1].resolve(fileVersion('B'))
  expect(await f.result).toBe(true)
  expect(f.installed).toEqual([fileVersion('B')])
})

test('a superseded open never installs a snapshot or changes another document', async () => {
  const f = openingFixture()
  const newer = { content: 'other view typing', baseContent: 'saved', baseRev: 'B' }
  f.document(newer); f.supersede()
  f.requests[0].resolve(fileVersion('A'))
  expect(await f.result).toBe(false)
  expect(f.installed).toEqual([])
  expect(f.snapshot().documents['a.js']).toBe(newer)
})

test('a draft restored during opening is preserved even when the file is deleted', async () => {
  const f = openingFixture()
  f.list([]); f.document(dirty)
  f.requests[0].resolve(fileVersion('A'))
  expect(await f.result).toBe(true)
  expect(f.installed).toEqual([])
  expect(f.snapshot().documents['a.js']).toBe(dirty)
})

test('a fresh read is admitted when an unchanged file listing lags behind it', async () => {
  const f = openingFixture()
  f.requests[0].resolve(fileVersion('B'))
  expect(await f.result).toBe(true)
  expect(f.requests).toHaveLength(1)
  expect(f.installed).toEqual([fileVersion('B')])
})

test('a newer unknown revision can pass a retry without waiting for the listing poll', async () => {
  const f = openingFixture()
  f.list([{ path: 'a.js', rev: 'B' }])
  f.requests[0].resolve(fileVersion('A'))
  await Promise.resolve()
  f.requests[1].resolve(fileVersion('C'))
  expect(await f.result).toBe(true)
  expect(f.installed).toEqual([fileVersion('C')])
})

test('known stale revisions cannot reenter on a retry and opening stops after three reads', async () => {
  const f = openingFixture()
  const outcome = f.result.then(() => null, error => error)
  f.list([{ path: 'a.js', rev: 'B' }])
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(f.requests).toHaveLength(attempt + 1)
    f.requests[attempt].resolve(fileVersion('A'))
    await Promise.resolve()
  }
  expect((await outcome)?.message).toContain('kept changing while opening')
  expect(f.requests).toHaveLength(3)
  expect(f.installed).toEqual([])
})

test('read admission cannot reinstall an authoritatively deleted clean file', async () => {
  const f = openingFixture()
  const outcome = f.result.then(() => null, error => error)
  f.list([]); f.requests[0].resolve(fileVersion('A'))
  expect((await outcome)?.message).toContain('no longer exists')
  expect(f.installed).toEqual([])
})

test('a superseded failed read does not surface an obsolete open failure', async () => {
  const f = openingFixture()
  f.supersede(); f.requests[0].reject(new Error('obsolete read failure'))
  expect(await f.result).toBe(false)
  expect(f.installed).toEqual([])
})
