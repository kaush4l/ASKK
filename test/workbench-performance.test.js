import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FileTree from '../src/workbench/FileTree.jsx'
import { buildFileTree, visibleFileRows, fileRowWindow, fileTreeKey } from '../src/workbench/file-tree.js'
import { terminalOutputDelta } from '../src/workbench/terminal-output.js'

const files = ['root.js', 'a/one.js', 'a/two.js', 'b/deep/three.js'].map(path => ({ path }))
test('flattened tree retains sibling totals, levels, parent identity and folder ordering', () => {
  const rows = visibleFileRows(buildFileTree(files))
  expect(rows.map(row => row.path)).toEqual(['a', 'a/one.js', 'a/two.js', 'b', 'b/deep', 'b/deep/three.js', 'root.js'])
  expect(rows[2]).toMatchObject({ depth: 1, parentPath: 'a', position: 2, size: 2 })
  expect(rows[5]).toMatchObject({ depth: 2, parentPath: 'b/deep', position: 1, size: 1 })
  expect(rows[6]).toMatchObject({ depth: 0, parentPath: null, position: 3, size: 3 })
})
test('collapse removes descendants while filtering restores only matching ancestor chains', () => {
  expect(visibleFileRows(buildFileTree(files), new Set(['a', 'b'])).map(row => row.path)).toEqual(['a', 'b', 'root.js'])
  expect(visibleFileRows(buildFileTree(files, 'THREE'), new Set(['b']), true).map(row => row.path)).toEqual(['b', 'b/deep', 'b/deep/three.js'])
})
test('keyboard navigation reaches off-window rows and uses the visible hierarchy', () => {
  const rows = visibleFileRows(buildFileTree(files))
  expect(fileTreeKey(rows, 0, 'End')).toEqual({ focus: 6 })
  expect(fileTreeKey(rows, 6, 'Home')).toEqual({ focus: 0 })
  expect(fileTreeKey(rows, 5, 'ArrowLeft')).toEqual({ focus: 4 })
  expect(fileTreeKey(rows, 3, 'ArrowLeft')).toEqual({ toggle: 'b' })
  expect(fileTreeKey(rows, 4, 'ArrowRight')).toEqual({ focus: 5 })
  const collapsed = visibleFileRows(buildFileTree(files), new Set(['a']))
  expect(fileTreeKey(collapsed, 0, 'ArrowDown')).toEqual({ focus: 1 })
  expect(collapsed[1].path).toBe('b')
  expect(fileTreeKey(collapsed, 0, 'ArrowRight')).toEqual({ toggle: 'a' })
})
test('row windows remain bounded and retain a focused row across owner scrolling', () => {
  const window = fileRowWindow(10000, { offset: 200000, height: 420, rowHeight: 29 }, 5)
  expect(window.length).toBeLessThan(40)
  expect(window).toContain(5)
  expect(window).toContain(Math.floor(200000 / 29))
  expect(new Set(window).size).toBe(window.length)
  expect(fileRowWindow(0)).toEqual([])
  expect(fileRowWindow(10000, { offset: 0, height: 420, rowHeight: 44 }).length).toBeLessThan(25)
})
test('actual large FileTree render bounds DOM while exposing full accessible sibling counts', () => {
  const input = Array.from({ length: 10000 }, (_, index) => ({ path: `src/file-${String(index).padStart(5, '0')}.js` }))
  const html = renderToStaticMarkup(React.createElement(FileTree, { files: input, selected: 'src/file-09999.js', dirtyPaths: new Set(), onOpen() {}, onMenu() {} }))
  expect((html.match(/role="treeitem"/g) || []).length).toBeLessThan(40)
  expect(html).toContain('aria-setsize="10000"')
  expect(html).toContain('aria-posinset="10000"')
  expect(html).toContain('aria-level="2"')
  expect(html).toContain('data-path="src/file-09999.js"')
  expect(html).toContain('aria-selected="true" tabindex="0"')
})
test('counted output appends and true discontinuities reset exactly', () => {
  expect(terminalOutputDelta('first\n', 'first\nsecond\n', { previousLength: 6, outputLength: 13 })).toEqual({ reset: false, text: 'second\n' })
  expect(terminalOutputDelta('first\n', 'changed\n', { previousLength: 6, outputLength: 8 })).toEqual({ reset: true, text: 'changed\n' })
  expect(terminalOutputDelta('long output', '', { previousLength: 11, outputLength: 0 })).toEqual({ reset: true, text: '' })
  expect(terminalOutputDelta('same', 'same', { previousLength: 4, outputLength: 4 })).toEqual({ reset: false, text: '' })
  expect(terminalOutputDelta('abcdefgh', 'XYZ12345', { previousLength: 8, outputLength: 20 })).toEqual({ reset: true, text: 'XYZ12345' })
})
test('metadata distinguishes new repeated bytes from unchanged retained snapshots', () => {
  expect(terminalOutputDelta('aaaaaaaa', 'aaaaaaaa', { previousLength: 8, outputLength: 11 })).toEqual({ reset: false, text: 'aaa' })
  expect(terminalOutputDelta('abababab', 'abababab', { previousLength: 8, outputLength: 12 })).toEqual({ reset: false, text: 'abab' })
  expect(terminalOutputDelta('abcdefgh', 'cdefghij', { previousLength: 8, outputLength: 10 })).toEqual({ reset: false, text: 'ij' })
  expect(terminalOutputDelta('xx\u001b[31mA', '\u001b[31mABC', { previousLength: 8, outputLength: 10 })).toEqual({ reset: false, text: 'BC' })
  expect(terminalOutputDelta('abcde', 'cdefghij', { previousLength: 5, outputLength: 10 })).toEqual({ reset: false, text: 'fghij' })
})
test('legacy snapshots reset on change instead of inventing append provenance', () => {
  expect(terminalOutputDelta('old', 'old plus')).toEqual({ reset: true, text: 'old plus' })
  expect(terminalOutputDelta('same', 'same')).toEqual({ reset: false, text: '' })
  expect(terminalOutputDelta('same', 'same', { previousLength: 20, outputLength: 4 })).toEqual({ reset: true, text: 'same' })
})
test('counted rolling snapshots reconstruct the entire stream without losing duplicate chunks', () => {
  let stream = ''; let previous = ''; let rendered = ''; let seed = 941; let previousLength = 0
  for (let step = 0; step < 200; step++) {
    let chunk = ''
    for (let index = 0; index < 1 + step % 31; index++) { seed = (seed * 1664525 + 1013904223) >>> 0; chunk += 'aaabbbcdef\n'[seed % 11] }
    stream += chunk; const next = stream.slice(-100)
    const delta = terminalOutputDelta(previous, next, { previousLength, outputLength: stream.length })
    rendered = delta.reset ? delta.text : rendered + delta.text
    expect(rendered).toBe(stream)
    previous = next; previousLength = stream.length
  }
})
