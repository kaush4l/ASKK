/**
 * The Runs panel (UX U6): Awaiting you, Running (the tree of active runs), Board — this task,
 * Finished. Docked right at ≥1100px; a bottom sheet below that.
 */

import { approvalCard } from './approval.js'
import { add, dot, h } from './dom.js'
import { clock, duration } from './time.js'
import { circling, circlingWords, isActive, mark, splitCurrent } from './words.js'
import { slotTick } from './work.js'

const KINDS = ['question', 'plan', 'finding', 'note']

export function mountRuns(el, state, { onClose }) {
  const hub = state.hub
  let finishedOpen = null
  let resolvedOpen = false
  const body = h('div', { class: 'panel-body' })
  const close = h('button', { type: 'button', class: 'link', 'aria-label': 'Close the Runs panel', onclick: () => onClose() }, 'Close')
  const handle = h('div', { class: 'grab', 'aria-hidden': 'true' })
  const panel = h(
    'aside',
    { class: 'runs-panel', id: 'runs-panel', testid: 'runs', 'aria-label': 'Runs', tabIndex: -1 },
    handle,
    h('div', { class: 'panel-head' }, h('h2', {}, 'Runs'), close),
    body,
  )
  const scrim = h('div', { class: 'scrim', onclick: () => onClose() })
  add(el, scrim, panel)

  // Swipe down on the handle closes the sheet.
  let startY = null
  handle.addEventListener('pointerdown', (event) => (startY = event.clientY))
  addEventListener('pointerup', (event) => {
    if (startY != null && event.clientY - startY > 60) onClose()
    startY = null
  })

  function row(run, depth) {
    const slot = run.slot
    const awaiting = state.approvals.some((approval) => approval.run === run.id)
    const m = mark(slot.status, { awaiting })
    const fraction = slot.maxSteps ? slot.steps / slot.maxSteps : 0
    const budget = fraction >= 0.9 ? 'bad' : fraction >= 0.7 ? 'strong' : 'dim'
    const { call, more } = splitCurrent(slot.current)
    const defaultModel = state.row(run.agent)?.model
    const lines = [
      h(
        'div',
        { class: 'run-line1' },
        dot(m.dot),
        h('span', { class: 'mono agent' }, run.agent, run.kind === 'scheduled' ? h('span', { class: 'faint small' }, ' · scheduled') : null),
        h('span', { class: `tone-${m.tone} word` }, m.word),
        h('span', { class: `num ${budget}` }, `${slot.steps}/${slot.maxSteps}`),
        h('span', { class: 'num dim', dataset: slotTick(slot) }, duration(slot.seconds)),
      ),
    ]
    if (call && isActive(slot)) {
      lines.push(
        h(
          'div',
          { class: 'run-line2 mono small' },
          circling(slot) ? h('span', { class: 'bad' }, `${circlingWords(slot)} · `) : null,
          h('span', { class: 'ellipsis' }, call),
          more ? ` +${more}` : '',
        ),
      )
    } else if (circling(slot)) lines.push(h('div', { class: 'run-line2 small bad' }, circlingWords(slot)))
    if (slot.status === 'failed' && slot.error) lines.push(h('div', { class: 'run-line2 small bad ellipsis' }, slot.error))
    if (slot.model && defaultModel && slot.model !== defaultModel) lines.push(h('div', { class: 'faint small' }, slot.model))
    return h('a', { class: 'run-row', testid: 'run-row', href: `#/run/${run.id}`, dataset: { agent: run.agent, status: slot.status }, style: { paddingLeft: `${12 + depth * 16}px` } }, lines)
  }

  function tree(runs, rootId) {
    const byParent = new Map()
    for (const run of runs) {
      const key = run.parent ?? ''
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key).push(run)
    }
    for (const list of byParent.values()) list.sort((a, b) => (a.slot.startedAt || a.at) - (b.slot.startedAt || b.at))
    const out = []
    const ids = new Set(runs.map((run) => run.id))
    const walk = (run, depth) => {
      out.push(row(run, depth))
      for (const child of byParent.get(run.id) ?? []) walk(child, depth + 1)
    }
    for (const run of runs) if (!run.parent || !ids.has(run.parent)) walk(run, 0)
    return out
  }

  function boardSection(trace) {
    const board = state.boards.get(trace) ?? hub.board(trace)
    if (!board?.entries?.length) return null
    const open = board.entries.filter((entry) => !entry.resolved)
    const resolved = board.entries.filter((entry) => entry.resolved)
    const entry = (item, faint) =>
      h(
        'div',
        { class: `board-entry${faint ? ' faint' : ''}` },
        h('span', { class: `mono dim kind${faint ? ' struck' : ''}` }, item.kind),
        h('span', { class: 'board-text' }, item.text),
        h('span', { class: 'faint small' }, `${item.author} · rev ${item.rev}`),
      )
    const out = h('section', { class: 'panel-section', testid: 'board' }, h('h3', {}, 'Board — this task', h('span', { class: 'faint small right' }, `${open.length} open`)))
    for (const kind of KINDS) for (const item of open.filter((x) => x.kind === kind)) add(out, entry(item, false))
    if (resolved.length) {
      const details = h('details', { open: resolvedOpen }, h('summary', {}, `Resolved · ${resolved.length}`), resolved.map((item) => entry(item, true)))
      details.addEventListener('toggle', () => (resolvedOpen = details.open))
      add(out, details)
    }
    if (board.released) add(out, h('p', { class: 'faint small' }, `The board was released when the task ended at ${clock(board.at ?? Date.now())}.`))
    return out
  }

  function paint() {
    const nodes = []
    if (!state.leader() && state.lock === 'follower') {
      body.replaceChildren(h('p', { class: 'dim' }, 'Runs are in the other tab.'))
      return
    }
    // Awaiting you
    if (state.approvals.length) {
      nodes.push(h('section', { class: 'panel-section', testid: 'awaiting' }, h('h3', { class: 'bad' }, `Awaiting you · ${state.approvals.length}`), state.approvals.map((approval) => approvalCard(state, approval, 'panel'))))
    }
    const root = state.mainRun()
    const trace = root?.trace ?? root?.id
    const live = [...hub.runs.values()]
    const task = trace ? state.tree(trace) : []
    const running = live.filter((run) => isActive(run.slot) && (run.trace === trace || run.kind === 'dream' || run.kind === 'compact'))
    const other = live.filter((run) => isActive(run.slot) && !running.includes(run))
    const all = [...running, ...other]
    const circles = all.filter((run) => circling(run.slot)).length
    const tasks = new Map()
    for (const run of all) {
      const key = run.trace ?? run.id
      if (!tasks.has(key)) tasks.set(key, [])
      tasks.get(key).push(run)
    }
    const runningSection = h('section', { class: 'panel-section', testid: 'running' }, h('h3', {}, `Running · ${all.length}${circles ? ` · ` : ''}`, circles ? h('span', { class: 'bad' }, `${circles} circling`) : null))
    if (!all.length) add(runningSection, h('p', { class: 'dim small' }, 'Nothing running.'))
    for (const [key, runs] of tasks) {
      const top = state.getRun(key)
      if (top?.kind === 'dream' || runs.every((run) => run.kind === 'dream')) {
        const reviewing = state.getRun(hub.lastDream?.trace)
        add(runningSection, h('p', { class: 'dim small' }, `Dreaming over the task from ${clock(reviewing?.at ?? top?.at)}`))
      }
      add(runningSection, ...tree(runs, key))
    }
    const finished = task.filter((run) => !isActive(run.slot) && run.slot?.status !== 'idle').sort((a, b) => b.at - a.at)
    if (!all.length && !finished.length && !state.approvals.length) {
      body.replaceChildren(h('p', { class: 'dim', testid: 'runs-empty' }, 'No runs yet. Runs appear here when main starts working.'))
      return
    }
    nodes.push(runningSection)
    const board = trace ? boardSection(trace) : null
    if (board) nodes.push(board)
    if (finished.length) {
      const failed = finished.filter((run) => run.slot.status === 'failed').length
      const open = finishedOpen ?? (failed > 0 || !all.length)
      const details = h(
        'details',
        { class: 'panel-section', open, testid: 'finished' },
        h('summary', {}, `Finished · ${finished.length}`, failed ? h('span', { class: 'bad' }, ` · ${failed} failed`) : null),
        finished.map((run) => row(run, 0)),
      )
      details.addEventListener('toggle', () => (finishedOpen = details.open))
      nodes.push(details)
    }
    body.replaceChildren(...nodes)
  }

  const off = state.on((topics) => {
    if (!state.panelOpen) return
    if (['runs', 'approvals', 'board', 'lock', 'boot', 'header'].some((topic) => topics.has(topic)) || [...topics].some((topic) => topic.startsWith('run:'))) paint()
  })
  return {
    panel,
    paint,
    focusAwaiting() {
      const card = panel.querySelector('[data-testid="awaiting"] .approval')
      if (!card) return false
      card.scrollIntoView({ block: 'start' })
      const call = card.querySelector('.approval-call, pre')
      if (call) {
        call.tabIndex = -1
        call.focus()
      }
      return true
    },
    unmount() {
      off()
      panel.remove()
      scrim.remove()
    },
  }
}
