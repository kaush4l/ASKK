import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadDeskPackages } from '../src/runtime/desk-packages.js'
import { importAgentPackage } from '../src/core/agent-package.js'
import { compileAgentPackage, compilePackageWorkflows } from '../src/core/package-spec.js'

const catalogue = { default: 'chosen', models: { chosen: { provider: 'scripted', model: 'test-model' } } }
const definition = '---\npackage_id: example.renamed\npackage_version: 1.0.0\nid: navigator\nname: Custom navigator\nsession: agent\nagents: { examine: investigator }\nservices: { compaction: summarizer }\ntools: [todo]\n---\nCoordinate the requested work.\n'
const child = '---\nid: investigator\nsession: task\ntools: [todo]\n---\nExamine assigned evidence.\n'
const summary = '---\nid: summarizer\nsession: task\ntools: []\n---\nSummarize only.\n'
const configuration = () => ({ version: 1, defaultAgent: 'bundled/demo/navigator', packages: [{ id: 'demo', path: 'packages/example', models: { $default: '$default' }, tools: ['todo'] }] })
function fixture(config = configuration()) {
  const files = new Map([
    ['desk.json', JSON.stringify(config)],
    ['packages/example/agent.md', definition],
    ['packages/example/agents/check/agent.md', child],
    ['packages/example/agents/summary/agent.md', summary],
    // An unrelated old source must never supply a fallback default or hidden tools.
    ['agents/main/agent.md', '---\nname: main\n---\nUnused legacy source.'],
  ])
  const index = { files: Object.fromEntries([...files].map(([path, text]) => [path, createHash('sha1').update(text).digest('hex').slice(0, 10)])) }
  const requested = []
  const fetch = async url => { const path = new URL(url).pathname.slice('/ASKK/'.length); requested.push(path); return new Response(files.get(path) ?? '', { status: files.has(path) ? 200 : 404 }) }
  return { files, index, requested, input: { base: 'https://desk.invalid/ASKK/', index, fetch, catalogue } }
}

test('shipped and imported copies use the same validated agent behavior and explicit services', async () => {
  const f = fixture()
  const desk = await loadDeskPackages(f.input)
  const pkg = await importAgentPackage([...f.files].filter(([path]) => path.startsWith('packages/example/')).map(([path, content]) => ({ path: path.slice('packages/example/'.length), content })))
  const installed = await compileAgentPackage(pkg, { installationId: 'demo', bindings: { models: { $default: '$default' }, tools: ['todo'] }, catalogue })
  expect(desk.defaultAgent).toBe('bundled/demo/navigator')
  expect(f.requested).not.toContain('agents/main/agent.md')
  expect(desk.specs).toHaveLength(3)
  const behavior = spec => ({ name: spec.name, body: spec.body, soul: spec.soul, context: spec.context, engine: spec.engine, inference: spec.inference, grants: spec.grants, permissions: spec.permissions, resources: spec.packageResources, aliases: spec.delegates.map(row => ({ name: row.name, target: row.path.split('/').at(-1) })), services: Object.fromEntries(Object.entries(spec.services).map(([kind, path]) => [kind, path.split('/').at(-1)])) })
  expect(desk.specs.map(behavior)).toEqual(installed.map(behavior))
  expect(desk.specs[0].services.compaction).toBe('bundled/demo/summarizer')
  expect(installed[0].services.compaction).toBe('installed/demo/summarizer')
  expect(desk.packages[0].revisionDigest).toBe(pkg.data.revisionDigest)
  expect(desk.packageSources).toEqual([{ id: 'demo', data: pkg.data }])
  expect(Object.isFrozen(desk.packageSources[0].data)).toBe(true)
  expect(Object.isFrozen(desk.specs[0].engine)).toBe(true)
})

test('missing or malformed desk configuration never selects an old main folder', async () => {
  const missing = fixture(); delete missing.index.files['desk.json']
  await expect(loadDeskPackages(missing.input)).rejects.toThrow('desk.json is missing')
  const unknown = fixture({ ...configuration(), defaultAgent: 'main' })
  await expect(loadDeskPackages(unknown.input)).rejects.toThrow('defaultAgent must name')
  const implicit = fixture({ version: 1, packages: configuration().packages })
  await expect(loadDeskPackages(implicit.input)).rejects.toThrow('defaultAgent')
})

test('mixed deployment bytes fail before returning an activated catalogue', async () => {
  const f = fixture(); f.files.set('packages/example/agent.md', definition.replace('Coordinate', 'Changed'))
  await expect(loadDeskPackages(f.input)).rejects.toThrow('does not match the published index')
})

test('shipped configuration cannot overlap package roots or silently grant unsupported tools', async () => {
  const config = configuration(); config.packages.push({ ...config.packages[0], id: 'nested', path: 'packages/example/agents' })
  await expect(loadDeskPackages(fixture(config).input)).rejects.toThrow('cannot overlap')
  const grants = configuration(); grants.packages[0].tools.push('host')
  await expect(loadDeskPackages(fixture(grants).input)).rejects.toThrow('was not requested')
})

test('an indexed executable file is still rejected by the shared declarative importer', async () => {
  const f = fixture(); const content = 'throw new Error("must never execute")'
  f.files.set('packages/example/tool.js', content)
  f.index.files['packages/example/tool.js'] = createHash('sha1').update(content).digest('hex').slice(0, 10)
  await expect(loadDeskPackages(f.input)).rejects.toThrow('executable source')
})

test('unsafe indexed paths are rejected before fetching any package bytes', async () => {
  for (const path of ['../../outside.md', '%2e%2e/outside.md', 'nested\\outside.md', 'agent.md?secret', 'agent.md#other', 'nested//agent.md']) {
    const f = fixture()
    f.index.files[`packages/example/${path}`] = '0123456789'
    await expect(loadDeskPackages(f.input)).rejects.toThrow('unsafe published file path')
    expect(f.requested).toEqual(['desk.json'])
  }
})

test('a transport ignoring AbortSignal still reaches the boot deadline', async () => {
  const f = fixture(); let signal
  const fetch = (_, options) => { signal = options.signal; return new Promise(() => {}) }
  await expect(loadDeskPackages({ ...f.input, fetch, timeoutMs: 15 })).rejects.toMatchObject({ code: 'DESK_PACKAGES_TIMEOUT' })
  expect(signal.aborted).toBe(true)
})

test('a stalled response body is cancelled at the boot deadline', async () => {
  const f = fixture(); let cancelled = false
  const fetch = () => Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled = true } })))
  await expect(loadDeskPackages({ ...f.input, fetch, timeoutMs: 15 })).rejects.toMatchObject({ code: 'DESK_PACKAGES_TIMEOUT' })
  expect(cancelled).toBe(true)
})

test('owner cancellation cannot activate a late package response', async () => {
  const f = fixture(); const abort = new AbortController(); let respond; let cancelled = false; const seen = []
  const fetch = (url, options) => { seen.push(options.signal); return new Promise(resolve => { respond = resolve }) }
  const loading = loadDeskPackages({ ...f.input, fetch, signal: abort.signal })
  const reason = new Error('Desk closed'); abort.abort(reason)
  await expect(loading).rejects.toBe(reason)
  respond(new Response(new ReadableStream({ cancel() { cancelled = true } })))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(seen).toHaveLength(1)
  expect(seen[0].aborted).toBe(true)
  expect(cancelled).toBe(true)
})

test('header and status rejection cancel unused response bodies', async () => {
  for (const options of [{ status: 503 }, { headers: { 'content-length': '65537' } }]) {
    const f = fixture(); let cancelled = false
    const fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), options)
    await expect(loadDeskPackages({ ...f.input, fetch })).rejects.toMatchObject({ code: 'DESK_PACKAGES' })
    expect(cancelled).toBe(true)
  }
})

test('shipped workflows resolve only verified package resources and match imported semantics', async () => {
  const f = fixture()
  const add = (path, content) => { f.files.set(path, content); f.index.files[path] = createHash('sha1').update(content).digest('hex').slice(0, 10) }
  add('packages/example/agent.md', definition.replace('session: agent', 'session: agent\nworkflows: workflows.json'))
  add('packages/example/workflows.json', JSON.stringify({ version: 1, default: 'review', workflows: [{ id: 'review', label: 'Review', description: 'Inspect evidence', strategy: 'strategies/review.json', execution: { workspace: 'none' }, completion: { checks: [] } }] }))
  add('packages/example/strategies/review.json', JSON.stringify({ version: 1, kind: 'graph', id: 'review', output: 'answer', limits: { maxParallel: 1, maxWallMs: 1000 }, nodes: [{ id: 'answer', agent: 'investigator', dependsOn: [], templateFile: 'prompts/review.md', inputs: { goal: { from: 'goal' } } }] }))
  add('packages/example/prompts/review.md', 'Inspect: {{goal}}')
  const desk = await loadDeskPackages(f.input)
  const pkg = await importAgentPackage([...f.files].filter(([path]) => path.startsWith('packages/example/')).map(([path, content]) => ({ path: path.slice('packages/example/'.length), content })))
  const specs = await compileAgentPackage(pkg, { installationId: 'owner', bindings: { models: { $default: '$default' }, tools: ['todo'] }, catalogue })
  const imported = await compilePackageWorkflows(pkg, { specs })
  expect(desk.packages[0].defaultWorkflow).toBe('review')
  expect(desk.workflows).toHaveLength(1)
  expect(desk.workflows[0]).toMatchObject({ id: 'review', agent: 'bundled/demo/investigator', execution: imported.workflows[0].execution, completion: imported.workflows[0].completion })
  expect(desk.workflows[0].strategy.nodes[0].template).toBe('Inspect: {{goal}}')
  expect(desk.workflows[0].strategyFiles).toEqual(imported.workflows[0].strategyFiles)
  expect(desk.workflows[0].strategyHash).not.toBe(imported.workflows[0].strategyHash)
  expect(Object.isFrozen(desk.workflows[0].strategy)).toBe(true)
  // A changed indexed response is rejected, rather than using a cached compiled workflow.
  f.files.set('packages/example/prompts/review.md', 'Changed: {{goal}}')
  await expect(loadDeskPackages(f.input)).rejects.toThrow('published index')
})

test('actual shipped starter supplies four package-local workflows without global strategy lookups', async () => {
  const root = join(import.meta.dir, '../public')
  const files = new Map([['desk.json', await readFile(join(root, 'desk.json'), 'utf8')]])
  for (const glob of ['packages/starter/**/*', 'tools/*.js']) {
    for await (const path of new Bun.Glob(glob).scan({ cwd: root, onlyFiles: true })) files.set(path, await readFile(join(root, path)))
  }
  const index = { files: Object.fromEntries([...files].map(([path, content]) => [path, createHash('sha1').update(content).digest('hex').slice(0, 10)])) }
  const requested = []
  const fetch = async url => { const path = new URL(url).pathname.slice('/ASKK/'.length); requested.push(path); return new Response(files.get(path) ?? '', { status: files.has(path) ? 200 : 404 }) }
  const desk = await loadDeskPackages({ base: 'https://desk.invalid/ASKK/', index, fetch, catalogue })
  expect(desk.workflows.map(row => row.id).sort()).toEqual(['assistant', 'coding', 'parallel-review', 'project'])
  expect(desk.workflows.every(row => row.agent.startsWith('bundled/starter/') && row.package.revisionDigest === desk.packages[0].revisionDigest)).toBe(true)
  expect(desk.workflows.find(row => row.id === 'coding')).toMatchObject({ execution: { workspace: 'required' }, completion: { checks: [{ capability: 'workspace.artifact', options: { requireFresh: true, requireInteraction: true } }] } })
  expect(desk.workflows.find(row => row.id === 'project')).toMatchObject({
    agent: 'bundled/starter/builder', execution: { workspace: 'required' },
    strategy: { kind: 'agent', agent: 'bundled/starter/builder', delegation: 'none', session: 'agent' },
    completion: { checks: [{ capability: 'workspace.command', options: { requireFresh: true } }] },
  })
  expect(desk.workflows.find(row => row.id === 'assistant')).toMatchObject({ agent: 'bundled/starter/assistant', execution: { workspace: 'none' }, completion: { checks: [] } })
  expect(desk.workflows.find(row => row.id === 'parallel-review').strategy.nodes).toHaveLength(3)
  expect(requested.some(path => path.startsWith('strategies/') || path.startsWith('prompts/'))).toBe(false)
})
