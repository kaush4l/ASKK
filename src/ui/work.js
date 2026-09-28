/**
 * Work lines (UX U5.2): one line per call a run made, derived from the run's record.
 *
 * A line is created by a `call` entry. Its child run is bound by id: the run's `children`, in
 * order, each carrying the verbatim call text that started it (the hub's `event child`), so two
 * identical calls in one stage bind in order. The line never looks a child up by agent name.
 */

import { approvalCard, approvalRecord } from './approval.js'
import { add, dot, h, mono } from './dom.js'
import { ms } from './time.js'
import { callName, isActive, mark, verb } from './words.js'

const expanded = new Map() // `${run}:${key}` → true | false (owner's choice)

/** The calls of one run as lines, grouped by stage. */
export function workOf(state, run) {
  const lines = []
  const bound = new Set()
  const agents = state.agentNames()
  let stage = 0
  let last = ''
  for (const entry of run.log ?? []) {
    if (entry.kind === 'call') {
      if (last !== 'call') stage += 1
      const text = String(entry.value ?? '')
      let child = null
      for (const id of run.children ?? []) {
        if (bound.has(id)) continue
        const record = state.getRun(id)
        if (record && (record.call === text || String(record.call).slice(0, 4000) === text)) {
          child = id
          bound.add(id)
          break
        }
      }
      const name = entry.name || callName(text)
      lines.push({ key: lines.length, stage, name, text, child, agent: child || agents.has(name), at: entry.at, obs: null, ms: null, ok: null, decision: '' })
    } else if (entry.kind === 'observation') {
      const line = lines.find((item) => item.obs == null && item.text === entry.name) ?? lines.find((item) => item.obs == null)
      if (line) {
        line.obs = String(entry.value ?? '')
        line.ms = entry.ms
        line.ok = entry.ok
      }
    } else if (entry.kind === 'approved') {
      const line = [...lines].reverse().find((item) => item.name === entry.name && item.obs == null)
      if (line) line.decision = entry.value
    }
    if (entry.kind === 'call' || entry.kind === 'observation') last = entry.kind
  }
  for (const line of lines) {
    if (line.obs?.startsWith('refused by policy:')) line.denied = 'policy'
    else if (line.decision === 'denied' || line.obs?.startsWith('the owner refused this call')) line.denied = 'owner'
  }
  return lines
}

/** Work lines from saved turns alone, for a turn whose run is no longer kept. */
export function workFromTurns(turns, scanCalls) {
  const lines = []
  let stage = 0
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]
    const next = turns[index + 1]
    if (turn.role !== 'assistant' || next?.role !== 'observation') continue
    const stages = scanCalls(turn.content)
    let rest = String(next.content ?? '')
    for (const group of stages) {
      stage += 1
      for (const call of group) {
        const marker = `${call.text} -> `
        const at = rest.indexOf(marker)
        let obs = ''
        if (at !== -1) {
          const after = rest.slice(at + marker.length)
          obs = after
          rest = after
        }
        lines.push({ key: lines.length, stage, name: call.name, text: call.text, child: null, agent: false, obs, ms: null, ok: true, old: true })
      }
    }
  }
  // Each observation ran to the next call's marker; trim at the following marker.
  for (let index = 0; index < lines.length - 1; index += 1) {
    const next = lines[index + 1]
    const cut = lines[index].obs.indexOf(`\n${next.text} -> `)
    if (cut !== -1) lines[index].obs = lines[index].obs.slice(0, cut)
  }
  return lines
}

/** The approvals, pending and answered, that belong under a line of `run`. */
export function approvalsUnder(state, run, line) {
  const belongs = (approvalRun, call) => {
    if (approvalRun === run.id) return call === line.text
    // A call anywhere below an agent call: follow parents up to this run.
    let up = state.getRun(approvalRun)
    while (up && up.parent && up.parent !== run.id) up = state.getRun(up.parent)
    return Boolean(up && up.parent === run.id && up.id === line.child)
  }
  const pending = state.approvals.filter((approval) => belongs(approval.run, approval.call))
  const done = [...state.decided.entries()].filter(([, decision]) => decision.approval && belongs(decision.approval.run, decision.approval.call)).map(([id, decision]) => ({ id, decision }))
  return { pending, done }
}

/** One work line as an element. `place` names where it is drawn, for approval cards. */
export function workLine(state, run, line, { place = 'transcript' } = {}) {
  const key = `${run.id}:${line.key}`
  const { pending, done } = approvalsUnder(state, run, line)
  const running = line.obs == null && isActive(run.slot)
  const auto = running && !line.agent
  const open = expanded.has(key) ? expanded.get(key) : auto
  const childSlot = line.child ? state.slot(line.child) : null
  const childName = line.child ? state.getRun(line.child)?.agent : line.name
  const words = verb(line.name, { agent: line.agent ? childName : null })

  const right = h('span', { class: 'work-right' })
  if (pending.length) add(right, h('span', { class: 'bad' }, 'waiting on you'))
  else if (line.denied === 'owner') add(right, h('span', { class: 'dim' }, 'denied by you'))
  else if (line.denied === 'policy') add(right, h('span', { class: 'bad' }, 'denied'))
  else if (line.agent && line.child && childSlot) {
    const m = mark(childSlot.status, { awaiting: state.approvals.some((approval) => approval.run === line.child) })
    if (isActive(childSlot)) {
      add(right, dot(m.dot), h('span', { class: `tone-${m.tone}` }, `${m.word} `), h('span', { class: 'num', dataset: slotTick(childSlot) }, ms(childSlot.seconds * 1000)))
    } else if (childSlot.status === 'failed') add(right, h('span', { class: 'bad' }, 'failed'))
    else add(right, h('span', { class: `tone-${m.tone}` }, `${m.word} `), h('span', { class: 'num dim' }, ms(childSlot.seconds * 1000)))
  } else if (line.agent && !line.child && line.obs != null) {
    add(right, h('span', { class: 'faint' }, 'run not kept · answer below'))
  } else if (line.obs == null) {
    if (running) add(right, dot('pulse'), h('span', {}, 'running'))
    else add(right, h('span', { class: 'faint' }, '—'))
  } else if (line.ok === false) add(right, h('span', { class: 'bad' }, 'failed'))
  else if (line.ms != null) add(right, h('span', { class: 'num dim' }, ms(line.ms)))
  const link = line.child && childSlot ? h('a', { href: `#/run/${line.child}`, class: 'chev', 'aria-label': `Open ${childName}'s thread` }, '›') : null

  const body = h('div', { class: 'work-body' })
  const head = h(
    'button',
    { type: 'button', class: 'work-head', 'aria-expanded': String(open), 'aria-label': `${words}: ${line.text}` },
    h('span', { class: 'caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
    h('span', { class: 'work-verb' }, words),
    right,
  )
  const row = h('div', { class: 'work-row' }, head, link)
  const el = h('div', { class: 'work-line', testid: 'work-line', dataset: { run: run.id, child: line.child ?? '' } }, row, body)
  let isOpen = open
  const drawBody = () => {
    body.replaceChildren()
    if (!isOpen) return
    if (line.denied && line.obs) add(body, mono(line.obs))
    add(body, mono(line.text))
    if (line.obs != null && !line.denied) add(body, mono(line.obs))
  }
  head.addEventListener('click', () => {
    isOpen = !isOpen
    expanded.set(key, isOpen)
    head.setAttribute('aria-expanded', String(isOpen))
    head.firstChild.textContent = isOpen ? '▾' : '▸'
    drawBody()
  })
  drawBody()
  for (const approval of pending) add(el, approvalCard(state, approval, place))
  for (const { decision } of done) add(el, approvalRecord(decision))
  return el
}

/** Group lines by stage; a stage with several lines gets the rule bar on its left. */
export function workList(state, run, lines, options) {
  const out = h('div', { class: 'work' })
  let group = null
  let stage = -1
  const count = new Map()
  for (const line of lines) count.set(line.stage, (count.get(line.stage) ?? 0) + 1)
  for (const line of lines) {
    if (line.stage !== stage) {
      stage = line.stage
      group = h('div', { class: count.get(stage) > 1 ? 'stage multi' : 'stage' })
      add(out, group)
    }
    add(group, workLine(state, run, line, options))
  }
  return out
}

/** Tick data for a live slot: seconds advance locally from the last slot. */
export function slotTick(slot) {
  return isActive(slot) ? { tick: 'slot', s0: String(slot.seconds ?? 0), t0: String(Date.now()) } : {}
}
