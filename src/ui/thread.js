/**
 * Thread (`#/run/<id>`, UX U7): SlotHeader, TroubleBlock, ApprovalCard or NowBlock, NudgeBox,
 * AbortButton, Timeline, TraceExportButton, HistoryList, PromptSheet. The evidence register.
 * The id is looked up in this page load's runs first, then the runs store.
 */

import { approvalCard, approvalRecord } from './approval.js'
import { stages } from '../core/calls.js'
import { add, details, dot, download, h, mono, twoPress } from './dom.js'
import { clock, day, duration, moment, ms, sameDay } from './time.js'
import { slotTick } from './work.js'
import { callName, circling, circlingWords, isActive, mark, splitCurrent } from './words.js'

const promptStep = new Map() // run → step shown

export function mountThread(el, state, id) {
  const hub = state.hub
  const root = h('section', { class: 'view thread', testid: 'thread' })
  add(el, root)
  let record = null
  let aborting = false
  let exportNote = ''
  let focused = false
  state.opened.add(id)
  state.touch('header')

  const noteInput = h('input', { type: 'text', class: 'field grow' })
  const sendNote = h('button', { type: 'button', class: 'primary' }, 'Send note')
  const submitNote = () => {
    const text = noteInput.value.trim()
    if (!text) return
    hub.send(id, { type: 'nudge', text })
    state.notes.push({ run: id, agent: record?.agent, text, at: Date.now(), step: null })
    noteInput.value = ''
    state.touch(`run:${id}`)
  }
  sendNote.addEventListener('click', submitNote)
  noteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitNote()
    }
  })
  const abort = twoPress('Abort', () => {
    const n = hub.below(id)
    return n ? `Abort this run and ${n} below` : 'Abort this run'
  }, () => {
    aborting = true
    hub.send(id, { type: 'abort' })
    paint()
  }, { class: 'danger', testid: 'abort' })
  const nudgeBox = h('div', { class: 'nudge', testid: 'nudge' }, noteInput, h('div', { class: 'row' }, sendNote, abort))

  async function load() {
    record = state.getRun(id)
    if (!record) record = (await hub.runsApi.get(id)) ?? null
    paint()
  }

  function childLinks(ids) {
    return ids.map((child, index) => [index ? ', ' : '', h('a', { href: `#/run/${child}`, class: 'mono' }, state.getRun(child)?.agent ?? child)])
  }

  function slotHeader(run, slot) {
    const m = mark(slot.status, { awaiting: state.approvals.some((approval) => approval.run === run.id) })
    const pairs = [
      ['status', [dot(m.dot), h('span', { class: `tone-${m.tone}` }, m.word)]],
      ['step', `${slot.steps} of ${slot.maxSteps}`],
      ['time', h('span', { class: 'num', dataset: slotTick(slot) }, duration(slot.seconds))],
      ['model', slot.model || state.row(run.agent)?.model || '—'],
    ]
    if (run.parent) pairs.push(['called by', h('a', { href: `#/run/${run.parent}`, class: 'mono' }, state.getRun(run.parent)?.agent ?? run.parent)])
    pairs.push(['depth', String(run.depth ?? 0)])
    if (run.kind === 'scheduled') pairs.push(['started by', 'a schedule'])
    pairs.push(['started', moment(slot.startedAt || run.at)])
    const trace = run.trace ?? slot.trace
    if (trace && trace !== run.id) pairs.push(['trace', h('a', { href: `#/run/${trace}`, class: 'mono' }, trace)])
    return h(
      'dl',
      { class: 'slot-grid', testid: 'slot' },
      pairs.map(([label, value]) => h('div', { class: 'pair' }, h('dt', { class: 'faint small' }, label), h('dd', { class: 'num' }, value))),
    )
  }

  function trouble(run, slot) {
    const out = []
    if (slot.status === 'failed') {
      const died = /^the thread stopped: (.*)$/s.exec(slot.error ?? '')
      out.push(h('p', { class: 'trouble-block' }, died ? `The thread stopped: ${died[1]}. Its caller was told.` : `Stopped: ${slot.error || 'failed'}`))
    }
    if (circling(slot)) out.push(h('p', { class: 'trouble-block' }, `${circlingWords(slot).replace('same', 'Same')}: ${splitCurrent(slot.current).call}`))
    if (slot.status === 'interrupted') {
      const lastAt = (run.turns ?? []).at(-1)?.at ?? run.at
      const resume = h('button', { type: 'button', class: 'primary', disabled: !state.leader() }, 'Resume')
      const words = h('span', {}, `Cut off when the tab closed at ${clock(lastAt)}. `)
      resume.addEventListener('click', async () => {
        resume.disabled = true
        words.textContent = `Resuming from step ${slot.steps}… `
        const next = await hub.send(run.id, { type: 'resume' })
        if (next) location.hash = `#/run/${next}`
      })
      out.push(h('div', { class: 'trouble-block' }, words, resume))
    }
    return out.length ? h('div', { testid: 'thread-trouble' }, out) : null
  }

  function now(run, slot) {
    const pending = state.approvals.filter((approval) => approval.run === run.id)
    if (pending.length) return h('div', { class: 'now' }, pending.map((approval) => approvalCard(state, approval, 'thread')))
    if (!isActive(slot) || !hub.runs.has(run.id)) return null
    const { call, more } = splitCurrent(slot.current)
    const waiting = (run.children ?? []).filter((child) => isActive(state.slot(child)))
    let body
    if (slot.status === 'waiting' && waiting.length) body = [dot('ring'), 'waiting on ', childLinks(waiting)]
    else if (call) body = [dot('pulse'), h('code', { class: 'mono ellipsis' }, call), more ? ` +${more}` : '', ' ', h('span', { class: 'num dim', dataset: slotTick(slot) }, duration(slot.seconds))]
    else body = [dot('pulse'), slot.status]
    return h('div', { class: 'now', testid: 'now' }, h('h3', { class: 'faint small' }, 'Now'), h('p', {}, body))
  }

  function timeline(run, slot) {
    const spans = run.spans ?? []
    const children = (run.children ?? []).map((child) => state.getRun(child)).filter(Boolean)
    const childOf = (name) => children.find((child) => child.call === name)
    const start = slot.startedAt || run.at
    const end = Math.max(start + 1, ...spans.map((span) => span.start + (span.ms ?? Date.now() - span.start)), isActive(slot) ? Date.now() : start + (slot.seconds || 0) * 1000)
    const total = end - start
    let model = 0
    let tools = 0
    let agents = 0
    for (const span of spans) {
      if (span.kind === 'step') model += span.ms ?? 0
      else if (span.kind === 'call') childOf(span.name) ? (agents += span.ms ?? 0) : (tools += span.ms ?? 0)
    }
    const summary = h('span', {}, `Timeline · ${ms(total)} · model ${ms(model)} · tools ${ms(tools)} · agents ${ms(agents)}`)
    return details(`timeline:${run.id}`, summary, () => {
      if (!spans.length) return h('p', { class: 'faint small' }, 'No spans yet.')
      const rows = [...spans].sort((a, b) => a.start - b.start).map((span) => {
        const child = span.kind === 'call' ? childOf(span.name) : null
        const width = span.ms ?? Date.now() - span.start
        const bar = h('span', {
          class: `bar ${span.kind === 'step' ? 'bar-step' : span.ok === false ? 'bar-bad' : 'bar-call'}`,
          style: { left: `${((span.start - start) / total) * 100}%`, width: `max(2px, ${(width / total) * 100}%)` },
        })
        const label = span.kind === 'step' ? `step ${span.step}` : span.kind === 'approval' ? 'approval' : child ? child.agent : callName(span.name)
        const readout = span.kind === 'step' ? `${ms(width)}  ${(span.tokens ?? 0).toLocaleString()} tok` : `${ms(width)}  ${span.ok === false ? 'failed' : span.ms == null ? '…' : 'ok'}`
        return h(
          'div',
          { class: 'span-row' },
          h('span', { class: 'mono span-label ellipsis', title: span.name ?? label }, label),
          h('span', { class: 'track' }, bar),
          h('span', { class: 'num small span-readout' }, readout),
          child ? h('a', { href: `#/run/${child.id}`, class: 'chev', 'aria-label': `Open ${child.agent}` }, '›') : h('span', { class: 'chev' }),
        )
      })
      return h('div', { class: 'spans' }, h('div', { class: 'span-row faint small' }, h('span', {}, ''), h('span', {}, ''), h('span', { class: 'span-readout' }, 'tok (est.)'), h('span', {})), rows)
    }, { testid: 'timeline', class: 'section timeline' })
  }

  function history(run) {
    const turns = run.turns ?? []
    if (!turns.length && hub.runs.has(run.id) && isActive(run.slot)) return h('p', { class: 'faint' }, 'Waiting for the thread’s history…')
    const items = []
    const heard = (run.log ?? []).filter((entry) => entry.kind === 'heard')
    const children = (run.children ?? []).map((child) => state.getRun(child)).filter(Boolean)
    const bound = new Set()
    let step = 0
    turns.forEach((turn, index) => {
      const at = turn.at ?? 0
      if (turn.role === 'user' && turn.note) {
        const read = heard.find((entry) => entry.value === turn.content)
        items.push({ at, el: noteLine(turn.content, read?.step ?? 'read') })
      } else if (turn.role === 'user') {
        items.push({ at, el: h('div', { class: 'hist-user' }, h('span', { class: 'gutter faint small' }, index === 0 ? 'task' : 'user'), h('div', { class: 'pre' }, turn.content)) })
      } else if (turn.role === 'assistant') {
        step += 1
        const calls = stagesSafe(turn.content)
        const links = []
        for (const call of calls.flat()) {
          const child = children.find((item) => !bound.has(item.id) && item.call === call.text)
          if (child) {
            bound.add(child.id)
            links.push(h('a', { href: `#/run/${child.id}`, class: 'small' }, `${child.agent} ›`))
          }
        }
        items.push({ at, el: h('div', { class: 'hist-step' }, h('span', { class: 'gutter faint small num' }, `step ${step}`), h('div', { class: 'grow' }, mono(turn.content), links.length ? h('p', { class: 'links' }, links) : null)) })
      } else if (turn.role === 'observation') {
        items.push({ at, el: h('div', { class: 'hist-obs' }, h('span', { class: 'gutter faint small' }, 'saw'), mono(turn.content)) })
      } else if (turn.role === 'summary') {
        items.push({ at, el: h('div', { class: 'hist-obs' }, h('span', { class: 'gutter faint small' }, 'summary'), mono(turn.content)) })
      }
    })
    for (const note of state.notes.filter((item) => item.run === run.id && item.step == null)) {
      if (!turns.some((turn) => turn.note && turn.content === note.text)) items.push({ at: note.at, el: noteLine(note.text, null) })
    }
    for (const entry of run.log ?? []) {
      const system = { repair: 1, retry: 1, budget: 1, compacted: 1, final: 1, note: 1 }
      if (!system[entry.kind]) continue
      const bad = entry.kind === 'budget' && /90/.test(entry.value)
      items.push({ at: entry.at, el: h('p', { class: `system small ${bad ? 'bad' : 'faint'}` }, entry.value) })
    }
    for (const decision of state.decided.values()) if (decision.approval?.run === run.id) items.push({ at: decision.at, el: approvalRecord(decision) })
    const restarted = state.restarted.get(run.agent)
    if (restarted && restarted >= (run.at ?? 0)) items.push({ at: restarted, el: h('p', { class: 'system small faint' }, `restarted with your edits at ${clock(restarted)}`) })
    items.sort((a, b) => a.at - b.at)
    const out = h('div', { class: 'history', testid: 'history' }, h('h3', {}, 'History'))
    let previous = 0
    for (const item of items) {
      if (item.at && previous && !sameDay(previous, item.at)) add(out, h('div', { class: 'day-divider' }, h('span', {}, day(item.at))))
      if (item.at) previous = item.at
      add(out, item.el)
    }
    return out
  }

  function noteLine(text, step) {
    const words = step == null ? 'waiting for next step' : step === 'read' ? 'read' : `read at step ${step}`
    return h('div', { class: 'note-line', testid: 'note-line' }, h('p', { class: 'small dim' }, `Note · ${words}`), h('p', { class: 'small' }, text))
  }

  function promptSheet(run) {
    const prompts = run.prompts ?? []
    if (!prompts.length) return h('section', { class: 'section', testid: 'prompt' }, h('p', { class: 'faint' }, 'No prompt yet. The first step has not been composed.'))
    const steps = prompts.map((prompt) => prompt.step)
    let shown = promptStep.get(run.id)
    if (!steps.includes(shown)) shown = steps.at(-1)
    const current = prompts.find((prompt) => prompt.step === shown)
    const summary = h('span', {}, `Prompt at step ${shown} · ${(current.tokens ?? 0).toLocaleString()} tokens`)
    return details(`prompt:${run.id}`, summary, () => {
      const index = steps.indexOf(shown)
      const go = (delta) => {
        promptStep.set(run.id, steps[index + delta])
        paint()
      }
      const copy = h('button', { type: 'button', class: 'link' }, 'Copy')
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(current.sheet)
          copy.textContent = 'Copied'
        } catch {
          copy.textContent = 'Could not copy'
        }
      })
      return h(
        'div',
        {},
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'small' }, 'Step '),
          h('button', { type: 'button', class: 'link', disabled: index <= 0, 'aria-label': 'Earlier prompt', onclick: () => go(-1) }, '‹'),
          h('span', { class: 'num' }, ` ${shown} `),
          h('button', { type: 'button', class: 'link', disabled: index >= steps.length - 1, 'aria-label': 'Later prompt', onclick: () => go(1) }, '›'),
          h('span', { class: 'grow' }),
          copy,
        ),
        h('pre', { class: 'prompt-sheet', testid: 'prompt-sheet', tabIndex: 0 }, current.sheet),
      )
    }, { testid: 'prompt', class: 'section' })
  }

  /** The run's own plan (todo_write), as a compact checklist. */
  function todoList(run) {
    const items = state.todos.get(run.id) ?? hub.runs.get(run.id)?.todo ?? run.todo ?? []
    if (!items.length) return null
    const marks = { todo: '[ ]', doing: '[›]', done: '[x]', dropped: '[–]' }
    return h(
      'section',
      { class: 'section', testid: 'todo' },
      h('h3', {}, `Plan · ${items.filter((item) => item.status === 'done').length} of ${items.length} done`),
      h('ul', { class: 'todo' }, items.map((item) => h('li', { class: item.status }, h('span', { class: 'mark', 'aria-hidden': 'true' }, marks[item.status] ?? '[ ]'), h('span', {}, item.text), h('span', { class: 'sr-only' }, ` (${item.status})`)))),
    )
  }

  function exportButton(run) {
    const trace = run.trace ?? run.slot?.trace ?? run.id
    const button = h('button', { type: 'button', class: 'link', testid: 'export-trace' }, 'Export trace')
    button.addEventListener('click', async () => {
      exportNote = 'Preparing…'
      paint()
      try {
        download(`harness-trace-${trace}.json`, await hub.traces.export(trace))
        exportNote = 'One JSON file of the whole task. It is saved to your computer and sent nowhere.'
      } catch (error) {
        exportNote = `Could not build the trace: ${error?.message ?? error}`
      }
      paint()
    })
    return button
  }

  function paint() {
    const fresh = state.getRun(id)
    if (fresh) record = fresh
    const back = h('a', { href: state.fromPanel && innerWidth < 1100 ? '#/' : '#/', class: 'back', onclick: backClick }, state.fromPanel && innerWidth < 1100 ? '← Runs' : '← Conversation')
    if (!record) {
      root.replaceChildren(back, h('h1', { tabIndex: -1 }, 'This run was not kept.'), h('p', { class: 'dim' }, 'HARNESS keeps the last 200 runs; its answer is in the work line that called it.'), h('a', { href: '#/' }, '← Conversation'))
      return
    }
    const slot = record.slot ?? {}
    const active = isActive(slot) && hub.runs.has(record.id)
    if (aborting && !active) aborting = false
    abort.disabled = aborting
    if (aborting) abort.textContent = 'Aborting…'
    noteInput.placeholder = `Note for ${record.agent}, read before its next step`
    noteInput.setAttribute('aria-label', noteInput.placeholder)
    noteInput.disabled = sendNote.disabled = !state.leader()
    const title = h('h1', { class: 'thread-title mono', tabIndex: -1 }, record.agent)
    const goal = h('p', { class: 'goal clamp3' }, record.query ?? slot.goal ?? '')
    const more = h('button', { type: 'button', class: 'link small', onclick: () => (goal.classList.toggle('clamp3'), more.remove()) }, 'more')
    const nodes = [
      back,
      h('div', { class: 'thread-head' }, h('div', {}, title, h('span', { class: 'faint small mono run-id' }, record.id)), h('div', { class: 'export' }, exportButton(record), exportNote ? h('p', { class: 'faint small' }, exportNote) : null)),
      slotHeader(record, slot),
      h('div', { class: 'goal-wrap' }, h('span', { class: 'faint small' }, 'goal'), goal, String(record.query ?? '').split('\n').length > 3 || String(record.query ?? '').length > 240 ? more : null),
      trouble(record, slot),
      now(record, slot),
      active ? nudgeBox : null,
      todoList(record),
      timeline(record, slot),
      history(record),
      promptSheet(record),
    ]
    const hadFocus = document.activeElement === noteInput
    root.replaceChildren(...nodes.filter(Boolean))
    if (hadFocus) noteInput.focus()
    if (!focused) {
      focused = true
      title.focus({ preventScroll: true })
    }
  }

  function backClick(event) {
    if (state.fromPanel && innerWidth < 1100) {
      event.preventDefault()
      state.fromPanel = false
      location.hash = '#/'
      state.openPanel?.()
    }
  }

  const off = state.on((topics) => {
    if (topics.has(`run:${id}`) || topics.has('approvals') || topics.has('lock') || topics.has('boot')) paint()
  })
  load()
  return () => {
    off()
    root.remove()
  }
}

function stagesSafe(text) {
  try {
    return stages(text)
  } catch {
    return []
  }
}
