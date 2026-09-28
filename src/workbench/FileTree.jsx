'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons.jsx'
import { buildFileTree, visibleFileRows, fileRowWindow, fileTreeKey } from './file-tree.js'

export function fileKind(path) {
  const ext = path.split('.').pop()
  return ({ js: 'JS', jsx: 'JS', mjs: 'JS', ts: 'TS', tsx: 'TS', css: '#', json: '{}', html: '<>', md: 'M', svg: '◇', yml: 'Y', yaml: 'Y' })[ext] || '·'
}
export function FileIcon({ path }) { return <span className={`file-type type-${path.split('.').pop()}`} aria-hidden="true">{fileKind(path)}</span> }

export default function FileTree({ files, selected, dirtyPaths, onOpen, onPin, onMenu, query = '' }) {
  const [closed, setClosed] = useState(new Set())
  const [focused, setFocused] = useState(null)
  const [viewport, setViewport] = useState({ offset: 0, height: 600, rowHeight: 29 })
  const host = useRef(null); const scroller = useRef(null); const pendingFocus = useRef(null)
  const tree = useMemo(() => buildFileTree(files, query), [files, query])
  const rows = useMemo(() => visibleFileRows(tree, closed, !!query), [tree, closed, query])
  const indices = useMemo(() => new Map(rows.map((row, index) => [row.path, index])), [rows])
  const focusIndex = indices.get(focused) ?? indices.get(selected) ?? 0
  const focusPath = rows[focusIndex]?.path
  const virtual = rows.length > 200
  const windowRows = fileRowWindow(rows.length, viewport, focusIndex)
  const toggle = path => setClosed(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next })
  useLayoutEffect(() => {
    const node = host.current
    let parent = node.parentElement
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
    parent ||= document.scrollingElement
    scroller.current = parent
    const update = () => {
      const row = node.querySelector('[role="treeitem"]')
      const rowHeight = row?.getBoundingClientRect().height || 29
      const parentTop = parent === document.scrollingElement ? 0 : parent.getBoundingClientRect().top
      const offset = Math.max(0, parentTop - node.getBoundingClientRect().top - 3)
      const height = parent === document.scrollingElement ? innerHeight : parent.clientHeight
      setViewport(previous => previous.offset === offset && previous.height === height && previous.rowHeight === rowHeight ? previous : { offset, height, rowHeight })
    }
    const observer = new ResizeObserver(update)
    observer.observe(parent); observer.observe(node)
    parent.addEventListener('scroll', update, { passive: true }); window.addEventListener('resize', update)
    update()
    return () => { observer.disconnect(); parent.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [rows.length > 0])
  function focusRow(index) {
    const row = rows[index]; const node = host.current; const parent = scroller.current
    if (!row || !parent) return
    pendingFocus.current = row.path; setFocused(row.path)
    const top = node.getBoundingClientRect().top + 3 + index * viewport.rowHeight
    const parentTop = parent === document.scrollingElement ? 0 : parent.getBoundingClientRect().top
    const height = parent === document.scrollingElement ? innerHeight : parent.clientHeight
    if (top < parentTop) parent.scrollTop -= parentTop - top
    else if (top + viewport.rowHeight > parentTop + height) parent.scrollTop += top + viewport.rowHeight - parentTop - height
  }
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    const row = [...host.current.querySelectorAll('[role="treeitem"]')].find(item => item.dataset.path === pendingFocus.current)
    if (row) { pendingFocus.current = null; row.focus({ preventScroll: true }) }
  }, [focused, rows, viewport])
  useEffect(() => { if (query) scroller.current?.scrollTo({ top: 0 }) }, [query])
  function renderRow(index) {
    const item = rows[index]; const folder = !item.file
    return <div key={item.path} role="treeitem" data-path={item.path} aria-level={item.depth + 1} aria-posinset={item.position} aria-setsize={item.size} aria-selected={selected === item.path} aria-expanded={folder ? item.open : undefined} tabIndex={focusPath === item.path ? 0 : -1}
      className={`file-row ${selected === item.path ? 'selected' : ''}`} style={{ paddingLeft: 10 + item.depth * 13, ...(virtual ? { position: 'absolute', top: index * viewport.rowHeight, left: 0, right: 0, height: viewport.rowHeight } : {}) }} title={item.path}
      onFocus={() => setFocused(item.path)}
      onClick={() => folder ? toggle(item.path) : onOpen(item.path)}
      onDoubleClick={() => { if (!folder) onPin?.(item.path) }}
      onContextMenu={event => { if (!folder) { event.preventDefault(); onMenu(item.path) } }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); folder ? toggle(item.path) : event.key === 'Enter' && onPin ? onPin(item.path) : onOpen(item.path); return }
        if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const action = fileTreeKey(rows, index, event.key)
          if (action?.toggle) toggle(action.toggle)
          if (action?.focus !== undefined) focusRow(action.focus)
        }
        if (event.key === 'F2' && !folder) { event.preventDefault(); onMenu(item.path) }
      }}>
      {folder ? <><Icon name={item.open ? 'down' : 'right'} size={12}/><Icon name="folder" size={15}/></> : <><span className="tree-spacer"/><FileIcon path={item.path}/></>}
      <span className="file-name">{item.name}</span>{item.file?.editable === false && <span className="file-limit-badge" title="Too large for the editor. Use workspace commands to inspect this file.">Large</span>}{dirtyPaths.has(item.path) && <span className="dirty-dot" title="Unsaved changes"/>}
    </div>
  }
  return <div ref={host} role="tree" aria-label="Project files" className="file-tree"><div role="none" style={virtual ? { position: 'relative', height: rows.length * viewport.rowHeight } : undefined}>{windowRows.map(renderRow)}</div></div>
}
