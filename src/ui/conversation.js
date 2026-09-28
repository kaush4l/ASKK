/**
 * Conversation with main (`#/`, UX U5): Transcript, DayDivider, Turn, WorkLine, NoteLine,
 * WorkingLine, EmptyState, InterruptedBanner, StaleLine, Composer, StopButton.
 *
 * The transcript is built from main's saved session turns (they carry their time), each
 * question matched to the run that answered it so its work lines come from the run's record.
 * Blocks are cached by key and rebuilt only when their signature changes; streaming text
 * updates one text node per run.
 */

import { stages } from '../core/calls.js'
import { add, dot, h, isTouch, twoPress } from './dom.js'
import { clock, day, duration, sameDay } from './time.js'
import { workFromTurns, workLine, workOf, slotTick } from './work.js'
import { circling, circlingWords, isActive, mark, plural } from './words.js'

const scanCalls = (text) => {
  try {
    return stages(text)
  } catch {
    return []
  }
}

export function mountConversation(el, state) {
  const hub = state.hub
  const blocks = new Map() // key → {sig, el}
  const streams = new Map() // run → {el, text, reasoning}
  let dismissed = ''
  let resuming = ''
  let stopping = ''
  let pinned = true

  const transcript = h('div', { class: 'transcript', testid: 'transcript', role: 'log', 'aria-label': 'Conversation with main' })
  const empty = h('div', { class: 'empty-wrap' })
  const working = h('p', { class: 'working-line', testid: 'working-line', hidden: true })
  const jump = h('button', { type: 'button', class: 'jump', hidden: true, onclick: () => scrollDown(true) }, 'Jump to latest')

  // ─── composer ──────────────────────────────────────────────────────────────
  const banner = h('div', { class: 'banner', testid: 'interrupted', hidden: true })
  const input = h('textarea', { class: 'composer-input', rows: 1, 'aria-label': 'Ask main', placeholder: 'Ask main' })
  const send = h('button', { type: 'button', class: 'primary', testid: 'send' }, 'Send')
  const stop = twoPress('Stop', () => {
    const run = state.mainRun()
    const n = run ? hub.below(run.id) : 0
    return n ? `Stop main and ${n} below` : 'Stop main'
  }, () => {
    const run = state.mainRun()
    if (!run) return
    stopping = run.id
    hub.send(run.id, { type: 'abort' })
    paint(new Set(['session']))
  }, { class: 'danger', testid: 'stop', hidden: true })
  const stale = h('p', { class: 'faint small stale', testid: 'stale', hidden: true })
  const composer = h('form', { class: 'composer', testid: 'composer', onsubmit: (event) => (event.preventDefault(), submit()) }, input, h('div', { class: 'composer-actions' }, send, stop))
  const dock = h('div', { class: 'dock' }, banner, composer, stale)

  const root = h('section', { class: 'view conversation', testid: 'conversation' }, empty, transcript, working, jump, dock)
  add(el, root)

  const grow = () => {
    input.style.height = 'auto'
    const line = parseFloat(getComputedStyle(input).lineHeight) || 24
    input.style.height = `${Math.min(input.scrollHeight, line * 8 + 16)}px`
  }
  input.addEventListener('input', grow)
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || isTouch()) return
    event.preventDefault()
    submit()
  })
  send.addEventListener('click', (event) => {
    event.preventDefault()
    submit()
  })

  function submit() {
    const text = input.value.trim()
    if (!text || input.disabled) return
    const run = state.mainRun()
    if (run && isActive(run.slot) && hub.runs.has(run.id)) {
      hub.send(run.id, { type: 'nudge', text })
      state.notes.push({ run: run.id, agent: 'main', text, at: Date.now(), step: null })
    } else {
      hub.ask(text)
      pinned = true
    }
    input.value = ''
    grow()
    state.touch('session', 'runs')
  }

  // ─── scrolling ─────────────────────────────────────────────────────────────
  const atBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 48
  const onScroll = () => {
    pinned = atBottom()
    jump.hidden = pinned || !transcript.childElementCount
  }
  addEventListener('scroll', onScroll, { passive: true })
  function scrollDown(force) {
    if (!force && !pinned) return
    pinned = true
    jump.hidden = true
    scrollTo({ top: document.documentElement.scrollHeight })
  }

  // ─── the transcript ────────────────────────────────────────────────────────
  function exchanges() {
    const list = []
    let current = null
    for (const turn of state.session) {
      if (turn.role === 'user' && !turn.note) {
        current = { query: turn.content, at: turn.at ?? 0, turns: [] }
        list.push(current)
      } else if (current) current.turns.push(turn)
      else if (turn.role === 'summary') list.push({ summary: turn.content, at: turn.at ?? 0 })
    }
    const runs = state.mainRuns()
    const used = new Set()
    for (const ex of list) {
      if (ex.summary != null) continue
      let best = null
      let distance = Infinity
      for (const run of runs) {
        if (used.has(run.id) || run.query !== ex.query) continue
        const gap = Math.abs((ex.at || run.at) - run.at)
        if (gap < distance) {
          best = run
          distance = gap
        }
      }
      if (best) {
        used.add(best.id)
        ex.run = best.id
      }
    }
    // Runs the session does not hold: just started, queued, or folded away by compaction.
    for (const run of runs) if (!used.has(run.id)) list.push({ query: run.query, at: run.at, turns: run.turns ?? [], run: run.id })
    return list.sort((a, b) => a.at - b.at)
  }

  function streamFor(runId) {
    if (!streams.has(runId)) {
      const text = h('div', { class: 'turn-answer streaming', testid: 'turn-answer' })
      const reasoningText = h('div', { class: 'dim small pre' })
      const reasoning = h('details', { class: 'reasoning', hidden: true }, h('summary', { class: 'faint' }, 'Reasoning'), reasoningText)
      streams.set(runId, { text, reasoning, reasoningText })
    }
    return streams.get(runId)
  }

  function paintStream(runId) {
    const stream = state.stream.get(runId)
    const node = streams.get(runId)
    if (!node || !stream) return
    if (stream.answering) {
      const match = [...stream.raw.matchAll(/(^|\n)\s*act:[ \t]*/g)].at(-1)
      node.text.textContent = match ? stream.raw.slice(match.index + match[0].length) : ''
    }
    if (stream.reasoning) {
      node.reasoning.hidden = false
      node.reasoningText.textContent = stream.reasoning
    }
    scrollDown(false)
  }

  function signature(ex) {
    const run = ex.run ? state.getRun(ex.run) : null
    const kids = (run?.children ?? []).map((id) => {
      const slot = state.slot(id)
      return `${slot?.status}${slot?.error ?? ''}`
    })
    return JSON.stringify([
      ex.query,
      ex.summary,
      ex.turns.length,
      run?.slot?.status,
      run?.slot?.error,
      run?.log?.length,
      kids,
      run?.result?.length,
      state.approvals.map((approval) => approval.id),
      state.decided.size,
      state.notes.filter((note) => note.run === ex.run).map((note) => note.step),
      state.leader(),
    ])
  }

  function block(ex) {
    if (ex.summary != null) return h('p', { class: 'faint small system' }, 'Earlier turns were folded into one summary.')
    const run = ex.run ? state.getRun(ex.run) : null
    const out = h('div', { class: 'exchange', dataset: { run: ex.run ?? '' } })
    add(out,
      h('div', { class: 'turn-user', testid: 'turn-user' }, h('div', { class: 'turn-text' }, ex.query), h('div', { class: 'num faint small' }, clock(ex.at))),
    )
    const items = []
    if (run) {
      const lines = workOf(state, run)
      const groups = new Map()
      for (const line of lines) {
        if (!groups.has(line.stage)) groups.set(line.stage, [])
        groups.get(line.stage).push(line)
      }
      for (const group of groups.values()) {
        const stageEl = h('div', { class: group.length > 1 ? 'stage multi' : 'stage' }, group.map((line) => workLine(state, run, line)))
        items.push({ at: group[0].at ?? 0, el: stageEl })
      }
      const heard = (run.log ?? []).filter((entry) => entry.kind === 'heard')
      for (const entry of heard) items.push({ at: entry.at, el: noteLine('main', entry.value, entry.step) })
      for (const note of state.notes.filter((item) => item.run === run.id && item.step == null)) {
        if (!heard.some((entry) => entry.value === note.text && entry.at >= note.at)) items.push({ at: note.at, el: noteLine('main', note.text, null) })
      }
      for (const entry of (run.log ?? []).filter((item) => item.kind === 'retry')) {
        const match = /\((\d+ of \d+)\)/.exec(entry.value)
        items.push({ at: entry.at, el: h('p', { class: 'bad small' }, `Model call failed · retrying (${match?.[1] ?? '…'})`) })
      }
    } else {
      const lines = workFromTurns(ex.turns, scanCalls)
      const fake = { id: `t${ex.at}`, slot: { status: 'done' }, log: [], children: [] }
      let at = 0
      const groups = new Map()
      for (const line of lines) {
        if (!groups.has(line.stage)) groups.set(line.stage, [])
        groups.get(line.stage).push(line)
      }
      for (const group of groups.values()) items.push({ at: (at += 1), el: h('div', { class: group.length > 1 ? 'stage multi' : 'stage' }, group.map((line) => workLine(state, fake, line))) })
      for (const turn of ex.turns.filter((item) => item.role === 'user' && item.note)) items.push({ at: turn.at ?? at, el: noteLine('main', turn.content, 'read') })
    }
    items.sort((a, b) => a.at - b.at)
    if (items.length) add(out, h('div', { class: 'work' }, items.map((item) => item.el)))

    const active = run && isActive(run.slot) && hub.runs.has(run.id)
    if (active) {
      const stream = streamFor(run.id)
      add(out, stream.reasoning, stream.text)
      queueMicrotask(() => paintStream(run.id))
    } else if (run?.slot?.status === 'failed') {
      add(out,
        h('p', { class: 'bad stopped' }, `main stopped: ${run.slot.error || 'failed'} `, h('a', { href: `#/run/${run.id}` }, 'Open the thread')),
      )
    } else if (run?.slot?.status === 'interrupted') {
      // The banner above the composer says so; the partial work stays visible.
    } else {
      const last = ex.turns.at(-1)
      const text = run?.slot?.status === 'done' && run.result ? run.result : last?.role === 'assistant' ? last.content : ''
      if (text) add(out, h('div', { class: 'turn-answer', testid: 'turn-answer' }, text))
    }
    return out
  }

  function noteLine(agent, text, step) {
    const words = step == null ? 'waiting for next step' : step === 'read' ? 'read' : `read at step ${step}`
    return h('div', { class: 'note-line', testid: 'note-line' }, h('p', { class: 'small dim' }, `Note for ${agent} · ${words}`), h('p', { class: 'small' }, text))
  }

  function paintTranscript() {
    const list = exchanges()
    const keep = new Set()
    let previous = 0
    const nodes = []
    for (const ex of list) {
      if (ex.at && (!previous || !sameDay(previous, ex.at))) nodes.push(h('div', { class: 'day-divider', testid: 'day-divider' }, h('span', {}, day(ex.at))))
      if (ex.at) previous = ex.at
      const key = ex.run ?? `s:${ex.at}:${ex.query ?? 'summary'}`
      keep.add(key)
      const sig = signature(ex)
      let cached = blocks.get(key)
      if (!cached || cached.sig !== sig) {
        cached = { sig, el: block(ex) }
        blocks.set(key, cached)
      }
      nodes.push(cached.el)
    }
    for (const key of [...blocks.keys()]) if (!keep.has(key)) blocks.delete(key)
    // Only move nodes that are out of place, so an open fold or focused field is not disturbed.
    const current = [...transcript.children]
    const same = current.length === nodes.length && current.every((node, index) => node === nodes[index] || (node.classList.contains('day-divider') && nodes[index].classList?.contains('day-divider') && node.textContent === nodes[index].textContent))
    if (!same) transcript.replaceChildren(...nodes)
    return list
  }

  // ─── the rest ──────────────────────────────────────────────────────────────
  function paintEmpty(list) {
    empty.replaceChildren()
    const model = state.mainModel()
    const row = state.row('main')
    const tools = (row?.tools ?? []).filter((item) => item.tier !== 'agent')
    const agents = row ? [...new Set([...(row.tools ?? []).filter((item) => item.tier === 'agent').map((item) => item.name), ...(row.peers ?? []), ...(row.owned ?? []).map((path) => path.split('/').pop())])] : []
    const derived = row && !row.broken ? h('p', { class: 'derived' }, `main can use ${plural(tools.length, 'tool')} and ask ${plural(agents.length, 'agent')}${agents.length ? `: ${agents.join(', ')}` : ''}. `, h('a', { href: '#/team' }, 'See the team')) : null
    if (!model && state.boot.read) {
      add(empty,
        h(
          'div',
          { class: 'empty', testid: 'empty' },
          h('h1', {}, 'No model yet'),
          h('p', {}, 'HARNESS brings no model. Point it at one and main can answer.'),
          h('a', { class: 'button primary', href: '#/settings' }, 'Connect a model'),
          derived,
        ),
      )
    } else if (!list.length && derived) {
      add(empty, h('div', { class: 'empty quiet', testid: 'empty' }, derived))
    }
  }

  function paintDock() {
    const run = state.mainRun()
    const live = run && hub.runs.has(run.id)
    const active = live && isActive(run.slot)
    const row = state.row('main')
    const reason = !state.leader() ? 'Running in another tab' : !row || row.broken ? 'main did not load — see Team' : !state.mainModel() ? 'Connect a model first' : ''
    input.disabled = Boolean(reason) || !state.boot.ready
    send.disabled = input.disabled
    input.placeholder = reason || (active ? 'Add a note main reads before its next step' : 'Ask main')
    input.setAttribute('aria-label', input.placeholder)
    send.textContent = active ? 'Note' : 'Send'
    stop.hidden = !active || Boolean(reason)
    if (stopping && run?.id === stopping && active) {
      stop.textContent = 'Stopping…'
      stop.disabled = true
    } else if (stop.disabled) {
      stopping = ''
      stop.disabled = false
      stop.textContent = 'Stop'
    }

    // Working line
    if (active) {
      const tree = run.trace ?? run.id
      const awaiting = state.approvals.some((approval) => approval.trace === tree)
      const m = mark(run.slot.status, { awaiting })
      working.hidden = false
      working.replaceChildren(
        dot(m.dot),
        h('span', { class: `tone-${m.tone}` }, m.word),
        ` · step ${run.slot.steps} of ${run.slot.maxSteps} · `,
        h('span', { class: 'num', dataset: slotTick(run.slot) }, duration(run.slot.seconds)),
        circling(run.slot) ? h('span', { class: 'bad' }, ` · ${circlingWords(run.slot)}`) : null,
      )
    } else working.hidden = true

    // Interrupted banner
    const cut = run && run.slot?.status === 'interrupted' && dismissed !== run.id ? run : null
    banner.hidden = !cut
    if (cut) {
      const lastAt = (cut.turns ?? []).at(-1)?.at ?? cut.at
      const resumeButton = h('button', { type: 'button', class: 'primary', disabled: !state.leader() || Boolean(resuming) }, 'Resume')
      resumeButton.addEventListener('click', async () => {
        resuming = cut.id
        paintDock()
        await hub.send(cut.id, { type: 'resume' })
        state.touch('session')
      })
      banner.replaceChildren(
        h('p', {}, resuming === cut.id ? `Resuming from step ${cut.slot.steps}…` : `The last turn was cut off when the tab closed at ${clock(lastAt)}.`),
        h('div', { class: 'row' }, resumeButton, h('button', { type: 'button', class: 'link', onclick: () => ((dismissed = cut.id), paintDock()) }, 'Dismiss')),
      )
    } else resuming = ''

    // Stale line
    const restarted = state.restarted.get('main')
    stale.hidden = !(row?.stale || restarted)
    stale.textContent = row?.stale ? 'main restarts with your edits when this turn ends.' : restarted ? `main restarted with your edits at ${clock(restarted)}.` : ''
  }

  function paint(topics) {
    const heavy = ['session', 'runs', 'approvals', 'boot', 'lock', 'settings', 'team'].some((topic) => topics.has(topic)) || [...topics].some((topic) => topic.startsWith('run:'))
    if (heavy) {
      const list = paintTranscript()
      paintEmpty(list)
      paintDock()
      scrollDown(false)
    }
    for (const topic of topics) if (topic.startsWith('stream:')) paintStream(topic.slice('stream:'.length))
  }

  const off = state.on(paint)
  paint(new Set(['session']))
  requestAnimationFrame(() => {
    scrollDown(true)
    if (!input.disabled && !isTouch()) input.focus()
  })
  return () => {
    off()
    removeEventListener('scroll', onScroll)
    root.remove()
  }
}
