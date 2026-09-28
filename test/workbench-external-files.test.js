import { expect, test } from 'bun:test'
import { reconcileMissingDocuments, mayOpenFile } from '../src/workbench/external-files.js'
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
