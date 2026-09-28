import { expect, test } from 'bun:test'
import { acknowledgeSavedDraft, saveAllDrafts } from '../src/workbench/save-all.js'

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
