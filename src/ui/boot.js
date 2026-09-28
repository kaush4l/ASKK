/**
 * BootScreen and OtherTabBanner (UX U10). Boot steps appear as they complete; they do not
 * animate. A second tab renders what it can read and disables every sending control.
 */

import { h } from './dom.js'

export function bootScreen(state) {
  const boot = state.boot
  const lines = [h('p', { class: 'wordmark-big' }, 'HARNESS')]
  if (boot.error) {
    lines.push(h('p', { class: 'bad' }, `Could not read agents/index.json (${boot.error}). The page was built without its agents, or the dev server is not regenerating it.`))
  } else {
    if (boot.reading) lines.push(h('p', { class: 'num' }, boot.read ? `Read ${boot.agents} agents · build ${boot.build}` : 'Reading agents…'))
    if (boot.total) lines.push(h('p', { class: 'num' }, `Starting threads · ${boot.done} of ${boot.total}`))
    if (!boot.reading) lines.push(h('p', { class: 'dim' }, 'Opening storage…'))
  }
  return h('section', { class: 'view boot', testid: 'boot', 'aria-live': 'polite' }, lines)
}

export function otherTabBanner(state) {
  if (state.lock === 'follower') return h('div', { class: 'top-banner', testid: 'other-tab', role: 'status' }, 'HARNESS is running in another tab. This tab takes over when that one closes.')
  if (state.tookOver && Date.now() - state.tookOver < 4000) return h('div', { class: 'top-banner', testid: 'other-tab', role: 'status' }, 'This tab is running HARNESS now.')
  return null
}
