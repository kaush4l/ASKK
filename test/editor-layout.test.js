import { expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { createEditorGroup, openEditorTab, closeEditorTab, pinEditorTab, createEditorNavigation, editorGroupGeometry, editorSession, externalEditorChange } from '../src/workbench/editor-layout.js'

test('groups retain independent selection and temporary tabs', () => {
  const left = openEditorTab(createEditorGroup(), 'left.js')
  const right = openEditorTab(createEditorGroup(), 'right.js')
  const changedRight = openEditorTab(right, 'replacement.js')
  expect(changedRight.tabs).toEqual(['replacement.js'])
  expect(left.selected).toBe('left.js')
  expect(right.selected).toBe('right.js')
  expect(openEditorTab(left, 'new.js', { dirtyPaths: new Set(['left.js']) }).tabs).toEqual(['left.js', 'new.js'])
})

test('diff tabs are pinned separately and closing a diff keeps its file open', () => {
  let group = openEditorTab(createEditorGroup(), 'app.js')
  group = openEditorTab(group, 'diff:app.js', { pin: true })
  expect(group.tabs).toEqual(['app.js', 'diff:app.js'])
  expect(closeEditorTab(group, 'diff:app.js').tabs).toEqual(['app.js'])
  expect(pinEditorTab(group, 'app.js').temporaryTab).toBe(null)
})

test('a background open preserves the selected file and never leaves a dangling tab', () => {
  const group = openEditorTab(createEditorGroup(), 'current.js')
  const next = openEditorTab(group, 'background.js', { select: false })
  expect(next.selected).toBe('current.js')
  expect(next.tabs).toEqual(['current.js', 'background.js'])
})

test('explicit navigation or closing a group invalidates its slow file open without cancelling the other group', async () => {
  const navigation = createEditorNavigation()
  const primary = navigation.begin('primary'); const secondary = navigation.begin('secondary')
  let finish
  const read = new Promise(resolve => { finish = resolve })
  const lateOpen = read.then(() => navigation.isCurrent('secondary', secondary))
  navigation.invalidate('secondary')
  finish('file content')
  expect(await lateOpen).toBe(false)
  expect(navigation.isCurrent('primary', primary)).toBe(true)
  const newer = navigation.begin('secondary')
  expect(navigation.isCurrent('secondary', newer)).toBe(true)
  expect(navigation.isCurrent('secondary', secondary)).toBe(false)
})

test('measured editor width guarantees both groups remain at least 380px', () => {
  expect(editorGroupGeometry(759, .3).split).toBe(false)
  expect(editorGroupGeometry(760, .3)).toEqual({ split: true, ratio: .5, left: 380, right: 380 })
  const wide = editorGroupGeometry(1000, .1)
  expect(wide.left).toBe(380); expect(wide.right).toBe(620)
  expect(editorGroupGeometry(800, .7).right).toBe(380)
})

test('each concurrent editor group owns callbacks and cached state', () => {
  const cache = {}; const left = editorSession(cache, 'primary'); const right = editorSession(cache, 'secondary')
  left.callbacks.current.onChange = () => 'left'
  right.callbacks.current.onChange = () => 'right'
  left.states.set('project:app.js', EditorState.create({ doc: 'left state' }))
  expect(right.states.has('project:app.js')).toBe(false)
  expect(left.callbacks.current.onChange()).toBe('left')
  expect(editorSession(cache, 'primary')).toBe(left)
})

test('synchronizing another group edits only the changed range and maps its cursor', () => {
  const state = EditorState.create({ doc: 'const a = 1;\nconst b = 2;', selection: { anchor: 20 } })
  const change = externalEditorChange(state.doc.toString(), 'const a = 100;\nconst b = 2;')
  expect(change).toEqual({ from: 11, to: 11, insert: '00' })
  const next = state.update({ changes: change }).state
  expect(next.selection.main.head).toBe(22)
  expect(next.doc.toString()).toBe('const a = 100;\nconst b = 2;')
  expect(externalEditorChange('same', 'same')).toBe(null)
})

test('restoration rejects a dangling selection but retains valid preview and independent tabs', () => {
  expect(createEditorGroup({ tabs: ['a.js', 'a.js'], selected: 'missing.js', temporaryTab: 'missing.js' })).toEqual({ tabs: ['a.js'], selected: 'a.js', temporaryTab: null })
  expect(createEditorGroup({ tabs: ['a.js'], selected: 'preview' }).selected).toBe('preview')
})
