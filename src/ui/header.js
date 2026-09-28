/**
 * Header (UX U4): wordmark, StatusLine (state part + TroubleCount), view links, TitleBadge and
 * the polite live region. The state part shortens to fit; the trouble part never drops.
 */

import { add, dot, h } from './dom.js'
import { callName, circling, isActive, mark, splitCurrent } from './words.js'

export function mountHeader(el, state, { onToggle }) {
  const hub = state.hub
  const mark1 = h('a', { href: '#/', class: 'wordmark', 'aria-label': 'HARNESS, conversation' }, h('span', { class: 'long' }, 'HARNESS'), h('span', { class: 'short' }, 'H'))
  const statePart = h('span', { class: 'state-part' })
  const troublePart = h('span', { class: 'trouble', testid: 'trouble' })
  const status = h('button', { type: 'button', class: 'status-line', testid: 'status-line', 'aria-controls': 'runs-panel', 'aria-expanded': 'false' }, statePart, troublePart)
  status.addEventListener('click', () => onToggle())
  const team = h('a', { href: '#/team', class: 'nav', dataset: { view: 'team' } }, 'Team')
  const settings = h('a', { href: '#/settings', class: 'nav', dataset: { view: 'settings' } }, 'Settings')
  const links = h('nav', { class: 'links', 'aria-label': 'Views' }, team, settings)
  const menuList = h('div', { class: 'menu-list', hidden: true })
  const menu = h('button', { type: 'button', class: 'menu-button', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, 'Menu')
  menu.addEventListener('click', () => {
    menuList.hidden = !menuList.hidden
    menu.setAttribute('aria-expanded', String(!menuList.hidden))
  })
  menuList.addEventListener('click', () => {
    menuList.hidden = true
    menu.setAttribute('aria-expanded', 'false')
  })
  const menuWrap = h('div', { class: 'menu' }, menu, menuList)
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' })
  const header = h('header', { class: 'header', testid: 'header' }, mark1, status, links, menuWrap, live)
  add(el, header)

  let spoken = ''
  let pendingCount = 0

  /** The state part, longest first; the shortest that fits is used. */
  function stateVariants() {
    const boot = state.boot
    if (!boot.ready && state.lock !== 'follower') {
      return [[h('span', { class: 'dim' }, boot.total ? `starting · ${boot.done} of ${boot.total} threads` : 'starting')], [h('span', { class: 'dim' }, 'starting')]]
    }
    if (state.lock === 'follower') return [[h('span', { class: 'dim' }, 'running in another tab')], [h('span', { class: 'dim' }, 'other tab')]]
    if (!state.mainModel()) return [[h('span', {}, 'no model')]]
    const run = state.mainRun()
    const main = run && hub.runs.has(run.id) && isActive(run.slot) ? run.slot : null
    const others = state.activeRuns().filter((item) => item.id !== run?.id)
    if (main) {
      const awaiting = state.approvals.some((approval) => approval.trace === (run.trace ?? run.id))
      const m = mark(main.status, { awaiting: false })
      const { call, more } = splitCurrent(main.current)
      const name = call ? callName(call) : ''
      const child = main.status === 'waiting' && name ? `on ${name}` : name
      const troubled = others.some((item) => circling(item.slot)) || awaiting
      const running = others.length && !troubled ? ` · ${others.length} running` : ''
      const plus = more ? ` +${more}` : ''
      const lead = (text) => [dot(m.dot), h('span', {}, text)]
      const variants = []
      if (child) variants.push(lead(`main ${m.word} ${child}${plus}${running}`), lead(`main ${m.word} ${child}${plus}`), lead(`main ${m.word} ${child}`))
      variants.push(lead(`main ${m.word}`), lead(m.word))
      return variants
    }
    const dreaming = others.some((item) => item.kind === 'dream' || item.agent === 'dreamer')
    if (dreaming && others.every((item) => item.kind === 'dream')) return [[dot('pulse'), h('span', { class: 'dim' }, 'dreaming')]]
    if (others.length) return [[dot('pulse'), h('span', {}, `${others.length} running`)]]
    return [[h('span', { class: 'faint' }, 'idle')]]
  }

  function trouble(short) {
    const counts = state.trouble()
    const items = []
    if (counts.awaiting) items.push(h('strong', {}, `${counts.awaiting} awaiting you`))
    if (counts.circling) items.push(`${counts.circling} circling`)
    if (counts.failed) items.push(`${counts.failed} failed`)
    if (counts.bridgeDown) items.push('bridge down')
    const out = []
    items.forEach((item, index) => {
      if (index || !short) out.push(' · ')
      out.push(item)
    })
    return { out, counts }
  }

  function paint() {
    const narrow = matchMedia('(max-width: 600px)').matches
    const { out, counts } = trouble(false)
    troublePart.replaceChildren(...out)
    troublePart.hidden = !out.length
    const variants = stateVariants()
    for (const variant of variants) {
      statePart.replaceChildren(...variant.filter(Boolean))
      if (!narrow || status.scrollWidth <= status.clientWidth + 1) break
    }
    status.setAttribute('aria-expanded', String(state.panelOpen))
    // Page title: the one signal outside the page.
    pendingCount = counts.awaiting
    document.title = pendingCount ? `(${pendingCount}) awaiting you — HARNESS` : 'HARNESS'
    const route = location.hash.replace(/^#\/?/, '').split('/')[0]
    for (const link of [team, settings]) {
      const current = link.dataset.view === route
      if (current) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }
    const proposals = state.pendingProposals ?? 0
    team.textContent = proposals ? `Team · ${proposals}` : 'Team'
    menuList.replaceChildren(team.cloneNode(true), settings.cloneNode(true))
    if (state.announce && state.announce !== spoken) {
      spoken = state.announce
      live.textContent = state.announce
    }
  }

  const off = state.on(paint)
  addEventListener('hashchange', paint)
  addEventListener('resize', paint)
  paint()
  return {
    focus: () => status.focus(),
    unmount: () => {
      off()
      header.remove()
    },
  }
}
