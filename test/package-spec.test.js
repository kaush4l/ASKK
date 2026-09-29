import { expect, test } from 'bun:test'
import { importAgentPackage, restoreAgentPackage } from '../src/core/agent-package.js'
import { compileAgentPackage } from '../src/core/package-spec.js'
import { BUILTIN_TOOL_GROUPS, SUPPORTED_BUILTIN_GROUPS, IMPORTABLE_TOOL_GROUPS } from '../src/core/builtin-registry.js'

const file = (path, content) => ({ path, content })
const root = (extra = '', body = 'Keep the exact body.\n') => `---\npackage_id: example.portable\npackage_version: 1.2.3\nid: entry\n${extra}---\n${body}`
const child = (id, extra = '', body = 'Specialist instructions.\n') => `---\nid: ${id}\n${extra}---\n${body}`
const pkg = (extra = '', files = []) => importAgentPackage([file('agent.md', root(extra)), ...files])
const catalogue = { default: 'desk-fast', models: { 'desk-fast': { provider: 'scripted', script: [], apiKey: 'private-fixture-token' }, 'desk-deep': { provider: 'openai', model: 'actual-provider-model' } } }
const options = (extra = {}) => ({ installationId: 'desk-one', bindings: { models: { $default: 'desk-fast' }, tools: [] }, catalogue, ...extra })
async function rejects(promise, code, text) {
  let error
  try { await promise } catch (caught) { error = caught }
  expect(error?.code).toBe(code)
  if (text) expect(error.message).toContain(text)
}

test('validated source compiles exact body into frozen serializable isolated specs without provider secrets', async () => {
  const body = '\r\n  日本語 🌱  \r\n\r\n'
  const imported = await importAgentPackage([file('agent.md', root('name: Arbitrary display\ncontext: {goal: true, budget: {enabled: true}}\nunknown_note: preserved\n', body))])
  const [spec] = await compileAgentPackage(imported, options())
  expect(spec.path).toBe('installed/desk-one/entry')
  expect(spec.body).toBe(body)
  expect(spec.name).toBe('Arbitrary display')
  expect(spec.package).toEqual({ installationId: 'desk-one', packageId: 'example.portable', packageVersion: '1.2.3', revisionDigest: imported.data.revisionDigest, agentId: 'entry' })
  expect(spec.inference).toEqual({ model: 'desk-fast' })
  expect(spec.engine).toEqual({ contractVersion: 2, responseFormat: 'json', session: 'task' })
  expect(spec.context).toEqual({ goal: true, budget: { enabled: true } })
  expect(spec.localTools).toEqual([])
  expect(spec.owned).toEqual([])
  expect(spec.notes).toEqual(['Uninterpreted frontmatter preserved: unknown_note'])
  expect(Object.isFrozen(spec.context.budget)).toBe(true)
  expect(Object.isFrozen(spec.package)).toBe(true)
  expect(JSON.parse(JSON.stringify(spec))).toEqual(spec)
  expect(JSON.stringify(spec)).not.toContain('private-fixture-token')
  expect(JSON.stringify(spec)).not.toContain('actual-provider-model')
})

test('every authored model alias including missing-model $default needs an explicit existing desk profile', async () => {
  const imported = await pkg('model: author-fast\nagents: [worker]\n', [file('odd/location/agent.md', child('worker', 'model: author-deep\n'))])
  const valid = options({ bindings: { models: { 'author-fast': 'desk-fast', 'author-deep': 'desk-deep' }, tools: [] } })
  expect((await compileAgentPackage(imported, valid)).map(spec => spec.inference.model)).toEqual(['desk-fast', 'desk-deep'])
  await rejects(compileAgentPackage(imported, options()), 'PACKAGE_COMPILE_BINDING', '$default')
  await rejects(compileAgentPackage(imported, options({ bindings: { models: { 'author-fast': 'desk-fast' }, tools: [] } })), 'PACKAGE_COMPILE_MODEL', 'author-deep')
  await rejects(compileAgentPackage(await pkg(), options({ bindings: { models: {}, tools: [] } })), 'PACKAGE_COMPILE_MODEL', '$default')
  await rejects(compileAgentPackage(await pkg(), options({ bindings: { models: { $default: 'actual-provider-model' }, tools: [] } })), 'PACKAGE_COMPILE_MODEL', 'raw model IDs')
  await rejects(compileAgentPackage(await pkg(), options({ bindings: { models: { $default: 'toString' }, tools: [] } })), 'PACKAGE_COMPILE_MODEL')
})

test('installation IDs and delegation aliases never derive from folder or display names', async () => {
  const imported = await pkg('name: Identical name\nagents: {research: scientist, verify: scientist, synthesize: critic}\n', [
    file('main/nested/agent.md', child('scientist', 'name: Identical name\ndescription: Tests evidence\n')),
    file('lead/agent.md', child('critic', 'name: Identical name\n')),
  ])
  const first = await compileAgentPackage(imported, options())
  const second = await compileAgentPackage(imported, options({ installationId: 'other-install' }))
  const entry = first.find(spec => spec.package.agentId === 'entry')
  expect(entry.delegates).toEqual([
    { path: 'installed/desk-one/scientist', name: 'research', description: 'Tests evidence' },
    { path: 'installed/desk-one/scientist', name: 'verify', description: 'Tests evidence' },
    { path: 'installed/desk-one/critic', name: 'synthesize', description: '' },
  ])
  expect(entry.peers).toEqual(['installed/desk-one/scientist', 'installed/desk-one/critic'])
  expect(first.every(spec => spec.owned.length === 0)).toBe(true)
  expect(first.every(spec => !second.some(other => other.path === spec.path || other.hash === spec.hash))).toBe(true)
  expect(second.find(spec => spec.package.agentId === 'entry').delegates.every(item => item.path.startsWith('installed/other-install/'))).toBe(true)
  for (const installationId of ['../escape', '/absolute', 'a/b', 'A', '', 'a'.repeat(129)]) await rejects(compileAgentPackage(imported, options({ installationId })), 'PACKAGE_COMPILE_ID')
})

test('approved tool groups narrow each role without granting all package roles the union', async () => {
  const imported = await pkg('tools: [web, board]\nagents: [worker]\n', [file('worker/agent.md', child('worker', 'tools: [workspace, web]\npermissions: {exec: allow, write: ask}\n'))])
  const specs = await compileAgentPackage(imported, options({ bindings: { models: { $default: 'desk-fast' }, tools: ['workspace', 'board'] } }))
  expect(specs[0].grants).toEqual(['board'])
  expect(specs[1].grants).toEqual(['workspace'])
  expect(specs[1].permissions).toEqual({ exec: 'allow', write: 'ask' })
  expect(Object.isFrozen(specs[1].permissions)).toBe(true)
  await rejects(compileAgentPackage(imported, options({ bindings: { models: { $default: 'desk-fast' }, tools: ['host'] } })), 'PACKAGE_COMPILE_BINDING', 'not requested')
  await rejects(compileAgentPackage(imported, options({ bindings: { models: { $default: 'desk-fast' }, tools: ['web', 'web'] } })), 'PACKAGE_COMPILE_BINDING')
})

test('unknown requested groups fail even when unapproved; only shipped registry or trusted common files count', async () => {
  await rejects(compileAgentPackage(await pkg('tools: [made_up]\n'), options()), 'PACKAGE_COMPILE_TOOL', 'made_up')
  const imported = await pkg('tools: [trusted, web, mcp]\n')
  const index = { files: { 'tools/trusted.mjs': 'version-one', 'tools/nested/hidden.js': 'ignored', 'agents/entry/evil.js': 'ignored' } }
  const [spec] = await compileAgentPackage(imported, options({ index, bindings: { models: { $default: 'desk-fast' }, tools: ['mcp', 'trusted'] } }))
  expect(spec.grants).toEqual(['trusted', 'mcp'])
  expect(spec.commonTools).toEqual({ trusted: 'tools/trusted.mjs' })
  expect(spec.localTools).toEqual([])
  await rejects(compileAgentPackage(await pkg('tools: [hidden]\n'), options({ index })), 'PACKAGE_COMPILE_TOOL')
  expect(SUPPORTED_BUILTIN_GROUPS).toEqual([...BUILTIN_TOOL_GROUPS, 'mcp'])
  expect(Object.isFrozen(BUILTIN_TOOL_GROUPS)).toBe(true)
})

test('only package-local referenced texts enter prompts and skills; souls do not fall through to root or desk', async () => {
  const template = 'System\r\n{{job}}\r\n<!-- user -->\r\n{{context}}\r\n'
  const imported = await pkg('prompt_template: layouts/custom.md\nskills: [guides/café.md]\nagents: [worker]\n', [
    file('layouts/custom.md', template), file('guides/café.md', '---\nname: Source metadata\n---\n Exact skill 🌱\n'),
    file('soul.md', '  Root soul\r\n'), file('learned.md', 'Root learning\n'),
    file('odd/agent.md', child('worker', 'skills: true\n')), file('odd/skills/check.md', '# Check\n'), file('odd/learned.md', 'Child learning\n'),
    file('unused/private-notes.md', 'Do not include this'), file('assets/binary.png', new Uint8Array([0, 255])),
  ])
  const [entry, worker] = await compileAgentPackage(imported, options({ index: { files: { 'agents/soul.md': 'unrelated', 'skills/global.md': 'unrelated' } }, bindings: { models: { $default: 'desk-fast' }, tools: ['skill'] } }))
  expect(entry.engine.promptTemplate).toEqual({ system: 'System\r\n{{job}}', user: '{{context}}\r\n' })
  expect(entry.soul).toBe('  Root soul\r\n')
  expect(entry.learned).toBe('Root learning\n')
  expect(entry.packageResources).toEqual({ 'layouts/custom.md': template, 'guides/café.md': '---\nname: Source metadata\n---\n Exact skill 🌱\n', 'learned.md': 'Root learning\n', 'soul.md': '  Root soul\r\n' })
  expect(entry.packageSkills).toEqual([{ name: 'guides/café.md', path: 'guides/café.md', body: '---\nname: Source metadata\n---\n Exact skill 🌱\n' }])
  expect(worker.soul).toBe('')
  expect(worker.soulFrom).toBe('')
  expect(worker.learned).toBe('Child learning\n')
  expect(worker.packageSkills).toEqual([{ name: 'odd/skills/check.md', path: 'odd/skills/check.md', body: '# Check\n' }])
  expect(worker.packageResources).not.toHaveProperty('soul.md')
  expect(JSON.stringify([entry, worker])).not.toContain('Do not include this')
})

test('declared skills request the skill group but cannot enable it without desk approval', async () => {
  const imported = await pkg('skills: [guide.md]\n', [file('guide.md', '# Useful procedure')])
  const [denied] = await compileAgentPackage(imported, options())
  expect(denied.grants).toEqual([])
  expect(denied.skills).toBe(false)
  expect(denied.packageSkills).toHaveLength(1)
  const [granted] = await compileAgentPackage(imported, options({ bindings: { models: { $default: 'desk-fast' }, tools: ['skill'] } }))
  expect(granted.grants).toEqual(['skill'])
  expect(granted.skills).toBe(true)
})

test('imported scheduling is explicitly unsupported even when unselected or shadowed by a common group', async () => {
  const imported = await pkg('tools: [schedule]\n')
  await rejects(compileAgentPackage(imported, options()), 'PACKAGE_COMPILE_TOOL', 'deferred work')
  await rejects(compileAgentPackage(imported, options({ index: { files: { 'tools/schedule.js': 'trusted-version' } }, bindings: { models: { $default: 'desk-fast' }, tools: ['schedule'] } })), 'PACKAGE_COMPILE_TOOL', 'workspace binding')
  expect(SUPPORTED_BUILTIN_GROUPS).toContain('schedule')
  expect(IMPORTABLE_TOOL_GROUPS).not.toContain('schedule')
})

test('engine settings stay declarative with isolated default sessions and explicit legacy response support', async () => {
  const imported = await pkg('remembers: true\nmax_steps: 17\nrepairs: 1\ncompact_at: 0.6\nkeep: 3\noutput_reserve: 4000\nrequire_verification: true\nobservation_format: compact\ntemperature: 0.1\nmax_output_tokens: 2048\ncontext_length: 16000\nagents: [worker, isolated]\n', [
    file('worker/agent.md', child('worker', 'session: agent\ncontract_version: 1\nresponse_format: toon\n')),
    file('isolated/agent.md', child('isolated', 'session: task\nremembers: true\n')),
  ])
  const specs = await compileAgentPackage(imported, options())
  const entry = specs.find(spec => spec.package.agentId === 'entry')
  expect(entry.engine).toEqual({ contractVersion: 2, responseFormat: 'json', session: 'agent', remembers: true, maxSteps: 17, repairs: 1, compactAt: 0.6, keep: 3, outputReserve: 4000, requireVerification: true, observationFormat: 'compact' })
  expect(entry.inference).toEqual({ model: 'desk-fast', temperature: 0.1, maxOutputTokens: 2048, contextLength: 16000 })
  expect(specs.find(spec => spec.package.agentId === 'worker').engine).toEqual({ contractVersion: 1, responseFormat: 'toon', session: 'agent' })
  expect(specs.find(spec => spec.package.agentId === 'isolated').engine.session).toBe('task')
})

test('restored packages compile identically while unvalidated stored JSON is refused', async () => {
  const imported = await pkg('tools: [web]\n')
  const saved = JSON.parse(JSON.stringify(imported.data))
  const restored = await restoreAgentPackage(saved)
  expect(await compileAgentPackage(restored, options())).toEqual(await compileAgentPackage(imported, options()))
  await rejects(compileAgentPackage({ data: saved, source: imported.source }, options()), 'PACKAGE_COMPILE_SOURCE', 'validated')
  await rejects(compileAgentPackage(restored, options({ catalogue: { models: {} } })), 'PACKAGE_COMPILE_MODEL')
})

test('source resource corruption fails before returning any specs', async () => {
  const imported = await pkg('skills: [guide.md]\n', [file('guide.md', 'Correct')])
  const source = { ...imported.source, read: async () => new TextEncoder().encode('Corrupt') }
  await rejects(compileAgentPackage({ data: imported.data, source }, options()), 'PACKAGE_COMPILE_RESOURCE', 'changed after validation')
})

test('desk bindings and common-tool hashes are captured before asynchronous source reads', async () => {
  const imported = await pkg('skills: [guide.md]\ntools: [trusted, web]\n', [file('guide.md', '# Guide')])
  let release, entered
  const barrier = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const source = { ...imported.source, async read(...args) { entered(); await barrier; return imported.source.read(...args) } }
  const configured = options({ index: { files: { 'tools/trusted.js': 'old-hash' } }, bindings: { models: { $default: 'desk-fast' }, tools: ['trusted'] } })
  const expected = await compileAgentPackage(imported, configured)
  const pending = compileAgentPackage({ data: imported.data, source }, configured)
  await started
  configured.bindings.models.$default = 'desk-deep'; configured.bindings.tools.push('web'); configured.index.files['tools/trusted.js'] = 'new-hash'
  release()
  expect(await pending).toEqual(expected)
  const changed = await compileAgentPackage(imported, configured)
  expect(changed[0].hash).not.toBe(expected[0].hash)
  expect(changed[0].inference.model).toBe('desk-deep')
  expect(changed[0].grants).toEqual(['trusted', 'web'])
})
