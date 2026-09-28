/**
 * The page: Shell, routing by URL hash, the Runs panel, and the one-second tick.
 *
 *     #/            Conversation with main
 *     #/run/<id>    Thread
 *     #/team        Team
 *     #/settings    Settings
 *
 * The hub is the only backend. It is constructed here and started once; the UI subscribes
 * before it starts, so boot progress and the follower-tab state are shown as they happen.
 */

import { Hub } from '../runtime/hub.js'
import { bootScreen, otherTabBanner } from './boot.js'
import { mountConversation } from './conversation.js'
import { add, h } from './dom.js'
import { mountHeader } from './header.js'
import { mountRuns } from './runs.js'
import { mountSettings } from './settings.js'
import { createState } from './state.js'
import { mountTeam } from './team.js'
import { mountThread } from './thread.js'
import { duration } from './time.js'

const hub = new Hub({ base: document.baseURI })
const state = createState(hub)
globalThis.harness = { hub, state } // for the console and the smoke; the page never reads it

const PANEL_KEY = 'harness:runs-open'
const store = {
  get: () => {
    try {
      return localStorage.getItem(PANEL_KEY) === '1'
    } catch {
      return false
    }
  },
  set: (open) => {
    try {
      localStorage.setItem(PANEL_KEY, open ? '1' : '0')
    } catch {
      // Remembering the panel is a convenience.
    }
  },
}

// ─── the shell ───────────────────────────────────────────────────────────────
const shell = h('div', { class: 'shell', testid: 'shell' })
const headerSlot = h('div', { class: 'header-slot' })
const banner = h('div', { class: 'banner-slot' })
const main = h('main', { class: 'main', id: 'main', tabIndex: -1 })
const panelSlot = h('div', { class: 'panel-slot' })
add(shell, headerSlot, banner, h('div', { class: 'body' }, main, panelSlot))
document.body.replaceChildren(shell)

const header = mountHeader(headerSlot, state, { onToggle: () => togglePanel() })
const runs = mountRuns(panelSlot, state, { onClose: () => setPanel(false, true) })

function setPanel(open, returnFocus = false) {
  state.panelOpen = open
  document.body.classList.toggle('panel-open', open)
  runs.panel.hidden = !open
  store.set(open)
  if (open) runs.paint()
  if (!open && returnFocus) header.focus()
  state.touch('header')
}

function togglePanel() {
  if (state.approvals.length && !state.panelOpen) {
    setPanel(true)
    requestAnimationFrame(() => runs.focusAwaiting())
    return
  }
  if (state.approvals.length && state.panelOpen && runs.focusAwaiting()) return
  setPanel(!state.panelOpen)
  if (state.panelOpen) runs.panel.focus()
}
state.openPanel = () => setPanel(true)
setPanel(store.get())

addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.panelOpen) setPanel(false, true)
})
runs.panel.addEventListener('click', (event) => {
  if (!event.target.closest('a.run-row')) return
  state.fromPanel = true
  if (innerWidth < 1100) setPanel(false)
})

// ─── routing ─────────────────────────────────────────────────────────────────
let unmount = null
let mounted = ''

function route() {
  const hash = location.hash.replace(/^#\/?/, '')
  const ready = state.boot.ready || (state.lock === 'follower' && state.boot.read)
  const key = ready ? hash : `boot:${state.boot.error ? 'error' : ''}`
  if (key === mounted && ready) return
  if (!ready) {
    unmount?.()
    unmount = null
    mounted = key
    main.replaceChildren(bootScreen(state))
    return
  }
  unmount?.()
  main.replaceChildren()
  mounted = key
  const [view, id] = hash.split('/')
  if (view === 'run' && id) unmount = mountThread(main, state, decodeURIComponent(id))
  else if (view === 'team') unmount = mountTeam(main, state)
  else if (view === 'settings') unmount = mountSettings(main, state)
  else unmount = mountConversation(main, state)
  if (view !== 'run') scrollTo({ top: view ? 0 : document.documentElement.scrollHeight })
  if (view !== 'run' && !state.fromPanel) state.fromPanel = false
  state.touch('header')
}

addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/run/')) state.fromPanel = false
  route()
})

let bannerKey = ''
state.on((topics) => {
  if (topics.has('boot') || topics.has('lock')) {
    if (!state.boot.ready && !(state.lock === 'follower' && state.boot.read)) main.replaceChildren(bootScreen(state))
    route()
  }
  const next = otherTabBanner(state)
  const key = next?.textContent ?? ''
  if (key !== bannerKey) {
    bannerKey = key
    banner.replaceChildren(...(next ? [next] : []))
    if (state.tookOver) setTimeout(() => state.touch('lock'), 4100)
  }
  if (topics.has('dreams') || topics.has('boot')) countProposals()
})

async function countProposals() {
  try {
    const list = await hub.dreams.list()
    const pending = list.filter((item) => item.status === 'pending').length
    if (pending !== state.pendingProposals) {
      state.pendingProposals = pending
      state.touch('header')
    }
  } catch {
    // Storage not open yet.
  }
}

// ─── the one-second tick: seconds advance locally, nothing re-renders ────────
setInterval(() => {
  const now = Date.now()
  for (const el of document.querySelectorAll('[data-tick]')) {
    if (el.dataset.tick === 'slot') el.textContent = duration(Number(el.dataset.s0) + (now - Number(el.dataset.t0)) / 1000)
    else if (el.dataset.tick === 'since') el.textContent = `${el.dataset.prefix ?? ''}${duration((now - Number(el.dataset.t0)) / 1000)}`
  }
}, 1000)

// ─── the keyboard on phones: keep the composer above it ─────────────────────
if (globalThis.visualViewport) {
  const inset = () => {
    const kb = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)
    document.documentElement.style.setProperty('--kb', `${kb}px`)
  }
  visualViewport.addEventListener('resize', inset)
  visualViewport.addEventListener('scroll', inset)
}

route()
hub.start().catch((error) => {
  state.boot.error = String(error?.message ?? error)
  state.touch('boot', 'team')
  console.warn('HARNESS did not start:', state.boot.error)
})
