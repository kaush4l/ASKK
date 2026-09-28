'use client'
import { useMemo, useState } from 'react'
import Icon from './Icons.jsx'

export function fileKind(path) {
  const ext = path.split('.').pop()
  return ({ js: 'JS', jsx: 'JS', mjs: 'JS', ts: 'TS', tsx: 'TS', css: '#', json: '{}', html: '<>', md: 'M', svg: '◇', yml: 'Y', yaml: 'Y' })[ext] || '·'
}
export function FileIcon({ path }) { return <span className={`file-type type-${path.split('.').pop()}`} aria-hidden="true">{fileKind(path)}</span> }

export default function FileTree({ files, selected, dirtyPaths, onOpen, onPin, onMenu, query = '' }) {
  const [closed, setClosed] = useState(new Set())
  const [focused, setFocused] = useState(null)
  const tree = useMemo(() => {
    const root = { children: new Map() }
    for (const file of files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()))) {
      const segments = file.path.split('/').filter(Boolean)
      let node = root
      segments.forEach((name, index) => {
        const path = segments.slice(0, index + 1).join('/')
        if (!node.children.has(name)) node.children.set(name, { name, path, children: new Map(), file: index === segments.length - 1 ? file : null })
        node = node.children.get(name)
      })
    }
    return root
  }, [files, query])
  const ordered = node => [...node.children.values()].sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name))
  const visible = []
  const collect = node => { for (const item of ordered(node)) { visible.push(item.path); if (!item.file && (!closed.has(item.path) || query)) collect(item) } }
  collect(tree)
  const focusPath = visible.includes(focused) ? focused : visible.includes(selected) ? selected : visible[0]
  const toggle = path => setClosed(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next })
  function render(node, depth = 0) {
    return ordered(node).map(item => {
      const folder = !item.file
      const open = !closed.has(item.path) || !!query
      return <div key={item.path} role="none">
        <div role="treeitem" data-path={item.path} aria-level={depth + 1} aria-selected={selected === item.path} aria-expanded={folder ? open : undefined} tabIndex={focusPath === item.path ? 0 : -1}
          className={`file-row ${selected === item.path ? 'selected' : ''}`} style={{ paddingLeft: 10 + depth * 13 }} title={item.path}
          onFocus={() => setFocused(item.path)}
          onClick={() => folder ? toggle(item.path) : onOpen(item.path)}
          onDoubleClick={() => { if (!folder) onPin?.(item.path) }}
          onContextMenu={event => { if (!folder) { event.preventDefault(); onMenu(item.path) } }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); folder ? toggle(item.path) : event.key === 'Enter' && onPin ? onPin(item.path) : onOpen(item.path) }
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault()
              const items = [...event.currentTarget.closest('[role=tree]').querySelectorAll('[role=treeitem]')]
              if (folder && (event.key === 'ArrowRight' && !open || event.key === 'ArrowLeft' && open)) toggle(item.path)
              else if (event.key === 'ArrowRight' && folder) items[items.indexOf(event.currentTarget) + 1]?.focus()
              else if (event.key === 'ArrowLeft') items.find(row => row.dataset.path === item.path.split('/').slice(0, -1).join('/'))?.focus()
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const items = [...event.currentTarget.closest('[role=tree]').querySelectorAll('[role=treeitem]')]
              const index = items.indexOf(event.currentTarget)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1)
              items[Math.max(0, Math.min(items.length - 1, next))]?.focus()
            }
            if (event.key === 'F2' && !folder) { event.preventDefault(); onMenu(item.path) }
          }}>
          {folder ? <><Icon name={open ? 'down' : 'right'} size={12}/><Icon name="folder" size={15}/></> : <><span className="tree-spacer"/><FileIcon path={item.path}/></>}
          <span className="file-name">{item.name}</span>{item.file?.editable === false && <span className="file-limit-badge" title="Too large for the editor. Use workspace commands to inspect this file.">Large</span>}{dirtyPaths.has(item.path) && <span className="dirty-dot" title="Unsaved changes"/>}
        </div>
        {folder && open && <div role="group">{render(item, depth + 1)}</div>}
      </div>
    })
  }
  return <div role="tree" aria-label="Project files" className="file-tree">{render(tree)}</div>
}
