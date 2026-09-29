import { expect, test } from 'bun:test'
import { importAgentPackage, restoreAgentPackage } from '../src/core/agent-package.js'
import { compileAgentPackage, compilePackageWorkflows } from '../src/core/package-spec.js'

const strategy = { version: 1, id: 'conversation', kind: 'agent', agent: 'entry', delegation: 'declared', session: 'agent' }
const workflow = { id: 'talk', label: 'Talk', description: '', strategy: 'strategies/talk.json', execution: { workspace: 'none' }, completion: { checks: [] } }
const manifest = rows => ({ version: 1, default: 'talk', workflows: rows })
const options = installationId => ({ installationId, catalogue: { default: 'model', models: { model: { provider: 'scripted', script: [] } } }, bindings: { models: { $default: 'model' }, tools: [] } })
function records({ rows = [workflow], definition = strategy, extra = '', files = [], rootExtra = 'workflows: workflows.json\n' } = {}) {
  return [{ path: 'agent.md', content: `---\npackage_id: example.workflow\npackage_version: 1.0.0\nid: entry\n${rootExtra}${extra}---\nHelp.` }, { path: 'workflows.json', content: JSON.stringify(manifest(rows)) }, { path: 'strategies/talk.json', content: JSON.stringify(definition) }, ...files]
}
async function compiled(pkg, installationId = 'one') { return compilePackageWorkflows(pkg, { specs: await compileAgentPackage(pkg, options(installationId)) }) }
const check = { capability: 'workspace.artifact', options: { requireFresh: true, requireInteraction: true } }

test('package workflows restore byte-exactly and resolve independently for two installations', async () => {
  const pkg = await importAgentPackage(records())
  expect(pkg.data.agents[0].references).toEqual(['strategies/talk.json', 'workflows.json'])
  expect(pkg.data.agents[0].notes).toEqual([])
  const restored = await restoreAgentPackage(JSON.parse(JSON.stringify(pkg.data)))
  const first = await compiled(restored), second = await compiled(pkg, 'two')
  expect(first.workflows[0].agent).toBe('installed/one/entry')
  expect(second.workflows[0].strategy.agent).toBe('installed/two/entry')
  expect(first.workflows[0].strategyHash).not.toBe(second.workflows[0].strategyHash)
  expect(first.workflows[0].package.revisionDigest).toBe(pkg.data.revisionDigest)
  expect(Object.isFrozen(first.workflows[0].completion.checks)).toBe(true)
  expect(Object.keys(first.workflows[0].strategyFiles)).toEqual(['workflows.json', 'strategies/talk.json'])
  expect(await compiled(await importAgentPackage(records({ rootExtra: '' })))).toBeNull()
})

test('graphs resolve inventoried literal templates and local agent IDs', async () => {
  const definition = { version: 1, kind: 'graph', id: 'graph', output: 'answer', limits: { maxParallel: 1, maxWallMs: 1000 }, nodes: [{ id: 'answer', agent: 'entry', dependsOn: [], templateFile: 'prompts/goal.md', inputs: { goal: { from: 'goal' } } }] }
  const pkg = await importAgentPackage(records({ definition, files: [{ path: 'prompts/goal.md', content: 'Goal: {{goal}}' }] }))
  const result = await compiled(pkg)
  expect(pkg.data.agents[0].references).toContain('prompts/goal.md')
  expect(result.workflows[0].strategy.nodes[0]).toMatchObject({ template: 'Goal: {{goal}}', agent: 'installed/one/entry' })
  expect(result.workflows[0].strategy.nodes[0].templateFile).toBeUndefined()
  await expect(importAgentPackage(records({ definition: { ...definition, nodes: [{ ...definition.nodes[0], template: 'also inline' }] }, files: [{ path: 'prompts/goal.md', content: '{{goal}}' }] }))).rejects.toThrow('exactly one')
  await expect(importAgentPackage(records({ definition: { ...definition, nodes: [{ ...definition.nodes[0], dependsOn: ['answer'] }] }, files: [{ path: 'prompts/goal.md', content: '{{goal}}' }] }))).rejects.toThrow()
})

test('workflow boundary rejects external IDs, unsafe references, unknown schema and checker capabilities', async () => {
  for (const row of [
    { ...workflow, strategy: '../outside.json' },
    { ...workflow, strategy: 'https://example.com/strategy.json' },
    { ...workflow, unexpected: true },
    { ...workflow, execution: { workspace: 'optional' } },
    { ...workflow, completion: { checks: [check] } },
    { ...workflow, execution: { workspace: 'required' }, completion: { checks: [{ ...check, capability: 'shell.execute' }] } },
    { ...workflow, execution: { workspace: 'required' }, completion: { checks: [{ ...check, options: { ...check.options, command: 'echo nope' } }] } },
  ]) await expect(importAgentPackage(records({ rows: [row] }))).rejects.toThrow()
  for (const agent of ['installed/other/entry', 'absent', '../entry']) await expect(importAgentPackage(records({ definition: { ...strategy, agent } }))).rejects.toThrow('package-local')
  await expect(importAgentPackage(records({ rows: [workflow, workflow] }))).rejects.toThrow('duplicate')
  await expect(importAgentPackage(records({ files: [{ path: 'child/agent.md', content: '---\nid: child\nworkflows: workflows.json\n---\n' }] }))).rejects.toThrow('root-only')
})

test('compilation rejects resource tampering and mixed installation specs', async () => {
  const pkg = await importAgentPackage(records())
  const specs = await compileAgentPackage(pkg, options('one'))
  const changed = { ...pkg, source: { ...pkg.source, read: async (path, options) => path === 'strategies/talk.json' ? new TextEncoder().encode(JSON.stringify({ ...strategy, delegation: 'none' })) : pkg.source.read(path, options) } }
  await expect(compilePackageWorkflows(changed, { specs })).rejects.toThrow('changed after validation')
  await expect(compilePackageWorkflows(pkg, { specs: [{ ...specs[0], path: 'installed/other/entry' }] })).rejects.toThrow('one compiled package')
  const altered = JSON.parse(JSON.stringify(pkg.data)); altered.agents[0].references.pop()
  await expect(restoreAgentPackage(altered)).rejects.toThrow('derived metadata')
})

test('explicit workflows cannot bypass legacy verification requirements', async () => {
  await expect(importAgentPackage(records({ extra: 'require_verification: true\n' }))).rejects.toThrow('requires a workspace')
  await expect(importAgentPackage(records({ extra: 'require_verification: true\n', rows: [{ ...workflow, execution: { workspace: 'required' } }] }))).rejects.toThrow('bypass')
  const pkg = await importAgentPackage(records({ extra: 'require_verification: true\n', rows: [{ ...workflow, execution: { workspace: 'required' }, completion: { checks: [check] } }] }))
  expect((await compiled(pkg)).workflows[0].completion.checks).toEqual([check])
})

test('graph intermediate legacy checks require workspace without forcing a root check', async () => {
  const definition = { version: 1, kind: 'graph', id: 'graph', output: 'answer', limits: { maxParallel: 1, maxWallMs: 1000 }, nodes: [
    { id: 'draft', agent: 'worker', dependsOn: [], template: '{{goal}}', inputs: { goal: { from: 'goal' } } },
    { id: 'answer', agent: 'entry', dependsOn: ['draft'], template: '{{draft}}', inputs: { draft: { from: 'node', node: 'draft' } } },
  ] }
  const files = [{ path: 'worker/agent.md', content: '---\nid: worker\nrequire_verification: true\n---\nWork.' }]
  await expect(importAgentPackage(records({ definition, files }))).rejects.toThrow('requires a workspace')
  const pkg = await importAgentPackage(records({ definition, files, rows: [{ ...workflow, execution: { workspace: 'required' } }] }))
  expect((await compiled(pkg)).workflows[0].completion.checks).toEqual([])
})

test('manifest bounds, defaults, missing resources and duplicate checks fail closed', async () => {
  for (const rows of [[], Array.from({ length: 33 }, (_, index) => ({ ...workflow, id: `talk${index}` })), [{ ...workflow, id: 'other' }], [{ ...workflow, label: 'x'.repeat(513) }], [{ ...workflow, strategy: 'missing.json' }], [{ ...workflow, execution: { workspace: 'required' }, completion: { checks: [check, check] } }]]) await expect(importAgentPackage(records({ rows }))).rejects.toThrow()
  const malformed = records(); malformed.find(file => file.path === 'workflows.json').content = '{'
  await expect(importAgentPackage(malformed)).rejects.toThrow('not valid JSON')
})
