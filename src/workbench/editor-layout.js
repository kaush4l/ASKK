export const MIN_EDITOR_GROUP_WIDTH = 380
export const isPreviewTab = id => id === 'preview' || id?.startsWith('artifact:')
export const isDiffTab = id => id?.startsWith('diff:')
export const editorFilePath = id => isDiffTab(id) ? id.slice(5) : id
const persistentTab = id => id !== 'welcome' && !isPreviewTab(id)

export function createEditorGroup(input = {}) {
  const tabs = [...new Set((Array.isArray(input.tabs) ? input.tabs : []).filter(id => typeof id === 'string' && persistentTab(id)))]
  const selected = typeof input.selected === 'string' && (!persistentTab(input.selected) || tabs.includes(input.selected)) ? input.selected : tabs.at(-1) || 'welcome'
  return { tabs, selected, temporaryTab: tabs.includes(input.temporaryTab) && !isDiffTab(input.temporaryTab) ? input.temporaryTab : null }
}

export function openEditorTab(group, id, { pin = false, dirtyPaths = new Set(), select = true } = {}) {
  if (!persistentTab(id)) return { ...group, ...(select ? { selected: id } : {}) }
  let tabs = group.tabs
  let temporaryTab = group.temporaryTab
  if (!tabs.includes(id)) {
    const replace = !pin && temporaryTab && tabs.includes(temporaryTab) && (select || group.selected !== temporaryTab) && !dirtyPaths.has(editorFilePath(temporaryTab))
    tabs = replace ? tabs.map(path => path === temporaryTab ? id : path) : [...tabs, id]
    temporaryTab = pin || isDiffTab(id) ? temporaryTab : id
  } else if (pin && temporaryTab === id) temporaryTab = null
  return { ...group, tabs, temporaryTab, ...(select ? { selected: id } : {}) }
}

export function closeEditorTab(group, id) {
  const tabs = group.tabs.filter(path => path !== id)
  return { tabs, selected: group.selected === id ? tabs.at(-1) || 'welcome' : group.selected, temporaryTab: group.temporaryTab === id ? null : group.temporaryTab }
}

export function pinEditorTab(group, id) { return group.temporaryTab === id ? { ...group, temporaryTab: null } : group }

export function createEditorNavigation() {
  const generations = new Map()
  return {
    begin(group) { const next = (generations.get(group) || 0) + 1; generations.set(group, next); return next },
    isCurrent(group, ticket) { return generations.get(group) === ticket },
    invalidate(group) { generations.set(group, (generations.get(group) || 0) + 1) },
  }
}

/** Width is the measured editor container, after conversation and Explorer. */
export function editorGroupGeometry(width, ratio = .5) {
  if (!Number.isFinite(width) || width < MIN_EDITOR_GROUP_WIDTH * 2) return { split: false, ratio: .5, left: width || 0, right: 0 }
  const minimum = MIN_EDITOR_GROUP_WIDTH / width
  const clamped = Math.max(minimum, Math.min(1 - minimum, Number.isFinite(ratio) ? ratio : .5))
  return { split: true, ratio: clamped, left: width * clamped, right: width * (1 - clamped) }
}

/** Never share callback refs or cached EditorState instances across concurrent views. */
export function editorSession(cache, groupId = 'primary') {
  cache.sessions ||= new Map()
  if (!cache.sessions.has(groupId)) cache.sessions.set(groupId, { states: new Map(), generations: new Map(), callbacks: { current: {} } })
  return cache.sessions.get(groupId)
}

export function editorGeneration(session, key) { return session.generations?.get(key) || 0 }
export function rememberEditorState(session, key, generation, entry) {
  if (editorGeneration(session, key) !== generation) return false
  session.states.set(key, entry)
  return true
}
export function forgetEditorFile(cache, scope, path) {
  const key = `${scope || 'default'}:${path}`
  for (const session of cache.sessions?.values() || []) {
    session.generations ||= new Map()
    session.generations.set(key, editorGeneration(session, key) + 1)
    session.states.delete(key)
  }
}

/** A small external edit preserves unaffected cursor positions in the other group. */
export function externalEditorChange(before, after) {
  if (before === after) return null
  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from++
  let oldEnd = before.length; let newEnd = after.length
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd-- }
  return { from, to: oldEnd, insert: after.slice(from, newEnd) }
}
