/**
 * One agent's thread.
 *
 * The hub starts this worker with `init {spec, ...}`. It builds the engine the spec describes —
 * soul, job, learned layer, tools of every tier, context, inference — and then runs whatever it
 * is asked to, one run at a time, posting what happens back to the page as it happens.
 *
 * Everything that only the hub can do (call another agent, touch the board or memory, reach
 * the host bridge, read the browser workspace, ask the owner for approval) is a `request`,
 * answered by exactly one `reply`. Nothing throws across the boundary.
 *
 * A tool module is loaded with `import()` here, inside the thread that uses it, so a broken
 * module costs its own tools and is reported as a note; the agent runs without them.
 *
 * Every tool is wrapped by the permission guard before the engine sees it: `allow` runs,
 * `deny` returns a refusal as the observation, and `ask` pauses the run until the owner
 * answers in the page (docs/rewrite/ARCHITECTURE.md §13).
 */

import { contexts } from '../core/context.js'
import { Engine } from '../core/engine.js'
import { versioned } from '../core/folder.js'
import { inference } from '../core/inference.js'
import { resolve } from '../core/models.js'
import { decide } from '../core/permissions.js'
import { fromModule, tool, toolbox } from '../core/tools.js'

const BUILTINS = ['board', 'files', 'host', 'web', 'skill', 'memory', 'sessions', 'todo', 'schedule', 'workspace']

let engine = null
let spec = null
let catalogue = { models: {} }
let policy = {}
let host = null
let controller = null
const pending = new Map()
let nextRequest = 1
const models = new Map()

const post = (message) => self.postMessage(message)

/** Ask the hub for something only it can do. Resolves with the value or rejects with the error. */
function request(op, args = {}) {
  const id = nextRequest++
  post({ type: 'request', id, op, args })
  return new Promise((resolveReply, rejectReply) => pending.set(id, { resolve: resolveReply, reject: rejectReply }))
}

/** The inference for this step: resolved now, so a model change in the page reaches it. */
async function llm() {
  const settings = { ...resolve(spec.inference, catalogue), agent: spec.name }
  const key = JSON.stringify(settings)
  if (!models.has(key)) {
    models.set(
      key,
      inference(settings, {
        bridge: host ? bridgeFetch : null,
        bridgeURL: host?.url,
        run: host?.capabilities?.includes('cli') ? bridgeRun : null,
        onRetry: (attempt, error) => engine?.emit('retry', '', `retrying model call (${attempt + 1} of 3): ${error.message}`),
      }),
    )
  }
  return models.get(key)
}

/** A fetch made from the owner's machine by the host bridge, streamed back. */
async function bridgeFetch(url, init = {}) {
  return fetch(`${host.url}/fetch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${host.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? null, stream: true }),
    signal: init.signal,
  })
}

/** A model CLI run on the owner's machine by the host bridge; the reply streams as NDJSON. */
async function bridgeRun(body, { signal } = {}) {
  return fetch(`${host.url}/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${host.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

/** Wrap a tool so every call passes the permission guard first. */
function guarded(item) {
  const run = item.run
  return {
    ...item,
    run: async (args, ctx) => {
      const verdict = decide(item, args, { policy, agent: spec.path })
      if (verdict.action === 'deny') throw new Error(`refused by policy: ${verdict.reason}`)
      if (verdict.action === 'ask') {
        engine?.emit('approval', item.name, ctx.call, { risk: verdict.risk, reason: verdict.reason })
        const answer = await request('approve', { tool: item.name, call: ctx.call, risk: verdict.risk, reason: verdict.reason, args })
        engine?.emit('approved', item.name, answer.approved ? 'approved' : 'denied', { note: answer.note ?? '' })
        if (!answer.approved) throw new Error(`the owner refused this call${answer.note ? `: ${answer.note}` : '.'} Do not retry it unchanged.`)
      }
      return run(args, ctx)
    },
  }
}

async function build(message) {
  spec = message.spec
  catalogue = message.catalogue ?? catalogue
  policy = message.policy ?? {}
  host = message.host ?? null
  const base = message.base
  const index = message.index
  const notes = [...(spec.notes ?? [])]
  const load = async (file) => {
    const response = await fetch(versioned(base, file, index), { cache: 'no-cache' })
    if (!response.ok) throw new Error(`${file} answered ${response.status}`)
    return response.text()
  }

  const importTools = async (file, tier) => {
    try {
      return fromModule(await import(versioned(base, file, index)), { tier, source: file })
    } catch (error) {
      notes.push(`${file} did not import: ${error?.name ?? 'Error'}: ${error?.message ?? error}. Its tools are not in ${spec.name}'s prompt; the rest loaded.`)
      return []
    }
  }

  const local = (await Promise.all(spec.localTools.map((file) => importTools(file, 'local')))).flat()
  const common = (await Promise.all(Object.values(spec.commonTools).map((file) => importTools(file, 'common')))).flat()

  const wanted = spec.grants.filter((name) => BUILTINS.includes(name) && !spec.commonTools[name])
  if (spec.skills && !wanted.includes('skill')) wanted.push('skill')
  const builtins = []
  for (const name of wanted) {
    try {
      const module = await import(new URL(`../builtin/${name}.js`, import.meta.url))
      builtins.push(...fromModule(module, { tier: 'built-in', source: `built-in ${name}` }))
    } catch (error) {
      notes.push(`built-in "${name}" did not load: ${error?.message ?? error}`)
    }
  }
  // `mcp` grants every connected MCP server's tools; the hub listed them and makes each call.
  const servers = spec.grants.includes('mcp') ? (message.mcp ?? []) : []
  if (spec.grants.includes('mcp') && !servers.length) notes.push('tools: "mcp" is granted but no MCP server is connected (Settings → MCP)')
  const mcpTools = servers.flatMap((server) =>
    server.tools.map((descriptor) =>
      tool(
        { ...descriptor, run: (args) => request('mcp.call', { server: descriptor.server, tool: descriptor.tool, args }) },
        { tier: 'mcp', source: `mcp ${descriptor.server}` },
      ),
    ),
  )
  for (const name of spec.grants) {
    if (name === 'mcp') continue
    if (!BUILTINS.includes(name) && !spec.commonTools[name]) notes.push(`tools: "${name}" is neither a common tool in tools/ nor a built-in (${BUILTINS.join(', ')})`)
  }

  const agents = message.agents.map((agent) => {
    const item = tool(
      {
        name: agent.name,
        description: agent.description || `the ${agent.name} agent`,
        parameters: { query: 'string' },
        repeatable: true,
        risk: 'read',
        run: ({ query }, ctx) => request('call', { agent: agent.path, query: String(query ?? ''), call: ctx.call }),
      },
      { tier: 'agent', source: `agents/${agent.path}` },
    )
    item.waits = true
    return item
  })

  const { tools, shadowed, unavailable } = toolbox([local, common, builtins, mcpTools, agents], { has: (need) => (need === 'host' ? Boolean(host) : true) })

  const ctx = {
    request,
    load,
    host: host ? { root: host.root, capabilities: host.capabilities } : null,
    agent: { name: spec.name, path: spec.path },
    board: { list: () => request('board.list').catch(() => []) },
    memory: { list: () => request('memory.list', { scope: 'all' }).catch(() => []) },
    note: (text) => engine?.emit('note', '', String(text)),
  }

  engine = new Engine({
    name: spec.name,
    path: spec.path,
    description: spec.description,
    systemPrompt: spec.body,
    soul: spec.soul,
    learned: message.learned ?? '',
    llm,
    responseFormat: spec.engine.responseFormat ?? 'toon',
    observationFormat: spec.engine.observationFormat,
    contractVersion: spec.engine.contractVersion,
    promptTemplate: spec.engine.promptTemplate,
    outputReserve: spec.engine.outputReserve,
    verifyCompletion: spec.engine.requireVerification ? () => request('workspace.acceptance') : null,
    tools: tools.map(guarded),
    context: contexts(spec.context, notes),
    history: message.history ?? [],
    maxSteps: spec.engine.maxSteps ?? 10,
    repairs: spec.engine.repairs ?? 2,
    compactAt: spec.engine.compactAt ?? 0.9,
    keep: spec.engine.keep ?? 4,
    summarise: message.compactor ? (text) => request('call', { agent: message.compactor, query: text, call: 'compactor(history)' }) : null,
    ctx,
    onHistory: (turns) => post({ type: 'history', turns }),
  })
  engine.listen((event) => {
    if (event.kind === 'status') {
      post({ type: 'status', slot: event.slot })
      return
    }
    const { slot, ...rest } = event
    post({ type: 'event', ...rest })
    if (slot) post({ type: 'status', slot })
  })

  post({
    type: 'ready',
    tools: tools.map((item) => ({
      name: item.name,
      tier: item.tier,
      source: item.source,
      description: item.description,
      parameters: item.parameters,
      risk: decide(item, {}, { policy, agent: spec.path }).risk,
    })),
    shadowed,
    unavailable,
    notes,
  })
}

async function run(query, context) {
  controller = new AbortController()
  engine.ctx.runContext = context ?? null
  const text = await engine.invoke(query, { signal: controller.signal })
  controller = null
  post({ type: 'answer', text, ok: engine.status === 'done', slot: engine.progress() })
}

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case 'init':
        await build(data)
        break
      case 'invoke':
        await run(data.query, data.context)
        break
      case 'nudge':
        engine?.nudge(data.text)
        break
      case 'abort':
        controller?.abort()
        for (const waiting of pending.values()) waiting.reject(new Error('stopped by the owner'))
        pending.clear()
        break
      case 'settings':
        if (data.catalogue) catalogue = data.catalogue
        if (data.policy) policy = data.policy
        if ('learned' in data && engine) engine.learned = data.learned
        models.clear()
        break
      case 'reply': {
        const waiting = pending.get(data.id)
        pending.delete(data.id)
        if (!waiting) break
        if (data.ok) waiting.resolve(data.value)
        else waiting.reject(new Error(data.error ?? 'the hub refused'))
        break
      }
      default:
        break
    }
  } catch (error) {
    post({ type: 'fatal', message: `${error?.name ?? 'Error'}: ${error?.message ?? error}` })
  }
}

// A throw at the top level of a module worker arrives as an unhandled rejection, not `error`.
self.addEventListener('unhandledrejection', (event) => post({ type: 'fatal', message: String(event.reason?.message ?? event.reason) }))
