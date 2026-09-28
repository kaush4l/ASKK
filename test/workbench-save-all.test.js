import { expect, test } from 'bun:test'
import { acknowledgeSavedDraft, draftForConflict, saveAllDrafts } from '../src/workbench/save-all.js'

const draft = (content = 'draft') => ({ content, baseContent: 'base', baseRev: 'base-rev' })
function pending() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('save all waits for exact acknowledged drafts before allowing a build', async () => {
  const docs = { 'a.js': draft('a'), 'b.js': draft('b') }; const saved = []
  await saveAllDrafts(() => docs, async (path, submitted) => {
    saved.push(path); docs[path] = acknowledgeSavedDraft(docs[path], submitted, `${path}-rev`); return true
  })
  expect(saved).toEqual(['a.js', 'b.js'])
  expect(docs['a.js'].baseContent).toBe('a')
  expect(docs['b.js'].baseContent).toBe('b')
})

test('typing while a save is pending preserves the draft and prevents the build', async () => {
  const docs = { 'a.js': draft() }; const entered = pending(); const finish = pending(); let built = false
  const work = saveAllDrafts(() => docs, async (path, submitted) => {
    entered.resolve(); await finish.promise
    docs[path] = acknowledgeSavedDraft(docs[path], submitted, 'saved-rev'); return true
  }).then(() => { built = true })
  await entered.promise; docs['a.js'].content = 'new typing'; finish.resolve()
  await expect(work).rejects.toThrow('draft changed')
  expect(built).toBe(false)
  expect(docs['a.js']).toMatchObject({ content: 'new typing', baseContent: 'draft', baseRev: 'saved-rev' })
})

test('a new dirty document created during saving prevents the build', async () => {
  const docs = { 'a.js': draft() }
  await expect(saveAllDrafts(() => docs, async (path, submitted) => {
    docs[path] = acknowledgeSavedDraft(docs[path], submitted, 'saved-rev')
    docs['new.js'] = draft('new document'); return true
  })).rejects.toThrow('New unsaved changes')
})

test('failed revision checks stop saving subsequent documents', async () => {
  const docs = { 'a.js': draft(), 'b.js': draft() }; const saved = []
  await expect(saveAllDrafts(() => docs, async path => { saved.push(path); return false })).rejects.toThrow('resolve the save for a.js')
  expect(saved).toEqual(['a.js'])
})

test('acknowledgement retains an unrelated external revision for conflict review', () => {
  const incoming = { content: 'external', rev: 'external-rev' }
  expect(acknowledgeSavedDraft({ ...draft(), incoming }, draft(), 'saved-rev').incoming).toEqual(incoming)
  expect(acknowledgeSavedDraft({ ...draft(), incoming }, draft(), 'external-rev').incoming).toBe(null)
})

test('an external commit observed during saving prevents the build until review', async () => {
  const docs = { 'a.js': draft() }
  await expect(saveAllDrafts(() => docs, async (path, submitted) => {
    docs[path] = acknowledgeSavedDraft({ ...docs[path], incoming: { rev: 'external', content: 'other edit' } }, submitted, 'saved')
    return true
  })).rejects.toThrow('Committed changes need review')
})

test('resolving the reviewed incoming revision clears its marker and permits a build', async () => {
  const docs = { 'a.js': { content: 'my draft', baseContent: 'original', baseRev: 1, incoming: { content: 'external', rev: 2 } } }
  const resolution = { content: 'merged', baseContent: 'external', baseRev: 2 }
  docs['a.js'] = { ...acknowledgeSavedDraft(docs['a.js'], resolution, 3), content: resolution.content }
  let saves = 0
  await saveAllDrafts(() => docs, async () => { saves++; return true })
  expect(docs['a.js']).toMatchObject({ content: 'merged', baseContent: 'merged', baseRev: 3, incoming: null })
  expect(saves).toBe(0)
})

test('a newer incoming revision during resolution remains visible and blocks the build', async () => {
  const docs = { 'a.js': { content: 'my draft', baseContent: 'original', baseRev: 1, incoming: { content: 'external', rev: 2 } } }
  const resolution = { content: 'merged', baseContent: 'external', baseRev: 2 }
  const finish = pending()
  const save = finish.promise.then(() => {
    docs['a.js'] = { ...acknowledgeSavedDraft(docs['a.js'], resolution, 3), content: resolution.content }
  })
  docs['a.js'].incoming = { content: 'newer external edit', rev: 4 }
  finish.resolve(); await save
  expect(docs['a.js']).toMatchObject({ content: 'merged', baseContent: 'merged', baseRev: 3, incoming: { content: 'newer external edit', rev: 4 } })
  await expect(saveAllDrafts(() => docs, async () => true)).rejects.toThrow('Committed changes need review')
})

test('a late conflict initializes its editor from typing made during save and fallback read', async () => {
  let current = draft('submitted A')
  const submitted = { ...current }
  const contentAtAdmission = current.content
  const saved = pending(); const read = pending(); const reading = pending()
  const conflict = (async () => {
    await saved.promise
    reading.resolve(); await read.promise
    return draftForConflict(current, submitted, contentAtAdmission)
  })()
  current = { ...current, content: 'typed during save B' }
  saved.resolve(); await reading.promise
  current = { ...current, content: 'typed during latest read C' }
  read.resolve()
  expect(await conflict).toBe('typed during latest read C')
  expect(current.content).toBe('typed during latest read C')
})

test('a conflicted merge retains the attempted resolution unless the editor changed meanwhile', () => {
  const current = draft('editor draft')
  const resolution = { content: 'my merged resolution', baseContent: 'external', baseRev: 2 }
  expect(draftForConflict(current, resolution, current.content)).toBe('my merged resolution')
  expect(draftForConflict({ ...current, content: 'newer editor typing' }, resolution, current.content)).toBe('newer editor typing')
  expect(draftForConflict(undefined, resolution, current.content)).toBe('my merged resolution')
})
