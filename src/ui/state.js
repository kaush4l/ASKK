/**
 * What the UI knows, kept in one place and fed only by the hub.
 *
 * Every hub message marks some topics dirty; listeners are told once per animation frame with
 * the set of dirty topics, so a burst of status slots and events is one repaint. Streaming
 * deltas only touch `stream:<run>`, which the transcript answers by updating one text node.
 */

import { isActive, circling } from './words.js'

export function createState(hub) {
  const listeners = new Set()
  let dirty = new Set()
  let frame = 0

  const state = {
    hub,
    boot: { reading: false, read: false, build: '', agents: 0, done: 0, total: 0, ready: false, error: '', durable: true, why: '' },
    lock: 'starting',
    tookOver: 0,
    kept: new Map(), // id → run record from the runs store
    session: [], // main's saved turns
    approvals: [], // pending, oldest first
    decided: new Map(), // approval id → {approval, approved, note, always, by, at}
    sending: new Map(), // approval id → 'sending' | 'failed'
    seen: new Map(), // approval id → the approval as it was when pending
    boards: new Map(), // trace → {entries, released, at}
    opened: new Set(), // run ids opened in a thread view this page load
    stream: new Map(), // run → {raw, answering, reasoning}
    notes: [], // {run, agent, text, at, step}
    restarted: new Map(), // agent → at
    fatal: new Map(), // agent → message
    readyFailed: new Set(), // agents whose thread sent no ready
    lastCall: null, // {agent, ok, seconds, at, error}
    bridgePrev: null,
    bridgeRecovered: 0,
    reload: null,
    reloading: false,
    models: null, // last refresh {ids, at} | {error, at}
    announce: '',
    panelOpen: false,
    teamOpened: false,
    todos: new Map(), // run → [{text, status}], from `todo` messages

    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    touch(...topics) {
      for (const topic of topics) dirty.add(topic)
      if (frame) return
      const flush = () => {
        frame = 0
        const topicsNow = dirty
        dirty = new Set()
        for (const listener of [...listeners]) {
          try {
            listener(topicsNow)
          } catch (error) {
            console.error('UI render failed', error)
          }
        }
      }
      // A hidden tab gets no animation frames, but its title still has to say "awaiting you".
      frame = document.visibilityState === 'hidden' ? setTimeout(flush, 250) : requestAnimationFrame(flush)
    },
    say(text) {
      state.announce = text
      state.touch('announce')
    },

    // ─── reading ────────────────────────────────────────────────────────────
    leader: () => state.lock === 'leader',
    getRun(id) {
      return (id && (hub.run(id) ?? state.kept.get(id))) || null
    },
    slot(id) {
      return hub.runs.get(id)?.slot ?? state.kept.get(id)?.slot ?? null
    },
    /** Every run known to this page: kept ones, with this page load's live ones laid over them. */
    allRuns() {
      const all = new Map(state.kept)
      for (const run of hub.runs.values()) all.set(run.id, run)
      return [...all.values()]
    },
    /** main's runs at the top of a task, oldest first. */
    mainRuns() {
      return state
        .allRuns()
        .filter((run) => run.agent === 'main' && !run.parent)
        .sort((a, b) => a.at - b.at)
    },
    mainRun() {
      const live = [...hub.runs.values()].filter((run) => run.agent === 'main' && !run.parent).sort((a, b) => b.at - a.at)[0]
      return live ?? state.mainRuns().at(-1) ?? null
    },
    /** Runs of one task tree. */
    tree(trace) {
      return state.allRuns().filter((run) => (run.trace ?? run.slot?.trace) === trace)
    },
    activeRuns() {
      return [...hub.runs.values()].filter((run) => isActive(run.slot))
    },
    manifest() {
      try {
        return hub.manifest()
      } catch {
        return []
      }
    },
    row(path) {
      return state.manifest().find((row) => row.path === path) ?? null
    },
    /** main's resolved model id, or '' when there is none (D5). */
    mainModel() {
      return state.row('main')?.model ?? ''
    },
    agentNames() {
      return new Set(state.manifest().flatMap((row) => [row.name, row.path]))
    },
    awaitingFor(runId) {
      return state.approvals.filter((approval) => approval.run === runId)
    },
    /** The header's trouble part, counted. */
    trouble() {
      const failed = [...hub.runs.values()].filter((run) => run.slot?.status === 'failed' && !state.opened.has(run.id) && run.kind !== 'compact').length
      const threads = state.teamOpened ? 0 : state.readyFailed.size
      return {
        awaiting: state.approvals.length,
        circling: state.activeRuns().filter((run) => circling(run.slot)).length,
        failed: failed + threads,
        bridgeDown: hub.bridge.state().status === 'down',
      }
    },
    async loadKept() {
      try {
        const list = await hub.runsApi.list()
        state.kept = new Map(list.filter((record) => !hub.runs.has(record.id)).map((record) => [record.id, record]))
      } catch {
        // The runs store is a convenience; without it only this page load's runs show.
      }
      try {
        state.session = await hub.session('main')
      } catch {
        state.session = []
      }
      state.touch('runs', 'session', 'team')
    },
  }

  hub.subscribe((message) => onMessage(state, message))
  return state
}

function streamOf(state, run) {
  if (!state.stream.has(run)) state.stream.set(run, { raw: '', answering: false, reasoning: '' })
  return state.stream.get(run)
}

function onMessage(state, message) {
  const hub = state.hub
  switch (message.type) {
    case 'boot': {
      const boot = state.boot
      if (message.stage === 'agents') {
        boot.reading = true
        if ('build' in message) {
          boot.read = true
          boot.build = message.build
          boot.agents = message.total
          state.loadKept()
        }
      } else if (message.stage === 'threads') {
        boot.done = message.done
        boot.total = message.total
      } else if (message.stage === 'ready') {
        boot.ready = true
        boot.durable = message.durable
        boot.why = message.why ?? ''
        boot.build = message.build || boot.build
        state.lock = hub.lock()
        state.approvals = hub.approvalsApi.list()
        state.loadKept()
      }
      state.touch('boot', 'header', 'team')
      return
    }
    case 'lock':
      if (message.state === 'leader' && state.lock === 'follower') state.tookOver = Date.now()
      state.lock = message.state
      state.touch('lock', 'header', 'boot', 'runs', 'team')
      return
    case 'run':
      state.touch('runs', `run:${message.run.id}`, 'header', 'session')
      if (message.run.parent) state.touch(`run:${message.run.parent}`)
      return
    case 'status': {
      const previous = state.lastStatus?.get(message.run)
      state.lastStatus = state.lastStatus ?? new Map()
      state.lastStatus.set(message.run, message.slot.status)
      const run = hub.runs.get(message.run)
      if (run?.agent === 'main' && !run.parent && previous !== message.slot.status) state.say(`main ${message.slot.status}`)
      state.touch('runs', `run:${message.run}`, 'header')
      if (run?.parent) state.touch(`run:${run.parent}`)
      return
    }
    case 'event':
      onEvent(state, message)
      return
    case 'history':
      if (message.agent === 'main' && message.session) state.session = message.session
      state.touch(`run:${message.run}`, 'session', 'runs')
      return
    case 'answer': {
      const run = hub.runs.get(message.run)
      state.lastCall = { agent: message.agent, ok: message.ok, seconds: run?.slot?.seconds ?? 0, at: Date.now(), error: message.ok ? '' : run?.slot?.error ?? '' }
      state.stream.delete(message.run)
      state.touch('runs', `run:${message.run}`, 'header', 'settings', 'session')
      if (run?.parent) state.touch(`run:${run.parent}`)
      return
    }
    case 'approval':
      state.seen.set(message.approval.id, message.approval)
      state.approvals = hub.approvalsApi.list()
      state.say(`${message.approval.agent} asks to run ${message.approval.tool}`)
      state.touch('approvals', 'header', 'runs', `run:${message.approval.run}`)
      return
    case 'approved': {
      const approval = state.seen.get(message.id)
      const mine = state.sending.get(message.id)
      state.sending.delete(message.id)
      state.decided.set(message.id, { approval, approved: message.approved, note: message.note, always: mine?.always ?? false, by: message.by, at: Date.now() })
      state.approvals = hub.approvalsApi.list()
      if (!state.approvals.length) state.say('nothing awaiting you')
      state.touch('approvals', 'header', 'runs', `run:${message.run}`)
      return
    }
    case 'board':
      state.boards.set(message.trace, { entries: message.entries, released: message.released, at: Date.now() })
      state.touch('board', 'runs')
      return
    case 'memory':
    case 'dreams':
    case 'files':
    case 'skills':
      state.touch('team', 'dreams')
      return
    case 'mcp':
      state.touch('settings', 'mcp')
      return
    case 'schedules':
      state.touch('schedules', 'runs')
      return
    case 'todo':
      state.todos.set(message.run, message.items ?? [])
      state.touch(`run:${message.run}`)
      return
    case 'bridge': {
      const now = message.state.status
      if (state.bridgePrev === 'down' && now === 'answering') {
        state.bridgeRecovered = Date.now()
        state.say('bridge answering again')
      } else if (now === 'down' && state.bridgePrev !== 'down') state.say('bridge down')
      state.bridgePrev = now
      state.touch('bridge', 'header', 'team', 'settings')
      return
    }
    case 'settings':
      state.touch('settings', 'team', 'header', 'session')
      return
    case 'reloaded':
      state.reload = message.result
      state.reloading = false
      state.touch('team', 'settings')
      return
    case 'restarted':
      state.restarted.set(message.agent, message.at)
      state.touch('team', 'session', 'runs')
      return
    case 'ready':
      if (message.error) state.readyFailed.add(message.agent)
      state.touch('team', 'header', 'session')
      return
    case 'fatal':
      state.fatal.set(message.agent, message.message)
      state.touch('runs', 'header')
      return
    default:
      state.touch('runs')
  }
}

function onEvent(state, event) {
  const run = event.run
  switch (event.kind) {
    case 'delta': {
      streamOf(state, run).raw += event.value
      state.touch(`stream:${run}`)
      return
    }
    case 'reasoning':
      streamOf(state, run).reasoning += event.value
      state.touch(`stream:${run}`)
      return
    case 'field':
      if (event.name === 'do' && String(event.value).trim().toLowerCase() === 'done') streamOf(state, run).answering = true
      state.touch(`stream:${run}`)
      return
    case 'prompt': {
      const stream = streamOf(state, run)
      stream.raw = ''
      stream.answering = false
      state.touch(`run:${run}`)
      return
    }
    case 'heard': {
      const note = state.notes.find((item) => item.run === run && item.step == null && item.text === event.value)
      if (note) note.step = event.step
      state.touch(`run:${run}`, 'session')
      return
    }
    case 'answer':
    case 'error':
      state.touch(`run:${run}`, 'settings')
      return
    default:
      state.touch(`run:${run}`, 'runs')
  }
}
