import { expect, test } from 'bun:test'
import { selectionIndex, navigationIndex, navigateTabList, revealListItem } from '../src/workbench/keyboard-navigation.js'

test('palette navigation stays inside its rendered thirty results, including after the results shrink', () => {
  const all = Array.from({ length: 60 }, (_, index) => `file-${index}`)
  const visible = all.slice(0, 30)
  let selected = 0
  for (let index = 0; index < 45; index++) selected = navigationIndex(selected, visible.length, 'ArrowDown', { vertical: true, wrap: false })
  expect(selected).toBe(29)
  expect(visible[selected]).toBe('file-29')
  expect(selectionIndex(selected, 3)).toBe(2)
  expect(selectionIndex(selected, 0)).toBe(-1)
  expect(navigationIndex(0, 0, 'ArrowDown', { vertical: true })).toBeNull()
  expect(navigationIndex(0, 30, 'ArrowUp', { vertical: true, wrap: false })).toBe(0)
  expect(navigationIndex(18, 30, 'Home', { vertical: true })).toBe(0)
  expect(navigationIndex(18, 30, 'End', { vertical: true })).toBe(29)
})

test('tab keys wrap within one visible group and ignore non-navigation keys', () => {
  expect(navigationIndex(2, 3, 'ArrowRight')).toBe(0)
  expect(navigationIndex(0, 3, 'ArrowLeft')).toBe(2)
  expect(navigationIndex(1, 3, 'Home')).toBe(0)
  expect(navigationIndex(1, 3, 'End')).toBe(2)
  expect(navigationIndex(1, 3, 'ArrowDown')).toBeNull()
  expect(navigationIndex(1, 3, 'Tab')).toBeNull()
})

test('real tab handler excludes hidden, disabled, inert and nested tabs before focus and manual activation', () => {
  const log = []
  const list = { querySelectorAll: () => tabs, scrollLeft: 0, getBoundingClientRect: () => ({ left: 0, right: 200 }) }
  function tab(name, overrides = {}) {
    const value = { name, closest: selector => selector === '[role="tab"]' ? value : selector === '[role="tablist"]' ? list : null, getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 50, right: 100 }), focus: options => log.push(['focus', name, options]), click: () => log.push(['click', name]), ...overrides }
    return value
  }
  const first = tab('first'), last = tab('last')
  const tabs = [first, tab('hidden', { getClientRects: () => [] }), tab('disabled', { disabled: true }), tab('inert', { closest: selector => selector === '[inert]' ? {} : list }), tab('nested', { closest: () => ({}) }), last]
  const event = { currentTarget: list, target: first, key: 'ArrowRight', preventDefault: () => log.push(['prevent']) }
  navigateTabList(event)
  expect(log).toEqual([['prevent'], ['focus', 'last', { preventScroll: true }], ['click', 'last']])
  log.length = 0
  navigateTabList({ ...event, target: last, key: 'Home' })
  expect(log.at(-1)).toEqual(['click', 'first'])
  log.length = 0
  navigateTabList({ ...event, target: { closest: () => null } })
  expect(log).toEqual([])
  navigateTabList({ ...event, metaKey: true })
  expect(log).toEqual([])
})

test('clipped editor tabs reveal only their own horizontal strip', () => {
  const list = { scrollLeft: 0, scrollTop: 11, getBoundingClientRect: () => ({ left: 400, right: 700 }) }
  revealListItem(list, { getBoundingClientRect: () => ({ left: 780, right: 860 }) }, { horizontal: true })
  expect(list.scrollLeft).toBe(160)
  expect(list.scrollTop).toBe(11)
  revealListItem(list, { getBoundingClientRect: () => ({ left: 300, right: 360 }) }, { horizontal: true })
  expect(list.scrollLeft).toBe(60)
})

test('active palette reveal scrolls only its list and keeps an already visible option still', () => {
  const list = { scrollTop: 100, getBoundingClientRect: () => ({ top: 200, bottom: 500 }) }
  revealListItem(list, { getBoundingClientRect: () => ({ top: 510, bottom: 550 }) })
  expect(list.scrollTop).toBe(150)
  revealListItem(list, { getBoundingClientRect: () => ({ top: 180, bottom: 220 }) })
  expect(list.scrollTop).toBe(130)
  revealListItem(list, { getBoundingClientRect: () => ({ top: 250, bottom: 290 }) })
  expect(list.scrollTop).toBe(130)
})
