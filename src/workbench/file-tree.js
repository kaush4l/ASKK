/** Build and sort only when files or the search query change. */
export function buildFileTree(files, query = '') {
  const root = { children: new Map() }; const match = query.toLowerCase()
  for (const file of files) {
    if (!file.path.toLowerCase().includes(match)) continue
    const segments = file.path.split('/').filter(Boolean); let parent = root
    for (let index = 0; index < segments.length; index++) {
      const name = segments[index]; const path = segments.slice(0, index + 1).join('/')
      if (!parent.children.has(name)) parent.children.set(name, { name, path, children: new Map(), file: null })
      parent = parent.children.get(name)
      if (index === segments.length - 1) parent.file = file
    }
  }
  const sort = node => ({ ...node, children: [...node.children.values()].sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name)).map(sort) })
  return sort(root)
}

export function visibleFileRows(tree, closed = new Set(), forceOpen = false) {
  const rows = []
  function visit(parent, depth = 0) {
    parent.children.forEach((item, index) => {
      const open = !item.file && (forceOpen || !closed.has(item.path))
      rows.push({ ...item, depth, parentPath: parent.path || null, open, position: index + 1, size: parent.children.length })
      if (open) visit(item, depth + 1)
    })
  }
  visit(tree)
  return rows
}

/** Keep the focused row mounted even when the owner scrolls it outside the window. */
export function fileRowWindow(count, { offset = 0, height = 600, rowHeight = 29, overscan = 8 } = {}, focused = -1) {
  if (!count) return []
  if (count <= 200) return Array.from({ length: count }, (_, index) => index)
  const start = Math.max(0, Math.min(count - 1, Math.floor(Math.max(0, offset) / rowHeight) - overscan))
  const end = Math.min(count, Math.ceil((Math.max(0, offset) + Math.max(1, height)) / rowHeight) + overscan)
  const indices = Array.from({ length: Math.max(1, end - start) }, (_, index) => start + index)
  if (focused >= 0 && focused < count && !indices.includes(focused)) { indices.push(focused); indices.sort((a, b) => a - b) }
  return indices
}

/** Navigation is over the complete visible tree, independent of mounted DOM rows. */
export function fileTreeKey(rows, index, key) {
  const row = rows[index]
  if (!row) return null
  if (key === 'Home') return { focus: 0 }
  if (key === 'End') return { focus: rows.length - 1 }
  if (key === 'ArrowUp' || key === 'ArrowDown') return { focus: Math.max(0, Math.min(rows.length - 1, index + (key === 'ArrowUp' ? -1 : 1))) }
  if (key === 'ArrowRight' && !row.file) return row.open ? (rows[index + 1]?.parentPath === row.path ? { focus: index + 1 } : null) : { toggle: row.path }
  if (key === 'ArrowLeft') {
    if (!row.file && row.open) return { toggle: row.path }
    const parent = rows.findIndex(item => item.path === row.parentPath)
    return parent >= 0 ? { focus: parent } : null
  }
  return null
}
