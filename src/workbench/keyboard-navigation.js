/** Keep navigation inside the rendered choices, including an empty result set. */
export function selectionIndex(index, count) {
  return count > 0 ? Math.max(0, Math.min(count - 1, Number.isInteger(index) ? index : 0)) : -1
}

export function navigationIndex(index, count, key, { vertical = false, wrap = true } = {}) {
  if (!count) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  const direction = key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? -1 : key === (vertical ? 'ArrowDown' : 'ArrowRight') ? 1 : 0
  if (!direction) return null
  const next = selectionIndex(index, count) + direction
  return wrap ? (next + count) % count : selectionIndex(next, count)
}

/** Keyboard activation follows the same manual-selection path as a pointer click. */
export function navigateTabList(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const list = event.currentTarget
  const current = event.target.closest('[role="tab"]')
  if (!current || current.closest('[role="tablist"]') !== list) return
  const tabs = [...list.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled && !tab.closest('[inert]') && tab.closest('[role="tablist"]') === list && tab.getClientRects().length)
  const next = navigationIndex(tabs.indexOf(current), tabs.length, event.key)
  if (next === null) return
  event.preventDefault()
  revealListItem(list, tabs[next], { horizontal: true })
  tabs[next].focus({ preventScroll: true })
  tabs[next].click()
}

/** Scroll only the result list, without moving focus or the surrounding dialog. */
export function revealListItem(list, item, { horizontal = false } = {}) {
  if (!list || !item) return
  const viewport = list.getBoundingClientRect(), row = item.getBoundingClientRect()
  const start = horizontal ? 'left' : 'top', end = horizontal ? 'right' : 'bottom', scroll = horizontal ? 'scrollLeft' : 'scrollTop'
  if (row[start] < viewport[start]) list[scroll] -= viewport[start] - row[start]
  else if (row[end] > viewport[end]) list[scroll] += row[end] - viewport[end]
}
