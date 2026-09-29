/**
 * The runtime end to end, headless: the real hub, real module workers, the real agent folders,
 * with the scripted model. Bun cannot import modules over HTTP, so the site is a temporary
 * copy of public/ read through file:// URLs, with the listing written the way the build writes it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from './helpers/trusted-fixture-hub.js'

let site
let hub

const relist = async () => writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
const until = async (check, ms = 5000) => {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('timed out waiting')
    await new Promise((done) => setTimeout(done, 20))
  }
}
const demo = async (change) => {
  const models = hub.settings.get().catalogue.models
  change(models.demo)
  await hub.settings.set({ catalogue: { default: 'demo', models: { demo: models.demo } } })
}

beforeAll(async () => {
  site = await mkdtemp(join(tmpdir(), 'harness-site-'))
  await cp(join(import.meta.dir, '../public'), site, { recursive: true, filter: path => !['browser-linux', 'runtime'].includes(path.split('/').at(-1)) })
  await cp(join(import.meta.dir, '../examples/agents/main'), join(site, 'agents/main'), { recursive: true })
  // These fixtures exercise the supported legacy contract independently of production defaults.
  await writeFile(join(site, 'agents/main/agent.md'), '---\nname: main\ncontract_version: 1\nresponse_format: toon\nmax_steps: 10\ncontext: [time, budget, memory, board]\nagents: [researcher, coder]\ntools: [text, board, memory, todo, sessions, skill, schedule, files]\nskills: true\n---\nDelegate independent tasks, then answer.')
  await writeFile(join(site, 'agents/coder/agent.md'), '---\nname: coder\ncontract_version: 1\nresponse_format: toon\nmax_steps: 10\ncontext: [time, runtime, budget, board]\ntools: [host, files, board]\n---\nUse the available host tools and report the result.')
  await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'demo', models: { demo: {
    provider: 'scripted', model: 'demo', delay: 5, script: {
      main: ['do: tool\nact: [[haiku({"query":"a browser tab that thinks"}), researcher({"query":"What is a Web Worker?"})]]', 'do: done\nact: Both agents answered this scripted demo.'],
      haiku: ['do: done\nact: A tab holds a mind; threads hum beside the page.'],
      researcher: ['do: done\nact: A Web Worker runs JavaScript on another thread.'],
    },
  } } }))
  // An extra agent whose one tool needs approval, to exercise the human in the loop.
  await mkdir(join(site, 'agents/scribe'), { recursive: true })
  await writeFile(join(site, 'agents/scribe/agent.md'), '---\nname: scribe\ndescription: writes a note\nmax_steps: 3\n---\n\nWrite notes.')
  await writeFile(join(site, 'agents/scribe/tools.js'), "export const note = { description: 'keep a note', parameters: { text: 'string' }, run: ({ text }) => `kept: ${text}` }\n")
  await mkdir(join(site, 'agents/broken'), { recursive: true })
  await writeFile(join(site, 'agents/broken/agent.md'), '---\nname: broken\n---\n\nI have a bad tool file.')
  await writeFile(join(site, 'agents/broken/tools.js'), 'export const x = {{ syntax error\n')
  await relist()
  hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: 'test' })
  await hub.start()
  await demo((entry) => {
    entry.delay = 5
    entry.script.scribe = ['do: tool\n\nact: [[note({"text": "hello"})]]', 'do: done\n\nact: noted']
  })
})

afterAll(async () => {
  hub?.stop()
  await rm(site, { recursive: true, force: true })
})

describe('boot', () => {
  test('every folder is an agent; nested folders are owned; a broken tool file is a note', () => {
    const rows = hub.manifest()
    const paths = rows.map((row) => row.path)
    for (const path of ['main', 'main/haiku', 'researcher', 'coder', 'coder/reviewer', 'compactor', 'dreamer', 'scribe', 'broken']) expect(paths).toContain(path)
    const main = rows.find((row) => row.path === 'main')
    expect(main.owned).toEqual(['main/haiku'])
    expect(main.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['add', 'multiply', 'count_words', 'board_post', 'memory_save', 'researcher', 'coder', 'haiku']))
    expect(main.unavailable.map((tool) => tool.name)).toContain('create_agent') // needs the bridge
    const broken = rows.find((row) => row.path === 'broken')
    expect(broken.notes.join(' ')).toContain('did not import')
  })
})

describe('runs', () => {
  test('main calls two agents in one stage; both run at once in their own threads', async () => {
    await demo((entry) => (entry.delay = 40))
    const events = []
    const off = hub.subscribe((message) => events.push(message))
    const id = hub.ask('demo please')
    const answer = await hub.runs.get(id).answer
    off()
    expect(answer).toContain('scripted demo')
    const children = hub.runs.get(id).children.map((child) => hub.runs.get(child))
    expect(children.map((child) => child.agent).sort()).toEqual(['main/haiku', 'researcher'])
    const [a, b] = children
    const end = (run) => run.slot.startedAt + run.slot.seconds * 1000
    expect(Math.min(end(a), end(b)) - Math.max(a.slot.startedAt, b.slot.startedAt)).toBeGreaterThan(0)
    expect(events.filter((event) => event.kind === 'child' && event.run === id).length).toBe(2)
    expect(children.every((child) => child.slot.status === 'done' && child.parent === id && child.trace === id)).toBe(true)
    const trace = await hub.traces.export(id)
    expect(trace.runs.length).toBe(3)
    expect(trace.runs.find((run) => run.id === id).spans.some((span) => span.kind === 'call')).toBe(true)
    await demo((entry) => (entry.delay = 5))
  })

  test('a write tool asks the owner; a denial becomes the observation', async () => {
    let approval
    const off = hub.subscribe((message) => message.type === 'approval' && (approval = message.approval))
    const run = hub.startRun('scribe', 'note hello')
    await until(() => approval)
    expect(hub.runs.get(run.id).slot.status).toBe('calling')
    expect(approval).toMatchObject({ tool: 'note', risk: 'write', agent: 'scribe' })
    hub.approvalsApi.answer(approval.id, { approved: false, note: 'not now' })
    expect(await run.answer).toBe('noted')
    off()
    expect(run.turns.find((turn) => turn.role === 'observation').content).toContain('the owner refused this call: not now')
  })

  test('"always allow" writes a rule, and the next call runs without asking', async () => {
    let approval
    const off = hub.subscribe((message) => message.type === 'approval' && (approval = message.approval))
    const first = hub.startRun('scribe', 'note again')
    await until(() => approval)
    hub.approvalsApi.answer(approval.id, { approved: true, always: true })
    await first.answer
    expect(hub.settings.get().policy.rules.scribe.note).toBe('allow')
    approval = null
    const second = hub.startRun('scribe', 'and again')
    await second.answer
    off()
    expect(approval).toBeNull()
    expect(second.turns.find((turn) => turn.role === 'observation').content).toContain('kept: hello')
  })

  test('abort reaches the run and ends it as cancelled', async () => {
    await demo((entry) => {
      entry.delay = 200
      entry.script.researcher = ['do: tool\n\nact: [[board_list({})]]', 'do: tool\n\nact: [[board_list({})]]', 'do: done\n\nact: late']
    })
    const run = hub.startRun('researcher', 'slow')
    await until(() => run.slot.status === 'thinking')
    hub.send(run.id, { type: 'abort' })
    await run.answer
    expect(run.slot).toMatchObject({ status: 'cancelled', terminationReason: 'cancelled' })
    expect(run.slot.error).toContain('stopped')
    await demo((entry) => (entry.delay = 5))
  })
})

describe('reload', () => {
  test('an edited agent.md is picked up, named, and reaches the next prompt', async () => {
    await writeFile(join(site, 'agents/scribe/agent.md'), '---\nname: scribe\ndescription: writes a note\nmax_steps: 3\n---\n\nWrite notes. EDITED.')
    await relist()
    const result = await hub.reloadAgents()
    expect(result.changed).toEqual([{ path: 'scribe', files: ['agent.md'] }])
    const run = hub.startRun('scribe', 'after edit')
    await run.answer
    expect(run.prompts[0].sheet).toContain('EDITED.')
  })

  test('a new folder appears after reload and is callable', async () => {
    await mkdir(join(site, 'agents/fresh'), { recursive: true })
    await writeFile(join(site, 'agents/fresh/agent.md'), '---\nname: fresh\ndescription: new\n---\n\nI am new.')
    await relist()
    const result = await hub.reloadAgents()
    expect(result.added).toEqual(['fresh'])
    expect(await hub.startRun('fresh', 'hi').answer).toBeTruthy()
  })
})

describe('host bridge', () => {
  test('pairing brings host tools; an exec call asks, runs on the machine after approval, then pairing ends', async () => {
    const { spawn } = await import('node:child_process')
    const root = await mkdtemp(join(tmpdir(), 'harness-host-'))
    const bridge = spawn('node', [join(import.meta.dir, '../host/bridge.js'), '--root', root, '--port', '17718', '--token', 'pair-me'], { stdio: 'pipe' })
    await new Promise((ready) => bridge.stdout.on('data', (chunk) => String(chunk).includes('token') && ready()))
    try {
      expect((await hub.bridge.pair('http://127.0.0.1:17718', 'wrong')).status).toBe('down')
      const state = await hub.bridge.pair('http://127.0.0.1:17718', 'pair-me')
      expect(state.status).toBe('answering')
      await until(() => hub.manifest().find((row) => row.path === 'coder').tools.some((tool) => tool.name === 'host_exec'))

      await demo((entry) => (entry.script.coder = ['do: tool\n\nact: [[host_exec({"command": "echo from-the-machine"})]]', 'do: done\n\nact: ran it']))
      let approval
      const off = hub.subscribe((message) => message.type === 'approval' && (approval = message.approval))
      const run = hub.startRun('coder', 'run echo')
      await until(() => approval)
      expect(approval).toMatchObject({ tool: 'host_exec', risk: 'exec' })
      hub.approvalsApi.answer(approval.id, { approved: true })
      expect(await run.answer).toBe('ran it')
      off()
      expect(run.turns.find((turn) => turn.role === 'observation').content).toContain('exit 0\nfrom-the-machine')

      await hub.bridge.disconnect()
      await until(() => !hub.manifest().find((row) => row.path === 'coder').tools.some((tool) => tool.name === 'host_exec'))
    } finally {
      bridge.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 15000)
})

describe('a CLI as the model', () => {
  test('an agent thinks through a program on the machine: the bridge runs it, the loop calls a tool, then answers', async () => {
    const { spawn } = await import('node:child_process')
    const root = await mkdtemp(join(tmpdir(), 'harness-cli-'))
    // A stand-in model CLI: first reply calls a tool, second reads the observation and answers.
    await writeFile(
      join(root, 'fake-model.js'),
      `let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const saw = input.match(/(\\d+) words?/)
  process.stdout.write(saw ? 'do: done\\n\\nact: the cli counted ' + saw[1] : 'do: tool\\n\\nact: [[count_words({"text": "one two three"})]]')
})
`,
    )
    await mkdir(join(site, 'agents/thinker'), { recursive: true })
    await writeFile(join(site, 'agents/thinker/agent.md'), '---\nname: thinker\ndescription: thinks through a CLI\nmodel: fake-cli\ntools: [text]\nmax_steps: 4\n---\n\nCount.')
    await relist()
    await hub.reloadAgents()
    const bridge = spawn('node', [join(import.meta.dir, '../host/bridge.js'), '--root', root, '--port', '17719', '--token', 'cli-me', '--cli', 'node'], { stdio: 'pipe' })
    await new Promise((ready) => bridge.stdout.on('data', (chunk) => String(chunk).includes('token') && ready()))
    try {
      const models = hub.settings.get().catalogue.models
      await hub.settings.set({ catalogue: { default: 'demo', models: { ...models, 'fake-cli': { provider: 'cli', command: 'node', args: ['fake-model.js'] } } } })
      expect((await hub.bridge.pair('http://127.0.0.1:17719', 'cli-me')).capabilities).toContain('cli')
      const run = hub.startRun('thinker', 'count three words')
      expect(await run.answer).toBe('the cli counted 3')
      expect(run.turns.find((turn) => turn.role === 'observation').content).toMatch(/3/)
      expect(run.slot.model).toContain('fake-cli')
    } finally {
      await hub.bridge.disconnect()
      bridge.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 20000)

  test('host_agent hands a task to a coding CLI with its tools on; the owner is asked; the report comes back', async () => {
    const { spawn } = await import('node:child_process')
    const { chmod } = await import('node:fs/promises')
    const root = await mkdtemp(join(tmpdir(), 'harness-agent-'))
    const bin = await mkdtemp(join(tmpdir(), 'harness-bin-'))
    // A stand-in `claude`: checks its flags, "edits" a file, streams what the real one streams.
    await writeFile(
      join(bin, 'claude'),
      `#!/usr/bin/env node
const args = process.argv.slice(2)
let task = ''
process.stdin.on('data', (d) => (task += d))
process.stdin.on('end', () => {
  require('fs').writeFileSync('done.txt', task)
  const line = (o) => console.log(JSON.stringify(o))
  line({ type: 'system', subtype: 'init' })
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write' }, { type: 'tool_use', name: 'Write' }] } })
  line({ type: 'result', subtype: 'success', result: 'wrote done.txt; flags ' + args.slice(0, 3).join(' ') + ' ' + args.includes('acceptEdits') })
})
`,
    )
    await chmod(join(bin, 'claude'), 0o755)
    const bridge = spawn('node', [join(import.meta.dir, '../host/bridge.js'), '--root', root, '--port', '17723', '--token', 'agent'], { stdio: 'pipe', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
    await new Promise((ready) => bridge.stdout.on('data', (chunk) => String(chunk).includes('token') && ready()))
    try {
      await hub.bridge.pair('http://127.0.0.1:17723', 'agent')
      await until(() => hub.manifest().find((row) => row.path === 'coder').tools.some((tool) => tool.name === 'host_agent'))
      await demo((entry) => (entry.script.coder = ['do: tool\n\nact: [[host_agent({"agent": "claude", "task": "make done.txt"})]]', 'do: done\n\nact: delegated']))
      let approval
      const off = hub.subscribe((message) => message.type === 'approval' && (approval = message.approval) && hub.approvalsApi.answer(message.approval.id, { approved: true }))
      const run = hub.startRun('coder', 'delegate it')
      expect(await run.answer).toBe('delegated')
      off()
      expect(approval).toMatchObject({ tool: 'host_agent', risk: 'exec' })
      const seen = run.turns.find((turn) => turn.role === 'observation').content
      expect(seen).toContain('wrote done.txt; flags -p --output-format stream-json true')
      expect(seen).toContain('(tools it used: Write ×2)')
      expect(await Bun.file(join(root, 'done.txt')).text()).toBe('make done.txt')
    } finally {
      await hub.bridge.disconnect()
      bridge.kill()
      await rm(root, { recursive: true, force: true })
      await rm(bin, { recursive: true, force: true })
    }
  }, 20000)

  test.skipIf(!process.env.LIVE_CLI)('live: the real claude CLI answers as the model (LIVE_CLI=1)', async () => {
    const { spawn } = await import('node:child_process')
    const root = await mkdtemp(join(tmpdir(), 'harness-live-'))
    const bridge = spawn('node', [join(import.meta.dir, '../host/bridge.js'), '--root', root, '--port', '17720', '--token', 'live'], { stdio: 'pipe' })
    await new Promise((ready) => bridge.stdout.on('data', (chunk) => String(chunk).includes('token') && ready()))
    try {
      await mkdir(join(site, 'agents/thinker'), { recursive: true })
      await writeFile(join(site, 'agents/thinker/agent.md'), '---\nname: thinker\ndescription: live\nmodel: claude-cli\ntools: [text]\nmax_steps: 3\n---\n\nAnswer directly.')
      await relist()
      await hub.reloadAgents()
      const models = hub.settings.get().catalogue.models
      await hub.settings.set({ catalogue: { default: 'demo', models: { ...models, 'claude-cli': { provider: 'cli', cli: 'claude', model: 'haiku' } } } })
      await hub.bridge.pair('http://127.0.0.1:17720', 'live')
      const run = hub.startRun('thinker', 'Reply with the single word: pong')
      expect((await run.answer).toLowerCase()).toContain('pong')
    } finally {
      await hub.bridge.disconnect()
      bridge.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 120000)
})

describe('hermes-style tools', () => {
  test('todo: the plan belongs to the run, is published, and is read back', async () => {
    await demo((entry) => {
      entry.script.main = [
        'do: tool\n\nact: [[todo_write({"items": [{"text": "read", "status": "done"}, {"text": "write", "status": "doing"}, "check"]})]]',
        'do: tool\n\nact: [[todo_read({})]]',
        'do: done\n\nact: planned',
      ]
    })
    const events = []
    const off = hub.subscribe((message) => message.type === 'todo' && events.push(message))
    const id = hub.ask('plan it')
    expect(await hub.runs.get(id).answer).toBe('planned')
    off()
    const observations = hub.runs.get(id).turns.filter((turn) => turn.role === 'observation').map((turn) => turn.content)
    expect(observations[1]).toContain('[x] read\n[~] write\n[ ] check\n(2 open of 3)')
    expect(events.at(-1)).toMatchObject({ run: id, items: [{ status: 'done' }, { status: 'doing' }, { text: 'check', status: 'todo' }] })
  })

  test('session_search finds an earlier run by what it said; session_read returns it', async () => {
    await demo((entry) => (entry.script.main = ['do: done\n\nact: the capital of Zembla is Onhava']))
    const earlier = hub.ask('capital of zembla?')
    await hub.runs.get(earlier).answer
    await demo((entry) => (entry.script.main = ['do: tool\n\nact: [[session_search({"query": "zembla onhava"})]]', `do: tool\n\nact: [[session_read({"id": "${earlier}"})]]`, 'do: done\n\nact: found it']))
    const id = hub.ask('did we look up zembla before?')
    expect(await hub.runs.get(id).answer).toBe('found it')
    const [found, full] = hub.runs.get(id).turns.filter((turn) => turn.role === 'observation').map((turn) => turn.content)
    expect(found).toContain(`run ${earlier} · main`)
    expect(found).toContain('Onhava')
    expect(full).toContain('## answer\nthe capital of Zembla is Onhava')
  })

  test('skill_save asks the owner, then the skill is listed and loadable by any agent; published names are protected', async () => {
    await demo((entry) => {
      entry.script.main = [
        'do: tool\n\nact: [[skill_save({"name": "Release Notes", "description": "writing release notes", "body": "1. list merged changes\\n2. group them"})]]',
        'do: tool\n\nact: [[skill_list({}), skill_load({"name": "release-notes"})]]',
        'do: tool\n\nact: [[skill_save({"name": "verification", "description": "x", "body": "y"})]]',
        'do: done\n\nact: saved',
      ]
    })
    let approval
    const off = hub.subscribe((message) => message.type === 'approval' && (approval = message.approval) && hub.approvalsApi.answer(message.approval.id, { approved: true }))
    const id = hub.ask('save a skill')
    expect(await hub.runs.get(id).answer).toBe('saved')
    off()
    expect(approval).toMatchObject({ tool: 'skill_save', risk: 'write' })
    const observations = hub.runs.get(id).turns.filter((turn) => turn.role === 'observation').map((turn) => turn.content)
    expect(observations[0]).toContain('saved skill "release-notes" (version 1)')
    expect(observations[1]).toContain('release-notes: writing release notes (saved by main)')
    expect(observations[1]).toContain('1. list merged changes')
    expect(observations[2]).toContain('published skill')
  })

  test('schedule: a due task starts itself as a scheduled run; a repeating one comes back; cancel stops it', async () => {
    await demo((entry) => (entry.script.main = ['do: done\n\nact: tick']))
    const once = hub.schedules.add({ agent: 'main', query: 'once please', in: 0 })
    const again = hub.schedules.add({ agent: 'main', query: 'every minute', every: 1, in: 0 })
    expect(() => hub.schedules.add({ agent: 'nobody', query: 'x' })).toThrow(/no agent/)
    const started = []
    const off = hub.subscribe((message) => message.type === 'run' && message.run.kind === 'scheduled' && started.push(message.run))
    hub.tick()
    await until(() => hub.schedules.list().every((item) => !item.running) && started.length === 2)
    expect(started.map((run) => run.query).sort()).toEqual(['every minute', 'once please'])
    expect(hub.schedules.list().map((item) => item.id)).toEqual([again.id]) // the one-off is gone
    const [left] = hub.schedules.list()
    expect(left.last.status).toBe('done')
    hub.tick(left.next + 1)
    await until(() => started.length === 3)
    off()
    expect(hub.schedules.cancel(again.id)).toBe(true)
    expect(hub.schedules.cancel(once.id)).toBe(false)
    expect(hub.schedules.list()).toEqual([])
  })
})

describe('MCP', () => {
  test('a stdio server the bridge runs becomes tools for agents granting mcp; read-only runs, writing asks', async () => {
    const { spawn } = await import('node:child_process')
    const root = await mkdtemp(join(tmpdir(), 'harness-mcp-rt-'))
    await mkdir(join(site, 'agents/toolsmith'), { recursive: true })
    await writeFile(join(site, 'agents/toolsmith/agent.md'), '---\nname: toolsmith\ndescription: uses MCP tools\ntools: [mcp]\nmax_steps: 4\n---\n\nUse the tools.')
    await relist()
    await hub.reloadAgents()
    expect(hub.manifest().find((row) => row.path === 'toolsmith').notes.join(' ')).toContain('no MCP server is connected')
    const bridge = spawn('node', [join(import.meta.dir, '../host/bridge.js'), '--root', root, '--port', '17722', '--token', 'mcp-rt', '--mcp', `echo=node ${join(import.meta.dir, 'fixtures/stdio-mcp.js')}`], { stdio: 'pipe' })
    await new Promise((ready) => bridge.stdout.on('data', (chunk) => String(chunk).includes('token') && ready()))
    try {
      await hub.bridge.pair('http://127.0.0.1:17722', 'mcp-rt')
      // Pairing authenticates the companion; optional tool discovery has its own lifecycle.
      await hub.mcp.refresh()
      expect(hub.mcp.list()).toMatchObject([{ name: 'echo', from: 'bridge', status: 'answering' }])
      await until(() => hub.manifest().find((row) => row.path === 'toolsmith').tools.some((tool) => tool.name === 'echo__say'))
      const row = hub.manifest().find((row) => row.path === 'toolsmith')
      expect(row.tools.find((tool) => tool.name === 'echo__store').risk).toBe('write')
      await demo((entry) => (entry.script.toolsmith = ['do: tool\n\nact: [[echo__say({"text": "hello"}), echo__store({"text": "x"})]]', 'do: done\n\nact: used both']))
      const approvals = []
      const off = hub.subscribe((message) => message.type === 'approval' && approvals.push(message.approval) && hub.approvalsApi.answer(message.approval.id, { approved: true }))
      const run = hub.startRun('toolsmith', 'use them')
      expect(await run.answer).toBe('used both')
      off()
      expect(approvals.map((approval) => approval.tool)).toEqual(['echo__store'])
      const seen = run.turns.filter((turn) => turn.role === 'observation').map((turn) => turn.content).join('\n')
      expect(seen).toContain('echo: hello')
      expect(seen).toContain('kept 1')
    } finally {
      await hub.bridge.disconnect()
      bridge.kill()
      await rm(root, { recursive: true, force: true })
    }
    expect(hub.mcp.list()).toEqual([])
  }, 20000)
})

describe('memory and dreaming', () => {
  test('memory saved by a tool reaches the next prompt; an accepted proposal becomes LEARNED', async () => {
    await demo((entry) => {
      entry.script.dreamer = [
        'do: tool\n\nact: [[memory_save({"text": "the owner likes short answers", "scope": "shared"}), propose({"agent": "main", "text": "Answer in three sentences or fewer.", "why": "the owner said so"})]]',
        'do: done\n\nact: saved one memory, proposed one change',
      ]
      entry.script.main = ['do: done\n\nact: ok']
    })
    const task = hub.ask('something')
    await hub.runs.get(task).answer
    const dream = await hub.dream(task)
    await hub.runs.get(dream).answer
    const [proposal] = await hub.dreams.list()
    expect(proposal).toMatchObject({ agent: 'main', status: 'pending', trace: task })
    await hub.dreams.accept(proposal.id)
    expect(await hub.learned.get('main')).toContain('three sentences')
    const next = hub.ask('again')
    await hub.runs.get(next).answer
    const sheet = hub.runs.get(next).prompts[0].sheet
    expect(sheet).toContain('## LEARNED')
    expect(sheet).toContain('the owner likes short answers')
  })
})
