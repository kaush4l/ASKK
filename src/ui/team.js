/**
 * Team (`#/team`, UX U8): ReloadButton, ReloadResult, ProposalsSection + ProposalCard, shared
 * soul, shared memory, broken folders, and one AgentRow per agent with its notes, tools and
 * their ToolPolicy, MemoryList, LearnedLayer and files.
 */

import { decide, withAgentRules } from '../core/permissions.js'
import { add, details, download, h, twoPress } from './dom.js'
import { clock, moment, when } from './time.js'
import { plural } from './words.js'

const CAP = 2000
const TIERS = ['local', 'common', 'built-in', 'agent']
const proposalText = new Map() // id → edited text
const decidedHere = new Map() // proposal id → {kind, at, agent}
const editing = new Map() // memory id → text
const learnedChanged = new Set()
const writeResult = new Map() // agent → text
const scheduleForm = { agent: 'main', query: '', every: '', in: '', error: '' }

export function mountTeam(el, state) {
  const hub = state.hub
  const root = h('section', { class: 'view team', testid: 'team' })
  add(el, root)
  state.teamOpened = true
  state.touch('header')
  let data = { memory: [], dreams: [], learned: new Map() }
  let loading = 0

  async function load() {
    const ticket = ++loading
    try {
      const rows = state.manifest()
      const [memory, dreams, learned] = await Promise.all([
        hub.memory.list().catch(() => []),
        hub.dreams.list().catch(() => []),
        Promise.all(rows.filter((row) => !row.broken).map(async (row) => [row.path, await hub.learned.get(row.path).catch(() => '')])),
      ])
      if (ticket !== loading) return
      data = { memory, dreams, learned: new Map(learned) }
    } catch {
      // A store that cannot be read shows empty lists; the rest of Team still renders.
    }
    paint()
  }

  // ─── reload ────────────────────────────────────────────────────────────────
  const reload = h('button', { type: 'button', class: 'primary', testid: 'reload-agents' }, 'Reload agents')
  reload.addEventListener('click', async () => {
    state.reloading = true
    paint()
    try {
      await hub.reloadAgents()
      learnedChanged.clear()
    } catch (error) {
      state.boot.error = String(error?.message ?? error)
    }
    state.reloading = false
    load()
  })

  function reloadResult() {
    const result = state.reload
    if (!result) return null
    const head = `Reloaded ${clock(result.at)} · build ${result.build}`
    const groups = []
    const group = (title, items, cls = '') => items.length && groups.push(h('div', { class: `reload-group ${cls}` }, h('h4', {}, `${title} (${items.length})`), items))
    group('Failed', result.failed.map((item) => h('p', { class: 'mono small bad' }, `agents/${item.path}/agent.md — ${item.error}`)), 'bad')
    group('Changed', result.changed.map((item) => h('p', { class: 'mono small' }, h('span', { class: 'col' }, item.path), item.files.map((file) => (file.startsWith('agents/') ? file : `agents/${item.path}/${file}`)).join(', '))))
    group('Added', result.added.map((path) => h('p', { class: 'mono small' }, h('span', { class: 'col' }, path), `agents/${path}/agent.md`)))
    group('Removed', result.removed.map((path) => h('p', { class: 'mono small' }, path)))
    group(
      'Waiting to restart',
      result.stale.map((path) => {
        const at = state.restarted.get(path)
        return h('p', { class: 'mono small' }, h('span', { class: 'col' }, path), at && at >= result.at ? `restarted ${clock(at)}` : 'restarts with your edits when its turn ends')
      }),
    )
    return h('section', { class: 'section reload-result', testid: 'reload-result' }, h('p', { class: 'num' }, groups.length ? head : `${head} · nothing changed.`), groups)
  }

  // ─── proposals ─────────────────────────────────────────────────────────────
  function proposals(rows) {
    const hasDreamer = rows.some((row) => row.path === 'dreamer' && !row.broken)
    const pending = data.dreams.filter((item) => item.status === 'pending' || decidedHere.has(item.id))
    const order = rows.map((row) => row.path)
    pending.sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent) || a.at - b.at)
    state.pendingProposals = data.dreams.filter((item) => item.status === 'pending').length
    const last = hub.dreams.last()
    const dreamRun = last ? state.getRun(last.run) : null
    const dreaming = [...hub.runs.values()].some((run) => run.kind === 'dream' && !run.ended)
    const finishedTask = [...hub.runs.values()].some((run) => !run.parent && run.kind === 'task' && run.ended)
    const dreamNow = h('button', { type: 'button', class: 'link', testid: 'dream-now', disabled: dreaming || !finishedTask || !state.leader() }, dreaming ? 'Dreaming…' : finishedTask ? 'Dream now' : 'Nothing to dream over yet')
    dreamNow.addEventListener('click', async () => {
      await hub.dreams.run()
      state.touch('team')
    })
    const out = h('section', { class: 'section', testid: 'proposals' }, h('div', { class: 'section-head' }, h('h2', {}, `Proposals · ${state.pendingProposals}`), hasDreamer ? dreamNow : null))
    if (!hasDreamer) {
      add(out, h('p', { class: 'dim' }, 'There is no agents/dreamer/agent.md, so nothing dreams.'))
      return out
    }
    if (last) {
      const saved = data.memory.filter((entry) => entry.source === 'dream' && entry.at >= last.at).length
      const made = data.dreams.filter((item) => item.dream === last.run).length
      const reviewed = state.getRun(last.trace)
      if (dreamRun?.slot?.status === 'failed') add(out, h('p', { class: 'bad' }, `The last dream failed: ${dreamRun.slot.error} · `, h('a', { href: `#/run/${last.run}` }, 'Open run')))
      else add(out, h('p', { class: 'dim small' }, `Last dream ${clock(last.at)} over the task from ${clock(reviewed?.at ?? last.at)} · saved ${plural(saved, 'memory', 'memories')} · ${plural(made, 'proposal')} · `, h('a', { href: `#/run/${last.run}` }, 'Open run')))
    }
    if (!pending.length) {
      add(out, h('p', { class: 'dim' }, last ? `Nothing to propose from the task at ${clock(state.getRun(last.trace)?.at ?? last.at)}.` : 'No proposals. After a task has been idle for 20s, the dreamer reads it and suggests what each agent could learn. Nothing it suggests changes a prompt until you accept it.'))
      return out
    }
    for (const proposal of pending) add(out, proposalCard(proposal))
    return out
  }

  function proposalCard(proposal) {
    const done = decidedHere.get(proposal.id)
    if (done) {
      return h('p', { class: 'small dim', testid: 'proposal' }, done.kind === 'accepted' ? `Added to ${proposal.agent}'s learned layer · ${clock(done.at)} · takes effect at ${proposal.agent}'s next step` : `Rejected · ${clock(done.at)}`)
    }
    const text = h('textarea', { class: 'field full proposal-text', rows: 3, 'aria-label': `Proposal for ${proposal.agent}` })
    text.value = proposalText.get(proposal.id) ?? proposal.text
    const accept = h('button', { type: 'button', class: 'primary', disabled: !state.leader() }, text.value === proposal.text ? 'Accept' : 'Accept edited')
    text.addEventListener('input', () => {
      proposalText.set(proposal.id, text.value)
      accept.textContent = text.value === proposal.text ? 'Accept' : 'Accept edited'
    })
    accept.addEventListener('click', async () => {
      const edited = text.value.trim() !== proposal.text
      await hub.dreams.accept(proposal.id, edited ? text.value.trim() : undefined)
      decidedHere.set(proposal.id, { kind: 'accepted', at: Date.now() })
      learnedChanged.add(proposal.agent)
      load()
    })
    const reject = h('button', { type: 'button', class: 'link', disabled: !state.leader() }, 'Reject')
    reject.addEventListener('click', async () => {
      await hub.dreams.reject(proposal.id)
      decidedHere.set(proposal.id, { kind: 'rejected', at: Date.now() })
      load()
    })
    const from = proposal.trace ? h('a', { href: `#/run/${proposal.trace}` }, `from run ${proposal.trace}`) : 'from a dream'
    return h(
      'div',
      { class: 'proposal', testid: 'proposal' },
      h('div', { class: 'row' }, h('span', { class: 'mono' }, `${proposal.agent} · learned`), h('span', { class: 'grow' }), h('span', { class: 'faint small' }, from, ` · ${clock(proposal.at)}`)),
      text,
      proposal.why ? h('p', { class: 'dim small' }, `Why: ${proposal.why}`) : null,
      h('div', { class: 'row' }, accept, reject),
    )
  }

  // ─── schedules ─────────────────────────────────────────────────────────────
  function schedulesSection(rows) {
    let items = []
    try {
      items = hub.schedules.list()
    } catch {
      items = []
    }
    const leader = state.leader()
    const out = h('section', { class: 'section', testid: 'schedules' }, h('h2', {}, `Schedules · ${items.length}`))
    add(out, h('p', { class: 'faint small' }, 'A schedule runs only while a tab with HARNESS is open. One that fell due while every tab was closed runs once when a tab opens.'))
    if (!items.length) add(out, h('p', { class: 'dim small' }, 'No schedules. Add one below, or ask main to schedule a task.'))
    for (const item of items) {
      const cancel = h('button', { type: 'button', class: 'link small', disabled: !leader }, 'Cancel')
      cancel.addEventListener('click', () => {
        hub.schedules.cancel(item.id)
        paint()
      })
      const when = item.running ? 'running now' : Number.isFinite(item.next) && item.next ? `next ${moment(item.next)}` : 'not again'
      const last = item.last ? [` · last ${item.last.status} ${moment(item.last.at)} `, item.last.run ? h('a', { href: `#/run/${item.last.run}` }, 'Open run') : item.last.error ?? ''] : ''
      add(
        out,
        h(
          'div',
          { class: 'schedule', testid: 'schedule' },
          h('span', { class: 'mono' }, item.agent),
          h('span', { class: 'grow' }, item.query),
          h('span', { class: 'dim small num' }, item.every ? `every ${item.every}m` : 'once', ` · ${when}`, last, item.by && item.by !== 'owner' ? ` · by ${item.by}` : ''),
          cancel,
        ),
      )
    }
    const agent = h('select', { class: 'field', 'aria-label': 'Agent', disabled: !leader }, rows.map((row) => h('option', { value: row.path, selected: row.path === scheduleForm.agent }, row.path)))
    agent.addEventListener('change', () => (scheduleForm.agent = agent.value))
    const query = h('input', { type: 'text', class: 'field full', placeholder: 'What the agent should do', 'aria-label': 'Query', disabled: !leader })
    query.value = scheduleForm.query
    query.addEventListener('input', () => (scheduleForm.query = query.value))
    const every = h('input', { type: 'number', min: '1', class: 'field', placeholder: 'every … minutes (blank: once)', 'aria-label': 'Every how many minutes', disabled: !leader })
    every.value = scheduleForm.every
    every.addEventListener('input', () => (scheduleForm.every = every.value))
    const later = h('input', { type: 'number', min: '0', class: 'field', placeholder: 'first in … minutes', 'aria-label': 'First run in how many minutes', disabled: !leader })
    later.value = scheduleForm.in
    later.addEventListener('input', () => (scheduleForm.in = later.value))
    const addButton = h('button', { type: 'button', class: 'primary', disabled: !leader }, 'Add schedule')
    addButton.addEventListener('click', () => {
      try {
        hub.schedules.add({ agent: agent.value, query: query.value, every: every.value, in: later.value })
        Object.assign(scheduleForm, { query: '', every: '', in: '', error: '' })
      } catch (error) {
        scheduleForm.error = String(error?.message ?? error)
      }
      paint()
    })
    add(out, h('div', { class: 'add-form' }, agent, query, h('div', { class: 'row' }, every, later, addButton), scheduleForm.error ? h('p', { class: 'bad small' }, scheduleForm.error) : null))
    return out
  }

  // ─── memory ────────────────────────────────────────────────────────────────
  function memoryList(entries, who, granted = true) {
    const out = h('div', { class: 'memory', testid: 'memory' })
    if (!granted && !entries.length) {
      add(out, h('p', { class: 'dim small' }, `${who} is not granted the memory tools, so it keeps none.`))
      return out
    }
    if (!entries.length) {
      add(out, h('p', { class: 'dim small' }, 'No memory yet. An agent saves memory with memory_save when it has it; you can also tell main "remember …".'))
      return out
    }
    let used = 0
    let divided = false
    for (const entry of entries) {
      const cost = entry.text.length + 2
      const over = used + cost > CAP
      if (over && !divided) {
        divided = true
        add(out, h('p', { class: 'cap faint small' }, `─ not in the prompt: over ${CAP.toLocaleString()} characters ─`))
      }
      if (!over) used += cost
      add(out, memoryEntry(entry, divided))
    }
    return out
  }

  function memoryEntry(entry, faint) {
    const source = entry.source === 'dream' ? 'from a dream' : entry.source === 'owner' ? 'from you' : h('a', { href: `#/run/${entry.source}` }, `from run ${entry.source}`)
    const meta = h('span', { class: 'faint small' }, source, ` · ${when(entry.at)}`)
    if (editing.has(entry.id)) {
      const area = h('textarea', { class: 'field full', rows: 2, 'aria-label': 'Edit memory' })
      area.value = editing.get(entry.id)
      area.addEventListener('input', () => editing.set(entry.id, area.value))
      const save = h('button', { type: 'button', class: 'primary' }, 'Save')
      save.addEventListener('click', async () => {
        await hub.memory.edit(entry.id, area.value.trim())
        editing.delete(entry.id)
        load()
      })
      const cancel = h('button', { type: 'button', class: 'link' }, 'Cancel')
      cancel.addEventListener('click', () => {
        editing.delete(entry.id)
        paint()
      })
      return h('div', { class: 'memory-entry' }, area, h('div', { class: 'row' }, save, cancel))
    }
    const edit = h('button', { type: 'button', class: 'link small', disabled: !state.leader() }, 'Edit')
    edit.addEventListener('click', () => {
      editing.set(entry.id, entry.text)
      paint()
    })
    const remove = twoPress('Remove', 'Remove for good', async () => {
      await hub.memory.remove(entry.id)
      load()
    }, { class: 'link small', disabled: !state.leader() })
    return h('div', { class: `memory-entry${faint ? ' faint' : ''}` }, h('span', { class: 'grow' }, entry.text), meta, edit, remove)
  }

  function memoryHead(entries, whose) {
    let used = 0
    for (const entry of entries) {
      if (used + entry.text.length + 2 > CAP) break
      used += entry.text.length + 2
    }
    return `${plural(entries.length, 'entry', 'entries')} · ${used.toLocaleString()} of ${CAP.toLocaleString()} characters in ${whose}`
  }

  // ─── learned ───────────────────────────────────────────────────────────────
  function learnedLayer(row) {
    const text = [hub.learned.fromFile(row.path), data.learned.get(row.path)].filter(Boolean).join('\n')
    const entries = text.split('\n').map((line) => line.replace(/^-\s*/, '').trim()).filter(Boolean)
    if (!entries.length) return null
    const accepted = data.dreams.filter((item) => item.agent === row.path && item.status === 'accepted')
    const bridge = hub.bridge.state()
    const files = bridge.status === 'answering' && bridge.capabilities.includes('fs')
    const out = h('div', { class: 'learned', testid: 'learned' }, h('h4', {}, `Learned · ${plural(entries.length, 'entry', 'entries')} · in ${row.name}'s prompt after its body`))
    const list = h('ol', { class: 'learned-list' })
    for (const entry of entries) {
      const match = accepted.find((item) => item.text === entry)
      add(list, h('li', {}, h('span', { class: 'grow' }, entry), match?.decided ? h('span', { class: 'faint small' }, ` accepted ${when(match.decided)}`) : null))
    }
    add(out, list)
    const exportButton = h('button', { type: 'button', class: 'link small' }, 'Export learned.md')
    exportButton.addEventListener('click', () => download('learned.md', `---\nname: learned\ndescription: What experience taught ${row.path}, accepted by the owner.\n---\n\n${data.learned.get(row.path) ?? ''}\n`, 'text/markdown'))
    const actions = h('div', { class: 'row' }, exportButton)
    if (files) {
      const target = `${bridge.root}/public/agents/${row.path}/learned.md`
      const write = h('button', { type: 'button', class: 'link small', disabled: !state.leader() }, `Write to ${target}`)
      write.addEventListener('click', async () => {
        try {
          await hub.learned.writeFile(row.path)
          writeResult.set(row.path, `Written ${clock(Date.now())}. Publish your agents to keep it with the folder.`)
        } catch (error) {
          writeResult.set(row.path, String(error?.message ?? error))
        }
        paint()
      })
      add(actions, write)
    }
    add(out, actions)
    if (!files) add(out, h('p', { class: 'faint small' }, 'Writing to the folder needs the bridge with files on.'))
    if (writeResult.has(row.path)) add(out, h('p', { class: 'small dim' }, writeResult.get(row.path)))
    return out
  }

  // ─── an agent row ──────────────────────────────────────────────────────────
  function policyOf(row, tool, policy) {
    if (tool.tier === 'agent') return { risk: 'agent', action: '', source: '' }
    const effective = withAgentRules(policy, row.path, row.permissions)
    const verdict = decide({ name: tool.name, risk: tool.risk, tier: tool.tier }, {}, { policy: effective, agent: row.path })
    let source = 'default'
    const own = policy.rules?.[row.path] ?? {}
    if (verdict.reason.startsWith(`${row.path} rule for `)) {
      const key = verdict.reason.slice(`${row.path} rule for `.length)
      source = own[key] ? 'always rule' : `agents/${row.path}/agent.md`
    } else if (verdict.reason.startsWith('rule for ')) source = 'rule for every agent'
    return { risk: verdict.risk, action: verdict.action, source }
  }

  function agentRow(row, policy, memory) {
    const depth = row.path.split('/').length - 1
    const bridge = hub.bridge.state()
    const tools = row.tools ?? []
    const policies = new Map(tools.map((tool) => [tool.name, policyOf(row, tool, policy)]))
    const asks = [...policies.values()].filter((item) => item.action === 'ask').length
    const own = memory.filter((entry) => entry.agent === row.path)
    const learnedText = [hub.learned.fromFile(row.path), data.learned.get(row.path)].filter(Boolean).join('\n')
    const learnedCount = learnedText.split('\n').filter((line) => line.trim()).length
    const notes = row.notes ?? []
    const troubled = notes.length || row.unavailable?.length || row.shadowed?.length || row.error
    const modelWords = row.alias ? `${row.alias} (${row.model || 'no id'})` : row.model || 'no model'
    const line1 = h(
      'div',
      { class: 'agent-line1' },
      h('span', { class: 'mono name' }, row.path),
      h('span', { class: 'dim small' }, ` ${row.resident ? 'resident' : 'per call'} · `, h('span', { class: 'model' }, modelWords)),
      row.pinned ? h('span', { class: 'dim small' }, ' · override') : null,
      row.changed?.length ? h('span', { class: 'signal small' }, ' · changed') : null,
      learnedChanged.has(row.path) ? h('span', { class: 'signal small' }, ' · learned changed') : null,
      row.stale ? h('span', { class: 'dim small' }, ' · restarts when idle') : null,
      row.error ? h('span', { class: 'bad small' }, ' · failed') : null,
    )
    const counts = [
      plural(tools.filter((tool) => tool.tier !== 'agent').length, 'tool'),
      asks ? `${asks} ask` : '',
      row.unavailable?.length ? `${row.unavailable.length} unavailable` : '',
      notes.length ? plural(notes.length, 'note') : '',
      own.length ? plural(own.length, 'memory', 'memories') : '',
      learnedCount ? `learned ${learnedCount}` : '',
    ].filter(Boolean)
    const summary = h('div', { class: 'agent-summary' }, line1, h('p', { class: 'small ellipsis' }, row.description || ''), h('p', { class: 'faint small' }, counts.join(' · ')))
    return details(`agent:${row.path}`, summary, () => {
      const body = h('div', { class: 'agent-body' })
      if (row.error) {
        add(body, h('p', { class: 'bad small' }, row.error))
        if (/no ready/.test(row.error)) add(body, h('p', { class: 'small dim' }, `The thread started but never reported its tools. Check agents/${row.path}/ for a tool file that hangs at import.`))
      }
      for (const note of notes) {
        const broken = /did not import|did not load/.test(note)
        add(body, h('p', { class: `small ${broken ? 'bad' : 'dim'}` }, note))
        if (broken) add(body, h('p', { class: 'small dim' }, `${row.name} is running without the tools in that file.`))
      }
      const toolList = h('div', { class: 'tools' }, h('h4', {}, 'Tools'))
      if (!tools.length && !row.unavailable?.length) add(toolList, h('p', { class: 'faint small' }, state.leader() ? 'No tools reported yet.' : 'Tools are listed by the tab that runs HARNESS.'))
      for (const tier of TIERS) {
        const here = tools.filter((tool) => tool.tier === tier)
        const gone = (row.unavailable ?? []).filter((tool) => tool.tier === tier)
        if (!here.length && !gone.length) continue
        add(toolList, h('p', { class: 'tier faint small' }, tier))
        for (const tool of here) {
          const verdict = policies.get(tool.name)
          const shadows = (row.shadowed ?? []).find((item) => item.name === tool.name && item.by === tool.tier)
          add(toolList,
            h(
              'div',
              { class: 'tool', testid: 'tool-policy' },
              h('span', { class: 'mono tool-name' }, tool.name),
              h('span', { class: 'dim small tool-desc' }, tool.description ?? '', shadows ? h('span', { class: 'dim' }, ` · shadows ${shadows.tier} ${shadows.name}`) : null),
              verdict.action
                ? h('span', { class: 'small tool-policy' }, h('span', { class: 'mono' }, `${verdict.risk} · `), h('span', { class: verdict.action === 'deny' ? 'dim' : '' }, verdict.action), h('span', { class: 'faint' }, `  ${verdict.source}`))
                : h('span', { class: 'small tool-policy mono dim' }, 'agent'),
            ),
          )
        }
        for (const tool of gone) {
          const why = tool.missing?.includes('host') ? `needs the bridge (${bridge.status === 'down' ? `down since ${moment(bridge.since)}` : 'not paired'})` : `needs ${tool.missing?.join(', ')}`
          add(toolList, h('div', { class: 'tool' }, h('span', { class: 'mono tool-name struck' }, tool.name), h('span', { class: 'dim small' }, ` — ${why}`)))
        }
      }
      add(body, toolList)
      const granted = (row.grants ?? []).includes('memory')
      add(body, h('div', {}, h('h4', {}, `Memory · ${memoryHead(own, `${row.name}'s prompt`)}`), memoryList(own, row.name, granted)))
      const learned = learnedLayer(row)
      if (learned) add(body, learned)
      add(body, h('p', { class: 'mono faint small files' }, (row.files ?? []).join('  ')))
      if (row.resident) {
        const current = [...hub.runs.values()].filter((run) => run.agent === row.path).sort((a, b) => b.at - a.at)[0]
        if (current) add(body, h('a', { href: `#/run/${current.id}`, class: 'small' }, 'Open thread'))
      }
      return body
    }, { open: Boolean(troubled), testid: 'agent-row', class: `section agent-row depth-${depth}` })
  }

  function paint() {
    const rows = state.manifest()
    const settings = hub.settings.get()
    const policy = settings.policy ?? {}
    const good = rows.filter((row) => !row.broken).sort((a, b) => a.path.localeCompare(b.path))
    const broken = rows.filter((row) => row.broken)
    reload.disabled = state.reloading || !state.leader()
    reload.textContent = state.reloading ? 'Reloading…' : 'Reload agents'
    const nodes = [
      h('div', { class: 'section-head' }, h('h1', {}, 'Team'), reload),
      h('p', { class: 'faint small num' }, `build ${hub.index?.build ?? state.boot.build ?? ''}`),
    ]
    if (state.boot.error) {
      nodes.push(h('p', { class: 'bad' }, `Could not read agents/index.json (${state.boot.error}). The page was built without its agents, or the dev server is not regenerating it.`))
      root.replaceChildren(...nodes)
      return
    }
    if (!rows.length && state.boot.read) {
      nodes.push(h('p', { class: 'dim' }, 'agents/ has no agent.md. Add agents/main/agent.md and press Reload agents.'))
      root.replaceChildren(...nodes)
      return
    }
    if (state.boot.read && !good.some((row) => row.path === 'main')) nodes.push(h('p', { class: 'trouble-block' }, 'There is no agents/main/agent.md, so there is no one to talk to.'))
    nodes.push(reloadResult())
    nodes.push(proposals(good))
    nodes.push(schedulesSection(good))
    // Shared soul
    const specs = [...hub.specs.values()]
    const sharing = specs.filter((spec) => spec.soulFrom === 'agents/soul.md')
    const ownSoul = specs.filter((spec) => spec.soulFrom && spec.soulFrom !== 'agents/soul.md')
    if (sharing.length || ownSoul.length) {
      const text = sharing[0]?.soul ?? ''
      nodes.push(details('soul', `soul.md · shared by ${plural(sharing.length, 'agent')}${ownSoul.map((spec) => ` · ${spec.name} has its own`).join('')}`, () => h('pre', { class: 'mono-block wrap' }, text), { testid: 'soul' }))
    }
    const shared = data.memory.filter((entry) => entry.agent === 'shared')
    nodes.push(details('shared-memory', `Shared memory · ${memoryHead(shared, 'every prompt')}`, () => memoryList(shared, 'every agent'), { testid: 'shared-memory' }))
    for (const row of broken) nodes.push(h('p', { class: 'trouble-block mono small' }, `agents/${row.path}/agent.md — ${row.error}`))
    const tree = h('div', { class: 'agent-tree' }, good.map((row) => agentRow(row, policy, data.memory)))
    nodes.push(tree)
    root.replaceChildren(...nodes.filter(Boolean))
    state.touch('header')
  }

  const off = state.on((topics) => {
    if (topics.has('team') || topics.has('dreams') || topics.has('lock')) load()
    else if (topics.has('schedules') && !root.contains(document.activeElement)) paint()
    else if (topics.has('bridge')) paint()
  })
  paint()
  load()
  return () => {
    off()
    root.remove()
  }
}
